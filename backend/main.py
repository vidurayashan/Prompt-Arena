"""Prompt Arena – FastAPI backend."""

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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


class SubmitRequest(BaseModel):
    student_name: str
    prompt: str


class ScoreItem(BaseModel):
    item_id: int
    label: str
    score: int
    reason: str


class SubmitResponse(BaseModel):
    student_output: str
    scores: list[ScoreItem]
    total: int
    previous_best: int | None
    is_new_best: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_task(task_id: str) -> dict[str, Any]:
    task = config_loader.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _public_task(task: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Strip answers and add model info before sending to the frontend."""
    return {
        "id": task["id"],
        "name": task["name"],
        "description": task["description"],
        "document_filename": Path(task["document"]).name,
        "task_model": cfg["task_model"],
        "items": [
            {"id": item["id"], "label": item["label"]}
            for item in task["items"]
        ],
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post("/api/login", response_model=LoginResponse)
def login(body: LoginRequest) -> LoginResponse:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    return LoginResponse(name=name)


@app.get("/api/tasks")
def list_tasks() -> list[dict[str, Any]]:
    cfg = config_loader.get_config()
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
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

    api_key = cfg.get("openai_api_key", "")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Set openai_api_key in config.yaml or OPENAI_API_KEY env var.",
        )

    # 1. Extract PDF text
    doc_path = config_loader.get_document_path(task)
    try:
        doc_text = pdf_utils.extract_text(doc_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Task document not found on server")

    # 2. Run the student's prompt through the task LLM
    try:
        student_output = llm_client.run_task_prompt(
            api_key=api_key,
            model=cfg["task_model"],
            student_prompt=body.prompt,
            document_text=doc_text,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Task LLM error: {exc}")

    # 3. Judge the output
    items = task["items"]
    correct_answers = [item["answer"] for item in items]
    try:
        judgment = llm_client.run_judge(
            api_key=api_key,
            judge_model=cfg["judge_model"],
            items=items,
            correct_answers=correct_answers,
            student_output=student_output,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Judge LLM error: {exc}")

    total_score: int = int(judgment.get("total", 0))

    # 4. Persist score
    previous_best = leaderboard.get_student_best(body.student_name, task_id)
    leaderboard.upsert_score(body.student_name, task_id, total_score)
    is_new_best = previous_best is None or total_score > previous_best

    # 5. Build per-item response (merge labels back in)
    label_map = {item["id"]: item["label"] for item in items}
    score_items = [
        ScoreItem(
            item_id=s["item_id"],
            label=label_map.get(s["item_id"], f"Item {s['item_id']}"),
            score=s["score"],
            reason=s["reason"],
        )
        for s in judgment.get("scores", [])
    ]

    return SubmitResponse(
        student_output=student_output,
        scores=score_items,
        total=total_score,
        previous_best=previous_best,
        is_new_best=is_new_best,
    )


@app.get("/api/tasks/{task_id}/leaderboard")
def get_leaderboard(task_id: str) -> list[dict[str, Any]]:
    _safe_task(task_id)
    return leaderboard.get_leaderboard(task_id)
