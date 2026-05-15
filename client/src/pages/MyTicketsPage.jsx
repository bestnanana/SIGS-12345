import React, { useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatTime, statusMap } from "../constants";

export default function MyTicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStatus, setActiveStatus] = useState("all");

  const statusEntries = useMemo(() => Object.entries(statusMap), []);

  const statusCounts = useMemo(() => {
    const counts = statusEntries.reduce((acc, [status]) => ({ ...acc, [status]: 0 }), { all: tickets.length });
    tickets.forEach((ticket) => {
      counts[ticket.status] = (counts[ticket.status] || 0) + 1;
    });
    return counts;
  }, [statusEntries, tickets]);

  const groupedTickets = useMemo(() => {
    return statusEntries
      .map(([status, meta]) => ({
        status,
        meta,
        items: tickets.filter((ticket) => ticket.status === status)
      }))
      .filter((group) => activeStatus === "all" || group.status === activeStatus);
  }, [activeStatus, statusEntries, tickets]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/tickets");
      setTickets(Array.isArray(res.data) ? res.data : []);
      setError(Array.isArray(res.data) ? "" : "事项接口返回异常，请确认后端已重启到最新版本。");
    } catch (err) {
      setTickets([]);
      setError(err.response?.data?.message || "事项加载失败，请确认后端服务正在运行。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="app-card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ai-border px-6 py-5">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-ai-title">我的事项</div>
          <div className="mt-2 text-sm text-ai-body">查看本人提交事项的办理进度与回复结果。</div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="ghost-button">
            <RefreshCw size={16} />
            刷新
          </button>
          <Link to="/new" className="primary-button">
            <FilePlus2 size={16} />
            提出意见
          </Link>
        </div>
      </div>

      <div className="border-b border-ai-border px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <button
            type="button"
            onClick={() => setActiveStatus("all")}
            className={`rounded-xl border px-4 py-3 text-left transition duration-200 ${
              activeStatus === "all"
                ? "border-ai-primary bg-ai-primary/10 text-ai-primary"
                : "border-ai-border bg-white text-ai-body hover:bg-[#F7F7FB]"
            }`}
          >
            <div className="text-xs font-medium">全部事项</div>
            <div className="mt-1 text-2xl font-semibold">{statusCounts.all}</div>
          </button>
          {statusEntries.map(([value, meta]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveStatus(value)}
              className={`rounded-xl border px-4 py-3 text-left transition duration-200 ${
                activeStatus === value
                  ? "border-ai-primary bg-ai-primary/10 text-ai-primary"
                  : "border-ai-border bg-white text-ai-body hover:bg-[#F7F7FB]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">{meta.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${meta.className}`}>{statusCounts[value] || 0}</span>
              </div>
              <div className="mt-1 text-2xl font-semibold">{statusCounts[value] || 0}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-6">
        {loading ? (
          <div className="rounded-xl bg-ai-bg px-6 py-12 text-center text-sm text-slate-500">加载中...</div>
        ) : error ? (
          <div className="rounded-xl bg-amber-50 px-6 py-12 text-center text-sm text-amber-700 ring-1 ring-amber-100">{error}</div>
        ) : tickets.length === 0 ? (
          <div className="rounded-xl bg-ai-bg px-6 py-12 text-center text-sm text-slate-500">暂无事项</div>
        ) : (
          <div className="space-y-6">
            {groupedTickets.map((group) => (
              <section key={group.status} className="overflow-hidden rounded-xl border border-ai-border bg-white">
                <div className="flex items-center justify-between gap-4 bg-ai-bg px-5 py-4">
                  <div>
                    <h2 className="text-base font-semibold text-ai-title">{group.meta.label}</h2>
                    <p className="mt-1 text-xs text-ai-muted">共 {group.items.length} 条事项</p>
                  </div>
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${group.meta.className}`}>
                    {group.meta.label}
                  </span>
                </div>

                {group.items.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-ai-muted">该分类下暂无事项</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {group.items.map((ticket) => (
                      <article key={ticket.id} className="grid gap-4 px-5 py-4 transition duration-200 hover:bg-[#F7F7FB] lg:grid-cols-[minmax(0,1fr)_180px_96px] lg:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ai-primary">#{String(ticket.id).padStart(6, "0")}</span>
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${group.meta.className}`}>
                              {group.meta.label}
                            </span>
                          </div>
                          <h3 className="mt-2 truncate text-sm font-semibold text-ai-title">{ticket.title}</h3>
                          <div className="mt-1 text-xs text-ai-muted">
                            {ticket.field} · 部门：{ticket.department || "未指定"} · 当前承办：{ticket.current_department || "党政办"}
                          </div>
                        </div>
                        <div className="text-sm text-ai-body">{formatTime(ticket.created_at)}</div>
                        <Link to={`/tickets/${ticket.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-ai-primary hover:brightness-110">
                          <Eye size={16} />
                          查看详情
                        </Link>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
