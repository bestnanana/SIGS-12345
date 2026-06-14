import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole, Sparkles, UserRound, ExternalLink, Globe } from "lucide-react";
import { api } from "../api";
import { useLanguage, useLocale } from "../i18n";

export default function LoginPage({ onLogin, authMessage = "" }) {
  const { t } = useLanguage();
  const { locale } = useLocale();
  const [loginMode, setLoginMode] = useState("local");
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (transitionTimer.current) window.clearTimeout(transitionTimer.current);
    };
  }, []);

  async function handleLocalLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", form, {
        skipAuthExpiredHandler: true
      });
      setTransitioning(true);
      transitionTimer.current = window.setTimeout(() => {
        onLogin(res.data);
      }, 800);
    } catch (err) {
      setError(err.response?.data?.message || t("login.failed"));
      setLoading(false);
      setTransitioning(false);
    }
  }

  async function handleSsoLogin() {
    setSsoLoading(true);
    setError("");
    try {
      const res = await api.get("/sso/authorize-url", { skipAuthExpiredHandler: true });
      window.location.href = res.data.authorize_url;
    } catch (err) {
      setError(t("login.ssoFailed"));
      setSsoLoading(false);
    }
  }

  const isBusy = loading || transitioning;

  return (
    <div className={`login-stage min-h-screen overflow-hidden bg-ai-bg text-ai-title ${transitioning ? "login-stage-leave" : ""}`}>
      {/* 背景装饰 */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-tsinghua-950 via-tsinghua-900 to-tsinghua-800" />
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: `
            radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.3) 0%, transparent 50%),
            radial-gradient(circle at 80% 70%, rgba(59, 130, 246, 0.2) 0%, transparent 50%)
          `
        }} />
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(0deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px'
        }} />
      </div>

      {/* 成功过渡动画 */}
      {transitioning ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-xl">
          <div className="login-success-mark flex flex-col items-center gap-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-tsinghua-600 to-tsinghua-800 text-white shadow-soft-xl">
              <CheckCircle2 size={40} />
            </div>
            <div className="text-lg font-semibold text-ai-title">{t("login.enterWorkspace")}</div>
            <div className="h-1 w-32 overflow-hidden rounded-full bg-ai-border">
              <div className="h-full w-full animate-pulse bg-gradient-to-r from-tsinghua-500 to-tsinghua-600" />
            </div>
          </div>
        </div>
      ) : null}

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-[480px]">
          {/* Logo 区域 */}
          <div className="mb-10 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20">
              <img
                src="/tsinghua-sigs-logo.png"
                alt="清华大学深圳国际研究生院"
                className="h-10 w-auto object-contain"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">
              SIGS接诉即办
            </h1>
            <p className="mt-2 text-sm text-white/70">
              SIGS接诉即办
            </p>
          </div>

          {/* 登录卡片 */}
          <div className="login-panel rounded-3xl border border-white/10 bg-white/95 p-7 shadow-soft-xl backdrop-blur-xl sm:p-8">
            {/* 登录方式切换 */}
            <div className="mb-6 flex rounded-2xl bg-ai-bg p-1">
              <button
                type="button"
                onClick={() => setLoginMode("local")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all duration-300 ${
                  loginMode === "local"
                    ? "bg-white text-ai-title shadow-card"
                    : "text-ai-muted hover:text-ai-body"
                }`}
              >
                <UserRound size={16} />
                {t("login.localLogin")}
              </button>
              <button
                type="button"
                onClick={() => setLoginMode("sso")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all duration-300 ${
                  loginMode === "sso"
                    ? "bg-white text-ai-title shadow-card"
                    : "text-ai-muted hover:text-ai-body"
                }`}
              >
                <Globe size={16} />
                {t("login.ssoLogin")}
              </button>
            </div>

            {loginMode === "local" ? (
              /* 本地账号密码登录 */
              <form onSubmit={handleLocalLogin} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-ai-body">
                    {t("login.username")}
                  </label>
                  <div className="group relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                      <UserRound size={18} className="text-ai-muted transition-colors duration-300 group-focus-within:text-ai-primary" />
                    </div>
                    <input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      disabled={isBusy}
                      className="soft-input w-full pl-11"
                      placeholder="请输入用户名"
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-ai-body">
                    {t("login.password")}
                  </label>
                  <div className="group relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                      <LockKeyhole size={18} className="text-ai-muted transition-colors duration-300 group-focus-within:text-ai-primary" />
                    </div>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      disabled={isBusy}
                      className="soft-input w-full pl-11"
                      placeholder="请输入密码"
                      autoComplete="current-password"
                    />
                  </div>
                </div>

                <p className="text-xs text-ai-muted">
                  {t("login.localHint")}
                </p>

                {authMessage && (
                  <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 ring-1 ring-amber-200">
                    {authMessage}
                  </div>
                )}

                {error && (
                  <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 ring-1 ring-red-200">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isBusy}
                  className={`login-submit primary-button relative h-12 w-full text-base ${isBusy ? "is-loading" : ""}`}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {transitioning ? t("login.entering") : loading ? t("login.verifying") : t("login.loginButton")}
                    {!loading && !transitioning && <ArrowRight size={18} />}
                  </span>
                  {isBusy ? <span className="login-submit-bar absolute inset-y-0 left-0 rounded-xl bg-white/20" /> : null}
                </button>
              </form>
            ) : (
              /* SSO 登录 */
              <div className="space-y-5">
                <div className="rounded-xl bg-tsinghua-50 p-4">
                  <p className="text-sm text-tsinghua-800">
                    {t("login.ssoHint")}
                  </p>
                </div>

                {error && (
                  <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 ring-1 ring-red-200">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSsoLogin}
                  disabled={ssoLoading}
                  className="primary-button flex h-12 w-full items-center justify-center gap-2 text-base"
                >
                  {ssoLoading ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      {t("login.ssoRedirecting")}
                    </>
                  ) : (
                    <>
                      {t("login.ssoButton")}
                      <ExternalLink size={18} />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* 底部信息 */}
          <div className="mt-8 text-center text-xs text-white/50">
            <p>清华大学深圳国际研究生院</p>
            <p className="mt-1">Tsinghua University Shenzhen International Graduate School</p>
          </div>
        </div>
      </main>
    </div>
  );
}
