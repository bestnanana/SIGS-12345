import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import TypicalIssuesPanel from "../components/TypicalIssuesPanel";
import { formatTime } from "../constants";
import { toUserStatusKey, useLanguage, useUserStatusMap } from "../i18n";

export default function HomePage({ user }) {
  const { t } = useLanguage();
  const statusMap = useUserStatusMap();
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [ticketsError, setTicketsError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadTickets() {
      setLoadingTickets(true);
      try {
        const res = await api.get("/tickets");
        if (ignore) return;
        setTickets(Array.isArray(res.data) ? res.data : []);
        setTicketsError(Array.isArray(res.data) ? "" : "事项接口返回异常，请稍后重试。");
      } catch (err) {
        if (ignore) return;
        setTickets([]);
        setTicketsError(err.response?.data?.message || "暂时无法加载我的事项。");
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

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="grid min-w-0 gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-6">
        <div className="app-card">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-ai-title">{t("home.myTickets")}</h2>
              <p className="mt-2 text-sm leading-6 text-ai-body">{t("home.myTicketsDesc")}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ai-primary/10 text-ai-primary">
              <ClipboardList size={22} />
            </div>
          </div>
          <div className="mt-8 text-[44px] font-semibold leading-none tracking-tight text-ai-title">
            {loadingTickets ? "--" : tickets.length}
          </div>
          <Link to="/tickets" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-ai-primary hover:brightness-110">
            {t("home.enterMyTickets")}
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="app-card min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
                <AlertCircle size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-ai-title">{t("home.unresolved")}</h2>
              </div>
            </div>
            <span className="rounded-full bg-ai-primary/10 px-3 py-1 text-xs font-semibold text-ai-primary ring-1 ring-ai-primary/10">
              {loadingTickets ? t("common.loading") : t("common.items", { count: unresolvedTickets.length })}
            </span>
          </div>

          {ticketsError ? (
            <div className="rounded-2xl bg-amber-50 px-4 py-5 text-sm text-amber-800 ring-1 ring-amber-100">{ticketsError}</div>
          ) : loadingTickets ? (
            <div className="rounded-2xl bg-[#FAFAFC] px-4 py-8 text-center text-sm text-ai-body ring-1 ring-ai-border">{t("home.ticketsLoading")}</div>
          ) : unresolvedTickets.length === 0 ? (
            <div className="rounded-2xl bg-[#FAFAFC] px-4 py-8 text-center text-sm text-ai-body ring-1 ring-ai-border">{t("home.noUnresolved")}</div>
          ) : (
            <div className="space-y-3">
              {unresolvedTickets.slice(0, 4).map((ticket) => {
                const status = statusMap[toUserStatusKey(ticket.status)] || statusMap.pending;
                return (
                  <Link
                    key={ticket.id}
                    to={`/tickets/${ticket.id}`}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-ai-border bg-[#FAFAFC] px-4 py-3 transition duration-200 hover:-translate-y-0.5 hover:border-ai-primary/20 hover:bg-white hover:shadow-[0_12px_28px_rgba(0,0,0,0.05)]"
                  >
                    <div className="min-w-0">
                      <div className="max-w-full truncate font-semibold text-ai-title">{ticket.title}</div>
                      <div className="mt-1 text-xs text-ai-muted">
                        #{String(ticket.id).padStart(6, "0")} · {formatTime(ticket.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                      <span className={`hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 sm:inline-flex ${status.badgeClassName || status.className}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName || "bg-current"}`} />
                        {status.label}
                      </span>
                      <ArrowRight size={16} className="text-ai-primary" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <TypicalIssuesPanel limit={3} showViewAll />
    </div>
  );
}
