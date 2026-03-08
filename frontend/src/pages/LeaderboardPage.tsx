import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { LeaderboardEntry } from "../api";
import Navbar from "../components/Navbar";

function medal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return String(rank);
}

function scoreColor(score: number): string {
  if (score >= 80) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}


export default function LeaderboardPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const studentName = localStorage.getItem("studentName") ?? "";

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [taskName, setTaskName] = useState("");

  useEffect(() => {
    if (!taskId) return;

    Promise.all([api.getLeaderboard(taskId), api.getTask(taskId)])
      .then(([lb, task]) => {
        setEntries(lb);
        setTaskName(task.name);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load leaderboard")
      )
      .finally(() => setLoading(false));
  }, [taskId]);

  return (
    <>
      <Navbar />
      <div className="page">
        <div className="flex items-center gap-2 mb-2">
          <button
            className="btn btn-ghost"
            style={{ padding: ".3rem .7rem", fontSize: ".82rem" }}
            onClick={() => navigate(`/tasks/${taskId}`)}
          >
            ← Back to task
          </button>
        </div>

        <h1>Leaderboard</h1>
        {taskName && (
          <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>{taskName}</p>
        )}

        {loading && <div className="spinner" />}
        {error && <div className="error-msg">{error}</div>}

        {!loading && !error && entries.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "2.5rem" }}>
            <p style={{ color: "var(--text-muted)" }}>
              No submissions yet. Be the first to complete this task!
            </p>
            <button className="btn btn-primary mt-2" onClick={() => navigate(`/tasks/${taskId}`)}>
              Start task
            </button>
          </div>
        )}

        {entries.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th style={{ width: "60px" }}>Rank</th>
                  <th>Name</th>
                  <th style={{ width: "130px" }}>Best score</th>
                  <th style={{ width: "130px" }}>Latest</th>
                  <th style={{ width: "90px" }}>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const rank = idx + 1;
                  const isMe = entry.student_name === studentName;
                  const trendUp = entry.latest_score === entry.best_score && entry.attempts > 1;
                  return (
                    <tr
                      key={entry.student_name}
                      style={
                        isMe
                          ? { background: "var(--primary-light)", fontWeight: 600 }
                          : undefined
                      }
                    >
                      <td>
                        <span className="rank-medal">{medal(rank)}</span>
                      </td>
                      <td>
                        {entry.student_name}
                        {isMe && (
                          <span
                            style={{
                              marginLeft: ".5rem",
                              fontSize: ".75rem",
                              color: "var(--primary)",
                              fontWeight: 600,
                            }}
                          >
                            (you)
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            fontWeight: 700,
                            color: scoreColor(entry.best_score),
                            fontSize: "1rem",
                          }}
                        >
                          {entry.best_score}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>/100</span>
                        {trendUp && (
                          <span style={{ color: "var(--success)", fontSize: ".8rem", marginLeft: ".35rem" }}>
                            ↑
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          style={{
                            fontWeight: 600,
                            color: scoreColor(entry.latest_score),
                            fontSize: ".95rem",
                          }}
                        >
                          {entry.latest_score}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>/100</span>
                        {entry.latest_score < entry.best_score && (
                          <span style={{ color: "var(--danger)", fontSize: ".8rem", marginLeft: ".35rem" }}>↓</span>
                        )}
                        {entry.latest_score === entry.best_score && entry.attempts > 1 && (
                          <span style={{ color: "var(--success)", fontSize: ".8rem", marginLeft: ".35rem" }}>↑</span>
                        )}
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>{entry.attempts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2 mt-3" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={() => navigate("/tasks")}>
            All tasks
          </button>
          <button className="btn btn-primary" onClick={() => navigate(`/tasks/${taskId}`)}>
            Try again
          </button>
        </div>
      </div>
    </>
  );
}
