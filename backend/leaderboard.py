"""SQLite-backed leaderboard: stores best score per student per task."""

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).parent / "leaderboard.db"


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    """Create the scores table if it does not exist, and migrate existing DBs."""
    with _conn() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                student_name  TEXT    NOT NULL,
                task_id       TEXT    NOT NULL,
                score         INTEGER NOT NULL,
                prompt        TEXT    NOT NULL DEFAULT '',
                submitted_at  TEXT    NOT NULL
            )
            """
        )
        # Migrate existing DBs that were created before the prompt column was added
        try:
            con.execute("ALTER TABLE scores ADD COLUMN prompt TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass  # column already exists
        con.commit()


def upsert_score(student_name: str, task_id: str, score: int, prompt: str = "") -> None:
    """Insert a new score record. The leaderboard query picks the best per student."""
    with _conn() as con:
        con.execute(
            """
            INSERT INTO scores (student_name, task_id, score, prompt, submitted_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (student_name, task_id, score, prompt, datetime.utcnow().isoformat()),
        )
        con.commit()


def get_leaderboard(task_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return top scores for a task, one row per student (best + latest score)."""
    with _conn() as con:
        rows = con.execute(
            """
            SELECT s1.student_name,
                   MAX(s1.score) AS best_score,
                   (SELECT s2.score
                    FROM   scores s2
                    WHERE  s2.student_name = s1.student_name
                      AND  s2.task_id      = s1.task_id
                    ORDER  BY s2.submitted_at DESC
                    LIMIT  1)              AS latest_score,
                   COUNT(*)               AS attempts,
                   MAX(s1.submitted_at)   AS last_submitted
            FROM   scores s1
            WHERE  s1.task_id = ?
            GROUP  BY s1.student_name
            ORDER  BY best_score DESC, last_submitted ASC
            LIMIT  ?
            """,
            (task_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def get_student_history(student_name: str, task_id: str) -> list[dict[str, Any]]:
    """Return all submissions for one student+task, newest first."""
    with _conn() as con:
        rows = con.execute(
            """
            SELECT score, prompt, submitted_at
            FROM   scores
            WHERE  student_name = ? AND task_id = ?
            ORDER  BY submitted_at DESC
            """,
            (student_name, task_id),
        ).fetchall()
    return [dict(row) for row in rows]


def get_student_best(student_name: str, task_id: str) -> int | None:
    """Return a student's best score for a task, or None if no submissions."""
    with _conn() as con:
        row = con.execute(
            """
            SELECT MAX(score) AS best_score
            FROM   scores
            WHERE  student_name = ? AND task_id = ?
            """,
            (student_name, task_id),
        ).fetchone()
    return row["best_score"] if row and row["best_score"] is not None else None
