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
    """Ensure research score columns exist on scores (safe for existing Supabase tables)."""
    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    "ALTER TABLE scores ADD COLUMN IF NOT EXISTS extraction_score int"
                )
                cur.execute(
                    "ALTER TABLE scores ADD COLUMN IF NOT EXISTS pillars_score int"
                )
    finally:
        con.close()


def upsert_score(
    student_name: str,
    task_id: str,
    score: int,
    prompt: str = "",
    *,
    extraction_score: int | None = None,
    pillars_score: int | None = None,
) -> None:
    """Insert a new score record. The leaderboard query picks the best per student.

    score              – combined / leaderboard total (0–100)
    extraction_score   – Document extraction accuracy alone (0–100), or None
    pillars_score      – Four Pillars alone scaled to 0–100, or None
    """
    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO scores (
                        student_name, task_id, score, prompt,
                        extraction_score, pillars_score
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        student_name,
                        task_id,
                        score,
                        prompt,
                        extraction_score,
                        pillars_score,
                    ),
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

        conditions = ["s1.task_id = %s", "s1.student_name <> 'Admin'"]
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
                SELECT score, extraction_score, pillars_score, prompt, submitted_at
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
                SELECT student_name, task_id, prompt, score,
                       extraction_score, pillars_score, submitted_at
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


def get_published_task_ids() -> set[str]:
    """Return task IDs currently marked published. Missing table rows mean unpublished."""
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute(
                """
                SELECT task_id
                FROM   published_tasks
                WHERE  published = TRUE
                """
            )
            rows = cur.fetchall()
        return {row[0] for row in rows}
    finally:
        con.close()


def get_publish_flags() -> dict[str, bool]:
    """Return task_id -> published for all rows in published_tasks."""
    con = _conn()
    try:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT task_id, published
                FROM   published_tasks
                """
            )
            rows = cur.fetchall()
        return {row["task_id"]: bool(row["published"]) for row in rows}
    finally:
        con.close()


def set_task_published(task_id: str, published: bool) -> None:
    """Upsert the published flag for a task."""
    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO published_tasks (task_id, published, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (task_id) DO UPDATE
                    SET published = EXCLUDED.published,
                        updated_at = NOW()
                    """,
                    (task_id, published),
                )
    finally:
        con.close()


def unpublish_all_tasks() -> int:
    """Set published=false for all rows in published_tasks. Returns rows updated."""
    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    UPDATE published_tasks
                    SET published = FALSE,
                        updated_at = NOW()
                    WHERE published = TRUE
                    """
                )
                return cur.rowcount or 0
    finally:
        con.close()


def get_setting(key: str) -> str | None:
    """Return a workshop_settings value, or None if missing."""
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute(
                """
                SELECT value
                FROM   workshop_settings
                WHERE  key = %s
                """,
                (key,),
            )
            row = cur.fetchone()
        if not row:
            return None
        value = row[0]
        return str(value) if value is not None else None
    finally:
        con.close()


def set_setting(key: str, value: str) -> None:
    """Upsert a workshop_settings key/value."""
    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO workshop_settings (key, value, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value,
                        updated_at = NOW()
                    """,
                    (key, value),
                )
    finally:
        con.close()


def get_task_overrides(task_id: str) -> dict[str, Any]:
    """Return sparse field overrides for one task (empty dict if none)."""
    con = _conn()
    try:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT overrides
                FROM   task_overrides
                WHERE  task_id = %s
                """,
                (task_id,),
            )
            row = cur.fetchone()
        if not row or row.get("overrides") is None:
            return {}
        raw = row["overrides"]
        return dict(raw) if isinstance(raw, dict) else {}
    finally:
        con.close()


def get_all_task_overrides() -> dict[str, dict[str, Any]]:
    """Return task_id -> overrides for all rows in task_overrides."""
    con = _conn()
    try:
        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT task_id, overrides
                FROM   task_overrides
                """
            )
            rows = cur.fetchall()
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            raw = row.get("overrides")
            result[row["task_id"]] = dict(raw) if isinstance(raw, dict) else {}
        return result
    finally:
        con.close()


def set_task_overrides(task_id: str, overrides: dict[str, Any]) -> dict[str, Any]:
    """Replace the full overrides object for a task. Empty dict deletes the row."""
    if not overrides:
        clear_task_overrides(task_id)
        return {}

    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO task_overrides (task_id, overrides, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (task_id) DO UPDATE
                    SET overrides = EXCLUDED.overrides,
                        updated_at = NOW()
                    """,
                    (task_id, psycopg2.extras.Json(overrides)),
                )
        return overrides
    finally:
        con.close()


def clear_task_overrides(task_id: str) -> None:
    """Remove all overrides for a task (fall back to config.yaml)."""
    con = _conn()
    try:
        with con:
            with con.cursor() as cur:
                cur.execute(
                    "DELETE FROM task_overrides WHERE task_id = %s",
                    (task_id,),
                )
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

        where_parts = [f"task_id IN ({placeholders})", "student_name <> 'Admin'"]
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


def get_student_total(
    student_name: str,
    task_ids: list[str],
    since: datetime | None = None,
) -> dict[str, Any]:
    """
    Return one student's sum of best scores across the selected tasks.

    Keys: total_points, tasks_completed.
    """
    if not task_ids:
        return {"total_points": 0, "tasks_completed": 0}

    con = _conn()
    try:
        placeholders = ", ".join(["%s"] * len(task_ids))
        params: list[Any] = [student_name]
        params.extend(task_ids)

        where_parts = [
            "student_name = %s",
            f"task_id IN ({placeholders})",
        ]
        if since is not None:
            where_parts.append("submitted_at >= %s")
            params.append(since)
        where_sql = " AND ".join(where_parts)

        with con.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                WITH best_per_task AS (
                  SELECT
                    task_id,
                    MAX(score) AS best_score
                  FROM scores
                  WHERE {where_sql}
                  GROUP BY task_id
                )
                SELECT
                  COALESCE(SUM(best_score), 0) AS total_points,
                  COUNT(*)                     AS tasks_completed
                FROM best_per_task
                """,
                params,
            )
            row = cur.fetchone()
        if not row:
            return {"total_points": 0, "tasks_completed": 0}
        return {
            "total_points": int(row["total_points"] or 0),
            "tasks_completed": int(row["tasks_completed"] or 0),
        }
    finally:
        con.close()
