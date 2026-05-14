import React, { useState } from "react";
import { ChevronDown, ChevronUp, FileUp, RotateCcw, Save, SendHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, uploadConfig } from "../api";
import { departments, fields } from "../constants";

const acceptTypes = ".txt,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.zip,.avi,.mp4";

export default function TicketFormPage({ user }) {
  const navigate = useNavigate();
  const [noticeOpen, setNoticeOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({
    title: "",
    field: "教务",
    department: "党政办",
    content: "",
    phone: user.phone || "",
    is_anonymous: false
  });

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
      const res = await api.post("/tickets", data, uploadConfig);
      navigate(`/tickets/${res.data.id}`);
    } catch (err) {
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
        <div className="ai-chip mb-4">事项提交</div>
        <div className="text-[32px] font-semibold tracking-tight text-ai-title">提出意见</div>
        <div className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">请如实填写事项信息，AI 将辅助识别领域并交由相关部门办理。</div>
      </div>

      <div className="p-8">
        <section className="mb-8 rounded-[20px] border border-ai-border bg-ai-bg">
          <button
            type="button"
            onClick={() => setNoticeOpen(!noticeOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left font-semibold text-ai-title"
          >
            使用须知
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
          <label className="form-label pt-2 text-sm font-semibold text-ai-title">标题</label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="soft-input"
            placeholder="请输入事项标题"
            required
          />

          <div className="form-label pt-1 text-sm font-semibold text-ai-title">事项领域</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {fields.map((field) => (
              <label key={field} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition duration-200 ${form.field === field ? "border-ai-primary/30 bg-ai-primary/10 text-ai-primary" : "border-ai-border text-ai-body hover:bg-ai-bg"}`}>
                <input
                  type="radio"
                  name="field"
                  checked={form.field === field}
                  onChange={() => setForm({ ...form, field })}
                  className="h-4 w-4 accent-ai-primary"
                />
                {field}
              </label>
            ))}
          </div>

          <div className="form-label pt-1 text-sm font-semibold text-ai-title">部门</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {departments.map((dept) => (
              <label key={dept} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition duration-200 ${form.department === dept ? "border-ai-primary/30 bg-ai-primary/10 text-ai-primary" : "border-ai-border text-ai-body hover:bg-ai-bg"}`}>
                <input
                  type="radio"
                  name="department"
                  checked={form.department === dept}
                  onChange={() => setForm({ ...form, department: dept })}
                  className="h-4 w-4 accent-ai-primary"
                />
                {dept}
              </label>
            ))}
          </div>

          <label className="form-label pt-2 text-sm font-semibold text-ai-title">内容</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="soft-textarea min-h-44"
            placeholder="请坚持一事一条，详细描述相关情况"
            required
          />

          <label className="pt-2 text-sm font-semibold text-ai-title">附件上传</label>
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[20px] border border-dashed border-ai-border bg-ai-bg px-4 py-8 text-center transition duration-200 hover:border-ai-primary/40 hover:bg-ai-primary/5">
              <FileUp className="mb-3 text-ai-primary" size={30} />
              <span className="text-sm font-semibold text-ai-title">选择附件</span>
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

          <label className="pt-2 text-sm font-semibold text-ai-title">姓名</label>
          <input value={user.name} disabled className="soft-input" />

          <label className="pt-2 text-sm font-semibold text-ai-title">手机号码</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="soft-input"
            placeholder="请输入手机号码"
          />

          <div />
          <label className="flex items-center gap-2 text-sm text-ai-body">
            <input
              type="checkbox"
              checked={form.is_anonymous}
              onChange={(e) => setForm({ ...form, is_anonymous: e.target.checked })}
              className="h-4 w-4 accent-ai-primary"
            />
            匿名提交，管理端不显示我的姓名和联系方式
          </label>
        </div>

        {error && <div className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">{error}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ai-border bg-ai-bg px-8 py-5">
        <button type="button" onClick={() => navigate(-1)} className="ghost-button">
          <RotateCcw size={17} />
          返回
        </button>
        <button type="button" onClick={saveDraft} className="secondary-button">
          <Save size={17} />
          保存
        </button>
        <button disabled={submitting} type="submit" className="primary-button">
          <SendHorizontal size={17} />
          {submitting ? "提交中..." : "提交"}
        </button>
      </div>
    </form>
  );
}
