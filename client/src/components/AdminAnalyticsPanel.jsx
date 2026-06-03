import React from "react";
import { useLanguage, useStatusMap } from "../i18n";

function normalizeEntries(entries = []) {
  return entries
    .filter(([label]) => label !== undefined && label !== null && String(label).trim() !== "")
    .map(([label, count]) => [String(label), Number(count || 0)]);
}

function BarChart({ entries, maxValue, colorClass = "bg-ai-primary", emptyText = "No data" }) {
  const safeEntries = normalizeEntries(entries);
  if (!safeEntries.length) {
    return (
      <div className="rounded-xl bg-ai-bg px-4 py-8 text-center text-sm text-ai-muted">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {safeEntries.map(([label, count]) => (
        <div key={label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
          <span className="truncate text-ai-body" title={label}>{label}</span>
          <span className="h-5 overflow-hidden rounded-full bg-slate-100">
            <span
              className={`block h-full rounded-full ${colorClass} transition-all duration-500`}
              style={{ width: `${maxValue ? ((count || 0) / maxValue) * 100 : 0}%` }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums text-ai-title">{count || 0}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalyticsPanel({ stats, user }) {
  const { t } = useLanguage();
  const statusMap = useStatusMap();
  const safeStats = {
    total: Number(stats?.total || 0),
    active: Number(stats?.active || 0),
    completed: Number(stats?.completed || 0),
    completeRate: stats?.completeRate || "0%",
    statusCounts: stats?.statusCounts || {},
    departmentEntries: normalizeEntries(stats?.departmentEntries || []),
    fieldEntries: normalizeEntries(stats?.fieldEntries || []),
    satisfactionDistribution: stats?.satisfactionDistribution || null
  };

  const summaryCards = [
    { label: t("admin.visibleTickets"), value: safeStats.total, note: user?.role === "super_admin" ? t("admin.allScope") : (user?.department ? t("admin.departmentScope", { department: user.department }) : t("admin.allScope")) },
    { label: t("admin.activeTickets"), value: safeStats.active, note: t("admin.activeTicketsNote") },
    { label: t("admin.replyRate"), value: safeStats.completed, note: t("admin.replyRateNote") },
    { label: t("admin.completeRate"), value: safeStats.completeRate, note: t("admin.completeRateNote") }
  ];

  const statusEntries = Object.entries(safeStats.statusCounts).map(([key, count]) => [
    statusMap[key]?.label || key,
    Number(count || 0)
  ]);
  const maxStatusCount = Math.max(1, ...statusEntries.map(([, count]) => count));
  const maxDepartmentCount = Math.max(1, ...safeStats.departmentEntries.map(([, count]) => count));
  const maxFieldCount = Math.max(1, ...safeStats.fieldEntries.map(([, count]) => count));

  const statCardEntries = [
    { label: t("admin.byStatus"), entries: statusEntries, max: maxStatusCount, color: "bg-ai-primary" },
    { label: t("admin.byDepartment"), entries: safeStats.departmentEntries, max: maxDepartmentCount, color: "bg-emerald-500" },
    { label: t("admin.byField"), entries: safeStats.fieldEntries, max: maxFieldCount, color: "bg-amber-500" }
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-ai-border bg-white p-5 shadow-sm">
            <div className="text-sm text-ai-body">{card.label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-ai-title">{card.value}</div>
            <div className="mt-1 text-xs text-ai-muted">{card.note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {statCardEntries.map((section) => (
          <div key={section.label} className="app-card">
            <h3 className="mb-4 text-sm font-semibold text-ai-title">{section.label}</h3>
            <BarChart entries={section.entries} maxValue={section.max} colorClass={section.color} emptyText={t("common.noData")} />
          </div>
        ))}
      </div>

      {safeStats.satisfactionDistribution && (
        <div className="app-card">
          <h3 className="mb-4 text-sm font-semibold text-ai-title">{t("admin.satisfactionDistribution")}</h3>
          <div className="flex flex-wrap gap-3">
            {[5, 4, 3, 2, 1].map((score) => {
              const count = safeStats.satisfactionDistribution[score] || 0;
              const total = Object.values(safeStats.satisfactionDistribution).reduce((a, b) => a + Number(b || 0), 0);
              return (
                <div key={score} className="flex items-center gap-2 rounded-xl bg-ai-bg px-4 py-3">
                  <span className="text-sm font-semibold text-ai-title">{t("admin.scoreLabel", { score })}</span>
                  <span className="text-xs text-ai-muted">{t("common.items", { count })}</span>
                  {total > 0 && (
                    <span className="text-xs text-ai-muted">
                      ({Math.round((count / total) * 100)}%)
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
