"""Prompt Arena – FastAPI backend."""

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import hmac
import re
import secrets
import threading
import time
from typing import Any

import os

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
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


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str
    role: str = "admin"
    display_name: str = "Admin"


class SetPublishedRequest(BaseModel):
    published: bool


class SetOverridesRequest(BaseModel):
    overrides: dict[str, Any]


class ResetSessionRequest(BaseModel):
    unpublish_all: bool = True


class SetIntegrityJudgeRequest(BaseModel):
    enabled: bool


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
    prompt_rejected: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TZ_HH_ONLY_RE = re.compile(r"([+-])(\d{2})$")
_TZ_HHMM_RE = re.compile(r"([+-])(\d{2})(\d{2})$")

_STUDENT_NAME_RE = re.compile(r".+\(\d+\)$")

# Presence registry (single-instance only). Map student_name -> last_seen_utc
_presence_lock = threading.Lock()
_presence_last_seen: dict[str, datetime] = {}

# Admin tokens: ~7 days
_ADMIN_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60


def _admin_username() -> str:
    return (os.environ.get("ADMIN_USERNAME") or "admin").strip()


def _admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD") or ""


def _admin_token_secret() -> bytes:
    """HMAC secret for admin tokens. Prefer ADMIN_TOKEN_SECRET; fall back to ADMIN_PASSWORD."""
    secret = os.environ.get("ADMIN_TOKEN_SECRET") or _admin_password()
    if not secret:
        raise HTTPException(
            status_code=500,
            detail="Admin auth is not configured. Set ADMIN_PASSWORD in the environment.",
        )
    return secret.encode("utf-8")


def _create_admin_token() -> str:
    exp = int(time.time()) + _ADMIN_TOKEN_TTL_SECONDS
    nonce = secrets.token_hex(8)
    payload = f"admin:{exp}:{nonce}"
    sig = hmac.new(_admin_token_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_admin_token(token: str) -> bool:
    try:
        parts = token.split(":")
        if len(parts) != 4:
            return False
        role, exp_s, nonce, sig = parts
        if role != "admin":
            return False
        exp = int(exp_s)
        if exp < int(time.time()):
            return False
        payload = f"{role}:{exp_s}:{nonce}"
        expected = hmac.new(
            _admin_token_secret(), payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, sig)
    except Exception:
        return False


def require_admin(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency: require a valid admin Bearer token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin authentication required")
    token = authorization[len("Bearer ") :].strip()
    if not token or not _verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")


def _require_published_task(task_id: str) -> dict[str, Any]:
    """Load a merged task and ensure it is published for students."""
    task = _merged_task(task_id)
    published = leaderboard.get_published_task_ids()
    if task_id not in published:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


_OVERRIDE_KEYS = frozenset({
    "name",
    "description",
    "instructions",
    "prompt_intro",
    "prompt_panel_title",
    "prompt_panel_body",
    "prompt_placeholder",
    "judge_prompt",
    "pre_prompt_judge_prompt",
    "judge_persona",
    "evaluate_what",
})

_DEFAULT_PRE_PROMPT_REJECTED_MESSAGE = (
    "The purpose of this task is to extract information from the document using your prompt, "
    "not to include the answers in the prompt itself."
)


def _sanitize_overrides(raw: Any) -> dict[str, Any]:
    """Keep only allowlisted keys; drop empty values so yaml defaults apply."""
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="overrides must be an object")

    cleaned: dict[str, Any] = {}
    unknown = [k for k in raw.keys() if k not in _OVERRIDE_KEYS]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown override keys: {', '.join(sorted(str(k) for k in unknown))}",
        )

    for key, value in raw.items():
        if key not in _OVERRIDE_KEYS:
            continue
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if key == "instructions":
            if not isinstance(value, list):
                raise HTTPException(status_code=400, detail="instructions must be a list")
            steps: list[dict[str, str]] = []
            for step in value:
                if not isinstance(step, dict):
                    raise HTTPException(status_code=400, detail="Each instruction must be an object")
                verb = str(step.get("verb", "")).strip()
                text = str(step.get("text", "")).strip()
                if not verb and not text:
                    continue
                if not verb or not text:
                    raise HTTPException(
                        status_code=400,
                        detail="Each instruction needs both verb and text",
                    )
                steps.append({"verb": verb, "text": text})
            if not steps:
                continue
            cleaned[key] = steps
            continue
        if key == "judge_persona":
            persona = str(value).strip().lower()
            if persona not in ("strict", "generous"):
                raise HTTPException(status_code=400, detail="judge_persona must be 'strict' or 'generous'")
            cleaned[key] = persona
            continue
        if key == "evaluate_what":
            ew = str(value).strip().lower()
            if ew not in ("prompt", "output"):
                raise HTTPException(status_code=400, detail="evaluate_what must be 'prompt' or 'output'")
            cleaned[key] = ew
            continue
        if isinstance(value, str):
            cleaned[key] = value
        else:
            cleaned[key] = value
    return cleaned


def _apply_overrides(base_task: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    """Shallow-merge allowlisted override keys onto a config task copy."""
    merged = dict(base_task)
    for key, value in overrides.items():
        if key in _OVERRIDE_KEYS:
            merged[key] = value
    return merged


def _merged_task(task_id: str) -> dict[str, Any]:
    """Load task from config.yaml and apply any Supabase overrides."""
    task = _safe_task(task_id)
    overrides = leaderboard.get_task_overrides(task_id)
    if not overrides:
        return task
    return _apply_overrides(task, overrides)


def _effective_pre_prompt_judge_prompt(task: dict[str, Any], cfg: dict[str, Any]) -> str:
    """Per-task override, else global config default."""
    raw = task.get("pre_prompt_judge_prompt") or cfg.get("pre_prompt_judge_prompt") or ""
    return str(raw).strip()


def _pre_prompt_rejected_message(cfg: dict[str, Any]) -> str:
    raw = cfg.get("pre_prompt_rejected_message")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return _DEFAULT_PRE_PROMPT_REJECTED_MESSAGE


def _pre_prompt_judge_enabled() -> bool:
    """Live workshop setting; missing key means enabled (default on)."""
    raw = leaderboard.get_setting("pre_prompt_judge_enabled")
    if raw is None:
        return True
    return raw.strip().lower() not in ("false", "0", "off", "no")


def _published_config_task_ids(cfg: dict[str, Any]) -> list[str]:
    """Config task IDs that are currently published (order follows config.yaml)."""
    published = leaderboard.get_published_task_ids()
    ids: list[str] = []
    for task in cfg.get("tasks", []):
        if not isinstance(task, dict):
            continue
        tid = task.get("id")
        if isinstance(tid, str) and tid.strip() and tid in published:
            ids.append(tid)
    return ids


def _run_pre_prompt_integrity_check(
    *,
    cfg: dict[str, Any],
    task: dict[str, Any],
    student_prompt: str,
    judge_key: str,
    judge_base_url: str | None,
) -> dict[str, Any] | None:
    """
    Run the pre-prompt integrity judge.
    Returns None if clean / unavailable; returns {"flagged": True, "reason": ...} if blocked.
    """
    if not _pre_prompt_judge_enabled():
        return None
    judge_prompt = _effective_pre_prompt_judge_prompt(task, cfg)
    if not judge_prompt or not student_prompt.strip():
        return None

    items = None
    if task.get("task_type", "Document") == "Document" and isinstance(task.get("items"), list):
        items = task["items"]

    try:
        result = llm_client.run_pre_prompt_judge(
            api_key=judge_key,
            judge_model=cfg["judge_model"],
            judge_prompt=judge_prompt,
            student_prompt=student_prompt,
            task_name=str(task.get("name", "")),
            task_description=str(task.get("description", "")),
            items=items,
            base_url=judge_base_url,
            temperature=cfg.get("judge_temperature"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Pre-prompt judge error: {exc}")

    if result.get("flagged"):
        return result
    return None


def _rejected_submit_response(
    *,
    cfg: dict[str, Any],
    task: dict[str, Any],
    task_id: str,
    student_name: str,
    stored_prompt: str,
    since: datetime | None,
) -> SubmitResponse:
    """Score 0 + warning when pre-prompt integrity check fails; still persist the attempt."""
    message = _pre_prompt_rejected_message(cfg)
    previous_best = leaderboard.get_student_best(student_name, task_id, since=since)
    leaderboard.upsert_score(student_name, task_id, 0, stored_prompt)
    score_items: list[ScoreItem] = []
    if task.get("task_type", "Document") == "Document" and isinstance(task.get("items"), list):
        score_items = [
            ScoreItem(
                item_id=int(item["id"]),
                label=str(item.get("label", f"Item {item['id']}")),
                score=0,
                correct_answer="",
                found="",
                reason="Prompt rejected by integrity check",
            )
            for item in task["items"]
            if isinstance(item, dict) and "id" in item
        ]
    return SubmitResponse(
        student_output="",
        scores=score_items,
        total=0,
        previous_best=previous_best,
        is_new_best=False,
        judge_feedback=message,
        prompt_rejected=True,
    )


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
    """Prefer live Supabase workshop_settings over config.yaml data_cutoff_after."""
    raw: Any = None
    try:
        raw = leaderboard.get_setting("data_cutoff_after")
    except Exception:
        raw = None
    if raw in (None, "", "null"):
        raw = cfg.get("data_cutoff_after")
    if raw in (None, "", "null"):
        return None
    try:
        return _parse_data_cutoff_after(raw)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Invalid config data_cutoff_after: {exc}")


def _effective_data_cutoff_raw(cfg: dict[str, Any]) -> str | None:
    """Return the raw cutoff string currently in effect (DB first, then yaml)."""
    try:
        db_val = leaderboard.get_setting("data_cutoff_after")
    except Exception:
        db_val = None
    if isinstance(db_val, str) and db_val.strip():
        return db_val.strip()
    yaml_val = cfg.get("data_cutoff_after")
    if isinstance(yaml_val, str) and yaml_val.strip():
        return yaml_val.strip()
    return None


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


def _const_eq(a: str, b: str) -> bool:
    """Constant-time string compare that tolerates unequal lengths."""
    # Hash both so compare_digest always sees equal-length digests.
    return hmac.compare_digest(
        hashlib.sha256(a.encode("utf-8")).digest(),
        hashlib.sha256(b.encode("utf-8")).digest(),
    )


@app.post("/api/admin/login", response_model=AdminLoginResponse)
def admin_login(body: AdminLoginRequest) -> AdminLoginResponse:
    expected_user = _admin_username()
    expected_pass = _admin_password()
    if not expected_pass:
        raise HTTPException(
            status_code=500,
            detail="Admin auth is not configured. Set ADMIN_PASSWORD in the environment.",
        )
    user_ok = _const_eq(body.username.strip(), expected_user)
    pass_ok = _const_eq(body.password, expected_pass)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    return AdminLoginResponse(
        token=_create_admin_token(),
        role="admin",
        display_name="Admin",
    )


@app.get("/api/admin/tasks")
def admin_list_tasks(_: None = Depends(require_admin)) -> list[dict[str, Any]]:
    """All config tasks with published flags and merged editable fields (admin only)."""
    cfg = config_loader.get_config()
    flags = leaderboard.get_publish_flags()
    all_overrides = leaderboard.get_all_task_overrides()
    result: list[dict[str, Any]] = []
    for t in cfg.get("tasks", []):
        tid = t["id"]
        overrides = all_overrides.get(tid, {})
        merged = _apply_overrides(t, overrides) if overrides else t
        entry: dict[str, Any] = {
            "id": tid,
            "name": merged.get("name", ""),
            "description": merged.get("description", ""),
            "task_type": merged.get("task_type", "Document"),
            "published": bool(flags.get(tid, False)),
            "overrides": overrides,
            "has_overrides": bool(overrides),
        }
        if "instructions" in merged:
            entry["instructions"] = merged["instructions"]
        for key in (
            "prompt_intro",
            "prompt_panel_title",
            "prompt_panel_body",
            "prompt_placeholder",
            "judge_prompt",
            "pre_prompt_judge_prompt",
            "judge_persona",
            "evaluate_what",
        ):
            if key in merged:
                entry[key] = merged[key]
        # Always expose effective pre-prompt judge (task override or global default)
        entry["pre_prompt_judge_prompt"] = _effective_pre_prompt_judge_prompt(merged, cfg)
        result.append(entry)
    return result


@app.put("/api/admin/tasks/{task_id}/published")
def admin_set_task_published(
    task_id: str,
    body: SetPublishedRequest,
    _: None = Depends(require_admin),
) -> dict[str, Any]:
    _safe_task(task_id)
    leaderboard.set_task_published(task_id, body.published)
    return {"id": task_id, "published": body.published}


@app.put("/api/admin/tasks/{task_id}/overrides")
def admin_set_task_overrides(
    task_id: str,
    body: SetOverridesRequest,
    _: None = Depends(require_admin),
) -> dict[str, Any]:
    _safe_task(task_id)
    cleaned = _sanitize_overrides(body.overrides)
    saved = leaderboard.set_task_overrides(task_id, cleaned)
    cfg = config_loader.get_config()
    merged = _merged_task(task_id)
    return {
        "id": task_id,
        "overrides": saved,
        "has_overrides": bool(saved),
        "name": merged.get("name", ""),
        "description": merged.get("description", ""),
        "task_type": merged.get("task_type", "Document"),
        "instructions": merged.get("instructions"),
        "prompt_intro": merged.get("prompt_intro"),
        "prompt_panel_title": merged.get("prompt_panel_title"),
        "prompt_panel_body": merged.get("prompt_panel_body"),
        "prompt_placeholder": merged.get("prompt_placeholder"),
        "judge_prompt": merged.get("judge_prompt"),
        "pre_prompt_judge_prompt": _effective_pre_prompt_judge_prompt(merged, cfg),
        "judge_persona": merged.get("judge_persona"),
        "evaluate_what": merged.get("evaluate_what"),
    }


@app.delete("/api/admin/tasks/{task_id}/overrides")
def admin_clear_task_overrides(
    task_id: str,
    _: None = Depends(require_admin),
) -> dict[str, Any]:
    _safe_task(task_id)
    leaderboard.clear_task_overrides(task_id)
    cfg = config_loader.get_config()
    merged = _merged_task(task_id)
    return {
        "id": task_id,
        "overrides": {},
        "has_overrides": False,
        "name": merged.get("name", ""),
        "description": merged.get("description", ""),
        "task_type": merged.get("task_type", "Document"),
        "instructions": merged.get("instructions"),
        "prompt_intro": merged.get("prompt_intro"),
        "prompt_panel_title": merged.get("prompt_panel_title"),
        "prompt_panel_body": merged.get("prompt_panel_body"),
        "prompt_placeholder": merged.get("prompt_placeholder"),
        "judge_prompt": merged.get("judge_prompt"),
        "pre_prompt_judge_prompt": _effective_pre_prompt_judge_prompt(merged, cfg),
        "judge_persona": merged.get("judge_persona"),
        "evaluate_what": merged.get("evaluate_what"),
    }


@app.get("/api/admin/session")
def admin_get_session(_: None = Depends(require_admin)) -> dict[str, Any]:
    """Current workshop session status for admin UI."""
    cfg = config_loader.get_config()
    cutoff_raw = _effective_data_cutoff_raw(cfg)
    published = leaderboard.get_published_task_ids()
    return {
        "data_cutoff_after": cutoff_raw,
        "published_count": len(published),
        "pre_prompt_judge_enabled": _pre_prompt_judge_enabled(),
    }


@app.put("/api/admin/session/integrity-judge")
def admin_set_integrity_judge(
    body: SetIntegrityJudgeRequest,
    _: None = Depends(require_admin),
) -> dict[str, Any]:
    """Enable or disable the pre-prompt integrity judge for the workshop."""
    leaderboard.set_setting("pre_prompt_judge_enabled", "true" if body.enabled else "false")
    return {"pre_prompt_judge_enabled": body.enabled}


@app.post("/api/admin/reset-session")
def admin_reset_session(
    body: ResetSessionRequest,
    _: None = Depends(require_admin),
) -> dict[str, Any]:
    """Soft-reset leaderboards/prompts by setting data cutoff to now; optionally unpublish all."""
    now = datetime.now(timezone.utc)
    cutoff = now.isoformat()
    leaderboard.set_setting("data_cutoff_after", cutoff)
    unpublished = 0
    if body.unpublish_all:
        unpublished = leaderboard.unpublish_all_tasks()
    return {
        "data_cutoff_after": cutoff,
        "unpublished": unpublished,
    }


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
        and name != "Admin"
    ]


@app.get("/api/tasks")
def list_tasks() -> list[dict[str, Any]]:
    cfg = config_loader.get_config()
    published = leaderboard.get_published_task_ids()
    all_overrides = leaderboard.get_all_task_overrides()
    result: list[dict[str, Any]] = []
    for t in cfg.get("tasks", []):
        if t["id"] not in published:
            continue
        overrides = all_overrides.get(t["id"], {})
        merged = _apply_overrides(t, overrides) if overrides else t
        result.append({
            "id": merged["id"],
            "name": merged["name"],
            "description": merged["description"],
            "instructions": merged.get("instructions"),
        })
    return result


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str) -> dict[str, Any]:
    cfg = config_loader.get_config()
    task = _require_published_task(task_id)
    return _public_task(task, cfg)


@app.get("/api/tasks/{task_id}/document")
def download_document(task_id: str) -> FileResponse:
    task = _require_published_task(task_id)
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
    task = _require_published_task(task_id)
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

    # Pre-prompt integrity check (all task types that use /submit)
    flagged = _run_pre_prompt_integrity_check(
        cfg=cfg,
        task=task,
        student_prompt=body.prompt,
        judge_key=judge_key,
        judge_base_url=judge_base_url,
    )
    if flagged:
        return _rejected_submit_response(
            cfg=cfg,
            task=task,
            task_id=task_id,
            student_name=body.student_name,
            stored_prompt=body.prompt,
            since=since,
        )

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
        prompt_rejected=False,
    )


@app.get("/api/tasks/{task_id}/leaderboard")
def get_leaderboard(task_id: str) -> list[dict[str, Any]]:
    _require_published_task(task_id)
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)
    return leaderboard.get_leaderboard(task_id, since=since)


@app.get("/api/tasks/{task_id}/history")
def get_history(
    task_id: str,
    student: str = Query(..., description="Student name"),
) -> list[dict[str, Any]]:
    _require_published_task(task_id)
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)
    return leaderboard.get_student_history(student, task_id, since=since)


@app.get("/api/student-prompts")
def get_student_prompts(
    task_id: str | None = Query(None, description="Filter by task ID"),
    student: str | None = Query(None, description="Filter by student name (substring)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: None = Depends(require_admin),
) -> list[dict[str, Any]]:
    """List submitted prompts for the Student Prompts tab (admin only)."""
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)
    rows = leaderboard.get_student_prompts(
        task_id=task_id,
        student_filter=student or None,
        limit=limit,
        offset=offset,
        since=since,
    )
    tasks_by_id: dict[str, dict[str, Any]] = {}
    for t in cfg.get("tasks", []):
        if isinstance(t, dict) and isinstance(t.get("id"), str):
            tasks_by_id[t["id"]] = t
    all_overrides = leaderboard.get_all_task_overrides()
    result = []
    for row in rows:
        task = tasks_by_id.get(row["task_id"])
        if task is not None:
            overrides = all_overrides.get(row["task_id"])
            if overrides:
                task = _apply_overrides(task, overrides)
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


@app.get("/api/my-total")
def get_my_total(
    student: str = Query(..., description="Student display name, e.g. First (12345678)"),
) -> dict[str, Any]:
    """Sum of this student's best scores across all currently published tasks."""
    name = _validate_student_name(student)
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)
    task_ids = _published_config_task_ids(cfg)
    task_count = len(task_ids)
    max_points = task_count * 100
    if not task_ids:
        return {"total_points": 0, "max_points": 0, "task_count": 0}
    totals = leaderboard.get_student_total(name, task_ids=task_ids, since=since)
    return {
        "total_points": int(totals.get("total_points") or 0),
        "max_points": max_points,
        "task_count": task_count,
    }


@app.get("/api/master-leaderboard")
def get_master_leaderboard(
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Global leaderboard: sum of best scores across all currently published tasks."""
    cfg = config_loader.get_config()
    since = _data_cutoff_since(cfg)

    task_ids = _published_config_task_ids(cfg)
    task_count = len(task_ids)
    max_points = task_count * 100
    if not task_ids:
        return {"entries": [], "max_points": 0, "task_count": 0}

    rows = leaderboard.get_master_leaderboard(task_ids=task_ids, limit=limit, since=since)
    entries = []
    for row in rows:
        entries.append({
            "student_name": row["student_name"],
            "total_points": int(row["total_points"]) if row.get("total_points") is not None else 0,
            "tasks_completed": int(row["tasks_completed"]) if row.get("tasks_completed") is not None else 0,
            "last_submitted": row["last_submitted"].isoformat() if hasattr(row.get("last_submitted"), "isoformat") else str(row.get("last_submitted")),
        })
    return {"entries": entries, "max_points": max_points, "task_count": task_count}


@app.post("/api/tasks/{task_id}/chat/message")
def chat_message(task_id: str, body: ChatTurnRequest) -> dict[str, str]:
    cfg = config_loader.get_config()
    task = _require_published_task(task_id)

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
    task = _require_published_task(task_id)
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
    student_lines: list[str] = []
    for msg in body.history:
        speaker = "STUDENT" if msg.role == "student" else "ASSISTANT"
        lines.append(f"{speaker}: {msg.content}")
        if msg.role == "student":
            student_lines.append(msg.content)
    transcript = "\n".join(lines)
    student_prompt_text = "\n\n".join(student_lines)

    flagged = _run_pre_prompt_integrity_check(
        cfg=cfg,
        task=task,
        student_prompt=student_prompt_text,
        judge_key=judge_key,
        judge_base_url=judge_base_url,
    )
    if flagged:
        return _rejected_submit_response(
            cfg=cfg,
            task=task,
            task_id=task_id,
            student_name=body.student_name,
            stored_prompt=transcript,
            since=since,
        )

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
        judge_feedback=judgment_simple.get("feedback") if isinstance(judgment_simple.get("feedback"), str) else None,
        prompt_rejected=False,
    )


# ---------------------------------------------------------------------------
# Serve built React frontend (production)
# ---------------------------------------------------------------------------

_frontend_dist = os.path.join(os.path.dirname(__file__), "../frontend/dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
