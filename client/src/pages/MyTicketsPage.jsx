import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, CheckCircle2, Clock3, FilePlus2, FileText, RefreshCw, Search } from "lucide-react";
import { api } from "../api";
import { displayFieldName, formatTime, ticketRouteId } from "../constants";
import { getFavoriteTicketIds } from "../favorites";
import { LocaleLink, toUserStatusKey, useLanguage, useUserStatusMap } from "../i18n";

function matchesKeyword(ticket, keyword) {
  if (!keyword) return true;
  const target = [
    ticket.title,
    ticket.content,
    ticket.field,
    ticket.department,
    ticket.current_department,
    ticket.ticket_code
  ].filter(Boolean).join(" ").toLowerCase();
  return target.includes(keyword.toLowerCase());
}

export default function MyTicketsPage() {
  const { t, language } = useLanguage();
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const statusMap = useUserStatusMap();
  const [rows, setRows] = useState([]);
  const [favoriteRows, setFavoriteRows] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(getFavoriteTicketIds);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("submitted");
  const [keyword, setKeyword] = useState("");
  const pageSize = 100;

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/tickets", { params: { page: 1, pageSize } });
      const data = res.data;
      if (data && Array.isArray(data.rows)) {
        setRows(data.rows);
        setError("");
      } else if (Array.isArray(data)) {
        setRows(data);
        setError("");
      } else {
        setError(t("tickets.apiInvalid"));
      }
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.message || t("tickets.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadFavoriteRows(ids = favoriteIds) {
    const uniqueIds = Array.from(new Set(ids.map(String))).filter(Boolean);
    if (!uniqueIds.length) {
      setFavoriteRows([]);
      return;
    }
    const results = await Promise.allSettled(uniqueIds.map((ticketId) => api.get(`/tickets/${ticketId}`)));
    setFavoriteRows(results
      .filter((result) => result.status === "fulfilled" && result.value.data?.ticket)
      .map((result) => result.value.data.ticket));
  }

  useEffect(() => {
    load();
  }, [t]);

  useEffect(() => {
    loadFavoriteRows(favoriteIds);
  }, [favoriteIds]);

  useEffect(() => {
    function refreshFavorites() {
      const nextIds = getFavoriteTicketIds();
      setFavoriteIds(nextIds);
      loadFavoriteRows(nextIds);
    }
    window.addEventListener("ticket-favorites-changed", refreshFavorites);
    window.addEventListener("storage", refreshFavorites);
    return () => {
      window.removeEventListener("ticket-favorites-changed", refreshFavorites);
      window.removeEventListener("storage", refreshFavorites);
    };
  }, []);

  const enrichedRows = useMemo(() => {
    const submittedIds = new Set(rows.flatMap((ticket) => [String(ticket.id), String(ticketRouteId(ticket))]));
    const mergedRows = [
      ...rows,
      ...favoriteRows.filter((ticket) => {
        const id = String(ticket.id);
        const routeId = String(ticketRouteId(ticket));
        return !submittedIds.has(id) && !submittedIds.has(routeId);
      })
    ];
    return mergedRows.map((ticket) => {
      const routeId = ticketRouteId(ticket);
      const isSubmitted = submittedIds.has(String(ticket.id)) || submittedIds.has(String(routeId));
      const isFavorite = favoriteIds.includes(String(routeId)) || favoriteIds.includes(String(ticket.id));
      return {
        ...ticket,
        routeId,
        isSubmitted,
        isFavorite,
        source: isSubmitted ? "submitted" : "favorite"
      };
    });
  }, [favoriteIds, favoriteRows, rows]);

  const pendingCount = enrichedRows.filter((ticket) => toUserStatusKey(ticket.status) === "pending").length;
  const completedCount = enrichedRows.filter((ticket) => toUserStatusKey(ticket.status) === "handled").length;
  const favoriteCount = enrichedRows.filter((ticket) => ticket.isFavorite).length;

  const statCards = [
    { key: "submitted", label: t("tickets.statsSubmitted"), value: rows.length, icon: FileText },
    { key: "pending", label: t("tickets.statsPending"), value: pendingCount, icon: Clock3 },
    { key: "completed", label: t("tickets.statsCompleted"), value: completedCount, icon: CheckCircle2 },
    { key: "favorite", label: t("tickets.statsFavorite"), value: favoriteCount, icon: Bookmark }
  ];

  const filteredRows = useMemo(() => {
    return enrichedRows
      .filter((ticket) => {
        if (activeFilter === "pending") return toUserStatusKey(ticket.status) === "pending";
        if (activeFilter === "completed") return toUserStatusKey(ticket.status) === "handled";
        if (activeFilter === "favorite") return ticket.isFavorite;
        return ticket.isSubmitted;
      })
      .filter((ticket) => matchesKeyword(ticket, keyword.trim()))
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  }, [activeFilter, enrichedRows, keyword]);

  return (
    <div className="app-card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ai-border px-6 py-5">
        <div>
          <div className="text-2xl font-semibold tracking-tight text-ai-title">{t("tickets.title")}</div>
          <div className="mt-2 text-sm text-ai-body">{t("tickets.desc")}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="ghost-button">
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            const active = activeFilter === card.key;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => setActiveFilter(card.key)}
                className={`rounded-xl border px-4 py-3 text-left transition duration-200 ${
                  active
                    ? "border-ai-primary bg-ai-primary/10 text-ai-primary"
                    : "border-ai-border bg-white text-ai-body hover:bg-ai-bg"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium">{card.label}</span>
                  <Icon size={17} />
                </div>
                <div className="mt-2 text-2xl font-semibold">{card.value}</div>
              </button>
            );
          })}
        </div>

        <label className="relative mt-4 block">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ai-muted" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="soft-input h-11 w-full pl-10 text-sm"
            placeholder={t("tickets.searchPlaceholder")}
          />
        </label>
      </div>

      <div className="px-6 py-6">
        {loading ? (
          <div className="rounded-xl bg-ai-bg px-6 py-12 text-center text-sm text-slate-500">{t("common.loading")}</div>
        ) : error ? (
          <div className="rounded-xl bg-amber-50 px-6 py-12 text-center text-sm text-amber-700 ring-1 ring-amber-100">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-xl bg-ai-bg px-6 py-12 text-center text-sm text-slate-500">
            {activeFilter === "favorite" ? t("tickets.emptyFavorite") : t("tickets.empty")}
          </div>
        ) : (
          <div className="divide-y divide-ai-border overflow-hidden rounded-xl border border-ai-border bg-white">
            {filteredRows.map((ticket) => {
              const status = statusMap[toUserStatusKey(ticket.status)] || statusMap.pending;
              return (
                <LocaleLink
                  key={ticket.id}
                  to={`/tickets/${ticket.routeId}`}
                  className="grid gap-4 px-5 py-4 transition duration-200 hover:bg-ai-bg lg:grid-cols-[minmax(0,1fr)_11rem_7rem] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${status.badgeClassName || status.className}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName || "bg-current"}`} />
                        {status.label}
                      </span>
                      <span className="rounded-full bg-ai-bg px-2.5 py-1 text-xs font-semibold text-ai-body ring-1 ring-ai-border">
                        {ticket.source === "favorite" ? t("tickets.sourceFavorite") : t("tickets.sourceSubmitted")}
                      </span>
                    </div>
                    <h3 className="mt-2 truncate text-sm font-semibold text-ai-title">{ticket.title}</h3>
                    <div className="mt-1 text-xs text-ai-muted">
                      {displayFieldName(ticket.field, language)} · {t("common.department")}：{ticket.department || t("common.notAssigned")}
                    </div>
                  </div>
                  <div className="text-sm text-ai-body">{formatTime(ticket.created_at, dateLocale)}</div>
                  <span className="text-sm font-medium text-ai-primary">{t("action.viewDetails")}</span>
                </LocaleLink>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
