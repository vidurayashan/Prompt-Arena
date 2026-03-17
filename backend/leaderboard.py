"""PostgreSQL-backed leaderboard via Supabase (psycopg2)."""

from datetime import datetime
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


def get_leaderboard(task_id: str, limit: int = 50, since: datetime | None = None) -> list[dict[str, Any]]:
    """Return top scores for a task, one row per student (best + latest score)."""
    con = _conn()
    try:
        latest_conditions = ["s2.student_name = s1.student_name", "s2.task_id = s1.task_id"]
        if since is not None:
            latest_conditions.append("s2.submitted_at >= %s")
        latest_where_sql = " AND ".join(latest_conditions)

        conditions = ["s1.task_id = %s"]
        if since is not None:
            conditions.append("s1.submitted_at >= %s")
        where_sql = " AND ".join(conditions)

        # IMPORTANT: parameter order must match placeholder order in SQL.
        # The subquery appears before the main WHERE.
        params: list[Any] = []
        if since is not None:
            params.append(since)  # s2.submitted_at >= %s (subquery)
        params.append(task_id)     # s1.task_id = %s
        if since is not None:
            params.append(since)  # s1.submitted_at >= %s
        params.append(limit)       # LIMIT %s

        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT s1.student_name,
                       MAX(s1.score)        AS best_score,
                       (SELECT s2.score
                        FROM   scores s2
                        WHERE  {latest_where_sql}
                        ORDER  BY s2.submitted_at DESC
                        LIMIT  1)           AS latest_score,
                       COUNT(*)             AS attempts,
                       MAX(s1.submitted_at) AS last_submitted
                FROM   scores s1
                WHERE  {where_sql}
                GROUP  BY s1.student_name, s1.task_id
                ORDER  BY best_score DESC, last_submitted ASC
                LIMIT  %s
                """,
                params,
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def get_student_history(
    student_name: str,
    task_id: str,
    since: datetime | None = None,
) -> list[dict[str, Any]]:
    """Return all submissions for one student+task, newest first."""
    con = _conn()
    try:
        conditions = ["student_name = %s", "task_id = %s"]
        params: list[Any] = [student_name, task_id]
        if since is not None:
            conditions.append("submitted_at >= %s")
            params.append(since)
        where_sql = " AND ".join(conditions)
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT score, prompt, submitted_at
                FROM   scores
                WHERE  {where_sql}
                ORDER  BY submitted_at DESC
                """,
                params,
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def get_student_best(
    student_name: str,
    task_id: str,
    since: datetime | None = None,
) -> int | None:
    """Return a student's best score for a task, or None if no submissions."""
    con = _conn()
    try:
        conditions = ["student_name = %s", "task_id = %s"]
        params: list[Any] = [student_name, task_id]
        if since is not None:
            conditions.append("submitted_at >= %s")
            params.append(since)
        where_sql = " AND ".join(conditions)
        with con.cursor() as cur:
            cur.execute(
                f"""
                SELECT MAX(score) AS best_score
                FROM   scores
                WHERE  {where_sql}
                """,
                params,
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
    since: datetime | None = None,
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
        if since is not None:
            conditions.append("submitted_at >= %s")
            params.append(since)
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


def get_master_leaderboard(
    task_ids: list[str],
    limit: int = 50,
    since: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Return a master leaderboard where total_points is the sum of each student's
    best score across the selected tasks.

    - One row per student_name.
    - tasks_completed counts how many of the selected tasks have at least one submission.
    """
    if not task_ids:
        return []

    con = _conn()
    try:
        placeholders = ", ".join(["%s"] * len(task_ids))
        params: list[Any] = []

        where_parts = [f"task_id IN ({placeholders})"]
        params.extend(task_ids)
        if since is not None:
            where_parts.append("submitted_at >= %s")
            params.append(since)
        where_sql = " AND ".join(where_parts)

        params.append(limit)

        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                WITH best_per_task AS (
                  SELECT
                    student_name,
                    task_id,
                    MAX(score)        AS best_score,
                    MAX(submitted_at) AS last_submitted
                  FROM scores
                  WHERE {where_sql}
                  GROUP BY student_name, task_id
                )
                SELECT
                  student_name,
                  SUM(best_score)        AS total_points,
                  COUNT(*)               AS tasks_completed,
                  MAX(last_submitted)    AS last_submitted
                FROM best_per_task
                GROUP BY student_name
                ORDER BY total_points DESC, tasks_completed DESC, last_submitted ASC
                LIMIT %s
                """,
                params,
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()
