import React, { useEffect, useState } from "react";
import { Plus, Save, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";

const departmentTypes = ["职能处室", "教学科研机构"];

export default function FormConfigManager({ view } = {}) {
  const [fields, setFields] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [fieldDraft, setFieldDraft] = useState({ label: "", label_en: "" });
  const [deptDraft, setDeptDraft] = useState({ name: "", name_en: "", type: departmentTypes[0] });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");
  const [fieldPage, setFieldPage] = useState(1);
  const [deptPage, setDeptPage] = useState(1);
  const pageSize = 15;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [fieldRes, deptRes] = await Promise.all([
        api.get("/admin/form-options"),
        api.get("/admin/departments", { params: { includeInactive: "1" } })
      ]);
      setFields(Array.isArray(fieldRes.data?.fields) ? fieldRes.data.fields : []);
      setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
    } catch (err) {
      setError(err.response?.data?.message || "配置加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // --- Field operations ---
  function updateField(id, patch) {
    setFields((cur) => cur.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function addField() {
    if (!fieldDraft.label.trim()) return;
    setSavingKey("field:new");
    setError("");
    try {
      await api.post("/admin/form-options", {
        category: "fields",
        label: fieldDraft.label.trim(),
        label_en: fieldDraft.label_en.trim()
      });
      setFieldDraft({ label: "", label_en: "" });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "新增失败");
    } finally {
      setSavingKey("");
    }
  }

  async function saveField(item) {
    setSavingKey(`field:${item.id}`);
    setError("");
    try {
      await api.patch(`/admin/form-options/${item.id}`, {
        label: item.label.trim(),
        label_en: (item.label_en || "").trim(),
        is_active: Boolean(item.is_active)
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "保存失败");
    } finally {
      setSavingKey("");
    }
  }

  async function removeField(id) {
    setSavingKey(`field:${id}`);
    setError("");
    try {
      await api.delete(`/admin/form-options/${id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "删除失败");
    } finally {
      setSavingKey("");
    }
  }

  // --- Department operations ---
  function updateDept(id, patch) {
    setDepartments((cur) => cur.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function addDept() {
    if (!deptDraft.name.trim()) return;
    setSavingKey("dept:new");
    setError("");
    try {
      await api.post("/admin/departments", {
        name: deptDraft.name.trim(),
        name_en: deptDraft.name_en.trim(),
        type: deptDraft.type
      });
      setDeptDraft({ name: "", name_en: "", type: departmentTypes[0] });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "新增失败");
    } finally {
      setSavingKey("");
    }
  }

  async function saveDept(item) {
    setSavingKey(`dept:${item.id}`);
    setError("");
    try {
      await api.patch(`/admin/departments/${item.id}`, {
        name: item.name.trim(),
        name_en: (item.name_en || "").trim(),
        type: item.type,
        is_active: Boolean(item.is_active)
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "保存失败");
    } finally {
      setSavingKey("");
    }
  }

  async function removeDept(id) {
    setSavingKey(`dept:${id}`);
    setError("");
    try {
      await api.delete(`/admin/departments/${id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "删除失败");
    } finally {
      setSavingKey("");
    }
  }

  const totalCount = fields.length + departments.length;

  const showFields = !view || view === "fields";
  const showDepts = !view || view === "departments";

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">{error}</div>
      ) : null}

      <div className={`grid gap-4 ${showFields && showDepts ? "xl:grid-cols-2" : ""}`}>
        {showFields ? (
        <section className="app-card overflow-hidden p-0">
          <div className="border-b border-ai-border px-4 py-4 sm:px-5">
            <h2 className="text-xl font-semibold text-ai-title">事项领域</h2>
            <p className="mt-1 text-sm text-ai-body">用于表单里的事项领域单选项。</p>
          </div>
          <div className="border-b border-ai-border px-4 py-4 sm:px-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                value={fieldDraft.label}
                onChange={(e) => setFieldDraft((draft) => ({ ...draft, label: e.target.value }))}
                placeholder="新增事项领域（中文名称）"
                className="soft-input h-10"
              />
              <input
                value={fieldDraft.label_en}
                onChange={(e) => setFieldDraft((draft) => ({ ...draft, label_en: e.target.value }))}
                placeholder="英文页面显示名，例如 Academic Affairs"
                className="soft-input h-10 flex-1"
              />
              <button type="button" onClick={addField} disabled={savingKey === "field:new"} className="primary-button h-10 px-4">
                <Plus size={16} />
                添加
              </button>
            </div>
          </div>
          <div className="divide-y divide-ai-border">
            {loading ? (
              <div className="px-6 py-8 text-sm text-ai-body">加载中...</div>
            ) : fields.length ? (
              fields.slice((fieldPage - 1) * pageSize, fieldPage * pageSize).map((item) => (
                <div key={item.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_80px_92px] lg:items-center">
                  <input value={item.label} onChange={(e) => updateField(item.id, { label: e.target.value })} className="soft-input h-10" placeholder="中文名称" />
                  <input value={item.label_en || ""} onChange={(e) => updateField(item.id, { label_en: e.target.value })} className="soft-input h-10" placeholder="英文页面显示名" />
                  <label className="flex h-10 items-center gap-2 text-sm text-ai-body">
                    <input type="checkbox" checked={Boolean(item.is_active)} onChange={(e) => updateField(item.id, { is_active: e.target.checked })} className="h-4 w-4 accent-ai-primary" />
                    启用
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => saveField(item)} disabled={savingKey === `field:${item.id}`} className="secondary-button h-10 w-10 px-0" title="保存"><Save size={16} /></button>
                    <button type="button" onClick={() => removeField(item.id)} disabled={savingKey === `field:${item.id}`} className="ghost-button h-10 w-10 px-0 text-rose-600 hover:bg-rose-50" title="删除"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-sm text-ai-body">暂无配置</div>
            )}
          </div>
          {fields.length > pageSize ? (
            <div className="flex items-center justify-between border-t border-ai-border px-4 py-3 text-sm text-ai-body">
              <span className="text-xs text-ai-muted">共 {fields.length} 项</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setFieldPage(p => p - 1)} disabled={fieldPage <= 1} className="rounded-lg p-1.5 transition hover:bg-ai-bg disabled:opacity-30"><ChevronLeft size={14} /></button>
                <span className="min-w-[3rem] text-center text-xs font-medium text-ai-title">{fieldPage}/{Math.ceil(fields.length / pageSize)}</span>
                <button onClick={() => setFieldPage(p => p + 1)} disabled={fieldPage >= Math.ceil(fields.length / pageSize)} className="rounded-lg p-1.5 transition hover:bg-ai-bg disabled:opacity-30"><ChevronRight size={14} /></button>
              </div>
            </div>
          ) : null}
        </section>
        ) : null}

        {showDepts ? (
        <section className="app-card overflow-hidden p-0">
          <div className="border-b border-ai-border px-4 py-4 sm:px-5">
            <h2 className="text-xl font-semibold text-ai-title">部门</h2>
            <p className="mt-1 text-sm text-ai-body">用于表单里的部门选择，分为职能处室和教学科研机构。</p>
          </div>
          <div className="border-b border-ai-border px-4 py-4 sm:px-5">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto]">
              <input
                value={deptDraft.name}
                onChange={(e) => setDeptDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="新增部门（中文名称）"
                className="soft-input h-10"
              />
              <input
                value={deptDraft.name_en}
                onChange={(e) => setDeptDraft((d) => ({ ...d, name_en: e.target.value }))}
                placeholder="英文页面显示名，例如 IT & Data Services"
                className="soft-input h-10"
              />
              <select
                value={deptDraft.type}
                onChange={(e) => setDeptDraft((d) => ({ ...d, type: e.target.value }))}
                className="soft-input h-10 w-36"
              >
                {departmentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button type="button" onClick={addDept} disabled={savingKey === "dept:new"} className="primary-button h-10 px-4">
                <Plus size={16} />
                添加
              </button>
            </div>
          </div>
          <div className="divide-y divide-ai-border">
            {loading ? (
              <div className="px-6 py-8 text-sm text-ai-body">加载中...</div>
            ) : departments.length ? (
              departments.slice((deptPage - 1) * pageSize, deptPage * pageSize).map((item) => (
                <div key={item.id} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_80px_92px] lg:items-center">
                  <input value={item.name} onChange={(e) => updateDept(item.id, { name: e.target.value })} className="soft-input h-10" placeholder="中文名称" />
                  <input value={item.name_en || ""} onChange={(e) => updateDept(item.id, { name_en: e.target.value })} className="soft-input h-10" placeholder="英文页面显示名" />
                  <select value={item.type} onChange={(e) => updateDept(item.id, { type: e.target.value })} className="soft-input h-10">
                    {departmentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <label className="flex h-10 items-center gap-2 text-sm text-ai-body">
                    <input type="checkbox" checked={Boolean(item.is_active)} onChange={(e) => updateDept(item.id, { is_active: e.target.checked })} className="h-4 w-4 accent-ai-primary" />
                    启用
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => saveDept(item)} disabled={savingKey === `dept:${item.id}`} className="secondary-button h-10 w-10 px-0" title="保存"><Save size={16} /></button>
                    <button type="button" onClick={() => removeDept(item.id)} disabled={savingKey === `dept:${item.id}`} className="ghost-button h-10 w-10 px-0 text-rose-600 hover:bg-rose-50" title="删除"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-sm text-ai-body">暂无配置</div>
            )}
          </div>
          {departments.length > pageSize ? (
            <div className="flex items-center justify-between border-t border-ai-border px-4 py-3 text-sm text-ai-body">
              <span className="text-xs text-ai-muted">共 {departments.length} 项</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setDeptPage(p => p - 1)} disabled={deptPage <= 1} className="rounded-lg p-1.5 transition hover:bg-ai-bg disabled:opacity-30"><ChevronLeft size={14} /></button>
                <span className="min-w-[3rem] text-center text-xs font-medium text-ai-title">{deptPage}/{Math.ceil(departments.length / pageSize)}</span>
                <button onClick={() => setDeptPage(p => p + 1)} disabled={deptPage >= Math.ceil(departments.length / pageSize)} className="rounded-lg p-1.5 transition hover:bg-ai-bg disabled:opacity-30"><ChevronRight size={14} /></button>
              </div>
            </div>
          ) : null}
        </section>
        ) : null}
      </div>

      {showFields && showDepts ? (
        <div className="text-sm text-ai-muted">当前共 {totalCount} 项配置（{fields.length} 个领域，{departments.length} 个部门）。</div>
      ) : showFields ? (
        <div className="text-sm text-ai-muted">当前共 {fields.length} 个事项领域。</div>
      ) : (
        <div className="text-sm text-ai-muted">当前共 {departments.length} 个部门。</div>
      )}
    </div>
  );
}
