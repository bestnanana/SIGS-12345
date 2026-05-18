import React, { useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../i18n";

const userNavItems = [
  { labelKey: "nav.home", to: "/" },
  { labelKey: "nav.new", to: "/new" },
  { labelKey: "nav.myTickets", to: "/tickets" }
];

const adminNavItems = [
  { labelKey: "nav.admin", to: "/admin" },
  { labelKey: "nav.leaderApproval", to: "/leader-approvals", leaderOnly: true }
];

function LogoMark() {
  return (
    <div className="tsinghua-logo flex min-w-0 items-center">
      <img
        src="/tsinghua-sigs-logo.png"
        alt="清华大学深圳国际研究生院"
        className="h-12 w-[228px] shrink-0 object-contain object-left"
      />
      <div className="mx-7 hidden h-12 w-px bg-ai-border md:block" />
      <div className="hidden min-w-0 md:block">
        <div className="truncate text-[20px] font-semibold leading-6 tracking-tight text-ai-title">SIGS投诉即办</div>
        <div className="mt-1 truncate text-xs text-ai-muted">SIGS Prompt Complaint</div>
      </div>
    </div>
  );
}

export default function Layout({ children, user, actualUser = user, onLogout, onViewRoleChange }) {
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const roleLabel = user.role === "admin"
    ? Number(user.admin_level) === 0
      ? t("role.superAdmin")
      : t("role.levelAdmin", { level: Number(user.admin_level) === 1 ? 1 : 2 })
    : t("role.user");
  const initial = (user.name || roleLabel || "U").trim().slice(0, 1).toUpperCase();
  const navItems = user.role === "admin"
    ? adminNavItems.filter((item) => !item.leaderOnly || Number(user.admin_level) !== 2)
    : userNavItems;
  const isActualAdmin = actualUser.role === "admin";
  const isAdminArea = user.role === "admin" && location.pathname.startsWith("/admin");
  const mainClassName = isAdminArea
    ? "min-h-[calc(100vh-137px)] px-3 py-5 sm:px-5 lg:min-h-[calc(100vh-84px)] lg:px-6"
    : "min-h-[calc(100vh-137px)] px-3 py-6 sm:px-6 sm:py-8 lg:min-h-[calc(100vh-84px)] lg:px-8";
  const contentClassName = isAdminArea
    ? "page-fade mx-auto w-full max-w-[1840px]"
    : "page-fade mx-auto w-full max-w-7xl";

  function isCurrent(item) {
    if (item.to === "/") return location.pathname === "/";
    if (item.to === "/tickets") return location.pathname === "/tickets";
    return location.pathname.startsWith(item.to);
  }

  return (
    <div className="page-shell">
      <header className="tsinghua-header sticky top-0 z-20 border-b border-white/18">
        <div className="mx-auto flex h-[84px] max-w-[1910px] items-center gap-6 px-6 lg:px-10">
          <button onClick={() => navigate(user.role === "admin" ? "/admin" : "/")} className="min-w-0 shrink-0 text-left">
            <LogoMark />
          </button>

          <nav className="hidden flex-1 items-center justify-center gap-8 lg:flex">
            {navItems.map((item) => (
              <Link
                key={`${item.labelKey}-${item.to}`}
                to={item.to}
                className={[
                  "tsinghua-header-link",
                  isCurrent(item) ? "tsinghua-header-link-active" : ""
                ].join(" ")}
              >
                {t(item.labelKey)}
                {isCurrent(item) && <span className="motion-underline absolute bottom-0 left-1/2 h-1 w-9 -translate-x-1/2 rounded-t-full bg-white" />}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-5">
            <div className="hidden rounded-full bg-white/10 p-1 ring-1 ring-white/20 sm:flex">
              {["zh", "en"].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setLanguage(item)}
                  className={`h-8 rounded-full px-3 text-xs font-semibold transition duration-200 ${
                    language === item ? "bg-white text-tsinghua-800 shadow-sm" : "text-white/70 hover:text-white"
                  }`}
                >
                  {item === "zh" ? "中" : "EN"}
                </button>
              ))}
            </div>
            <div className="relative">
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
                          user.role === "admin" ? "bg-ai-primary/10 text-ai-primary" : "text-ai-body hover:bg-[#F6F6FA] hover:text-ai-title"
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
                          user.role !== "admin" ? "bg-ai-primary/10 text-ai-primary" : "text-ai-body hover:bg-[#F6F6FA] hover:text-ai-title"
                        }`}
                      >
                        {t("action.userIdentity")}
                      </button>
                    </div>
                  ) : null}
                  <div className="border-b border-ai-border p-1 sm:hidden">
                    <div className="px-2 py-1 text-xs font-semibold text-ai-muted">Language</div>
                    <div className="flex gap-1">
                      {["zh", "en"].map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setLanguage(item)}
                          className={`h-9 flex-1 rounded-lg px-3 text-sm transition duration-200 ${
                            language === item ? "bg-ai-primary/10 text-ai-primary" : "text-ai-body hover:bg-[#F6F6FA] hover:text-ai-title"
                          }`}
                        >
                          {item === "zh" ? "中文" : "English"}
                        </button>
                      ))}
                    </div>
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
              <Link
                key={`mobile-${item.labelKey}-${item.to}`}
                to={item.to}
                className={`flex h-10 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition duration-200 ${
                  active
                    ? "bg-white text-tsinghua-800 shadow-[0_8px_20px_rgba(26,8,49,0.18)]"
                    : "bg-white/10 text-white/75 ring-1 ring-white/20 hover:bg-white/20 hover:text-white"
                }`}
              >
                {t(item.labelKey)}
              </Link>
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
