import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearSession, isAdminSession } from "../api";

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function getPublishedTotalScore(publishedIds: string[]): number {
  try {
    const stored = JSON.parse(localStorage.getItem("taskBests") || "{}") as Record<string, number>;
    return publishedIds.reduce((sum, id) => sum + (Number(stored[id]) || 0), 0);
  } catch {
    return 0;
  }
}

export default function Navbar() {
  const navigate = useNavigate();
  const name = localStorage.getItem("studentName") ?? "";
  const admin = isAdminSession();
  const [publishedTaskIds, setPublishedTaskIds] = useState<string[]>([]);
  const initials = name ? getInitials(name) : admin ? "AD" : "?";
  const totalScore = getPublishedTotalScore(publishedTaskIds);

  useEffect(() => {
    if (admin) return;
    let cancelled = false;
    api
      .listTasks()
      .then((tasks) => {
        if (!cancelled) setPublishedTaskIds(tasks.map((t) => t.id));
      })
      .catch(() => {
        if (!cancelled) setPublishedTaskIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [admin]);

  function handleLogout() {
    clearSession();
    navigate("/");
  }

  return (
    <nav className="lt-nav">
      <div className="nav-brand" onClick={() => navigate("/tasks")}>
        <div className="nav-logo">LT</div>
        <div>
          <div className="nav-title">La Trobe University</div>
          <div className="nav-sub">AI Workshop</div>
        </div>
      </div>

      {(name || admin) && (
        <div className="nav-right">
          <div className="nav-user-chip">
            <div className="nav-av">{initials}</div>
            <span className="nav-uname">{admin ? "Admin" : name}</span>
            {admin && (
              <span
                style={{
                  marginLeft: "6px",
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--red, #c8102e)",
                  background: "var(--red-l, #fde8ec)",
                  border: "1px solid var(--red-b, #f5c2cb)",
                  borderRadius: "4px",
                  padding: "2px 6px",
                }}
              >
                Admin
              </span>
            )}
          </div>
          {!admin && <span className="nav-score">{totalScore} pts</span>}
          <button className="logout-btn" onClick={handleLogout}>
            {admin ? "Sign out" : "Leave"}
          </button>
        </div>
      )}
    </nav>
  );
}
