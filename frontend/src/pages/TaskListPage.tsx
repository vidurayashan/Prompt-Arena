import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, isAdminSession } from "../api";
import type {
  AdminTask,
  LiveUser,
  MasterLeaderboardEntry,
  StudentPromptEntry,
  Task,
  TaskOverridesPayload,
} from "../api";
import Navbar from "../components/Navbar";

type Tab = "activities" | "leaderboard" | "prompts" | "users" | "workshop";

type EditFormState = {
  name: string;
  description: string;
  instructions: { verb: string; text: string }[];
  prompt_intro: string;
  prompt_panel_title: string;
  prompt_panel_body: string;
  prompt_placeholder: string;
  judge_prompt: string;
  strict_judge_prompt: string;
  generous_judge_prompt: string;
  pre_prompt_judge_prompt: string;
  judge_persona: string;
  evaluate_what: string;
};

function formFromTask(task: AdminTask): EditFormState {
  return {
    name: task.name ?? "",
    description: task.description ?? "",
    instructions: (task.instructions ?? []).map((s) => ({ verb: s.verb, text: s.text })),
    prompt_intro: task.prompt_intro ?? "",
    prompt_panel_title: task.prompt_panel_title ?? "",
    prompt_panel_body: task.prompt_panel_body ?? "",
    prompt_placeholder: task.prompt_placeholder ?? "",
    judge_prompt: task.judge_prompt ?? "",
    strict_judge_prompt: task.strict_judge_prompt ?? "",
    generous_judge_prompt: task.generous_judge_prompt ?? "",
    pre_prompt_judge_prompt: task.pre_prompt_judge_prompt ?? "",
    judge_persona: task.judge_persona ?? "strict",
    evaluate_what: task.evaluate_what ?? "prompt",
  };
}

function buildOverridesPayload(form: EditFormState, taskType: string): TaskOverridesPayload {
  const payload: TaskOverridesPayload = {
    name: form.name.trim(),
    description: form.description.trim(),
    judge_persona: form.judge_persona,
  };
  const steps = form.instructions
    .map((s) => ({ verb: s.verb.trim(), text: s.text.trim() }))
    .filter((s) => s.verb || s.text);
  if (steps.length > 0) payload.instructions = steps;

  if (form.pre_prompt_judge_prompt.trim()) {
    payload.pre_prompt_judge_prompt = form.pre_prompt_judge_prompt;
  }

  if (taskType === "Document") {
    if (form.strict_judge_prompt.trim()) {
      payload.strict_judge_prompt = form.strict_judge_prompt;
    }
    if (form.generous_judge_prompt.trim()) {
      payload.generous_judge_prompt = form.generous_judge_prompt;
    }
  }

  if (taskType === "Prompt" || taskType === "Chat") {
    if (form.prompt_intro.trim()) payload.prompt_intro = form.prompt_intro;
    if (form.prompt_panel_title.trim()) payload.prompt_panel_title = form.prompt_panel_title;
    if (form.prompt_panel_body.trim()) payload.prompt_panel_body = form.prompt_panel_body;
    if (form.prompt_placeholder.trim()) payload.prompt_placeholder = form.prompt_placeholder;
    if (form.judge_prompt.trim()) payload.judge_prompt = form.judge_prompt;
  }
  if (taskType === "Prompt") {
    payload.evaluate_what = form.evaluate_what;
  }
  return payload;
}

function applyOverrideResponse(task: AdminTask, res: {
  name: string;
  description: string;
  overrides: Record<string, unknown>;
  has_overrides: boolean;
  instructions?: { verb: string; text: string }[] | null;
  prompt_intro?: string | null;
  prompt_panel_title?: string | null;
  prompt_panel_body?: string | null;
  prompt_placeholder?: string | null;
  judge_prompt?: string | null;
  strict_judge_prompt?: string | null;
  generous_judge_prompt?: string | null;
  pre_prompt_judge_prompt?: string | null;
  judge_persona?: string | null;
  evaluate_what?: string | null;
}): AdminTask {
  return {
    ...task,
    name: res.name,
    description: res.description,
    overrides: res.overrides,
    has_overrides: res.has_overrides,
    instructions: res.instructions ?? undefined,
    prompt_intro: res.prompt_intro ?? undefined,
    prompt_panel_title: res.prompt_panel_title ?? undefined,
    prompt_panel_body: res.prompt_panel_body ?? undefined,
    prompt_placeholder: res.prompt_placeholder ?? undefined,
    judge_prompt: res.judge_prompt ?? undefined,
    strict_judge_prompt: res.strict_judge_prompt ?? undefined,
    generous_judge_prompt: res.generous_judge_prompt ?? undefined,
    pre_prompt_judge_prompt: res.pre_prompt_judge_prompt ?? undefined,
    judge_persona: res.judge_persona ?? undefined,
    evaluate_what: res.evaluate_what ?? undefined,
  };
}

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
  { verb: "Have a look", text: "at the sample document." },
  {
    verb: "Write",
    text: "a prompt with Clarity, Context, Precision, and Persona (the Four Pillars).",
  },
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
  const [masterLbMaxPoints, setMasterLbMaxPoints] = useState(0);
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
  const [adminTasks, setAdminTasks] = useState<AdminTask[]>([]);
  const [adminTasksLoading, setAdminTasksLoading] = useState(false);
  const [adminTasksError, setAdminTasksError] = useState("");
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [sessionCutoff, setSessionCutoff] = useState<string | null>(null);
  const [sessionPublishedCount, setSessionPublishedCount] = useState(0);
  const [integrityJudgeEnabled, setIntegrityJudgeEnabled] = useState(true);
  const [togglingIntegrity, setTogglingIntegrity] = useState(false);
  const [fourPillarsEnabled, setFourPillarsEnabled] = useState(true);
  const [togglingFourPillars, setTogglingFourPillars] = useState(false);
  const [resettingSession, setResettingSession] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const navigate = useNavigate();
  const isAdmin = isAdminSession();

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

  const fetchAdminTasks = useCallback(() => {
    if (!isAdmin) return;
    setAdminTasksLoading(true);
    setAdminTasksError("");
    api
      .getAdminTasks()
      .then(setAdminTasks)
      .catch((err: unknown) =>
        setAdminTasksError(err instanceof Error ? err.message : "Failed to load workshop tasks")
      )
      .finally(() => setAdminTasksLoading(false));
  }, [isAdmin]);

  const fetchAdminSession = useCallback(() => {
    if (!isAdmin) return;
    api
      .getAdminSession()
      .then((res) => {
        setSessionCutoff(res.data_cutoff_after);
        setSessionPublishedCount(res.published_count);
        setIntegrityJudgeEnabled(res.pre_prompt_judge_enabled);
        setFourPillarsEnabled(res.four_pillars_enabled);
      })
      .catch(() => {
        // best-effort; workshop list still works without session status
      });
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === "workshop" && isAdmin) {
      fetchAdminTasks();
      fetchAdminSession();
    }
  }, [activeTab, isAdmin, fetchAdminTasks, fetchAdminSession]);

  useEffect(() => {
    if (!isAdmin && (activeTab === "prompts" || activeTab === "workshop")) {
      setActiveTab("activities");
    }
  }, [isAdmin, activeTab]);

  async function handleResetSession() {
    const ok = window.confirm(
      "This will clear leaderboards and student prompts for everyone using this app, and unpublish all tasks. Students should refresh or rejoin. Continue?"
    );
    if (!ok) return;
    setResettingSession(true);
    setResetMessage("");
    setAdminTasksError("");
    try {
      const res = await api.resetAdminSession(true);
      setSessionCutoff(res.data_cutoff_after);
      setSessionPublishedCount(0);
      setResetMessage(
        `Session reset. Leaderboards start from ${new Date(res.data_cutoff_after).toLocaleString()}. Unpublished ${res.unpublished} task(s).`
      );
      await fetchAdminTasks();
      const published = await api.listTasks();
      setTasks(published);
      fetchMasterLeaderboard();
    } catch (err: unknown) {
      setAdminTasksError(err instanceof Error ? err.message : "Failed to reset session");
    } finally {
      setResettingSession(false);
    }
  }

  async function handleToggleIntegrityJudge() {
    const next = !integrityJudgeEnabled;
    setTogglingIntegrity(true);
    setAdminTasksError("");
    try {
      const res = await api.setIntegrityJudgeEnabled(next);
      setIntegrityJudgeEnabled(res.pre_prompt_judge_enabled);
    } catch (err: unknown) {
      setAdminTasksError(err instanceof Error ? err.message : "Failed to update integrity judge");
    } finally {
      setTogglingIntegrity(false);
    }
  }

  async function handleToggleFourPillars() {
    const next = !fourPillarsEnabled;
    setTogglingFourPillars(true);
    setAdminTasksError("");
    try {
      const res = await api.setFourPillarsEnabled(next);
      setFourPillarsEnabled(res.four_pillars_enabled);
    } catch (err: unknown) {
      setAdminTasksError(err instanceof Error ? err.message : "Failed to update Four Pillars feedback");
    } finally {
      setTogglingFourPillars(false);
    }
  }

  async function handleTogglePublished(task: AdminTask) {
    setTogglingTaskId(task.id);
    setAdminTasksError("");
    try {
      const res = await api.setTaskPublished(task.id, !task.published);
      setAdminTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, published: res.published } : t))
      );
      // Refresh student-facing list so Activities tab stays in sync for the admin view
      const published = await api.listTasks();
      setTasks(published);
    } catch (err: unknown) {
      setAdminTasksError(err instanceof Error ? err.message : "Failed to update publish state");
    } finally {
      setTogglingTaskId(null);
    }
  }

  function openEditForm(task: AdminTask) {
    if (editingTaskId === task.id) {
      setEditingTaskId(null);
      setEditForm(null);
      return;
    }
    setEditingTaskId(task.id);
    setEditForm(formFromTask(task));
  }

  async function handleSaveOverrides(task: AdminTask) {
    if (!editForm) return;
    setSavingTaskId(task.id);
    setAdminTasksError("");
    try {
      const payload = buildOverridesPayload(editForm, task.task_type);
      const res = await api.updateTaskOverrides(task.id, payload);
      setAdminTasks((prev) =>
        prev.map((t) => (t.id === task.id ? applyOverrideResponse(t, res) : t))
      );
      setEditForm(formFromTask(applyOverrideResponse(task, res)));
      const published = await api.listTasks();
      setTasks(published);
    } catch (err: unknown) {
      setAdminTasksError(err instanceof Error ? err.message : "Failed to save overrides");
    } finally {
      setSavingTaskId(null);
    }
  }

  async function handleResetOverrides(task: AdminTask) {
    setSavingTaskId(task.id);
    setAdminTasksError("");
    try {
      const res = await api.clearTaskOverrides(task.id);
      const updated = applyOverrideResponse(task, res);
      setAdminTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      setEditForm(formFromTask(updated));
      const published = await api.listTasks();
      setTasks(published);
    } catch (err: unknown) {
      setAdminTasksError(err instanceof Error ? err.message : "Failed to reset overrides");
    } finally {
      setSavingTaskId(null);
    }
  }

  // Live users: heartbeat + polling while on the Live Users tab
  useEffect(() => {
    if (!studentName || isAdmin) return;
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
  }, [activeTab, studentName, isAdmin]);

  // Admins can still view the live users list without sending a student heartbeat
  useEffect(() => {
    if (!isAdmin || activeTab !== "users") return;
    let pollId: number | undefined;
    let stopped = false;

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

    fetchLive();
    pollId = window.setInterval(fetchLive, 5000);
    return () => {
      stopped = true;
      if (pollId !== undefined) window.clearInterval(pollId);
    };
  }, [activeTab, isAdmin]);

  const fetchPrompts = useCallback(() => {
    if (!isAdmin) return;
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
  }, [promptTaskId, promptStudentFilter, isAdmin]);

  // Refetch when tab opens or activity filter changes; debounce student name typing.
  useEffect(() => {
    if (activeTab !== "prompts" || !isAdmin) return;
    const timer = window.setTimeout(() => {
      fetchPrompts();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeTab, isAdmin, promptTaskId, promptStudentFilter, fetchPrompts]);

  useEffect(() => {
    if (isAdmin && adminTasks.length === 0) fetchAdminTasks();
  }, [isAdmin, adminTasks.length, fetchAdminTasks]);

  const fetchMasterLeaderboard = useCallback(() => {
    setMasterLbLoading(true);
    setMasterLbError("");
    api
      .getMasterLeaderboard(50)
      .then((res) => {
        setMasterLb(res.entries);
        setMasterLbMaxPoints(res.max_points);
      })
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
          {isAdmin && (
            <button
              className={`tab-btn${activeTab === "prompts" ? " active" : ""}`}
              onClick={() => setActiveTab("prompts")}
            >
              📋 Student Prompts
            </button>
          )}
          {isAdmin && (
            <button
              className={`tab-btn${activeTab === "workshop" ? " active" : ""}`}
              onClick={() => setActiveTab("workshop")}
            >
              ⚙ Workshop Control
            </button>
          )}
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

                {task.four_pillars_guidance && (
                  <div className="act-pillars-tip">
                    <strong>Four Pillars:</strong> Clarity · Context · Precision · Persona — include these in your prompt (worth 50 pts on Document tasks).
                  </div>
                )}

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
                <span>Sum of best scores across all published activities</span>
              </div>

              {masterLbLoading && <div className="spinner" />}
              {masterLbError && <div className="error-msg">{masterLbError}</div>}

              {!masterLbLoading && !masterLbError && masterLb.length === 0 && (
                <div className="lb-empty">No in-class submissions yet (for published activities).</div>
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
                          <span style={{ fontSize: "11px", color: "var(--ink4)", fontWeight: 400 }}>
                            /{masterLbMaxPoints}
                          </span>
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

        {/* ── Workshop Control panel (admin) ── */}
        {activeTab === "workshop" && isAdmin && (
          <>
            <div className="panel-placeholder" style={{ textAlign: "left", maxWidth: 900, margin: "0 auto" }}>
              <h3>Workshop control</h3>
              <p style={{ marginBottom: "1rem" }}>
                Publish activities and edit live task text (judge prompt, description, prompt UI copy).
                Changes are stored in Supabase as overrides on top of <code>config.yaml</code> — no redeploy needed.
                Use <strong>Reset to config.yaml</strong> to clear overrides for a task.
              </p>

              <div
                className="act-card"
                style={{ marginBottom: "1.25rem", border: "1px solid var(--red-b, #f5c2cb)" }}
              >
                <div className="act-title" style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>
                  New class session
                </div>
                <p style={{ fontSize: 13, color: "var(--ink3)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
                  {sessionCutoff
                    ? <>Current leaderboard cutoff: <strong>{new Date(sessionCutoff).toLocaleString()}</strong></>
                    : <>Showing all historical submissions (no session cutoff set).</>}
                  {" "}
                  Published tasks: <strong>{sessionPublishedCount}</strong>.
                  Any lecturer with admin access shares this app — reset affects everyone.
                </p>
                {resetMessage && (
                  <div style={{ fontSize: 13, color: "var(--green, #15803d)", marginBottom: "0.75rem" }}>
                    {resetMessage}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={resettingSession}
                  onClick={handleResetSession}
                  style={{ borderColor: "var(--red, #c8102e)", color: "var(--red, #c8102e)" }}
                >
                  {resettingSession ? "Resetting…" : "Reset for new class"}
                </button>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: "0.5rem" }}>
                  Soft-clears leaderboards and Student Prompts from this moment, and unpublishes all tasks.
                  Ask students to refresh or rejoin so their local points match.
                </div>
              </div>

              <div
                className="act-card"
                style={{ marginBottom: "1.25rem" }}
              >
                <div className="act-title" style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>
                  Integrity judge
                </div>
                <p style={{ fontSize: 13, color: "var(--ink3)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
                  When enabled, submissions are checked for answer-dumping before scoring.
                  Rejected prompts still count as an attempt with score 0.
                </p>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: 14,
                    cursor: togglingIntegrity ? "wait" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={integrityJudgeEnabled}
                    disabled={togglingIntegrity}
                    onChange={handleToggleIntegrityJudge}
                  />
                  <span>
                    {integrityJudgeEnabled ? "Enabled" : "Disabled"}
                    {togglingIntegrity ? "…" : ""}
                  </span>
                </label>
              </div>

              <div
                className="act-card"
                style={{ marginBottom: "1.25rem" }}
              >
                <div className="act-title" style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>
                  Four Pillars feedback
                </div>
                <p style={{ fontSize: 13, color: "var(--ink3)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
                  When enabled, every student prompt is scored on Clarity, Context, Precision,
                  and Persona. This is formative feedback and does not change leaderboard totals.
                </p>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: 14,
                    cursor: togglingFourPillars ? "wait" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={fourPillarsEnabled}
                    disabled={togglingFourPillars}
                    onChange={handleToggleFourPillars}
                  />
                  <span>
                    {fourPillarsEnabled ? "Enabled" : "Disabled"}
                    {togglingFourPillars ? "…" : ""}
                  </span>
                </label>
              </div>

              {adminTasksError && <div className="error-msg">{adminTasksError}</div>}
              {adminTasksLoading && <div className="spinner" />}
              {!adminTasksLoading && adminTasks.length === 0 && !adminTasksError && (
                <div className="plog-empty">No tasks found in config.yaml.</div>
              )}
              {!adminTasksLoading &&
                adminTasks.map((task) => {
                  const isEditing = editingTaskId === task.id && editForm != null;
                  const isPromptLike = task.task_type === "Prompt" || task.task_type === "Chat";
                  return (
                  <div
                    key={task.id}
                    className="act-card"
                    style={{ marginBottom: "0.75rem" }}
                  >
                    <div className="act-header">
                      <div className="act-header-left">
                        <span className={`badge ${task.published ? "b-green" : "b-amber"}`}>
                          {task.published ? "Published" : "Hidden"}
                        </span>
                        <span className="act-tag">{task.task_type}</span>
                        {task.has_overrides && (
                          <span className="badge b-purple">Overrides</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => openEditForm(task)}
                        >
                          {isEditing ? "Close" : "Edit"}
                        </button>
                        <button
                          type="button"
                          className={`btn ${task.published ? "btn-outline" : "btn-primary"}`}
                          disabled={togglingTaskId === task.id}
                          onClick={() => handleTogglePublished(task)}
                        >
                          {togglingTaskId === task.id
                            ? "Updating…"
                            : task.published
                              ? "Unpublish"
                              : "Publish"}
                        </button>
                      </div>
                    </div>
                    <div className="act-title" style={{ fontSize: "1.05rem" }}>
                      {task.name}
                    </div>
                    <div className="act-scenario" style={{ marginBottom: isEditing ? "1rem" : 0 }}>
                      <strong>ID:</strong> {task.id}
                    </div>

                    {isEditing && editForm && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <div className="lf">
                          <label>Name</label>
                          <input
                            className="input"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          />
                        </div>
                        <div className="lf">
                          <label>Description</label>
                          <textarea
                            className="input"
                            rows={3}
                            value={editForm.description}
                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          />
                        </div>

                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                            <label style={{ fontWeight: 600, fontSize: 13 }}>Instructions</label>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              onClick={() =>
                                setEditForm({
                                  ...editForm,
                                  instructions: [...editForm.instructions, { verb: "", text: "" }],
                                })
                              }
                            >
                              + Add step
                            </button>
                          </div>
                          {editForm.instructions.map((step, idx) => (
                            <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "6px" }}>
                              <input
                                className="input"
                                style={{ width: "110px" }}
                                placeholder="Verb"
                                value={step.verb}
                                onChange={(e) => {
                                  const next = [...editForm.instructions];
                                  next[idx] = { ...next[idx], verb: e.target.value };
                                  setEditForm({ ...editForm, instructions: next });
                                }}
                              />
                              <input
                                className="input"
                                style={{ flex: 1 }}
                                placeholder="Text"
                                value={step.text}
                                onChange={(e) => {
                                  const next = [...editForm.instructions];
                                  next[idx] = { ...next[idx], text: e.target.value };
                                  setEditForm({ ...editForm, instructions: next });
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: "2px 8px" }}
                                onClick={() =>
                                  setEditForm({
                                    ...editForm,
                                    instructions: editForm.instructions.filter((_, i) => i !== idx),
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="lf">
                          <label>Judge persona</label>
                          <select
                            className="input"
                            value={editForm.judge_persona}
                            onChange={(e) => setEditForm({ ...editForm, judge_persona: e.target.value })}
                          >
                            <option value="strict">strict</option>
                            <option value="generous">generous</option>
                          </select>
                          {task.task_type === "Document" && (
                            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>
                              Selects which Document scoring rubric (strict or generous) runs at score time.
                            </div>
                          )}
                        </div>

                        {task.task_type === "Document" && (
                          <>
                            <div className="lf">
                              <label>Strict scoring judge prompt</label>
                              <textarea
                                className="input"
                                rows={12}
                                style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                                value={editForm.strict_judge_prompt}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, strict_judge_prompt: e.target.value })
                                }
                              />
                            </div>
                            <div className="lf">
                              <label>Generous scoring judge prompt</label>
                              <textarea
                                className="input"
                                rows={12}
                                style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                                value={editForm.generous_judge_prompt}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, generous_judge_prompt: e.target.value })
                                }
                              />
                            </div>
                          </>
                        )}

                        <div className="lf">
                          <label>Pre-prompt judge</label>
                          <textarea
                            className="input"
                            rows={10}
                            style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                            value={editForm.pre_prompt_judge_prompt}
                            onChange={(e) =>
                              setEditForm({ ...editForm, pre_prompt_judge_prompt: e.target.value })
                            }
                          />
                          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>
                            Runs before scoring. Flags prompts that paste answers instead of writing extraction instructions.
                          </div>
                        </div>

                        {isPromptLike && (
                          <>
                            <div className="lf">
                              <label>Prompt panel title</label>
                              <input
                                className="input"
                                value={editForm.prompt_panel_title}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, prompt_panel_title: e.target.value })
                                }
                              />
                            </div>
                            <div className="lf">
                              <label>Prompt panel body</label>
                              <textarea
                                className="input"
                                rows={2}
                                value={editForm.prompt_panel_body}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, prompt_panel_body: e.target.value })
                                }
                              />
                            </div>
                            <div className="lf">
                              <label>Prompt intro</label>
                              <textarea
                                className="input"
                                rows={2}
                                value={editForm.prompt_intro}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, prompt_intro: e.target.value })
                                }
                              />
                            </div>
                            <div className="lf">
                              <label>Prompt placeholder</label>
                              <textarea
                                className="input"
                                rows={2}
                                value={editForm.prompt_placeholder}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, prompt_placeholder: e.target.value })
                                }
                              />
                            </div>
                            <div className="lf">
                              <label>Scoring judge prompt</label>
                              <textarea
                                className="input"
                                rows={12}
                                style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                                value={editForm.judge_prompt}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, judge_prompt: e.target.value })
                                }
                              />
                            </div>
                          </>
                        )}

                        {task.task_type === "Prompt" && (
                          <div className="lf">
                            <label>Evaluate what</label>
                            <select
                              className="input"
                              value={editForm.evaluate_what}
                              onChange={(e) =>
                                setEditForm({ ...editForm, evaluate_what: e.target.value })
                              }
                            >
                              <option value="prompt">prompt</option>
                              <option value="output">output</option>
                            </select>
                          </div>
                        )}

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "0.25rem" }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={savingTaskId === task.id}
                            onClick={() => handleSaveOverrides(task)}
                          >
                            {savingTaskId === task.id ? "Saving…" : "Save overrides"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline"
                            disabled={savingTaskId === task.id || !task.has_overrides}
                            onClick={() => handleResetOverrides(task)}
                          >
                            Reset to config.yaml
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })}
            </div>
          </>
        )}

        {/* ── Student Prompts panel ── */}
        {activeTab === "prompts" && isAdmin && (
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
                {(adminTasks.length > 0 ? adminTasks : tasks).map((t) => (
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
