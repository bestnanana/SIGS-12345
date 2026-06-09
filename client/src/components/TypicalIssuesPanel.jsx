import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Megaphone, Search } from "lucide-react";
import { api } from "../api";
import { displayFieldName, formatTime, ticketRouteId } from "../constants";
import { LocaleLink, useLanguage } from "../i18n";

function includesKeyword(item, keyword) {
  if (!keyword) return true;
  const target = [
    item.title,
    item.field,
    item.department,
    item.content,
    item.reply_content
  ].filter(Boolean).join(" ").toLowerCase();
  return target.includes(keyword.toLowerCase());
}

export default function TypicalIssuesPanel({ limit, showViewAll = false, showHeader = true }) {
  const { t, language } = useLanguage();
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const [keyword, setKeyword] = useState("");

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

  const fields = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.field).filter(Boolean)));
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (field && item.field !== field) return false;
      return includesKeyword(item, keyword.trim());
    });
  }, [field, items, keyword]);

  const visibleItems = typeof limit === "number" ? filteredItems.slice(0, limit) : filteredItems;

  return (
    <section id="typical-issues" className="app-card overflow-hidden p-0">
      {showHeader ? (
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
            {showViewAll && filteredItems.length > visibleItems.length ? (
              <LocaleLink to="/typical" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ai-primary transition duration-200 hover:bg-ai-primary/5">
                {t("action.viewAll")}
                <ArrowRight size={16} />
              </LocaleLink>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border-b border-ai-border bg-white px-5 py-4 sm:px-7">
        <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
          <select
            value={field}
            onChange={(event) => setField(event.target.value)}
            className="soft-input h-11 text-sm"
          >
            <option value="">{t("typical.allFields")}</option>
            {fields.map((item) => (
              <option key={item} value={item}>{displayFieldName(item, language)}</option>
            ))}
          </select>
          <label className="relative block">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ai-muted" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className="soft-input h-11 w-full pl-10 text-sm"
              placeholder={t("typical.searchPlaceholder")}
            />
          </label>
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
            <LocaleLink
              key={item.id}
              to={`/tickets/${ticketRouteId(item)}`}
              className="group block px-5 py-5 transition duration-200 hover:bg-ai-bg sm:px-7"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ai-chip">{t("typical.tag")}</span>
                    <span className="text-xs text-ai-muted">{displayFieldName(item.field, language)}</span>
                    <span className="text-xs text-ai-muted">{formatTime(item.published_at || item.created_at, dateLocale)}</span>
                  </div>
                  <h3 className="mt-2 break-words text-lg font-semibold text-ai-title transition duration-200 group-hover:text-ai-primary">{item.title}</h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ai-body">{item.content}</p>
                  <div className="mt-3 text-xs text-ai-muted">
                    {t("common.department")}：{item.department || t("common.notAssigned")}
                  </div>
                </div>
                <ArrowRight size={18} className="mt-1 shrink-0 text-ai-muted transition duration-200 group-hover:translate-x-1 group-hover:text-ai-primary" />
              </div>
            </LocaleLink>
          ))}
        </div>
      )}
    </section>
  );
}
