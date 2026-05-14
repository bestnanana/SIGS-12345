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
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <section className="app-card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-ai-border px-6 py-5">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-ai-title">后台工作台</div>
            <div className="mt-2 text-sm text-ai-body">
              {user?.department ? `${user.department}事项队列` : "查看事项并办理回复"}
            </div>
          </div>
          <button onClick={loadTickets} className="flex h-11 w-11 items-center justify-center rounded-2xl border border-ai-border bg-white text-ai-body transition duration-200 hover:bg-ai-bg" title="刷新">
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-4 scrollbar-thin">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">加载中...</div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-amber-700">{error}</div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">暂无待办事项</div>
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => {
                const status = statusMap[ticket.status] || statusMap.pending;
                return (
                  <button
                    key={ticket.id}
                    onClick={() => chooseTicket(ticket)}
                    className={`w-full rounded-[20px] border p-4 text-left transition duration-200 ease-out hover:-translate-y-0.5 ${
                      selectedId === ticket.id ? "border-ai-primary/30 bg-ai-primary/10 shadow-sm" : "border-ai-border bg-white hover:bg-ai-bg"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ai-title">{ticket.title}</div>
                        <div className="mt-1 text-xs text-ai-muted">
                          #{String(ticket.id).padStart(6, "0")} · 提交人：{ticket.submitter_name}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${status.className}`}>{status.label}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ai-body">
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

      <section className="app-card min-w-0 overflow-hidden p-0">
        {!selected ? (
          <div className="p-12 text-center text-ai-body">请选择事项</div>
        ) : (
          <>
            <div className="mesh-hero border-b border-ai-border px-8 py-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[32px] font-semibold tracking-tight text-ai-title">{selected.title}</div>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ai-body">
                    <span>提交人：{selected.submitter_name}</span>
                    <span>联系方式：{selected.submitter_phone || "不显示"}</span>
                    <span>申请部门：{selected.department || "未指定"}</span>
                    <span>当前承办：{selected.current_department || "党政办"}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => togglePublish(selected)}
                    className={`flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 transition duration-200 ${
                      selected.is_published ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <Megaphone size={16} />
                    {selected.is_published ? "取消发布" : "发布典型问题"}
                  </button>
                  <Link to={`/tickets/${selected.id}`} className="ghost-button h-11">
                    <Eye size={16} />
                    详情页
                  </Link>
                </div>
              </div>
            </div>

            <div className="grid gap-6 p-6 lg:grid-cols-[1fr_360px]">
              <div className="space-y-6">
                <section>
                  <h3 className="mb-3 font-semibold text-ai-title">事项内容</h3>
                  <div className="whitespace-pre-wrap rounded-[20px] border border-ai-border bg-ai-bg p-5 text-sm leading-7 text-ai-body">
                    {selected.content}
                  </div>
                </section>

                <section className="rounded-[20px] border border-ai-primary/10 bg-ai-primary/5 p-5">
                  <div className="mb-3 flex items-center gap-2 font-semibold text-ai-title">
                    <Bot size={18} />
                    AI 智能摘要
                  </div>
                  <div className="text-sm leading-7 text-ai-body">
                    <div>智能分类：{selected.ai_category || selected.field}</div>
                    <div className="mt-2">回复建议：{selected.ai_suggestion || "暂无建议"}</div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 font-semibold text-ai-title">转办记录</h3>
                  <div className="space-y-3">
                    {Array.isArray(detail?.transfers) && detail.transfers.length ? (
                      detail.transfers.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-ai-border bg-white p-4 text-sm">
                          <div className="flex flex-wrap justify-between gap-3">
                            <span className="font-medium text-ai-title">{item.from_department} 转办至 {item.to_department}</span>
                            <span className="text-ai-muted">{formatTime(item.created_at)}</span>
                          </div>
                          {item.note ? <div className="mt-2 text-slate-600">说明：{item.note}</div> : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-ai-bg p-4 text-sm text-ai-body">暂无转办记录</div>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 font-semibold text-ai-title">历史回复</h3>
                  <div className="space-y-3">
                    {Array.isArray(detail?.replies) && detail.replies.length ? (
                      detail.replies.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-ai-border p-4">
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
                <section className="rounded-[20px] border border-ai-border p-5">
                  <h3 className="mb-4 font-semibold text-ai-title">状态更新</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(statusMap).map(([value, meta]) => (
                      <button
                        key={value}
                        onClick={() => changeStatus(selected.id, value)}
                        disabled={!canHandleSelected}
                        className={`rounded-xl px-3 py-2.5 text-sm ring-1 transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${selected.status === value ? meta.className : "bg-white text-ai-body ring-ai-border hover:bg-ai-bg"}`}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </section>

                <form onSubmit={submitTransfer} className="rounded-[20px] border border-amber-100 bg-amber-50/70 p-5">
                  <h3 className="mb-4 flex items-center gap-2 font-semibold text-ai-title">
                    <Forward size={17} />
                    转办事项
                  </h3>
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm text-ai-body">指定部门</span>
                    <select
                      value={transfer.to_department}
                      onChange={(e) => setTransfer({ ...transfer, to_department: e.target.value })}
                      className="soft-input w-full"
                    >
                      {departments.map((dept) => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mb-4 block">
                    <span className="mb-1 block text-sm text-ai-body">转办说明</span>
                    <textarea
                      value={transfer.note}
                      onChange={(e) => setTransfer({ ...transfer, note: e.target.value })}
                      className="soft-textarea min-h-24 w-full"
                      placeholder="可填写转办原因或办理提示"
                    />
                  </label>
                  <button disabled={!canReplySelected} className="primary-button w-full bg-amber-600 hover:brightness-105">
                    <Forward size={16} />
                    确认转办
                  </button>
                </form>

                <form onSubmit={submitReply} className={`rounded-[20px] border p-5 ${canReplySelected ? "border-ai-border" : "border-ai-border bg-ai-bg"}`}>
                  <h3 className="mb-4 font-semibold text-ai-title">回复事项</h3>
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
                    <span className="mb-1 block text-sm text-ai-body">回复部门</span>
                    <input
                      value={user?.department || reply.department}
                      readOnly
                      className="soft-input w-full"
                      required
                    />
                  </label>
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm text-ai-body">回复内容</span>
                    <textarea
                      value={reply.content}
                      onChange={(e) => setReply({ ...reply, content: e.target.value })}
                      className="soft-textarea min-h-36 w-full"
                      disabled={!canReplySelected}
                      required
                    />
                  </label>
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm text-ai-body">回复后状态</span>
                    <select
                      value={reply.status}
                      onChange={(e) => setReply({ ...reply, status: e.target.value })}
                      className="soft-input w-full"
                      disabled={!canReplySelected}
                    >
                      <option value="replied">已回复</option>
                      <option value="completed">已完成</option>
                      <option value="processing">处理中</option>
                    </select>
                  </label>
                  <label className={`mb-4 flex items-center gap-2 rounded-xl border border-dashed border-ai-border px-3 py-3 text-sm text-ai-body ${canReplySelected ? "cursor-pointer hover:border-ai-primary/40" : "cursor-not-allowed opacity-60"}`}>
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
                    className="primary-button w-full"
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
