"""
Generate sample PDF documents for the two example tasks in config.yaml.
Run from the project root:  python make_sample_pdfs.py
Requires: pip install reportlab
"""

from pathlib import Path

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    from reportlab.lib.units import cm
except ImportError:
    raise SystemExit("Please install reportlab first:  pip install reportlab")

DOCS_DIR = Path(__file__).parent / "documents"
DOCS_DIR.mkdir(exist_ok=True)

styles = getSampleStyleSheet()


def make_pdf(path: Path, title: str, body_paragraphs: list[str]) -> None:
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    story = [Paragraph(title, styles["Title"]), Spacer(1, 0.5*cm)]
    for para in body_paragraphs:
        story.append(Paragraph(para, styles["BodyText"]))
        story.append(Spacer(1, 0.3*cm))
    doc.build(story)
    print(f"Created: {path}")


# ── Task 1: Medical report ────────────────────────────────────────────────────
make_pdf(
    DOCS_DIR / "sample_medical_report.pdf",
    "PATIENT MEDICAL REPORT — CONFIDENTIAL",
    [
        "<b>Patient Information</b>",
        "Full Name: Emily Carter",
        "Date of Birth: 14 March 1987",
        "Gender: Female",
        "Address: 42 Maple Street, Brunswick VIC 3056",
        "Medicare No: 2345 67890 1",
        "",
        "<b>Clinical Details</b>",
        "Date of Consultation: 3 March 2026",
        "Attending Physician: Dr. James Harrington, MBBS FRACP",
        "Department: Endocrinology, Melbourne General Hospital",
        "",
        "<b>Presenting Complaint</b>",
        "The patient presents with persistent fatigue, increased thirst (polydipsia), and frequent urination (polyuria) over the past three months.",
        "",
        "<b>Diagnosis</b>",
        "Primary Diagnosis: Type 2 Diabetes Mellitus (ICD-10: E11)",
        "HbA1c: 8.4% (elevated)",
        "Fasting Blood Glucose: 9.2 mmol/L",
        "",
        "<b>Treatment Plan</b>",
        "Prescribed Medication: Metformin 500 mg twice daily (with meals)",
        "Lifestyle: Low-GI diet, 30 minutes moderate exercise daily",
        "Follow-up: 6 weeks for repeat HbA1c and renal function panel",
        "",
        "<b>Physician Signature</b>",
        "Dr. James Harrington | 3 March 2026",
    ],
)

# ── Task 2: Research abstract ─────────────────────────────────────────────────
make_pdf(
    DOCS_DIR / "sample_abstract.pdf",
    "RESEARCH PAPER ABSTRACT",
    [
        "<b>Title:</b> Deep Learning for Natural Language Processing: A Survey",
        "",
        "<b>Authors:</b> Sarah Mitchell<sup>1</sup>, Liam Okafor<sup>2</sup>, Priya Nair<sup>1</sup>",
        "<sup>1</sup> School of Computing, La Trobe University, Melbourne, Australia",
        "<sup>2</sup> Department of AI Research, University of Sydney, Sydney, Australia",
        "",
        "<b>Year of Publication:</b> 2023",
        "",
        "<b>Journal:</b> IEEE Transactions on Neural Networks and Learning Systems, Vol. 34, No. 8",
        "",
        "<b>Abstract</b>",
        (
            "This paper presents a comprehensive survey of deep learning techniques applied to "
            "natural language processing (NLP) tasks. The main research objective is to survey "
            "deep learning techniques applied to NLP tasks, covering architectures ranging from "
            "early recurrent neural networks to modern transformer-based models including BERT, "
            "GPT, and their derivatives. We analyse over 350 papers published between 2015 and "
            "2023, evaluate performance across standard benchmarks, and identify open challenges. "
            "Our key finding is that transformer-based models consistently outperform classical "
            "approaches across all NLP benchmarks, while also requiring significantly greater "
            "computational resources. We discuss implications for both research and industry "
            "deployment, and propose directions for future work including efficiency improvements "
            "and multi-lingual generalisation."
        ),
        "",
        "<b>Keywords:</b> deep learning, natural language processing, transformers, BERT, GPT, survey",
        "",
        "<b>DOI:</b> 10.1109/TNNLS.2023.1234567",
    ],
)

print("Done. Place these PDFs are already in the documents/ folder.")
