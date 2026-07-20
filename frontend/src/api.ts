/** Typed fetch helpers for the Prompt Arena backend API. */

export interface Task {
  id: string;
  name: string;
  description: string;
  instructions?: { verb: string; text: string }[];
}

export interface TaskItem {
  id: number;
  label: string;
}

export interface TaskDetail extends Task {
  task_type: "Document" | "Prompt" | "Chat";
  document_filename?: string;
  task_model: string;
  judge_persona: string;
  items?: TaskItem[];
  judge_prompt?: string;
  evaluate_what?: "prompt" | "output";
  prompt_intro?: string;
  prompt_panel_title?: string;
  prompt_panel_body?: string;
  prompt_placeholder?: string;
}

export interface AdminTask {
  id: string;
  name: string;
  description: string;
  task_type: string;
  published: boolean;
  overrides?: Record<string, unknown>;
  has_overrides?: boolean;
  instructions?: { verb: string; text: string }[];
  prompt_intro?: string;
  prompt_panel_title?: string;
  prompt_panel_body?: string;
  prompt_placeholder?: string;
  judge_prompt?: string;
  pre_prompt_judge_prompt?: string;
  judge_persona?: string;
  evaluate_what?: "prompt" | "output" | string;
}

export interface TaskOverridesPayload {
  name?: string;
  description?: string;
  instructions?: { verb: string; text: string }[];
  prompt_intro?: string;
  prompt_panel_title?: string;
  prompt_panel_body?: string;
  prompt_placeholder?: string;
  judge_prompt?: string;
  pre_prompt_judge_prompt?: string;
  judge_persona?: string;
  evaluate_what?: string;
}

export interface AdminTaskOverrideResponse {
  id: string;
  overrides: Record<string, unknown>;
  has_overrides: boolean;
  name: string;
  description: string;
  task_type: string;
  instructions?: { verb: string; text: string }[] | null;
  prompt_intro?: string | null;
  prompt_panel_title?: string | null;
  prompt_panel_body?: string | null;
  prompt_placeholder?: string | null;
  judge_prompt?: string | null;
  pre_prompt_judge_prompt?: string | null;
  judge_persona?: string | null;
  evaluate_what?: string | null;
}

export interface ChatMessage {
  role: "student" | "assistant";
  content: string;
}

export interface ScoreItem {
  item_id: number;
  label: string;
  score: number;
  correct_answer: string;
  found: string;
  reason: string;
}

export interface SubmitResponse {
  student_output: string;
  scores: ScoreItem[];
  total: number;
  previous_best: number | null;
  is_new_best: boolean;
  judge_breakdown?: Record<string, { score: number; max: number }> | null;
  judge_feedback?: string | null;
  prompt_rejected?: boolean;
}

export interface LeaderboardEntry {
  student_name: string;
  best_score: number;
  latest_score: number;
  attempts: number;
  last_submitted: string;
}

export interface SubmissionAttempt {
  score: number;
  prompt: string;
  submitted_at: string;
}

export interface StudentPromptEntry {
  student_name: string;
  task_id: string;
  task_name: string;
  prompt: string;
  score: number;
  submitted_at: string;
}

export interface MasterLeaderboardEntry {
  student_name: string;
  total_points: number;
  tasks_completed: number;
  last_submitted: string;
}

export interface MasterLeaderboardResponse {
  entries: MasterLeaderboardEntry[];
  max_points: number;
  task_count: number;
}

export interface LiveUser {
  student_name: string;
  last_seen: string;
}

export interface GetStudentPromptsParams {
  taskId?: string;
  student?: string;
  limit?: number;
  offset?: number;
}

function getAdminToken(): string | null {
  return localStorage.getItem("adminToken");
}

export function isAdminSession(): boolean {
  return localStorage.getItem("role") === "admin" && !!getAdminToken();
}

export function clearSession(): void {
  localStorage.removeItem("studentName");
  localStorage.removeItem("taskBests");
  localStorage.removeItem("adminToken");
  localStorage.removeItem("role");
}

async function apiFetch<T>(path: string, init?: RequestInit, auth: "none" | "admin" = "none"): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (auth === "admin") {
    const token = getAdminToken();
    if (!token) throw new Error("Admin authentication required");
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? "Unknown error");
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (name: string) =>
    apiFetch<{ name: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  adminLogin: (username: string, password: string) =>
    apiFetch<{ token: string; role: string; display_name: string }>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  listTasks: () => apiFetch<Task[]>("/api/tasks"),

  getAdminTasks: () => apiFetch<AdminTask[]>("/api/admin/tasks", undefined, "admin"),

  setTaskPublished: (taskId: string, published: boolean) =>
    apiFetch<{ id: string; published: boolean }>(
      `/api/admin/tasks/${encodeURIComponent(taskId)}/published`,
      {
        method: "PUT",
        body: JSON.stringify({ published }),
      },
      "admin"
    ),

  updateTaskOverrides: (taskId: string, overrides: TaskOverridesPayload) =>
    apiFetch<AdminTaskOverrideResponse>(
      `/api/admin/tasks/${encodeURIComponent(taskId)}/overrides`,
      {
        method: "PUT",
        body: JSON.stringify({ overrides }),
      },
      "admin"
    ),

  clearTaskOverrides: (taskId: string) =>
    apiFetch<AdminTaskOverrideResponse>(
      `/api/admin/tasks/${encodeURIComponent(taskId)}/overrides`,
      { method: "DELETE" },
      "admin"
    ),

  getAdminSession: () =>
    apiFetch<{
      data_cutoff_after: string | null;
      published_count: number;
      pre_prompt_judge_enabled: boolean;
    }>("/api/admin/session", undefined, "admin"),

  setIntegrityJudgeEnabled: (enabled: boolean) =>
    apiFetch<{ pre_prompt_judge_enabled: boolean }>(
      "/api/admin/session/integrity-judge",
      {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      },
      "admin"
    ),

  resetAdminSession: (unpublishAll: boolean = true) =>
    apiFetch<{ data_cutoff_after: string; unpublished: number }>(
      "/api/admin/reset-session",
      {
        method: "POST",
        body: JSON.stringify({ unpublish_all: unpublishAll }),
      },
      "admin"
    ),

  getTask: (taskId: string) => apiFetch<TaskDetail>(`/api/tasks/${taskId}`),

  submitPrompt: (taskId: string, studentName: string, prompt: string) =>
    apiFetch<SubmitResponse>(`/api/tasks/${taskId}/submit`, {
      method: "POST",
      body: JSON.stringify({ student_name: studentName, prompt }),
    }),

  chatSendMessage: (taskId: string, studentName: string, message: string, history: ChatMessage[]) =>
    apiFetch<{ assistant_message: string }>(`/api/tasks/${taskId}/chat/message`, {
      method: "POST",
      body: JSON.stringify({ student_name: studentName, message, history }),
    }),

  chatScore: (taskId: string, studentName: string, history: ChatMessage[]) =>
    apiFetch<SubmitResponse>(`/api/tasks/${taskId}/chat/score`, {
      method: "POST",
      body: JSON.stringify({ student_name: studentName, history }),
    }),

  getLeaderboard: (taskId: string) =>
    apiFetch<LeaderboardEntry[]>(`/api/tasks/${taskId}/leaderboard`),

  getHistory: (taskId: string, studentName: string) =>
    apiFetch<SubmissionAttempt[]>(
      `/api/tasks/${taskId}/history?student=${encodeURIComponent(studentName)}`
    ),

  getStudentPrompts: (params: GetStudentPromptsParams = {}) => {
    const sp = new URLSearchParams();
    if (params.taskId) sp.set("task_id", params.taskId);
    if (params.student) sp.set("student", params.student);
    if (params.limit != null) sp.set("limit", String(params.limit));
    if (params.offset != null) sp.set("offset", String(params.offset));
    const q = sp.toString();
    return apiFetch<StudentPromptEntry[]>(
      `/api/student-prompts${q ? `?${q}` : ""}`,
      undefined,
      "admin"
    );
  },

  getMyTotal: (studentName: string) =>
    apiFetch<{ total_points: number; max_points: number; task_count: number }>(
      `/api/my-total?student=${encodeURIComponent(studentName)}`
    ),

  getMasterLeaderboard: (limit: number = 50) =>
    apiFetch<MasterLeaderboardResponse>(`/api/master-leaderboard?limit=${encodeURIComponent(String(limit))}`),

  presencePing: (studentName: string) =>
    apiFetch<{ ok: boolean }>("/api/presence/ping", {
      method: "POST",
      body: JSON.stringify({ student_name: studentName }),
    }),

  getLiveUsers: (activeWithinSeconds: number = 300) =>
    apiFetch<LiveUser[]>(`/api/presence?active_within_seconds=${encodeURIComponent(String(activeWithinSeconds))}`),
};
