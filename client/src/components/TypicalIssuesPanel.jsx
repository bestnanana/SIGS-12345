import React, { useEffect, useState } from "react";
import { ArrowRight, Megaphone, MessageSquareText } from "lucide-react";
import { api } from "../api";
import { displayFieldName, formatTime } from "../constants";
import { LocaleLink, useLanguage } from "../i18n";

export default function TypicalIssuesPanel({ limit, showViewAll = false }) {
  const { t, language } = useLanguage();
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    api.get("/public/typical-tickets")
      .then((res) => {
        if (ignore) return;
        const data = res.data;
        if (data && Array.isArray(data.rows)) {
          setItems(data.rows);
          setError("");
        } else if (Array.isArray(data)) {
          setItems(data);
          setError("");
        } else {
          setItems([]);
          setError(t("typical.apiInvalid"));
        }
      })
      .catch(() => {
        if (ignore) return;
        setItems([]);
        setError(t("typical.loadFailed"));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [t]);

  const visibleItems = typeof limit === "number" ? items.slice(0, limit) : items;

  return (
    <section id="typical-issues" className="app-card overflow-hidden p-0">
      <div className="border-b border-ai-border px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ai-primary/10 text-ai-primary ring-1 ring-ai-primary/10">
              <Megaphone size={21} />
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold tracking-tight text-ai-title">{t("typical.title")}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ai-body">
                {t("typical.desc")}
              </p>
            </div>
          </div>
          {showViewAll && items.length > visibleItems.length ? (
            <LocaleLink to="/typical" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ai-primary transition duration-200 hover:bg-ai-primary/5">
              {t("action.viewAll")}
              <ArrowRight size={16} />
            </LocaleLink>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-center text-sm text-ai-body">{t("common.loading")}</div>
      ) : error ? (
        <div className="px-6 py-8 text-center text-sm text-amber-700">{error}</div>
      ) : visibleItems.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-ai-body">{t("typical.empty")}</div>
      ) : (
        <div className="divide-y divide-ai-border">
          {visibleItems.map((item) => (
            <article key={item.id} className="px-5 py-5 sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-lg font-semibold text-ai-title">{item.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ai-body">
                    <span>{t("common.field")}：{displayFieldName(item.field, language)}</span>
                    <span>{t("common.department")}：{item.department}</span>
                    <span>{t("common.publishedAt")}：{formatTime(item.published_at, dateLocale)}</span>
                  </div>
                </div>
                <span className="ai-chip shrink-0">{t("typical.tag")}</span>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl bg-ai-bg p-4 ring-1 ring-ai-border">
                  <div className="mb-2 text-sm font-semibold text-ai-title">{t("form.content")}</div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-7 text-ai-body">{item.content}</div>
                </section>
                <section className="rounded-2xl bg-ai-primary/5 p-4 ring-1 ring-ai-primary/10">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ai-title">
                    <MessageSquareText size={16} />
                    {t("typical.answer")}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-7 text-ai-body">
                    {item.reply_content || t("typical.noAnswer")}
                    {item.reply_department ? (
                      <div className="mt-3 text-xs text-ai-muted">
                        {item.reply_department} · {formatTime(item.reply_time, dateLocale)}
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
