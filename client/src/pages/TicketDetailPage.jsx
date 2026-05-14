import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Forward, Paperclip, Star, ThumbsDown, ThumbsUp } from "lucide-react";
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
          <h2 className="text-lg font-semibold text-ai-title">官方回复</h2>
        </div>
        <div className="space-y-4 p-6">
          {replies.length === 0 ? (
            <div className="rounded-2xl bg-ai-bg p-5 text-sm text-ai-body">当前事项尚未回复，请关注后续办理进展。</div>
          ) : (
            replies.map((reply) => (
              <article key={reply.id} className="rounded-[20px] border border-ai-border">
                <div className="flex flex-wrap justify-between gap-3 border-b border-ai-border bg-ai-bg px-4 py-3 text-sm">
                  <span className="font-medium text-ai-title">回复部门：{reply.department}</span>
                  <span className="text-ai-muted">回复时间：{formatTime(reply.created_at)}</span>
                </div>
                <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-7 text-ai-body">{reply.content}</div>
                <div className="border-t border-slate-100 px-4 py-4">
                  <AttachmentList items={replyFilesById[reply.id]} />
                </div>
              </article>
            ))
          )}
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
