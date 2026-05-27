import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Settings2, UserPlus, X } from "lucide-react";
import { api } from "../api";
import { labelFor } from "../pages/AdminPage";
import { defaultDepartments } from "../constants";
import { useLanguage } from "../i18n";

function RoleManager({ roleRows, roleLoading, roleSaving, roleError, onLoadRoles, onSaveRole, setRoleRows, setRoleError }) {
  const { t } = useLanguage();
  const ROLE_LABELS = {
    super_admin: t("role.super_admin"),
    admin: t("role.admin"),
    liaison: t("role.liaison")
  };
  const [showModal, setShowModal] = useState(false);
  const [addForm, setAddForm] = useState({ role: "liaison", department: "", search: "", personId: "" });
  const [addPersons, setAddPersons] = useState([]);
  const [addLoading, setAddLoading] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState(defaultDepartments);

  useEffect(() => {
    let cancelled = false;
    async function loadDepts() {
      try {
        const res = await api.get("/form-options", { skipAuthExpiredHandler: true });
        if (cancelled) return;
        const depts = Array.isArray(res.data?.departments)
          ? res.data.departments.map((i) => i.label).filter(Boolean)
          : [];
        setDepartmentOptions(depts.length ? depts : defaultDepartments);
      } catch (err) {
        if (!cancelled) setDepartmentOptions(defaultDepartments);
      }
    }
    loadDepts();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!showModal || !addForm.department) {
      setAddPersons([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      async function load() {
        setAddLoading(true);
        try {
          const params = { department: addForm.department, pageSize: 200 };
          if (addForm.search) params.keyword = addForm.search;
          const res = await api.get("/datahub/basic-persons/stored", { params });
          if (cancelled) return;
          setAddPersons(Array.isArray(res.data?.rows) ? res.data.rows : []);
        } catch (err) {
          if (!cancelled) setAddPersons([]);
        } finally {
          if (!cancelled) setAddLoading(false);
        }
      }
      load();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [showModal, addForm.department, addForm.search]);

  const filteredRows = useMemo(
    () => roleRows.filter((r) => r.role === "super_admin" || r.role === "admin" || r.role === "liaison"),
    [roleRows]
  );

  function openModal() {
    setAddForm({ role: "liaison", department: "", search: "", personId: "" });
    setAddPersons([]);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setAddForm({ role: "liaison", department: "", search: "", personId: "" });
    setAddPersons([]);
  }

  async function confirmAdd() {
    if (!addForm.personId || !addForm.department) return;
    setAddSaving(true);
    setRoleError("");
    try {
      await api.patch(`/admin/persons/${addForm.personId}`, {
        role: addForm.role,
        department: addForm.department
      });
      closeModal();
      onLoadRoles();
    } catch (err) {
      setRoleError(err.response?.data?.message || "添加失败");
    } finally {
      setAddSaving(false);
    }
  }

  const selectedPerson = addPersons.find((p) => p.id === addForm.personId);

  return (
    <div className="space-y-4">
      <section className="app-card mesh-hero p-5">
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="ai-chip mb-4">
              <Settings2 size={14} className="mr-1.5" />
              角色与权限管理
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-ai-title">角色管理</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
              管理具有特殊权限的人员角色，以及授权其他管理员进行角色管理。
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={openModal} className="primary-button">
              <UserPlus size={16} />
              新增联络员
            </button>
            <button type="button" onClick={onLoadRoles} disabled={roleLoading} className="ghost-button bg-white/80">
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
        </div>
      </section>

      {roleError ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{roleError}</div>
      ) : null}

      <section className="app-card overflow-hidden p-0">
        <div className="border-b border-ai-border px-4 py-4 sm:px-5">
          <h2 className="text-xl font-semibold text-ai-title">权限人员列表</h2>
          <p className="mt-1 text-sm text-ai-body">仅显示管理员、联络员及超级管理员。修改后点击保存生效。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="soft-table w-full min-w-[640px]">
            <thead>
              <tr>
                <th>姓名</th>
                <th>人员编号</th>
                <th>部门</th>
                <th>角色</th>
                <th>角色管理权限</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roleLoading ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-ai-body">加载中...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-ai-body">暂无权限人员</td></tr>
              ) : (
                filteredRows.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <div className="font-semibold text-ai-title">{labelFor(person.name)}</div>
                      <div className="mt-1 max-w-[140px] truncate text-xs text-ai-muted">{person.id}</div>
                    </td>
                    <td className="text-sm">{labelFor(person.union_id)}</td>
                    <td>
                      <input
                        value={person.department || ""}
                        onChange={(e) => setRoleRows((rows) => rows.map((r) => (r.id === person.id ? { ...r, department: e.target.value } : r)))}
                        className="soft-input h-9 w-full max-w-[160px] text-sm"
                        placeholder="部门"
                      />
                    </td>
                    <td>
                      <select
                        value={person.role || "user"}
                        onChange={(e) => setRoleRows((rows) => rows.map((r) => (r.id === person.id ? { ...r, role: e.target.value } : r)))}
                        className="soft-input h-9 w-full min-w-[110px] text-sm"
                      >
                        <option value="user">普通用户</option>
                        <option value="liaison">联络员</option>
                        <option value="admin">管理员</option>
                        <option value="super_admin">超级管理员</option>
                      </select>
                    </td>
                    <td>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(person.can_manage_roles)}
                          onChange={(e) => setRoleRows((rows) => rows.map((r) => (r.id === person.id ? { ...r, can_manage_roles: e.target.checked ? 1 : 0 } : r)))}
                          className="h-4 w-4 accent-ai-primary"
                        />
                        可管理角色
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onSaveRole(person)}
                        disabled={roleSaving === person.id}
                        className="primary-button h-9 px-4 text-xs"
                      >
                        {roleSaving === person.id ? "保存中..." : "保存"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="motion-popover w-full max-w-[540px] rounded-[24px] border border-white/80 bg-white/95 p-6 shadow-[0_28px_80px_rgba(17,17,17,0.16)] backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-ai-title">新增联络员</h2>
              <button onClick={closeModal} className="flex h-9 w-9 items-center justify-center rounded-xl text-ai-muted hover:bg-ai-bg hover:text-ai-title">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ai-body">权限类型</label>
                <select
                  value={addForm.role}
                  onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value, personId: "" }))}
                  className="soft-input h-10 w-full text-sm"
                >
                  <option value="liaison">联络员</option>
                  <option value="admin">管理员</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ai-body">所属部门</label>
                <select
                  value={addForm.department}
                  onChange={(e) => setAddForm((f) => ({ ...f, department: e.target.value, search: "", personId: "" }))}
                  className="soft-input h-10 w-full text-sm"
                >
                  <option value="">请选择部门</option>
                  {departmentOptions.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              {addForm.department ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ai-body">选择人员</label>
                  <div className="mb-3 flex h-10 items-center gap-2 rounded-xl border border-ai-border bg-white px-3">
                    <Search size={16} className="text-ai-muted shrink-0" />
                    <input
                      value={addForm.search}
                      onChange={(e) => setAddForm((f) => ({ ...f, search: e.target.value }))}
                      className="h-full w-full border-0 bg-transparent text-sm outline-none"
                      placeholder="输入姓名检索..."
                    />
                  </div>

                  {addLoading ? (
                    <div className="py-6 text-center text-sm text-ai-body">加载中...</div>
                  ) : addPersons.length === 0 ? (
                    <div className="py-6 text-center text-sm text-ai-body">该部门暂无可分配人员</div>
                  ) : (
                    <div className="max-h-[240px] space-y-1 overflow-y-auto rounded-xl border border-ai-border bg-ai-bg p-1">
                      {addPersons.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setAddForm((f) => ({ ...f, personId: p.id }))}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition duration-200 ${
                            addForm.personId === p.id
                              ? "bg-ai-primary/10 text-ai-primary"
                              : "text-ai-body hover:bg-white"
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-ai-title">{labelFor(p.name)}</div>
                            <div className="mt-0.5 text-xs text-ai-muted">{p.id}</div>
                          </div>
                          {p.role !== "user" ? (
                            <span className="rounded-full bg-ai-bg px-2 py-0.5 text-xs font-medium text-ai-muted ring-1 ring-ai-border">
                              {ROLE_LABELS[p.role] || p.role}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {selectedPerson ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                  <span className="font-semibold text-emerald-800">{selectedPerson.name}</span>
                  <span className="text-emerald-700"> 将被设为 {addForm.department} {addForm.role === "liaison" ? "联络员" : "管理员"}</span>
                </div>
              ) : null}

              <button
                type="button"
                onClick={confirmAdd}
                disabled={!addForm.personId || !addForm.department || addSaving}
                className="primary-button h-11 w-full justify-center disabled:opacity-60"
              >
                {addSaving ? "保存中..." : "确认分配"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default RoleManager;
