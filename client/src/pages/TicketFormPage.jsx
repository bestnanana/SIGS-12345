import React, { useEffect, useState } from "react";
import { ChevronDown, CloudUpload, EyeOff, FileImage, RotateCcw, Save, SendHorizontal, X } from "lucide-react";
import { api, uploadConfig } from "../api";
import { defaultFields } from "../constants";
import { useLocaleNavigate, useLanguage } from "../i18n";

const acceptTypes = ".txt,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.avi,.mp4";
const departmentTypeLabels = {
  "职能处室": "Administrative Offices",
  "教学科研机构": "Teaching and Research Units"
};

const pageCopy = {
  zh: {
    formDesc: "为进一步畅通师生员工建言献策渠道，及时回应意见建议，促进师生员工更好地参与学校建设发展，建立本平台。",
    restoreDraftConfirm: "检测到上次未提交的表单草稿，是否恢复？",
    fileTooLarge: (name) => `${name} 超过20M限制`,
    submitFailed: "提交失败，请稍后重试",
    draftSaved: "草稿已保存到本机浏览器",
    attachmentHint: "支持 txt, docx, xlsx, pdf, png, jpg, zip, avi, mp4，单文件不超过20M",
    uploadHint: "可拖拽文件到此处，或点击从电脑选择文件",
    reporterInfo: "提交人信息",
    anonymousNote: "匿名提交后，管理端不展示你的姓名和联系方式。",
    processingTitle: "预计处理时间",
    processingLabel: "常规办理周期：",
    processingDays: "2-3 个工作日",
    noticeItems: [
      "为进一步畅通师生员工建言献策渠道，及时回应意见建议，促进师生员工更好地参与学校建设发展，建立本平台。",
      "If you are an international student or scholar, please select the \"For international students & scholars\" option and submit your suggestions.",
      "您可以对学校教学、科研、管理、服务等方面的工作提出咨询、意见、建议、诉求等。",
      "您可以选择与意见内容匹配的主责单位，如不确定主责单位，可以选择“其他单位”。建议尽量清晰、具体地叙述情况，以便我们能够及时有效地研究办理和答复。",
      "您可以在“我的事项”中查询办理进展和答复意见，并进行评价。如您同意发布，后续将有管理员筛选并发布在首页。",
      "办理时间一般为5个工作日。如事项较为复杂，办理时间会有所延长，敬请谅解。"
    ]
  },
  en: {
    formDesc: "为进一步畅通师生员工建言献策渠道，及时回应意见建议，促进师生员工更好地参与学校建设发展，建立本平台。",
    restoreDraftConfirm: "An unfinished draft was found. Restore it?",
    fileTooLarge: (name) => `${name} exceeds the 20 MB limit`,
    submitFailed: "Submission failed. Please try again later.",
    draftSaved: "Draft saved in this browser.",
    attachmentHint: "Supports txt, docx, xlsx, pdf, png, jpg, zip, avi, mp4. Max 20 MB per file.",
    uploadHint: "Drag and drop files here, or click to browse files from your computer",
    reporterInfo: "Reporter Information",
    anonymousNote: "After anonymous submission, your name and contact details are hidden from administrators.",
    processingTitle: "Processing Time",
    processingLabel: "Typical resolution:",
    processingDays: "2-3 Business Days",
    noticeItems: [
      "为进一步畅通师生员工建言献策渠道，及时回应意见建议，促进师生员工更好地参与学校建设发展，建立本平台。",
      "If you are an international student or scholar, please select the \"For international students & scholars\" option and submit your suggestions.",
      "您可以对学校教学、科研、管理、服务等方面的工作提出咨询、意见、建议、诉求等。",
      "您可以选择与意见内容匹配的主责单位，如不确定主责单位，可以选择“其他单位”。建议尽量清晰、具体地叙述情况，以便我们能够及时有效地研究办理和答复。",
      "您可以在“我的事项”中查询办理进展和答复意见，并进行评价。如您同意发布，后续将有管理员筛选并发布在首页。",
      "办理时间一般为5个工作日。如事项较为复杂，办理时间会有所延长，敬请谅解。"
    ]
  }
};

function defaultFieldOptions() {
  return defaultFields.map((label) => ({ label, label_en: "" }));
}

export default function TicketFormPage({ user }) {
  const { t, language } = useLanguage();
  const copy = pageCopy[language] || pageCopy.zh;
  const navigate = useLocaleNavigate();
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);
  const [fieldOptions, setFieldOptions] = useState(defaultFieldOptions);
  const [departmentOptions, setDepartmentOptions] = useState({});
  const [form, setForm] = useState({
    title: "",
    field: "",
    department: "",
    content: "",
    phone: user.phone || "",
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
        const res = await api.get("/form-options", { skipAuthExpiredHandler: true });
        const nextFields = Array.isArray(res.data?.fields) ? res.data.fields.filter((item) => item?.label) : [];
        const nextFieldValues = nextFields.map((item) => item.label);
        if (cancelled) return;
        setFieldOptions(nextFields.length ? nextFields : defaultFieldOptions());
        setForm((current) => ({
          ...current,
          field: current.field && nextFieldValues.includes(current.field) ? current.field : ""
        }));
        const deptRes = await api.get("/departments", { skipAuthExpiredHandler: true });
        if (cancelled) return;
        const grouped = deptRes.data || {};
        setDepartmentOptions(grouped);
        const allDepts = Object.values(grouped).flat().map((d) => d.name);
        setForm((current) => ({
          ...current,
          department: allDepts.includes(current.department) || current.department === "" ? current.department : ""
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
      const restore = window.confirm(copy.restoreDraftConfirm);
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
      setError(copy.fileTooLarge(tooLarge.name));
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
      const res = await api.post("/tickets", data, uploadConfig);
      navigate(`/tickets/${res.data.id}`);
    } catch (err) {
      setError(err.response?.data?.message || copy.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function saveDraft() {
    localStorage.setItem("ticketDraft", JSON.stringify(form));
    setError(copy.draftSaved);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border border-ai-border bg-[#fbf5fa] px-5 py-6 shadow-sm sm:px-8">
        <div className="pointer-events-none absolute right-[-80px] top-[-120px] h-72 w-72 rounded-full bg-ai-primary/10 blur-3xl" />
        <button type="button" onClick={() => navigate(-1)} className="relative z-10 mb-4 inline-flex items-center gap-2 text-sm font-semibold text-ai-primary hover:brightness-110">
          <RotateCcw size={16} />
          {t("action.back")}
        </button>
        <div className="relative z-10">
          <div className="ai-chip mb-4">{t("form.badge")}</div>
          <h1 className="text-[34px] font-black tracking-tight text-ai-title sm:text-[44px]">{t("form.title")}</h1>
          <section className="mt-6 rounded-2xl border border-ai-border bg-white/75 px-4 py-4 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => setNoticeOpen(!noticeOpen)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-ai-title"
            >
              {t("form.notice")}
              <ChevronDown size={18} className={`transition ${noticeOpen ? "rotate-180" : ""}`} />
            </button>
            {noticeOpen && (
              <div className="mt-3 space-y-2 border-t border-ai-border pt-3 text-xs leading-6 text-ai-body sm:text-sm">
                {copy.noticeItems.map((item, index) => (
                  <p key={item}>{index + 1}. {item}</p>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="app-card p-5 sm:p-6">
            <label className="mb-2 block text-sm font-semibold text-ai-title">{t("form.inputTitle")}</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="soft-input h-14 w-full text-base"
              placeholder={t("form.titlePlaceholder")}
              required
            />

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-semibold text-ai-title">{t("common.field")}</div>
                <select
                  value={form.field}
                  onChange={(e) => setForm({ ...form, field: e.target.value })}
                  className={`soft-input h-14 w-full text-base ${!form.field ? "text-ai-muted" : ""}`}
                  required
                >
                  <option value="" disabled>{language === "en" ? "Please select a category" : "请选择事项领域"}</option>
                  {fieldOptions.map((field) => (
                    <option key={field.label} value={field.label}>{displayName(field)}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold text-ai-title">{t("common.department")}</div>
                <select
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  className={`soft-input h-14 w-full text-base ${!form.department ? "text-ai-muted" : ""}`}
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
              </div>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-ai-title">{t("form.content")}</span>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                className="soft-textarea min-h-56 w-full text-base"
                placeholder={t("form.contentPlaceholder")}
                required
              />
            </label>
          </section>

          <section className="app-card p-5 sm:p-6">
            <div>
              <div>
                <h2 className="text-xl font-bold text-ai-title">{t("form.attachments")}</h2>
                <p className="mt-1 text-sm text-ai-body">{copy.attachmentHint}</p>
              </div>
            </div>

            <label className="mt-5 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed border-ai-border bg-ai-bg/70 px-5 py-10 text-center transition duration-200 hover:border-ai-primary/40 hover:bg-ai-primary/5">
              <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white text-ai-primary shadow-sm ring-1 ring-ai-border">
                <CloudUpload size={30} />
              </span>
              <span className="text-base font-semibold text-ai-title">{t("form.chooseFiles")}</span>
              <span className="mt-2 text-sm text-ai-muted">{copy.uploadHint}</span>
              <input type="file" multiple accept={acceptTypes} onChange={onFilesChange} className="hidden" />
            </label>

            {files.length > 0 && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {files.map((file) => (
                  <div key={file.name} className="flex items-center gap-3 rounded-2xl border border-ai-border bg-[#fbedf8] px-3 py-3 text-sm text-ai-body">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ai-primary text-white">
                      <FileImage size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ai-title">{file.name}</span>
                      <span className="block text-xs text-ai-muted">{(file.size / 1024 / 1024).toFixed(2)}M</span>
                    </span>
                    <button type="button" onClick={() => setFiles(files.filter((item) => item !== file))} className="rounded-full p-1 text-ai-muted hover:bg-white hover:text-ai-title">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="app-card p-5 sm:p-6">
            <h2 className="text-xl font-bold text-ai-title">{copy.reporterInfo}</h2>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-ai-title">{t("form.name")}</span>
              <input value={user.name} disabled className="soft-input h-12 w-full" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-semibold text-ai-title">{t("form.phone")}</span>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="soft-input h-12 w-full"
                placeholder={t("form.phonePlaceholder")}
              />
            </label>

            <label className="mt-5 flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-[#f4e4f1] px-4 py-4 text-ai-title">
              <span className="flex items-center gap-3">
                <EyeOff size={23} className="text-ai-primary" />
                <span className="text-sm font-semibold leading-5">{t("form.anonymous")}</span>
              </span>
              <span className={`relative h-8 w-14 shrink-0 rounded-full transition ${form.is_anonymous ? "bg-ai-primary" : "bg-slate-300"}`}>
                <input
                  type="checkbox"
                  checked={form.is_anonymous}
                  onChange={(e) => setForm({ ...form, is_anonymous: e.target.checked })}
                  className="sr-only"
                />
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${form.is_anonymous ? "left-7" : "left-1"}`} />
              </span>
            </label>

            <p className="mt-4 text-xs leading-5 text-ai-muted">
              {copy.anonymousNote}
            </p>
          </section>

          <section className="relative overflow-hidden rounded-2xl bg-ai-primary p-6 text-white shadow-card">
            <div className="pointer-events-none absolute bottom-[-60px] right-[-30px] h-44 w-44 rounded-full border-[18px] border-white/10" />
            <div className="relative z-10">
              <h2 className="text-xl font-bold">{copy.processingTitle}</h2>
              <p className="mt-3 text-white/75">{copy.processingLabel}</p>
              <p className="mt-1 text-2xl font-black">{copy.processingDays}</p>
            </div>
          </section>

        </aside>
      </div>

      {error && <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">{error}</div>}

      <div className="flex flex-wrap items-center justify-end gap-4 border-t border-ai-border pt-6">
        <button type="button" onClick={saveDraft} className="secondary-button bg-transparent px-4 shadow-none">
          <Save size={17} />
          {t("action.save")}
        </button>
        <button type="submit" disabled={submitting} className="primary-button min-w-44">
          <SendHorizontal size={17} />
          {submitting ? t("action.submitting") : t("action.submit")}
        </button>
      </div>
    </form>
  );
}
