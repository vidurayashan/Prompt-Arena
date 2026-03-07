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
    """Create the scores table if it does not exist."""
    with _conn() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                student_name  TEXT    NOT NULL,
                task_id       TEXT    NOT NULL,
                score         INTEGER NOT NULL,
                submitted_at  TEXT    NOT NULL
            )
            """
        )
        con.commit()


def upsert_score(student_name: str, task_id: str, score: int) -> None:
    """Insert a new score record. The leaderboard query picks the best per student."""
    with _conn() as con:
        con.execute(
            """
            INSERT INTO scores (student_name, task_id, score, submitted_at)
            VALUES (?, ?, ?, ?)
            """,
            (student_name, task_id, score, datetime.utcnow().isoformat()),
        )
        con.commit()


def get_leaderboard(task_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return top scores for a task, one row per student (their best score)."""
    with _conn() as con:
        rows = con.execute(
            """
            SELECT student_name,
                   MAX(score) AS best_score,
                   COUNT(*)   AS attempts,
                   MAX(submitted_at) AS last_submitted
            FROM   scores
            WHERE  task_id = ?
            GROUP  BY student_name
            ORDER  BY best_score DESC, last_submitted ASC
            LIMIT  ?
            """,
            (task_id, limit),
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
