import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

function buildDisplayName(firstName: string, studentId: string): string {
  const fn = firstName.trim();
  const sid = studentId.trim();
  if (fn && sid) return `${fn} (${sid})`;
  return fn || sid;
}

function buildInitials(firstName: string, studentId: string): string {
  const fn = firstName.trim();
  const sid = studentId.trim();
  const a = fn ? fn[0].toUpperCase() : "";
  const b = sid ? sid[0].toUpperCase() : "";
  return (a + b) || "?";
}

type LoginMode = "student" | "admin";

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("student");
  const [firstName, setFirstName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const displayName = buildDisplayName(firstName, studentId);
  const initials = buildInitials(firstName, studentId);
  const showChip = firstName.trim().length > 0 || studentId.trim().length > 0;

  async function handleStudentSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!firstName.trim()) {
      setError("Please enter your first name.");
      return;
    }
    if (!studentId.trim()) {
      setError("Please enter your student ID.");
      return;
    }
    if (!/^\d+$/.test(studentId.trim())) {
      setError("Student ID must be numbers only.");
      return;
    }
    setLoading(true);
    try {
      await api.login(displayName);
      localStorage.removeItem("adminToken");
      localStorage.removeItem("role");
      localStorage.setItem("studentName", displayName);
      navigate("/tasks");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!adminUsername.trim()) {
      setError("Please enter the admin username.");
      return;
    }
    if (!adminPassword) {
      setError("Please enter the admin password.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.adminLogin(adminUsername.trim(), adminPassword);
      localStorage.removeItem("studentName");
      localStorage.removeItem("taskBests");
      localStorage.setItem("adminToken", res.token);
      localStorage.setItem("role", "admin");
      localStorage.setItem("studentName", res.display_name || "Admin");
      navigate("/tasks");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Admin login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">LT</div>
        <h2>AI Workshop</h2>
        <p>
          {mode === "student" ? (
            <>
              La Trobe University · Prompt Engineering &amp; Document AI
              <br />
              Enter your details to join the session.
            </>
          ) : (
            <>
              Lecturer / admin access
              <br />
              Sign in to publish activities and view student prompts.
            </>
          )}
        </p>

        {mode === "student" ? (
          <form onSubmit={handleStudentSubmit}>
            <div className="lf">
              <label htmlFor="firstName">First name</label>
              <input
                id="firstName"
                type="text"
                placeholder="e.g. Sarah"
                maxLength={30}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
                autoComplete="given-name"
              />
            </div>

            <div className="lf">
              <label htmlFor="studentId">Student ID</label>
              <input
                id="studentId"
                type="text"
                placeholder="e.g. 12345678"
                maxLength={12}
                value={studentId}
                onChange={(e) => setStudentId(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
              />
            </div>

            <div className={`display-chip${showChip ? " visible" : ""}`}>
              <div className="dc-av">{initials}</div>
              <div className="dc-info">
                <div className="dc-name">{displayName || "—"}</div>
                <div className="dc-hint">Your display name on the leaderboard</div>
              </div>
            </div>

            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? "Joining…" : "Join Workshop →"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleAdminSubmit}>
            <div className="lf">
              <label htmlFor="adminUsername">Username</label>
              <input
                id="adminUsername"
                type="text"
                placeholder="admin"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="lf">
              <label htmlFor="adminPassword">Password</label>
              <input
                id="adminPassword"
                type="password"
                placeholder="••••••••"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Admin sign in →"}
            </button>
          </form>
        )}

        <div className="login-err">{error}</div>

        <button
          type="button"
          className="btn btn-ghost"
          style={{
            width: "100%",
            marginTop: "1rem",
            fontSize: "13px",
            color: "var(--ink3, #6b7280)",
          }}
          onClick={() => {
            setMode(mode === "student" ? "admin" : "student");
            setError("");
          }}
        >
          {mode === "student" ? "Admin login" : "← Back to student login"}
        </button>
      </div>
    </div>
  );
}
