import React, { useEffect, useMemo, useState } from "react";
import { Bot, Eye, Forward, Megaphone, Paperclip, RefreshCw, SendHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { api, uploadConfig } from "../api";
import { departments, formatTime, statusMap } from "../constants";

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState({ department: "党政办", content: "", status: "replied" });
  const [transfer, setTransfer] = useState({ to_department: "信数中心", note: "" });
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(() => tickets.find((item) => item.id === selectedId), [tickets, selectedId]);
  const canHandleSelected = selected && user?.department && user.department === (selected.current_department || "党政办");
  const isCompleted = selected?.status === "completed";
  const canReplySelected = canHandleSelected && !isCompleted;

  async function loadMe() {
    const res = await api.get("/auth/me");
    setUser(res.data);
    setReply((current) => ({ ...current, department: res.data.department || "党政办" }));
  }

  async function loadTickets() {
    setLoading(true);
    try {
      const res = await api.get("/admin/tickets");
      const nextTickets = Array.isArray(res.data) ? res.data : [];
      setTickets(nextTickets);
      setSelectedId((current) => current || nextTickets[0]?.id || null);
      setError(Array.isArray(res.data) ? "" : "后台事项接口返回异常，请确认后端已重启到最新版本。");
    } catch (err) {
      setTickets([]);
      setError(err.response?.data?.message || "后台事项加载失败，请确认后端服务正在运行。");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) {
      setDetail(null);
      return;
    }
    const res = await api.get(`/tickets/${id}`);
    setDetail({
      ...res.data,
      transfers: Array.isArray(res.data?.transfers) ? res.data.transfers : [],
      replies: Array.isArray(res.data?.replies) ? res.data.replies : []
    });
    setReply((current) => ({
      ...current,
      department: res.data.ticket.current_department || res.data.ticket.department || current.department,
      content: current.content || res.data.ticket.ai_suggestion || ""
    }));
  }

  useEffect(() => {
    loadMe();
    loadTickets();
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId]);

  function chooseTicket(ticket) {
    setSelectedId(ticket.id);
    setReply({
      department: user?.department || ticket.current_department || "党政办",
      content: ticket.ai_suggestion || "",
      status: "replied"
    });
    setTransfer({ to_department: departments.find((dept) => dept !== (ticket.current_department || "党政办")) || "信数中心", note: "" });
  }

  async function changeStatus(id, status) {
    await api.patch(`/admin/tickets/${id}/status`, { status });
    await loadTickets();
    await loadDetail(id);
  }

  async function submitTransfer(e) {
    e.preventDefault();
    if (!selectedId) return;
    await api.post(`/admin/tickets/${selectedId}/transfer`, transfer);
    await loadTickets();
    await loadDetail(selectedId);
  }

  async function togglePublish(ticket) {
    await api.patch(`/admin/tickets/${ticket.id}/publish`, { is_published: !ticket.is_published });
    await loadTickets();
    await loadDetail(ticket.id);
  }

  async function submitReply(e) {
    e.preventDefault();
    if (!selectedId || !canReplySelected) return;
    setSubmitting(true);
    const data = new FormData();
    data.append("content", reply.content);
    data.append("status", reply.status);
    files.forEach((file) => data.append("attachments", file));
    await api.post(`/admin/tickets/${selectedId}/replies`, data, uploadConfig);
    setReply({ ...reply, content: "" });
    setFiles([]);
    await loadTickets();
    await loadDetail(selectedId);
    setSubmitting(false);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <section className="rounded-md bg-white shadow-soft ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-slate-900">后台管理</div>
            <div className="mt-1 text-sm text-slate-500">
              {user?.department ? `${user.department}事项队列` : "查看事项并办理回复"}
            </div>
          </div>
          <button onClick={loadTickets} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-50" title="刷新">
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-3 scrollbar-thin">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">加载中...</div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-amber-700">{error}</div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">暂无待办事项</div>
          ) : (
            <div className="space-y-2">
              {tickets.map((ticket) => {
                const status = statusMap[ticket.status] || statusMap.pending;
                return (
                  <button
                    key={ticket.id}
                    onClick={() => chooseTicket(ticket)}
                    className={`w-full rounded-md border p-4 text-left transition ${
                      selectedId === ticket.id ? "border-tsinghua-400 bg-tsinghua-50" : "border-slate-200 bg-white hover:border-tsinghua-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{ticket.title}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          #{String(ticket.id).padStart(6, "0")} · 提交人：{ticket.submitter_name}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${status.className}`}>{status.label}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{ticket.field}</span>
                      <span>申请部门：{ticket.department || "未指定"}</span>
                      <span>当前：{ticket.current_department || "党政办"}</span>
                      {ticket.is_published ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700 ring-1 ring-teal-200">已发布</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0 rounded-md bg-white shadow-soft ring-1 ring-slate-200">
        {!selected ? (
          <div className="p-12 text-center text-slate-500">请选择事项</div>
        ) : (
          <>
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-slate-900">{selected.title}</div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
                    <span>提交人：{selected.submitter_name}</span>
                    <span>联系方式：{selected.submitter_phone || "不显示"}</span>
                    <span>申请部门：{selected.department || "未指定"}</span>
                    <span>当前承办：{selected.current_department || "党政办"}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => togglePublish(selected)}
                    className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm ring-1 ${
                      selected.is_published ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <Megaphone size={16} />
                    {selected.is_published ? "取消发布" : "发布典型问题"}
                  </button>
                  <Link to={`/tickets/${selected.id}`} className="flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50">
                    <Eye size={16} />
                    详情页
                  </Link>
                </div>
              </div>
            </div>

            <div className="grid gap-5 p-6 lg:grid-cols-[1fr_360px]">
              <div className="space-y-5">
                <section>
                  <h3 className="mb-3 font-semibold text-slate-900">事项内容</h3>
                  <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">
                    {selected.content}
                  </div>
                </section>

                <section className="rounded-md border border-teal-200 bg-teal-50 p-4">
                  <div className="mb-3 flex items-center gap-2 font-semibold text-teal-900">
                    <Bot size={18} />
                    Minimax 智能建议
                  </div>
                  <div className="text-sm leading-7 text-teal-900">
                    <div>智能分类：{selected.ai_category || selected.field}</div>
                    <div className="mt-2">回复建议：{selected.ai_suggestion || "暂无建议"}</div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 font-semibold text-slate-900">转办记录</h3>
                  <div className="space-y-3">
                    {Array.isArray(detail?.transfers) && detail.transfers.length ? (
                      detail.transfers.map((item) => (
                        <div key={item.id} className="rounded-md border border-slate-200 bg-white p-4 text-sm">
                          <div className="flex flex-wrap justify-between gap-3">
                            <span className="font-medium text-slate-900">{item.from_department} 转办至 {item.to_department}</span>
                            <span className="text-slate-500">{formatTime(item.created_at)}</span>
                          </div>
                          {item.note ? <div className="mt-2 text-slate-600">说明：{item.note}</div> : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">暂无转办记录</div>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 font-semibold text-slate-900">历史回复</h3>
                  <div className="space-y-3">
                    {Array.isArray(detail?.replies) && detail.replies.length ? (
                      detail.replies.map((item) => (
                        <div key={item.id} className="rounded-md border border-slate-200 p-4">
                          <div className="mb-2 flex justify-between gap-3 text-sm">
                            <span className="font-medium">{item.department}</span>
                            <span className="text-slate-500">{formatTime(item.created_at)}</span>
                          </div>
                          <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{item.content}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">暂无回复</div>
                    )}
                  </div>
                </section>
              </div>

              <aside className="space-y-5">
                <section className="rounded-md border border-slate-200 p-4">
                  <h3 className="mb-3 font-semibold text-slate-900">状态更新</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(statusMap).map(([value, meta]) => (
                      <button
                        key={value}
                        onClick={() => changeStatus(selected.id, value)}
                        disabled={!canHandleSelected}
                        className={`rounded-md px-3 py-2 text-sm ring-1 disabled:cursor-not-allowed disabled:opacity-60 ${selected.status === value ? meta.className : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </section>

                <form onSubmit={submitTransfer} className="rounded-md border border-amber-200 bg-amber-50 p-4">
                  <h3 className="mb-4 flex items-center gap-2 font-semibold text-amber-900">
                    <Forward size={17} />
                    转办事项
                  </h3>
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm text-amber-900">指定部门</span>
                    <select
                      value={transfer.to_department}
                      onChange={(e) => setTransfer({ ...transfer, to_department: e.target.value })}
                      className="h-10 w-full rounded-md border border-amber-200 bg-white px-3 outline-none focus:border-tsinghua-600"
                    >
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mb-4 block">
                    <span className="mb-1 block text-sm text-amber-900">转办说明</span>
                    <textarea
                      value={transfer.note}
                      onChange={(e) => setTransfer({ ...transfer, note: e.target.value })}
                      className="min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-tsinghua-600"
                      placeholder="可填写转办原因或办理提示"
                    />
                  </label>
                  <button disabled={!canReplySelected} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-amber-600 font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60">
                    <Forward size={16} />
                    确认转办
                  </button>
                </form>

                <form onSubmit={submitReply} className={`rounded-md border p-4 ${canReplySelected ? "border-slate-200" : "border-slate-200 bg-slate-50"}`}>
                  <h3 className="mb-4 font-semibold text-slate-900">回复事项</h3>
                  {!canHandleSelected ? (
                    <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 ring-1 ring-amber-200">
                      该事项当前承办部门为 {selected.current_department || "党政办"}，只能由该部门管理员回复处理。
                    </div>
                  ) : null}
                  {isCompleted ? (
                    <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800 ring-1 ring-emerald-200">
                      该事项已完成，不能继续提交回复。
                    </div>
                  ) : null}
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm text-slate-600">回复部门</span>
                    <input
                      value={user?.department || reply.department}
                      readOnly
                      className="h-10 w-full rounded-md border border-slate-200 bg-slate-100 px-3 text-slate-600 outline-none"
                      required
                    />
                  </label>
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm text-slate-600">回复内容</span>
                    <textarea
                      value={reply.content}
                      onChange={(e) => setReply({ ...reply, content: e.target.value })}
                      className="min-h-36 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-7 outline-none focus:border-tsinghua-600"
                      disabled={!canReplySelected}
                      required
                    />
                  </label>
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm text-slate-600">回复后状态</span>
                    <select
                      value={reply.status}
                      onChange={(e) => setReply({ ...reply, status: e.target.value })}
                      className="h-10 w-full rounded-md border border-slate-300 px-3 outline-none focus:border-tsinghua-600"
                      disabled={!canReplySelected}
                    >
                      <option value="replied">已回复</option>
                      <option value="completed">已完成</option>
                      <option value="processing">处理中</option>
                    </select>
                  </label>
                  <label className={`mb-4 flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 ${canReplySelected ? "cursor-pointer hover:border-tsinghua-300" : "cursor-not-allowed opacity-60"}`}>
                    <Paperclip size={16} />
                    <span className="truncate">{files.length ? `${files.length} 个附件已选择` : "上传官方附件"}</span>
                    <input
                      type="file"
                      multiple
                      accept=".txt,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.avi,.mp4"
                      onChange={(e) => setFiles(Array.from(e.target.files || []))}
                      className="hidden"
                      disabled={!canReplySelected}
                    />
                  </label>
                  <button
                    disabled={submitting || !canReplySelected}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-tsinghua-700 font-medium text-white hover:bg-tsinghua-800 disabled:opacity-70"
                  >
                    <SendHorizontal size={16} />
                    {isCompleted ? "已完成" : submitting ? "提交中..." : "提交回复"}
                  </button>
                </form>
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
