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

export interface GetStudentPromptsParams {
  taskId?: string;
  student?: string;
  limit?: number;
  offset?: number;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
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

  listTasks: () => apiFetch<Task[]>("/api/tasks"),

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
    return apiFetch<StudentPromptEntry[]>(`/api/student-prompts${q ? `?${q}` : ""}`);
  },

  getMasterLeaderboard: (limit: number = 50) =>
    apiFetch<MasterLeaderboardEntry[]>(`/api/master-leaderboard?limit=${encodeURIComponent(String(limit))}`),
};
