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

export default function LoginPage() {
  const [firstName, setFirstName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const displayName = buildDisplayName(firstName, studentId);
  const initials = buildInitials(firstName, studentId);
  const showChip = firstName.trim().length > 0 || studentId.trim().length > 0;

  async function handleSubmit(e: FormEvent) {
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
      localStorage.setItem("studentName", displayName);
      navigate("/tasks");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">LT</div>
        <h2>AI Workshop</h2>
        <p>La Trobe University · Prompt Engineering &amp; Document AI<br />Enter your details to join the session.</p>

        <form onSubmit={handleSubmit}>
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

        <div className="login-err">{error}</div>
      </div>
    </div>
  );
}
