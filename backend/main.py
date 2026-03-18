"""Prompt Arena – FastAPI backend."""

from datetime import datetime, timezone
from pathlib import Path
import re
import threading
from typing import Any

import os

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config_loader
import leaderboard
import llm_client
import pdf_utils

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Prompt Arena API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"https://.*\.azurewebsites\.net",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    leaderboard.init_db()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    name: str


class LoginResponse(BaseModel):
    name: str


class PresencePingRequest(BaseModel):
    student_name: str


class SubmitRequest(BaseModel):
    student_name: str
    prompt: str


class ChatMessage(BaseModel):
    role: str  # "student" or "assistant"
    content: str


class ChatTurnRequest(BaseModel):
    student_name: str
    message: str
    history: list[ChatMessage]


class ChatScoreRequest(BaseModel):
    student_name: str
    history: list[ChatMessage]


class ScoreItem(BaseModel):
    item_id: int
    label: str
    score: int
    correct_answer: str
    found: str
    reason: str


class JudgeBreakdownItem(BaseModel):
    score: int
    max: int


class SubmitResponse(BaseModel):
    student_output: str
    scores: list[ScoreItem]
    total: int
    previous_best: int | None
    is_new_best: bool
    judge_breakdown: dict[str, JudgeBreakdownItem] | None = None
    judge_feedback: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TZ_HH_ONLY_RE = re.compile(r"([+-])(\d{2})$")
_TZ_HHMM_RE = re.compile(r"([+-])(\d{2})(\d{2})$")

_STUDENT_NAME_RE = re.compile(r".+\(\d+\)$")

# Presence registry (single-instance only). Map student_name -> last_seen_utc
_presence_lock = threading.Lock()
_presence_last_seen: dict[str, datetime] = {}


def _validate_student_name(raw: Any) -> str:
    if not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="Student name must be a string.")
    name = raw.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    # Frontend sends a displayName like: "First (12345678)"
    # Enforce a numeric Student ID even if the UI is bypassed.
    if not _STUDENT_NAME_RE.fullmatch(name):
        raise HTTPException(status_code=400, detail="Student ID must be numbers only.")
    return name


def _prune_presence(now: datetime, active_within_seconds: int) -> None:
    cutoff = now.timestamp() - active_within_seconds
    stale = [name for name, seen in _presence_last_seen.items() if seen.timestamp() < cutoff]
    for name in stale:
        _presence_last_seen.pop(name, None)



def _parse_data_cutoff_after(raw: Any) -> datetime | None:
    """
    Parse config `data_cutoff_after` into a timezone-aware datetime.

    Accepts:
    - ISO 8601 with offset, e.g. 2026-03-18T10:00:00+11:00
    - 'Z' suffix, e.g. 2026-03-18T00:00:00Z
    - Postgres-like timestamptz strings, e.g. 2026-03-08 18:10:24.805457+00
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError("data_cutoff_after must be a string timestamp or empty")

    s = raw.strip()
    if not s:
        return None

    # Normalize common variants to something datetime.fromisoformat can parse.
    s = s.replace("Z", "+00:00")
    s = _TZ_HH_ONLY_RE.sub(r"\1\2:00", s)     # +00 -> +00:00
    s = _TZ_HHMM_RE.sub(r"\1\2:\3", s)        # +1100 -> +11:00

    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        # Fallback for cases fromisoformat still rejects.
        for fmt in (
            "%Y-%m-%d %H:%M:%S.%f%z",
            "%Y-%m-%d %H:%M:%S%z",
            "%Y-%m-%dT%H:%M:%S.%f%z",
            "%Y-%m-%dT%H:%M:%S%z",
        ):
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                dt = None  # type: ignore[assignment]
        if dt is None:
            raise

    # Ensure tz-aware (avoid server-local ambiguity if user supplied naive time).
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _data_cutoff_since(cfg: dict[str, Any]) -> datetime | None:
    raw = cfg.get("data_cutoff_after")
    if raw in (None, "", "null"):
        return None
    try:
        return _parse_data_cutoff_after(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Invalid config data_cutoff_after: {exc}")


def _safe_task(task_id: str) -> dict[str, Any]:
    task = config_loader.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _public_task(task: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Strip answers and add model info before sending to the frontend."""
    global_persona = cfg.get("judge_persona", "strict")
    task_persona = task.get("judge_persona", global_persona)
    base: dict[str, Any] = {
        "id": task["id"],
        "name": task["name"],
        "task_type": task.get("task_type", "Document"),
        "description": task["description"],
        "task_model": cfg["task_model"],
        "judge_persona": task_persona,
    }
    # Optional per-task instructions and prompt configuration
    if "instructions" in task:
        base["instructions"] = task["instructions"]
    # Optional per-task prompt configuration for Prompt/Document tasks
    for key in ("prompt_intro", "prompt_panel_title", "prompt_panel_body", "prompt_placeholder"):
        if key in task:
            base[key] = task[key]

    task_type = base["task_type"]

    if task_type == "Document":
        base["document_filename"] = Path(task["document"]).name
        base["items"] = [
            {"id": item["id"], "label": item["label"]}
            for item in task["items"]
        ]
    elif task_type == "Prompt":
        if "judge_prompt" in task:
            base["judge_prompt"] = task["judge_prompt"]
        if "evaluate_what" in task:
            base["evaluate_what"] = task["evaluate_what"]
    elif task_type == "Chat":
        if "judge_prompt" in task:
            base["judge_prompt"] = task["judge_prompt"]

    return base


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post("/api/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    name = _validate_student_name(body.name)
    return LoginResponse(name=name)


@app.post("/api/presence/ping")
def presence_ping(body: PresencePingRequest) -> dict[str, bool]:
    name = _validate_student_name(body.student_name)
    now = datetime.now(timezone.utc)
    with _presence_lock:
        _presence_last_seen[name] = now
        _prune_presence(now, active_within_seconds=300)
    return {"ok": True}


@app.get("/api/presence")
def presence_list(
    active_within_seconds: int = Query(300, ge=10, le=3600),
) -> list[dict[str, str]]:
    now = datetime.now(timezone.utc)
    with _presence_lock:
        _prune_presence(now, active_within_seconds=active_within_seconds)
        rows = sorted(_presence_last_seen.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {"student_name": name, "last_seen": seen.isoformat()}
        for name, seen in rows
        if (now - seen).total_seconds() <= active_within_seconds
    ]


@app.get("/api/tasks")
def list_tasks() -> list[dict[str, Any]]:
    cfg = config_loader.get_config()
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
            "instructions": t.get("instructions"),
        }
        for t in cfg.get("tasks", [])
    ]


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str) -> dict[str, Any]:
    cfg = config_loader.get_config()
    task = _safe_task(task_id)
    return _public_task(task, cfg)


@app.get("/api/tasks/{task_id}/document")
def download_document(task_id: str) -> FileResponse:
    task = _safe_task(task_id)
    if task.get("task_type", "Document") != "Document":
        raise HTTPException(status_code=400, detail="This task type does not have a document")
    doc_path = config_loader.get_document_path(task)
    if not doc_path.exists():
        raise HTTPException(status_code=404, detail="Document file not found on server")
    filename = doc_path.name
    return FileResponse(
        path=str(doc_path),
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/tasks/{task_id}/submit", response_model=SubmitResponse)
def submit_prompt(task_id: str, body: SubmitRequest) -> SubmitResponse:
    cfg = config_loader.get_config()
    task = _safe_task(task_id)
    since = _data_cutoff_since(cfg)

    openai_key     = cfg.get("openai_api_key", "")
    openrouter_key = cfg.get("openrouter_api_key", "")

    task_base_url  = cfg.get("task_provider_base_url", "") or None
    judge_base_url = cfg.get("judge_provider_base_url", "") or None

    # Pick the right API key: use OpenRouter key when a custom base URL is set,
    # otherwise fall back to the OpenAI key.
    task_key  = openrouter_key if task_base_url  else openai_key
    judge_key = openrouter_key if judge_base_url else openai_key

    if not task_key:
        raise HTTPException(
            status_code=500,
            detail="No API key configured for the task model. Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env.",
        )
    if not judge_key:
        raise HTTPException(
            status_code=500,
            detail="No API key configured for the judge model. Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env.",
        )

    task_type = task.get("task_type", "Document")
    judge_breakdown = None
    judge_feedback = None

    if task_type == "Document":
        # 1. Extract PDF text
        doc_path = config_loader.get_document_path(task)
        try:
            doc_text = pdf_utils.extract_text(doc_path)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Task document not found on server")

        # 2. Run the student's prompt through the task LLM
        try:
            student_output = llm_client.run_task_prompt(
                api_key=task_key,
                model=cfg["task_model"],
                student_prompt=body.prompt,
                document_text=doc_text,
                base_url=task_base_url,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Task LLM error: {exc}")

        # 3. Judge the output
        items = task["items"]
        correct_answers = [item["answer"] for item in items]
        global_persona = cfg.get("judge_persona", "strict")
        task_persona = task.get("judge_persona", global_persona)
        judge_temperature = cfg.get("judge_temperature")
        try:
            judgment = llm_client.run_judge(
                api_key=judge_key,
                judge_model=cfg["judge_model"],
                items=items,
                correct_answers=correct_answers,
                student_output=student_output,
                base_url=judge_base_url,
                persona=task_persona,
                temperature=judge_temperature,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Judge LLM error: {exc}")

        # Compute total server-side from individual scores — never trust the judge's arithmetic
        raw_scores = judgment.get("scores", [])
        if raw_scores:
            total_score: int = round(
                sum(max(0, min(10, int(s.get("score", 0)))) for s in raw_scores)
                / (10 * len(raw_scores))
                * 100
            )
        else:
            total_score = 0

        scores_payload = raw_scores

    elif task_type == "Prompt":
        judge_prompt = task.get("judge_prompt")
        evaluate_what = task.get("evaluate_what", "prompt")
        if not judge_prompt:
            raise HTTPException(status_code=500, detail="Prompt tasks must define judge_prompt in config.yaml")

        # Always run the student's prompt through the task LLM so we can
        # show a model answer in the frontend, regardless of what is judged.
        try:
            model_output = llm_client.run_freeform_prompt(
                api_key=task_key,
                model=cfg["task_model"],
                student_prompt=body.prompt,
                base_url=task_base_url,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Task LLM error: {exc}")

        # Decide what text the judge should evaluate
        if evaluate_what == "output":
            text_to_judge = model_output
        else:
            text_to_judge = body.prompt

        judge_temperature = cfg.get("judge_temperature")
        try:
            judgment_simple = llm_client.run_prompt_judge(
                api_key=judge_key,
                judge_model=cfg["judge_model"],
                judge_prompt=judge_prompt,
                text_to_judge=text_to_judge,
                base_url=judge_base_url,
                temperature=judge_temperature,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Judge LLM error: {exc}")

        total_score = int(judgment_simple.get("total", 0))
        total_score = max(0, min(100, total_score))
        # Frontend should see the model's answer in the Model output box.
        student_output = model_output
        judge_breakdown = judgment_simple.get("breakdown")
        judge_feedback = judgment_simple.get("feedback")
        scores_payload = []

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported task_type for /submit: {task_type}")

    # Persist score
    previous_best = leaderboard.get_student_best(body.student_name, task_id, since=since)
    leaderboard.upsert_score(body.student_name, task_id, total_score, body.prompt)
    is_new_best = previous_best is None or total_score > previous_best

    # 5. Build per-item response (merge labels and answers back in, Document tasks only)
    if task_type == "Document":
        items = task["items"]
        label_map = {item["id"]: item["label"] for item in items}
        answer_map = {item["id"]: item["answer"] for item in items}
        score_items = [
            ScoreItem(
                item_id=s["item_id"],
                label=label_map.get(s["item_id"], f"Item {s['item_id']}"),
                score=s["score"],
                correct_answer=answer_map.get(s["item_id"], ""),
                found=s.get("found", ""),
                reason=s["reason"],
            )
            for s in scores_payload
        ]
    else:
        score_items = []

    return SubmitResponse(
        student_output=student_output,
        scores=score_items,
        total=total_score,
        previous_best=previous_best,
        is_new_best=is_new_best,
        judge_breakdown=judge_breakdown if isinstance(judge_breakdown, dict) else None,
        judge_feedback=judge_feedback if isinstance(judge_feedback, str) else None,
    )


@app.get("/api/tasks/{task_id}/leaderboard")
def get_leaderboard(task_id: str) -> list[dict[str, Any]]:
    _safe_task(task_id)
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)
    return leaderboard.get_leaderboard(task_id, since=since)


@app.get("/api/tasks/{task_id}/history")
def get_history(
    task_id: str,
    student: str = Query(..., description="Student name"),
) -> list[dict[str, Any]]:
    _safe_task(task_id)
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)
    return leaderboard.get_student_history(student, task_id, since=since)


@app.get("/api/student-prompts")
def get_student_prompts(
    task_id: str | None = Query(None, description="Filter by task ID"),
    student: str | None = Query(None, description="Filter by student name (substring)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[dict[str, Any]]:
    """List submitted prompts for the Student Prompts tab. Optional filters: task_id, student."""
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)
    rows = leaderboard.get_student_prompts(
        task_id=task_id,
        student_filter=student or None,
        limit=limit,
        offset=offset,
        since=since,
    )
    result = []
    for row in rows:
        task = config_loader.get_task(row["task_id"])
        task_name = task["name"] if task else row["task_id"]
        result.append({
            "student_name": row["student_name"],
            "task_id": row["task_id"],
            "task_name": task_name,
            "prompt": row["prompt"],
            "score": row["score"],
            "submitted_at": row["submitted_at"].isoformat() if hasattr(row["submitted_at"], "isoformat") else str(row["submitted_at"]),
        })
    return result


@app.get("/api/master-leaderboard")
def get_master_leaderboard(
    limit: int = Query(50, ge=1, le=200),
) -> list[dict[str, Any]]:
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)

    task_ids_raw = cfg.get("master_leaderboard_task_ids", [])
    if task_ids_raw is None:
        return []
    if not isinstance(task_ids_raw, list) or any(not isinstance(x, str) for x in task_ids_raw):
        raise HTTPException(status_code=500, detail="Invalid config master_leaderboard_task_ids: must be a list of strings")
    task_ids = [x.strip() for x in task_ids_raw if x and x.strip()]
    if not task_ids:
        return []

    # Validate task IDs exist in config.yaml (catch typos early)
    known_ids = {t.get("id") for t in cfg.get("tasks", []) if isinstance(t, dict)}
    unknown = [tid for tid in task_ids if tid not in known_ids]
    if unknown:
        raise HTTPException(
            status_code=500,
            detail=f"Unknown task IDs in master_leaderboard_task_ids: {', '.join(unknown)}",
        )

    rows = leaderboard.get_master_leaderboard(task_ids=task_ids, limit=limit, since=since)
    result = []
    for row in rows:
        result.append({
            "student_name": row["student_name"],
            "total_points": int(row["total_points"]) if row.get("total_points") is not None else 0,
            "tasks_completed": int(row["tasks_completed"]) if row.get("tasks_completed") is not None else 0,
            "last_submitted": row["last_submitted"].isoformat() if hasattr(row.get("last_submitted"), "isoformat") else str(row.get("last_submitted")),
        })
    return result


@app.post("/api/tasks/{task_id}/chat/message")
def chat_message(task_id: str, body: ChatTurnRequest) -> dict[str, str]:
    cfg = config_loader.get_config()
    task = _safe_task(task_id)

    if task.get("task_type") != "Chat":
        raise HTTPException(status_code=400, detail="This endpoint is only for Chat tasks")

    openai_key     = cfg.get("openai_api_key", "")
    openrouter_key = cfg.get("openrouter_api_key", "")
    task_base_url  = cfg.get("task_provider_base_url", "") or None
    task_key       = openrouter_key if task_base_url else openai_key
    if not task_key:
        raise HTTPException(status_code=500, detail="No API key configured for the task model.")

    system_msg = (
        "You are a helpful assistant in a teaching workshop. "
        "Have a clear, helpful conversation with the student. "
        "Do not mention that you are being graded."
    )

    history_messages: list[dict[str, str]] = [{"role": "system", "content": system_msg}]
    for msg in body.history:
        role = "user" if msg.role == "student" else "assistant"
        history_messages.append({"role": role, "content": msg.content})
    history_messages.append({"role": "user", "content": body.message})

    try:
        assistant_reply = llm_client.run_chat_turn(
            api_key=task_key,
            model=cfg["task_model"],
            messages=history_messages,
            base_url=task_base_url,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Chat LLM error: {exc}")

    return {"assistant_message": assistant_reply}


@app.post("/api/tasks/{task_id}/chat/score", response_model=SubmitResponse)
def chat_score(task_id: str, body: ChatScoreRequest) -> SubmitResponse:
    cfg = config_loader.get_config()
    task = _safe_task(task_id)
    since = _data_cutoff_since(cfg)

    if task.get("task_type") != "Chat":
        raise HTTPException(status_code=400, detail="This endpoint is only for Chat tasks")

    openai_key     = cfg.get("openai_api_key", "")
    openrouter_key = cfg.get("openrouter_api_key", "")
    judge_base_url = cfg.get("judge_provider_base_url", "") or None
    judge_key      = openrouter_key if judge_base_url else openai_key
    if not judge_key:
        raise HTTPException(status_code=500, detail="No API key configured for the judge model.")

    judge_prompt = task.get("judge_prompt")
    if not judge_prompt:
        raise HTTPException(status_code=500, detail="Chat tasks must define judge_prompt in config.yaml")

    # Flatten chat history into a single transcript string
    lines: list[str] = []
    for msg in body.history:
        speaker = "STUDENT" if msg.role == "student" else "ASSISTANT"
        lines.append(f"{speaker}: {msg.content}")
    transcript = "\n".join(lines)

    try:
        judgment_simple = llm_client.run_prompt_judge(
            api_key=judge_key,
            judge_model=cfg["judge_model"],
            judge_prompt=judge_prompt,
            text_to_judge=transcript,
            base_url=judge_base_url,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Judge LLM error: {exc}")

    total_score = int(judgment_simple.get("total", 0))
    total_score = max(0, min(100, total_score))

    # Persist using the transcript as the stored "prompt"
    previous_best = leaderboard.get_student_best(body.student_name, task_id, since=since)
    leaderboard.upsert_score(body.student_name, task_id, total_score, transcript)
    is_new_best = previous_best is None or total_score > previous_best

    return SubmitResponse(
        student_output=transcript,
        scores=[],
        total=total_score,
        previous_best=previous_best,
        is_new_best=is_new_best,
    )


# ---------------------------------------------------------------------------
# Serve built React frontend (production)
# ---------------------------------------------------------------------------

_frontend_dist = os.path.join(os.path.dirname(__file__), "../frontend/dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
