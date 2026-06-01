import React, { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, UserRound, LogOut, Globe, Shield } from "lucide-react";
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
    <div className="tsinghua-logo flex items-center gap-3">
      <img
        src="/tsinghua-sigs-logo.png"
        alt="清华大学深圳国际研究生院"
        className="h-8 w-auto shrink-0 object-contain object-left"
      />
      <div className="hidden h-6 w-px shrink-0 bg-white/20 lg:block" />
      <div className="hidden min-w-0 shrink-0 lg:block">
        <div className="whitespace-nowrap text-[15px] font-semibold leading-tight tracking-tight text-white">
          SIGS投诉即办
        </div>
        <div className="mt-0.5 whitespace-nowrap text-[10px] text-white/65">
          SIGS Prompt Complaint
        </div>
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
    ? "min-h-[calc(100vh-72px)] px-3 py-4 sm:px-5 sm:py-5 lg:px-6"
    : "min-h-[calc(100vh-80px)] px-4 py-6 sm:px-6 sm:py-8 lg:px-8";
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
      {/* 顶部装饰条 2px */}
      <div className="h-[2px] bg-gradient-to-r from-tsinghua-400 via-tsinghua-300 to-tsinghua-400" />
      
      {/* 主体栏 64px */}
      <header className="tsinghua-header sticky top-0 z-20">
        <div className={`relative mx-auto flex max-w-[1920px] items-center px-4 sm:px-6 lg:px-8 ${isAdminArea ? "h-[64px] gap-3" : "h-[64px] gap-4"}`}>
          <button 
            onClick={() => navigate(isAdminLike ? "/admin" : "/")} 
            className="group relative z-10 shrink-0 text-left transition-opacity duration-300 hover:opacity-90"
          >
            <LogoMark />
          </button>

          <nav className="hidden flex-1 items-center justify-center gap-0 lg:flex">
            {navItems.map((item) => {
              const active = isCurrent(item);
              return (
                <LocaleLink
                  key={`${item.labelKey}-${item.to}`}
                  to={item.to}
                  className={`relative flex h-[64px] w-[72px] items-center justify-center text-[16px] transition-all duration-300 ${
                    active 
                      ? "bg-white font-semibold text-tsinghua-700" 
                      : "font-medium text-white/75 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {t(item.labelKey)}
                </LocaleLink>
              );
            })}
          </nav>

          <div className="relative z-10 ml-auto flex shrink-0 items-center gap-3">
            {/* 语言切换 90×16px */}
            <a
              href={switchLocaleUrl}
              className="hidden h-[32px] w-[90px] items-center justify-center gap-1.5 rounded-lg bg-white/10 text-[14px] font-medium text-white/80 backdrop-blur-sm transition-all duration-300 hover:bg-white/20 hover:text-white sm:flex"
            >
              <Globe size={14} />
              {otherLocale === "en" ? "English" : "中文"}
            </a>

            {isAdminLike && (
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => { setNotifOpen((o) => !o); if (!notifOpen) loadNotifications(); }}
                  className="relative flex h-[32px] w-[32px] items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-all duration-300 hover:bg-white/20 hover:text-white"
                  title={t("action.notifications")}
                >
                  <Bell size={16} />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white shadow-lg">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="motion-popover absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-ai-border bg-white shadow-soft-lg">
                    <div className="border-b border-ai-border bg-ai-bg/50 px-4 py-3">
                      <span className="text-sm font-semibold text-ai-title">{t("action.notifications")}</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {notifLoading ? (
                        <div className="px-4 py-8 text-center text-sm text-ai-muted">
                          <div className="mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-ai-primary border-t-transparent" />
                          加载中...
                        </div>
                      ) : notifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-ai-muted">
                          <Bell size={24} className="mx-auto mb-2 opacity-30" />
                          暂无通知
                        </div>
                      ) : (
                        notifications.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => openNotification(item)}
                            className={`w-full border-b border-ai-border/60 px-4 py-3 text-left transition-all duration-200 hover:bg-ai-bg ${
                              !item.is_read ? "bg-ai-primary/[0.03]" : ""
                            }`}
                          >
                            <div className={`text-sm leading-snug ${!item.is_read ? "font-semibold text-ai-title" : "text-ai-body"}`}>
                              {item.message}
                            </div>
                            <div className="mt-1.5 text-xs text-ai-muted">{formatTime(item.created_at)}</div>
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
                className="flex items-center gap-2 rounded-lg p-1.5 transition-all duration-300 hover:bg-white/10"
              >
                <div className="tsinghua-header-pill flex h-[28px] w-[28px] items-center justify-center rounded-full text-[12px] font-semibold">
                  {initial || <UserRound size={14} />}
                </div>
                <div className="hidden text-left leading-tight sm:block">
                  <div className="text-[13px] font-medium text-white">{user.name}</div>
                  <div className="mt-0.5 text-[10px] text-white/55">{roleLabel}</div>
                </div>
                <ChevronDown size={12} className="hidden text-white/55 transition-transform duration-300 sm:block" style={{ transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0)' }} />
              </button>

              {userMenuOpen && (
                <div className="motion-popover absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-ai-border bg-white shadow-soft-lg">
                  <div className="border-b border-ai-border bg-gradient-to-r from-ai-primary/5 to-transparent px-4 py-3">
                    <div className="truncate text-sm font-semibold text-ai-title">{user.name}</div>
                    <div className="mt-0.5 text-xs text-ai-muted">{roleLabel}</div>
                  </div>

                  {isActualAdmin && (
                    <div className="border-b border-ai-border p-2">
                      <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ai-muted">
                        {t("action.switchRole")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onViewRoleChange?.("admin");
                          setUserMenuOpen(false);
                          navigate("/admin");
                        }}
                        className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-all duration-200 ${
                          user.role !== "user" 
                            ? "bg-ai-primary/10 text-ai-primary font-medium" 
                            : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
                        }`}
                      >
                        <Shield size={14} />
                        {t("action.adminIdentity")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onViewRoleChange?.("user");
                          setUserMenuOpen(false);
                          navigate("/");
                        }}
                        className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-all duration-200 ${
                          user.role === "user" 
                            ? "bg-ai-primary/10 text-ai-primary font-medium" 
                            : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
                        }`}
                      >
                        <UserRound size={14} />
                        {t("action.userIdentity")}
                      </button>
                    </div>
                  )}

                  <div className="border-b border-ai-border p-2 sm:hidden">
                    <a
                      href={switchLocaleUrl}
                      className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-ai-body transition-all duration-200 hover:bg-ai-bg hover:text-ai-title"
                    >
                      <Globe size={14} />
                      {otherLocale === "en" ? "English" : "中文"}
                    </a>
                  </div>

                  <div className="p-2">
                    <button
                      onClick={onLogout}
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-red-500 transition-all duration-200 hover:bg-red-50"
                    >
                      <LogOut size={14} />
                      {t("action.logout")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {navItems.length > 0 && (
          <nav className="flex gap-2 overflow-x-auto border-t border-white/10 px-3 py-2 lg:hidden">
            {navItems.map((item) => {
              const active = isCurrent(item);
              return (
                <LocaleLink
                  key={`mobile-${item.labelKey}-${item.to}`}
                  to={item.to}
                  className={`flex h-[32px] shrink-0 items-center rounded-lg px-4 text-[14px] font-medium transition-all duration-300 ${
                    active
                      ? "bg-white text-tsinghua-800 shadow-md"
                      : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  {t(item.labelKey)}
                </LocaleLink>
              );
            })}
          </nav>
        )}
      </header>

      <main className={mainClassName}>
        <div className={contentClassName}>{children}</div>
      </main>
    </div>
  );
}
