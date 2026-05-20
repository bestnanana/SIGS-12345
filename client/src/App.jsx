import React, { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AUTH_EXPIRED_EVENT, api, clearAuthStorage } from "./api";
import Layout from "./components/Layout";
import AdminPage from "./pages/AdminPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MyTicketsPage from "./pages/MyTicketsPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketFormPage from "./pages/TicketFormPage";
import TypicalIssuesPage from "./pages/TypicalIssuesPage";
import { useLanguage } from "./i18n";

function readSavedUser() {
  const saved = localStorage.getItem("user");
  if (!saved || saved === "undefined" || saved === "null") return null;
  try {
    return JSON.parse(saved);
  } catch (error) {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    return null;
  }
}

function App() {
  const { t } = useLanguage();
  const [user, setUser] = useState(readSavedUser);
  const [viewRole, setViewRole] = useState(() => localStorage.getItem("viewRole") || "");
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("token")));
  const [authMessage, setAuthMessage] = useState("");
  const location = useLocation();

  useEffect(() => {
    function handleAuthExpired(event) {
      clearAuthStorage();
      setUser(null);
      setViewRole("");
      setAuthMessage(event.detail?.message || "登录已失效，请重新登录");
      setLoading(false);
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

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
        if (res.data.role !== "admin") {
          localStorage.removeItem("viewRole");
          setViewRole("");
        }
      })
      .catch(() => {
        clearAuthStorage();
        setUser(null);
        setViewRole("");
        setAuthMessage("登录已失效，请重新登录");
      })
      .finally(() => setLoading(false));
  }, []);

  function handleLogin(payload) {
    localStorage.setItem("token", payload.token);
    localStorage.setItem("user", JSON.stringify(payload.user));
    localStorage.removeItem("viewRole");
    setUser(payload.user);
    setViewRole("");
    setAuthMessage("");
  }

  function handleLogout() {
    clearAuthStorage();
    setUser(null);
    setViewRole("");
    setAuthMessage("");
  }

  function handleViewRoleChange(nextRole) {
    if (nextRole === "user") {
      localStorage.setItem("viewRole", "user");
      setViewRole("user");
      return;
    }
    localStorage.removeItem("viewRole");
    setViewRole("");
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-tsinghua-700">{t("common.loading")}</div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} authMessage={authMessage} />;
  }

  const isAdmin = user.role === "admin" && viewRole !== "user";
  const effectiveUser = viewRole === "user" ? { ...user, role: "user", actingRole: "user" } : user;

  return (
    <Layout user={effectiveUser} actualUser={user} onLogout={handleLogout} onViewRoleChange={handleViewRoleChange}>
      <Routes location={location}>
        <Route path="/" element={isAdmin ? <Navigate to="/admin" replace /> : <HomePage user={effectiveUser} />} />
        <Route path="/new" element={isAdmin ? <Navigate to="/admin" replace /> : <TicketFormPage user={effectiveUser} />} />
        <Route path="/tickets" element={isAdmin ? <Navigate to="/admin" replace /> : <MyTicketsPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage user={effectiveUser} />} />
        <Route path="/typical" element={<TypicalIssuesPage />} />
        <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
