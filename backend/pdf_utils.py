"""Extract plain text from a PDF file using pdfplumber."""

from pathlib import Path

import pdfplumber

# ~12 000 tokens ≈ 48 000 characters for safety with gpt-4o 128 k context
_MAX_CHARS = 48_000


def extract_text(pdf_path: Path) -> str:
    """Return extracted text from all pages of the PDF, truncated if very long."""
    if not pdf_path.exists():
        raise FileNotFoundError(f"Document not found: {pdf_path}")

    pages: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages.append(text)

    full_text = "\n\n".join(pages).strip()

    if len(full_text) > _MAX_CHARS:
        full_text = full_text[:_MAX_CHARS] + "\n\n[... document truncated ...]"

    return full_text
