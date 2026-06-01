import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, ClipboardList, FileText, Clock, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import TypicalIssuesPanel from "../components/TypicalIssuesPanel";
import { formatTime } from "../constants";
import { LocaleLink, toUserStatusKey, useLanguage, useUserStatusMap } from "../i18n";

export default function HomePage({ user }) {
  const { t, language } = useLanguage();
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const statusMap = useUserStatusMap();
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [ticketsError, setTicketsError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadTickets() {
      setLoadingTickets(true);
      try {
        const res = await api.get("/tickets", { params: { pageSize: 50 } });
        if (ignore) return;
        const data = res.data;
        const list = data && Array.isArray(data.rows) ? data.rows : Array.isArray(data) ? data : [];
        setTickets(list);
        setTicketsError(list.length > 0 || (data && Array.isArray(data.rows)) || Array.isArray(data) ? "" : "事项接口返回异常，请稍后重试。");
      } catch (err) {
        if (ignore) return;
        setTickets([]);
        setTicketsError(err.response?.data?.message || "暂时无法加载我发起的事项。");
      } finally {
        if (!ignore) setLoadingTickets(false);
      }
    }

    loadTickets();
    return () => {
      ignore = true;
    };
  }, []);

  const unresolvedTickets = useMemo(
    () => tickets.filter((ticket) => toUserStatusKey(ticket.status) === "pending"),
    [tickets]
  );

  const completedTickets = useMemo(
    () => tickets.filter((ticket) => toUserStatusKey(ticket.status) === "handled"),
    [tickets]
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 欢迎区域 */}
      <section className="mesh-hero rounded-2xl p-6 sm:p-8">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-ai-title sm:text-3xl">
            {t("nav.home")}
          </h1>
          <p className="mt-2 text-sm text-ai-body sm:text-base">
            {t("home.myTicketsDesc")}
          </p>
        </div>
      </section>

      {/* 统计卡片 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
        {/* 我的事项总数 */}
        <div className="app-card app-card-hover group">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-tsinghua-100 to-tsinghua-200 text-tsinghua-700 transition-transform duration-300 group-hover:scale-110">
              <FileText size={22} />
            </div>
            <span className="ai-chip">
              {t("home.myTickets")}
            </span>
          </div>
          <div className="mt-4 text-3xl font-bold tracking-tight text-ai-title">
            {loadingTickets ? (
              <div className="h-8 w-16 animate-pulse rounded-lg bg-ai-bg" />
            ) : (
              tickets.length
            )}
          </div>
          <LocaleLink 
            to="/tickets" 
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ai-primary transition-all duration-300 hover:gap-2.5"
          >
            {t("home.enterMyTickets")}
            <ArrowRight size={15} />
          </LocaleLink>
        </div>

        {/* 待处理事项 */}
        <div className="app-card app-card-hover group">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700 transition-transform duration-300 group-hover:scale-110">
              <Clock size={22} />
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-600 ring-1 ring-amber-200">
              {t("home.unresolved")}
            </span>
          </div>
          <div className="mt-4 text-3xl font-bold tracking-tight text-ai-title">
            {loadingTickets ? (
              <div className="h-8 w-16 animate-pulse rounded-lg bg-ai-bg" />
            ) : (
              unresolvedTickets.length
            )}
          </div>
          <p className="mt-3 text-sm text-ai-muted">
            {loadingTickets ? t("common.loading") : t("common.items", { count: unresolvedTickets.length })}
          </p>
        </div>

        {/* 已完成事项 */}
        <div className="app-card app-card-hover group">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-green-100 to-green-200 text-green-700 transition-transform duration-300 group-hover:scale-110">
              <CheckCircle2 size={22} />
            </div>
            <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-600 ring-1 ring-green-200">
              已完成
            </span>
          </div>
          <div className="mt-4 text-3xl font-bold tracking-tight text-ai-title">
            {loadingTickets ? (
              <div className="h-8 w-16 animate-pulse rounded-lg bg-ai-bg" />
            ) : (
              completedTickets.length
            )}
          </div>
          <p className="mt-3 text-sm text-ai-muted">
            {loadingTickets ? t("common.loading") : `完成率 ${tickets.length > 0 ? Math.round((completedTickets.length / tickets.length) * 100) : 0}%`}
          </p>
        </div>
      </section>

      {/* 待处理事项列表 */}
      <section className="app-card">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <AlertCircle size={20} />
            </div>
            <h2 className="text-lg font-semibold text-ai-title">{t("home.unresolved")}</h2>
          </div>
        </div>

        {ticketsError ? (
          <div className="rounded-xl bg-red-50 px-4 py-4 text-sm text-red-600 ring-1 ring-red-200">
            {ticketsError}
          </div>
        ) : loadingTickets ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-xl bg-ai-bg p-4">
                <div className="h-4 w-3/4 rounded bg-ai-border" />
                <div className="mt-2 h-3 w-1/2 rounded bg-ai-border" />
              </div>
            ))}
          </div>
        ) : unresolvedTickets.length === 0 ? (
          <div className="rounded-xl bg-ai-bg px-4 py-12 text-center">
            <CheckCircle2 size={48} className="mx-auto mb-3 text-green-400" />
            <p className="text-sm font-medium text-ai-body">{t("home.noUnresolved")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {unresolvedTickets.slice(0, 5).map((ticket, index) => {
              const status = statusMap[toUserStatusKey(ticket.status)] || statusMap.pending;
              return (
                <LocaleLink
                  key={ticket.id}
                  to={`/tickets/${ticket.id}`}
                  className="group flex items-center justify-between rounded-xl border border-ai-border bg-white p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-ai-primary/20 hover:shadow-card-hover"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-ai-muted">
                        #{String(ticket.id).padStart(6, "0")}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.badgeClassName || status.className}`}>
                        <span className={`h-1 w-1 rounded-full ${status.dotClassName || "bg-current"}`} />
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-1.5 truncate font-medium text-ai-title group-hover:text-ai-primary transition-colors duration-300">
                      {ticket.title}
                    </div>
                    <div className="mt-1 text-xs text-ai-muted">
                      {formatTime(ticket.created_at, dateLocale)}
                    </div>
                  </div>
                  <ArrowRight size={18} className="shrink-0 text-ai-muted transition-all duration-300 group-hover:translate-x-1 group-hover:text-ai-primary" />
                </LocaleLink>
              );
            })}
          </div>
        )}
      </section>

      {/* 典型问题 */}
      <TypicalIssuesPanel limit={3} showViewAll />
    </div>
  );
}
