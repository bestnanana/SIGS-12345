import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole, Sparkles, UserRound, ExternalLink } from "lucide-react";
import { api } from "../api";
import { useLanguage, useLocale } from "../i18n";

export default function LoginPage({ onLogin, authMessage = "" }) {
  const { t } = useLanguage();
  const { locale } = useLocale();
  const [loginMode, setLoginMode] = useState("local"); // "local" or "sso"
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
      }, 720);
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
    <div className={`login-stage min-h-screen overflow-hidden bg-[#f8f8fb] text-ai-title ${transitioning ? "login-stage-leave" : ""}`}>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(108,76,241,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(17,17,17,0.045)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(108,76,241,0.12),transparent)]" />

      {transitioning ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-md">
          <div className="login-success-mark flex flex-col items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ai-primary text-white shadow-[0_18px_44px_rgba(108,76,241,0.28)]">
              <CheckCircle2 size={32} />
            </div>
            <div className="text-sm font-semibold text-ai-title">{t("login.enterWorkspace")}</div>
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
              {t("login.badge")}
            </div>
            <h1 className="max-w-2xl text-[42px] font-semibold leading-[1.05] tracking-tight text-ai-title sm:text-[58px]">
              {t("login.title")}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-ai-body">
              {t("login.subtitle")}
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center px-6 py-8 sm:px-10">
          <div className="login-panel w-full max-w-[460px] rounded-[32px] border border-white/80 bg-white/90 p-7 shadow-[0_28px_80px_rgba(17,17,17,0.12)] backdrop-blur-2xl sm:p-8">
            <div className="mb-6">
              <div className="text-sm font-semibold text-ai-primary">{t("login.heading")}</div>
              <h2 className="mt-3 text-[34px] font-semibold tracking-tight text-ai-title">{t("login.welcome")}</h2>
              <p className="mt-2 text-sm leading-6 text-ai-body">{t("login.welcomeDesc")}</p>
            </div>

            {/* 登录方式切换 */}
            <div className="mb-6 flex rounded-2xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setLoginMode("local")}
                className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-all ${
                  loginMode === "local"
                    ? "bg-white text-ai-title shadow-sm"
                    : "text-ai-body hover:text-ai-title"
                }`}
              >
                {t("login.localLogin")}
              </button>
              <button
                type="button"
                onClick={() => setLoginMode("sso")}
                className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-all ${
                  loginMode === "sso"
                    ? "bg-white text-ai-title shadow-sm"
                    : "text-ai-body hover:text-ai-title"
                }`}
              >
                {t("login.ssoLogin")}
              </button>
            </div>

            {loginMode === "local" ? (
              /* 本地账号密码登录 */
              <form onSubmit={handleLocalLogin}>
                <label className="mb-4 block">
                  <span className="mb-2 block text-sm font-medium text-ai-body">{t("login.username")}</span>
                  <div className="group flex items-center rounded-2xl border border-ai-border bg-white px-4 transition duration-200 focus-within:border-ai-primary/40 focus-within:ring-4 focus-within:ring-ai-primary/10">
                    <UserRound size={18} className="text-ai-muted transition duration-200 group-focus-within:text-ai-primary" />
                    <input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      disabled={isBusy}
                      className="h-12 w-full border-0 bg-transparent px-3 text-ai-title outline-none disabled:cursor-not-allowed"
                      autoComplete="username"
                    />
                  </div>
                </label>

                <label className="mb-5 block">
                  <span className="mb-2 block text-sm font-medium text-ai-body">{t("login.password")}</span>
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

                <p className="mb-4 text-xs text-ai-muted">{t("login.localHint")}</p>

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
                    {transitioning ? t("login.entering") : loading ? t("login.verifying") : t("login.loginButton")}
                    <ArrowRight size={18} />
                  </span>
                  {isBusy ? <span className="login-submit-bar absolute inset-y-0 left-0 bg-white/24" /> : null}
                </button>
              </form>
            ) : (
              /* SSO 登录 */
              <div>
                <p className="mb-6 text-sm text-ai-body">{t("login.ssoHint")}</p>

                {error ? (
                  <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</div>
                ) : null}

                <button
                  type="button"
                  onClick={handleSsoLogin}
                  disabled={ssoLoading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ai-primary px-5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(108,76,241,0.24)] transition duration-300 hover:brightness-105 disabled:cursor-not-allowed"
                >
                  {ssoLoading ? (
                    <span>{t("login.ssoRedirecting")}</span>
                  ) : (
                    <>
                      <span>{t("login.ssoButton")}</span>
                      <ExternalLink size={18} />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
