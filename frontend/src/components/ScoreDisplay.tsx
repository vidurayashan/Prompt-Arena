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
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none", marginTop: "1rem" }}
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
    </div>
  );
}
