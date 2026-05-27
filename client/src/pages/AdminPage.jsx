import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Eye, FileCheck2, Link2, Megaphone, PanelLeftClose, PanelLeftOpen, Paperclip, RefreshCw, SendHorizontal, Settings2, Star } from "lucide-react";
import { api, uploadConfig } from "../api";
import { formatTime } from "../constants";
import FormConfigManager from "../components/FormConfigManager";
import RoleManager from "../components/RoleManager";
import AdminAnalyticsPanel from "../components/AdminAnalyticsPanel";
import { LocaleLink, useLanguage, useStatusMap } from "../i18n";

const adminMenuItems = [
  { key: "tickets", labelKey: "admin.menuTickets", descriptionKey: "admin.menuTicketsDesc", icon: ClipboardList },
  { key: "analytics", labelKey: "admin.menuAnalytics", descriptionKey: "admin.menuAnalyticsDesc", icon: BarChart3 },
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

export function labelFor(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

export default function AdminPage() {
  const { t, language } = useLanguage();
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
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
  const [adminPage, setAdminPage] = useState(1);
  const [adminTotal, setAdminTotal] = useState(0);
  const [adminStatusFilter, setAdminStatusFilter] = useState("pending");
  const adminPageSize = 30;
  const [roleRows, setRoleRows] = useState([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleSaving, setRoleSaving] = useState("");
  const [roleError, setRoleError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [copyMsg, setCopyMsg] = useState("");

  const selected = useMemo(() => tickets.find((item) => item.id === selectedId), [tickets, selectedId]);
  const canHandleSelected = selected && (
    user?.role === "super_admin" ||
    (user?.department && user.department === (selected.current_department || "党政办"))
  );
  const isCompleted = selected?.status === "completed";
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
    const total = adminTotal || tickets.length;
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
  }, [statusMap, tickets, adminTotal]);

  async function loadMe() {
    const res = await api.get("/auth/me");
    setUser(res.data);
    setReply((current) => ({ ...current, department: res.data.department || "党政办" }));
  }

  async function loadTickets(p = adminPage) {
    setLoading(true);
    try {
      const res = await api.get("/admin/tickets", { params: { page: p, pageSize: adminPageSize } });
      const data = res.data;
      if (data && Array.isArray(data.rows)) {
        setTickets(data.rows);
        setAdminTotal(data.total || 0);
        setError("");
      } else if (Array.isArray(data)) {
        setTickets(data);
        setAdminTotal(data.length);
        setError("");
      } else {
        setError("后台事项接口返回异常，请确认后端已重启到最新版本。");
      }
      setSelectedId((current) => {
        if (data && Array.isArray(data.rows) && data.rows.length) return current || data.rows[0]?.id || null;
        if (Array.isArray(data) && data.length) return current || data[0]?.id || null;
        return current || null;
      });
    } catch (err) {
      setTickets([]);
      setError(err.response?.data?.message || "后台事项加载失败，请确认后端服务正在运行。");
    } finally {
      setLoading(false);
    }
  }

  async function loadRoles() {
    setRoleLoading(true);
    setRoleError("");
    try {
      const res = await api.get("/datahub/basic-persons/stored", {
        params: { page: 1, pageSize: 500 }
      });
      setRoleRows(Array.isArray(res.data?.rows) ? res.data.rows : []);
    } catch (err) {
      setRoleError(err.response?.data?.message || "角色数据加载失败");
    } finally {
      setRoleLoading(false);
    }
  }

  async function saveRole(person) {
    setRoleSaving(person.id);
    setRoleError("");
    try {
      await api.patch(`/admin/persons/${person.id}`, {
        role: person.role,
        department: person.department,
        can_manage_roles: person.can_manage_roles
      });
      setRoleRows((rows) => rows.map((r) => (r.id === person.id ? { ...r, role: person.role, department: person.department, can_manage_roles: person.can_manage_roles } : r)));
    } catch (err) {
      setRoleError(err.response?.data?.message || "保存失败");
    } finally {
      setRoleSaving("");
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
      content: current.content || ""
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
    if (activeView === "roles") {
      loadRoles();
    }
  }, [activeView]);

  const canManageRoles = user?.role === "super_admin" || user?.can_manage_roles;

  function chooseTicket(ticket) {
    setSelectedId(ticket.id);
    setReply({
      department: user?.department || ticket.current_department || "党政办",
      content: "",
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
    if (!selectedId || !canHandleSelected) return;
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

  const selectedStatus = selected ? statusMap[normalizeTicketStatus(selected.status)] || statusMap.pending : statusMap.pending;

  const shareUrl = selected?.share_code ? `${window.location.origin}/api/public/ticket/${selected.share_code}` : "";

  function copyShareUrl() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopyMsg("已复制");
      setTimeout(() => setCopyMsg(""), 2000);
    }).catch(() => setCopyMsg("复制失败"));
  }

  const adminTotalPages = Math.max(1, Math.ceil(adminTotal / adminPageSize));

  function goAdminPage(p) {
    const target = Math.max(1, Math.min(p, adminTotalPages));
    setAdminPage(target);
    loadTickets(target);
  }
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
          `提交时间：${formatTime(selected.created_at, dateLocale)}`,
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
          `申请选择部门：${selected.department || "未指定"}`,
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
          `完成时间：${selected.status === "completed" ? formatTime(selected.updated_at, dateLocale) : "—"}`,
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
          {canManageRoles ? (
            <button
              type="button"
              onClick={() => setActiveView("roles")}
              title={sidebarCollapsed ? "角色管理" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 ${
                activeView === "roles" ? "bg-ai-primary text-white shadow-[0_10px_24px_rgba(108,76,241,0.18)]" : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
              } ${sidebarCollapsed ? "justify-center px-0" : ""}`}
            >
              <Settings2 size={18} className="shrink-0" />
              {!sidebarCollapsed ? (
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">角色管理</span>
                  <span className={`mt-1 block text-xs leading-5 ${activeView === "roles" ? "text-white/80" : "text-ai-muted"}`}>分配角色与部门联络员</span>
                </span>
              ) : null}
            </button>
          ) : null}
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

              <div className="flex shrink-0 gap-1 border-b border-ai-border px-2 py-2">
                {Object.entries(statusMap).map(([value, meta]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAdminStatusFilter(value)}
                    className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition duration-200 ${
                      adminStatusFilter === value
                        ? "bg-ai-primary/10 text-ai-primary"
                        : "text-ai-body hover:bg-ai-bg"
                    }`}
                  >
                    {meta.label}
                  </button>
                ))}
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
                    {ticketGroups
                      .filter((group) => group.status === adminStatusFilter)
                      .map((group) => (
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
                                <div className="flex items-start gap-2">
                                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${status.dotClassName || "bg-current"}`} />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-ai-title">{ticket.title}</div>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ai-muted">
                                      <span>{ticket.field}</span>
                                      <span>{ticket.current_department || "党政办"}</span>
                                      <span>{ticket.submitter_name}</span>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}

                {adminTotalPages > 1 && !loading && (
                  <div className="flex items-center justify-between gap-2 border-t border-ai-border px-3 py-3">
                    <span className="text-xs text-ai-muted">{adminTotal} 项</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => goAdminPage(adminPage - 1)}
                        disabled={adminPage <= 1}
                        className="rounded-lg p-1.5 text-ai-body transition hover:bg-ai-bg disabled:opacity-30"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="min-w-[3rem] text-center text-xs font-medium text-ai-title">{adminPage}/{adminTotalPages}</span>
                      <button
                        onClick={() => goAdminPage(adminPage + 1)}
                        disabled={adminPage >= adminTotalPages}
                        className="rounded-lg p-1.5 text-ai-body transition hover:bg-ai-bg disabled:opacity-30"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
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
                        <h2 className="mb-3 text-lg font-semibold leading-6 text-ai-title">{selected.title}</h2>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ai-body">
                          <span>事项编号：#{String(selected.id).padStart(6, "0")}</span>
                          <span>提交时间：{formatTime(selected.created_at)}</span>
                          <span>提交人：{selected.submitter_name}</span>
                          <span>联系方式：{selected.submitter_phone || "不显示"}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {shareUrl ? (
                          <button
                            type="button"
                            onClick={copyShareUrl}
                            className="flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ai-primary ring-1 ring-ai-primary/30 transition duration-200 hover:bg-ai-primary/5"
                          >
                            <Link2 size={16} />
                            {copyMsg || "复制分享链接"}
                          </button>
                        ) : null}
                        {selected.status === "completed" ? (
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
                        ) : null}
                        <LocaleLink to={`/tickets/${selected.id}`} className="ghost-button h-11">
                          <Eye size={16} />
                          {t("admin.detailsPage")}
                        </LocaleLink>
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
                          最后更新时间：{formatTime(selected.updated_at || selected.created_at, dateLocale)}
                        </div>
                      </section>

                      {isCompleted && detail?.replies?.[detail.replies.length - 1] ? (
                        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                          <h3 className="mb-3 font-semibold text-emerald-800">处理结果</h3>
                          <div className="whitespace-pre-wrap text-sm leading-7 text-emerald-900">
                            {detail.replies[detail.replies.length - 1].content}
                          </div>
                          <div className="mt-3 text-xs text-emerald-700">
                            {detail.replies[detail.replies.length - 1].replier_name || detail.replies[detail.replies.length - 1].department}
                            {" · "}
                            {formatTime(detail.replies[detail.replies.length - 1].created_at, dateLocale)}
                          </div>
                        </section>
                      ) : (
                        <form onSubmit={submitReply} className="rounded-xl border border-ai-border p-4">
                          <h3 className="mb-4 font-semibold text-ai-title">处理信息</h3>
                          {!canHandleSelected ? (
                            <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 ring-1 ring-amber-200">
                              该事项当前承办部门为 {currentHandlerText}，只能由该部门管理员处理。
                            </div>
                          ) : null}
                          <textarea
                            value={reply.content}
                            onChange={(e) => setReply({ ...reply, content: e.target.value })}
                            className="soft-textarea min-h-28 w-full"
                            disabled={!canHandleSelected}
                            placeholder="请填写处理结果说明..."
                            required
                          />
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <label className={`flex items-center gap-2 rounded-xl border border-dashed border-ai-border px-3 py-2 text-sm text-ai-body transition ${canHandleSelected ? "cursor-pointer hover:border-ai-primary/40" : "cursor-not-allowed opacity-60"}`}>
                              <Paperclip size={16} />
                              <span className="truncate">{files.length ? `${files.length} 个附件` : "上传附件"}</span>
                              <input
                                type="file"
                                multiple
                                accept=".txt,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.avi,.mp4"
                                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                                className="hidden"
                                disabled={!canHandleSelected}
                              />
                            </label>
                            <button type="submit" disabled={submitting || !canHandleSelected} className="primary-button">
                              <SendHorizontal size={16} />
                              {submitting ? "提交中..." : "提交处理结果"}
                            </button>
                          </div>
                        </form>
                      )}

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
                              评价人：{detail.satisfaction.user_name || selected.submitter_name} · {formatTime(detail.satisfaction.updated_at || detail.satisfaction.created_at, dateLocale)}
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
          <AdminAnalyticsPanel stats={stats} user={user} />
        ) : activeView === "config" ? (
          <FormConfigManager />
        ) : activeView === "roles" ? (
          <RoleManager
            roleRows={roleRows}
            roleLoading={roleLoading}
            roleSaving={roleSaving}
            roleError={roleError}
            onLoadRoles={loadRoles}
            onSaveRole={saveRole}
            setRoleRows={setRoleRows}
            setRoleError={setRoleError}
          />
        ) : null}
      </div>
    </div>
    </>
  );
}
