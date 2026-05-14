import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, Bot, ClipboardList, Eye, Forward, KeyRound, Megaphone, Paperclip, RefreshCw, Search, SendHorizontal, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api, uploadConfig } from "../api";
import { departments, formatTime, statusMap } from "../constants";

const adminMenuItems = [
  {
    key: "tickets",
    label: "事项处理",
    description: "办理学生提交事项",
    icon: ClipboardList
  },
  {
    key: "analytics",
    label: "数据统计分析",
    description: "查看事项结构与办理进展",
    icon: BarChart3
  },
  {
    key: "permissions",
    label: "权限分配",
    description: "分配超级/1级/2级管理员",
    icon: ShieldCheck,
    levelOnly: 1
  }
];

const ticketStatusOrder = ["pending", "processing", "replied", "completed"];
const SUPER_ADMIN_LEVEL = 0;

function adminLevelLabel(level) {
  const numericLevel = level === null || level === undefined || level === "" ? 2 : Number(level);
  if (numericLevel === SUPER_ADMIN_LEVEL) return "超级管理员";
  return `${numericLevel || 2}级管理员`;
}

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

function formatTransferTitle(item) {
  const fromOperator = item.operator_name || "管理员";
  const targetOperator = item.target_operator_name || "管理员";
  return `${item.from_department}的${fromOperator} 转办给 ${item.to_department}的${targetOperator}`;
}

function PrettySelect({ value, onChange, options, disabled = false, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="h-10 w-full appearance-none rounded-xl border border-ai-border bg-white px-3 pr-9 text-sm font-medium text-ai-title outline-none transition duration-200 hover:border-ai-primary/30 focus:border-ai-primary/40 focus:ring-4 focus:ring-ai-primary/10 disabled:cursor-not-allowed disabled:bg-ai-bg disabled:text-ai-muted"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ai-muted">⌄</span>
    </div>
  );
}

export default function AdminPage() {
  const [activeView, setActiveView] = useState("tickets");
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState({ department: "党政办", content: "", status: "replied" });
  const [transfer, setTransfer] = useState({ to_department: "信数中心", note: "" });
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [adminUsers, setAdminUsers] = useState([]);
  const [permissionDrafts, setPermissionDrafts] = useState({});
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [permissionQuery, setPermissionQuery] = useState("");
  const [passwordModalUser, setPasswordModalUser] = useState(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [resettingUserId, setResettingUserId] = useState(null);

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
          .filter((ticket) => ticket.status === status)
          .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      }))
      .filter((group) => group.items.length > 0);
  }, [tickets]);
  const stats = useMemo(() => {
    const total = tickets.length;
    const statusCounts = Object.keys(statusMap).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    tickets.forEach((ticket) => {
      statusCounts[ticket.status] = (statusCounts[ticket.status] || 0) + 1;
    });

    const fieldEntries = Object.entries(countBy(tickets, (ticket) => ticket.field))
      .sort((a, b) => b[1] - a[1]);
    const departmentEntries = Object.entries(countBy(tickets, (ticket) => ticket.current_department || ticket.department))
      .sort((a, b) => b[1] - a[1]);
    const repliedCount = (statusCounts.replied || 0) + (statusCounts.completed || 0);

    return {
      total,
      active: total - (statusCounts.completed || 0),
      published: tickets.filter((ticket) => ticket.is_published).length,
      statusCounts,
      fieldEntries,
      departmentEntries,
      replyRate: formatPercent(repliedCount, total),
      completeRate: formatPercent(statusCounts.completed || 0, total)
    };
  }, [tickets]);

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

  async function loadAdminUsers() {
    if (![SUPER_ADMIN_LEVEL, 1].includes(Number(user?.admin_level))) return;
    setPermissionsLoading(true);
    setPermissionsError("");
    try {
      const res = await api.get("/admin/users");
      const nextUsers = Array.isArray(res.data) ? res.data : [];
      setAdminUsers(nextUsers);
      setPermissionDrafts(nextUsers.reduce((acc, item) => {
        acc[item.id] = {
          role: item.role === "admin" ? "admin" : "user",
          level: String(item.admin_level ?? 2),
          department: item.admin_department || item.department || "党政办"
        };
        return acc;
      }, {}));
    } catch (err) {
      setPermissionsError(err.response?.data?.message || "权限数据加载失败");
    } finally {
      setPermissionsLoading(false);
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
    if (user && activeView === "permissions" && ![SUPER_ADMIN_LEVEL, 1].includes(Number(user.admin_level))) {
      setActiveView("tickets");
    }
  }, [activeView, user]);

  useEffect(() => {
    if (activeView === "permissions" && [SUPER_ADMIN_LEVEL, 1].includes(Number(user?.admin_level))) {
      loadAdminUsers();
    }
  }, [activeView, user?.admin_level]);

  function chooseTicket(ticket) {
    setSelectedId(ticket.id);
    setReply({
      department: user?.department || ticket.current_department || "党政办",
      content: ticket.ai_suggestion || "",
      status: "replied"
    });
    setTransfer({ to_department: departments.find((dept) => dept !== (ticket.current_department || "党政办")) || "信数中心", note: "" });
  }

  async function submitTransfer(e) {
    e.preventDefault();
    if (!selectedId) return;
    await api.post(`/admin/tickets/${selectedId}/transfer`, transfer);
    await loadTickets();
    await loadDetail(selectedId);
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
    const data = new FormData();
    data.append("content", reply.content);
    data.append("status", reply.status);
    files.forEach((file) => data.append("attachments", file));
    await api.post(`/admin/tickets/${selectedId}/replies`, data, uploadConfig);
    setReply({ ...reply, content: "" });
    setFiles([]);
    await loadTickets();
    await loadDetail(selectedId);
    setSubmitting(false);
  }

  function updatePermissionDraft(userId, patch) {
    setPermissionDrafts((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] || { role: "user", level: "2", department: "党政办" }),
        ...patch
      }
    }));
  }

  async function saveAdminPermission(targetUser) {
    const draft = permissionDrafts[targetUser.id] || { role: "user", level: "2", department: "党政办" };
    setSavingUserId(targetUser.id);
    setPermissionsError("");
    try {
      await api.patch(`/admin/users/${targetUser.id}/admin`, {
        role: draft.role,
        level: Number(draft.level),
        department: draft.department
      });
      await loadAdminUsers();
      if (targetUser.id === user?.id) {
        await loadMe();
      }
    } catch (err) {
      setPermissionsError(err.response?.data?.message || "权限保存失败");
    } finally {
      setSavingUserId(null);
    }
  }

  function canResetPassword(targetUser) {
    if (!targetUser || targetUser.id === user?.id) return false;
    const operatorLevel = Number(user?.admin_level ?? 2);
    const targetIsAdmin = targetUser.role === "admin";
    const targetLevel = targetIsAdmin ? Number(targetUser.admin_level ?? 2) : null;
    if (operatorLevel === SUPER_ADMIN_LEVEL) return true;
    return operatorLevel === 1
      ? !targetIsAdmin || targetLevel === 2
      : !targetIsAdmin;
  }

  function openPasswordModal(targetUser) {
    if (!canResetPassword(targetUser)) return;
    setPasswordModalUser(targetUser);
    setPasswordValue("");
    setPasswordError("");
  }

  function closePasswordModal() {
    if (resettingUserId) return;
    setPasswordModalUser(null);
    setPasswordValue("");
    setPasswordError("");
  }

  async function resetUserPassword(e) {
    e.preventDefault();
    if (!passwordModalUser) return;
    if (passwordValue.length < 6) {
      setPasswordError("新密码至少需要6位");
      return;
    }
    setResettingUserId(passwordModalUser.id);
    setPasswordError("");
    try {
      await api.patch(`/admin/users/${passwordModalUser.id}/password`, { password: passwordValue });
      closePasswordModal();
    } catch (err) {
      setPasswordError(err.response?.data?.message || "密码重置失败");
    } finally {
      setResettingUserId(null);
    }
  }

  const summaryCards = [
    { label: "可见事项", value: stats.total, note: user?.department ? `${user.department}权限范围` : "全部范围" },
    { label: "处理中事项", value: stats.active, note: "未完成事项总量" },
    { label: "回复覆盖率", value: stats.replyRate, note: "已回复或已完成占比" },
    { label: "完成率", value: stats.completeRate, note: "已完成事项占比" }
  ];
  const maxStatusCount = Math.max(1, ...Object.values(stats.statusCounts));
  const maxDepartmentCount = Math.max(1, ...stats.departmentEntries.map(([, count]) => count));
  const maxFieldCount = Math.max(1, ...stats.fieldEntries.map(([, count]) => count));
  const selectedStatus = selected ? statusMap[selected.status] || statusMap.pending : statusMap.pending;
  const canManagePermissions = [SUPER_ADMIN_LEVEL, 1].includes(Number(user?.admin_level));
  const canGrantSuperAdmin = Number(user?.admin_level) === SUPER_ADMIN_LEVEL;
  const adminLevelOptions = [
    ...(canGrantSuperAdmin ? [{ value: "0", label: "超级管理员" }] : []),
    { value: "1", label: "1级管理员" },
    { value: "2", label: "2级管理员" }
  ];
  const visibleAdminMenuItems = useMemo(
    () => adminMenuItems.filter((item) => !item.levelOnly || canManagePermissions),
    [canManagePermissions]
  );
  const filteredAdminUsers = useMemo(() => {
    const keyword = permissionQuery.trim().toLowerCase();
    if (!keyword) return adminUsers;
    return adminUsers.filter((item) => {
      const text = `${item.username || ""} ${item.name || ""}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [adminUsers, permissionQuery]);
  return (
    <>
    <div className="grid gap-5 xl:grid-cols-[236px_minmax(0,1fr)] 2xl:gap-6">
      <aside className="app-card h-fit p-4 xl:sticky xl:top-[108px]">
        <div className="px-2 pb-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ai-muted">管理端</div>
          <div className="mt-2 text-xl font-semibold tracking-tight text-ai-title">
            {user?.department || "部门"}工作台
          </div>
          <div className="mt-2 text-sm leading-6 text-ai-body">聚焦学生事项办理与运行数据分析。</div>
        </div>

        <nav className="space-y-2">
          {visibleAdminMenuItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition duration-200 ${
                  active ? "bg-ai-primary text-white shadow-[0_10px_24px_rgba(108,76,241,0.18)]" : "text-ai-body hover:bg-ai-bg hover:text-ai-title"
                }`}
              >
                <Icon size={18} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className={`mt-1 block text-xs leading-5 ${active ? "text-white/80" : "text-ai-muted"}`}>{item.description}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="mt-5 border-t border-ai-border px-2 pt-5 text-sm text-ai-body">
          <div className="flex items-center justify-between">
            <span>待推进事项</span>
            <span className="font-semibold text-ai-title">{stats.active}</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span>已发布典型问题</span>
            <span className="font-semibold text-ai-title">{stats.published}</span>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {activeView === "tickets" ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] 2xl:gap-6">
            <section className="app-card overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-ai-border px-6 py-5">
                <div>
                  <div className="text-2xl font-semibold tracking-tight text-ai-title">学生事项处理</div>
                  <div className="mt-2 text-sm text-ai-body">
                    {user?.department ? `${user.department}事项队列` : "查看事项并办理回复"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadTickets}
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-ai-border bg-white text-ai-body transition duration-200 hover:bg-ai-bg"
                  title="刷新"
                >
                  <RefreshCw size={16} />
                </button>
              </div>

              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-4 scrollbar-thin">
                {loading ? (
                  <div className="p-8 text-center text-sm text-slate-500">加载中...</div>
                ) : error ? (
                  <div className="p-8 text-center text-sm text-amber-700">{error}</div>
                ) : tickets.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">暂无待办事项</div>
                ) : (
                  <div className="space-y-5">
                    {ticketGroups.map((group) => (
                      <section key={group.status} className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${group.meta.className}`}>
                              {group.meta.label}
                            </span>
                            {group.status === "pending" ? (
                              <span className="text-xs font-medium text-amber-700">优先处理</span>
                            ) : null}
                          </div>
                          <span className="text-xs text-ai-muted">{group.items.length} 项</span>
                        </div>

                        <div className="space-y-3">
                          {group.items.map((ticket) => {
                            const status = statusMap[ticket.status] || statusMap.pending;
                            return (
                              <button
                                key={ticket.id}
                                type="button"
                                onClick={() => chooseTicket(ticket)}
                                className={`w-full rounded-[20px] border p-4 text-left transition duration-200 ease-out hover:-translate-y-0.5 ${
                                  selectedId === ticket.id ? "border-ai-primary/30 bg-ai-primary/10 shadow-sm" : "border-ai-border bg-white hover:bg-ai-bg"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold text-ai-title">{ticket.title}</div>
                                    <div className="mt-1 text-xs text-ai-muted">
                                      #{String(ticket.id).padStart(6, "0")} · 提交人：{ticket.submitter_name}
                                    </div>
                                  </div>
                                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${status.className}`}>{status.label}</span>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ai-body">
                                  <span>{ticket.field}</span>
                                  <span>申请部门：{ticket.department || "未指定"}</span>
                                  <span>当前：{ticket.current_department || "党政办"}</span>
                                  {ticket.is_published ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700 ring-1 ring-teal-200">已发布</span> : null}
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
                <div className="p-12 text-center text-ai-body">请选择事项</div>
              ) : (
                <>
                  <div className="mesh-hero border-b border-ai-border px-8 py-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[32px] font-semibold tracking-tight text-ai-title">{selected.title}</div>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ai-body">
                          <span>提交人：{selected.submitter_name}</span>
                          <span>联系方式：{selected.submitter_phone || "不显示"}</span>
                          <span>申请部门：{selected.department || "未指定"}</span>
                          <span>当前承办：{selected.current_department || "党政办"}</span>
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
                          {selected.is_published ? "取消发布" : "发布典型问题"}
                        </button>
                        <Link to={`/tickets/${selected.id}`} className="ghost-button h-11">
                          <Eye size={16} />
                          详情页
                        </Link>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-5 p-5 2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:gap-6 2xl:p-6">
                    <div className="space-y-6">
                      <section>
                        <h3 className="mb-3 font-semibold text-ai-title">事项内容</h3>
                        <div className="whitespace-pre-wrap rounded-[20px] border border-ai-border bg-ai-bg p-5 text-sm leading-7 text-ai-body">
                          {selected.content}
                        </div>
                      </section>

                      <section className="rounded-[20px] border border-ai-primary/10 bg-ai-primary/5 p-5">
                        <div className="mb-3 flex items-center gap-2 font-semibold text-ai-title">
                          <Bot size={18} />
                          AI 智能摘要
                        </div>
                        <div className="text-sm leading-7 text-ai-body">
                          <div>智能分类：{selected.ai_category || selected.field}</div>
                          <div className="mt-2">回复建议：{selected.ai_suggestion || "暂无建议"}</div>
                        </div>
                      </section>

                      <section>
                        <h3 className="mb-3 font-semibold text-ai-title">转办记录</h3>
                        <div className="space-y-3">
                          {Array.isArray(detail?.transfers) && detail.transfers.length ? (
                            detail.transfers.map((item) => (
                              <div key={item.id} className="rounded-2xl border border-ai-border bg-white p-4 text-sm">
                                <div className="flex flex-wrap justify-between gap-3">
                                  <span className="font-medium text-ai-title">{formatTransferTitle(item)}</span>
                                  <span className="text-ai-muted">{formatTime(item.created_at)}</span>
                                </div>
                                {item.note ? <div className="mt-2 text-slate-600">说明：{item.note}</div> : null}
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl bg-ai-bg p-4 text-sm text-ai-body">暂无转办记录</div>
                          )}
                        </div>
                      </section>

                      <section>
                        <h3 className="mb-3 font-semibold text-ai-title">历史回复</h3>
                        <div className="space-y-3">
                          {Array.isArray(detail?.replies) && detail.replies.length ? (
                            detail.replies.map((item) => (
                              <div key={item.id} className="rounded-2xl border border-ai-border p-4">
                                <div className="mb-2 flex justify-between gap-3 text-sm">
                                  <span className="font-medium">{item.department}</span>
                                  <span className="text-slate-500">{formatTime(item.created_at)}</span>
                                </div>
                                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{item.content}</div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">暂无回复</div>
                          )}
                        </div>
                      </section>
                    </div>

                    <aside className="space-y-5">
                      <section className="rounded-[20px] border border-ai-border p-5">
                        <h3 className="mb-4 font-semibold text-ai-title">当前状态</h3>
                        <div className={`rounded-2xl p-4 ring-1 ${selectedStatus.className}`}>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-semibold text-ai-title">办理状态</div>
                              <div className="mt-2 text-xs leading-5 text-ai-body">
                                最近更新：{formatTime(selected.updated_at || selected.created_at)}
                              </div>
                            </div>
                            <span className="shrink-0 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-ai-title ring-1 ring-white/70">
                              {selectedStatus.label}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {Object.entries(statusMap).map(([value, meta]) => {
                            const active = selected.status === value;
                            return (
                              <div
                                key={value}
                                className={`rounded-xl px-3 py-2.5 text-center text-xs font-semibold ring-1 ${
                                  active ? meta.className : "bg-white text-ai-muted ring-ai-border"
                                }`}
                              >
                                {meta.label}
                              </div>
                            );
                          })}
                        </div>
                      </section>

                      <form onSubmit={submitTransfer} className="rounded-[20px] border border-amber-100 bg-amber-50/70 p-5">
                        <h3 className="mb-4 flex items-center gap-2 font-semibold text-ai-title">
                          <Forward size={17} />
                          转办事项
                        </h3>
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">指定部门</span>
                          <select
                            value={transfer.to_department}
                            onChange={(e) => setTransfer({ ...transfer, to_department: e.target.value })}
                            className="soft-input w-full"
                          >
                            {departments.map((dept) => (
                              <option key={dept} value={dept}>{dept}</option>
                            ))}
                          </select>
                        </label>
                        <label className="mb-4 block">
                          <span className="mb-1 block text-sm text-ai-body">转办说明</span>
                          <textarea
                            value={transfer.note}
                            onChange={(e) => setTransfer({ ...transfer, note: e.target.value })}
                            className="soft-textarea min-h-24 w-full"
                            placeholder="可填写转办原因或办理提示"
                          />
                        </label>
                        <button disabled={!canReplySelected} className="primary-button w-full bg-amber-600 hover:brightness-105">
                          <Forward size={16} />
                          确认转办
                        </button>
                      </form>

                      <form onSubmit={submitReply} className={`rounded-[20px] border p-5 ${canReplySelected ? "border-ai-border" : "border-ai-border bg-ai-bg"}`}>
                        <h3 className="mb-4 font-semibold text-ai-title">回复事项</h3>
                        {!canHandleSelected ? (
                          <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 ring-1 ring-amber-200">
                            该事项当前承办部门为 {selected.current_department || "党政办"}，只能由该部门管理员回复处理。
                          </div>
                        ) : null}
                        {isCompleted ? (
                          <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800 ring-1 ring-emerald-200">
                            该事项已完成，不能继续提交回复。
                          </div>
                        ) : null}
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">回复部门</span>
                          <input
                            value={user?.department || reply.department}
                            readOnly
                            className="soft-input w-full"
                            required
                          />
                        </label>
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">回复内容</span>
                          <textarea
                            value={reply.content}
                            onChange={(e) => setReply({ ...reply, content: e.target.value })}
                            className="soft-textarea min-h-36 w-full"
                            disabled={!canReplySelected}
                            required
                          />
                        </label>
                        <label className="mb-3 block">
                          <span className="mb-1 block text-sm text-ai-body">回复后状态</span>
                          <select
                            value={reply.status}
                            onChange={(e) => setReply({ ...reply, status: e.target.value })}
                            className="soft-input w-full"
                            disabled={!canReplySelected}
                          >
                            <option value="replied">已回复</option>
                            <option value="completed">已完成</option>
                            <option value="processing">处理中</option>
                          </select>
                        </label>
                        <label className={`mb-4 flex items-center gap-2 rounded-xl border border-dashed border-ai-border px-3 py-3 text-sm text-ai-body ${canReplySelected ? "cursor-pointer hover:border-ai-primary/40" : "cursor-not-allowed opacity-60"}`}>
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
                        <button
                          disabled={submitting || !canReplySelected}
                          className="primary-button w-full"
                        >
                          <SendHorizontal size={16} />
                          {isCompleted ? "已完成" : submitting ? "提交中..." : "提交回复"}
                        </button>
                      </form>
                    </aside>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : activeView === "analytics" ? (
          <div className="space-y-6">
            <section className="app-card mesh-hero p-8">
              <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="ai-chip mb-4">
                    <BarChart3 size={14} className="mr-1.5" />
                    数据统计分析
                  </div>
                  <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">事项运行概览</h1>
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
                <div key={card.label} className="app-card p-5">
                  <div className="text-sm text-ai-body">{card.label}</div>
                  <div className="mt-4 text-[36px] font-semibold leading-none tracking-tight text-ai-title">{card.value}</div>
                  <div className="mt-3 text-xs text-ai-muted">{card.note}</div>
                </div>
              ))}
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
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
        ) : activeView === "permissions" && canManagePermissions ? (
          <div className="space-y-6">
            <section className="app-card mesh-hero p-8">
              <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="ai-chip mb-4">
                    <ShieldCheck size={14} className="mr-1.5" />
                    权限分配
                  </div>
                  <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">管理员权限管理</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
                    超级管理员可授予超级、1级和2级管理员权限，1级管理员可分配1级或2级管理员；密码重置通过弹框完成。
                  </p>
                </div>
                <button type="button" onClick={loadAdminUsers} className="ghost-button bg-white/80">
                  <RefreshCw size={16} />
                  刷新用户
                </button>
              </div>
            </section>

            {permissionsError ? (
              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
                {permissionsError}
              </div>
            ) : null}

            <section className="app-card overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ai-border px-6 py-5">
                <div>
                  <h2 className="text-xl font-semibold text-ai-title">用户权限列表</h2>
                  <p className="mt-1 text-sm text-ai-body">管理员等级、部门和密码重置都在这里处理。</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex h-10 w-72 items-center rounded-xl border border-ai-border bg-white px-3 transition duration-200 focus-within:border-ai-primary/40 focus-within:ring-4 focus-within:ring-ai-primary/10">
                    <Search size={16} className="text-ai-muted" />
                    <input
                      value={permissionQuery}
                      onChange={(e) => setPermissionQuery(e.target.value)}
                      className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none placeholder:text-ai-muted"
                      placeholder="检索账号或姓名"
                    />
                  </label>
                  <span className="rounded-full bg-ai-primary/10 px-3 py-1 text-xs font-semibold text-ai-primary ring-1 ring-ai-primary/10">
                    {filteredAdminUsers.length} / {adminUsers.length} 位用户
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="soft-table w-full min-w-[1040px]">
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>当前身份</th>
                      <th>所属部门</th>
                      <th>管理员等级</th>
                      <th>密码</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {permissionsLoading ? (
                      <tr>
                        <td colSpan="6" className="px-6 py-12 text-center text-ai-body">权限数据加载中...</td>
                      </tr>
                    ) : filteredAdminUsers.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="px-6 py-12 text-center text-ai-body">暂无匹配用户</td>
                      </tr>
                    ) : (
                      filteredAdminUsers.map((item) => {
                        const draft = permissionDrafts[item.id] || {
                          role: item.role === "admin" ? "admin" : "user",
                          level: String(item.admin_level ?? 2),
                          department: item.admin_department || item.department || "党政办"
                        };
                        const isAdmin = item.role === "admin";
                        const draftIsAdmin = draft.role === "admin";
                        const targetIsSuperAdmin = isAdmin && Number(item.admin_level ?? 2) === SUPER_ADMIN_LEVEL;
                        const lockedSuperAdmin = targetIsSuperAdmin && !canGrantSuperAdmin;
                        const rowAdminLevelOptions = lockedSuperAdmin
                          ? [{ value: "0", label: "超级管理员" }, ...adminLevelOptions]
                          : adminLevelOptions;
                        const isSelfLevelDrop = item.id === user?.id && (draft.role !== "admin" || Number(draft.level) !== Number(user?.admin_level));
                        const canResetTargetPassword = canResetPassword(item);
                        return (
                          <tr key={item.id}>
                            <td>
                              <div className="font-semibold text-ai-title">{item.name}</div>
                              <div className="mt-1 text-xs text-ai-muted">{item.username} · {item.phone || "未留电话"}</div>
                            </td>
                            <td>
                              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                                isAdmin ? "bg-ai-primary/10 text-ai-primary ring-ai-primary/10" : "bg-slate-100 text-slate-600 ring-slate-200"
                              }`}>
                                {isAdmin ? adminLevelLabel(item.admin_level) : "普通用户"}
                              </span>
                            </td>
                            <td>
                              <PrettySelect
                                value={draft.department}
                                onChange={(e) => updatePermissionDraft(item.id, { department: e.target.value })}
                                disabled={!draftIsAdmin || lockedSuperAdmin}
                                className="w-40"
                                options={departments.map((dept) => ({ value: dept, label: dept }))}
                              />
                            </td>
                            <td>
                              <div className="flex gap-2">
                                <PrettySelect
                                  value={draft.role}
                                  onChange={(e) => updatePermissionDraft(item.id, { role: e.target.value })}
                                  disabled={lockedSuperAdmin}
                                  className="w-28"
                                  options={[
                                    { value: "user", label: "普通用户" },
                                    { value: "admin", label: "管理员" }
                                  ]}
                                />
                                <PrettySelect
                                  value={draft.level}
                                  onChange={(e) => updatePermissionDraft(item.id, { level: e.target.value })}
                                  disabled={!draftIsAdmin || lockedSuperAdmin}
                                  className="w-32"
                                  options={rowAdminLevelOptions}
                                />
                              </div>
                              {isSelfLevelDrop ? (
                                <div className="mt-1 text-xs text-amber-700">不能降低自己的管理员权限</div>
                              ) : null}
                              {lockedSuperAdmin ? (
                                <div className="mt-1 text-xs text-ai-muted">仅超级管理员可调整</div>
                              ) : null}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => openPasswordModal(item)}
                                disabled={!canResetTargetPassword}
                                className="secondary-button h-10 whitespace-nowrap px-4"
                              >
                                <KeyRound size={16} />
                                重置密码
                              </button>
                              {!canResetTargetPassword ? (
                                <div className="mt-1 text-xs text-ai-muted">仅可重置低一级或普通用户</div>
                              ) : null}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => saveAdminPermission(item)}
                                disabled={savingUserId === item.id || isSelfLevelDrop || lockedSuperAdmin}
                                className="primary-button h-10 px-4"
                              >
                                <ShieldCheck size={16} />
                                {savingUserId === item.id ? "保存中..." : draftIsAdmin ? "保存权限" : "设为普通用户"}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
    {passwordModalUser ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
        onClick={closePasswordModal}
      >
        <form
          className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
          onClick={(e) => e.stopPropagation()}
          onSubmit={resetUserPassword}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ai-primary/10 text-ai-primary">
              <KeyRound size={20} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-ai-title">重置密码</h2>
              <p className="mt-1 text-sm text-ai-body">
                {passwordModalUser.name} · {passwordModalUser.username}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-ai-bg px-4 py-3 text-sm text-ai-body">
            <div className="flex items-center justify-between gap-3">
              <span>目标身份</span>
              <span className="font-semibold text-ai-title">
                {passwordModalUser.role === "admin" ? adminLevelLabel(passwordModalUser.admin_level) : "普通用户"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span>所属部门</span>
              <span className="font-semibold text-ai-title">
                {passwordModalUser.admin_department || passwordModalUser.department || "未设置"}
              </span>
            </div>
          </div>

          <label className="mt-5 block text-sm font-semibold text-ai-title" htmlFor="admin-password-reset">
            新密码
          </label>
          <input
            id="admin-password-reset"
            type="password"
            autoFocus
            value={passwordValue}
            onChange={(e) => setPasswordValue(e.target.value)}
            className="soft-input mt-2 w-full"
            placeholder="请输入至少6位新密码"
          />

          {passwordError ? (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-100">
              {passwordError}
            </div>
          ) : null}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={closePasswordModal}
              disabled={Boolean(resettingUserId)}
              className="ghost-button h-10 px-4 disabled:cursor-not-allowed disabled:opacity-55"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={passwordValue.length < 6 || Boolean(resettingUserId)}
              className="primary-button h-10 px-4"
            >
              <KeyRound size={16} />
              {resettingUserId ? "重置中..." : "确认重置"}
            </button>
          </div>
        </form>
      </div>
    ) : null}
    </>
  );
}
