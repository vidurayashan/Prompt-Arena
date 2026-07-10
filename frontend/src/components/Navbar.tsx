import { useNavigate } from "react-router-dom";
import { clearSession, isAdminSession } from "../api";

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function getTotalScore(): number {
  try {
    const stored = JSON.parse(localStorage.getItem("taskBests") || "{}") as Record<string, number>;
    return Object.values(stored).reduce((sum, v) => sum + v, 0);
  } catch {
    return 0;
  }
}

export default function Navbar() {
  const navigate = useNavigate();
  const name = localStorage.getItem("studentName") ?? "";
  const admin = isAdminSession();
  const totalScore = getTotalScore();
  const initials = name ? getInitials(name) : admin ? "AD" : "?";

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
