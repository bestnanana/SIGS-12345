import React, { useState } from "react";
import { ArrowRight, LockKeyhole, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { useLanguage } from "../i18n";

export default function ChangePasswordPage({ onSuccess }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ old_password: "", new_password: "", confirm_password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!form.old_password || !form.new_password) {
      setError("请填写旧密码和新密码");
      return;
    }
    if (form.new_password.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    if (form.new_password !== form.confirm_password) {
      setError("两次输入的新密码不一致");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/change-password", {
        old_password: form.old_password,
        new_password: form.new_password
      });
      setDone(true);
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || "修改密码失败");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f8fb]">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500 text-white shadow-lg">
            <CheckCircle2 size={32} />
          </div>
          <div className="text-lg font-semibold text-gray-800">密码修改成功</div>
          <div className="text-sm text-gray-500">正在进入系统...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f8fb]">
      <div className="w-full max-w-[420px] rounded-3xl border border-white/80 bg-white/90 p-8 shadow-2xl backdrop-blur-2xl">
        <div className="mb-6">
          <div className="text-sm font-semibold text-purple-600">安全提示</div>
          <h2 className="mt-2 text-2xl font-bold text-gray-900">请修改初始密码</h2>
          <p className="mt-2 text-sm text-gray-500">首次登录需要修改密码后才能继续使用</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">旧密码</span>
            <div className="flex items-center rounded-xl border border-gray-200 bg-white px-3 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100">
              <LockKeyhole size={16} className="text-gray-400" />
              <input
                type="password"
                value={form.old_password}
                onChange={(e) => setForm({ ...form, old_password: e.target.value })}
                disabled={loading}
                className="h-11 w-full border-0 bg-transparent px-2 text-gray-900 outline-none"
                autoComplete="current-password"
              />
            </div>
          </label>

          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">新密码</span>
            <div className="flex items-center rounded-xl border border-gray-200 bg-white px-3 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100">
              <LockKeyhole size={16} className="text-gray-400" />
              <input
                type="password"
                value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })}
                disabled={loading}
                className="h-11 w-full border-0 bg-transparent px-2 text-gray-900 outline-none"
                autoComplete="new-password"
              />
            </div>
          </label>

          <label className="mb-5 block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">确认新密码</span>
            <div className="flex items-center rounded-xl border border-gray-200 bg-white px-3 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100">
              <LockKeyhole size={16} className="text-gray-400" />
              <input
                type="password"
                value={form.confirm_password}
                onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                disabled={loading}
                className="h-11 w-full border-0 bg-transparent px-2 text-gray-900 outline-none"
                autoComplete="new-password"
              />
            </div>
          </label>

          {error ? (
            <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 text-sm font-semibold text-white shadow-md transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "修改中..." : "修改密码"}
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
