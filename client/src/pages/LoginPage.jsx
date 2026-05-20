import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole, Sparkles, UserRound } from "lucide-react";
import { api } from "../api";
import { useLanguage } from "../i18n";

export default function LoginPage({ onLogin, authMessage = "" }) {
  const { t, language, setLanguage } = useLanguage();
  const [form, setForm] = useState({ union_id: "student", password: "123456" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", form, { skipAuthExpiredHandler: true });
      setTransitioning(true);
      transitionTimer.current = window.setTimeout(() => {
        onLogin(res.data);
      }, 720);
    } catch (err) {
      setError(err.response?.data?.message || "登录失败");
      setLoading(false);
      setTransitioning(false);
    }
  }

  const isBusy = loading || transitioning;

  return (
    <div className={`login-stage min-h-screen overflow-hidden bg-[#f8f8fb] text-ai-title ${transitioning ? "login-stage-leave" : ""}`}>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(108,76,241,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(17,17,17,0.045)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(108,76,241,0.12),transparent)]" />

      {transitioning ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-md">
          <div className="login-success-mark flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ai-primary text-white shadow-[0_18px_44px_rgba(108,76,241,0.28)]">
              <CheckCircle2 size={32} />
            </div>
            <div className="text-sm font-semibold text-ai-title">{language === "en" ? "Entering workspace" : "正在进入工作台"}</div>
          </div>
        </div>
      ) : null}

      <main className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
        <section className="login-hero relative flex min-h-[52vh] flex-col px-6 py-8 sm:px-10 lg:min-h-screen lg:px-14 lg:py-12">
          <div className="flex items-center gap-4">
            <img
              src="/tsinghua-sigs-logo.png"
              alt="清华大学深圳国际研究生院"
              className="h-14 w-[318px] object-contain object-left"
            />
          </div>

          <div className="max-w-3xl pt-20 sm:pt-24 lg:pt-28">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-ai-primary/15 bg-white/70 px-4 py-2 text-sm font-medium text-ai-primary shadow-sm backdrop-blur-xl">
              <Sparkles size={15} />
              SIGS Prompt Complaint
            </div>
            <h1 className="max-w-2xl text-[42px] font-semibold leading-[1.05] tracking-tight text-ai-title sm:text-[58px]">
              SIGS投诉即办
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-ai-body">
              诉求提交、部门流转、办理进度和结果反馈集中在同一个工作台。
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-8 sm:px-10">
          <form
            onSubmit={submit}
            className="login-panel w-full max-w-[460px] rounded-[32px] border border-white/80 bg-white/90 p-7 shadow-[0_28px_80px_rgba(17,17,17,0.12)] backdrop-blur-2xl sm:p-8"
          >
            <div className="mb-5 flex justify-end">
              <div className="rounded-full bg-ai-bg p-1 ring-1 ring-ai-border">
                {["zh", "en"].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setLanguage(item)}
                    className={`h-8 rounded-full px-3 text-xs font-semibold transition duration-200 ${
                      language === item ? "bg-white text-ai-primary shadow-sm" : "text-ai-muted hover:text-ai-title"
                    }`}
                  >
                    {item === "zh" ? "中" : "EN"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-8">
              <div className="text-sm font-semibold text-ai-primary">{language === "en" ? "Login" : "登录入口"}</div>
              <h2 className="mt-3 text-[34px] font-semibold tracking-tight text-ai-title">{language === "en" ? "Welcome Back" : "欢迎回来"}</h2>
              <p className="mt-2 text-sm leading-6 text-ai-body">{language === "en" ? "Use your campus account to enter the service platform." : "使用校园账号进入诉求办理平台。"}</p>
            </div>

            <label className="mb-4 block">
              <span className="mb-2 block text-sm font-medium text-ai-body">{language === "en" ? "Union ID" : "人员编号"}</span>
              <div className="group flex items-center rounded-2xl border border-ai-border bg-white px-4 transition duration-200 focus-within:border-ai-primary/40 focus-within:ring-4 focus-within:ring-ai-primary/10">
                <UserRound size={18} className="text-ai-muted transition duration-200 group-focus-within:text-ai-primary" />
                <input
                  value={form.union_id}
                  onChange={(e) => setForm({ ...form, union_id: e.target.value })}
                  disabled={isBusy}
                  className="h-12 w-full border-0 bg-transparent px-3 text-ai-title outline-none disabled:cursor-not-allowed"
                  autoComplete="username"
                />
              </div>
            </label>

            <label className="mb-5 block">
              <span className="mb-2 block text-sm font-medium text-ai-body">{language === "en" ? "Password" : "密码"}</span>
              <div className="group flex items-center rounded-2xl border border-ai-border bg-white px-4 transition duration-200 focus-within:border-ai-primary/40 focus-within:ring-4 focus-within:ring-ai-primary/10">
                <LockKeyhole size={18} className="text-ai-muted transition duration-200 group-focus-within:text-ai-primary" />
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  disabled={isBusy}
                  className="h-12 w-full border-0 bg-transparent px-3 text-ai-title outline-none disabled:cursor-not-allowed"
                  autoComplete="current-password"
                />
              </div>
            </label>

            {authMessage ? (
              <div className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-100">{authMessage}</div>
            ) : null}

            {error ? (
              <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={isBusy}
              className={`login-submit relative h-12 w-full overflow-hidden rounded-2xl bg-ai-primary px-5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(108,76,241,0.24)] transition duration-300 hover:brightness-105 disabled:cursor-not-allowed ${isBusy ? "is-loading" : ""}`}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {transitioning ? (language === "en" ? "Entering" : "进入中") : loading ? (language === "en" ? "Verifying" : "验证中") : (language === "en" ? "Log in" : "登录系统")}
                <ArrowRight size={18} />
              </span>
              {isBusy ? <span className="login-submit-bar absolute inset-y-0 left-0 bg-white/24" /> : null}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
