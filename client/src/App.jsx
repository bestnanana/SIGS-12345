import React, { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AUTH_EXPIRED_EVENT, api, clearAuthStorage, getToken, getAuthSource, setToken } from "./api";
import Layout from "./components/Layout";
import AdminPage from "./pages/AdminPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MyTicketsPage from "./pages/MyTicketsPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketFormPage from "./pages/TicketFormPage";
import TypicalIssuesPage from "./pages/TypicalIssuesPage";
import { useLanguage, useLocale, useLocaleNavigate } from "./i18n";

function isAdminRole(role) {
  return role === "admin" || role === "super_admin" || role === "liaison";
}

function hasAdminAccess(userData) {
  if (!userData) return false;
  return isAdminRole(userData.role) || userData.is_dept_admin;
}

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
  const { locale } = useLocale();
  const [user, setUser] = useState(readSavedUser);
  const [viewRole, setViewRole] = useState(() => localStorage.getItem("viewRole") || "");
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [authMessage, setAuthMessage] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const location = useLocation();
  const navigate = useLocaleNavigate();

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
    let ignore = false;
    const pathNoLocale = location.pathname.replace(/^\/(?:cn|en)/, "") || "/";
    const isLocalLogin = pathNoLocale === "/local/login" || location.pathname.endsWith("/local/login");

    // /local/login page: don't redirect, let user log in
    if (isLocalLogin) {
      setLoading(false);
      return () => { ignore = true; };
    }

    const token = getToken();
    if (!token) {
      // No token: clear any stale identity and let the backend redirect to SSO directly.
      clearAuthStorage();
      setUser(null);
      setViewRole("");
      setLoading(false);
      window.location.replace(`/sso/authorize-url?locale=${locale}&redirect=1`);
      return () => { ignore = true; };
    }

    api.get("/auth/me")
      .then((res) => {
        if (ignore) return;
        setUser(res.data);
        localStorage.setItem("user", JSON.stringify(res.data));
        if (!hasAdminAccess(res.data)) {
          localStorage.removeItem("viewRole");
          setViewRole("");
        }
      })
      .catch(() => {
        if (ignore) return;
        clearAuthStorage();
        setUser(null);
        setViewRole("");
        setAuthMessage("登录已失效，请重新登录");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => { ignore = true; };
  }, [location.pathname]);

  function handleLogin(payload) {
    setToken(payload.token, payload.authSource);
    localStorage.setItem("user", JSON.stringify(payload.user));
    if (payload.authSource) localStorage.setItem("authSource", payload.authSource);
    localStorage.removeItem("viewRole");
    setUser(payload.user);
    setViewRole("");
    setAuthMessage("");

    // 首次登录强制修改密码
    if (payload.must_change_password) {
      setMustChangePassword(true);
      navigate("/change-password", { replace: true });
      return;
    }

    const pathNoLocale = location.pathname.replace(/^\/(?:cn|en)/, "") || "/";
    const isLoginPage = pathNoLocale === "/local/login" || location.pathname.endsWith("/local/login");
    const target = isLoginPage
      ? (hasAdminAccess(payload.user) ? "/admin" : "/")
      : `${pathNoLocale}${location.search}${location.hash}`;
    navigate(target, { replace: true });
  }

  function handlePasswordChanged() {
    setMustChangePassword(false);
    const target = hasAdminAccess(user) ? "/admin" : "/";
    navigate(target, { replace: true });
  }

  async function handleLogout() {
    // 先调用后端 logout 接口清除 session
    try {
      await api.get("/auth/logout");
    } catch (e) {
      // 忽略错误
    }
    // 清除前端存储
    clearAuthStorage();
    setUser(null);
    setViewRole("");
    setAuthMessage("");
    // 跳转到后端的 SSO 登出接口（会重定向到统一身份认证注销页面）
    window.location.href = "/sso/logout";
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
    const pathNoLocale = location.pathname.replace(/^\/(?:cn|en)/, "") || "/";
    const isLocalLogin = pathNoLocale === "/local/login" || location.pathname.endsWith("/local/login");
    if (isLocalLogin) {
      return <LoginPage onLogin={handleLogin} authMessage={authMessage} />;
    }
    // Should have been redirected to SSO by now; show loading
    return <div className="flex min-h-screen items-center justify-center text-tsinghua-700">{t("common.loading")}</div>;
  }

  // 首次登录强制修改密码
  if (mustChangePassword) {
    return <ChangePasswordPage onSuccess={handlePasswordChanged} />;
  }

  const isAdmin = hasAdminAccess(user) && viewRole !== "user";
  const effectiveUser = viewRole === "user" ? { ...user, role: "user", actingRole: "user", is_dept_admin: false } : user;

  return (
    <Layout user={effectiveUser} actualUser={user} onLogout={handleLogout} onViewRoleChange={handleViewRoleChange}>
      <Routes location={location}>
        <Route path="/" element={isAdmin ? <Navigate to={`/${locale}/admin`} replace /> : <HomePage user={effectiveUser} />} />
        <Route path="/new" element={isAdmin ? <Navigate to={`/${locale}/admin`} replace /> : <TicketFormPage user={effectiveUser} />} />
        <Route path="/tickets" element={isAdmin ? <Navigate to={`/${locale}/admin`} replace /> : <MyTicketsPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage user={effectiveUser} />} />
        <Route path="/typical" element={<TypicalIssuesPage />} />
        <Route path="/admin/tickets/:id" element={isAdmin ? <AdminPage /> : <Navigate to={`/${locale}/`} replace />} />
        <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to={`/${locale}/`} replace />} />
        <Route path="/change-password" element={<ChangePasswordPage onSuccess={handlePasswordChanged} />} />
        <Route path="/local/login" element={<Navigate to={`/${locale}/`} replace />} />
        <Route path="*" element={<Navigate to={`/${locale}/`} replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
