"""Loads and validates config.yaml from the project root."""

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

# Project root is one level above this file (backend/)
PROJECT_ROOT = Path(__file__).parent.parent

# Load .env from the project root so OPENAI_API_KEY is available via os.environ
load_dotenv(PROJECT_ROOT / ".env")


def _load_raw() -> dict[str, Any]:
    config_path = PROJECT_ROOT / "config.yaml"
    if not config_path.exists():
        raise FileNotFoundError(f"config.yaml not found at {config_path}")
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_config() -> dict[str, Any]:
    """Return the full parsed config, resolving the API key from env if not set."""
    cfg = _load_raw()
    api_key = cfg.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
    cfg["openai_api_key"] = api_key
    return cfg


def get_task(task_id: str) -> dict[str, Any] | None:
    cfg = get_config()
    for task in cfg.get("tasks", []):
        if task["id"] == task_id:
            return task
    return None


def get_document_path(task: dict[str, Any]) -> Path:
    """Return absolute path to the task's PDF document."""
    return PROJECT_ROOT / task["document"]
