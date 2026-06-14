import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Crown, Eye, FileCheck2, Megaphone, MessageSquare, PanelLeftClose, PanelLeftOpen, Paperclip, SendHorizontal, Settings2, Shield, Star, X, ArrowRightLeft } from "lucide-react";
import { api } from "../api";
import { displayFieldName, formatTime, ticketRouteId } from "../constants";
import FormConfigManager from "../components/FormConfigManager";
import PermissionManager from "../components/PermissionManager";
import DepartmentLeaderManager from "../components/DepartmentLeaderManager";
import AdminAnalyticsPanel from "../components/AdminAnalyticsPanel";
import { LocaleLink, useLanguage, useLocaleNavigate, useStatusMap } from "../i18n";
import { useLocation, useParams } from "react-router-dom";

const adminMenuItems = [
  { key: "analytics", labelKey: "admin.menuAnalytics", descriptionKey: "admin.menuAnalyticsDesc", icon: BarChart3 },
];
const normalizeTicketStatus = (status) => (status === "completed" ? "completed" : "pending");

function canProcessTickets(user) {
  return user?.role === "super_admin" || user?.role === "liaison" || user?.is_dept_admin;
}

function isLeaderOnlyUser(user) {
  return Boolean(user?.is_department_leader) && !canProcessTickets(user);
}

function countBy(items, getKey, fallback = "未指定") {
  return items.reduce((acc, item) => {
    const key = getKey(item) || fallback;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatPercent(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function freshParams(params = {}) {
  return { ...params, _ts: Date.now() };
}

function attachmentDownloadUrl(id) {
  return `/api/attachments/${id}/download`;
}

export default function AdminPage() {
  const { t, language } = useLanguage();
  const dateLocale = language === "en" ? "en-US" : "zh-CN";
  const navigate = useLocaleNavigate();
  const location = useLocation();
  const { id: routeTicketIdParam } = useParams();
  const routeTicketId = routeTicketIdParam || "";
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
  const [replySuccess, setReplySuccess] = useState("");
  const [adminPage, setAdminPage] = useState(1);
  const [adminTotal, setAdminTotal] = useState(0);
  const [serverStats, setServerStats] = useState(null);
  const [adminStatusFilter, setAdminStatusFilter] = useState("pending");
  const adminPageSize = 30;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [expandedMenu, setExpandedMenu] = useState("tickets");
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [transferDept, setTransferDept] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [activeConfigView, setActiveConfigView] = useState("fields");
  const [activePermissionView, setActivePermissionView] = useState("admins");
  const [approvalNote, setApprovalNote] = useState("");
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalComment, setApprovalComment] = useState("");
  const [approvalDecisionSubmitting, setApprovalDecisionSubmitting] = useState("");
  const [approvalStatusFilter, setApprovalStatusFilter] = useState("pending");

  function localizedError(err, fallbackKey) {
    const fallback = t(fallbackKey);
    const serverMessage = err?.response?.data?.message;
    return language === "en" ? fallback : (serverMessage || fallback);
  }

  const selected = useMemo(() => {
    const fromList = tickets.find((item) => String(ticketRouteId(item)) === String(selectedId) || String(item.id) === String(selectedId));
    if (fromList) return fromList;
    if (detail && detail.ticket && (String(ticketRouteId(detail.ticket)) === String(selectedId) || String(detail.ticket.id) === String(selectedId))) return detail.ticket;
    return null;
  }, [detail, selectedId, tickets]);
  const canHandleSelected = selected && (
    user?.role === "super_admin" ||
    detail?.permission === 'handle' ||
    selected?.permission === 'handle'
  );
  const isCompleted = selected?.status === "completed";
  const filteredTickets = useMemo(() => {
    if (isLeaderOnlyUser(user)) return tickets;
    return tickets
      .filter((ticket) => normalizeTicketStatus(ticket.status) === adminStatusFilter)
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  }, [tickets, adminStatusFilter, user]);
  const stats = useMemo(() => {
    const total = adminTotal || tickets.length;
    const statusCounts = Object.keys(statusMap).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    tickets.forEach((ticket) => {
      const status = normalizeTicketStatus(ticket.status);
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    const fieldEntries = Object.entries(countBy(tickets, (ticket) => displayFieldName(ticket.field, language), t("common.notSet")))
      .sort((a, b) => b[1] - a[1]);
    const departmentEntries = Object.entries(countBy(tickets, (ticket) => ticket.current_department || ticket.department, t("common.notSet")))
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
  }, [statusMap, tickets, adminTotal, t]);

  async function loadMe() {
    const res = await api.get("/auth/me");
    setUser(res.data);
    if (isLeaderOnlyUser(res.data)) {
      setActiveView("approvals");
      setExpandedMenu("tickets");
    }
    setReply((current) => ({ ...current, department: res.data.department || "党政办" }));
    return res.data;
  }

  async function loadAnalytics() {
    try {
      const res = await api.get("/admin/analytics", { params: freshParams() });
      setServerStats(res.data);
    } catch {
      /* analytics fetch failed, fall back to client-side stats */
    }
  }

  async function loadTickets(p = adminPage, currentUser = user) {
    setLoading(true);
    try {
      const leaderOnly = isLeaderOnlyUser(currentUser);
      const res = await api.get(leaderOnly ? "/leader/approvals" : "/admin/tickets", {
        params: freshParams({
          page: p,
          pageSize: adminPageSize,
          ...(leaderOnly ? { status: approvalStatusFilter } : {})
        })
      });
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
        setError(t("admin.ticketApiInvalid"));
      }
      setSelectedId((current) => {
        if (data && Array.isArray(data.rows) && data.rows.length) return current || ticketRouteId(data.rows[0]) || null;
        if (Array.isArray(data) && data.length) return current || ticketRouteId(data[0]) || null;
        return current || null;
      });
    } catch (err) {
      setTickets([]);
      if (!isLeaderOnlyUser(currentUser) && err.response?.status === 403 && user?.is_department_leader) {
        return loadTickets(p, { ...user, role: "user", is_dept_admin: false, is_department_leader: true });
      }
      setError(localizedError(err, "admin.ticketLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) {
      setDetail(null);
      return;
    }
    const res = await api.get(`/tickets/${id}`, { params: freshParams() });
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
    // Support deep-link: /admin/tickets/:id or ?ticketId=xxx&nid=xxx
    const params = new URLSearchParams(location.search);
    const ticketIdParam = params.get("ticketId") || "";
    const nidParam = params.get("nid");
    const routeTicketIdValid = Boolean(routeTicketId);
    const queryTicketIdValid = Boolean(ticketIdParam);
    const openTicketId = routeTicketIdValid ? routeTicketId : (queryTicketIdValid ? ticketIdParam : null);
    if (openTicketId) {
      setSelectedId(openTicketId);
      setShowTicketModal(true);
      if (queryTicketIdValid) {
        const url = new URL(window.location.href);
        url.searchParams.delete("ticketId");
        url.searchParams.delete("nid");
        window.history.replaceState({}, "", url.toString());
      }
    } else {
      setShowTicketModal(false);
      setSelectedId(null);
      setDetail(null);
      setActiveView(isLeaderOnlyUser(user) ? "approvals" : "tickets");
    }
    // Mark notification as read
    if (nidParam) {
      api.patch(`/notifications/${nidParam}/read`, {}, { skipAuthExpiredHandler: true }).catch(() => {});
      const url = new URL(window.location.href);
      url.searchParams.delete("nid");
      window.history.replaceState({}, "", url.toString());
    }
    loadMe().then((me) => loadTickets(1, me)).catch(() => loadTickets());
    // Load departments for transfer
    api.get("/departments", { skipAuthExpiredHandler: true })
      .then(res => {
        const groups = res.data || {};
        const allDepts = [];
        for (const depts of Object.values(groups)) {
          if (Array.isArray(depts)) depts.forEach(d => allDepts.push(d.name));
        }
        setDepartments(allDepts);
      })
      .catch(() => {});
  }, [location.search, routeTicketId]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId]);

  useEffect(() => {
    if (activeView === "analytics") {
      loadAnalytics();
    }
  }, [activeView]);

  useEffect(() => {
    if (isLeaderOnlyUser(user)) {
      loadTickets(1, user);
    }
  }, [approvalStatusFilter]);

  function chooseTicket(ticket) {
    setSelectedId(ticketRouteId(ticket));
    setReply({
      department: user?.department || ticket.current_department || "党政办",
      content: "",
      status: "completed"
    });
    setShowTicketModal(true);
    setTransferDept("");
    setTransferNote("");
    setApprovalNote("");
    setApprovalComment("");
    navigate(`/admin/tickets/${ticketRouteId(ticket)}`);
  }

  function closeTicketModal() {
    setShowTicketModal(false);
    setSelectedId(null);
    setFiles([]);
    setReply({ content: "", status: "completed" });
    setError("");
    setReplySuccess("");
    setApprovalNote("");
    setApprovalComment("");
    navigate("/admin");
  }

  async function handleTransfer(e) {
    e.preventDefault();
    if (!selectedId || !transferDept) return;
    setTransferring(true);
    try {
      await api.post(`/admin/tickets/${selectedId}/transfer`, { to_department: transferDept, note: transferNote });
      setTransferDept("");
      setTransferNote("");
      await loadTickets();
      await loadDetail(selectedId);
    } catch (err) {
      setError(localizedError(err, "admin.transferFailed"));
    } finally {
      setTransferring(false);
    }
  }

  async function togglePublish(ticket) {
    const id = ticketRouteId(ticket);
    await api.patch(`/admin/tickets/${id}/publish`, { is_published: !ticket.is_published });
    await loadTickets();
    await loadDetail(id);
  }

  async function submitReply(e) {
    e.preventDefault();
    if (!selectedId || !canHandleSelected) {
      return;
    }
    setSubmitting(true);
    setError("");
    setReplySuccess("");
    try {
      const data = new FormData();
      data.append("content", reply.content);
      data.append("status", reply.status);
      if (files.length > 0) {
        for (const f of files) data.append("attachments", f);
      }
      await api.post(`/admin/tickets/${selectedId}/replies`, data, { headers: { "Content-Type": "multipart/form-data" } });
      setReply({ ...reply, content: "" });
      setFiles([]);
      setReplySuccess(t("admin.replySubmitted"));
      await Promise.all([
        loadDetail(selectedId),
        loadTickets(adminPage)
      ]);
    } catch (err) {
      setError(localizedError(err, "admin.replyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function requestLeaderApproval(e) {
    e.preventDefault();
    if (!selectedId || !canHandleSelected) return;
    setApprovalSubmitting(true);
    setError("");
    setReplySuccess("");
    try {
      await api.post(`/admin/tickets/${selectedId}/approval-requests`, { note: approvalNote });
      setApprovalNote("");
      setReplySuccess(t("admin.approvalRequested"));
      await Promise.all([loadDetail(selectedId), loadTickets(adminPage, user)]);
    } catch (err) {
      setError(localizedError(err, "admin.approvalRequestFailed"));
    } finally {
      setApprovalSubmitting(false);
    }
  }

  async function submitApprovalDecision(decision) {
    const pendingApproval = (detail?.approvals || []).find((item) => item.status === "pending");
    if (!pendingApproval) return;
    setApprovalDecisionSubmitting(decision);
    setError("");
    setReplySuccess("");
    try {
      await api.post(`/leader/approvals/${pendingApproval.id}/decision`, { decision, comment: approvalComment });
      setApprovalComment("");
      setReplySuccess(t(decision === "approved" ? "admin.approvalApproved" : "admin.approvalRejected"));
      await Promise.all([loadDetail(selectedId), loadTickets(adminPage, user)]);
    } catch (err) {
      setError(localizedError(err, "admin.approvalDecisionFailed"));
    } finally {
      setApprovalDecisionSubmitting("");
    }
  }

  const selectedStatus = selected ? statusMap[normalizeTicketStatus(selected.status)] || statusMap.pending : statusMap.pending;

  const adminTotalPages = Math.max(1, Math.ceil(adminTotal / adminPageSize));

  function goAdminPage(p) {
    const target = Math.max(1, Math.min(p, adminTotalPages));
    setAdminPage(target);
    loadTickets(target);
  }
  const currentHandlerText = selected?.current_department || selected?.department || t("common.notSet");
  const adminReplies = Array.isArray(detail?.replies) ? detail.replies : [];
  const submitterFollowups = Array.isArray(detail?.followups) ? detail.followups : [];
  const approvals = Array.isArray(detail?.approvals) ? detail.approvals : [];
  const pendingApproval = approvals.find((item) => item.status === "pending");
  const latestApproval = approvals.length ? approvals[approvals.length - 1] : null;
  const approvalStatus = detail?.approval_status || selected?.approval_status || "none";
  const isApprovalPending = approvalStatus === "pending";
  const canApproveSelected = detail?.permission === "approve" && Boolean(pendingApproval);
  const latestAdminReply = adminReplies.length ? adminReplies[adminReplies.length - 1] : null;
  const replyAttachmentsByReplyId = useMemo(() => {
    return (detail?.replyAttachments || []).reduce((acc, item) => {
      acc[item.reply_id] = [...(acc[item.reply_id] || []), item];
      return acc;
    }, {});
  }, [detail?.replyAttachments]);
  const leaderOnly = isLeaderOnlyUser(user);
  const sidebarWidthClass = sidebarCollapsed ? "grid-cols-[72px_minmax(0,1fr)]" : "grid-cols-[232px_minmax(0,1fr)]";
  const workflowSteps = selected
    ? [
      {
        key: "submit",
        title: t("admin.submitStep"),
        status: selected.status === "pending" ? "current" : "done",
        icon: ClipboardList,
        tone: "purple",
        lines: [
          `${t("admin.submitter")}：${selected.submitter_name || t("admin.student")}`,
          `${t("admin.submittedAt")}：${formatTime(selected.created_at, dateLocale)}`,
          t("admin.submittedToDepartment")
        ]
      },
      {
        key: "department",
        title: t("admin.departmentStep"),
        status: selected.status === "completed" ? "done" : "current",
        icon: FileCheck2,
        tone: "amber",
        lines: [
          `${t("admin.selectedDepartment")}：${selected.department || t("common.notSet")}`,
          `${t("admin.handlerDepartment")}：${currentHandlerText}`,
          latestAdminReply?.content ? `${t("admin.departmentReplyLine")}：${latestAdminReply.content}` : null,
          selected.status === "completed" ? t("admin.departmentCompleted") : t("admin.waitingDepartment")
        ].filter(Boolean)
      },
      ...(approvalStatus !== "none" ? [{
        key: "leaderApproval",
        title: t("admin.leaderApproval"),
        status: approvalStatus === "pending" ? "current" : "done",
        icon: Crown,
        tone: "purple",
        lines: [
          pendingApproval ? t("admin.approvalWaitingLeader") : t("admin.approvalDecided"),
          latestApproval?.requested_by_name ? `${t("admin.approvalRequester")}：${latestApproval.requested_by_name}` : null,
          latestApproval?.approver_name ? `${t("admin.approver")}：${latestApproval.approver_name}` : null
        ].filter(Boolean)
      }] : []),
      {
        key: "finish",
        title: t("admin.finishStep"),
        status: selected.status === "completed" ? "done" : "todo",
        icon: CheckCircle2,
        tone: "slate",
        lines: [
          `${t("admin.completedAt")}：${selected.status === "completed" ? formatTime(selected.updated_at, dateLocale) : "—"}`,
          selected.status === "completed" ? t("admin.flowFinished") : t("admin.finishPending")
        ]
      }
    ]
    : [];

  return (
    <>
    {!showTicketModal ? (
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
            title={sidebarCollapsed ? t("admin.expandMenu") : t("admin.collapseMenu")}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="mt-3 space-y-2">
          {/* Tickets - expandable */}
          <div>
            <button
              type="button"
              onClick={() => {
                setExpandedMenu(expandedMenu === "tickets" ? "" : "tickets");
                setActiveView(leaderOnly ? "approvals" : "tickets");
              }}
              title={sidebarCollapsed ? t(leaderOnly ? "admin.menuApprovals" : "admin.menuTickets") : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 ${
                (activeView === "tickets" || activeView === "approvals") ? "bg-ai-primary text-white shadow-[0_10px_24px_rgba(108,76,241,0.18)]" : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
              } ${sidebarCollapsed ? "justify-center px-0" : ""}`}
            >
              {leaderOnly ? <Crown size={18} className="shrink-0" /> : <ClipboardList size={18} className="shrink-0" />}
              {!sidebarCollapsed ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{t(leaderOnly ? "admin.menuApprovals" : "admin.menuTickets")}</span>
                  <span className={`mt-1 block text-xs leading-5 ${(activeView === "tickets" || activeView === "approvals") ? "text-white/80" : "text-ai-muted"}`}>{t(leaderOnly ? "admin.menuApprovalsDesc" : "admin.menuTicketsDesc")}</span>
                </span>
              ) : null}
              {!sidebarCollapsed ? (
                <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${expandedMenu === "tickets" ? "rotate-0" : "-rotate-90"}`} />
              ) : null}
            </button>
            {expandedMenu === "tickets" && !sidebarCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l-2 border-ai-border pl-3">
                {leaderOnly ? (
                  <>
                    <button
                      type="button"
                      onClick={() => { setActiveView("approvals"); setApprovalStatusFilter("pending"); }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-200 ${
                        activeView === "approvals" && approvalStatusFilter === "pending"
                          ? "bg-ai-primary/10 font-semibold text-ai-primary"
                          : "text-ai-body hover:bg-ai-bg"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${activeView === "approvals" && approvalStatusFilter === "pending" ? "bg-amber-500" : "bg-slate-300"}`} />
                      {t("admin.pendingApprovalStatus")}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveView("approvals"); setApprovalStatusFilter("decided"); }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-200 ${
                        activeView === "approvals" && approvalStatusFilter === "decided"
                          ? "bg-ai-primary/10 font-semibold text-ai-primary"
                          : "text-ai-body hover:bg-ai-bg"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${activeView === "approvals" && approvalStatusFilter === "decided" ? "bg-emerald-500" : "bg-slate-300"}`} />
                      {t("admin.decidedApprovalStatus")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setActiveView("tickets"); setAdminStatusFilter("pending"); }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-200 ${
                        activeView === "tickets" && adminStatusFilter === "pending"
                          ? "bg-ai-primary/10 font-semibold text-ai-primary"
                          : "text-ai-body hover:bg-ai-bg"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${activeView === "tickets" && adminStatusFilter === "pending" ? "bg-amber-500" : "bg-slate-300"}`} />
                      {t("admin.pendingStatus")}
                      {stats.statusCounts?.pending > 0 ? (
                        <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">{stats.statusCounts.pending}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveView("tickets"); setAdminStatusFilter("completed"); }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-200 ${
                        activeView === "tickets" && adminStatusFilter === "completed"
                          ? "bg-ai-primary/10 font-semibold text-ai-primary"
                          : "text-ai-body hover:bg-ai-bg"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${activeView === "tickets" && adminStatusFilter === "completed" ? "bg-emerald-500" : "bg-slate-300"}`} />
                      {t("admin.completedStatus")}
                      {stats.statusCounts?.completed > 0 ? (
                        <span className="ml-auto rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{stats.statusCounts.completed}</span>
                      ) : null}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          {!leaderOnly ? adminMenuItems.map((item) => {
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
          }) : null}

          {/* Configuration - expandable */}
          {!leaderOnly ? <div>
            <button
              type="button"
              onClick={() => {
                setExpandedMenu(expandedMenu === "config" ? "" : "config");
                setActiveView("config");
              }}
              title={sidebarCollapsed ? t("admin.menuConfig") : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 ${
                activeView === "config" ? "bg-ai-primary text-white shadow-[0_10px_24px_rgba(108,76,241,0.18)]" : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
              } ${sidebarCollapsed ? "justify-center px-0" : ""}`}
            >
              <Settings2 size={18} className="shrink-0" />
              {!sidebarCollapsed ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{t("admin.menuConfig")}</span>
                  <span className={`mt-1 block text-xs leading-5 ${activeView === "config" ? "text-white/80" : "text-ai-muted"}`}>{t("admin.menuConfigDesc")}</span>
                </span>
              ) : null}
              {!sidebarCollapsed ? (
                <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${expandedMenu === "config" ? "rotate-0" : "-rotate-90"}`} />
              ) : null}
            </button>
            {expandedMenu === "config" && !sidebarCollapsed ? (
              <div className="ml-4 mt-1 space-y-1 border-l-2 border-ai-border pl-3">
                <button
                  type="button"
                  onClick={() => { setActiveView("config"); setActiveConfigView("fields"); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-200 ${
                    activeView === "config" && activeConfigView === "fields"
                      ? "bg-ai-primary/10 font-semibold text-ai-primary"
                      : "text-ai-body hover:bg-ai-bg"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${activeView === "config" && activeConfigView === "fields" ? "bg-ai-primary" : "bg-slate-300"}`} />
                  {t("admin.configFields")}
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveView("config"); setActiveConfigView("departments"); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-200 ${
                    activeView === "config" && activeConfigView === "departments"
                      ? "bg-ai-primary/10 font-semibold text-ai-primary"
                      : "text-ai-body hover:bg-ai-bg"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${activeView === "config" && activeConfigView === "departments" ? "bg-ai-primary" : "bg-slate-300"}`} />
                  {t("admin.configDepartments")}
                </button>
              </div>
            ) : null}
          </div> : null}

          {user?.role === "super_admin" ? (
            <button
              type="button"
              onClick={() => setActiveView("permissions")}
              title={sidebarCollapsed ? t("admin.menuPermissions") : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-200 ${
                activeView === "permissions" ? "bg-ai-primary text-white shadow-[0_10px_24px_rgba(108,76,241,0.18)]" : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
              } ${sidebarCollapsed ? "justify-center px-0" : ""}`}
            >
              <Shield size={18} className="shrink-0" />
              {!sidebarCollapsed ? (
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{t("admin.menuPermissions")}</span>
                  <span className={`mt-1 block text-xs leading-5 ${activeView === "permissions" ? "text-white/80" : "text-ai-muted"}`}>{t("admin.menuPermissionsDesc")}</span>
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
        {activeView === "tickets" || activeView === "approvals" ? (
          <section className="app-card flex max-h-none flex-col overflow-hidden p-0 xl:max-h-[calc(100vh-11rem)] xl:min-h-[calc(100vh-11rem)] 2xl:max-h-[calc(100vh-104px)] 2xl:min-h-[calc(100vh-104px)]">
            <div className="flex shrink-0 items-center justify-between border-b border-ai-border px-4 py-3.5 sm:px-5">
              <div>
                <div className="text-xl font-semibold tracking-tight text-ai-title">
                  {leaderOnly
                    ? (approvalStatusFilter === "pending" ? t("admin.pendingApprovalStatus") : t("admin.decidedApprovalStatus"))
                    : (adminStatusFilter === "pending" ? t("admin.pendingStatus") : t("admin.completedStatus"))}
                </div>
                <div className="mt-1 text-sm text-ai-body">
                  {leaderOnly ? t("admin.leaderApprovalQueue") : (user?.department ? t("admin.departmentTicketQueue", { department: user.department }) : t("admin.viewAndReply"))}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3 scrollbar-thin">
              {loading ? (
                <div className="p-8 text-center text-sm text-slate-500">{t("common.loading")}</div>
              ) : error ? (
                <div className="p-8 text-center text-sm text-amber-700">{error}</div>
              ) : filteredTickets.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">{t("admin.noTodos")}</div>
              ) : (
                <div className="space-y-3">
                  {filteredTickets.map((ticket) => {
                    const status = statusMap[normalizeTicketStatus(ticket.status)] || statusMap.pending;
                    return (
                      <button
                        key={ticket.id}
                        type="button"
                        onClick={() => chooseTicket(ticket)}
                        className="w-full rounded-xl border border-ai-border bg-white p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:bg-ai-bg hover:shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${status.dotClassName || "bg-current"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ai-title">{ticket.title}</div>
                              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                {ticket.approval_status === "pending" ? (
                                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                                    {t("admin.approvalPendingTag")}
                                  </span>
                                ) : ticket.approval_status === "approved" ? (
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                                    {t("admin.approvalApprovedTag")}
                                  </span>
                                ) : ticket.approval_status === "rejected" ? (
                                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                                    {t("admin.approvalRejectedTag")}
                                  </span>
                                ) : null}
                                {ticket.is_published ? (
                                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-200">
                                    {t("typical.tag")}
                                  </span>
                                ) : null}
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${status.badgeClassName || status.className}`}>
                                  {status.label}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ai-muted">
                              <span>{displayFieldName(ticket.field, language)}</span>
                              <span>{ticket.current_department || t("common.department")}</span>
                              <span>{ticket.submitter_name}</span>
                              <span>{formatTime(ticket.created_at, dateLocale)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {adminTotalPages > 1 && !loading && (
                <div className="flex items-center justify-between gap-2 border-t border-ai-border px-3 py-3">
                  <span className="text-xs text-ai-muted">{t("admin.itemsCount", { count: adminTotal })}</span>
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
        ) : activeView === "analytics" ? (
          <AdminAnalyticsPanel stats={serverStats || stats} user={user} />
        ) : activeView === "config" ? (
          <FormConfigManager view={activeConfigView} />
        ) : activeView === "permissions" ? (
          <div className="space-y-4">
            <div className="inline-flex rounded-xl border border-ai-border bg-white p-1">
              <button
                type="button"
                onClick={() => setActivePermissionView("admins")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activePermissionView === "admins" ? "bg-ai-primary text-white" : "text-ai-body hover:bg-ai-bg"}`}
              >
                {t("admin.departmentAdmins")}
              </button>
              <button
                type="button"
                onClick={() => setActivePermissionView("leaders")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activePermissionView === "leaders" ? "bg-ai-primary text-white" : "text-ai-body hover:bg-ai-bg"}`}
              >
                {t("admin.departmentLeaders")}
              </button>
            </div>
            {activePermissionView === "admins" ? <PermissionManager /> : <DepartmentLeaderManager />}
          </div>
        ) : null}
      </div>
    </div>
    ) : null}

    {/* Ticket Detail Page */}
    {showTicketModal && selected ? (
        <div className="app-card overflow-hidden p-0">
          <div className="mesh-hero border-b border-ai-border px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold leading-6 text-ai-title">{selected.title}</h2>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ai-body">
                  <span>{t("admin.submittedAt")}：{formatTime(selected.created_at, dateLocale)}</span>
                  <span>{t("admin.submitter")}：{selected.submitter_name}</span>
                  {selected.submitter_phone ? <span>{t("admin.contact")}：{selected.submitter_phone}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={closeTicketModal} className="ghost-button h-9 px-3">
                  <ChevronLeft size={16} />
                  {t("action.back")}
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* Left: Content + Actions */}
            <div className="space-y-4 min-w-0">
              {/* Ticket Content */}
              <section>
                <h3 className="mb-2 text-sm font-semibold text-ai-title">{t("admin.ticketContent")}</h3>
                <div className="whitespace-pre-wrap rounded-xl border border-ai-border bg-white p-4 text-sm leading-7 text-ai-body">
                  {selected.content}
                </div>
              </section>

              {/* Attachments */}
              {detail?.attachments?.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-ai-title">{t("admin.attachments")}</h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.attachments.map(att => (
                      <a key={att.id} href={attachmentDownloadUrl(att.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-ai-border bg-white px-3 py-2 text-xs text-ai-body transition hover:bg-ai-bg">
                        <Paperclip size={12} />
                        <span className="max-w-[160px] truncate font-semibold text-ai-primary">{att.original_name}</span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              {submitterFollowups.length > 0 ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-950">
                    <MessageSquare size={16} />
                    {t("admin.submitterFollowups")}
                  </h3>
                  <div className="space-y-3">
                    {submitterFollowups.map((item) => (
                      <article key={item.id} className="rounded-xl bg-white p-3 text-sm leading-7 text-amber-950 ring-1 ring-amber-100">
                        <div className="mb-1 text-xs font-semibold text-amber-700">
                          {(item.submitter_name || selected.submitter_name || t("admin.submitter"))} · {formatTime(item.created_at, dateLocale)}
                        </div>
                        <div className="whitespace-pre-wrap">{item.content}</div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Current Status */}
              <section className="rounded-xl border border-ai-border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ai-title">{t("admin.currentStatus")}</h3>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${selectedStatus.badgeClassName || selectedStatus.className}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${selectedStatus.dotClassName || "bg-current"}`} />
                    {selectedStatus.label}
                  </span>
                </div>
              </section>

              {(canHandleSelected || detail?.permission === "approve" || approvals.length > 0) && !isCompleted ? (
                <section className="rounded-xl border border-ai-border bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-ai-title">
                      <Crown size={16} className="text-ai-primary" />
                      {t("admin.leaderApproval")}
                    </h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                      approvalStatus === "pending"
                        ? "bg-amber-50 text-amber-700 ring-amber-200"
                        : approvalStatus === "approved"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : approvalStatus === "rejected"
                            ? "bg-rose-50 text-rose-700 ring-rose-200"
                            : "bg-slate-50 text-slate-600 ring-slate-200"
                    }`}>
                      {approvalStatus === "pending"
                        ? t("admin.approvalPendingTag")
                        : approvalStatus === "approved"
                          ? t("admin.approvalApprovedTag")
                          : approvalStatus === "rejected"
                            ? t("admin.approvalRejectedTag")
                            : t("admin.approvalNotStarted")}
                    </span>
                  </div>

                  {approvals.length > 0 ? (
                    <div className="mb-3 space-y-2">
                      {approvals.map((approval) => (
                        <article key={approval.id} className="rounded-xl bg-ai-bg px-3 py-2.5 text-xs leading-5 text-ai-body ring-1 ring-ai-border">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-ai-title">
                            <span>{approval.department_name}</span>
                            <span>{approval.status === "pending" ? t("admin.approvalPendingTag") : approval.status === "approved" ? t("admin.approvalApprovedTag") : t("admin.approvalRejectedTag")}</span>
                            <span>{formatTime(approval.requested_at, dateLocale)}</span>
                          </div>
                          {approval.request_note ? <div className="mt-1 whitespace-pre-wrap">{approval.request_note}</div> : null}
                          {approval.decision_comment ? (
                            <div className="mt-1 rounded-lg bg-white px-2 py-1.5">
                              <span className="font-semibold text-ai-title">{approval.approver_name || t("admin.approver")}：</span>
                              {approval.decision_comment}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : null}

                  {canHandleSelected && approvalStatus !== "pending" ? (
                    <form onSubmit={requestLeaderApproval} className="space-y-3">
                      <textarea
                        value={approvalNote}
                        onChange={(event) => setApprovalNote(event.target.value)}
                        className="soft-textarea min-h-20 w-full"
                        placeholder={t("admin.approvalRequestPlaceholder")}
                      />
                      <button
                        type="submit"
                        disabled={approvalSubmitting || Number(detail?.department_leader_count || 0) === 0}
                        className="ghost-button h-10 w-full justify-center gap-2 border-ai-primary/30 text-ai-primary hover:bg-ai-primary/5 disabled:opacity-60"
                      >
                        <Crown size={14} />
                        {approvalSubmitting ? t("admin.submitting") : t("admin.requestLeaderApproval")}
                      </button>
                      {Number(detail?.department_leader_count || 0) === 0 ? (
                        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-100">{t("admin.noDepartmentLeaderConfigured")}</div>
                      ) : null}
                    </form>
                  ) : null}

                  {canHandleSelected && approvalStatus === "pending" ? (
                    <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                      {t("admin.waitingLeaderApprovalBeforeReply")}
                    </div>
                  ) : null}

                  {canApproveSelected ? (
                    <div className="space-y-3">
                      <textarea
                        value={approvalComment}
                        onChange={(event) => setApprovalComment(event.target.value)}
                        className="soft-textarea min-h-24 w-full"
                        placeholder={t("admin.approvalDecisionPlaceholder")}
                        required
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => submitApprovalDecision("approved")}
                          disabled={Boolean(approvalDecisionSubmitting) || !approvalComment.trim()}
                          className="primary-button h-10 justify-center disabled:opacity-60"
                        >
                          {approvalDecisionSubmitting === "approved" ? t("admin.submitting") : t("admin.approve")}
                        </button>
                        <button
                          type="button"
                          onClick={() => submitApprovalDecision("rejected")}
                          disabled={Boolean(approvalDecisionSubmitting) || !approvalComment.trim()}
                          className="ghost-button h-10 justify-center border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          {approvalDecisionSubmitting === "rejected" ? t("admin.submitting") : t("admin.reject")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* Department Admin Replies */}
              {adminReplies.length > 0 ? (
                <section className="rounded-xl border border-ai-border bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-ai-title">
                      <MessageSquare size={16} className="text-ai-primary" />
                      {t("admin.departmentReply")}
                    </h3>
                    {latestAdminReply ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        {latestAdminReply.replier_name || `${latestAdminReply.department || currentHandlerText}${t("admin.replyAdminSuffix")}`} · {formatTime(latestAdminReply.created_at, dateLocale)}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-3">
                    {adminReplies.map((r, idx) => {
                      const replyAttachments = replyAttachmentsByReplyId[r.id] || [];
                      return (
                        <article key={r.id || idx} className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                          <div className="whitespace-pre-wrap text-sm leading-7 text-emerald-950">{r.content}</div>
                          {replyAttachments.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {replyAttachments.map(att => (
                                <a key={att.id} href={attachmentDownloadUrl(att.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs text-emerald-700 ring-1 ring-emerald-200">
                                  <Paperclip size={10} />
                                  <span className="max-w-[160px] truncate font-semibold text-ai-primary">{att.original_name}</span>
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {/* Reply Form (pending tickets only) */}
              {!isCompleted && detail?.permission !== "approve" ? (
                <form onSubmit={submitReply} className="rounded-xl border border-ai-border p-4">
                  <h3 className="mb-3 text-sm font-semibold text-ai-title">{t("admin.processingInfo")}</h3>
                  {!canHandleSelected ? (
                    <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 ring-1 ring-amber-200">
                      {t("admin.onlyCurrentDeptCanHandle", { department: currentHandlerText })}
                    </div>
                  ) : null}
                  {canHandleSelected && isApprovalPending ? (
                    <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 ring-1 ring-amber-200">
                      {t("admin.waitingLeaderApprovalBeforeReply")}
                    </div>
                  ) : null}
                  <textarea
                    value={reply.content}
                    onChange={(e) => setReply({ ...reply, content: e.target.value })}
                    className="soft-textarea min-h-24 w-full"
                    disabled={!canHandleSelected || isApprovalPending}
                    placeholder={t("admin.replyPlaceholder")}
                    required
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <label className={`flex items-center gap-2 rounded-xl border border-dashed border-ai-border px-3 py-2 text-sm text-ai-body transition ${canHandleSelected ? "cursor-pointer hover:border-ai-primary/40" : "cursor-not-allowed opacity-60"}`}>
                      <Paperclip size={16} />
                      <span className="truncate">{files.length ? t("admin.filesCount", { count: files.length }) : t("admin.uploadAttachment")}</span>
                      <input
                        type="file"
                        multiple
                        accept=".txt,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.avi,.mp4"
                        onChange={(e) => setFiles(Array.from(e.target.files || []))}
                        className="hidden"
                        disabled={!canHandleSelected || isApprovalPending}
                      />
                    </label>
                    <button type="submit" disabled={submitting || !canHandleSelected || isApprovalPending} className="primary-button">
                      <SendHorizontal size={16} />
                      {submitting ? t("admin.submitting") : t("admin.submitReplyResult")}
                    </button>
                  </div>
                  {files.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {files.map((file) => (
                        <div key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 rounded-xl bg-ai-bg px-3 py-2 text-xs text-ai-body ring-1 ring-ai-border">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-semibold text-ai-primary">{file.name}</span>
                            <span className="ml-2 text-ai-muted">{(file.size / 1024 / 1024).toFixed(2)}M</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                            className="rounded-lg px-2 py-1 text-ai-muted hover:bg-white hover:text-ai-title"
                          >
                            {t("action.delete")}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {replySuccess ? (
                    <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">{replySuccess}</div>
                  ) : null}
                </form>
              ) : null}

              {/* Transfer Section (pending tickets only, for handlers) */}
              {!isCompleted && canHandleSelected && !isApprovalPending ? (
                <section className="rounded-xl border border-ai-border p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ai-title">
                    <ArrowRightLeft size={16} />
                    {t("admin.transferTicket")}
                  </h3>
                  <form onSubmit={handleTransfer} className="space-y-3">
                    <select
                      value={transferDept}
                      onChange={e => setTransferDept(e.target.value)}
                      className="soft-input h-10 w-full text-sm"
                      required
                    >
                      <option value="">{t("admin.chooseTransferDept")}</option>
                      {departments.filter(d => d !== (selected.current_department || selected.department)).map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <textarea
                      value={transferNote}
                      onChange={e => setTransferNote(e.target.value)}
                      className="soft-textarea min-h-16 w-full"
                      placeholder={t("admin.transferNotePlaceholder")}
                    />
                    <button type="submit" disabled={transferring || !transferDept} className="ghost-button h-10 w-full justify-center gap-2 border-amber-200 text-amber-700 hover:bg-amber-50">
                      <ArrowRightLeft size={14} />
                      {transferring ? t("admin.transferring") : t("admin.confirmTransfer")}
                    </button>
                  </form>
                </section>
              ) : null}
            </div>

            {/* Right: Workflow + Satisfaction */}
            <aside className="space-y-4">
              {/* Workflow */}
              <section className="rounded-xl border border-ai-border p-4">
                <h3 className="mb-3 text-sm font-semibold text-ai-title">{t("admin.workflow")}</h3>
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
                      ? "border-ai-primary/30 bg-white shadow-[0_8px_20px_rgba(108,76,241,0.06)]"
                      : "border-ai-border bg-white";
                    return (
                      <article key={step.key} className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-2.5 pb-3 last:pb-0">
                        {!isLast ? <div className="absolute left-[17px] top-9 h-[calc(100%-14px)] w-px bg-ai-border" /> : null}
                        <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full ${toneClass} shadow-sm`}>
                          <StepIcon size={15} />
                        </div>
                        <div className={`rounded-[14px] border px-3 py-2.5 ${cardClass}`}>
                          <div className={`text-xs font-semibold ${step.status === "current" ? "text-ai-primary" : "text-ai-title"}`}>
                            {step.title}
                          </div>
                          <div className="mt-1.5 space-y-1 text-[11px] leading-5 text-ai-body">
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

              {/* Transfer History */}
              {detail?.transfers?.length > 0 ? (
                <section className="rounded-xl border border-ai-border p-4">
                  <h3 className="mb-3 text-sm font-semibold text-ai-title">{t("admin.transferRecords")}</h3>
                  <div className="space-y-2">
                    {detail.transfers.map((tr, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs">
                        <ArrowRightLeft size={12} className="mt-0.5 shrink-0 text-ai-muted" />
                        <div>
                          <span className="font-medium text-ai-title">{tr.from_department}</span>
                          <span className="text-ai-muted"> → </span>
                          <span className="font-medium text-ai-title">{tr.to_department}</span>
                          {tr.note ? <div className="mt-0.5 text-ai-muted">{tr.note}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Satisfaction */}
              <section className="rounded-xl border border-ai-border p-4">
                <h3 className="mb-3 text-sm font-semibold text-ai-title">{t("admin.satisfaction")}</h3>
                {detail?.satisfaction ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2.5 text-amber-800 ring-1 ring-amber-100">
                      <span className="text-xs font-semibold">{t("admin.score")}</span>
                      <span className="flex items-center gap-1 text-sm font-semibold">
                        <Star size={14} fill="currentColor" />
                        {detail.satisfaction.score} / 5
                      </span>
                    </div>
                    <div className="rounded-xl bg-ai-bg px-3 py-2.5 text-xs leading-6 text-ai-body">
                      {detail.satisfaction.comment || t("admin.noSatisfactionComment")}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-ai-bg px-3 py-3 text-xs text-ai-body">
                    {selected.status === "completed" ? t("admin.waitingSatisfaction") : t("admin.satisfactionAfterCompleted")}
                  </div>
                )}
              </section>

              {/* Publish toggle for completed */}
              {selected.status === "completed" ? (
                <button
                  type="button"
                  onClick={() => togglePublish(selected)}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ring-1 transition duration-200 ${
                    selected.is_published ? "bg-teal-50 text-teal-700 ring-teal-200" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <Megaphone size={16} />
                  {selected.is_published ? t("action.unpublish") : t("action.publish")}
                </button>
              ) : null}
            </aside>
          </div>
        </div>
    ) : showTicketModal ? (
      <div className="app-card px-6 py-12 text-center text-sm text-ai-body">{t("common.loading")}</div>
    ) : null}
    </>
  );
}
