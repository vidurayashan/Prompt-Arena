import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { SubmitResponse, TaskDetail } from "../api";
import Navbar from "../components/Navbar";
import ScoreDisplay from "../components/ScoreDisplay";

type Stage = "idle" | "submitting" | "done";

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const studentName = localStorage.getItem("studentName") ?? "";

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!taskId) return;
    api
      .getTask(taskId)
      .then(setTask)
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : "Failed to load task")
      );
  }, [taskId]);

  async function handleSubmit() {
    if (!taskId || !prompt.trim()) return;
    setSubmitError("");
    setStage("submitting");
    setResult(null);
    try {
      const res = await api.submitPrompt(taskId, studentName, prompt.trim());
      setResult(res);
      setStage("done");
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed.");
      setStage("idle");
    }
  }

  if (loadError) {
    return (
      <>
        <Navbar />
        <div className="page">
          <div className="error-msg">{loadError}</div>
          <button className="btn btn-ghost" onClick={() => navigate("/tasks")}>
            ← Back to tasks
          </button>
        </div>
      </>
    );
  }

  if (!task) {
    return (
      <>
        <Navbar />
        <div className="page">
          <div className="spinner" />
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-ghost" style={{ padding: ".3rem .7rem", fontSize: ".82rem" }} onClick={() => navigate("/tasks")}>
            ← Tasks
          </button>
          <span className="badge">{task.task_model}</span>
        </div>

        <h1 style={{ marginBottom: ".5rem" }}>{task.name}</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: "1.25rem" }}>{task.description}</p>

        {/* Document download */}
        <div className="card mb-2" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: ".2rem" }}>Reference document</div>
            <div style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>
              {task.document_filename} — download and read this before writing your prompt
            </div>
          </div>
          <a
            href={`/api/tasks/${task.id}/document`}
            download={task.document_filename}
            className="btn btn-outline"
          >
            Download PDF
          </a>
        </div>

        {/* Items to extract */}
        <div className="card mb-2">
          <h2>What to extract</h2>
          <p style={{ color: "var(--text-muted)", fontSize: ".88rem", marginBottom: "1rem" }}>
            Your prompt must instruct the AI to extract all of the following items from the document.
          </p>
          <ul className="items-list">
            {task.items.map((item) => (
              <li key={item.id} className="item-row">
                <span className="item-num">{item.id}</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Prompt editor */}
        <div className="card mb-2">
          <h2>Write your prompt</h2>
          <p style={{ color: "var(--text-muted)", fontSize: ".88rem", marginBottom: "1rem" }}>
            The document text will be automatically attached. Write a prompt that tells the AI what to extract and how to format the output.
          </p>
          <label htmlFor="prompt">Your prompt</label>
          <textarea
            id="prompt"
            className="input"
            rows={8}
            placeholder="e.g. Please extract the following information from the document:&#10;1. Patient full name&#10;2. Date of birth&#10;..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={stage === "submitting"}
          />

          {submitError && <div className="error-msg mt-1">{submitError}</div>}

          <div className="flex gap-2 items-center mt-2" style={{ justifyContent: "space-between" }}>
            <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
              Model: <strong>{task.task_model}</strong>
            </span>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={stage === "submitting" || !prompt.trim()}
            >
              {stage === "submitting" ? "Running…" : "Submit prompt"}
            </button>
          </div>
        </div>

        {/* Results */}
        {stage === "submitting" && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="spinner" style={{ margin: "1rem auto" }} />
            <p style={{ color: "var(--text-muted)" }}>Running your prompt and grading the output…</p>
          </div>
        )}

        {result && stage === "done" && (
          <div ref={resultRef}>
            {/* LLM output */}
            <div className="card mb-2">
              <h2>Model output</h2>
              <div className="output-box">{result.student_output}</div>
            </div>

            {/* Score */}
            <div className="card mb-2">
              <h2 style={{ marginBottom: "1rem" }}>Your score</h2>
              <ScoreDisplay result={result} />
            </div>

            {/* Actions */}
            <div className="flex gap-2" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => { setResult(null); setStage("idle"); }}>
                Try again
              </button>
              <button className="btn btn-outline" onClick={() => navigate(`/tasks/${taskId}/leaderboard`)}>
                View leaderboard
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
