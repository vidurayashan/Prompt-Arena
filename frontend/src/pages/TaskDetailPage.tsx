import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { ChatMessage, LeaderboardEntry, SubmissionAttempt, SubmitResponse, TaskDetail } from "../api";
import Navbar, { SCORE_UPDATED_EVENT } from "../components/Navbar";
import ScoreDisplay from "../components/ScoreDisplay";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  const [itemsCollapsed, setItemsCollapsed] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

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
      if (res.is_new_best && taskId) {
        try {
          const stored = JSON.parse(localStorage.getItem("taskBests") || "{}") as Record<string, number>;
          stored[taskId] = res.total;
          localStorage.setItem("taskBests", JSON.stringify(stored));
        } catch { /* ignore */ }
      }
      window.dispatchEvent(new Event(SCORE_UPDATED_EVENT));
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
  const isDocumentTask = task.task_type === "Document";
  const isPromptTask = task.task_type === "Prompt";
  const isChatTask = task.task_type === "Chat";

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
          <span
            className="badge"
            style={{
              background: task.judge_persona === "generous" ? "var(--success-bg, #f0fdf4)" : "var(--bg-subtle, #f1f5f9)",
              color: task.judge_persona === "generous" ? "var(--success)" : "var(--text-muted)",
              border: task.judge_persona === "generous" ? "1px solid #bbf7d0" : "1px solid var(--border)",
            }}
          >
            Judge: {task.judge_persona === "generous" ? "Generous" : "Strict"}
          </span>
        </div>

        <h1 style={{ marginBottom: ".5rem" }}>{task.name}</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: ".5rem" }}>{task.description}</p>
        {isPromptTask && task.prompt_intro && task.prompt_intro.trim().length > 0 && (
          <p style={{ color: "var(--text-muted)", marginBottom: "1.25rem", fontSize: ".85rem" }}>
            {task.prompt_intro}
          </p>
        )}
        {isChatTask && (
          <p style={{ color: "var(--text-muted)", marginBottom: "1.25rem", fontSize: ".85rem" }}>
            This is a <strong>Chat</strong> task. Build a substantive multi-turn conversation — the whole
            transcript is scored together. One short message will not score well. When you press{" "}
            <strong>Score this chat</strong>, you get feedback and the chat clears so your next attempt
            starts with no history.
          </p>
        )}

        {task.instructions && task.instructions.length > 0 && (
          <div className="card mb-2">
            <h2 style={{ margin: 0, marginBottom: ".75rem" }}>What to do</h2>
            <div className="act-tasks" style={{ marginBottom: 0 }}>
              {task.instructions.map((step, i) => (
                <div key={i} className="act-task">
                  <span className="task-num">{i + 1}</span>
                  <span>
                    <span className="task-verb">{step.verb}</span> {step.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {task.four_pillars_guidance && (
          <div className="card mb-2 four-pillars-guidance">
            <h2 style={{ margin: 0, marginBottom: ".5rem", color: "var(--blue)" }}>
              Four Pillars of Effective Prompting
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: ".88rem",
                margin: 0,
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
              }}
            >
              {task.four_pillars_guidance}
            </p>
          </div>
        )}

        {/* Document download (Document tasks only) */}
        {isDocumentTask && task.document_filename && (
          <div className="card mb-2" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: ".2rem" }}>Sample document</div>
              <div style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>
                {task.document_filename} — have a look at this sample document before writing your prompt
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
        )}

        {/* Items to extract (Document tasks only) */}
        {isDocumentTask && task.items && (
          <div className="card mb-2">
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}
              onClick={() => setItemsCollapsed((c) => !c)}
            >
              <h2 style={{ margin: 0 }}>What to extract</h2>
              <span style={{ color: "var(--text-muted)", fontSize: ".85rem" }}>
                {itemsCollapsed ? "▶ show" : "▼ hide"}
              </span>
            </div>
            {!itemsCollapsed && (
              <>
                <p style={{ color: "var(--text-muted)", fontSize: ".88rem", marginBottom: "1rem", marginTop: ".75rem" }}>
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
              </>
            )}
          </div>
        )}

        {/* Prompt editor or Chat interface */}
        {!isChatTask && (
          <div className="card mb-2">
            <h2>{task.prompt_panel_title ?? "Write your prompt"}</h2>
            <p style={{ color: "var(--text-muted)", fontSize: ".88rem", marginBottom: "1rem", whiteSpace: "pre-wrap" }}>
              {task.prompt_panel_body ??
                (task.four_pillars_guidance
                  ? "The document text will be automatically attached. Write a prompt that tells the AI what to extract and how to format the output. Use the Four Pillars (Clarity, Context, Precision, Persona) so your prompt scores well."
                  : "The document text will be automatically attached. Write a prompt that tells the AI what to extract and how to format the output.")}
            </p>
            <label htmlFor="prompt">Your prompt</label>
            <textarea
              id="prompt"
              className="input"
              rows={8}
              placeholder={
                task.prompt_placeholder ??
                "e.g. Please extract the following information from the document:\n1. Patient full name\n2. Date of birth\n..."
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={stage === "submitting"}
            />

            {submitError && <div className="error-msg mt-1">{submitError}</div>}

            <div className="flex gap-2 items-center mt-2" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
                Model: <strong>{task.task_model}</strong>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                Judge: <strong>{task.judge_persona === "generous" ? "Generous" : "Strict"}</strong>
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
        )}

        {isChatTask && (
          <div className="card mb-2">
            <h2>Chat</h2>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "0.75rem",
                marginBottom: "0.75rem",
                maxHeight: "260px",
                overflowY: "auto",
                background: "var(--bg-subtle, #f8f9fa)",
              }}
            >
              {chatHistory.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: ".85rem" }}>
                  Start the conversation by sending your first message.
                </div>
              )}
              {chatHistory.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: m.role === "student" ? "flex-end" : "flex-start",
                    marginBottom: "0.35rem",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "80%",
                      padding: "0.4rem 0.6rem",
                      borderRadius: "8px",
                      background: m.role === "student" ? "var(--primary-light)" : "white",
                      border: "1px solid var(--border)",
                      fontSize: ".9rem",
                    }}
                  >
                    <div
                      style={{
                        fontSize: ".7rem",
                        textTransform: "uppercase",
                        letterSpacing: ".03em",
                        color: "var(--text-muted)",
                        marginBottom: "0.1rem",
                      }}
                    >
                      {m.role === "student" ? "You" : "AI"}
                    </div>
                    <div className="chat-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <label htmlFor="chat-input">Your message</label>
            <textarea
              id="chat-input"
              className="input"
              rows={3}
              placeholder="Type your next question or instruction…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={chatSending}
            />
            {submitError && <div className="error-msg mt-1">{submitError}</div>}
            <div className="flex gap-2 items-center mt-2" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: ".8rem", color: "var(--text-muted)" }}>
                Model: <strong>{task.task_model}</strong>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                Judge: <strong>{task.judge_persona === "generous" ? "Generous" : "Strict"}</strong>
              </span>
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setChatHistory([])}
                  disabled={chatSending || chatHistory.length === 0}
                >
                  Clear chat
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={async () => {
                    if (!taskId || !chatInput.trim()) return;
                    setSubmitError("");
                    const message = chatInput.trim();
                    setChatInput("");
                    const nextHistory: ChatMessage[] = [
                      ...chatHistory,
                      { role: "student", content: message },
                    ];
                    setChatHistory(nextHistory);
                    setChatSending(true);
                    try {
                      const res = await api.chatSendMessage(taskId, studentName, message, nextHistory);
                      setChatHistory((prev) => [
                        ...prev,
                        { role: "assistant", content: res.assistant_message },
                      ]);
                    } catch (err: unknown) {
                      setSubmitError(err instanceof Error ? err.message : "Chat failed.");
                    } finally {
                      setChatSending(false);
                    }
                  }}
                  disabled={chatSending || !chatInput.trim()}
                >
                  {chatSending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
            <div style={{ marginTop: "0.75rem", textAlign: "right" }}>
              <button
                className="btn btn-outline"
                type="button"
                onClick={async () => {
                  if (!taskId || chatHistory.length === 0) return;
                  setSubmitError("");
                  setStage("submitting");
                  setResult(null);
                  try {
                    const res = await api.chatScore(taskId, studentName, chatHistory);
                    setResult(res);
                    setStage("done");
                    setChatHistory([]);
                    setChatInput("");
                    if (res.is_new_best && taskId) {
                      try {
                        const stored = JSON.parse(localStorage.getItem("taskBests") || "{}") as Record<string, number>;
                        stored[taskId] = res.total;
                        localStorage.setItem("taskBests", JSON.stringify(stored));
                      } catch {
                        // ignore
                      }
                    }
                    window.dispatchEvent(new Event(SCORE_UPDATED_EVENT));
                    refreshSideData();
                    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
                  } catch (err: unknown) {
                    setSubmitError(err instanceof Error ? err.message : "Scoring failed.");
                    setStage("idle");
                  }
                }}
                disabled={stage === "submitting" || chatHistory.length === 0}
              >
                {stage === "submitting" ? "Scoring chat…" : "Score this chat"}
              </button>
            </div>
          </div>
        )}

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
            {result.prompt_rejected && (
              <div
                className="card mb-2"
                style={{
                  border: "1px solid var(--red-b, #f5c2cb)",
                  background: "var(--red-l, #fde8ec)",
                }}
              >
                <h2 style={{ marginBottom: "0.5rem", color: "var(--red, #c8102e)" }}>
                  Prompt not accepted
                </h2>
                <p style={{ margin: 0, lineHeight: 1.55 }}>
                  {result.judge_feedback ||
                    "The purpose of this task is to extract information from the document using your prompt, not to include the answers in the prompt itself."}
                </p>
              </div>
            )}

            {!result.prompt_rejected && result.student_output && (
              <div className="card mb-2">
                <h2>Model output</h2>
                <div className="output-box">{result.student_output}</div>
              </div>
            )}

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
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(attempt.prompt);
                            setCopiedIdx(idx);
                            setTimeout(() => setCopiedIdx(null), 1500);
                          }}
                          style={{
                            position: "absolute",
                            top: ".4rem",
                            right: ".5rem",
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: ".75rem",
                            padding: "2px 8px",
                            color: copiedIdx === idx ? "var(--success)" : "var(--text-muted)",
                            fontWeight: copiedIdx === idx ? 600 : 400,
                            zIndex: 1,
                          }}
                        >
                          {copiedIdx === idx ? "Copied!" : "Copy"}
                        </button>
                        <pre
                          style={{
                            margin: 0,
                            padding: "2rem 1rem .75rem",
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
                      </div>
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
