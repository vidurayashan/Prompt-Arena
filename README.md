# Prompt Arena

A classroom web app where students practise prompt engineering by extracting information from documents using AI.

## Quick start

### 1. Prerequisites

- Python 3.10+
- Node.js 18+
- An OpenAI API key

### 2. Configure

Edit **`config.yaml`** in the project root:

```yaml
openai_api_key: "sk-..."   # paste your key here (or use the env var below)
task_model:  "gpt-4o"      # model students use for extraction
judge_model: "gpt-4o"      # model used to grade outputs
```

Alternatively, set the environment variable `OPENAI_API_KEY` and leave the key blank in config.yaml.

### 3. Add documents

Place your PDF files in the **`documents/`** folder and reference them in `config.yaml`:

```yaml
tasks:
  - id: task1
    name: "Task 1: My Document"
    document: "documents/my_document.pdf"
    items:
      - id: 1
        label: "Author name"
        answer: "Jane Doe"
```

Run `python make_sample_pdfs.py` to generate placeholder PDFs for the two example tasks.

### 4. Start the backend

```powershell
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 5. Start the frontend (separate terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## How it works

1. Students enter a temporary name (no password).
2. They pick a task, download the reference PDF, and read the extraction items.
3. They write a prompt and click **Submit**.
4. The backend:
   - Extracts text from the PDF with **pdfplumber**
   - Sends `student prompt + document text` to the **task model**
   - Passes the model's output + correct answers to the **judge model**
   - Scores each item 0–10 and computes a total out of 100
5. The score and per-item breakdown are shown.  The student's best score is saved to the leaderboard.

## File structure

```
Prompt Arena/
├── config.yaml          ← tasks, answers, model config (edit this)
├── documents/           ← put PDF files here
├── backend/
│   ├── main.py          ← FastAPI app
│   ├── config_loader.py
│   ├── pdf_utils.py
│   ├── llm_client.py
│   ├── leaderboard.py
│   ├── leaderboard.db   ← auto-created SQLite database
│   └── requirements.txt
└── frontend/
    └── src/
        ├── pages/       ← Login, TaskList, TaskDetail, Leaderboard
        └── components/  ← Navbar, ScoreDisplay
```

## Adding or editing tasks

All task configuration is in **`config.yaml`**. Answers are stored there and never sent to the frontend. Restart the backend after editing the file (`uvicorn` in `--reload` mode does this automatically).
