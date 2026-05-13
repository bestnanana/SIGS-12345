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
    <form onSubmit={submit} className="rounded-md bg-white shadow-soft ring-1 ring-slate-200">
      <div className="border-b border-slate-200 px-6 py-4">
        <div className="text-lg font-semibold text-slate-900">SIGS接诉即办 - 提出意见</div>
        <div className="mt-1 text-sm text-slate-500">请如实填写事项信息，便于相关单位核实办理。</div>
      </div>

      <div className="p-6">
        <section className="mb-6 rounded-md border border-tsinghua-200 bg-tsinghua-50">
          <button
            type="button"
            onClick={() => setNoticeOpen(!noticeOpen)}
            className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-tsinghua-900"
          >
            使用须知
            {noticeOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {noticeOpen && (
            <div className="border-t border-tsinghua-100 px-4 py-4 text-sm leading-7 text-slate-700">
              <p>1. 请围绕一个事项填写一条诉求，标题应简明概括，内容应包含时间、地点、问题现象和期望处理方式。</p>
              <p>2. 涉及个人隐私、敏感证件或证明材料时，请谨慎上传，平台将按权限进行管理。</p>
              <p>3. 匿名提交后，管理端不展示提交人的姓名和联系方式。</p>
            </div>
          )}
        </section>

        <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[160px_1fr]">
          <label className="form-label pt-2 text-sm font-medium text-slate-700">标题</label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-tsinghua-600"
            placeholder="请输入事项标题"
            required
          />

          <div className="form-label pt-1 text-sm font-medium text-slate-700">事项领域</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {fields.map((field) => (
              <label key={field} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-tsinghua-300">
                <input
                  type="radio"
                  name="field"
                  checked={form.field === field}
                  onChange={() => setForm({ ...form, field })}
                  className="h-4 w-4 accent-tsinghua-700"
                />
                {field}
              </label>
            ))}
          </div>

          <div className="form-label pt-1 text-sm font-medium text-slate-700">部门</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {departments.map((dept) => (
              <label key={dept} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-tsinghua-300">
                <input
                  type="radio"
                  name="department"
                  checked={form.department === dept}
                  onChange={() => setForm({ ...form, department: dept })}
                  className="h-4 w-4 accent-tsinghua-700"
                />
                {dept}
              </label>
            ))}
          </div>

          <label className="form-label pt-2 text-sm font-medium text-slate-700">内容</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="min-h-44 rounded-md border border-slate-300 px-3 py-3 leading-7 outline-none focus:border-tsinghua-600"
            placeholder="请坚持一事一条，详细描述相关情况"
            required
          />

          <label className="pt-2 text-sm font-medium text-slate-700">附件上传</label>
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center hover:border-tsinghua-400">
              <FileUp className="mb-2 text-tsinghua-700" size={28} />
              <span className="text-sm font-medium text-slate-700">选择附件</span>
              <span className="mt-1 text-xs text-slate-500">支持 txt, docx, xlsx, pdf, png, jpg, zip, avi, mp4，单文件不超过20M</span>
              <input type="file" multiple accept={acceptTypes} onChange={onFilesChange} className="hidden" />
            </label>
            {files.length > 0 && (
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                {files.map((file) => (
                  <div key={file.name} className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
                    {file.name} · {(file.size / 1024 / 1024).toFixed(2)}M
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="pt-2 text-sm font-medium text-slate-700">姓名</label>
          <input value={user.name} disabled className="h-10 rounded-md border border-slate-200 bg-slate-100 px-3 text-slate-500" />

          <label className="pt-2 text-sm font-medium text-slate-700">手机号码</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-tsinghua-600"
            placeholder="请输入手机号码"
          />

          <div />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.is_anonymous}
              onChange={(e) => setForm({ ...form, is_anonymous: e.target.checked })}
              className="h-4 w-4 accent-tsinghua-700"
            />
            匿名提交，管理端不显示我的姓名和联系方式
          </label>
        </div>

        {error && <div className="mt-5 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
        <button type="button" onClick={() => navigate(-1)} className="flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-5 text-slate-700 hover:bg-slate-50">
          <RotateCcw size={17} />
          返回
        </button>
        <button type="button" onClick={saveDraft} className="flex h-10 items-center gap-2 rounded-md border border-tsinghua-300 bg-white px-5 text-tsinghua-800 hover:bg-tsinghua-50">
          <Save size={17} />
          保存
        </button>
        <button disabled={submitting} type="submit" className="flex h-10 items-center gap-2 rounded-md bg-tsinghua-700 px-6 font-medium text-white hover:bg-tsinghua-800 disabled:opacity-70">
          <SendHorizontal size={17} />
          {submitting ? "提交中..." : "提交"}
        </button>
      </div>
    </form>
  );
}
