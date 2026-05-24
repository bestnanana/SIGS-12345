import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Download, MessageSquare, Paperclip, SendHorizontal, Star } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, serverOrigin } from "../api";
import { formatTime } from "../constants";
import { toUserStatusKey, useLanguage, useUserStatusMap } from "../i18n";

function AttachmentList({ items, emptyText = "暂无附件" }) {
  if (!items?.length) return <div className="text-sm text-slate-500">{emptyText}</div>;
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

function sortByTime(a, b) {
  return new Date(a.time || 0).getTime() - new Date(b.time || 0).getTime();
}

export default function TicketDetailPage() {
  const { t } = useLanguage();
  const statusMap = useUserStatusMap();
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [survey, setSurvey] = useState({ score: 5, comment: "" });
  const [surveySaving, setSurveySaving] = useState(false);
  const [surveyMessage, setSurveyMessage] = useState("");

  async function load() {
    setLoading(true);
    const res = await api.get(`/tickets/${id}`);
    setData(res.data);
    if (res.data?.satisfaction) {
      setSurvey({
        score: Number(res.data.satisfaction.score || 5),
        comment: res.data.satisfaction.comment || ""
      });
    }
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
    const events = [
      {
        key: `submitted-${ticket.id}`,
        type: "submitted",
        title: "提交事项",
        time: ticket.created_at,
        person: ticket.is_anonymous ? "匿名提交" : ticket.submitter_name || "学生",
        detail: `提交至 ${ticket.department || "未指定"}，事项已进入办理流程。`
      }
    ];

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

  async function submitSatisfaction(e) {
    e.preventDefault();
    setSurveySaving(true);
    setSurveyMessage("");
    try {
      await api.post(`/tickets/${id}/satisfaction`, survey);
      setSurveyMessage("满意度评价已提交");
      await load();
    } catch (err) {
      setSurveyMessage(err.response?.data?.message || "满意度评价提交失败");
    } finally {
      setSurveySaving(false);
    }
  }

  if (loading) {
    return <div className="app-card text-center text-ai-body">{t("common.loading")}</div>;
  }

  if (!data?.ticket) {
    return <div className="app-card text-center text-ai-body">{t("detail.missing")}</div>;
  }

  const { ticket } = data;
  const replies = Array.isArray(data.replies) ? data.replies : [];
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const latestReply = replies.length ? replies[replies.length - 1] : null;
  const status = statusMap[toUserStatusKey(ticket.status)] || statusMap.pending;
  const isCompleted = ticket.status === "completed";

  return (
    <div className="space-y-6">
      <div className="app-card overflow-hidden p-0">
        <div className="mesh-hero border-b border-ai-border px-8 py-6">
          <button onClick={() => navigate(-1)} className="mb-5 flex items-center gap-2 text-sm font-semibold text-ai-primary hover:brightness-110">
            <ArrowLeft size={16} />
            {t("action.back")}
          </button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">{ticket.title}</h1>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ai-body">
                <span>{t("common.department")}：{ticket.department || t("common.notAssigned")}</span>
                <span>{t("common.submitter")}：{ticket.is_anonymous ? t("common.anonymous") : ticket.submitter_name}</span>
                <span>{t("common.submittedAt")}：{formatTime(ticket.created_at)}</span>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${status.badgeClassName || status.className}`}>
              <span className={`h-2 w-2 rounded-full ${status.dotClassName || "bg-current"}`} />
              {status.label}
            </span>
          </div>
        </div>

        <div className="grid gap-6 p-8 lg:grid-cols-[1fr_320px]">
          <section>
            <h2 className="mb-3 text-base font-semibold text-ai-title">{t("detail.userContent")}</h2>
            <div className="min-h-40 whitespace-pre-wrap rounded-[20px] border border-ai-border bg-ai-bg p-5 text-sm leading-7 text-ai-body">
              {ticket.content}
            </div>
          </section>
          <aside>
            <h2 className="mb-3 text-base font-semibold text-ai-title">{t("detail.uploadedFiles")}</h2>
            <AttachmentList items={attachments} emptyText={t("detail.noAttachments")} />
          </aside>
        </div>
      </div>

      <section className="app-card p-0">
        <div className="border-b border-ai-border px-6 py-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ai-title">
            <Clock3 size={18} />
            {t("detail.progress")}
          </h2>
        </div>
        <div className="grid gap-4 p-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-ai-border bg-ai-bg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ai-primary" />
                <div>
                  <div className="text-sm font-semibold text-ai-title">{t("detail.currentStatus")}</div>
                  <div className="mt-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${status.badgeClassName || status.className}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName || "bg-current"}`} />
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-ai-muted">{t("common.updatedAt")}：{formatTime(ticket.updated_at || ticket.created_at)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-ai-border bg-ai-bg p-4">
              <div className="flex items-start gap-3">
                <MessageSquare size={18} className="mt-0.5 shrink-0 text-ai-primary" />
                <div>
                  <div className="text-sm font-semibold text-ai-title">{t("detail.replyStatus")}</div>
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

      <section className="app-card p-0">
        <div className="border-b border-ai-border px-6 py-5">
          <h2 className="text-lg font-semibold text-ai-title">{t("detail.progressTimeline")}</h2>
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
                        <AttachmentList items={replyFilesById[event.replyId]} emptyText={t("detail.noAttachments")} />
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {isCompleted ? (
        <section className="app-card">
          <form onSubmit={submitSatisfaction} className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-semibold text-ai-title">满意度调查</div>
                <div className="mt-1 text-sm text-ai-body">请对本事项的办理过程和结果进行评分，评价将用于后台服务改进分析。</div>
              </div>
              {data.satisfaction ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  已评价 · {data.satisfaction.score} 分
                </span>
              ) : null}
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-ai-body">满意度评分</div>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((score) => {
                  const active = Number(survey.score) >= score;
                  return (
                    <button
                      key={score}
                      type="button"
                      onClick={() => {
                        if (!data.satisfaction) setSurvey((current) => ({ ...current, score }));
                      }}
                      disabled={Boolean(data.satisfaction)}
                      className={`flex h-11 w-11 items-center justify-center rounded-xl border transition duration-200 ${
                        active ? "border-amber-300 bg-amber-50 text-amber-500" : "border-ai-border bg-white text-ai-muted hover:bg-ai-bg"
                      }`}
                      title={`${score} 分`}
                      aria-label={`${score} 分`}
                    >
                      <Star size={18} fill={active ? "currentColor" : "none"} />
                    </button>
                  );
                })}
                <span className="flex h-11 items-center px-2 text-sm font-semibold text-ai-title">{survey.score} / 5 分</span>
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ai-body">评价说明</span>
              <textarea
                value={survey.comment}
                onChange={(e) => setSurvey((current) => ({ ...current, comment: e.target.value }))}
                className="soft-textarea min-h-24 w-full"
                maxLength={500}
                readOnly={Boolean(data.satisfaction)}
                placeholder="可填写对办理效率、沟通体验、处理结果的意见。"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-ai-muted">{surveyMessage || (data.satisfaction ? "满意度评价已提交，不能再次修改。" : "评价提交后不能修改，请确认后提交。")}</div>
              {!data.satisfaction ? (
                <button type="submit" disabled={surveySaving} className="primary-button">
                  <SendHorizontal size={16} />
                  {surveySaving ? "提交中..." : "提交评价"}
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
