import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, RefreshCw, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatTime } from "../constants";

export default function LeaderApprovalPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [note, setNote] = useState("");
  const [submittingId, setSubmittingId] = useState(null);

  const active = useMemo(
    () => items.find((item) => item.id === activeId) || items[0] || null,
    [activeId, items]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/leader/reply-approvals");
      const nextItems = Array.isArray(res.data) ? res.data : [];
      setItems(nextItems);
      setActiveId((current) => current && nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id || null);
    } catch (err) {
      setItems([]);
      setError(err.response?.data?.message || "领导审批列表加载失败，请确认后端服务正在运行。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function review(action) {
    if (!active) return;
    setSubmittingId(active.id);
    setError("");
    try {
      await api.patch(`/leader/reply-approvals/${active.id}`, { action, note });
      setNote("");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "审批操作失败");
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="app-card h-fit overflow-hidden p-0 xl:sticky xl:top-[150px]">
        <div className="flex items-center justify-between border-b border-ai-border px-6 py-5">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-ai-title">领导审批</div>
            <div className="mt-2 text-sm text-ai-body">审批二级管理员提交的事项回复。</div>
          </div>
          <button
            type="button"
            onClick={load}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-ai-border bg-white text-ai-body transition duration-200 hover:bg-ai-bg"
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-ai-body">加载中...</div>
        ) : error ? (
          <div className="px-6 py-6 text-sm text-amber-700">{error}</div>
        ) : items.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-ai-body">暂无待审批回复</div>
        ) : (
          <div className="max-h-[calc(100vh-230px)] overflow-y-auto p-3 scrollbar-thin">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveId(item.id);
                  setNote("");
                }}
                className={`mb-3 w-full rounded-2xl border p-4 text-left transition duration-200 ${
                  active?.id === item.id
                    ? "border-ai-primary/40 bg-ai-primary/10"
                    : "border-ai-border bg-white hover:bg-ai-bg"
                }`}
              >
                <div className="truncate font-semibold text-ai-title">{item.ticket_title}</div>
                <div className="mt-2 text-xs leading-5 text-ai-muted">
                  {item.department} · {item.requester_name} · {formatTime(item.created_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="app-card min-w-0 overflow-hidden p-0">
        {!active ? (
          <div className="px-8 py-16 text-center text-ai-body">请选择待审批回复</div>
        ) : (
          <>
            <div className="mesh-hero border-b border-ai-border px-8 py-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="ai-chip mb-4">待领导审批</div>
                  <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">{active.ticket_title}</h1>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ai-body">
                    <span>提交人：{active.requester_name}</span>
                    <span>部门：{active.department}</span>
                    <span>期望状态：{active.requested_status}</span>
                    <span>送审时间：{formatTime(active.created_at)}</span>
                  </div>
                </div>
                <Link to={`/tickets/${active.ticket_id}`} className="ghost-button h-11">
                  <FileText size={16} />
                  事项详情
                </Link>
              </div>
            </div>

            <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-5">
                <section>
                  <h2 className="mb-3 font-semibold text-ai-title">事项原文</h2>
                  <div className="whitespace-pre-wrap rounded-[20px] border border-ai-border bg-ai-bg p-5 text-sm leading-7 text-ai-body">
                    {active.ticket_content}
                  </div>
                </section>

                <section>
                  <h2 className="mb-3 font-semibold text-ai-title">拟回复内容</h2>
                  <div className="whitespace-pre-wrap rounded-[20px] border border-ai-primary/15 bg-ai-primary/5 p-5 text-sm leading-7 text-ai-title">
                    {active.content}
                  </div>
                </section>
              </div>

              <aside className="space-y-5">
                <section className="rounded-[20px] border border-ai-border p-5">
                  <h2 className="mb-3 font-semibold text-ai-title">审批意见</h2>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="soft-textarea min-h-32 w-full"
                    placeholder="可填写通过说明或退回原因"
                  />
                </section>

                <div className="grid gap-3">
                  <button
                    type="button"
                    disabled={submittingId === active.id}
                    onClick={() => review("approve")}
                    className="primary-button w-full bg-emerald-600 hover:brightness-105"
                  >
                    <CheckCircle2 size={17} />
                    审批通过
                  </button>
                  <button
                    type="button"
                    disabled={submittingId === active.id}
                    onClick={() => review("reject")}
                    className="ghost-button w-full border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
                  >
                    <XCircle size={17} />
                    退回修改
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
