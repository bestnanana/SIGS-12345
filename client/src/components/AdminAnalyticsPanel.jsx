import React from "react";
import { useLanguage } from "../i18n";

function BarChart({ entries, maxValue, colorClass = "bg-ai-primary" }) {
  return (
    <div className="space-y-2">
      {entries.map(([label, count]) => (
        <div key={label} className="flex items-center gap-2 text-xs">
          <span className="w-24 truncate text-ai-body">{label}</span>
          <span className="h-5 rounded-full bg-slate-100" style={{ flex: count || 0 }}>
            <span
              className={`block h-full rounded-full ${colorClass} transition-all duration-500`}
              style={{ width: `${maxValue ? ((count || 0) / maxValue) * 100 : 0}%` }}
            />
          </span>
          <span className="w-10 text-right font-semibold tabular-nums text-ai-title">{count || 0}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalyticsPanel({ stats, user }) {
  const { t } = useLanguage();

  const summaryCards = [
    { label: t("admin.visibleTickets"), value: stats.total, note: user?.role === "super_admin" ? t("admin.allScope") : (user?.department ? `${user.department}${t("admin.scope")}` : t("admin.allScope")) },
    { label: t("admin.activeTickets"), value: stats.active, note: t("admin.activeTicketsNote") },
    { label: t("admin.replyRate"), value: stats.completed, note: t("admin.replyRateNote") },
    { label: t("admin.completeRate"), value: stats.completeRate, note: t("admin.completeRateNote") }
  ];

  const maxStatusCount = Math.max(1, ...Object.values(stats.statusCounts));
  const maxDepartmentCount = Math.max(1, ...stats.departmentEntries.map(([, count]) => count));
  const maxFieldCount = Math.max(1, ...stats.fieldEntries.map(([, count]) => count));

  const statCardEntries = [
    { label: t("admin.byStatus"), entries: Object.entries(stats.statusCounts), max: maxStatusCount, color: "bg-ai-primary" },
    { label: t("admin.byDepartment"), entries: stats.departmentEntries, max: maxDepartmentCount, color: "bg-emerald-500" },
    { label: t("admin.byField"), entries: stats.fieldEntries, max: maxFieldCount, color: "bg-amber-500" }
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
            <BarChart entries={section.entries} maxValue={section.max} colorClass={section.color} />
          </div>
        ))}
      </div>

      {stats.satisfactionDistribution && (
        <div className="app-card">
          <h3 className="mb-4 text-sm font-semibold text-ai-title">满意度分布</h3>
          <div className="flex flex-wrap gap-3">
            {[5, 4, 3, 2, 1].map((score) => {
              const count = stats.satisfactionDistribution[score] || 0;
              const total = Object.values(stats.satisfactionDistribution).reduce((a, b) => a + b, 0);
              return (
                <div key={score} className="flex items-center gap-2 rounded-xl bg-ai-bg px-4 py-3">
                  <span className="text-sm font-semibold text-ai-title">{score} 分</span>
                  <span className="text-xs text-ai-muted">{count} 条</span>
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
