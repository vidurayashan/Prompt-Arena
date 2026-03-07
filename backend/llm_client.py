"""OpenAI calls: task LLM and judge LLM."""

import json
import re
from typing import Any

from openai import OpenAI


def _client(api_key: str) -> OpenAI:
    return OpenAI(api_key=api_key)


# ---------------------------------------------------------------------------
# Task LLM: run the student's prompt with the document text
# ---------------------------------------------------------------------------

def run_task_prompt(
    api_key: str,
    model: str,
    student_prompt: str,
    document_text: str,
) -> str:
    """Send the student's prompt plus the document text to the task model.

    The document is injected as a system-level context block so the student's
    prompt acts as the user instruction.
    """
    client = _client(api_key)

    system_msg = (
        "You are a helpful assistant. The user will give you a prompt to extract "
        "specific information from the document provided below.\n\n"
        "=== DOCUMENT START ===\n"
        f"{document_text}\n"
        "=== DOCUMENT END ===\n\n"
        "Answer exactly as instructed by the user's prompt."
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": student_prompt},
        ],
        temperature=0,
    )
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# Judge LLM: score the student's output against correct answers
# ---------------------------------------------------------------------------

_JUDGE_SYSTEM = """\
You are an impartial grading assistant. You will be given:
1. A list of information items that a student was asked to extract from a document.
2. The correct answer for each item.
3. The student's AI-generated output that should contain the extracted information.

Your job is to assess how accurately and completely each item is represented in \
the student's output. Be lenient with minor formatting differences (e.g. date \
formats, capitalisation), but strict about factual correctness.

Respond with ONLY a JSON object in the following format (no markdown fences, \
no extra text):
{
  "scores": [
    {"item_id": <int>, "score": <int 0-10>, "reason": "<brief reason>"},
    ...
  ],
  "total": <int 0-100>
}

The "total" field must be the weighted average of all item scores scaled to \
0-100 (i.e. sum of scores / (10 * number_of_items) * 100, rounded to the \
nearest integer).
"""


def run_judge(
    api_key: str,
    judge_model: str,
    items: list[dict[str, Any]],
    correct_answers: list[str],
    student_output: str,
) -> dict[str, Any]:
    """Return a scoring dict with per-item scores and a total 0-100."""
    client = _client(api_key)

    items_text = "\n".join(
        f"  Item {item['id']}: {item['label']}  |  Correct answer: {answer}"
        for item, answer in zip(items, correct_answers)
    )

    user_msg = (
        f"ITEMS AND CORRECT ANSWERS:\n{items_text}\n\n"
        f"STUDENT OUTPUT:\n{student_output}"
    )

    response = client.chat.completions.create(
        model=judge_model,
        messages=[
            {"role": "system", "content": _JUDGE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )

    raw = response.choices[0].message.content or "{}"

    # Strip markdown fences if model wrapped JSON anyway
    raw = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("```").strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: return zero score with an error note
        result = {
            "scores": [
                {"item_id": item["id"], "score": 0, "reason": "Parsing error"}
                for item in items
            ],
            "total": 0,
        }

    return result
