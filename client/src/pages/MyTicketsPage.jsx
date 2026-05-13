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
    <div className="rounded-md bg-white shadow-soft ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div>
          <div className="text-lg font-semibold text-slate-900">我的事项</div>
          <div className="mt-1 text-sm text-slate-500">查看本人提交事项的办理进度与回复结果。</div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm hover:bg-slate-50">
            <RefreshCw size={16} />
            刷新
          </button>
          <Link to="/new" className="flex h-10 items-center gap-2 rounded-md bg-tsinghua-700 px-4 text-sm font-medium text-white hover:bg-tsinghua-800">
            <FilePlus2 size={16} />
            提出意见
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
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
                    <td className="px-6 py-4 font-medium text-tsinghua-800">#{String(ticket.id).padStart(6, "0")}</td>
                    <td className="max-w-md px-6 py-4">
                      <div className="truncate font-medium text-slate-900">{ticket.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {ticket.field} · 部门：{ticket.department || "未指定"} · 当前承办：{ticket.current_department || "党政办"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{formatTime(ticket.created_at)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <Link to={`/tickets/${ticket.id}`} className="inline-flex items-center gap-1 text-tsinghua-700 hover:text-tsinghua-900">
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
