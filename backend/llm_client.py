"""OpenAI calls: task LLM and judge LLM."""

import json
import re
from typing import Any

from openai import OpenAI


def _client(api_key: str, base_url: str | None = None) -> OpenAI:
    kwargs: dict[str, Any] = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


# ---------------------------------------------------------------------------
# Task LLM: run the student's prompt with the document text
# ---------------------------------------------------------------------------

def run_task_prompt(
    api_key: str,
    model: str,
    student_prompt: str,
    document_text: str,
    base_url: str | None = None,
) -> str:
    """Send the student's prompt plus the document text to the task model.

    The document is injected as a system-level context block so the student's
    prompt acts as the user instruction.
    """
    client = _client(api_key, base_url)

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
    )
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# Judge LLM: score the student's output against correct answers
# ---------------------------------------------------------------------------

_JUDGE_SYSTEM_GENEROUS = """\
You are a generous but accurate grading assistant. You will be given:
1. A list of information items that a student was asked to extract from a document.
2. The correct answer for each item.
3. The student's AI-generated output that should contain the extracted information.

Your grading philosophy is: reward correct knowledge, not perfect wording. If the
student's answer conveys the right core information, give full marks regardless of
how it is phrased, formatted, or ordered.

--------------------------------------------------------------------
MANDATORY ZERO RULES  (any single violation → score is 0 for that item)
--------------------------------------------------------------------
  Z0. NOT PRESENT: If the student's output does not mention the item
      at all — i.e. "found" would be "not found" — score must be 0.
      Do NOT award marks for information the student did not extract.

  Z1. WRONG FACTS OR FIGURES: Any numeric value (percentage, dollar
      amount, duration, quantity, limit) or factual claim in the
      student's answer that does NOT match the correct answer → score 0.
      Example: correct is "50% of cost", student says "60% of cost" → 0.

  Z2. MISSING CRITICAL IDENTIFIERS: If the correct answer contains
      specific identifiers — brand name, model name, serial number,
      product code — and the student's answer omits or replaces them
      with a generic description → score 0.
      Example: correct is "Apple MacBook Pro 16-inch M3 Max; S/N C02ZQ1NDMD6T",
      student says "laptop computer" → 0.

--------------------------------------------------------------------
FULL-MARKS LENIENCY  (award 10 whenever none of the zero rules apply)
--------------------------------------------------------------------
The following differences must NEVER reduce the score below 10:
  - Different phrasing, synonyms, or word order
  - Different capitalisation, punctuation, abbreviations, or date format
  - Missing minor contextual qualifiers (e.g. "Up to", "per year",
    "waiting period") when all numeric figures match
  - Extra relevant information provided beyond what was required
  - Partial vs full formal name (if the core identifier is present)

--------------------------------------------------------------------
SCORING RUBRIC (only used when zero rules are NOT triggered)
--------------------------------------------------------------------
  10  — Correct core information is present (apply leniency above freely).
  5-9 — Core topic identified but a genuinely significant supporting
        fact is missing or unclear (use sparingly — default to 10).
  0   — Zero rule triggered (wrong fact, absent, or missing identifier).

--------------------------------------------------------------------
COVERAGE REQUIREMENT — THIS IS MANDATORY
--------------------------------------------------------------------
You MUST output a score entry for EVERY item in the list, in order.
Do NOT skip, group, merge, or omit any item for any reason.
If you receive N items, your "scores" array must contain exactly N
entries. Items not found in the student output still require an entry
with score 0 and found "not found". Incomplete responses are invalid.

Respond with ONLY a JSON object in the following format (no markdown
fences, no extra text):
{
  "scores": [
    {"item_id": <int>, "score": <int 0-10>, "found": "<exact value from student output, or 'not found'>", "reason": "<one sentence>"},
    ...
  ],
  "total": <int 0-100>
}

The "found" field must contain the verbatim value the student's output
provided for that item. If not mentioned at all, use "not found".

The "total" field must equal: round(sum(scores) / (10 * number_of_items) * 100).
"""

_JUDGE_SYSTEM = """\
You are an impartial grading assistant. You will be given:
1. A list of information items that a student was asked to extract from a document.
2. The correct answer for each item.
3. The student's AI-generated output that should contain the extracted information.

Score each item out of 10 using the rubric and the MANDATORY rules below.

--------------------------------------------------------------------
SCORING RUBRIC
--------------------------------------------------------------------
  10  — Fully correct. All required facts and identifiers are present
        and accurate.
  7-9 — Mostly correct. The core data is right but genuinely minor
        details are missing or slightly off.
  4-6 — Partially correct. The right topic is identified but a
        significant fact is wrong, missing, or ambiguous.
  1-3 — Minimal match. Only a vague keyword or hint is present.
  0   — Not present, completely wrong, not attempted, or violates a
        MANDATORY ZERO rule below.

--------------------------------------------------------------------
MANDATORY ZERO RULES  (any single violation → score is 0 for that item)
--------------------------------------------------------------------
  Z0. NOT PRESENT: If the student's output does not mention the item
      at all — i.e. "found" would be "not found" — score must be 0.
      Leniency rules NEVER apply to absent answers. Do NOT award marks
      for information the student did not extract.

  Z1. WRONG FIGURES: Any numeric value (percentage, dollar amount,
      duration, quantity, limit) in the student's answer that does
      NOT exactly match the correct answer → score 0.
      Example: correct is "50% of cost", student says "60% of cost" → 0.

  Z2. MISSING SPECIFIC IDENTIFIERS: If the correct answer contains
      specific identifiers — brand name, model name, model number,
      serial number, product code — and the student's answer omits
      or replaces them with a generic description → score 0.
      Example: correct is "Apple MacBook Pro 16-inch M3 Max; S/N C02ZQ1NDMD6T",
      student says "laptop computer" → 0.

--------------------------------------------------------------------
LENIENCY RULES  (do NOT deduct marks for these)
--------------------------------------------------------------------
  L1. EXTRA QUALIFIERS: If all numeric figures match and the correct
      answer contains additional contextual qualifiers (e.g. "Up to",
      "per year", "per person", "waiting period") that are absent from
      the student's answer, award full marks — the key data is present.
      Example: correct "Up to $300 per person per year", student "$300
      per person" → 10 (figures match, qualifier omission is forgiven).

  L2. EXTRA RELEVANT DATA: If the student's answer includes additional
      relevant information beyond what is required, do not penalise.

  L3. MINOR LANGUAGE: Differences in capitalisation, punctuation,
      word order, abbreviations, or date format must NOT reduce the score.

--------------------------------------------------------------------
Apply all MANDATORY ZERO rules first. If none are triggered, apply the
scoring rubric. Apply LENIENCY rules throughout.

--------------------------------------------------------------------
COVERAGE REQUIREMENT — THIS IS MANDATORY
--------------------------------------------------------------------
You MUST output a score entry for EVERY item in the list, in order.
Do NOT skip, group, merge, or omit any item for any reason.
If you receive N items, your "scores" array must contain exactly N
entries. Items not found in the student output still require an entry
with score 0 and found "not found". Incomplete responses are invalid.

Respond with ONLY a JSON object in the following format (no markdown
fences, no extra text):
{
  "scores": [
    {"item_id": <int>, "score": <int 0-10>, "found": "<exact value from student output, or 'not found'>", "reason": "<one sentence>"},
    ...
  ],
  "total": <int 0-100>
}

The "found" field must contain the verbatim value the student's output
provided for that item. If not mentioned at all, use "not found".

The "total" field must equal: round(sum(scores) / (10 * number_of_items) * 100).
"""


def run_judge(
    api_key: str,
    judge_model: str,
    items: list[dict[str, Any]],
    correct_answers: list[str],
    student_output: str,
    base_url: str | None = None,
    persona: str = "strict",
) -> dict[str, Any]:
    """Return a scoring dict with per-item scores and a total 0-100.

    persona: "strict" (default) uses the detailed partial-credit rubric;
             "generous" awards full marks for correct core info regardless of phrasing.
    """
    client = _client(api_key, base_url)

    system_prompt = _JUDGE_SYSTEM_GENEROUS if persona == "generous" else _JUDGE_SYSTEM

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
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
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
                {"item_id": item["id"], "score": 0, "found": "", "reason": "Parsing error"}
                for item in items
            ],
            "total": 0,
        }

    return result
