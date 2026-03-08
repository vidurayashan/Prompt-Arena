import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { LeaderboardEntry, SubmissionAttempt, SubmitResponse, TaskDetail } from "../api";
import Navbar from "../components/Navbar";
import ScoreDisplay from "../components/ScoreDisplay";

type Stage = "idle" | "submitting" | "done";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso + "Z").getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

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

  const [history, setHistory] = useState<SubmissionAttempt[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [expandedAttempts, setExpandedAttempts] = useState<Set<number>>(new Set());

  function toggleAttempt(idx: number) {
    setExpandedAttempts((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const refreshSideData = useCallback(() => {
    if (!taskId) return;
    api.getHistory(taskId, studentName).then(setHistory).catch(() => {});
    api.getLeaderboard(taskId).then(setLeaderboard).catch(() => {});
  }, [taskId, studentName]);

  useEffect(() => {
    if (!taskId) return;
    api
      .getTask(taskId)
      .then(setTask)
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : "Failed to load task")
      );
    refreshSideData();
  }, [taskId, refreshSideData]);

  async function handleSubmit() {
    if (!taskId || !prompt.trim()) return;
    setSubmitError("");
    setStage("submitting");
    setResult(null);
    try {
      const res = await api.submitPrompt(taskId, studentName, prompt.trim());
      setResult(res);
      setStage("done");
      refreshSideData();
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

  const bestScore = history.length > 0 ? Math.max(...history.map((h) => h.score)) : null;

  return (
    <>
      <Navbar />
      <div className="page">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2" style={{ flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            style={{ padding: ".3rem .7rem", fontSize: ".82rem" }}
            onClick={() => navigate("/tasks")}
          >
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
            placeholder={"e.g. Please extract the following information from the document:\n1. Patient full name\n2. Date of birth\n..."}
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

        {/* Submitting spinner */}
        {stage === "submitting" && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="spinner" style={{ margin: "1rem auto" }} />
            <p style={{ color: "var(--text-muted)" }}>Running your prompt and grading the output…</p>
          </div>
        )}

        {/* Results */}
        {result && stage === "done" && (
          <div ref={resultRef}>
            <div className="card mb-2">
              <h2>Model output</h2>
              <div className="output-box">{result.student_output}</div>
            </div>

            <div className="card mb-2">
              <h2 style={{ marginBottom: "1rem" }}>Your score</h2>
              <ScoreDisplay result={result} />
            </div>

            <div className="flex gap-2 mb-2" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => { setResult(null); setStage("idle"); }}>
                Try again
              </button>
            </div>
          </div>
        )}

        {/* ── My Attempts ──────────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="card mb-2">
            <div className="flex items-center justify-between mb-1">
              <h2 style={{ margin: 0 }}>My attempts</h2>
              {bestScore !== null && (
                <span style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>
                  Personal best: <strong style={{ color: scoreColor(bestScore) }}>{bestScore}/100</strong>
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginTop: ".75rem" }}>
              {history.map((attempt, idx) => {
                const attemptNum = history.length - idx;
                const isBest = attempt.score === bestScore;
                const isExpanded = expandedAttempts.has(idx);
                return (
                  <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: ".75rem",
                        padding: ".5rem .85rem",
                        borderRadius: isExpanded ? "6px 6px 0 0" : "6px",
                        background: isBest ? "var(--success-bg)" : "var(--bg)",
                        border: isBest ? "1px solid #bbf7d0" : "1px solid var(--border)",
                        fontSize: ".88rem",
                      }}
                    >
                      <span style={{ color: "var(--text-muted)", width: "72px", flexShrink: 0 }}>
                        Attempt {attemptNum}
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "1rem",
                          color: scoreColor(attempt.score),
                          width: "58px",
                        }}
                      >
                        {attempt.score}<span style={{ fontWeight: 400, fontSize: ".8rem", color: "var(--text-muted)" }}>/100</span>
                      </span>
                      {isBest && (
                        <span style={{ fontSize: ".75rem", color: "var(--success)", fontWeight: 600 }}>
                          best
                        </span>
                      )}
                      <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: ".8rem" }}>
                        {timeAgo(attempt.submitted_at)}
                      </span>
                      {attempt.prompt && (
                        <button
                          onClick={() => toggleAttempt(idx)}
                          style={{
                            marginLeft: ".5rem",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                            fontSize: ".8rem",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            flexShrink: 0,
                          }}
                          title={isExpanded ? "Hide prompt" : "Show prompt"}
                        >
                          {isExpanded ? "▲ hide" : "▼ prompt"}
                        </button>
                      )}
                    </div>
                    {isExpanded && attempt.prompt && (
                      <pre
                        style={{
                          margin: 0,
                          padding: ".75rem 1rem",
                          background: "var(--bg-subtle, #f8f9fa)",
                          border: isBest ? "1px solid #bbf7d0" : "1px solid var(--border)",
                          borderTop: "none",
                          borderRadius: "0 0 6px 6px",
                          fontSize: ".82rem",
                          fontFamily: "monospace",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          color: "var(--text)",
                          overflowX: "auto",
                        }}
                      >
                        {attempt.prompt}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Mini Leaderboard ──────────────────────────────────────────────── */}
        {leaderboard.length > 0 && (
          <div className="card mb-2" style={{ padding: 0, overflow: "hidden" }}>
            <div
              className="flex items-center justify-between"
              style={{ padding: "1rem 1.25rem .75rem", borderBottom: "1px solid var(--border)" }}
            >
              <h2 style={{ margin: 0 }}>Leaderboard</h2>
              <button
                className="btn btn-ghost"
                style={{ fontSize: ".8rem", padding: ".3rem .7rem" }}
                onClick={() => navigate(`/tasks/${taskId}/leaderboard`)}
              >
                Full leaderboard →
              </button>
            </div>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th style={{ width: "52px" }}>Rank</th>
                  <th>Name</th>
                  <th style={{ width: "100px" }}>Best</th>
                  <th style={{ width: "100px" }}>Latest</th>
                  <th style={{ width: "80px" }}>Tries</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.slice(0, 10).map((entry, idx) => {
                  const isMe = entry.student_name === studentName;
                  return (
                    <tr
                      key={entry.student_name}
                      style={isMe ? { background: "var(--primary-light)", fontWeight: 600 } : undefined}
                    >
                      <td style={{ fontSize: ".9rem" }}>{medal(idx + 1)}</td>
                      <td>
                        {entry.student_name}
                        {isMe && (
                          <span style={{ marginLeft: ".4rem", fontSize: ".73rem", color: "var(--primary)", fontWeight: 600 }}>
                            (you)
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: scoreColor(entry.best_score) }}>
                          {entry.best_score}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: ".78rem" }}>/100</span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: scoreColor(entry.latest_score) }}>
                          {entry.latest_score}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: ".78rem" }}>/100</span>
                        {entry.latest_score < entry.best_score && (
                          <span style={{ color: "var(--danger)", fontSize: ".75rem", marginLeft: ".25rem" }}>↓</span>
                        )}
                        {entry.latest_score === entry.best_score && entry.attempts > 1 && (
                          <span style={{ color: "var(--success)", fontSize: ".75rem", marginLeft: ".25rem" }}>↑</span>
                        )}
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: ".85rem" }}>{entry.attempts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
