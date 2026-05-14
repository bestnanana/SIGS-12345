import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, ClipboardList, FilePlus2, Inbox, MessageSquareText, Route, Sparkles, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatTime, statusMap } from "../constants";

const quickActions = [
  {
    to: "/new",
    icon: FilePlus2,
    title: "提出意见",
    body: "创建新的诉求事项，并由智能助手辅助识别领域。"
  },
  {
    to: "/tickets",
    icon: Inbox,
    title: "我的事项",
    body: "查看办理状态、部门回复与评价记录。"
  }
];

const workflowSteps = ["提交诉求", "智能分类", "部门转办", "回复与评价"];

export default function HomePage({ user }) {
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [ticketsError, setTicketsError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadTickets() {
      setLoadingTickets(true);
      try {
        const res = await api.get("/tickets");
        if (ignore) return;
        setTickets(Array.isArray(res.data) ? res.data : []);
        setTicketsError(Array.isArray(res.data) ? "" : "事项接口返回异常，请稍后重试。");
      } catch (err) {
        if (ignore) return;
        setTickets([]);
        setTicketsError(err.response?.data?.message || "暂时无法加载我的事项。");
      } finally {
        if (!ignore) setLoadingTickets(false);
      }
    }

    loadTickets();
    return () => {
      ignore = true;
    };
  }, []);

  const unresolvedTickets = useMemo(
    () => tickets.filter((ticket) => ticket.status !== "completed"),
    [tickets]
  );

  const actions = [
    ...quickActions,
    {
      to: user.role === "admin" ? "/admin" : "/typical",
      icon: MessageSquareText,
      title: user.role === "admin" ? "后台工作台" : "典型问题",
      body: "处理转办事项，或查看已公开的高频案例。"
    }
  ];

  return (
    <div className="space-y-8">
      <section className="mesh-hero app-card p-8 lg:p-10">
        <div className="relative z-10 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div>
            <div className="ai-chip mb-6">
              <Sparkles size={14} className="mr-1.5" />
              智能服务台
            </div>
            <h1 className="max-w-3xl text-[40px] font-semibold leading-tight tracking-tight text-ai-title">
              欢迎回来，{user.name}。在这里高效管理每一项校园诉求。
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-ai-body">
              SIGS投诉即办将诉求提交、智能分类、部门转办与回复评价整合到一个现代化工作台，让每个事项都有清晰上下文和可追踪的办理路径。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/new" className="primary-button">
                <FilePlus2 size={18} />
                提交意见
              </Link>
              <Link to="/tickets" className="secondary-button">
                查看事项
                <ArrowRight size={17} />
              </Link>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/70 bg-white/70 p-5 shadow-[0_20px_60px_rgba(108,76,241,0.12)] backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-ai-title">智能摘要</div>
                <div className="mt-1 text-xs text-ai-muted">刚刚生成</div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ai-primary text-white">
                <Wand2 size={18} />
              </div>
            </div>
            <p className="text-sm leading-7 text-ai-body">
              当前诉求集中在信息化与培养流程，建议优先关注账号登录、课程申请与财务报销类高频事项。
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["信息化", "培养处", "高优先级"].map((tag) => (
                <span key={tag} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ai-body ring-1 ring-ai-border">{tag}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="app-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-ai-title">我发起的事项</h2>
              <p className="mt-2 text-sm leading-6 text-ai-body">同步显示“我的事项”中的事项数量。</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ai-primary/10 text-ai-primary">
              <ClipboardList size={22} />
            </div>
          </div>
          <div className="mt-8 text-[44px] font-semibold leading-none tracking-tight text-ai-title">
            {loadingTickets ? "--" : tickets.length}
          </div>
          <Link to="/tickets" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-ai-primary hover:brightness-110">
            进入我的事项
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="app-card">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
                <AlertCircle size={20} />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-ai-title">未解决事项</h2>
                <p className="mt-1 text-sm text-ai-body">点击事项可进入对应详情页。</p>
              </div>
            </div>
            <span className="rounded-full bg-ai-primary/10 px-3 py-1 text-xs font-semibold text-ai-primary ring-1 ring-ai-primary/10">
              {loadingTickets ? "加载中" : `${unresolvedTickets.length} 项`}
            </span>
          </div>

          {ticketsError ? (
            <div className="rounded-2xl bg-amber-50 px-4 py-5 text-sm text-amber-800 ring-1 ring-amber-100">{ticketsError}</div>
          ) : loadingTickets ? (
            <div className="rounded-2xl bg-[#FAFAFC] px-4 py-8 text-center text-sm text-ai-body ring-1 ring-ai-border">事项加载中...</div>
          ) : unresolvedTickets.length === 0 ? (
            <div className="rounded-2xl bg-[#FAFAFC] px-4 py-8 text-center text-sm text-ai-body ring-1 ring-ai-border">暂无未解决事项</div>
          ) : (
            <div className="space-y-3">
              {unresolvedTickets.slice(0, 5).map((ticket) => {
                const status = statusMap[ticket.status] || statusMap.pending;
                return (
                  <Link
                    key={ticket.id}
                    to={`/tickets/${ticket.id}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-ai-border bg-[#FAFAFC] px-4 py-3 transition duration-200 hover:-translate-y-0.5 hover:border-ai-primary/20 hover:bg-white hover:shadow-[0_12px_28px_rgba(0,0,0,0.05)]"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ai-title">{ticket.title}</div>
                      <div className="mt-1 text-xs text-ai-muted">
                        #{String(ticket.id).padStart(6, "0")} · {formatTime(ticket.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className={`hidden rounded-full px-3 py-1 text-xs font-medium ring-1 sm:inline-flex ${status.className}`}>
                        {status.label}
                      </span>
                      <ArrowRight size={16} className="text-ai-primary" />
                    </div>
                  </Link>
                );
              })}
              {unresolvedTickets.length > 5 && (
                <Link to="/tickets" className="inline-flex items-center gap-2 px-1 pt-1 text-sm font-semibold text-ai-primary hover:brightness-110">
                  查看全部未解决事项
                  <ArrowRight size={16} />
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="app-card">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-[32px] font-semibold tracking-tight text-ai-title">快捷操作</h2>
              <p className="mt-2 text-sm text-ai-body">从这里提交、追踪和复盘服务事项。</p>
            </div>
            <Link to="/tickets" className="text-sm font-semibold text-ai-primary">查看全部</Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {actions.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.title} to={item.to} className="rounded-[20px] border border-ai-border bg-[#FAFAFC] p-5 transition duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_28px_rgba(0,0,0,0.05)]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ai-primary/10 text-ai-primary">
                    <Icon size={20} />
                  </div>
                  <div className="mt-5 text-base font-semibold text-ai-title">{item.title}</div>
                  <div className="mt-2 text-sm leading-6 text-ai-body">{item.body}</div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="app-card">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ai-primary/10 text-ai-primary">
              <Route size={20} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-ai-title">智能办理流程</h2>
              <p className="text-sm text-ai-body">清晰、尊重、深入</p>
            </div>
          </div>
          <div className="space-y-4">
            {workflowSteps.map((step, index) => (
              <div key={step} className="flex items-start gap-4 rounded-2xl bg-[#FAFAFC] p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-ai-primary ring-1 ring-ai-border">
                  {index + 1}
                </div>
                <div>
                  <div className="font-semibold text-ai-title">{step}</div>
                  <div className="mt-1 text-sm leading-6 text-ai-body">保留上下文、责任部门和处理轨迹，形成可复盘的服务闭环。</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
