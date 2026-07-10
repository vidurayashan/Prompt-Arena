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
2. They pick a **published** task, download the reference PDF, and read the extraction items.
3. They write a prompt and click **Submit**.
4. The backend:
   - Runs a **pre-prompt integrity judge** first (blocks answer-dumping with score 0 and a clear warning)
   - Extracts text from the PDF with **pdfplumber**
   - Sends `student prompt + document text` to the **task model**
   - Passes the model's output + correct answers to the **judge model**
   - Scores each item 0–10 and computes a total out of 100
5. The score and per-item breakdown are shown.  The student's best score is saved to the leaderboard.

Both the **pre-prompt judge** and (for Prompt/Chat tasks) the **scoring judge prompt** are editable live in **Admin → Workshop Control**.

## Admin login and live publishing

Lecturers use a **separate Admin login** on the login screen (not the student name/ID form).

Set these environment variables (see `.env.example`):

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password
```

Also set them in Azure App Service application settings for production.

### Publish tasks without editing `config.yaml`

- Task **structure** (IDs, documents, answers, models) still lives in committed `config.yaml` and requires a deploy to change permanently.
- Task **visibility** and **live text overrides** (name, description, instructions, prompt UI copy, judge prompt, judge persona, evaluate_what) are stored in Supabase and edited from the admin **Workshop Control** tab — no commit or redeploy.
- `config.yaml` remains the default until an override is saved. **Reset to config.yaml** clears that task’s overrides.

Create these tables once in the Supabase SQL editor (also in `backend/schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS published_tasks (
  task_id    TEXT PRIMARY KEY,
  published  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_overrides (
  task_id    TEXT PRIMARY KEY,
  overrides  JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

By default, tasks are **unpublished** until an admin publishes them. After admin sign-in:

1. Open **Workshop Control**
2. Click **Publish** on the activities you want students to see
3. Click **Edit** on a task to change judge prompt / description / prompt copy, then **Save overrides**
4. Use **Student Prompts** (admin-only) to review submissions

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

To open or close an existing task during a workshop, or to tweak judge prompts / student-facing copy live, use **Admin login → Workshop Control** instead of editing and redeploying `config.yaml`.
