import React, { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import Layout from "./components/Layout";
import AdminPage from "./pages/AdminPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MyTicketsPage from "./pages/MyTicketsPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketFormPage from "./pages/TicketFormPage";
import TypicalIssuesPage from "./pages/TypicalIssuesPage";

function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("token")));
  const location = useLocation();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    api.get("/auth/me")
      .then((res) => {
        setUser(res.data);
        localStorage.setItem("user", JSON.stringify(res.data));
      })
      .catch(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleLogin(payload) {
    localStorage.setItem("token", payload.token);
    localStorage.setItem("user", JSON.stringify(payload.user));
    setUser(payload.user);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-tsinghua-700">系统加载中...</div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <Layout user={user} onLogout={handleLogout}>
      <Routes location={location}>
        <Route path="/" element={<HomePage user={user} />} />
        <Route path="/new" element={<TicketFormPage user={user} />} />
        <Route path="/tickets" element={<MyTicketsPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage user={user} />} />
        <Route path="/typical" element={<TypicalIssuesPage />} />
        <Route
          path="/admin"
          element={user.role === "admin" ? <AdminPage /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
