import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Download, Forward, MessageSquare, Paperclip, Star, ThumbsDown, ThumbsUp, UserRound } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, serverOrigin } from "../api";
import { formatTime, statusMap } from "../constants";

function AttachmentList({ items }) {
  if (!items?.length) return <div className="text-sm text-slate-500">暂无附件</div>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <a
          key={item.id}
          href={`${serverOrigin}${item.file_path}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-xl border border-ai-border bg-ai-bg px-3 py-2 text-sm transition duration-200 hover:border-ai-primary/30"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip size={16} className="shrink-0 text-ai-primary" />
            <span className="truncate">{item.original_name}</span>
          </span>
          <Download size={16} className="shrink-0 text-slate-500" />
        </a>
      ))}
    </div>
  );
}

function formatTransferTitle(item) {
  const fromOperator = item.operator_name || "管理员";
  const targetOperator = item.target_operator_name || "管理员";
  return `${item.from_department}的${fromOperator} 转办给 ${item.to_department}的${targetOperator}`;
}

function adminLevelLabel(level) {
  const labels = {
    0: "超级管理员",
    1: "一级管理员",
    2: "二级管理员"
  };
  return labels[Number(level)] || "管理员";
}

function sortByTime(a, b) {
  return new Date(a.time || 0).getTime() - new Date(b.time || 0).getTime();
}

export default function TicketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await api.get(`/tickets/${id}`);
    setData(res.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  const replyFilesById = useMemo(() => {
    return (data?.replyAttachments || []).reduce((acc, item) => {
      acc[item.reply_id] = [...(acc[item.reply_id] || []), item];
      return acc;
    }, {});
  }, [data]);

  const progressEvents = useMemo(() => {
    const ticket = data?.ticket;
    if (!ticket) return [];

    const replies = Array.isArray(data.replies) ? data.replies : [];
    const transfers = Array.isArray(data.transfers) ? data.transfers : [];
    const events = [
      {
        key: `submitted-${ticket.id}`,
        type: "submitted",
        title: "提交事项",
        time: ticket.created_at,
        person: ticket.is_anonymous ? "匿名提交" : ticket.submitter_name || "学生",
        detail: `提交至 ${ticket.department || "未指定"}，当前由 ${ticket.current_department || "党政办"} 承办。`
      }
    ];

    transfers.forEach((item) => {
      events.push({
        key: `transfer-${item.id}`,
        type: "transfer",
        title: "转办事项",
        time: item.created_at,
        person: item.operator_name || "管理员",
        detail: `${item.from_department} 转办至 ${item.to_department}${item.target_operator_name ? `，接收人：${item.target_operator_name}` : ""}${item.note ? `。说明：${item.note}` : ""}`
      });
    });

    replies.forEach((reply) => {
      events.push({
        key: `reply-${reply.id}`,
        type: "reply",
        replyId: reply.id,
        title: "管理员回复",
        time: reply.created_at,
        person: reply.replier_name || `${reply.department}管理员`,
        detail: reply.content
      });
    });

    return events.sort(sortByTime);
  }, [data]);

  async function rate(type) {
    await api.post(`/tickets/${id}/ratings`, { type });
    load();
  }

  if (loading) {
    return <div className="app-card text-center text-ai-body">加载中...</div>;
  }

  if (!data?.ticket) {
    return <div className="app-card text-center text-ai-body">事项不存在</div>;
  }

  const { ticket, ratings } = data;
  const replies = Array.isArray(data.replies) ? data.replies : [];
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  const currentHandler = data.currentHandler;
  const latestReply = replies.length ? replies[replies.length - 1] : null;
  const status = statusMap[ticket.status] || statusMap.pending;

  return (
    <div className="space-y-6">
      <div className="app-card overflow-hidden p-0">
        <div className="mesh-hero border-b border-ai-border px-8 py-6">
          <button onClick={() => navigate(-1)} className="mb-5 flex items-center gap-2 text-sm font-semibold text-ai-primary hover:brightness-110">
            <ArrowLeft size={16} />
            返回
          </button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">{ticket.title}</h1>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ai-body">
                <span>部门：{ticket.department || "未指定"}</span>
                <span>当前承办：{ticket.current_department || "党政办"}</span>
                <span>提交人：{ticket.is_anonymous ? "匿名" : ticket.submitter_name}</span>
                <span>提交时间：{formatTime(ticket.created_at)}</span>
              </div>
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ${status.className}`}>{status.label}</span>
          </div>
        </div>

        <div className="grid gap-6 p-8 lg:grid-cols-[1fr_320px]">
          <section>
            <h2 className="mb-3 text-base font-semibold text-ai-title">用户提交内容</h2>
            <div className="min-h-40 whitespace-pre-wrap rounded-[20px] border border-ai-border bg-ai-bg p-5 text-sm leading-7 text-ai-body">
              {ticket.content}
            </div>
          </section>
          <aside>
            <h2 className="mb-3 text-base font-semibold text-ai-title">用户上传附件</h2>
            <AttachmentList items={attachments} />
          </aside>
        </div>
      </div>

      <section className="app-card p-0">
        <div className="border-b border-ai-border px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ai-title">
            <Clock3 size={18} />
            办理进度
          </h2>
        </div>
        <div className="grid gap-4 p-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-ai-border bg-ai-bg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ai-primary" />
                <div>
                  <div className="text-sm font-semibold text-ai-title">当前办理状态</div>
                  <div className="mt-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ring-1 ${status.className}`}>{status.label}</span>
                  </div>
                  <div className="mt-2 text-xs text-ai-muted">最近更新：{formatTime(ticket.updated_at || ticket.created_at)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-ai-border bg-ai-bg p-4">
              <div className="flex items-start gap-3">
                <UserRound size={18} className="mt-0.5 shrink-0 text-ai-primary" />
                <div>
                  <div className="text-sm font-semibold text-ai-title">当前办理人</div>
                  <div className="mt-2 text-base font-semibold text-ai-title">{currentHandler?.name || "暂未分配"}</div>
                  <div className="mt-1 text-xs text-ai-muted">
                    {currentHandler
                      ? `${currentHandler.department || ticket.current_department || "党政办"} · ${adminLevelLabel(currentHandler.admin_level)}`
                      : `${ticket.current_department || "党政办"} 暂无可见办理人`}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-ai-border bg-ai-bg p-4">
              <div className="flex items-start gap-3">
                <MessageSquare size={18} className="mt-0.5 shrink-0 text-ai-primary" />
                <div>
                  <div className="text-sm font-semibold text-ai-title">管理员回复状况</div>
                  <div className="mt-2 text-base font-semibold text-ai-title">
                    {replies.length ? `已回复 ${replies.length} 次` : "尚未回复"}
                  </div>
                  <div className="mt-1 text-xs text-ai-muted">
                    {latestReply
                      ? `最近回复：${latestReply.replier_name || latestReply.department} · ${formatTime(latestReply.created_at)}`
                      : "当前等待承办部门回复"}
                  </div>
                </div>
              </div>
            </div>
        </div>
      </section>

      {transfers.length ? (
        <section className="app-card p-0">
          <div className="border-b border-ai-border px-6 py-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ai-title">
              <Forward size={18} />
              转办记录
            </h2>
          </div>
          <div className="space-y-3 p-6">
            {transfers.map((item) => (
              <div key={item.id} className="rounded-2xl border border-ai-border bg-ai-bg p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-medium text-ai-title">{formatTransferTitle(item)}</span>
                  <span className="text-ai-muted">{formatTime(item.created_at)}</span>
                </div>
                {item.note ? <div className="mt-2 text-slate-600">说明：{item.note}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="app-card p-0">
        <div className="border-b border-ai-border px-6 py-5">
          <h2 className="text-lg font-semibold text-ai-title">进度情况</h2>
        </div>
        <div className="p-6">
          <div className="relative space-y-0">
            {progressEvents.map((event, index) => {
              const isLast = index === progressEvents.length - 1;
              const isReply = event.type === "reply";
              return (
                <article key={event.key} className="relative grid gap-4 pb-6 pl-12 last:pb-0 md:grid-cols-[160px_1fr]">
                  {!isLast ? <div className="absolute left-[17px] top-9 h-[calc(100%-12px)] w-px bg-ai-border" /> : null}
                  <div className="absolute left-0 top-1 flex h-9 w-9 items-center justify-center rounded-full border-4 border-white bg-ai-primary text-sm font-semibold text-white shadow-sm">
                    {index + 1}
                  </div>
                  <div className="pt-1 text-xs text-ai-muted md:text-right">
                    {formatTime(event.time)}
                  </div>
                  <div className="rounded-2xl border border-ai-border bg-ai-bg px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-ai-title">{event.title}</div>
                        <div className="mt-1 text-xs text-ai-muted">经办：{event.person}</div>
                      </div>
                      {isReply ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                          已回复
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ai-body">{event.detail}</div>
                    {isReply ? (
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <AttachmentList items={replyFilesById[event.replyId]} />
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="app-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-ai-title">评价办理结果</div>
            <div className="mt-1 text-sm text-ai-body">你的反馈会帮助平台持续改进服务质量。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => rate("like")} className="ghost-button h-10">
              <ThumbsUp size={16} /> 点赞 {ratings.like || 0}
            </button>
            <button onClick={() => rate("dislike")} className="ghost-button h-10">
              <ThumbsDown size={16} /> 点踩 {ratings.dislike || 0}
            </button>
            <button onClick={() => rate("favorite")} className="ghost-button h-10">
              <Star size={16} /> 收藏 {ratings.favorite || 0}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
