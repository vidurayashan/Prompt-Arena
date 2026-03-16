"""PostgreSQL-backed leaderboard via Supabase (psycopg2)."""

import os
from typing import Any

import psycopg2
import psycopg2.extras


def _conn() -> psycopg2.extensions.connection:
    url = os.environ["SUPABASE_DATABASE_URL"]
    con = psycopg2.connect(url)
    return con


def init_db() -> None:
    """No-op: table is managed directly in Supabase."""
    pass


def upsert_score(student_name: str, task_id: str, score: int, prompt: str = "") -> None:
    """Insert a new score record. The leaderboard query picks the best per student."""
    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO scores (student_name, task_id, score, prompt)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (student_name, task_id, score, prompt),
                )
    finally:
        con.close()


def get_leaderboard(task_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return top scores for a task, one row per student (best + latest score)."""
    con = _conn()
    try:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT s1.student_name,
                       MAX(s1.score)        AS best_score,
                       (SELECT s2.score
                        FROM   scores s2
                        WHERE  s2.student_name = s1.student_name
                          AND  s2.task_id      = s1.task_id
                        ORDER  BY s2.submitted_at DESC
                        LIMIT  1)           AS latest_score,
                       COUNT(*)             AS attempts,
                       MAX(s1.submitted_at) AS last_submitted
                FROM   scores s1
                WHERE  s1.task_id = %s
                GROUP  BY s1.student_name, s1.task_id
                ORDER  BY best_score DESC, last_submitted ASC
                LIMIT  %s
                """,
                (task_id, limit),
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def get_student_history(student_name: str, task_id: str) -> list[dict[str, Any]]:
    """Return all submissions for one student+task, newest first."""
    con = _conn()
    try:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT score, prompt, submitted_at
                FROM   scores
                WHERE  student_name = %s AND task_id = %s
                ORDER  BY submitted_at DESC
                """,
                (student_name, task_id),
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def get_student_best(student_name: str, task_id: str) -> int | None:
    """Return a student's best score for a task, or None if no submissions."""
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute(
                """
                SELECT MAX(score) AS best_score
                FROM   scores
                WHERE  student_name = %s AND task_id = %s
                """,
                (student_name, task_id),
            )
            row = cur.fetchone()
        return row[0] if row and row[0] is not None else None
    finally:
        con.close()


def get_student_prompts(
    task_id: str | None = None,
    student_filter: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Return submissions that have a non-empty prompt, for the Student Prompts tab."""
    con = _conn()
    try:
        conditions = ["prompt IS NOT NULL", "trim(prompt) <> ''"]
        params: list[Any] = []
        if task_id:
            conditions.append("task_id = %s")
            params.append(task_id)
        if student_filter:
            conditions.append("student_name ILIKE %s")
            params.append(f"%{student_filter}%")
        where_sql = " AND ".join(conditions)
        params.extend([limit, offset])
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT student_name, task_id, prompt, score, submitted_at
                FROM   scores
                WHERE  {where_sql}
                ORDER  BY submitted_at DESC
                LIMIT  %s OFFSET %s
                """,
                params,
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()
