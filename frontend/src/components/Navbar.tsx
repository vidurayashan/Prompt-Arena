import { useNavigate } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();
  const name = localStorage.getItem("studentName") ?? "";

  function handleLogout() {
    localStorage.removeItem("studentName");
    navigate("/");
  }

  return (
    <nav className="navbar">
      <span className="navbar-brand" style={{ cursor: "pointer" }} onClick={() => navigate("/tasks")}>
        Prompt Arena
      </span>
      {name && (
        <>
          <span className="navbar-user">Logged in as <strong>{name}</strong></span>
          <button className="btn btn-ghost" onClick={handleLogout} style={{ padding: ".35rem .8rem", fontSize: ".8rem" }}>
            Log out
          </button>
        </>
      )}
    </nav>
  );
}
