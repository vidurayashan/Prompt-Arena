-- Prompt Arena – Supabase schema helpers
-- Run in the Supabase SQL editor if the table does not already exist.

-- Scores table is managed separately in Supabase (see leaderboard.py).

CREATE TABLE IF NOT EXISTS published_tasks (
  task_id    TEXT PRIMARY KEY,
  published  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE published_tasks IS
  'Runtime workshop visibility: which config.yaml tasks are open to students.';

CREATE TABLE IF NOT EXISTS task_overrides (
  task_id    TEXT PRIMARY KEY,
  overrides  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE task_overrides IS
  'Sparse live overrides for task text fields (judge_prompt, description, etc.) on top of config.yaml.';
