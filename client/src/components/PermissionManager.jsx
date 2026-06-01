import React, { useEffect, useState, useCallback } from "react";
import { Shield, Plus, Search, X, Edit3, Trash2, Power, RefreshCw } from "lucide-react";
import { api } from "../api";

const ROLE_LABELS = { admin: "部门管理员", observer: "观察员" };

function PermissionManager() {
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
      setError(err.response?.data?.message || "加载失败");
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
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await api.get("/admin/department-admins/search", {
          params: { keyword: searchKeyword, pageSize: 20 }
        });
        if (!cancelled) setSearchResults(res.data.rows || []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [showModal, editId, searchKeyword]);

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
      return { ...f, managed_departments: arr };
    });
  }

  async function handleSave() {
    if (!editId && !form.person_id) { setError("请选择人员"); return; }
    if (form.managed_departments.length === 0) { setError("请至少选择一个管理部门"); return; }
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
      setError(err.response?.data?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(item) {
    try {
      await api.patch(`/admin/department-admins/${item.id}/toggle`, { is_enabled: !item.is_enabled });
      loadList();
    } catch (err) {
      setError(err.response?.data?.message || "操作失败");
    }
  }

  async function handleDelete(item) {
    if (!confirm(`确认删除 ${item.person_name} 的授权？`)) return;
    try {
      await api.delete(`/admin/department-admins/${item.id}`);
      loadList();
    } catch (err) {
      setError(err.response?.data?.message || "删除失败");
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
              授权管理
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-ai-title">部门管理员权限配置</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
              为人员分配管理部门，支持多部门管辖、观察员角色和转办限制。
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={openCreate} className="primary-button">
              <Plus size={16} />
              新增授权
            </button>
            <button type="button" onClick={loadList} disabled={loading} className="ghost-button bg-white/80">
              <RefreshCw size={16} />
              刷新
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
          {error}
          <button onClick={() => setError("")} className="ml-2 underline">关闭</button>
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
            placeholder="搜索姓名/工号..."
          />
        </div>
        <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setPage(1); }} className="soft-input h-10 text-sm">
          <option value="">全部角色</option>
          <option value="admin">部门管理员</option>
          <option value="observer">观察员</option>
        </select>
        <select value={filterEnabled} onChange={e => { setFilterEnabled(e.target.value); setPage(1); }} className="soft-input h-10 text-sm">
          <option value="">全部状态</option>
          <option value="1">已启用</option>
          <option value="0">已禁用</option>
        </select>
      </div>

      {/* List */}
      <section className="app-card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="soft-table w-full min-w-[700px]">
            <thead>
              <tr>
                <th>姓名</th>
                <th>原部门</th>
                <th>管理部门</th>
                <th>角色</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-ai-body">加载中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-ai-body">暂无授权记录</td></tr>
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
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${item.role_type === "admin" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                        {ROLE_LABELS[item.role_type] || item.role_type}
                      </span>
                    </td>
                    <td>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${item.is_enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {item.is_enabled ? "已启用" : "已禁用"}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(item)} className="ghost-button h-8 w-8 p-0" title="编辑"><Edit3 size={14} /></button>
                        <button onClick={() => handleToggle(item)} className="ghost-button h-8 w-8 p-0" title={item.is_enabled ? "禁用" : "启用"}>
                          <Power size={14} className={item.is_enabled ? "text-amber-600" : "text-emerald-600"} />
                        </button>
                        <button onClick={() => handleDelete(item)} className="ghost-button h-8 w-8 p-0 text-red-500" title="删除"><Trash2 size={14} /></button>
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
            <span>共 {total} 条</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="ghost-button h-8 px-3 text-xs disabled:opacity-40">上一页</button>
              <span className="flex h-8 items-center px-3 text-xs text-ai-title">{page}</span>
              <button disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)} className="ghost-button h-8 px-3 text-xs disabled:opacity-40">下一页</button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Modal */}
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="motion-popover w-full max-w-[600px] max-h-[90vh] overflow-y-auto rounded-[24px] border border-white/80 bg-white/95 p-6 shadow-[0_28px_80px_rgba(17,17,17,0.16)] backdrop-blur-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-ai-title">{editId ? "编辑授权" : "新增授权"}</h2>
              <button onClick={closeModal} className="flex h-9 w-9 items-center justify-center rounded-xl text-ai-muted hover:bg-ai-bg hover:text-ai-title">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              {/* Person search (only for create) */}
              {!editId ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ai-body">搜索人员</label>
                  <div className="mb-3 flex h-10 items-center gap-2 rounded-xl border border-ai-border bg-white px-3">
                    <Search size={16} className="text-ai-muted shrink-0" />
                    <input
                      value={searchKeyword}
                      onChange={e => { setSearchKeyword(e.target.value); setForm(f => ({ ...f, person_id: "", person_name: "" })); }}
                      className="h-full w-full border-0 bg-transparent text-sm outline-none"
                      placeholder="输入姓名或工号搜索..."
                    />
                  </div>
                  {searchLoading ? (
                    <div className="py-4 text-center text-sm text-ai-body">搜索中...</div>
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
                    <div className="py-4 text-center text-sm text-ai-body">未找到匹配人员</div>
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
                  <div className="text-sm text-ai-muted">人员</div>
                  <div className="mt-1 font-semibold text-ai-title">{form.person_name}</div>
                  <div className="mt-0.5 text-xs text-ai-muted">工号: {form.person_union_id || ""}</div>
                </div>
              )}

              {/* Managed departments */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ai-body">管辖部门（可多选）</label>
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
                        <button onClick={() => toggleDept(d)} className="hover:text-red-500"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (!editId && !form.person_id) || form.managed_departments.length === 0}
                className="primary-button h-11 w-full justify-center disabled:opacity-60"
              >
                {saving ? "保存中..." : "确认保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PermissionManager;
