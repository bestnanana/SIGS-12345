import React, { useState } from "react";
import { Bell, Bot, ChevronDown, Search, UserRound } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const userNavItems = [
  { label: "首页", to: "/" },
  { label: "提出意见", to: "/new" },
  { label: "我的申请", to: "/tickets" },
  { label: "典型问题", to: "/typical" }
];

const adminNavItems = [
  { label: "后台工作台", to: "/admin" },
  { label: "典型问题", to: "/typical" }
];

function LogoMark() {
  return (
    <div className="flex min-w-0 items-center">
      <img
        src="/tsinghua-sigs-logo.png"
        alt="清华大学深圳国际研究生院"
        className="h-10 w-[190px] shrink-0 object-contain object-left"
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
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const roleLabel = user.role === "admin"
    ? Number(user.admin_level) === 0
      ? "超级管理员"
      : `${Number(user.admin_level) === 1 ? "1级" : "2级"}管理员`
    : "用户";
  const initial = (user.name || roleLabel || "用").trim().slice(0, 1).toUpperCase();
  const navItems = user.role === "admin" ? adminNavItems : userNavItems;
  const isActualAdmin = actualUser.role === "admin";
  const isAdminArea = user.role === "admin" && location.pathname.startsWith("/admin");
  const mainClassName = isAdminArea
    ? "min-h-[calc(100vh-84px)] px-3 py-5 sm:px-5 lg:px-6"
    : "min-h-[calc(100vh-84px)] px-5 py-8 sm:px-8";
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
      <header className="sticky top-0 z-20 h-[84px] border-b border-ai-border bg-white">
        <div className="mx-auto flex h-full max-w-[1720px] items-center gap-6 px-6 lg:px-10">
          <button onClick={() => navigate(user.role === "admin" ? "/admin" : "/")} className="min-w-0 shrink-0 text-left">
            <LogoMark />
          </button>

          <nav className="hidden flex-1 items-center justify-center gap-8 lg:flex">
            {navItems.map((item) => (
              <Link
                key={`${item.label}-${item.to}`}
                to={item.to}
                className={[
                  "relative flex h-[84px] items-center text-sm font-medium transition duration-200",
                  isCurrent(item) ? "text-ai-primary" : "text-ai-body hover:text-ai-title"
                ].join(" ")}
              >
                {item.label}
                {isCurrent(item) && <span className="motion-underline absolute bottom-0 left-1/2 h-1 w-9 -translate-x-1/2 rounded-t-full bg-ai-primary" />}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-5">
            <button className="hidden text-ai-body transition duration-200 hover:text-ai-title sm:flex" title="搜索事项">
              <Search size={20} strokeWidth={1.8} />
            </button>
            <button className="hidden text-ai-body transition duration-200 hover:text-ai-title sm:flex" title="通知">
              <Bell size={20} strokeWidth={1.8} />
            </button>
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((open) => !open)}
                className="flex items-center gap-3 text-left"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ai-primary text-sm font-semibold text-white shadow-sm">
                  {initial || <UserRound size={18} />}
                </div>
                <div className="hidden leading-tight sm:block">
                  <div className="text-sm font-semibold text-ai-title">{user.name}</div>
                  <div className="mt-0.5 text-xs text-ai-body">{roleLabel}</div>
                </div>
                <ChevronDown size={16} className="hidden text-ai-body sm:block" />
              </button>
              {userMenuOpen && (
                <div className="motion-popover absolute right-0 mt-3 w-48 rounded-xl border border-ai-border bg-white p-1 shadow-[0_12px_30px_rgba(17,17,17,0.08)]">
                  <div className="border-b border-ai-border px-3 py-2">
                    <div className="truncate text-sm font-semibold text-ai-title">{user.name}</div>
                    <div className="mt-1 truncate text-xs text-ai-body">
                      所属部门：{user.department || "未设置"}
                    </div>
                  </div>
                  {isActualAdmin ? (
                    <div className="border-b border-ai-border p-1">
                      <div className="px-2 py-1 text-xs font-semibold text-ai-muted">切换身份</div>
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
                        管理员身份
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
                        普通用户身份
                      </button>
                    </div>
                  ) : null}
                  <button
                    onClick={onLogout}
                    className="h-9 w-full rounded-lg px-3 text-left text-sm text-ai-body transition duration-200 hover:bg-[#F6F6FA] hover:text-ai-title"
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className={mainClassName}>
        <div className={contentClassName}>{children}</div>
      </main>

      <button className="fixed bottom-6 right-6 z-30 flex h-14 items-center gap-3 rounded-2xl bg-ai-title px-5 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(17,17,17,0.18)] transition duration-200 hover:-translate-y-0.5 hover:brightness-110">
        <Bot size={20} />
        智能助手
      </button>
    </div>
  );
}
