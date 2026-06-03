import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, FileUp, RotateCcw, Save, SendHorizontal } from "lucide-react";
import { api, uploadConfig } from "../api";
import { defaultDepartments, defaultFields } from "../constants";
import { useLocaleNavigate, useLanguage } from "../i18n";

const acceptTypes = ".txt,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.avi,.mp4";
const departmentTypeLabels = {
  "职能处室": "Administrative Offices",
  "教学科研机构": "Teaching and Research Units"
};

function defaultFieldOptions() {
  return defaultFields.map((label) => ({ label, label_en: "" }));
}

export default function TicketFormPage({ user }) {
  const { t, language } = useLanguage();
  const navigate = useLocaleNavigate();
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);
  const [fieldOptions, setFieldOptions] = useState(defaultFieldOptions);
  const [departmentOptions, setDepartmentOptions] = useState({});
  const [form, setForm] = useState({
    title: '',
    field: defaultFields[0] || '',
    department: '',
    content: '',
    phone: user.phone || '',
    is_anonymous: false
  });

  function displayName(item, nameKey = "label", enKey = "label_en") {
    if (!item) return "";
    if (language === "en" && item[enKey]) return item[enKey];
    return item[nameKey] || "";
  }

  function displayDepartmentType(type) {
    return language === "en" ? (departmentTypeLabels[type] || type) : type;
  }

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      try {
        const res = await api.get('/form-options', { skipAuthExpiredHandler: true });
        const nextFields = Array.isArray(res.data?.fields) ? res.data.fields.filter((item) => item?.label) : [];
        const nextFieldValues = nextFields.map((item) => item.label);
        if (cancelled) return;
        setFieldOptions(nextFields.length ? nextFields : defaultFieldOptions());
        setForm((current) => ({
          ...current,
          field: nextFieldValues.includes(current.field) ? current.field : (nextFieldValues[0] || current.field),
        }));
        const deptRes = await api.get('/departments', { skipAuthExpiredHandler: true });
        if (cancelled) return;
        const grouped = deptRes.data || {};
        setDepartmentOptions(grouped);
        const allDepts = Object.values(grouped).flat().map((d) => d.name);
        setForm((current) => ({
          ...current,
          department: allDepts.includes(current.department) || current.department === '' ? current.department : '',
        }));
      } catch (err) {
        if (!cancelled) {
          setFieldOptions(defaultFieldOptions());
          setDepartmentOptions({});
        }
      }
    }
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ticketDraft");
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || !draft.title) return;
      const restore = window.confirm("检测到上次未提交的表单草稿，是否恢复？");
      if (restore) {
        setForm((prev) => ({
          ...prev,
          title: draft.title || prev.title,
          field: draft.field || prev.field,
          department: draft.department || prev.department,
          content: draft.content || prev.content,
          phone: draft.phone || prev.phone,
          is_anonymous: draft.is_anonymous || false
        }));
      }
      localStorage.removeItem("ticketDraft");
    } catch (e) { /* ignore corrupt drafts */ }
  }, []);

  function onFilesChange(e) {
    const picked = Array.from(e.target.files || []);
    const tooLarge = picked.find((file) => file.size > 20 * 1024 * 1024);
    if (tooLarge) {
      setError(`${tooLarge.name} 超过20M限制`);
      return;
    }
    setFiles(picked);
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => data.append(key, String(value)));
      files.forEach((file) => data.append("attachments", file));
      const token = localStorage.getItem("token");
      console.log("[TicketForm] submit", {
        has_token: Boolean(token),
        token_prefix: token ? token.slice(0, 30) : null,
        token_length: token ? token.length : 0,
        form_keys: Object.keys(form)
      });
      const res = await api.post("/tickets", data, uploadConfig);
      navigate(`/tickets/${res.data.id}`);
    } catch (err) {
      console.error("[TicketForm] submit_failed", {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
        token_exists: Boolean(localStorage.getItem("token"))
      });
      setError(err.response?.data?.message || "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  function saveDraft() {
    localStorage.setItem("ticketDraft", JSON.stringify(form));
    setError("草稿已保存到本机浏览器");
  }

  return (
    <form onSubmit={submit} className="app-card overflow-hidden p-0">
      <div className="mesh-hero border-b border-ai-border px-8 py-7">
        <div className="ai-chip mb-4">{t("form.badge")}</div>
        <div className="text-[32px] font-semibold tracking-tight text-ai-title">{t("form.title")}</div>
        <div className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">{t("form.desc")}</div>
      </div>

      <div className="p-8">
        <section className="mb-8 rounded-[20px] border border-ai-border bg-ai-bg">
          <button
            type="button"
            onClick={() => setNoticeOpen(!noticeOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left font-semibold text-ai-title"
          >
            {t("form.notice")}
            {noticeOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {noticeOpen && (
            <div className="border-t border-ai-border px-5 py-4 text-sm leading-7 text-ai-body">
              <p>1. 请围绕一个事项填写一条诉求，标题应简明概括，内容应包含时间、地点、问题现象和期望处理方式。</p>
              <p>2. 涉及个人隐私、敏感证件或证明材料时，请谨慎上传，平台将按权限进行管理。</p>
              <p>3. 匿名提交后，管理端不展示提交人的姓名和联系方式。</p>
            </div>
          )}
        </section>

        <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[160px_1fr]">
          <label className="form-label pt-2 text-sm font-semibold text-ai-title">{t("form.inputTitle")}</label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="soft-input"
            placeholder={t("form.titlePlaceholder")}
            required
          />

          <div className="form-label pt-1 text-sm font-semibold text-ai-title">{t("common.field")}</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {fieldOptions.map((field) => (
              <label key={field.label} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition duration-200 ${form.field === field.label ? "border-ai-primary/30 bg-ai-primary/10 text-ai-primary" : "border-ai-border text-ai-body hover:bg-ai-bg"}`}>
                <input
                  type="radio"
                  name="field"
                  checked={form.field === field.label}
                  onChange={() => setForm({ ...form, field: field.label })}
                  className="h-4 w-4 accent-ai-primary"
                />
                {displayName(field)}
              </label>
            ))}
          </div>

          <div className="form-label pt-1 text-sm font-semibold text-ai-title">{t("common.department")}</div>
          <div className="relative">
            <select
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className={`soft-input w-full appearance-none pr-10 cursor-pointer ${!form.department ? 'text-ai-muted' : ''}`}
              required
            >
              <option value="" disabled>{t("form.unknownDept")}</option>
              {Object.entries(departmentOptions).map(([type, depts]) => (
                <optgroup key={type} label={displayDepartmentType(type)}>
                  {depts.map((d) => (
                    <option key={d.id} value={d.name}>{displayName(d, "name", "name_en")}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ai-muted" />
          </div>

          <label className="form-label pt-2 text-sm font-semibold text-ai-title">{t("form.content")}</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="soft-textarea min-h-44"
            placeholder={t("form.contentPlaceholder")}
            required
          />

          <label className="pt-2 text-sm font-semibold text-ai-title">{t("form.attachments")}</label>
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[20px] border border-dashed border-ai-border bg-ai-bg px-4 py-8 text-center transition duration-200 hover:border-ai-primary/40 hover:bg-ai-primary/5">
              <FileUp className="mb-3 text-ai-primary" size={30} />
              <span className="text-sm font-semibold text-ai-title">{t("form.chooseFiles")}</span>
              <span className="mt-2 text-xs text-ai-muted">支持 txt, docx, xlsx, pdf, png, jpg, zip, avi, mp4，单文件不超过20M</span>
              <input type="file" multiple accept={acceptTypes} onChange={onFilesChange} className="hidden" />
            </label>
            {files.length > 0 && (
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                {files.map((file) => (
                  <div key={file.name} className="rounded-xl bg-white px-3 py-2 ring-1 ring-ai-border">
                    {file.name} · {(file.size / 1024 / 1024).toFixed(2)}M
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="pt-2 text-sm font-semibold text-ai-title">{t("form.name")}</label>
          <input value={user.name} disabled className="soft-input" />

          <label className="pt-2 text-sm font-semibold text-ai-title">{t("form.phone")}</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="soft-input"
            placeholder={t("form.phonePlaceholder")}
          />

          <div />
          <label className="flex items-center gap-2 text-sm text-ai-body">
            <input
              type="checkbox"
              checked={form.is_anonymous}
              onChange={(e) => setForm({ ...form, is_anonymous: e.target.checked })}
              className="h-4 w-4 accent-ai-primary"
            />
            {t("form.anonymous")}
          </label>
        </div>

        {error && <div className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">{error}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ai-border bg-ai-bg px-8 py-5">
        <button type="button" onClick={() => navigate(-1)} className="ghost-button">
          <RotateCcw size={17} />
          {t("action.back")}
        </button>
        <button type="button" onClick={saveDraft} className="secondary-button">
          <Save size={17} />
          {t("action.save")}
        </button>
        <button disabled={submitting} type="submit" className="primary-button">
          <SendHorizontal size={17} />
          {submitting ? t("action.submitting") : t("action.submit")}
        </button>
      </div>
    </form>
  );
}
