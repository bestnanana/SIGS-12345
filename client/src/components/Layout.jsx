import React from "react";
import { Bell, ClipboardList, FilePlus2, Home, Layers, ListChecks, LogOut, Megaphone, Search, ShieldCheck, UserRound } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

const topMenus = ["用户首页", "服务列表", "我申请的", "我受理的", "SIGS接诉即办", "典型问题"];

function LogoMark() {
  return (
    <div className="flex h-12 min-w-0 items-center rounded-md bg-white px-3 shadow-sm ring-1 ring-white/70">
      <img
        src="/tsinghua-sigs-logo.png"
        alt="清华大学深圳国际研究生院"
        className="h-9 w-full max-w-[230px] object-contain object-left"
      />
    </div>
  );
}

function SidebarLink({ to, icon: Icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition",
          isActive ? "bg-tsinghua-700 text-white shadow-soft" : "text-slate-700 hover:bg-tsinghua-50 hover:text-tsinghua-800"
        ].join(" ")
      }
    >
      <Icon size={18} />
      {children}
    </NavLink>
  );
}

export default function Layout({ children, user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7f5fb_0%,#eef0f6_42%,#f8fafc_100%)]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[linear-gradient(90deg,#3f1b70_0%,#55238c_45%,#0f6f72_100%)] text-white shadow-lg shadow-tsinghua-900/15">
        <div className="flex h-20 items-center">
          <button onClick={() => navigate("/")} className="flex h-full w-[min(420px,62vw)] items-center gap-4 bg-white/8 px-4 text-left backdrop-blur sm:px-6">
            <LogoMark />
            <div className="hidden min-w-0 xl:block">
              <div className="truncate text-lg font-semibold leading-tight">SIGS接诉即办</div>
              <div className="truncate text-xs text-tsinghua-100">SIGS Prompt Complaint</div>
            </div>
          </button>

          <nav className="hidden h-full flex-1 items-center px-2 md:flex">
            {topMenus.map((item) => (
              <button
                key={item}
                onClick={() => navigate(item === "SIGS接诉即办" ? "/" : item === "典型问题" ? "/typical" : "/tickets")}
                className={`mx-1 h-10 rounded-md px-4 text-sm transition hover:bg-white/12 ${item === "SIGS接诉即办" ? "bg-white/18 font-semibold ring-1 ring-white/20" : ""}`}
              >
                {item}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4 px-5">
            <button className="hidden h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 sm:flex" title="检索">
              <Search size={18} />
            </button>
            <button className="hidden h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 sm:flex" title="通知">
              <Bell size={18} />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <UserRound size={18} />
              </div>
              <div className="hidden text-sm sm:block">
                <div>{user.name}</div>
                <div className="text-xs text-tsinghua-100">{user.role === "admin" ? "管理员" : "用户"}</div>
              </div>
            </div>
            <button onClick={onLogout} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" title="退出">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-20 hidden h-[calc(100vh-5rem)] w-64 shrink-0 border-r border-slate-200/80 bg-white/95 px-4 py-5 shadow-sm lg:block">
          <div className="mb-4 flex items-center gap-2 px-3 text-sm font-semibold text-tsinghua-800">
            <Layers size={18} />
            应用菜单
          </div>
          <div className="space-y-2">
            <SidebarLink to="/" icon={Home}>事项首页</SidebarLink>
            <SidebarLink to="/new" icon={FilePlus2}>提出意见</SidebarLink>
            <SidebarLink to="/tickets" icon={ClipboardList}>我的事项</SidebarLink>
            <SidebarLink to="/typical" icon={Megaphone}>典型问题发布</SidebarLink>
            {user.role === "admin" && <SidebarLink to="/admin" icon={ShieldCheck}>后台管理</SidebarLink>}
          </div>

          <div className="mt-8 rounded-md bg-tsinghua-50 p-4 text-sm text-tsinghua-900 ring-1 ring-tsinghua-100">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <ListChecks size={16} />
              办理提示
            </div>
            <p className="leading-6">请尽量做到一事一条，便于责任单位准确定位并及时办理。</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
