import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, ClipboardList, Eye, FileCheck2, Megaphone, PanelLeftClose, PanelLeftOpen, Paperclip, RefreshCw, Search, SendHorizontal, Settings2, Star, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { api, uploadConfig } from "../api";
import { formatTime } from "../constants";
import FormConfigManager from "../components/FormConfigManager";
import { useLanguage, useStatusMap } from "../i18n";

const adminMenuItems = [
  { key: "tickets", labelKey: "admin.menuTickets", descriptionKey: "admin.menuTicketsDesc", icon: ClipboardList },
  { key: "analytics", labelKey: "admin.menuAnalytics", descriptionKey: "admin.menuAnalyticsDesc", icon: BarChart3 },
  { key: "persons", labelKey: "人员管理", descriptionKey: "Datahub人员基础信息", icon: UsersRound },
  { key: "config", labelKey: "配置管理", descriptionKey: "表单领域和部门配置", icon: Settings2 }
];
const ticketStatusOrder = ["pending", "completed"];
const normalizeTicketStatus = (status) => (status === "completed" ? "completed" : "pending");

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "未指定";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatPercent(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function labelFor(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

export default function AdminPage() {
  const { t } = useLanguage();
  const fullStatusMap = useStatusMap();
  const statusMap = useMemo(() => ({
    pending: fullStatusMap.pending,
    completed: fullStatusMap.completed
  }), [fullStatusMap]);
  const [activeView, setActiveView] = useState("tickets");
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState({ department: "党政办", content: "", status: "completed" });
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [personRows, setPersonRows] = useState([]);
  const [personTotal, setPersonTotal] = useState(0);
  const [personPage, setPersonPage] = useState(1);
  const [personPageSize] = useState(20);
  const [personKeyword, setPersonKeyword] = useState("");
  const [personSearch, setPersonSearch] = useState("");
  const [personsLoading, setPersonsLoading] = useState(false);
  const [personsError, setPersonsError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1280);

  const selected = useMemo(() => tickets.find((item) => item.id === selectedId), [tickets, selectedId]);
  const canHandleSelected = selected && user?.department && user.department === (selected.current_department || "党政办");
  const isCompleted = selected?.status === "completed";
  const canReplySelected = canHandleSelected && !isCompleted;
  const ticketGroups = useMemo(() => {
    return ticketStatusOrder
      .map((status) => ({
        status,
        meta: statusMap[status],
        items: tickets
          .filter((ticket) => normalizeTicketStatus(ticket.status) === status)
          .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      }))
      .filter((group) => group.items.length > 0);
  }, [statusMap, tickets]);
  const stats = useMemo(() => {
    const total = tickets.length;
    const statusCounts = Object.keys(statusMap).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    tickets.forEach((ticket) => {
      const status = normalizeTicketStatus(ticket.status);
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const fieldEntries = Object.entries(countBy(tickets, (ticket) => ticket.field))
      .sort((a, b) => b[1] - a[1]);
    const departmentEntries = Object.entries(countBy(tickets, (ticket) => ticket.current_department || ticket.department))
      .sort((a, b) => b[1] - a[1]);
    const satisfactionTickets = tickets.filter((ticket) => Number(ticket.satisfaction_score) > 0);
    const satisfactionScoreSum = satisfactionTickets.reduce((sum, ticket) => sum + Number(ticket.satisfaction_score || 0), 0);
    const satisfactionDistribution = [1, 2, 3, 4, 5].reduce((acc, score) => ({ ...acc, [score]: 0 }), {});
    satisfactionTickets.forEach((ticket) => {
      const score = Number(ticket.satisfaction_score);
      satisfactionDistribution[score] = (satisfactionDistribution[score] || 0) + 1;
    });
    const completedCount = statusCounts.completed || 0;

    return {
      total,
      active: total - completedCount,
      completed: completedCount,
      published: tickets.filter((ticket) => ticket.is_published).length,
      statusCounts,
      fieldEntries,
      departmentEntries,
      replyRate: formatPercent(completedCount, total),
      completeRate: formatPercent(completedCount, total),
      satisfactionCount: satisfactionTickets.length,
      satisfactionAverage: satisfactionTickets.length ? (satisfactionScoreSum / satisfactionTickets.length).toFixed(1) : "-",
      satisfactionRate: formatPercent(satisfactionTickets.length, completedCount),
      satisfactionDistribution
    };
  }, [statusMap, tickets]);

  async function loadMe() {
    const res = await api.get("/auth/me");
    setUser(res.data);
    setReply((current) => ({ ...current, department: res.data.department || "党政办" }));
  }

  async function loadTickets() {
    setLoading(true);
    try {
      const res = await api.get("/admin/tickets");
      const nextTickets = Array.isArray(res.data) ? res.data : [];
      setTickets(nextTickets);
      setSelectedId((current) => current || nextTickets[0]?.id || null);
      setError(Array.isArray(res.data) ? "" : "后台事项接口返回异常，请确认后端已重启到最新版本。");
    } catch (err) {
      setTickets([]);
      setError(err.response?.data?.message || "后台事项加载失败，请确认后端服务正在运行。");
    } finally {
      setLoading(false);
    }
  }

  async function loadPersons(nextPage = personPage, keyword = personSearch) {
    setPersonsLoading(true);
    setPersonsError("");
    try {
      const res = await api.get("/datahub/basic-persons/stored", {
        params: {
          page: nextPage,
          pageSize: personPageSize,
          keyword
        }
      });
      setPersonRows(Array.isArray(res.data?.rows) ? res.data.rows : []);
      setPersonTotal(Number(res.data?.total || 0));
      setPersonPage(Number(res.data?.page || nextPage));
    } catch (err) {
      setPersonRows([]);
      setPersonTotal(0);
      setPersonsError(err.response?.data?.message || "人员数据加载失败");
    } finally {
      setPersonsLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) {
      setDetail(null);
      return;
    }
    const res = await api.get(`/tickets/${id}`);
    setDetail({
      ...res.data,
      transfers: Array.isArray(res.data?.transfers) ? res.data.transfers : [],
      replies: Array.isArray(res.data?.replies) ? res.data.replies : []
    });
    setReply((current) => ({
      ...current,
      department: res.data.ticket.current_department || res.data.ticket.department || current.department,
      content: current.content || res.data.ticket.ai_suggestion || ""
    }));
  }

  useEffect(() => {
    loadMe();
    loadTickets();
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (activeView === "persons") {
      loadPersons(personPage, personSearch);
    }
  }, [activeView, personPage, personSearch]);

  function chooseTicket(ticket) {
    setSelectedId(ticket.id);
    setReply({
      department: user?.department || ticket.current_department || "党政办",
      content: ticket.ai_suggestion || "",
      status: "completed"
    });
  }

  async function togglePublish(ticket) {
    await api.patch(`/admin/tickets/${ticket.id}/publish`, { is_published: !ticket.is_published });
    await loadTickets();
    await loadDetail(ticket.id);
  }

  async function submitReply(e) {
    e.preventDefault();
    if (!selectedId || !canReplySelected) return;
    setSubmitting(true);
    try {
      const data = new FormData();
      data.append("content", reply.content);
      data.append("status", reply.status);
      files.forEach((file) => data.append("attachments", file));
      await api.post(`/admin/tickets/${selectedId}/replies`, data, uploadConfig);
      setReply({ ...reply, content: "" });
      setFiles([]);
      await loadTickets();
      await loadDetail(selectedId);
    } catch (err) {
      setError(err.response?.data?.message || "回复提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  const summaryCards = [
    { label: t("admin.visibleTickets"), value: stats.total, note: user?.department ? `${user.department}${t("admin.scope")}` : t("admin.allScope") },
    { label: t("admin.activeTickets"), value: stats.active, note: t("admin.activeTicketsNote") },
    { label: t("admin.replyRate"), value: stats.completed, note: t("admin.replyRateNote") },
    { label: t("admin.completeRate"), value: stats.completeRate, note: t("admin.completeRateNote") }
  ];
  const maxStatusCount = Math.max(1, ...Object.values(stats.statusCounts));
  const maxDepartmentCount = Math.max(1, ...stats.departmentEntries.map(([, count]) => count));
  const maxFieldCount = Math.max(1, ...stats.fieldEntries.map(([, count]) => count));
  const personTotalPages = Math.max(1, Math.ceil(personTotal / personPageSize));
  const personPageStart = personTotal ? (personPage - 1) * personPageSize + 1 : 0;
  const personPageEnd = Math.min(personTotal, personPage * personPageSize);
  const selectedStatus = selected ? statusMap[normalizeTicketStatus(selected.status)] || statusMap.pending : statusMap.pending;
  const currentHandlerText = selected?.current_department || selected?.department || "党政办";
  const sidebarWidthClass = sidebarCollapsed ? "grid-cols-[72px_minmax(0,1fr)]" : "grid-cols-[232px_minmax(0,1fr)]";
  const workflowSteps = selected
    ? [
      {
        key: "submit",
        title: "提交事项",
        status: selected.status === "pending" ? "current" : "done",
        icon: ClipboardList,
        tone: "purple",
        lines: [
          `提交人：${selected.submitter_name || "学生"}`,
          `提交时间：${formatTime(selected.created_at)}`,
          `学生通过平台提交事项，等待相关部门处理。`
        ]
      },
      {
        key: "department",
        title: "相关部门处理",
        status: selected.status === "completed" ? "done" : "current",
        icon: FileCheck2,
        tone: "amber",
        lines: [
          `申请部门：${selected.department || "未指定"}`,
          `办理部门：${currentHandlerText}`,
          selected.status === "completed" ? "相关部门已完成处理。" : "事项已提交，等待相关部门处理。"
        ]
      },
      {
        key: "finish",
        title: "处理完成",
        status: selected.status === "completed" ? "done" : "todo",
        icon: CheckCircle2,
        tone: "slate",
        lines: [
          `完成时间：${selected.status === "completed" ? formatTime(selected.updated_at) : "—"}`,
          selected.status === "completed" ? "事项办理完成，流程结束。" : "办理结果确认后进入最终状态。"
        ]
      }
    ]
    : [];

  return (
    <>
    <div className={`grid min-w-0 gap-4 ${sidebarWidthClass}`}>
      <aside className="app-card sticky top-[88px] h-[calc(100vh-104px)] overflow-hidden p-3">
        <div className={`flex items-start justify-between gap-2 border-b border-ai-border pb-3 ${sidebarCollapsed ? "px-0" : "px-2"}`}>
          {!sidebarCollapsed ? (
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-ai-muted">{t("admin.sideTitle")}</div>
              <div className="mt-2 truncate text-lg font-semibold tracking-tight text-ai-title">
                {user?.department || t("common.department")}{t("admin.workbench")}
              </div>
              <div className="mt-2 text-sm leading-6 text-ai-body">{t("admin.sideDesc")}</div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ai-border bg-white text-ai-body transition duration-200 hover:bg-ai-bg"
            title={sidebarCollapsed ? "展开菜单" : "收起菜单"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="mt-3 space-y-2">
          {adminMenuItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.key;
            const label = item.labelKey ? t(item.labelKey) : item.label;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                title={sidebarCollapsed ? label : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 ${
                  active ? "bg-ai-primary text-white shadow-[0_10px_24px_rgba(108,76,241,0.18)]" : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
                } ${sidebarCollapsed ? "justify-center px-0" : ""}`}
              >
                <Icon size={18} className="shrink-0" />
                {!sidebarCollapsed ? (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{label}</span>
                    <span className={`mt-1 block text-xs leading-5 ${active ? "text-white/80" : "text-ai-muted"}`}>{item.descriptionKey ? t(item.descriptionKey) : item.description}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed ? (
        <div className="mt-4 border-t border-ai-border px-2 pt-4 text-sm text-ai-body">
          <div className="flex items-center justify-between">
            <span>{t("admin.pendingWork")}</span>
            <span className="font-semibold text-ai-title">{stats.active}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span>{t("admin.publishedTypical")}</span>
            <span className="font-semibold text-ai-title">{stats.published}</span>
          </div>
        </div>
        ) : null}
      </aside>

      <div className="min-w-0">
        {activeView === "tickets" ? (
          <div className={`grid items-start gap-4 ${sidebarCollapsed ? "xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]" : "2xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]"}`}>
            <section className="app-card flex max-h-none flex-col overflow-hidden p-0 xl:max-h-[calc(100vh-11rem)] xl:min-h-[calc(100vh-11rem)] 2xl:max-h-[calc(100vh-104px)] 2xl:min-h-[calc(100vh-104px)]">
              <div className="flex shrink-0 items-center justify-between border-b border-ai-border px-4 py-3.5 sm:px-5">
                <div>
                  <div className="text-xl font-semibold tracking-tight text-ai-title">{t("admin.ticketProcessing")}</div>
                  <div className="mt-1 text-sm text-ai-body">
                    {user?.department ? `${user.department}${t("admin.ticketQueue")}` : t("admin.viewAndReply")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadTickets}
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-ai-border bg-white text-ai-body transition duration-200 hover:bg-ai-bg"
                  title={t("action.refresh")}
                >
                  <RefreshCw size={16} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3 scrollbar-thin">
                {loading ? (
                  <div className="p-8 text-center text-sm text-slate-500">{t("common.loading")}</div>
                ) : error ? (
                  <div className="p-8 text-center text-sm text-amber-700">{error}</div>
                ) : tickets.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">{t("admin.noTodos")}</div>
                ) : (
                  <div className="space-y-5">
                    {ticketGroups.map((group) => (
                      <section key={group.status} className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${group.meta.badgeClassName || group.meta.className}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${group.meta.dotClassName || "bg-current"}`} />
                              {group.meta.label}
                            </span>
                            {group.status === "pending" ? (
                              <span className="text-xs font-medium text-amber-700">{t("admin.priority")}</span>
                            ) : null}
                          </div>
                          <span className="text-xs text-ai-muted">{t("common.items", { count: group.items.length })}</span>
                        </div>

                        <div className="space-y-3">
                          {group.items.map((ticket) => {
                            const status = statusMap[normalizeTicketStatus(ticket.status)] || statusMap.pending;
                            return (
                              <button
                                key={ticket.id}
                                type="button"
                                onClick={() => chooseTicket(ticket)}
                                className={`w-full rounded-xl border p-3 text-left transition duration-200 ease-out hover:-translate-y-0.5 ${
                                  selectedId === ticket.id ? "border-ai-primary/30 bg-ai-primary/10 shadow-sm" : "border-ai-border bg-white hover:bg-ai-bg"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-ai-title">{ticket.title}</div>
                                    <div className="mt-1 text-xs text-ai-muted">
                                      #{String(ticket.id).padStart(6, "0")} · {t("common.submitter")}：{ticket.submitter_name}
                                    </div>
                                  </div>
                                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${status.badgeClassName || status.className}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName || "bg-current"}`} />
                                    {status.label}
                                  </span>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ai-body">
                                  <span>{ticket.field}</span>
                                  <span>{t("common.department")}：{ticket.department || t("common.notAssigned")}</span>
                                  <span>{t("common.currentDepartment")}：{ticket.current_department || "党政办"}</span>
                                  {ticket.satisfaction_score ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-amber-200">满意度 {ticket.satisfaction_score} 分</span> : null}
                                  {ticket.is_published ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700 ring-1 ring-teal-200">{t("admin.published")}</span> : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="app-card min-w-0 overflow-hidden p-0">
              {!selected ? (
                <div className="p-12 text-center text-ai-body">{t("admin.selectTicket")}</div>
              ) : (
                <>
                  <div className="mesh-hero border-b border-ai-border px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-base font-semibold text-ai-title">
                          <span>事项编号：#{String(selected.id).padStart(6, "0")}</span>
                          <span>提交时间：{formatTime(selected.created_at)}</span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ai-body">
                          <span>提交人：{selected.submitter_name}</span>
                          <span>联系方式：{selected.submitter_phone || "不显示"}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => togglePublish(selected)}
                          className={`flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 transition duration-200 ${
                            selected.is_published ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <Megaphone size={16} />
                          {selected.is_published ? t("action.unpublish") : t("action.publish")}
                        </button>
                        <Link to={`/tickets/${selected.id}`} className="ghost-button h-11">
                          <Eye size={16} />
                          {t("admin.detailsPage")}
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 p-4 2xl:grid-cols-[minmax(0,1fr)_330px] 2xl:p-5">
                    <div className="space-y-4">
                      <section>
                        <h3 className="mb-3 font-semibold text-ai-title">{t("admin.ticketContent")}</h3>
                        <div className="whitespace-pre-wrap rounded-xl border border-ai-border bg-white p-4 text-sm leading-7 text-ai-body">
                          {selected.content}
                        </div>
                      </section>

                      <section className="rounded-xl border border-ai-border p-4">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <h3 className="font-semibold text-ai-title">{t("admin.currentStatus")}</h3>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${selectedStatus.badgeClassName || selectedStatus.className}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${selectedStatus.dotClassName || "bg-current"}`} />
                            {selectedStatus.label}
                          </span>
                        </div>
                        <div className="text-xs leading-6 text-ai-body">
                          最后更新时间：{formatTime(selected.updated_at || selected.created_at)}
                        </div>
                      </section>

                      <form onSubmit={submitReply} className={`rounded-xl border p-4 ${canReplySelected ? "border-ai-border" : "border-ai-border bg-ai-bg"}`}>
                        <h3 className="mb-4 font-semibold text-ai-title">处理信息</h3>
                        {!canHandleSelected ? (
                          <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 ring-1 ring-amber-200">
                            该事项当前承办部门为 {currentHandlerText}，只能由该部门管理员回复处理。
                          </div>
                        ) : null}
                        {isCompleted ? (
                          <div className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800 ring-1 ring-emerald-200">
                            该事项已完成，不能继续提交回复。
                          </div>
                        ) : null}
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">当前承办部门</span>
                          <input value={currentHandlerText} readOnly className="soft-input w-full" />
                        </label>
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">处理人</span>
                          <input value={user?.name || "当前管理员"} readOnly className="soft-input w-full" />
                        </label>
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">联系方式</span>
                          <input value={user?.phone || selected.submitter_phone || ""} readOnly className="soft-input w-full" />
                        </label>
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">处理说明</span>
                          <textarea
                            value={reply.content}
                            onChange={(e) => setReply({ ...reply, content: e.target.value })}
                            className="soft-textarea min-h-28 w-full"
                            disabled={!canReplySelected}
                            placeholder="可填写处理进展、原因说明及后续计划。"
                            required
                          />
                        </label>
                        <label className={`mb-5 flex items-center gap-2 rounded-xl border border-dashed border-ai-border px-3 py-3 text-sm text-ai-body ${canReplySelected ? "cursor-pointer hover:border-ai-primary/40" : "cursor-not-allowed opacity-60"}`}>
                          <Paperclip size={16} />
                          <span className="truncate">{files.length ? `${files.length} 个附件已选择` : "上传官方附件"}</span>
                          <input
                            type="file"
                            multiple
                            accept=".txt,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.avi,.mp4"
                            onChange={(e) => setFiles(Array.from(e.target.files || []))}
                            className="hidden"
                            disabled={!canReplySelected}
                          />
                        </label>
                        <div>
                          <button disabled={submitting || !canReplySelected} className="primary-button w-full">
                            <SendHorizontal size={16} />
                            {isCompleted ? "处理完成" : submitting ? "提交中..." : "提交处理完成结果"}
                          </button>
                        </div>
                      </form>

                    </div>

                    <aside className="space-y-5">
                      <section className="rounded-xl border border-ai-border p-4">
                        <h3 className="mb-4 font-semibold text-ai-title">事项流转流程</h3>
                        <div className="relative">
                          {workflowSteps.map((step, index) => {
                            const StepIcon = step.icon;
                            const isLast = index === workflowSteps.length - 1;
                            const toneClass = step.status === "done"
                              ? "bg-ai-primary text-white"
                              : step.status === "current"
                                ? step.tone === "amber"
                                  ? "bg-amber-500 text-white"
                                  : "bg-blue-500 text-white"
                                : "bg-slate-300 text-white";
                            const cardClass = step.status === "current"
                              ? "border-ai-primary/30 bg-white shadow-[0_12px_32px_rgba(108,76,241,0.08)]"
                              : "border-ai-border bg-white";
                            return (
                              <article key={step.key} className="relative grid grid-cols-[42px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                                {!isLast ? <div className="absolute left-[20px] top-11 h-[calc(100%-18px)] w-px bg-ai-border" /> : null}
                                <div className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full ${toneClass} shadow-sm`}>
                                  <StepIcon size={17} />
                                </div>
                                <div className={`rounded-[16px] border px-4 py-3 ${cardClass}`}>
                                  <div className={`text-sm font-semibold ${step.status === "current" ? "text-ai-primary" : "text-ai-title"}`}>
                                    {step.title}
                                  </div>
                                  <div className="mt-2 space-y-1.5 text-xs leading-6 text-ai-body">
                                    {step.lines.map((line) => (
                                      <div key={line}>{line}</div>
                                    ))}
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>

                      <section className="rounded-xl border border-ai-border p-4">
                        <h3 className="mb-4 font-semibold text-ai-title">满意度调查</h3>
                        {detail?.satisfaction ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-3 text-amber-800 ring-1 ring-amber-100">
                              <span className="text-sm font-semibold">评分</span>
                              <span className="flex items-center gap-1 text-sm font-semibold">
                                <Star size={16} fill="currentColor" />
                                {detail.satisfaction.score} / 5
                              </span>
                            </div>
                            <div className="rounded-xl bg-ai-bg px-3 py-3 text-sm leading-6 text-ai-body">
                              {detail.satisfaction.comment || "用户未填写文字评价。"}
                            </div>
                            <div className="text-xs text-ai-muted">
                              评价人：{detail.satisfaction.user_name || selected.submitter_name} · {formatTime(detail.satisfaction.updated_at || detail.satisfaction.created_at)}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl bg-ai-bg px-3 py-4 text-sm text-ai-body">
                            {selected.status === "completed" ? "事项已完成，等待发起人提交满意度评价。" : "事项完成后将开放满意度评价。"}
                          </div>
                        )}
                      </section>
                    </aside>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : activeView === "analytics" ? (
          <div className="space-y-6">
            <section className="app-card mesh-hero p-5">
              <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="ai-chip mb-4">
                    <BarChart3 size={14} className="mr-1.5" />
                    数据统计分析
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight text-ai-title">事项运行概览</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
                    统计当前管理员权限范围内的事项数量、状态分布、部门流向和事项领域。
                  </p>
                </div>
                <button type="button" onClick={loadTickets} className="ghost-button bg-white/80">
                  <RefreshCw size={16} />
                  刷新数据
                </button>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <div key={card.label} className="app-card p-4">
                  <div className="text-sm text-ai-body">{card.label}</div>
                  <div className="mt-3 text-3xl font-semibold leading-none tracking-tight text-ai-title">{card.value}</div>
                  <div className="mt-2 text-xs text-ai-muted">{card.note}</div>
                </div>
              ))}
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <div className="app-card p-4">
                <div className="text-sm text-ai-body">满意度平均分</div>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-3xl font-semibold leading-none tracking-tight text-ai-title">{stats.satisfactionAverage}</span>
                  <span className="text-sm font-semibold text-ai-muted">/ 5</span>
                </div>
                <div className="mt-2 text-xs text-ai-muted">已评价 {stats.satisfactionCount} 项</div>
              </div>
              <div className="app-card p-4">
                <div className="text-sm text-ai-body">满意度覆盖率</div>
                <div className="mt-3 text-3xl font-semibold leading-none tracking-tight text-ai-title">{stats.satisfactionRate}</div>
                <div className="mt-2 text-xs text-ai-muted">已完成事项中的评价占比</div>
              </div>
              <div className="app-card p-4">
                <div className="text-sm text-ai-body">高满意评价</div>
                <div className="mt-3 text-3xl font-semibold leading-none tracking-tight text-ai-title">
                  {(stats.satisfactionDistribution[4] || 0) + (stats.satisfactionDistribution[5] || 0)}
                </div>
                <div className="mt-2 text-xs text-ai-muted">4-5 分评价数量</div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <div className="app-card">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-ai-title">状态分布</h2>
                    <p className="mt-1 text-sm text-ai-body">按办理状态统计事项数量。</p>
                  </div>
                  <span className="rounded-full bg-ai-primary/10 px-3 py-1 text-xs font-semibold text-ai-primary ring-1 ring-ai-primary/10">
                    {stats.total} 项
                  </span>
                </div>
                <div className="space-y-4">
                  {Object.entries(statusMap).map(([value, meta]) => {
                    const count = stats.statusCounts[value] || 0;
                    return (
                      <div key={value}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-ai-title">{meta.label}</span>
                          <span className="text-ai-body">{count} 项</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-ai-bg">
                          <div
                            className="h-full rounded-full bg-ai-primary"
                            style={{ width: `${(count / maxStatusCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="app-card">
                <div className="mb-5">
                  <h2 className="text-xl font-semibold text-ai-title">承办部门分布</h2>
                  <p className="mt-1 text-sm text-ai-body">按当前承办部门统计事项流向。</p>
                </div>
                {stats.departmentEntries.length ? (
                  <div className="space-y-4">
                    {stats.departmentEntries.map(([department, count]) => (
                      <div key={department}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-ai-title">{department}</span>
                          <span className="text-ai-body">{count} 项</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-ai-bg">
                          <div
                            className="h-full rounded-full bg-teal-500"
                            style={{ width: `${(count / maxDepartmentCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-ai-bg p-6 text-center text-sm text-ai-body">暂无部门统计数据</div>
                )}
              </div>
            </section>

            <section className="app-card">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-ai-title">满意度评分分布</h2>
                <p className="mt-1 text-sm text-ai-body">按 1-5 分统计发起人的满意度调查结果。</p>
              </div>
              <div className="space-y-4">
                {[5, 4, 3, 2, 1].map((score) => {
                  const count = stats.satisfactionDistribution[score] || 0;
                  const maxScoreCount = Math.max(1, ...Object.values(stats.satisfactionDistribution));
                  return (
                    <div key={score}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium text-ai-title">
                          <Star size={15} className="text-amber-500" fill="currentColor" />
                          {score} 分
                        </span>
                        <span className="text-ai-body">{count} 项</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-ai-bg">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${(count / maxScoreCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="app-card">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-ai-title">事项领域分布</h2>
                <p className="mt-1 text-sm text-ai-body">用于识别高频问题领域和后续治理重点。</p>
              </div>
              {stats.fieldEntries.length ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {stats.fieldEntries.map(([field, count]) => (
                    <div key={field} className="rounded-2xl border border-ai-border bg-ai-bg p-4">
                      <div className="mb-3 flex items-center justify-between text-sm">
                        <span className="font-semibold text-ai-title">{field}</span>
                        <span className="text-ai-body">{count} 项</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-white">
                        <div
                          className="h-full rounded-full bg-amber-500"
                          style={{ width: `${(count / maxFieldCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl bg-ai-bg p-6 text-center text-sm text-ai-body">暂无领域统计数据</div>
              )}
            </section>
          </div>
        ) : activeView === "persons" ? (
          <div className="space-y-6">
            <section className="app-card mesh-hero p-5">
              <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="ai-chip mb-4">
                    <UsersRound size={14} className="mr-1.5" />
                    Datahub人员基础信息
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight text-ai-title">人员管理</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
                    展示从人员基础信息接口同步到本地数据库的人员数据，可按姓名、人员编号或部门检索。
                  </p>
                </div>
                <button type="button" onClick={() => loadPersons(personPage, personSearch)} className="ghost-button bg-white/80">
                  <RefreshCw size={16} />
                  刷新数据
                </button>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <div className="app-card p-4">
                <div className="text-sm text-ai-body">入库人员</div>
                <div className="mt-3 text-3xl font-semibold leading-none tracking-tight text-ai-title">{personTotal}</div>
                <div className="mt-3 text-xs text-ai-muted">Datahub同步数据</div>
              </div>
              <div className="app-card p-4">
                <div className="text-sm text-ai-body">当前页</div>
                <div className="mt-3 text-3xl font-semibold leading-none tracking-tight text-ai-title">{personPage}</div>
                <div className="mt-3 text-xs text-ai-muted">共 {personTotalPages} 页</div>
              </div>
              <div className="app-card p-4">
                <div className="text-sm text-ai-body">显示范围</div>
                <div className="mt-3 text-2xl font-semibold leading-none tracking-tight text-ai-title">{personPageStart}-{personPageEnd}</div>
                <div className="mt-3 text-xs text-ai-muted">每页 {personPageSize} 条</div>
              </div>
            </section>

            {personsError ? (
              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
                {personsError}
              </div>
            ) : null}

            <section className="app-card overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ai-border px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-xl font-semibold text-ai-title">人员数据列表</h2>
                  <p className="mt-1 text-sm text-ai-body">字段来自 Datahub 人员基础信息接口。</p>
                </div>
                <form
                  className="flex w-full flex-wrap items-center gap-3 lg:w-auto"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPersonPage(1);
                    setPersonSearch(personKeyword.trim());
                  }}
                >
                  <label className="flex h-10 w-full items-center rounded-xl border border-ai-border bg-white px-3 transition duration-200 focus-within:border-ai-primary/40 focus-within:ring-4 focus-within:ring-ai-primary/10 sm:w-80">
                    <Search size={16} className="text-ai-muted" />
                    <input
                      value={personKeyword}
                      onChange={(e) => setPersonKeyword(e.target.value)}
                      className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none placeholder:text-ai-muted"
                      placeholder="搜索姓名、编号或部门"
                    />
                  </label>
                  <button type="submit" className="primary-button h-10 px-4">
                    <Search size={16} />
                    搜索
                  </button>
                </form>
              </div>

              <div className="overflow-x-auto">
                <table className="soft-table w-full min-w-[980px]">
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>人员编号</th>
                      <th>类型</th>
                      <th>人员类别</th>
                      <th>部门</th>
                      <th>状态</th>
                      <th>聘任属性</th>
                      <th>聘任形式</th>
                      <th>聘任岗位</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {personsLoading ? (
                      <tr>
                        <td colSpan="10" className="px-6 py-12 text-center text-ai-body">人员数据加载中...</td>
                      </tr>
                    ) : personRows.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="px-6 py-12 text-center text-ai-body">暂无人员数据</td>
                      </tr>
                    ) : (
                      personRows.map((person) => (
                        <tr key={person.id}>
                          <td>
                            <div className="font-semibold text-ai-title">{labelFor(person.name)}</div>
                            <div className="mt-1 max-w-[180px] truncate text-xs text-ai-muted">{person.id}</div>
                          </td>
                          <td>{labelFor(person.union_id)}</td>
                          <td>{labelFor(person.type)}</td>
                          <td>{labelFor(person.category)}</td>
                          <td>
                            <span className="inline-flex max-w-[180px] truncate rounded-full bg-ai-bg px-3 py-1 text-xs font-semibold text-ai-body ring-1 ring-ai-border">
                              {labelFor(person.department)}
                            </span>
                          </td>
                          <td>{labelFor(person.status)}</td>
                          <td>{labelFor(person.appoint_attr)}</td>
                          <td>{labelFor(person.appointment_form)}</td>
                          <td>{labelFor(person.hire_post)}</td>
                          <td>{person.write_date ? formatTime(person.write_date) : "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ai-border px-4 py-4 sm:px-5">
                <div className="text-sm text-ai-body">
                  共 {personTotal} 条，当前显示 {personPageStart}-{personPageEnd}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPersonPage((page) => Math.max(1, page - 1))}
                    disabled={personPage <= 1 || personsLoading}
                    className="secondary-button h-10 px-4"
                  >
                    上一页
                  </button>
                  <span className="min-w-20 text-center text-sm font-semibold text-ai-title">
                    {personPage} / {personTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPersonPage((page) => Math.min(personTotalPages, page + 1))}
                    disabled={personPage >= personTotalPages || personsLoading}
                    className="secondary-button h-10 px-4"
                  >
                    下一页
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : activeView === "config" ? (
          <FormConfigManager />
        ) : null}
      </div>
    </div>
    </>
  );
}
