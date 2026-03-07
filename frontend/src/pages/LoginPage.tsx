import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function LoginPage() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter a name.");
      return;
    }
    setLoading(true);
    try {
      await api.login(trimmed);
      localStorage.setItem("studentName", trimmed);
      navigate("/tasks");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "var(--bg)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div
          style={{
            fontSize: "2.5rem",
            fontWeight: 800,
            color: "var(--primary)",
            letterSpacing: "-1px",
          }}
        >
          Prompt Arena
        </div>
        <p style={{ color: "var(--text-muted)", marginTop: ".4rem" }}>
          Practice prompt engineering with real documents
        </p>
      </div>

      <div className="card" style={{ width: "100%", maxWidth: "380px" }}>
        <h2 style={{ marginBottom: "1.25rem" }}>Enter your name to begin</h2>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label htmlFor="name">Your temporary name</label>
            <input
              id="name"
              className="input"
              type="text"
              placeholder="e.g. Alex, Student42…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Joining…" : "Start →"}
          </button>
        </form>
        <p style={{ fontSize: ".78rem", color: "var(--text-muted)", marginTop: "1rem", textAlign: "center" }}>
          No password required. Your name is used only for the leaderboard.
        </p>
      </div>
    </div>
  );
}
