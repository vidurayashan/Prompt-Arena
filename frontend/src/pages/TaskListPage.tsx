import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Task } from "../api";
import Navbar from "../components/Navbar";

export default function TaskListPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const studentName = localStorage.getItem("studentName") ?? "";

  useEffect(() => {
    api
      .listTasks()
      .then(setTasks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load tasks"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="page">
        <h1>Available Tasks</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>
          Welcome, <strong>{studentName}</strong>. Select a task below to get started.
        </p>

        {loading && <div className="spinner" />}
        {error && <div className="error-msg">{error}</div>}

        {!loading && !error && tasks.length === 0 && (
          <p style={{ color: "var(--text-muted)" }}>No tasks available yet.</p>
        )}

        <div className="task-grid">
          {tasks.map((task) => (
            <div className="task-card" key={task.id}>
              <div className="task-card-info">
                <div className="task-card-title">{task.name}</div>
                <div className="task-card-desc">{task.description}</div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                Start
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
