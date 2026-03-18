import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { LiveUser, MasterLeaderboardEntry, StudentPromptEntry, Task } from "../api";
import Navbar from "../components/Navbar";

type Tab = "activities" | "leaderboard" | "prompts" | "users";

const HERO_PILLS = [
  "Document extraction",
  "Prompt engineering",
  "AI scoring",
  "Leaderboard ranking",
  "Structured output",
  "Iterative prompting",
];

const BADGE_COLORS = ["b-red", "b-purple", "b-teal", "b-amber", "b-blue", "b-green", "b-purple"];

const DEFAULT_ACTIVITY_STEPS = [
  { verb: "Download", text: "the reference document and read it carefully." },
  { verb: "Write", text: "a prompt that instructs the AI to extract the required information." },
  { verb: "Submit", text: "and see how you score on the live leaderboard." },
];

function formatPromptTime(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return { date, time };
  } catch {
    return { date: "—", time: "" };
  }
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function TaskListPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("activities");
  const [masterLb, setMasterLb] = useState<MasterLeaderboardEntry[]>([]);
  const [masterLbLoading, setMasterLbLoading] = useState(false);
  const [masterLbError, setMasterLbError] = useState("");
  const [prompts, setPrompts] = useState<StudentPromptEntry[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsError, setPromptsError] = useState("");
  const [promptTaskId, setPromptTaskId] = useState<string>("");
  const [promptStudentFilter, setPromptStudentFilter] = useState("");
  const [promptSortBy, setPromptSortBy] = useState<"latest" | "score">("latest");
  const [promptExpandedKeys, setPromptExpandedKeys] = useState<Set<string>>(new Set());
  const [liveUsers, setLiveUsers] = useState<LiveUser[]>([]);
  const [liveUsersError, setLiveUsersError] = useState("");
  const navigate = useNavigate();

  function togglePromptExpanded(key: string) {
    setPromptExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const studentName = localStorage.getItem("studentName") ?? "";

  useEffect(() => {
    api
      .listTasks()
      .then(setTasks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load tasks"))
      .finally(() => setLoading(false));
  }, []);

  // Live users: heartbeat + polling while on the Live Users tab
  useEffect(() => {
    if (!studentName) return;
    let heartbeatId: number | undefined;
    let pollId: number | undefined;
    let stopped = false;

    async function heartbeat() {
      try {
        await api.presencePing(studentName);
      } catch {
        // ignore heartbeat errors; presence is best-effort
      }
    }

    async function fetchLive() {
      try {
        const users = await api.getLiveUsers(300);
        if (!stopped) {
          setLiveUsers(users);
          setLiveUsersError("");
        }
      } catch (err) {
        if (!stopped) {
          setLiveUsersError(err instanceof Error ? err.message : "Failed to load live users");
        }
      }
    }

    if (activeTab === "users") {
      // Kick off immediately so the user appears quickly
      heartbeat();
      fetchLive();
      heartbeatId = window.setInterval(heartbeat, 20000);
      pollId = window.setInterval(fetchLive, 5000);
    }

    return () => {
      stopped = true;
      if (heartbeatId !== undefined) window.clearInterval(heartbeatId);
      if (pollId !== undefined) window.clearInterval(pollId);
    };
  }, [activeTab, studentName]);

  const fetchPrompts = useCallback(() => {
    setPromptsLoading(true);
    setPromptsError("");
    api
      .getStudentPrompts({
        taskId: promptTaskId || undefined,
        student: promptStudentFilter.trim() || undefined,
        limit: 100,
        offset: 0,
      })
      .then(setPrompts)
      .catch((err: unknown) =>
        setPromptsError(err instanceof Error ? err.message : "Failed to load prompts")
      )
      .finally(() => setPromptsLoading(false));
  }, [promptTaskId, promptStudentFilter]);

  useEffect(() => {
    if (activeTab === "prompts") fetchPrompts();
  }, [activeTab, fetchPrompts]);

  const fetchMasterLeaderboard = useCallback(() => {
    setMasterLbLoading(true);
    setMasterLbError("");
    api
      .getMasterLeaderboard(50)
      .then(setMasterLb)
      .catch((err: unknown) =>
        setMasterLbError(err instanceof Error ? err.message : "Failed to load master leaderboard")
      )
      .finally(() => setMasterLbLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "leaderboard") fetchMasterLeaderboard();
  }, [activeTab, fetchMasterLeaderboard]);

  return (
    <>
      <Navbar />

      {/* Hero */}
      <div className="hero">
        <div className="hero-inner">
          <p className="hero-ey">Live Workshop Activities</p>
          <h1>Prompt Engineering<br />&amp; <em>Document AI</em></h1>
          <p className="hero-desc">
            Complete each activity, earn points, and see how you rank on the live class leaderboard.
            All activities use real AI — your prompts are graded automatically.
          </p>
          <div className="hero-pills">
            {HERO_PILLS.map((pill) => (
              <span key={pill} className="pill">{pill}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky tabs */}
      <div className="tabs-wrap">
        <div className="tabs">
          <button
            className={`tab-btn${activeTab === "activities" ? " active" : ""}`}
            onClick={() => setActiveTab("activities")}
          >
            🛠 All Activities
          </button>
          <button
            className={`tab-btn${activeTab === "leaderboard" ? " active" : ""}`}
            onClick={() => setActiveTab("leaderboard")}
          >
            🏆 Leaderboard
          </button>
          <button
            className={`tab-btn${activeTab === "prompts" ? " active" : ""}`}
            onClick={() => setActiveTab("prompts")}
          >
            📋 Student Prompts
          </button>
          <button
            className={`tab-btn${activeTab === "users" ? " active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            👥 Live Users
          </button>
        </div>
      </div>

      {/* Panel content */}
      <main className="lt-main">

        {/* ── All Activities panel ── */}
        {activeTab === "activities" && (
          <>
            {loading && <div className="spinner" />}
            {error && <div className="error-msg">{error}</div>}
            {!loading && !error && tasks.length === 0 && (
              <div className="panel-placeholder">
                <h3>No activities yet</h3>
                <p>Activities will appear here once they are published by your instructor.</p>
              </div>
            )}
            {tasks.map((task, idx) => (
              <div className="act-card" key={task.id}>
                <div className="act-header">
                  <div className="act-header-left">
                    <span className={`badge ${BADGE_COLORS[idx % BADGE_COLORS.length]}`}>
                      Activity {idx + 1}
                    </span>
                    <span className="act-tag">Prompt engineering</span>
                  </div>
                  <span className="pts-chip">+100 pts</span>
                </div>

                <div className="act-title">{task.name}</div>

                <div className="act-scenario">
                  <strong>Scenario:</strong> {task.description}
                </div>

                <div className="act-tasks">
                  {(task.instructions ?? DEFAULT_ACTIVITY_STEPS).map((step, i) => (
                    <div key={i} className="act-task">
                      <span className="task-num">{i + 1}</span>
                      <span>
                        <span className="task-verb">{step.verb}</span> {step.text}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-primary"
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  Start Activity →
                </button>
              </div>
            ))}
          </>
        )}

        {/* ── Leaderboard panel ── */}
        {activeTab === "leaderboard" && (
          <div className="panel-placeholder">
            <h3>Select an activity to view its leaderboard</h3>
            <p style={{ marginBottom: "1.2rem" }}>
              Each activity has its own live leaderboard. Open an activity and scroll down to see rankings.
            </p>
            {tasks.length > 0 && (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                {tasks.map((task, idx) => (
                  <button
                    key={task.id}
                    className="btn btn-outline"
                    onClick={() => navigate(`/tasks/${task.id}/leaderboard`)}
                  >
                    Activity {idx + 1} Leaderboard →
                  </button>
                ))}
              </div>
            )}

            <div style={{ height: 18 }} />

            <div className="lb-wrap" style={{ width: "min(980px, 100%)", margin: "0 auto" }}>
              <div className="lb-head">
                <h3>Master Leaderboard (total points)</h3>
                <span>Sum of best scores across selected activities</span>
              </div>

              {masterLbLoading && <div className="spinner" />}
              {masterLbError && <div className="error-msg">{masterLbError}</div>}

              {!masterLbLoading && !masterLbError && masterLb.length === 0 && (
                <div className="lb-empty">No in-class submissions yet (for the selected master activities).</div>
              )}

              {!masterLbLoading && !masterLbError && masterLb.length > 0 && (
                <>
                  {masterLb.map((entry, idx) => {
                    const rank = idx + 1;
                    const isMe = entry.student_name === studentName;
                    return (
                      <div
                        key={entry.student_name}
                        className={`lb-row${isMe ? " me" : ""}`}
                      >
                        <span className="lb-rank">{rank}</span>

                        <div>
                          <div className="lb-name">
                            {entry.student_name}
                            {isMe && (
                              <span style={{
                                marginLeft: ".4rem",
                                fontSize: "10px",
                                color: "var(--red)",
                                fontWeight: 600,
                                background: "var(--red-l)",
                                padding: "1px 6px",
                                borderRadius: "10px",
                              }}>
                                you
                              </span>
                            )}
                          </div>
                          <div className="lb-sub">{entry.tasks_completed} task{entry.tasks_completed !== 1 ? "s" : ""} completed</div>
                        </div>

                        <div className="lb-score">
                          {entry.total_points}
                          <span style={{ fontSize: "11px", color: "var(--ink4)", fontWeight: 400 }}>/700</span>
                        </div>

                        <div className="lb-acts" style={{ color: "var(--ink3)" }}>
                          {new Date(entry.last_submitted).toLocaleString()}
                        </div>

                        <div className="lb-acts" />
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Student Prompts panel ── */}
        {activeTab === "prompts" && (
          <>
            <div className="plog-filter-row">
              <label htmlFor="plog-task">Activity</label>
              <select
                id="plog-task"
                className="input"
                value={promptTaskId}
                onChange={(e) => setPromptTaskId(e.target.value)}
              >
                <option value="">All activities</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <label htmlFor="plog-student">Student</label>
              <input
                id="plog-student"
                type="text"
                className="input"
                placeholder="Search by name…"
                value={promptStudentFilter}
                onChange={(e) => setPromptStudentFilter(e.target.value)}
              />
              <button className="btn btn-primary" onClick={fetchPrompts} disabled={promptsLoading}>
                {promptsLoading ? "Loading…" : "Apply"}
              </button>
            </div>
            {promptsError && <div className="error-msg">{promptsError}</div>}
            <div className="plog-filter-row" style={{ marginBottom: "0.5rem" }}>
              <div className="plog-count" style={{ marginBottom: 0, marginRight: "1rem" }}>
                <strong>{prompts.length}</strong> prompt{prompts.length !== 1 ? "s" : ""} submitted
              </div>
              <span style={{ fontSize: "12px", color: "var(--ink3)", marginRight: "6px" }}>Sort:</span>
              <button
                type="button"
                className={`btn ${promptSortBy === "latest" ? "btn-primary" : "btn-ghost"}`}
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => setPromptSortBy("latest")}
              >
                Latest first
              </button>
              <button
                type="button"
                className={`btn ${promptSortBy === "score" ? "btn-primary" : "btn-ghost"}`}
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => setPromptSortBy("score")}
              >
                Highest score first
              </button>
            </div>
            {promptsLoading && <div className="spinner" />}
            {!promptsLoading && prompts.length === 0 && !promptsError && (
              <div className="plog-empty">
                No prompts submitted yet. Students will appear here as they complete activities.
              </div>
            )}
            {!promptsLoading &&
              [...prompts]
                .sort((a, b) => {
                  if (promptSortBy === "score") return b.score - a.score;
                  return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
                })
                .map((entry, idx) => {
                  const { date, time } = formatPromptTime(entry.submitted_at);
                  const initials = getInitials(entry.student_name);
                  const entryKey = `${entry.student_name}|${entry.task_id}|${entry.submitted_at}`;
                  const isExpanded = promptExpandedKeys.has(entryKey);
                  return (
                    <div key={`${entryKey}-${idx}`} className="plog-entry">
                      <div className="plog-header">
                        <div className="plog-student">
                          <div className="plog-av" style={{ background: "var(--red)" }}>{initials}</div>
                          <div>
                            <div className="plog-name">{entry.student_name}</div>
                            <div className="plog-id">{entry.task_name}</div>
                          </div>
                        </div>
                        <div className="plog-meta">
                          <span className="plog-act-badge">{entry.task_name}</span>
                          <span className="plog-time">{date} {time}</span>
                          <span className="pts-chip">{entry.score}/100</span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: "2px 8px", fontSize: "11px" }}
                            onClick={() => togglePromptExpanded(entryKey)}
                          >
                            {isExpanded ? "Hide prompt" : "Show prompt"}
                          </button>
                        </div>
                      </div>
                      {isExpanded && <div className="plog-prompt">{entry.prompt}</div>}
                    </div>
                  );
                })}
          </>
        )}

        {/* ── Live Users panel ── */}
        {activeTab === "users" && (
          <div className="panel-placeholder">
            <h3>Live Users</h3>
            <p>See who else is in the workshop right now.</p>
            {liveUsersError && <div className="error-msg">{liveUsersError}</div>}
            <div style={{ marginTop: "1.2rem" }}>
              <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: "0.4rem" }}>
                <strong>{liveUsers.length}</strong> user{liveUsers.length === 1 ? "" : "s"} online in the last 5 minutes
              </div>
              {liveUsers.length === 0 && (
                <div className="plog-empty">
                  No one is currently online. As students join the workshop, they will appear here.
                </div>
              )}
              {liveUsers.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  {liveUsers.map((u) => (
                    <div
                      key={u.student_name}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        background: "var(--green-l)",
                        border: "1px solid var(--green-b)",
                        borderRadius: "var(--r-sm)",
                        padding: "8px 14px",
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          background: "var(--green)",
                          color: "white",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {u.student_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--green)", fontSize: 13 }}>
                          {u.student_name}
                          {u.student_name === studentName && (
                            <span
                              style={{
                                marginLeft: ".4rem",
                                fontSize: "10px",
                                color: "var(--teal)",
                                fontWeight: 600,
                                background: "var(--teal-l)",
                                padding: "1px 6px",
                                borderRadius: "10px",
                              }}
                            >
                              you
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink3)" }}>Online now</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </>
  );
}
