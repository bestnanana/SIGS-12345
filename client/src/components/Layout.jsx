import React, { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, UserRound } from "lucide-react";
import { useLocation } from "react-router-dom";
import { api } from "../api";
import { useLanguage, useLocale, useLocaleNavigate, LocaleLink, switchLocalePath } from "../i18n";
import { formatTime } from "../constants";

const userNavItems = [
  { labelKey: "nav.home", to: "/" },
  { labelKey: "nav.new", to: "/new" },
  { labelKey: "nav.myTickets", to: "/tickets" }
];

const adminNavItems = [
  { labelKey: "nav.admin", to: "/admin" }
];

function LogoMark() {
  return (
    <div className="tsinghua-logo flex items-center">
      <img
        src="/tsinghua-sigs-logo.png"
        alt="清华大学深圳国际研究生院"
        className="h-12 w-[180px] shrink-0 object-contain object-left lg:w-[228px]"
      />
      <div className="mx-4 hidden h-12 w-px shrink-0 bg-ai-border lg:mx-7 lg:block" />
      <div className="hidden min-w-0 shrink-0 lg:block">
        <div className="whitespace-nowrap text-[20px] font-semibold leading-6 tracking-tight text-ai-title">SIGS投诉即办</div>
        <div className="mt-1 whitespace-nowrap text-xs text-ai-muted">SIGS Prompt Complaint</div>
      </div>
    </div>
  );
}

function stripLocale(pathname) {
  return pathname.replace(/^\/(?:cn|en)/, "") || "/";
}

export default function Layout({ children, user, actualUser = user, onLogout, onViewRoleChange }) {
  const { t, locale } = useLanguage();
  const { otherLocale } = useLocale();
  const navigate = useLocaleNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const userMenuRef = useRef(null);
  const notifRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClick(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [userMenuOpen]);

  // Click-outside handler for notification dropdown
  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifOpen]);

  // Load notifications when dropdown opens
  async function loadNotifications() {
    setNotifLoading(true);
    try {
      const res = await api.get("/notifications", { params: { pageSize: 10 }, skipAuthExpiredHandler: true });
      setNotifications(res.data?.rows || []);
    } catch (_) {
      setNotifications([]);
    } finally {
      setNotifLoading(false);
    }
  }

  // Mark notification as read and navigate to target_url
  async function openNotification(notif) {
    setNotifOpen(false);
    try {
      await api.patch(`/notifications/${notif.id}/read`, {}, { skipAuthExpiredHandler: true });
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) => prev.map((n) => n.id === notif.id ? { ...n, is_read: 1 } : n));
    } catch (_) { /* ignore */ }
    navigate(notif.target_url.replace(/^\/cn/, "") || "/admin");
  }

  const isAdminLike = user.role === "admin" || user.role === "super_admin" || user.role === "liaison";

  // Poll unread notification count for admin users
  useEffect(() => {
    if (!isAdminLike) return;
    let cancelled = false;
    function fetchCount() {
      api.get("/notifications/unread-count", { skipAuthExpiredHandler: true })
        .then(res => { if (!cancelled) setUnreadCount(res.data?.count || 0); })
        .catch(() => {});
    }
    fetchCount();
    const timer = setInterval(fetchCount, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isAdminLike, user?.id]);

  const roleLabel = isAdminLike ? t(`role.${user.role}`) : t("role.user");
  const initial = (user.name || roleLabel || "U").trim().slice(0, 1).toUpperCase();
  const isActualAdmin = actualUser.role === "admin" || actualUser.role === "super_admin" || actualUser.role === "liaison";
  const isAdminArea = isAdminLike && stripLocale(location.pathname).startsWith("/admin");
  const navItems = isAdminArea ? [] : userNavItems;
  const mainClassName = isAdminArea
    ? "min-h-[calc(100vh-137px)] px-2 py-3 sm:px-4 sm:py-4 lg:min-h-[calc(100vh-72px)] lg:px-5"
    : "min-h-[calc(100vh-137px)] px-3 py-6 sm:px-6 sm:py-8 lg:min-h-[calc(100vh-84px)] lg:px-8";
  const contentClassName = isAdminArea
    ? "page-fade mx-auto w-full max-w-[1840px]"
    : "page-fade mx-auto w-full max-w-7xl";

  function isCurrent(item) {
    const current = stripLocale(location.pathname);
    if (item.to === "/") return current === "/";
    if (item.to === "/tickets") return current === "/tickets";
    return current.startsWith(item.to);
  }

  const switchLocaleUrl = switchLocalePath(locale, location.pathname);

  return (
    <div className="page-shell">
      <header className="tsinghua-header sticky top-0 z-20 border-b border-white/18">
        <div className={`mx-auto flex max-w-[1910px] items-center px-4 sm:px-6 lg:px-8 ${isAdminArea ? "h-[72px] gap-4" : "h-[84px] gap-6"}`}>
          <button onClick={() => navigate(isAdminLike ? "/admin" : "/")} className="min-w-0 shrink-0 text-left">
            <LogoMark />
          </button>

          <nav className="hidden flex-1 items-center justify-center gap-8 lg:flex">
            {navItems.map((item) => (
              <LocaleLink
                key={`${item.labelKey}-${item.to}`}
                to={item.to}
                className={[
                  "tsinghua-header-link",
                  isCurrent(item) ? "tsinghua-header-link-active" : ""
                ].join(" ")}
              >
                {t(item.labelKey)}
                {isCurrent(item) && <span className="motion-underline absolute bottom-0 left-1/2 h-1 w-9 -translate-x-1/2 rounded-t-full bg-white" />}
              </LocaleLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-5">
            <a
              href={switchLocaleUrl}
              className="hidden rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white/80 ring-1 ring-white/20 transition duration-200 hover:bg-white/20 hover:text-white sm:flex"
            >
              {otherLocale === "en" ? "EN" : "中"}
            </a>
            {isAdminLike && (
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => { setNotifOpen((o) => !o); if (!notifOpen) loadNotifications(); }}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition duration-200 hover:bg-white/20 hover:text-white"
                  title={t("action.notifications")}
                >
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-tsinghua-800">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="motion-popover absolute right-0 mt-3 w-80 rounded-xl border border-ai-border bg-white shadow-[0_12px_30px_rgba(17,17,17,0.10)]">
                    <div className="flex items-center justify-between border-b border-ai-border px-3 py-2">
                      <span className="text-sm font-semibold text-ai-title">{t("action.notifications")}</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {notifLoading ? (
                        <div className="px-3 py-8 text-center text-sm text-ai-muted">加载中...</div>
                      ) : notifications.length === 0 ? (
                        <div className="px-3 py-8 text-center text-sm text-ai-muted">暂无通知</div>
                      ) : (
                        notifications.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => openNotification(item)}
                            className={`w-full border-b border-ai-border/60 px-3 py-2.5 text-left transition duration-200 hover:bg-ai-bg ${
                              !item.is_read ? "bg-ai-primary/[0.04]" : ""
                            }`}
                          >
                            <div className={`text-sm leading-snug ${!item.is_read ? "font-semibold text-ai-title" : "text-ai-body"}`}>
                              {item.message}
                            </div>
                            <div className="mt-1 text-xs text-ai-muted">{formatTime(item.created_at)}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen((open) => !open)}
                className="flex items-center gap-3 text-left"
              >
                <div className="tsinghua-header-pill flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold">
                  {initial || <UserRound size={18} />}
                </div>
                <div className="hidden leading-tight sm:block">
                  <div className="text-sm font-semibold text-white">{user.name}</div>
                  <div className="mt-0.5 text-xs text-white/70">{roleLabel}</div>
                </div>
                <ChevronDown size={16} className="hidden text-white/72 sm:block" />
              </button>
              {userMenuOpen && (
                <div className="motion-popover absolute right-0 mt-3 w-48 rounded-xl border border-ai-border bg-white p-1 shadow-[0_12px_30px_rgba(17,17,17,0.08)]">
                  <div className="border-b border-ai-border px-3 py-2">
                    <div className="truncate text-sm font-semibold text-ai-title">{user.name}</div>
                  </div>
                  {isActualAdmin ? (
                    <div className="border-b border-ai-border p-1">
                      <div className="px-2 py-1 text-xs font-semibold text-ai-muted">{t("action.switchRole")}</div>
                      <button
                        type="button"
                        onClick={() => {
                          onViewRoleChange?.("admin");
                          setUserMenuOpen(false);
                          navigate("/admin");
                        }}
                        className={`h-9 w-full rounded-lg px-3 text-left text-sm transition duration-200 ${
                          user.role !== "user" ? "bg-ai-primary/10 text-ai-primary" : "text-ai-body hover:bg-[#F6F6FA] hover:text-ai-title"
                        }`}
                      >
                        {t("action.adminIdentity")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onViewRoleChange?.("user");
                          setUserMenuOpen(false);
                          navigate("/");
                        }}
                        className={`h-9 w-full rounded-lg px-3 text-left text-sm transition duration-200 ${
                          user.role === "user" ? "bg-ai-primary/10 text-ai-primary" : "text-ai-body hover:bg-[#F6F6FA] hover:text-ai-title"
                        }`}
                      >
                        {t("action.userIdentity")}
                      </button>
                    </div>
                  ) : null}
                  <div className="border-b border-ai-border p-1 sm:hidden">
                    <div className="px-2 py-1 text-xs font-semibold text-ai-muted">Language</div>
                    <a
                      href={switchLocaleUrl}
                      className="flex h-9 w-full items-center rounded-lg px-3 text-sm text-ai-body transition duration-200 hover:bg-[#F6F6FA] hover:text-ai-title"
                    >
                      {otherLocale === "en" ? "English" : "中文"}
                    </a>
                  </div>
                  <button
                    onClick={onLogout}
                    className="h-9 w-full rounded-lg px-3 text-left text-sm text-ai-body transition duration-200 hover:bg-[#F6F6FA] hover:text-ai-title"
                  >
                    {t("action.logout")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto border-t border-white/20 px-3 py-2 lg:hidden">
          {navItems.map((item) => {
            const active = isCurrent(item);
            return (
              <LocaleLink
                key={`mobile-${item.labelKey}-${item.to}`}
                to={item.to}
                className={`flex h-10 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition duration-200 ${
                  active
                    ? "bg-white text-tsinghua-800 shadow-[0_8px_20px_rgba(26,8,49,0.18)]"
                    : "bg-white/10 text-white/75 ring-1 ring-white/20 hover:bg-white/20 hover:text-white"
                }`}
              >
                {t(item.labelKey)}
              </LocaleLink>
            );
          })}
        </nav>
      </header>

      <main className={mainClassName}>
        <div className={contentClassName}>{children}</div>
      </main>
    </div>
  );
}
