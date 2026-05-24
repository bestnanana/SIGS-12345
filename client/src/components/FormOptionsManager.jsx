import React, { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { api } from "../api";

const categoryMeta = {
  fields: {
    title: "浜嬮」棰嗗煙",
    placeholder: "鏂板浜嬮」棰嗗煙"
  },
  departments: {
    title: "閮ㄩ棬绠＄悊",
    placeholder: "鏂板閮ㄩ棬"
  }
};

function emptyOptionDrafts() {
  return {
    fields: "",
    departments: ""
  };
}

export default function FormOptionsManager() {
  const [options, setOptions] = useState({ fields: [], departments: [] });
  const [drafts, setDrafts] = useState(emptyOptionDrafts);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sections = useMemo(() => Object.keys(categoryMeta), []);

  useEffect(() => {
    loadOptions();
  }, []);

  async function loadOptions() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/form-options");
      setOptions({
        fields: Array.isArray(res.data?.fields) ? res.data.fields : [],
        departments: Array.isArray(res.data?.departments) ? res.data.departments : []
      });
    } catch (err) {
      setError(err.response?.data?.message || "配置加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function addOption(category) {
    const label = String(drafts[category] || "").trim();
    if (!label) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/admin/form-options", { category, label, sort_order: options[category]?.length || 0 });
      setDrafts((current) => ({ ...current, [category]: "" }));
      await loadOptions();
    } catch (err) {
      setError(err.response?.data?.message || "新增配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveOption(option) {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/admin/form-options/${option.id}`, {
        label: option.label,
        sort_order: option.sort_order,
        is_active: option.is_active
      });
      await loadOptions();
    } catch (err) {
      setError(err.response?.data?.message || "保存配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeOption(id) {
    setSaving(true);
    setError("");
    try {
      await api.delete(`/admin/form-options/${id}`);
      await loadOptions();
    } catch (err) {
      setError(err.response?.data?.message || "删除配置失败");
    } finally {
      setSaving(false);
    }
  }

  function updateOption(category, id, key, value) {
    setOptions((current) => ({
      ...current,
      [category]: current[category].map((item) => (item.id === id ? { ...item, [key]: value } : item))
    }));
  }

  return (
    <div className="space-y-6">
      <section className="app-card mesh-hero p-8">
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div>
            <div className="ai-chip mb-4">表单配置</div>
            <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">浜嬮」棰嗗煙涓庨儴闂ㄧ鐞?/h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
              这里维护表单里的可选事项领域和部门，新增后会直接出现在提诉表单里。            </p>
          </div>
          <button type="button" onClick={loadOptions} className="ghost-button bg-white/80">
            <RefreshCw size={16} />
            鍒锋柊
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {sections.map((category) => (
          <section key={category} className="app-card p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-ai-title">{categoryMeta[category].title}</h2>
                <p className="mt-1 text-sm text-ai-body">{category === "fields" ? "用于表单里的事项领域单选项。 : "用于表单里的部门单选项。}</p>
              </div>
              <span className="rounded-full bg-ai-primary/10 px-3 py-1 text-xs font-semibold text-ai-primary ring-1 ring-ai-primary/10">
                {options[category].length} 椤?              </span>
            </div>

            <div className="mb-4 flex gap-2">
              <input
                value={drafts[category]}
                onChange={(e) => setDrafts((current) => ({ ...current, [category]: e.target.value }))}
                className="soft-input h-10 flex-1"
                placeholder={categoryMeta[category].placeholder}
              />
              <button
                type="button"
                onClick={() => addOption(category)}
                disabled={saving || !drafts[category].trim()}
                className="primary-button h-10 px-4"
              >
                <Plus size={16} />
                鏂板
              </button>
            </div>

            <div className="space-y-3">
              {loading ? (
                <div className="rounded-2xl bg-ai-bg p-6 text-center text-sm text-ai-body">加载中...</div>
              ) : options[category].length ? (
                options[category].map((option) => (
                  <div key={option.id} className="rounded-2xl border border-ai-border bg-white p-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_92px_120px_auto] md:items-center">
                      <input
                        value={option.label}
                        onChange={(e) => updateOption(category, option.id, "label", e.target.value)}
                        className="soft-input h-10"
                      />
                      <input
                        type="number"
                        value={option.sort_order}
                        onChange={(e) => updateOption(category, option.id, "sort_order", Number(e.target.value))}
                        className="soft-input h-10"
                      />
                      <label className="flex items-center gap-2 text-sm text-ai-body">
                        <input
                          type="checkbox"
                          checked={Boolean(option.is_active)}
                          onChange={(e) => updateOption(category, option.id, "is_active", e.target.checked)}
                          className="h-4 w-4 accent-ai-primary"
                        />
                        鍚敤
                      </label>
                      <div className="flex items-center gap-2 justify-self-start md:justify-self-end">
                        <button
                          type="button"
                          onClick={() => saveOption(option)}
                          disabled={saving}
                          className="secondary-button h-10 px-4"
                        >
                          <Save size={16} />
                          淇濆瓨
                        </button>
                        <button
                          type="button"
                          onClick={() => removeOption(option.id)}
                          disabled={saving}
                          className="ghost-button h-10 px-4 text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 size={16} />
                          鍒犻櫎
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl bg-ai-bg p-6 text-center text-sm text-ai-body">暂无配置</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}


