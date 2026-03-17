import { useState } from "react";
import type { SubmitResponse } from "../api";

interface Props {
  result: SubmitResponse;
}

function rowClass(score: number): string {
  if (score >= 9) return "score-item-row full";
  if (score >= 5) return "score-item-row partial";
  return "score-item-row zero";
}

export default function ScoreDisplay({ result }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  function pct(score: number, max: number): string {
    if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return "—";
    return `${Math.round((score / max) * 100)}%`;
  }

  return (
    <div>
      {/* Total score header */}
      <div className="score-header">
        <div>
          <div className="score-big">{result.total}</div>
          <div className="score-label">out of 100</div>
        </div>
        <div>
          {result.is_new_best ? (
            <div className="score-new-best">New personal best!</div>
          ) : (
            <div style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>
              Your best: {result.previous_best ?? result.total}
            </div>
          )}
          <div style={{ fontSize: ".85rem", color: "var(--text-muted)", marginTop: ".25rem" }}>
            {result.scores.length} item{result.scores.length !== 1 ? "s" : ""} graded
          </div>
        </div>
      </div>

      {/* Per-item breakdown */}
      {result.scores.length === 0 ? (
        <div style={{ marginTop: "1rem" }}>
          {result.judge_breakdown && Object.keys(result.judge_breakdown).length > 0 ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "0.75rem",
                background: "var(--bg-subtle, #f8f9fa)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: ".35rem" }}>Judge breakdown</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr max-content", gap: ".35rem .75rem", fontSize: ".9rem" }}>
                {Object.entries(result.judge_breakdown).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <div style={{ color: "var(--text-muted)", fontWeight: 600 }}>{k}</div>
                    <div style={{ fontWeight: 700 }}>{pct(v.score, v.max)}</div>
                  </div>
                ))}
              </div>
              {result.judge_feedback && (
                <div style={{ marginTop: ".6rem", fontSize: ".9rem" }}>
                  <div style={{ fontWeight: 700, marginBottom: ".2rem" }}>Feedback</div>
                  <div style={{ color: "var(--text-muted)" }}>{result.judge_feedback}</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>
              Scored by AI judge (no per-item breakdown for this task).
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              userSelect: "none",
              marginTop: "1rem",
            }}
            onClick={() => setCollapsed((c) => !c)}
          >
            <h3 style={{ margin: 0 }}>Score breakdown</h3>
            <span style={{ color: "var(--text-muted)", fontSize: ".85rem" }}>
              {collapsed ? "▶ show" : "▼ hide"}
            </span>
          </div>
          {!collapsed && (
            <div className="score-items mt-1">
              {result.scores.map((s) => (
                <div key={s.item_id} className={rowClass(s.score)}>
                  <div className="score-item-top">
                    <span className="score-item-label">
                      {s.item_id}. {s.label}
                    </span>
                    <span className="score-item-pts">{s.score}/10</span>
                  </div>
                  {(s.found || s.correct_answer) && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "max-content 1fr",
                        columnGap: ".6rem",
                        rowGap: ".15rem",
                        margin: ".35rem 0 .2rem",
                        fontSize: ".82rem",
                      }}
                    >
                      {s.found && (
                        <>
                          <span style={{ color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>Found:</span>
                          <span style={{ color: "var(--text)" }}>{s.found}</span>
                        </>
                      )}
                      {s.correct_answer && (
                        <>
                          <span style={{ color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>Expected:</span>
                          <span style={{ color: "var(--text)", fontWeight: 600 }}>{s.correct_answer}</span>
                        </>
                      )}
                    </div>
                  )}
                  <div className="score-item-reason">{s.reason}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
