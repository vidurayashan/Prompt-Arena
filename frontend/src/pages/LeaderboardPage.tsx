import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { LeaderboardEntry } from "../api";
import Navbar from "../components/Navbar";

function rankClass(rank: number): string {
  if (rank === 1) return "lb-rank r1";
  if (rank === 2) return "lb-rank r2";
  if (rank === 3) return "lb-rank r3";
  return "lb-rank";
}

function rankLabel(rank: number): string {
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

  const totalAttempts = entries.reduce((sum, e) => sum + e.attempts, 0);
  const topScore = entries.length > 0 ? entries[0].best_score : 0;

  return (
    <>
      <Navbar />

      {/* Mini hero */}
      <div className="hero" style={{ padding: "1.8rem 2rem 1.4rem" }}>
        <div className="hero-inner">
          <p className="hero-ey">Live Rankings</p>
          <h1 style={{ fontSize: "clamp(1.3rem,3vw,1.9rem)" }}>
            {taskName || "Leaderboard"}
          </h1>
        </div>
      </div>

      <div className="page">
        {/* Back link */}
        <div style={{ marginBottom: "1.2rem" }}>
          <button
            className="btn btn-ghost"
            style={{ padding: ".3rem .7rem", fontSize: ".82rem" }}
            onClick={() => navigate(`/tasks/${taskId}`)}
          >
            ← Back to activity
          </button>
        </div>

        {loading && <div className="spinner" />}
        {error && <div className="error-msg">{error}</div>}

        {!loading && !error && (
          <>
            {/* Stats row */}
            {entries.length > 0 && (
              <div className="stats-row">
                <div className="stat-card">
                  <div className="stat-val">{entries.length}</div>
                  <div className="stat-lbl">Students</div>
                </div>
                <div className="stat-card">
                  <div className="stat-val">{totalAttempts}</div>
                  <div className="stat-lbl">Submissions</div>
                </div>
                <div className="stat-card">
                  <div className="stat-val">{topScore}</div>
                  <div className="stat-lbl">Top score</div>
                </div>
                <div className="stat-card">
                  <div className="stat-val">
                    {entries.length > 0
                      ? Math.round(entries.reduce((s, e) => s + e.best_score, 0) / entries.length)
                      : 0}
                  </div>
                  <div className="stat-lbl">Avg score</div>
                </div>
              </div>
            )}

            {entries.length === 0 ? (
              <div className="lb-wrap">
                <div className="lb-head">
                  <h3>Rankings</h3>
                  <span>No submissions yet</span>
                </div>
                <div className="lb-empty">
                  No submissions yet. Be the first to complete this activity!
                </div>
              </div>
            ) : (
              <div className="lb-wrap">
                <div className="lb-head">
                  <h3>Rankings</h3>
                  <span>{entries.length} student{entries.length !== 1 ? "s" : ""}</span>
                </div>

                {entries.map((entry, idx) => {
                  const rank = idx + 1;
                  const isMe = entry.student_name === studentName;
                  return (
                    <div
                      key={entry.student_name}
                      className={`lb-row${isMe ? " me" : ""}`}
                    >
                      <span className={rankClass(rank)}>{rankLabel(rank)}</span>

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
                        <div className="lb-sub">{entry.attempts} attempt{entry.attempts !== 1 ? "s" : ""}</div>
                      </div>

                      <div className="lb-score" style={{ color: scoreColor(entry.best_score) }}>
                        {entry.best_score}
                        <span style={{ fontSize: "11px", color: "var(--ink4)", fontWeight: 400 }}>/100</span>
                      </div>

                      <div className="lb-acts" style={{ color: scoreColor(entry.latest_score) }}>
                        {entry.latest_score}
                        <span style={{ fontSize: "11px", color: "var(--ink4)", fontWeight: 400 }}>/100</span>
                      </div>

                      <div className="lb-acts">
                        {entry.latest_score < entry.best_score && (
                          <span style={{ color: "var(--danger)", fontSize: ".85rem" }}>↓</span>
                        )}
                        {entry.latest_score === entry.best_score && entry.attempts > 1 && (
                          <span style={{ color: "var(--success)", fontSize: ".85rem" }}>↑</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="btn btn-ghost" onClick={() => navigate("/tasks")}>
                All activities
              </button>
              <button className="btn btn-primary" onClick={() => navigate(`/tasks/${taskId}`)}>
                Try again →
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
