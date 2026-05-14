import React, { useState } from "react";
import { Bell, Bot, ChevronDown, Search, UserRound } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const navItems = [
  { label: "提出意见", to: "/new" },
  { label: "首页", to: "/" },
  { label: "我的申请", to: "/tickets" },
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

export default function Layout({ children, user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const roleLabel = user.role === "admin" ? "管理员" : "用户";
  const initial = (user.name || roleLabel || "用").trim().slice(0, 1).toUpperCase();

  function isCurrent(item) {
    if (item.to === "/") return location.pathname === "/";
    if (item.label === "我的申请") return location.pathname === "/tickets";
    return location.pathname.startsWith(item.to);
  }

  return (
    <div className="page-shell">
      <header className="sticky top-0 z-20 h-[84px] border-b border-ai-border bg-white">
        <div className="mx-auto flex h-full max-w-[1720px] items-center gap-6 px-6 lg:px-10">
          <button onClick={() => navigate("/")} className="min-w-0 shrink-0 text-left">
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
                <div className="motion-popover absolute right-0 mt-3 w-32 rounded-xl border border-ai-border bg-white p-1 shadow-[0_12px_30px_rgba(17,17,17,0.08)]">
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

      <main className="min-h-[calc(100vh-84px)] px-5 py-8 sm:px-8">
        <div className="page-fade mx-auto w-full max-w-7xl">{children}</div>
      </main>

      <button className="fixed bottom-6 right-6 z-30 flex h-14 items-center gap-3 rounded-2xl bg-ai-title px-5 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(17,17,17,0.18)] transition duration-200 hover:-translate-y-0.5 hover:brightness-110">
        <Bot size={20} />
        智能助手
      </button>
    </div>
  );
}
