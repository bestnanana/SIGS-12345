import React, { useEffect, useState, useCallback } from "react";
import { Shield, Plus, Search, X, Edit3, Trash2, Power, RefreshCw, Crown } from "lucide-react";
import { api } from "../api";
import { useLanguage } from "../i18n";

function PermissionManager() {
  const { t } = useLanguage();
  const roleLabels = { admin: t("role.dept_admin") };
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterEnabled, setFilterEnabled] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // departments for checkboxes
  const [departments, setDepartments] = useState([]);

  // modal state
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({
    person_id: "",
    person_name: "",
    person_union_id: "",
    managed_departments: [],
  });
  // person search
  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, pageSize };
      if (keyword) params.keyword = keyword;
      if (filterRole) params.role_type = filterRole;
      if (filterEnabled !== "") params.is_enabled = filterEnabled;
      const res = await api.get("/admin/department-admins", { params });
      setItems(res.data.rows || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      setError(err.response?.data?.message || t("admin.operationFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterRole, filterEnabled]);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    let cancelled = false;
    api.get("/departments", { skipAuthExpiredHandler: true })
      .then(res => {
        if (cancelled) return;
        const groups = res.data || {};
        const allDepts = [];
        for (const depts of Object.values(groups)) {
          if (Array.isArray(depts)) depts.forEach(d => allDepts.push(d.name));
        }
        setDepartments(allDepts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // person search in modal
  useEffect(() => {
    if (!showModal || editId) return; // don't search when editing
    if (form.managed_departments.length === 0) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.get("/admin/department-admins/search", {
          params: {
            keyword: searchKeyword,
            department_names: form.managed_departments.join(","),
            pageSize: 20
          }
        });
        if (!cancelled) setSearchResults(res.data.rows || []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [showModal, editId, searchKeyword, form.managed_departments]);

  function openCreate() {
    setEditId(null);
    setForm({ person_id: "", person_name: "", person_union_id: "", managed_departments: [] });
    setSearchKeyword("");
    setSearchResults([]);
    setShowModal(true);
  }

  async function openEdit(item) {
    setEditId(item.id);
    setForm({
      person_id: item.person_id,
      person_name: item.person_name,
      person_union_id: item.person_union_id || "",
      managed_departments: item.managed_departments || [],
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditId(null);
  }

  function toggleDept(dept) {
    setForm(f => {
      const arr = f.managed_departments.includes(dept)
        ? f.managed_departments.filter(d => d !== dept)
        : [...f.managed_departments, dept];
      return { ...f, managed_departments: arr, person_id: editId ? f.person_id : "", person_name: editId ? f.person_name : "", person_union_id: editId ? f.person_union_id : "" };
    });
    if (!editId) {
      setSearchResults([]);
      setSearchKeyword("");
    }
  }

  async function handleSave() {
    if (!editId && !form.person_id) { setError(t("admin.selectPerson")); return; }
    if (form.managed_departments.length === 0) { setError(t("admin.selectManagedDepartment")); return; }
    setSaving(true);
    setError("");
    try {
      const body = {
        role_type: "admin",
        department_names: form.managed_departments,
      };
      if (editId) {
        await api.put(`/admin/department-admins/${editId}`, body);
      } else {
        body.person_id = form.person_id;
        await api.post("/admin/department-admins", body);
      }
      closeModal();
      loadList();
    } catch (err) {
      setError(err.response?.data?.message || t("admin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(item) {
    try {
      await api.patch(`/admin/department-admins/${item.id}/toggle`, { is_enabled: !item.is_enabled });
      loadList();
    } catch (err) {
      setError(err.response?.data?.message || t("admin.operationFailed"));
    }
  }

  async function handleDelete(item) {
    if (!confirm(t("admin.confirmDeletePermission", { name: item.person_name }))) return;
    try {
      await api.delete(`/admin/department-admins/${item.id}`);
      loadList();
    } catch (err) {
      setError(err.response?.data?.message || t("admin.deleteFailed"));
    }
  }

  async function handlePromoteSuperAdmin(item) {
    if (!confirm(t("admin.confirmPromoteSuperAdmin", { name: item.person_name || item.person_id }))) return;
    try {
      await api.post(`/admin/department-admins/${item.id}/promote-super-admin`);
      loadList();
    } catch (err) {
      setError(err.response?.data?.message || t("admin.promoteFailed"));
    }
  }

  // group departments by type for display
  const deptGroups = {};
  for (const d of departments) {
    // departments from /api/departments come as grouped, but we flattened them
    // We'll just show all in one list with type indicators
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="app-card mesh-hero p-5">
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="ai-chip mb-4">
              <Shield size={14} className="mr-1.5" />
              {t("admin.menuPermissions")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-ai-title">{t("admin.permissionsTitle")}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
              {t("admin.permissionsDesc")}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={openCreate} className="primary-button">
              <Plus size={16} />
              {t("admin.createPermission")}
            </button>
            <button type="button" onClick={loadList} disabled={loading} className="ghost-button bg-white/80">
              <RefreshCw size={16} />
              {t("action.refresh")}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
          <button onClick={() => setError("")} className="ml-2 underline">{t("action.close")}</button>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 items-center gap-2 rounded-xl border border-ai-border bg-white px-3">
          <Search size={16} className="text-ai-muted shrink-0" />
          <input
            value={keyword}
            onChange={e => { setKeyword(e.target.value); setPage(1); }}
            className="h-full w-40 border-0 bg-transparent text-sm outline-none"
            placeholder={t("admin.searchNameOrId")}
          />
        </div>
        <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1); }} className="soft-input h-10 text-sm">
          <option value="">{t("admin.allRoles")}</option>
          <option value="admin">{t("role.dept_admin")}</option>
        </select>
        <select value={filterEnabled} onChange={e => { setFilterEnabled(e.target.value); setPage(1); }} className="soft-input h-10 text-sm">
          <option value="">{t("admin.allStatuses")}</option>
          <option value="1">{t("admin.enabled")}</option>
          <option value="0">{t("admin.disabled")}</option>
        </select>
      </div>

      {/* List */}
      <section className="app-card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="soft-table w-full min-w-[700px]">
            <thead>
              <tr>
                <th>{t("admin.name")}</th>
                <th>{t("admin.originalDepartment")}</th>
                <th>{t("admin.managedDepartment")}</th>
                <th>{t("admin.role")}</th>
                <th>{t("admin.statusHandling")}</th>
                <th>{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-ai-body">{t("common.loading")}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-ai-body">{t("admin.noPermissionRecords")}</td></tr>
              ) : (
                items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div className="font-semibold text-ai-title">{item.person_name || item.person_id}</div>
                      <div className="mt-0.5 text-xs text-ai-muted">{item.person_union_id || ""}</div>
                    </td>
                    <td className="text-sm">{item.person_department || "-"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(item.managed_departments || []).map(d => (
                          <span key={d} className="inline-block rounded-full bg-ai-primary/10 px-2 py-0.5 text-xs font-medium text-ai-primary">{d}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {roleLabels[item.role_type] || t("role.dept_admin")}
                      </span>
                    </td>
                    <td>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${item.is_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {item.is_enabled ? t("admin.enabled") : t("admin.disabled")}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(item)} className="ghost-button h-8 w-8 p-0" title={t("action.edit")}><Edit3 size={14} /></button>
                        <button onClick={() => handleToggle(item)} className="ghost-button h-8 w-8 p-0" title={item.is_enabled ? t("action.disable") : t("action.enable")}>
                          <Power size={14} className={item.is_enabled ? "text-amber-600" : "text-emerald-600"} />
                        </button>
                        <button onClick={() => handlePromoteSuperAdmin(item)} className="ghost-button h-8 w-8 p-0 text-purple-600" title={t("admin.promoteSuperAdmin")}><Crown size={14} /></button>
                        <button onClick={() => handleDelete(item)} className="ghost-button h-8 w-8 p-0 text-red-500" title={t("action.delete")}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize ? (
          <div className="flex items-center justify-between border-t border-ai-border px-5 py-3 text-sm text-ai-body">
            <span>{t("admin.totalRows", { count: total })}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="ghost-button h-8 px-3 text-xs disabled:opacity-40">{t("admin.prevPage")}</button>
              <span className="flex h-8 items-center px-3 text-xs text-ai-title">{page}</span>
              <button disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)} className="ghost-button h-8 px-3 text-xs disabled:opacity-40">{t("admin.nextPage")}</button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Modal */}
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="motion-popover w-full max-w-[600px] max-h-[90vh] overflow-y-auto rounded-[24px] border border-white/80 bg-white/95 p-6 shadow-[0_28px_80px_rgba(17,17,17,0.16)] backdrop-blur-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-ai-title">{editId ? t("admin.editPermission") : t("admin.createPermission")}</h2>
              <button onClick={closeModal} className="flex h-9 w-9 items-center justify-center rounded-xl text-ai-muted hover:bg-ai-bg hover:text-ai-title">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              {/* Managed departments */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ai-body">
                  {editId ? t("admin.managedDepartmentsMulti") : t("admin.stepChooseDepartments")}
                </label>
                <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-xl border border-ai-border bg-ai-bg p-2">
                  {departments.map(dept => (
                    <label key={dept} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.managed_departments.includes(dept)}
                        onChange={() => toggleDept(dept)}
                        className="h-4 w-4 accent-ai-primary"
                      />
                      {dept}
                    </label>
                  ))}
                </div>
                {form.managed_departments.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {form.managed_departments.map(d => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full bg-ai-primary/10 px-2 py-0.5 text-xs font-medium text-ai-primary">
                        {d}
                        <button type="button" onClick={() => toggleDept(d)} className="hover:text-red-500"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Person search (only for create) */}
              {!editId ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ai-body">{t("admin.stepChoosePerson")}</label>
                  <div className="mb-3 flex h-10 items-center gap-2 rounded-xl border border-ai-border bg-white px-3">
                    <Search size={16} className="text-ai-muted shrink-0" />
                    <input
                      value={searchKeyword}
                      onChange={e => { setSearchKeyword(e.target.value); setForm(f => ({ ...f, person_id: "", person_name: "" })); }}
                      className="h-full w-full border-0 bg-transparent text-sm outline-none"
                      placeholder={form.managed_departments.length ? t("admin.searchNameOrId") : t("admin.selectDepartmentsFirst")}
                      disabled={form.managed_departments.length === 0}
                    />
                  </div>
                  {form.managed_departments.length === 0 ? (
                    <div className="rounded-xl bg-ai-bg px-3 py-4 text-center text-sm text-ai-body">{t("admin.selectDepartmentsFirstDesc")}</div>
                  ) : searchLoading ? (
                    <div className="py-4 text-center text-sm text-ai-body">{t("admin.searching")}</div>
                  ) : searchResults.length > 0 ? (
                    <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-xl border border-ai-border bg-ai-bg p-1">
                      {searchResults.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setForm(f => ({ ...f, person_id: p.id, person_name: p.name, person_union_id: p.union_id || "" })); setSearchKeyword(p.name); setSearchResults([]); }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition duration-200 ${
                            form.person_id === p.id ? "bg-ai-primary/10 text-ai-primary" : "text-ai-body hover:bg-white"
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-ai-title">{p.name}</div>
                            <div className="mt-0.5 text-xs text-ai-muted">{p.union_id || ""}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : searchKeyword.trim() && !form.person_name ? (
                    <div className="py-4 text-center text-sm text-ai-body">{t("admin.noMatchedPersons")}</div>
                  ) : null}
                  {form.person_name ? (
                    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                      <span className="font-semibold text-emerald-800">{form.person_name}</span>
                      {form.person_union_id ? <span className="text-emerald-700"> ({form.person_union_id})</span> : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border border-ai-border bg-ai-bg px-4 py-3">
                  <div className="text-sm text-ai-muted">{t("admin.person")}</div>
                  <div className="mt-1 font-semibold text-ai-title">{form.person_name}</div>
                  <div className="mt-0.5 text-xs text-ai-muted">{t("admin.unionId")}: {form.person_union_id || ""}</div>
                </div>
              )}

              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (!editId && !form.person_id) || form.managed_departments.length === 0}
                className="primary-button h-11 w-full justify-center disabled:opacity-60"
              >
                {saving ? t("admin.saving") : t("admin.confirmSave")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PermissionManager;
