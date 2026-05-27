require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {
  initDb,
  run,
  get,
  all,
  adminDepartments,
  ensureDatahubPersonTables,
  listFormOptionsGrouped,
  getFormOptionLabels,
  createFormOption,
  updateFormOption,
  deleteFormOption
} = require("./db");
const { fetchBasicPersons } = require("./datahub");
const { syncBasicPersons } = require("./datahub-sync");
const logger = require("./logger");

const app = express();
const defaultPort = process.env.NODE_ENV === "production" ? 80 : 3001;
const port = process.env.PORT || defaultPort;
const host = process.env.HOST || "127.0.0.1";
const rawJwtSecret = process.env.JWT_SECRET;
const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = rawJwtSecret || (isProduction ? null : "dev-secret");
if (!jwtSecret) {
  console.error("FATAL: JWT_SECRET 环境变量未设置，生产环境必须配置。");
  process.exit(1);
}
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "8h";
const sessionCookieName = process.env.SESSION_COOKIE_NAME || "campus.sid";
const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 8 * 60 * 60 * 1000);
const ssoAuthorizeBaseUrl = (process.env.SSO_AUTHORIZE_BASE_URL || "https://id.sigs.tsinghua.edu.cn").replace(/\/$/, "");
const ssoApiBaseUrl = (process.env.SSO_API_BASE_URL || process.env.SSO_BASE_URL || "https://id.sigs.tsinghua.edu.cn").replace(/\/$/, "");
const ssoClientId = process.env.SSO_CLIENT_ID || "APP112";
const ssoClientSecret = process.env.SSO_CLIENT_SECRET || "";
const ssoRedirectUri = process.env.SSO_REDIRECT_URI || "http://10.103.0.148/oauth2";
const ssoLogoutUrl = process.env.SSO_LOGOUT_URL || "https://sso.sigs.tsinghua.edu.cn/portal/sso/logout.html";
const ssoLogoutRedirectUrl = process.env.SSO_LOGOUT_REDIRECT_URL || "http://10.103.0.148/";
const ssoStateCookieName = process.env.SSO_STATE_COOKIE_NAME || "campus.oauth_state";
const ssoStateMaxAgeMs = Number(process.env.SSO_STATE_MAX_AGE_MS || 10 * 60 * 1000);
const ssoStateSecret = process.env.SSO_STATE_SECRET || jwtSecret || ssoClientSecret || "dev-sso-state-secret";
const ssoAllowLegacyStateFallback = process.env.SSO_ALLOW_LEGACY_STATE_FALLBACK !== "0";
const uploadDir = path.join(__dirname, "uploads");
const allowedExt = new Set([".txt", ".docx", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg", ".zip", ".avi", ".mp4"]);
const sessions = new Map();
const oauthStates = new Map();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "请求过于频繁，请15分钟后再试" }
});

const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "请求过于频繁，请15分钟后再试" }
});

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExt.has(ext)) return cb(new Error("不支持的附件类型"));
    cb(null, true);
  }
});

app.use(cors());
app.use(logger.requestLogger);
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

const distPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(distPath, { index: false }));

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const index = item.indexOf("=");
      if (index === -1) return acc;
      acc[decodeURIComponent(item.slice(0, index))] = decodeURIComponent(item.slice(index + 1));
      return acc;
    }, {});
}

function createSession(res, user, options = {}) {
  const authSource = options.authSource || "local";
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionMaxAgeMs;
  sessions.set(sessionId, {
    loginUser: publicUser(user),
    authSource,
    accessToken: authSource === "sso" ? extractSsoAccessToken(options.tokenData || {}) : null,
    expiresAt
  });
  res.cookie(sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAgeMs,
    path: "/"
  });
  return sessions.get(sessionId);
}

function clearAuthCookies(res) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  };
  res.clearCookie(sessionCookieName, cookieOptions);
  res.clearCookie(ssoStateCookieName, cookieOptions);
}

function buildSsoLogoutUrl() {
  const logoutUrl = new URL(ssoLogoutUrl);
  logoutUrl.searchParams.set("redirectUrl", ssoLogoutRedirectUrl);
  return logoutUrl.toString();
}

function renderSsoLoginPage(payload) {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>统一身份认证登录中</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f8f8fb; }
    main { width: min(420px, calc(100vw - 40px)); padding: 28px; border: 1px solid #e5e7eb; border-radius: 16px; background: white; box-shadow: 0 18px 50px rgba(17, 24, 39, 0.10); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #4b5563; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <h1>统一身份认证登录成功</h1>
    <p>正在进入系统，请稍候。</p>
  </main>
  <script>
    const payload = ${safePayload};
    localStorage.setItem("token", payload.token);
    localStorage.setItem("user", JSON.stringify(payload.user));
    localStorage.removeItem("viewRole");
    window.location.replace(payload.redirect || "/");
  </script>
</body>
</html>`;
}

function renderSsoErrorPage(message) {
  const safeMessage = String(message || "统一身份认证登录失败").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>统一身份认证登录失败</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f8f8fb; }
    main { width: min(460px, calc(100vw - 40px)); padding: 28px; border: 1px solid #fecaca; border-radius: 16px; background: white; box-shadow: 0 18px 50px rgba(17, 24, 39, 0.10); }
    h1 { margin: 0 0 10px; font-size: 20px; color: #991b1b; }
    p { margin: 0 0 18px; color: #4b5563; line-height: 1.7; }
    a { color: #4f46e5; font-weight: 600; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <h1>统一身份认证登录失败</h1>
    <p>${safeMessage}</p>
    <a href="/local/login">返回登录页</a>
  </main>
</body>
</html>`;
}

async function loadSession(req, res) {
  const sessionId = parseCookies(req)[sessionCookieName];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session?.loginUser || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    if (res) clearAuthCookies(res);
    return null;
  }
  if (session.authSource !== "sso") {
    session.expiresAt = Date.now() + sessionMaxAgeMs;
    return session;
  }
  if (!session.accessToken) {
    sessions.delete(sessionId);
    if (res) clearAuthCookies(res);
    return null;
  }
  const now = Date.now();
  const recheckInterval = 15 * 60 * 1000;
  if (!session.lastSsoCheck || now - session.lastSsoCheck > recheckInterval) {
    try {
      await fetchSsoUserInfo(session.accessToken);
      session.lastSsoCheck = now;
    } catch (error) {
      sessions.delete(sessionId);
      if (res) clearAuthCookies(res);
      logger.warn("sso_session_access_token_invalid", {
        request_id: req.requestId,
        sso_ret: error.ssoRet ?? "",
        message: error.message,
        sso_response: sanitizeSsoResponse(error.ssoResponse)
      });
      return null;
    }
  }
  session.expiresAt = Date.now() + sessionMaxAgeMs;
  return session;
}

function randomState() {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let value = "";
  for (let index = 0; index < 24; index += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function signState(nonce, expiresAt, locale) {
  return crypto
    .createHmac("sha256", ssoStateSecret)
    .update(`${nonce}.${expiresAt}.${locale}`)
    .digest("base64url");
}

function createSignedState(locale = "cn") {
  const nonce = randomState();
  const expiresAt = Date.now() + ssoStateMaxAgeMs;
  const signature = signState(nonce, expiresAt, locale);
  return `${nonce}.${expiresAt}.${locale}.${signature}`;
}

function verifySignedState(state) {
  const parts = String(state || "").split(".");
  if (parts.length < 4) return null;
  const [nonce, expiresAtText, locale, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!nonce || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const expected = signState(nonce, expiresAt, locale);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ? locale
    : null;
}

function queryValue(req, names) {
  for (const name of names) {
    const value = req.query?.[name];
    if (Array.isArray(value)) {
      const first = value.find((item) => String(item || "").trim());
      if (first) return String(first).trim();
    } else if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function parseSsoCallbackParams(req) {
  return {
    code: queryValue(req, ["code", "auth_code", "authorization_code"]),
    state: queryValue(req, ["state", "oauth_state"]),
    relay: queryValue(req, ["r", "relay", "redirect", "redirect_uri"]),
    rawKeys: Object.keys(req.query || {})
  };
}

function createOauthState(res, locale = "cn") {
  const state = createSignedState(locale);
  const expiresAt = Date.now() + ssoStateMaxAgeMs;
  oauthStates.set(state, { expiresAt, locale });
  res.cookie(ssoStateCookieName, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ssoStateMaxAgeMs,
    path: "/"
  });
  return state;
}

function verifyOauthState(req, state) {
  const signedLocale = verifySignedState(state);
  if (signedLocale) {
    oauthStates.delete(state);
    return signedLocale;
  }

  const storedState = parseCookies(req)[ssoStateCookieName];
  const record = state ? oauthStates.get(state) : null;
  if (!state || !storedState || storedState !== state || !record || record.expiresAt <= Date.now()) {
    if (state) oauthStates.delete(state);
    return null;
  }
  const locale = record.locale || "cn";
  oauthStates.delete(state);
  return locale;
}

function shouldAllowLegacyState(req, state) {
  if (!ssoAllowLegacyStateFallback) return false;
  if (!/^[0-9a-z]{10,40}$/i.test(String(state || ""))) return false;
  const storedState = parseCookies(req)[ssoStateCookieName];
  const record = state ? oauthStates.get(state) : null;
  return !storedState && !record;
}

function ssoAuthorizeUrl(req, res) {
  const locale = (req.query?.locale || "").trim() || "cn";
  const state = createOauthState(res, locale);
  const authorizeUrl = new URL(`${ssoAuthorizeBaseUrl}/sso/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", ssoClientId);
  authorizeUrl.searchParams.set("redirect_uri", ssoRedirectUri);
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl.toString();
}

function firstString(...values) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return value ? value.trim() : "";
}

function extractSsoAccessToken(data) {
  const nested = data?.data || data?.result || {};
  const nestedUser = nested?.user || nested?.userinfo || {};
  return firstString(
    data?.access_token,
    data?.accessToken,
    data?.token,
    data?.tokenId,
    nested?.access_token,
    nested?.accessToken,
    nested?.token,
    nested?.tokenId,
    nestedUser?.access_token,
    nestedUser?.accessToken,
    nestedUser?.token,
    nestedUser?.tokenId
  );
}

function normalizeSsoUserInfo(data) {
  const source = data?.data?.user || data?.data?.userinfo || data?.userinfo || data?.user || data?.data || data || {};
  return {
    uid: firstString(source.uid, source.union_id, source.unionId, source.sn, source.loginName, source.username, source.userName, source.account, source.personId),
    name: firstString(source.name, source.personName, source.realName, source.userName, source.username, source.loginName, source.nickName),
    personType: firstString(source.personType, source.type, source.category),
    personId: firstString(source.personId, source.person_id, source.id, source.uid, source.sn),
    raw: data
  };
}

function sanitizeSsoResponse(data) {
  if (!data || typeof data !== "object") return data;
  const text = JSON.stringify(data, (key, value) => {
    if (/token|secret|password/i.test(key)) return value ? "[REDACTED]" : value;
    return value;
  });
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeSsoCodeForToken(code) {
  if (!ssoClientSecret) {
    const error = new Error("统一身份认证client_secret未配置");
    error.status = 500;
    throw error;
  }
  const tokenUrl = new URL(`${ssoApiBaseUrl}/sso/oauth/accessToken`);
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  tokenUrl.searchParams.set("client_id", ssoClientId);
  tokenUrl.searchParams.set("client_secret", ssoClientSecret);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("redirect_uri", ssoRedirectUri);

  const response = await fetchWithTimeout(tokenUrl, { method: "POST" });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { message: text };
  }

  const successCode = data.code === 0 || data.code === 200 || data.code === "0" || data.code === "200";
  const errorCode = data.error_code ?? data.errcode ?? data.error ?? (successCode ? undefined : data.code);
  if (!response.ok || errorCode || data.success === false || Number(data.ret) < 0) {
    const error = new Error(data.error_description || data.message || data.msg || "统一身份认证access_token换取失败");
    error.status = response.status || 502;
    error.ssoCode = String(errorCode || "");
    error.ssoResponse = data;
    throw error;
  }
  const accessToken = extractSsoAccessToken(data);
  if (!accessToken) {
    const error = new Error("统一身份认证响应缺少access_token");
    error.status = 502;
    error.ssoResponse = data;
    throw error;
  }
  data.access_token = accessToken;
  return data;
}

async function fetchSsoUserInfo(accessToken) {
  const userInfoUrl = new URL(`${ssoApiBaseUrl}/sso/oauth/userInfo`);
  userInfoUrl.searchParams.set("access_token", accessToken);

  const response = await fetchWithTimeout(userInfoUrl, { method: "POST" });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { message: text };
  }

  const successCode = data.code === 0 || data.code === 200 || data.code === "0" || data.code === "200";
  const hasRet = data.ret !== undefined && data.ret !== null;
  if (!response.ok || (hasRet ? Number(data.ret) !== 0 : (data.success === false || (data.code !== undefined && !successCode)))) {
    const error = new Error(Number(data.ret) === -1 ? "统一身份认证token无效或已过期，请重新登录" : data.msg || data.message || "统一身份认证用户信息获取失败");
    error.status = Number(data.ret) === -1 ? 401 : (response.status || 502);
    error.ssoRet = data.ret;
    error.ssoResponse = data;
    throw error;
  }
  const userInfo = normalizeSsoUserInfo(data);
  if (!userInfo.uid || !userInfo.name) {
    const error = new Error("统一身份认证用户信息缺少uid或name");
    error.status = 502;
    error.ssoResponse = data;
    throw error;
  }
  return userInfo;
}

async function completeSsoLogin(code) {
  const tokenData = await exchangeSsoCodeForToken(code);
  const ssoUser = await fetchSsoUserInfo(tokenData.access_token);
  const user = await loadOrCreateSsoPerson(ssoUser);
  return { tokenData, user };
}

async function handleSsoCallback(req, res) {
  const { code, state, relay, rawKeys } = parseSsoCallbackParams(req);
  logger.info("sso_callback_received", {
    request_id: req.requestId,
    query_keys: rawKeys,
    code_prefix: code.slice(0, 8),
    state,
    relay: relay ? "[received]" : ""
  });
  if (!code || !state) {
    return res.status(400).type("html").send(renderSsoErrorPage("认证回调缺少 code 或 state，请重新登录。"));
  }
  const stateLocale = verifyOauthState(req, state);
  if (!stateLocale && !shouldAllowLegacyState(req, state)) {
    logger.warn("sso_callback_state_check_failed", {
      request_id: req.requestId,
      code_prefix: code.slice(0, 8),
      state,
      query_keys: rawKeys,
      cookie_state_present: Boolean(parseCookies(req)[ssoStateCookieName]),
      memory_state_present: Boolean(oauthStates.get(state)),
      signed_state_valid: Boolean(verifySignedState(state))
    });
    return res.status(400).type("html").send(renderSsoErrorPage("state 校验失败，请重新发起统一身份认证登录。"));
  }
  const locale = stateLocale || "cn";
  try {
    const { tokenData, user } = await completeSsoLogin(code);
    createSession(res, user, { authSource: "sso", tokenData });
    logger.info("sso_callback_login_success", {
      request_id: req.requestId,
      code_prefix: code.slice(0, 8),
      state,
      expires_in: tokenData.expires_in || tokenData.expiresIn || null,
      user_id: user.id,
      union_id: user.union_id
    });
    return res.type("html").set("Cache-Control", "no-store").send(renderSsoLoginPage({
      token: signUser(user),
      user: publicUser(user),
      redirect: `/${locale}/`
    }));
  } catch (error) {
    const ssoCodeMessages = {
      "100016": "统一身份认证密钥错误，请检查 client_secret。",
      "100017": "授权码无效或已被使用，请重新获取 code。"
    };
    logger.warn("sso_callback_login_failed", {
      request_id: req.requestId,
      code_prefix: code.slice(0, 8),
      state,
      sso_code: error.ssoCode || "",
      sso_ret: error.ssoRet ?? "",
      message: error.message,
      sso_response: sanitizeSsoResponse(error.ssoResponse)
    });
    if (error.ssoRet === -1) {
      clearAuthCookies(res);
      return res.redirect(302, ssoAuthorizeUrl(req, res));
    }
    return res.status(error.ssoRet === -1 ? 401 : (error.status || 502))
      .type("html")
      .send(renderSsoErrorPage(ssoCodeMessages[error.ssoCode] || error.message || "access_token 获取失败。"));
  }
}

function isLocalLoginWhitelist(req) {
  const pathname = req.path;
  return (
    (req.method === "GET" && /^\/(?:cn|en)\/local\/login$/.test(pathname)) ||
    (req.method === "POST" && pathname === "/local/doLogin") ||
    (req.method === "GET" && pathname === "/sso/authorize-url") ||
    (req.method === "GET" && pathname === "/oauth2") ||
    (req.method === "POST" && pathname === "/sso/manual-code") ||
    (req.method === "GET" && pathname === "/sso/logout")
  );
}

app.get("/oauth2", handleSsoCallback);
app.get("/sso/callback", handleSsoCallback);

app.get("/", (req, res, next) => {
  if (req.query?.code || req.query?.state) {
    return handleSsoCallback(req, res);
  }
  return res.redirect(302, "/cn/");
});

function isPublicRoute(req) {
  const pathname = req.path;
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/uploads/") ||
    pathname === "/favicon.ico" ||
    pathname === "/tsinghua-sigs-logo.png" ||
    pathname === "/sigs-prompt-logo.svg"
  );
}

async function globalLoginInterceptor(req, res, next) {
  if (isPublicRoute(req) || isLocalLoginWhitelist(req)) return next();
  const session = await loadSession(req, res);
  if (session?.loginUser) {
    req.session = session;
    return next();
  }
  const token = tokenFromRequest(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      const user = await loadPerson(decoded.id);
      if (user) {
        req.session = createSession(res, user, { authSource: "local" });
        return next();
      }
    } catch (error) {
      // Token invalid or user not found, fall through to redirect.
    }
  }
  const locale = (req.path.match(/^\/(cn|en)\//) || [])[1] || "cn";
  return res.redirect(302, `/${locale}/local/login`);
}

app.use(globalLoginInterceptor);

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.union_id,
    union_id: user.union_id,
    name: user.name,
    phone: user.phone,
    role: user.role || "user",
    department: user.department,
    can_manage_roles: Boolean(user.can_manage_roles)
  };
}

function publicHandler(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    department: user.department
  };
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, role: user.role || "user", department: user.department },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

async function auth(req, res, next) {
  const session = req.session || await loadSession(req, res);
  if (session?.loginUser) {
    req.session = session;
    req.user = session.loginUser;
    return next();
  }

  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ code: "TOKEN_MISSING", message: "请先登录" });
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch (error) {
    const expired = error.name === "TokenExpiredError";
    res.status(401).json({
      code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      message: expired ? "登录已过期，请重新登录" : "登录已失效，请重新登录"
    });
  }
}

function isAdminLike(user) {
  if (!user) return false;
  return ["admin", "super_admin", "liaison"].includes(user.role);
}

async function loadPerson(id) {
  return get("SELECT * FROM datahub_basic_persons WHERE id = ?", [id]);
}

async function loadOrCreateSsoPerson(ssoUser) {
  await ensureDatahubPersonTables();
  const existing = await get(
    "SELECT * FROM datahub_basic_persons WHERE union_id = ? OR id = ? LIMIT 1",
    [ssoUser.uid, ssoUser.personId || ssoUser.uid]
  );
  if (existing) {
    // Sync role from admin_users if this person is a registered admin
    const adminRow = await get("SELECT role, department FROM admin_users WHERE union_id = ?", [ssoUser.uid]);
    const role = adminRow?.role || existing.role || "user";
    const dept = adminRow?.department || existing.department;
    await run(
      `UPDATE datahub_basic_persons
       SET union_id = ?, name = ?, type = COALESCE(NULLIF(?, ''), type),
           role = ?, department = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [ssoUser.uid, ssoUser.name, ssoUser.personType, role, dept, existing.id]
    );
    return get("SELECT * FROM datahub_basic_persons WHERE id = ?", [existing.id]);
  }

  const id = ssoUser.personId || `sso_${ssoUser.uid}`;
  const adminRow = await get("SELECT role, department FROM admin_users WHERE union_id = ?", [ssoUser.uid]);
  const role = adminRow?.role || "user";
  const dept = adminRow?.department || null;
  await run(
    `INSERT INTO datahub_basic_persons (id, union_id, username, name, type, role, department, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, ssoUser.uid, ssoUser.uid, ssoUser.name, ssoUser.personType, role, dept, JSON.stringify({ sso_person_id: ssoUser.personId })]
  );
  return get("SELECT * FROM datahub_basic_persons WHERE id = ?", [id]);
}

async function adminOnly(req, res, next) {
  try {
    const user = await loadPerson(req.user.id);
    if (!["admin", "super_admin", "liaison"].includes(user?.role)) {
      return res.status(403).json({ message: "需要管理员权限" });
    }
    req.user.role = user.role;
    req.user.department = user.department;
    next();
  } catch (error) {
    next(error);
  }
}

async function canManageRoles(req, res, next) {
  try {
    const user = await loadPerson(req.user.id);
    if (user?.role !== "super_admin" && !user?.can_manage_roles) {
      return res.status(403).json({ message: "需要角色管理权限" });
    }
    next();
  } catch (error) {
    next(error);
  }
}

function mapTicket(row) {
  if (!row) return row;
  return {
    ...row,
    is_anonymous: Boolean(row.is_anonymous)
  };
}

async function saveFiles(files, ticketId = null, replyId = null) {
  for (const file of files || []) {
    await run(
      `INSERT INTO attachments (ticket_id, reply_id, filename, original_name, file_path, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, replyId, file.filename, file.originalname, `/uploads/${file.filename}`, file.size, file.mimetype]
    );
  }
}

async function ticketDetails(id, viewer) {
  const ticket = await get(
    `SELECT t.*, p.name AS submitter_name, p.phone AS submitter_phone
     FROM tickets t
     JOIN datahub_basic_persons p ON p.id = t.submitter_id
     WHERE t.id = ?`,
    [id]
  );
  if (!ticket) return null;
  if (!isAdminLike(viewer) && ticket.submitter_id !== viewer.id) return null;
  if (isAdminLike(viewer) && ticket.is_anonymous) {
    ticket.submitter_name = "匿名";
    ticket.submitter_phone = "";
  }

  const replies = await all(
    `SELECT r.*, p.name AS replier_name
     FROM replies r
     JOIN datahub_basic_persons p ON p.id = r.replier_id
     WHERE r.ticket_id = ?
     ORDER BY r.created_at ASC`,
    [id]
  );
  const attachments = await all("SELECT * FROM attachments WHERE ticket_id = ? ORDER BY uploaded_at ASC", [id]);
  const replyAttachments = await all(
    `SELECT a.*
     FROM attachments a
     JOIN replies r ON r.id = a.reply_id
     WHERE r.ticket_id = ?
     ORDER BY a.uploaded_at ASC`,
    [id]
  );
  const ratings = await all("SELECT type, COUNT(*) AS count FROM ratings WHERE ticket_id = ? GROUP BY type", [id]);
  const satisfaction = await get(
    `SELECT s.*, p.name AS user_name
     FROM satisfaction_surveys s
     JOIN datahub_basic_persons p ON p.id = s.user_id
     WHERE s.ticket_id = ?`,
    [id]
  );
  const currentHandler = await get(
    `SELECT id, name, department
     FROM datahub_basic_persons
     WHERE role IN ('admin', 'super_admin', 'liaison') AND department = ?
     ORDER BY id ASC
     LIMIT 1`,
    [ticket.current_department || ticket.department || "党政办"]
  );
  const transfers = await all(
    `SELECT tr.*, operator.name AS operator_name, target_admin.name AS target_operator_name
     FROM transfers tr
     JOIN datahub_basic_persons operator ON operator.id = tr.operator_id
     LEFT JOIN datahub_basic_persons target_admin ON target_admin.id = (
       SELECT id
       FROM datahub_basic_persons
       WHERE role IN ('admin', 'super_admin', 'liaison') AND department = tr.to_department
       ORDER BY id ASC
       LIMIT 1
     )
     WHERE tr.ticket_id = ?
     ORDER BY tr.created_at ASC`,
    [id]
  );

  return {
    ticket: mapTicket(ticket),
    replies,
    attachments,
    replyAttachments,
    transfers,
    currentHandler: publicHandler(currentHandler),
    ratings: ratings.reduce((acc, item) => ({ ...acc, [item.type]: item.count }), {}),
    satisfaction: satisfaction || null
  };
}

app.post("/api/auth/login", async (req, res) => {
  return res.status(404).json({ message: "本地登录入口已迁移至 /local/login" });
});

app.post("/local/doLogin", authLimiter, async (req, res) => {
  const unionId = String(req.body.union_id || req.body.username || "").trim();
  const { password } = req.body;
  const adminUser = await get(
    "SELECT * FROM admin_users WHERE union_id = ? LIMIT 1",
    [unionId]
  );
  if (!adminUser || !await bcrypt.compare(password, adminUser.password_hash)) {
    logger.warn("auth_login_failed", { request_id: req.requestId, union_id: unionId, reason: "invalid_credentials" });
    return res.status(401).json({ message: "账号或密码错误，或该账号无后台管理权限" });
  }

  const user = await get(
    "SELECT * FROM datahub_basic_persons WHERE username = ? OR union_id = ? LIMIT 1",
    [unionId, unionId]
  );
  if (!user) {
    return res.status(500).json({ message: "管理员账号未同步到人员表，请联系超级管理员" });
  }

  await run("UPDATE datahub_basic_persons SET role = ?, department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [adminUser.role, adminUser.department, user.id]);

  logger.info("auth_login_success", {
    request_id: req.requestId,
    user_id: user.id,
    union_id: user.union_id,
    role: user.role,
    department: user.department
  });
  createSession(res, user, { authSource: "local" });
  res.json({
    token: signUser(user),
    expires_in: jwtExpiresIn,
    user: publicUser(user)
  });
});

app.get("/sso/authorize-url", ssoLimiter, (req, res) => {
  res.json({
    authorize_url: ssoAuthorizeUrl(req, res),
    response_type: "code",
    client_id: ssoClientId,
    redirect_uri: ssoRedirectUri
  });
});

app.post("/sso/manual-code", async (req, res) => {
  const code = String(req.body?.code || req.body?.auth_code || req.body?.authorization_code || "").trim();
  const state = String(req.body?.state || req.body?.oauth_state || "").trim();
  if (!code || !state) {
    return res.status(400).json({ message: "请填写认证回调 URL 中的 code 和 state" });
  }
  if (!verifyOauthState(req, state) && !shouldAllowLegacyState(req, state)) {
    logger.warn("sso_state_check_failed", {
      request_id: req.requestId,
      code_prefix: code.slice(0, 8),
      state,
      cookie_state_present: Boolean(parseCookies(req)[ssoStateCookieName]),
      memory_state_present: Boolean(oauthStates.get(state)),
      signed_state_valid: Boolean(verifySignedState(state))
    });
    return res.status(400).json({ message: "state校验失败，请重新发起统一身份认证登录" });
  }
  try {
    const { tokenData, user } = await completeSsoLogin(code);
    createSession(res, user, { authSource: "sso", tokenData });
    logger.info("sso_access_token_exchanged", {
      request_id: req.requestId,
      code_prefix: code.slice(0, 8),
      state,
      expires_in: tokenData.expires_in || tokenData.expiresIn || null,
      user_id: user.id,
      union_id: user.union_id
    });
    res.json({
      ok: true,
      state,
      token_received: true,
      user_info_received: true,
      expires_in: tokenData.expires_in || tokenData.expiresIn || null,
      token: signUser(user),
      user: publicUser(user),
      message: "统一身份认证登录成功。"
    });
  } catch (error) {
    const ssoCodeMessages = {
      "100016": "统一身份认证密钥错误，请检查client_secret",
      "100017": "授权码无效或已被使用，请重新获取code"
    };
    if (error.ssoRet === -1) {
      clearAuthCookies(res);
      return res.redirect(302, ssoAuthorizeUrl(req, res));
    }
    const status = error.ssoRet === -1 ? 401 : (error.status || 502);
    logger.warn("sso_access_token_exchange_failed", {
      request_id: req.requestId,
      code_prefix: code.slice(0, 8),
      state,
      sso_code: error.ssoCode || "",
      sso_ret: error.ssoRet ?? "",
      message: error.message,
      sso_response: sanitizeSsoResponse(error.ssoResponse)
    });
    res.status(status).json({
      message: ssoCodeMessages[error.ssoCode] || error.message || "access_token获取失败",
      sso_code: error.ssoCode || undefined,
      sso_ret: error.ssoRet ?? undefined
    });
  }
});

app.get("/sso/logout", (req, res) => {
  const sessionId = parseCookies(req)[sessionCookieName];
  if (sessionId) sessions.delete(sessionId);
  clearAuthCookies(res);
  res.redirect(302, buildSsoLogoutUrl());
});

app.get("/api/auth/me", auth, async (req, res) => {
  if (req.session?.loginUser) {
    return res.json(req.session.loginUser);
  }
  res.json(publicUser(await loadPerson(req.user.id)) || req.user);
});

app.get("/api/departments", auth, async (req, res) => {
  res.json(adminDepartments);
});

app.get("/api/form-options", auth, async (req, res) => {
  res.json(await listFormOptionsGrouped(false));
});

app.get("/api/admin/form-options", auth, adminOnly, async (req, res) => {
  const includeInactive = req.query.includeInactive !== "0";
  res.json(await listFormOptionsGrouped(includeInactive));
});

app.post("/api/admin/form-options", auth, adminOnly, async (req, res) => {
  const category = String(req.body.category || "").trim();
  const label = String(req.body.label || "").trim();
  if (!["fields", "departments"].includes(category)) {
    return res.status(400).json({ message: "无效配置分类" });
  }
  if (!label) return res.status(400).json({ message: "请填写配置名称" });
  try {
    const result = await createFormOption(category, label, req.body.sort_order, req.body.is_active !== false);
    res.status(201).json({ id: result.lastID });
  } catch (error) {
    if (/unique/i.test(error.message || "")) {
      return res.status(409).json({ message: "该配置已存在" });
    }
    throw error;
  }
});

app.patch("/api/admin/form-options/:id", auth, adminOnly, async (req, res) => {
  const result = await updateFormOption(req.params.id, req.body || {});
  if (!result.changes) return res.status(404).json({ message: "配置不存在或没有变化" });
  res.json({ ok: true });
});

app.delete("/api/admin/form-options/:id", auth, adminOnly, async (req, res) => {
  const result = await deleteFormOption(req.params.id);
  if (!result.changes) return res.status(404).json({ message: "配置不存在" });
  res.json({ ok: true });
});

app.post("/api/datahub/basic-persons", auth, async (req, res) => {
  const data = await fetchBasicPersons(req.body);
  res.json(data);
});

app.post("/api/datahub/basic-persons/sync", auth, adminOnly, async (req, res) => {
  res.json(await syncBasicPersons(req.body || {}));
});

app.get("/api/datahub/basic-persons/stored", auth, async (req, res) => {
  await ensureDatahubPersonTables();
  const pageSize = Math.min(Number(req.query.pageSize || 50), 500);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const keyword = String(req.query.keyword || "").trim();
  const department = String(req.query.department || "").trim();
  const params = [];
  const clauses = [];
  if (keyword) {
    clauses.push("(name LIKE ? OR union_id LIKE ? OR department LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (department) {
    clauses.push("department = ?");
    params.push(department);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await get(`SELECT COUNT(*) AS count FROM datahub_basic_persons ${where}`, params);
  const rows = await all(
    `SELECT id, union_id, name, type, category, department, status,
            appoint_attr, appointment_form, hire_post, write_date, synced_at, role, can_manage_roles
     FROM datahub_basic_persons
     ${where}
     ORDER BY write_date DESC, id ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ page, pageSize, total: total?.count || 0, rows });
});

app.patch("/api/admin/persons/:id", auth, adminOnly, canManageRoles, async (req, res) => {
  const { role, department, can_manage_roles } = req.body || {};
  const updates = [];
  const params = [];
  if (role !== undefined) {
    if (!["user", "admin", "super_admin", "liaison"].includes(role)) {
      return res.status(400).json({ message: "无效角色" });
    }
    updates.push("role = ?");
    params.push(role);
  }
  if (department !== undefined) {
    updates.push("department = ?");
    params.push(String(department).trim());
  }
  if (can_manage_roles !== undefined) {
    updates.push("can_manage_roles = ?");
    params.push(can_manage_roles ? 1 : 0);
  }
  if (!updates.length) return res.status(400).json({ message: "没有需要更新的字段" });
  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(req.params.id);
  const result = await run(
    `UPDATE datahub_basic_persons SET ${updates.join(", ")} WHERE id = ?`,
    params
  );
  if (!result.changes) return res.status(404).json({ message: "人员不存在" });
  res.json({ ok: true });
});

app.get("/api/tickets", auth, async (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const total = await get(
    "SELECT COUNT(*) AS count FROM tickets WHERE submitter_id = ?",
    [req.user.id]
  );
  const rows = await all(
    `SELECT t.*, COUNT(a.id) AS attachment_count
     FROM tickets t
     LEFT JOIN attachments a ON a.ticket_id = t.id
     WHERE t.submitter_id = ?
     GROUP BY t.id
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, pageSize, offset]
  );
  res.json({ page, pageSize, total: total?.count || 0, rows: rows.map(mapTicket) });
});

app.post("/api/tickets", auth, upload.array("attachments", 8), async (req, res) => {
  const { title, field, department, content, is_anonymous, phone } = req.body;
  if (!title || !field || !department || !content) return res.status(400).json({ message: "请填写标题、事项领域、部门和内容" });
  if (!adminDepartments.includes(department)) return res.status(400).json({ message: "请选择有效部门" });
  if (phone) await run("UPDATE datahub_basic_persons SET phone = ? WHERE id = ?", [phone, req.user.id]);

  const shareCode = crypto.randomBytes(12).toString("base64url");
  const result = await run(
    `INSERT INTO tickets (title, field, unit_type, department, current_department, content, is_anonymous, submitter_id, status, share_code)
     VALUES (?, ?, '', ?, '党政办', ?, ?, ?, 'pending', ?)`,
    [title, field, department, content, is_anonymous === "true" ? 1 : 0, req.user.id, shareCode]
  );
  await saveFiles(req.files, result.lastID, null);
  res.status(201).json({ id: result.lastID, share_code: shareCode });
});

app.get("/api/tickets/:id", auth, async (req, res) => {
  const details = await ticketDetails(req.params.id, req.user);
  if (!details) return res.status(404).json({ message: "事项不存在" });
  res.json(details);
});

app.post("/api/tickets/:id/ratings", auth, async (req, res) => {
  const { type } = req.body;
  if (!["like", "dislike", "favorite"].includes(type)) return res.status(400).json({ message: "无效评价类型" });
  const exists = await get("SELECT id FROM tickets WHERE id = ?", [req.params.id]);
  if (!exists) return res.status(404).json({ message: "事项不存在" });
  await run("INSERT OR IGNORE INTO ratings (ticket_id, user_id, type) VALUES (?, ?, ?)", [req.params.id, req.user.id, type]);
  res.json({ ok: true });
});

app.post("/api/tickets/:id/satisfaction", auth, async (req, res) => {
  const score = Number(req.body?.score);
  const comment = String(req.body?.comment || "").trim();
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return res.status(400).json({ message: "请选择 1-5 分满意度评分" });
  }
  if (comment.length > 500) return res.status(400).json({ message: "评价内容不能超过 500 字" });
  const ticket = await get("SELECT id, submitter_id, status FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (ticket.submitter_id !== req.user.id) return res.status(403).json({ message: "只有事项发起人可以进行满意度评价" });
  if (ticket.status !== "completed") return res.status(400).json({ message: "事项处理完成后才可以评价" });
  const existingSurvey = await get("SELECT id FROM satisfaction_surveys WHERE ticket_id = ?", [req.params.id]);
  if (existingSurvey) return res.status(409).json({ message: "该事项已提交满意度评价，不能重复评价" });
  await run(
    `INSERT INTO satisfaction_surveys (ticket_id, user_id, score, comment, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [req.params.id, req.user.id, score, comment]
  );
  res.json({ ok: true });
});

app.get("/api/admin/tickets", auth, adminOnly, async (req, res) => {
  const user = await loadPerson(req.user.id);
  const pageSize = Math.min(Number(req.query.pageSize || 30), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const params = [];
  const isGlobalAdmin = user?.role === "super_admin" || (user?.role === "admin" && user?.department === "党政办");
  let scope = "";
  if (!isGlobalAdmin && user?.department) {
    scope = "WHERE t.department = ?";
    params.push(user.department);
  }

  const countRow = await get(
    `SELECT COUNT(*) AS count FROM tickets t
     JOIN datahub_basic_persons p ON p.id = t.submitter_id
     ${scope}`,
    params
  );

  const rows = await all(
    `SELECT t.*,
            CASE WHEN t.is_anonymous = 1 THEN '匿名' ELSE p.name END AS submitter_name,
            CASE WHEN t.is_anonymous = 1 THEN '' ELSE p.phone END AS submitter_phone,
            s.score AS satisfaction_score,
            s.comment AS satisfaction_comment,
            s.updated_at AS satisfaction_updated_at,
            COUNT(a.id) AS attachment_count
     FROM tickets t
     JOIN datahub_basic_persons p ON p.id = t.submitter_id
     LEFT JOIN attachments a ON a.ticket_id = t.id
     LEFT JOIN satisfaction_surveys s ON s.ticket_id = t.id
     ${scope}
     GROUP BY t.id
     ORDER BY t.updated_at DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ page, pageSize, total: countRow?.count || 0, rows: rows.map(mapTicket) });
});

app.post("/api/admin/tickets/:id/replies", auth, adminOnly, upload.array("attachments", 8), async (req, res) => {
  const { content, status } = req.body;
  if (!content) return res.status(400).json({ message: "请填写回复内容" });
  const user = await loadPerson(req.user.id);
  const ticket = await get("SELECT id, current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (!user?.department || user.department !== ticket.current_department) {
    return res.status(403).json({ message: "只有当前承办部门管理员可以回复处理" });
  }
  if (status && !["completed", "pending"].includes(status)) return res.status(400).json({ message: "无效状态" });
  const result = await run(
    "INSERT INTO replies (ticket_id, content, replier_id, department) VALUES (?, ?, ?, ?)",
    [req.params.id, content, req.user.id, user.department]
  );
  await saveFiles(req.files, null, result.lastID);
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status || "completed", req.params.id]);
  res.status(201).json({ id: result.lastID });
});

app.patch("/api/admin/tickets/:id/status", auth, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!["pending", "completed"].includes(status)) return res.status(400).json({ message: "无效状态" });
  const user = await loadPerson(req.user.id);
  const ticket = await get("SELECT current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (!user?.department || user.department !== ticket.current_department) {
    return res.status(403).json({ message: "只有当前承办部门管理员可以更新状态" });
  }
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, req.params.id]);
  res.json({ ok: true });
});

app.post("/api/admin/tickets/:id/transfer", auth, adminOnly, async (req, res) => {
  const { to_department, note } = req.body;
  if (!adminDepartments.includes(to_department)) return res.status(400).json({ message: "请选择有效转办部门" });
  const user = await loadPerson(req.user.id);
  const ticket = await get("SELECT id, current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (!user?.department || user.department !== ticket.current_department) {
    return res.status(403).json({ message: "只能由当前承办部门转办事项" });
  }
  if (to_department === ticket.current_department) return res.status(400).json({ message: "不能转办给当前承办部门" });
  await run(
    "INSERT INTO transfers (ticket_id, from_department, to_department, operator_id, note) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, ticket.current_department || "党政办", to_department, req.user.id, note || ""]
  );
  await run("UPDATE tickets SET current_department = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [to_department, req.params.id]);
  res.json({ ok: true });
});

app.patch("/api/admin/tickets/:id/publish", auth, adminOnly, async (req, res) => {
  const { is_published } = req.body;
  await run(
    `UPDATE tickets
     SET is_published = ?, published_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [is_published ? 1 : 0, is_published ? 1 : 0, req.params.id]
  );
  res.json({ ok: true });
});

app.delete("/api/admin/tickets/:id", auth, adminOnly, async (req, res) => {
  const files = await all("SELECT file_path FROM attachments WHERE ticket_id = ?", [req.params.id]);
  await run("DELETE FROM tickets WHERE id = ?", [req.params.id]);
  for (const file of files) {
    try { fs.unlinkSync(path.join(uploadDir, path.basename(file.file_path))); } catch (e) { /* ignore */ }
  }
  res.json({ ok: true });
});

setInterval(async () => {
  try {
    const orphaned = await all(
      `SELECT a.file_path FROM attachments a
       LEFT JOIN tickets t ON t.id = a.ticket_id
       LEFT JOIN replies r ON r.id = a.reply_id
       WHERE t.id IS NULL AND r.id IS NULL`
    );
    for (const row of orphaned) {
      try { fs.unlinkSync(path.join(uploadDir, path.basename(row.file_path))); } catch (e) { /* ignore */ }
      await run("DELETE FROM attachments WHERE file_path = ?", [row.file_path]);
    }
  } catch (e) { /* ignore cleanup errors */ }
}, 60 * 60 * 1000);

app.get("/api/public/typical-tickets", async (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const total = await get("SELECT COUNT(*) AS count FROM tickets WHERE is_published = 1");
  const rows = await all(
    `SELECT t.id, t.title, t.field, t.department, t.content, t.created_at, t.published_at,
            r.content AS reply_content, r.department AS reply_department, r.created_at AS reply_time
     FROM tickets t
     LEFT JOIN replies r ON r.id = (
       SELECT id FROM replies WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
     )
     WHERE t.is_published = 1
     ORDER BY t.published_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  res.json({ page, pageSize, total: total?.count || 0, rows });
});

app.get("/api/public/ticket/:shareCode", async (req, res) => {
  const ticket = await get(
    `SELECT t.*, p.name AS submitter_name, p.phone AS submitter_phone
     FROM tickets t
     JOIN datahub_basic_persons p ON p.id = t.submitter_id
     WHERE t.share_code = ?`,
    [req.params.shareCode]
  );
  if (!ticket) return res.status(404).json({ message: "事项不存在或链接已失效" });

  if (ticket.is_anonymous) {
    ticket.submitter_name = "匿名";
    ticket.submitter_phone = "";
  }

  const replies = await all(
    `SELECT r.*, p.name AS replier_name
     FROM replies r
     JOIN datahub_basic_persons p ON p.id = r.replier_id
     WHERE r.ticket_id = ?
     ORDER BY r.created_at ASC`,
    [ticket.id]
  );
  const attachments = await all("SELECT * FROM attachments WHERE ticket_id = ? ORDER BY uploaded_at ASC", [ticket.id]);
  const transfers = await all(
    `SELECT tr.*, operator.name AS operator_name
     FROM transfers tr
     JOIN datahub_basic_persons operator ON operator.id = tr.operator_id
     WHERE tr.ticket_id = ?
     ORDER BY tr.created_at ASC`,
    [ticket.id]
  );

  res.json({ ticket: mapTicket(ticket), replies, attachments, transfers });
});

app.get("/:locale/local/login", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.get("/local/login", (req, res) => {
  res.redirect(302, "/cn/local/login");
});

app.use((err, req, res, next) => {
  logger.error("request_error", {
    request_id: req.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    user_id: req.user?.id,
    error: err
  });
  if (err instanceof multer.MulterError || err.message === "不支持的附件类型") {
    return res.status(400).json({ message: err.message });
  }
  console.error(err);
  res.status(500).json({ message: "服务器内部错误" });
});

app.use("/api", (req, res) => {
  res.status(404).json({ message: "接口不存在" });
});

app.get("*", (req, res, next) => {
  if (/^\/(?:cn|en)\//.test(req.path)) {
    return res.sendFile(path.join(distPath, "index.html"));
  }
  return res.redirect(302, "/cn/");
});

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(key);
  }
  for (const [key, state] of oauthStates) {
    if (state.expiresAt <= now) oauthStates.delete(key);
  }
}, 5 * 60 * 1000);

initDb()
  .then(() => {
    const server = app.listen(port, host, () => {
      logger.info("server_started", { host, port });
      console.log(`API server running at http://${host}:${port}`);
      console.log("Seed accounts: student/123456, admin/123456");
    });
    server.keepAliveTimeout = 65 * 1000;
    server.headersTimeout = 70 * 1000;
  })
  .catch((error) => {
    logger.error("server_start_failed", { error });
    console.error("Failed to init database", error);
    process.exit(1);
  });

process.on("unhandledRejection", (reason) => {
  logger.error("process_unhandled_rejection", { error: reason instanceof Error ? reason : { message: String(reason) } });
});

process.on("uncaughtException", (error) => {
  logger.error("process_uncaught_exception", { error });
  console.error(error);
  process.exit(1);
});
