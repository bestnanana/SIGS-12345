import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, FilePlus2, RefreshCw } from "lucide-react";
import { api } from "../api";
import { formatTime } from "../constants";
import { LocaleLink, toUserStatusKey, useLanguage, useUserStatusMap } from "../i18n";

export default function MyTicketsPage() {
  const { t, language } = useLanguage();
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const statusMap = useUserStatusMap();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStatus, setActiveStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const statusEntries = useMemo(() => Object.entries(statusMap), [statusMap]);

  const statusCounts = useMemo(() => {
    const counts = statusEntries.reduce((acc, [status]) => ({ ...acc, [status]: 0 }), {});
    rows.forEach((ticket) => {
      const status = toUserStatusKey(ticket.status);
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [statusEntries, rows]);

  const groupedTickets = useMemo(() => {
    return statusEntries
      .map(([status, meta]) => ({
        status,
        meta,
        items: rows.filter((ticket) => toUserStatusKey(ticket.status) === status)
      }))
      .filter((group) => group.status === activeStatus);
  }, [activeStatus, statusEntries, rows]);

  async function load(p = page) {
    setLoading(true);
    try {
      const res = await api.get("/tickets", { params: { page: p, pageSize } });
      const data = res.data;
      if (data && Array.isArray(data.rows)) {
        setRows(data.rows);
        setTotal(data.total || 0);
        setError("");
      } else if (Array.isArray(data)) {
        setRows(data);
        setTotal(data.length);
        setError("");
      } else {
        setError("事项接口返回异常，请确认后端已重启到最新版本。");
      }
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.message || "事项加载失败，请确认后端服务正在运行。");
    } finally {
      setLoading(false);
    }
  }

  function goPage(p) {
    const target = Math.max(1, Math.min(p, totalPages));
    setPage(target);
    load(target);
  }

  useEffect(() => {
    load(1);
  }, []);

  return (
    <div className="app-card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ai-border px-6 py-5">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-ai-title">{t("tickets.title")}</div>
          <div className="mt-2 text-sm text-ai-body">{t("tickets.desc")}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => load(page)} className="ghost-button">
            <RefreshCw size={16} />
            {t("action.refresh")}
          </button>
          <LocaleLink to="/new" className="primary-button">
            <FilePlus2 size={16} />
            {t("nav.new")}
          </LocaleLink>
        </div>
      </div>

      <div className="border-b border-ai-border px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {statusEntries.map(([value, meta]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveStatus(value)}
              className={`rounded-xl border px-4 py-3 text-left transition duration-200 ${
                activeStatus === value
                  ? "border-ai-primary bg-ai-primary/10 text-ai-primary"
                  : "border-ai-border bg-white text-ai-body hover:bg-[#F7F7FB]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium">{meta.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${meta.badgeClassName || meta.className}`}>{statusCounts[value] || 0}</span>
              </div>
              <div className="mt-1 text-2xl font-semibold">{statusCounts[value] || 0}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-6">
        {loading ? (
          <div className="rounded-xl bg-ai-bg px-6 py-12 text-center text-sm text-slate-500">{t("common.loading")}</div>
        ) : error ? (
          <div className="rounded-xl bg-amber-50 px-6 py-12 text-center text-sm text-amber-700 ring-1 ring-amber-100">{error}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl bg-ai-bg px-6 py-12 text-center text-sm text-slate-500">{t("tickets.empty")}</div>
        ) : (
          <div className="space-y-6">
            {groupedTickets.map((group) => (
              <section key={group.status} className="overflow-hidden rounded-xl border border-ai-border bg-white">
                <div className="flex items-center justify-between gap-4 bg-ai-bg px-5 py-4">
                  <div>
                    <h2 className="text-base font-semibold text-ai-title">{group.meta.label}</h2>
                    <p className="mt-1 text-xs text-ai-muted">{t("common.records", { count: group.items.length })}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${group.meta.badgeClassName || group.meta.className}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${group.meta.dotClassName || "bg-current"}`} />
                    {group.meta.label}
                  </span>
                </div>

                {group.items.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-ai-muted">{t("tickets.emptyGroup")}</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {group.items.map((ticket) => (
                      <article key={ticket.id} className="grid gap-4 px-5 py-4 transition duration-200 hover:bg-[#F7F7FB] lg:grid-cols-[minmax(0,1fr)_180px_96px] lg:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ai-primary">#{String(ticket.id).padStart(6, "0")}</span>
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${group.meta.badgeClassName || group.meta.className}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${group.meta.dotClassName || "bg-current"}`} />
                              {group.meta.label}
                            </span>
                          </div>
                          <h3 className="mt-2 truncate text-sm font-semibold text-ai-title">{ticket.title}</h3>
                          <div className="mt-1 text-xs text-ai-muted">
                            {ticket.field} · {t("common.department")}：{ticket.department || t("common.notAssigned")}
                          </div>
                        </div>
                        <div className="text-sm text-ai-body">{formatTime(ticket.created_at, dateLocale)}</div>
                        <LocaleLink to={`/tickets/${ticket.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-ai-primary hover:brightness-110">
                          <Eye size={16} />
                          {t("action.viewDetails")}
                        </LocaleLink>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button onClick={() => goPage(page - 1)} disabled={page <= 1} className="ghost-button disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-ai-muted">{page} / {totalPages}</span>
            <button onClick={() => goPage(page + 1)} disabled={page >= totalPages} className="ghost-button disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
