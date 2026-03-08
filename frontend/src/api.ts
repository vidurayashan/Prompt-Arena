/** Typed fetch helpers for the Prompt Arena backend API. */

export interface Task {
  id: string;
  name: string;
  description: string;
}

export interface TaskItem {
  id: number;
  label: string;
}

export interface TaskDetail extends Task {
  document_filename: string;
  task_model: string;
  judge_persona: string;
  items: TaskItem[];
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

  getLeaderboard: (taskId: string) =>
    apiFetch<LeaderboardEntry[]>(`/api/tasks/${taskId}/leaderboard`),

  getHistory: (taskId: string, studentName: string) =>
    apiFetch<SubmissionAttempt[]>(
      `/api/tasks/${taskId}/history?student=${encodeURIComponent(studentName)}`
    ),
};
