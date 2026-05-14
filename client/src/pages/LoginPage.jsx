import React, { useState } from "react";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { api } from "../api";

export default function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: "student", password: "123456" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", form);
      onLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ai-bg">
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden bg-[linear-gradient(135deg,#3f1b70_0%,#55238c_52%,#0e7272_100%)] px-8 py-10 text-white">
          <div className="absolute inset-x-0 top-0 h-px bg-white/30" />
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div className="flex max-w-2xl items-center gap-4 rounded-2xl bg-white px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.04)] ring-1 ring-white/70">
              <img
                src="/tsinghua-sigs-logo.png"
                alt="清华大学深圳国际研究生院"
                className="h-12 min-w-0 flex-1 object-contain object-left"
              />
              <div className="hidden h-10 w-px bg-slate-200 sm:block" />
              <div>
                <div className="whitespace-nowrap text-lg font-semibold text-tsinghua-900">SIGS接诉即办</div>
                <div className="whitespace-nowrap text-xs text-slate-500">SIGS Prompt Complaint</div>
              </div>
            </div>
            <div className="max-w-2xl pb-10 pt-14">
              <div className="mb-5 inline-flex rounded-full bg-white/12 px-4 py-2 text-sm text-tsinghua-50 ring-1 ring-white/20">
                一站式诉求受理、智能分类、部门协同办理
              </div>
              <h1 className="max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">校园诉求接得住，办得清，看得见</h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-tsinghua-50">
                面向师生的意见提交、事项跟踪、官方回复和满意评价平台，支持 Minimax 大模型辅助分类与回复建议。
              </p>
              <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
                {["统一入口", "流程留痕", "智能辅助"].map((item) => (
                  <div key={item} className="rounded-2xl bg-white/10 px-4 py-3 text-sm ring-1 ring-white/15">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-10">
          <form onSubmit={submit} className="w-full max-w-md rounded-[28px] border border-ai-border bg-white/95 p-8 shadow-[0_20px_60px_rgba(17,17,17,0.08)] backdrop-blur">
            <div className="mb-8">
              <div className="text-[32px] font-semibold tracking-tight text-ai-title">用户登录</div>
              <div className="mt-2 text-sm text-ai-body">演示账号：student/123456，admin/123456</div>
            </div>

            <label className="mb-4 block">
              <span className="mb-2 block text-sm font-medium text-ai-body">用户名</span>
              <div className="flex items-center rounded-xl border border-ai-border bg-white px-3 transition duration-200 focus-within:border-ai-primary/40 focus-within:ring-4 focus-within:ring-ai-primary/10">
                <UserRound size={18} className="text-ai-muted" />
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="h-11 w-full border-0 px-3 outline-none"
                  autoComplete="username"
                />
              </div>
            </label>

            <label className="mb-5 block">
              <span className="mb-2 block text-sm font-medium text-ai-body">密码</span>
              <div className="flex items-center rounded-xl border border-ai-border bg-white px-3 transition duration-200 focus-within:border-ai-primary/40 focus-within:ring-4 focus-within:ring-ai-primary/10">
                <LockKeyhole size={18} className="text-ai-muted" />
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="h-11 w-full border-0 px-3 outline-none"
                  autoComplete="current-password"
                />
              </div>
            </label>

            {error && <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="primary-button w-full"
            >
              {loading ? "登录中..." : "登录系统"}
              <ArrowRight size={18} />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
