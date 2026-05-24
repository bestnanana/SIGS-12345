import React, { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { api } from "../api";

const categoryMeta = {
  fields: {
    title: "事项领域",
    placeholder: "新增事项领域"
  },
  departments: {
    title: "部门",
    placeholder: "新增部门"
  }
};

function cloneGroups(groups) {
  return {
    fields: Array.isArray(groups?.fields) ? groups.fields : [],
    departments: Array.isArray(groups?.departments) ? groups.departments : []
  };
}

export default function FormConfigManager() {
  const [groups, setGroups] = useState({ fields: [], departments: [] });
  const [drafts, setDrafts] = useState({
    fields: { label: "", sort_order: 0 },
    departments: { label: "", sort_order: 0 }
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");

  const flatCount = useMemo(() => groups.fields.length + groups.departments.length, [groups]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/form-options");
      setGroups(cloneGroups(res.data));
    } catch (err) {
      setError(err.response?.data?.message || "配置加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateItem(category, id, patch) {
    setGroups((current) => ({
      ...current,
      [category]: current[category].map((item) => (item.id === id ? { ...item, ...patch } : item))
    }));
  }

  async function addItem(category) {
    const draft = drafts[category];
    if (!draft.label.trim()) return;
    const key = `${category}:new`;
    setSavingKey(key);
    setError("");
    try {
      await api.post("/admin/form-options", {
        category,
        label: draft.label.trim(),
        sort_order: Number(draft.sort_order) || 0
      });
      setDrafts((current) => ({
        ...current,
        [category]: { label: "", sort_order: 0 }
      }));
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "新增失败");
    } finally {
      setSavingKey("");
    }
  }

  async function saveItem(category, item) {
    setSavingKey(`${category}:${item.id}`);
    setError("");
    try {
      await api.patch(`/admin/form-options/${item.id}`, {
        label: item.label.trim(),
        sort_order: Number(item.sort_order) || 0,
        is_active: Boolean(item.is_active)
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "保存失败");
    } finally {
      setSavingKey("");
    }
  }

  async function removeItem(category, id) {
    setSavingKey(`${category}:${id}`);
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

  return (
    <div className="space-y-6">
      <section className="app-card mesh-hero p-8">
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="ai-chip mb-4">后台配置</div>
            <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">事项领域与部门</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">这里维护表单里可选的事项领域和部门，新增后会直接出现在提诉表单里。</p>
          </div>
          <button type="button" onClick={load} className="ghost-button bg-white/80">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {Object.entries(categoryMeta).map(([category, meta]) => (
          <section key={category} className="app-card overflow-hidden p-0">
            <div className="border-b border-ai-border px-6 py-5">
              <h2 className="text-xl font-semibold text-ai-title">{meta.title}</h2>
              <p className="mt-1 text-sm text-ai-body">{category === "fields" ? "用于表单里的事项领域单选项。" : "用于表单里的部门单选项。"}</p>
            </div>

            <div className="border-b border-ai-border px-6 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={drafts[category].label}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [category]: { ...current[category], label: e.target.value }
                    }))
                  }
                  placeholder={meta.placeholder}
                  className="soft-input h-10 flex-1 min-w-[220px]"
                />
                <input
                  type="number"
                  value={drafts[category].sort_order}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [category]: { ...current[category], sort_order: e.target.value }
                    }))
                  }
                  className="soft-input h-10 w-24"
                  placeholder="顺序"
                />
                <button
                  type="button"
                  onClick={() => addItem(category)}
                  disabled={savingKey === `${category}:new`}
                  className="primary-button h-10 px-4"
                >
                  <Plus size={16} />
                  添加
                </button>
              </div>
            </div>

            <div className="divide-y divide-ai-border">
              {loading ? (
                <div className="px-6 py-8 text-sm text-ai-body">加载中...</div>
              ) : groups[category].length ? (
                groups[category].map((item) => (
                  <div key={item.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[1fr_120px_96px_184px] lg:items-center">
                    <input
                      value={item.label}
                      onChange={(e) => updateItem(category, item.id, { label: e.target.value })}
                      className="soft-input h-10"
                    />
                    <input
                      type="number"
                      value={item.sort_order}
                      onChange={(e) => updateItem(category, item.id, { sort_order: e.target.value })}
                      className="soft-input h-10"
                    />
                    <label className="flex h-10 items-center gap-2 text-sm text-ai-body">
                      <input
                        type="checkbox"
                        checked={Boolean(item.is_active)}
                        onChange={(e) => updateItem(category, item.id, { is_active: e.target.checked })}
                        className="h-4 w-4 accent-ai-primary"
                      />
                      启用
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => saveItem(category, item)}
                        disabled={savingKey === `${category}:${item.id}`}
                        className="secondary-button h-10 px-4"
                      >
                        <Save size={16} />
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(category, item.id)}
                        disabled={savingKey === `${category}:${item.id}`}
                        className="ghost-button h-10 px-4 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 size={16} />
                        删除
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-6 py-8 text-sm text-ai-body">暂无配置</div>
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="text-sm text-ai-muted">当前共 {flatCount} 项配置。</div>
    </div>
  );
}
