import React, { useEffect, useState } from "react";
import { Eye, FilePlus2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatTime, statusMap } from "../constants";

export default function MyTicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

      <div className="overflow-x-auto">
        <table className="soft-table w-full min-w-[760px]">
          <thead>
            <tr>
              <th className="px-6 py-3 font-medium">事项编号</th>
              <th className="px-6 py-3 font-medium">标题</th>
              <th className="px-6 py-3 font-medium">提交时间</th>
              <th className="px-6 py-3 font-medium">状态</th>
              <th className="px-6 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-500">加载中...</td></tr>
            ) : error ? (
              <tr><td colSpan="5" className="px-6 py-12 text-center text-amber-700">{error}</td></tr>
            ) : tickets.length === 0 ? (
              <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-500">暂无事项</td></tr>
            ) : (
              tickets.map((ticket) => {
                const status = statusMap[ticket.status] || statusMap.pending;
                return (
                  <tr key={ticket.id} className="hover:bg-tsinghua-50/50">
                    <td className="font-semibold text-ai-primary">#{String(ticket.id).padStart(6, "0")}</td>
                    <td className="max-w-md">
                      <div className="truncate font-semibold text-ai-title">{ticket.title}</div>
                      <div className="mt-1 text-xs text-ai-muted">
                        {ticket.field} · 部门：{ticket.department || "未指定"} · 当前承办：{ticket.current_department || "党政办"}
                      </div>
                    </td>
                    <td>{formatTime(ticket.created_at)}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td>
                      <Link to={`/tickets/${ticket.id}`} className="inline-flex items-center gap-1 font-medium text-ai-primary hover:brightness-110">
                        <Eye size={16} />
                        查看详情
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
