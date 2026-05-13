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
          className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm hover:border-tsinghua-300"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip size={16} className="shrink-0 text-tsinghua-700" />
            <span className="truncate">{item.original_name}</span>
          </span>
          <Download size={16} className="shrink-0 text-slate-500" />
        </a>
      ))}
    </div>
  );
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
    return <div className="rounded-md bg-white p-8 text-center text-slate-500 shadow-soft ring-1 ring-slate-200">加载中...</div>;
  }

  if (!data?.ticket) {
    return <div className="rounded-md bg-white p-8 text-center text-slate-500 shadow-soft ring-1 ring-slate-200">事项不存在</div>;
  }

  const { ticket, ratings } = data;
  const replies = Array.isArray(data.replies) ? data.replies : [];
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  const status = statusMap[ticket.status] || statusMap.pending;

  return (
    <div className="space-y-5">
      <div className="rounded-md bg-white shadow-soft ring-1 ring-slate-200">
        <div className="border-b border-slate-200 px-6 py-4">
          <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-2 text-sm text-tsinghua-700 hover:text-tsinghua-900">
            <ArrowLeft size={16} />
            返回
          </button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{ticket.title}</h1>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
                <span>部门：{ticket.department || "未指定"}</span>
                <span>当前承办：{ticket.current_department || "党政办"}</span>
                <span>提交人：{ticket.is_anonymous ? "匿名" : ticket.submitter_name}</span>
                <span>提交时间：{formatTime(ticket.created_at)}</span>
              </div>
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ${status.className}`}>{status.label}</span>
          </div>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
          <section>
            <h2 className="mb-3 text-base font-semibold text-slate-900">用户提交内容</h2>
            <div className="min-h-40 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">
              {ticket.content}
            </div>
          </section>
          <aside>
            <h2 className="mb-3 text-base font-semibold text-slate-900">用户上传附件</h2>
            <AttachmentList items={attachments} />
          </aside>
        </div>
      </div>

      {transfers.length ? (
        <section className="rounded-md bg-white shadow-soft ring-1 ring-slate-200">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Forward size={18} />
              转办记录
            </h2>
          </div>
          <div className="space-y-3 p-6">
            {transfers.map((item) => (
              <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-medium text-slate-900">{item.from_department} 转办至 {item.to_department}</span>
                  <span className="text-slate-500">{formatTime(item.created_at)}</span>
                </div>
                {item.note ? <div className="mt-2 text-slate-600">说明：{item.note}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-md bg-white shadow-soft ring-1 ring-slate-200">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">官方回复</h2>
        </div>
        <div className="space-y-4 p-6">
          {replies.length === 0 ? (
            <div className="rounded-md bg-slate-50 p-5 text-sm text-slate-500">当前事项尚未回复，请关注后续办理进展。</div>
          ) : (
            replies.map((reply) => (
              <article key={reply.id} className="rounded-md border border-slate-200">
                <div className="flex flex-wrap justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                  <span className="font-medium text-slate-900">回复部门：{reply.department}</span>
                  <span className="text-slate-500">回复时间：{formatTime(reply.created_at)}</span>
                </div>
                <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-7 text-slate-700">{reply.content}</div>
                <div className="border-t border-slate-100 px-4 py-4">
                  <AttachmentList items={replyFilesById[reply.id]} />
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md bg-white p-5 shadow-soft ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-900">评价办理结果</div>
            <div className="mt-1 text-sm text-slate-500">你的反馈会帮助平台持续改进服务质量。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => rate("like")} className="flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm hover:bg-slate-50">
              <ThumbsUp size={16} /> 点赞 {ratings.like || 0}
            </button>
            <button onClick={() => rate("dislike")} className="flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm hover:bg-slate-50">
              <ThumbsDown size={16} /> 点踩 {ratings.dislike || 0}
            </button>
            <button onClick={() => rate("favorite")} className="flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm hover:bg-slate-50">
              <Star size={16} /> 收藏 {ratings.favorite || 0}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
