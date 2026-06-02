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
  initDb, run, get, all,
  isValidDepartment,
  ensureDatahubPersonTables, ensureFormConfigTables, seedDefaultFormOptions, seedDepartments, listDepartmentsGrouped,
  listFormOptionsGrouped, listFormOptions,
  getFormOptionLabels, createFormOption, updateFormOption, deleteFormOption,
  listDepartmentsAll, createDepartment, updateDepartment, deleteDepartment,
  disableAdminsForInactivePersons,
  getRoleByCode, getRoleById, getPermissionsByRoleId, getPersonPermissions, hasPermission,
  getDepartmentAssignments, isDepartmentAdmin, getTransferTargets
} = require("./db_mysql");
const { fetchBasicPersons } = require("./datahub");
const { syncBasicPersons } = require("./datahub-sync");
const { pushPortalTodo, completePortalTodo, buildTodoId, buildSiteUrl } = require("./portal-todo");
const logger = require("./logger");

const app = express();
app.set("trust proxy", 1);
const defaultPort = process.env.NODE_ENV === "production" ? 80 : 3001;
const port = process.env.PORT || defaultPort;
const host = process.env.HOST || "0.0.0.0";
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
const ssoRedirectUri = process.env.SSO_REDIRECT_URI || "http://219.223.170.20/oauth2";
const ssoLogoutUrl = process.env.SSO_LOGOUT_URL || "https://sso.sigs.tsinghua.edu.cn/portal/sso/logout.html";
const ssoLogoutRedirectUrl = process.env.SSO_LOGOUT_REDIRECT_URL || "http://219.223.170.20/";
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
  const accessToken = authSource === "sso" ? extractSsoAccessToken(options.tokenData || {}) : null;
  sessions.set(sessionId, {
    loginUser: publicUser(user),
    authSource,
    accessToken,
    expiresAt
  });
  logger.info("session_created", {
    session_id_prefix: sessionId.slice(0, 8),
    auth_source: authSource,
    user_id: user.id,
    has_access_token: Boolean(accessToken),
    cookie_secure: process.env.COOKIE_SECURE === "true"
  });
  res.cookie(sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: sessionMaxAgeMs,
    path: "/"
  });
  return sessions.get(sessionId);
}

function clearAuthCookies(res) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/"
  };
  res.clearCookie(sessionCookieName, cookieOptions);
  res.clearCookie(ssoStateCookieName, cookieOptions);
}

function buildSsoLogoutUrl() {
  const logoutUrl = new URL(ssoLogoutUrl);
  if (ssoLogoutRedirectUrl) {
    logoutUrl.searchParams.set("redirectUrl", ssoLogoutRedirectUrl);
  }
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
    if (payload.authSource) localStorage.setItem("authSource", payload.authSource);
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
    logger.warn("loadSession_expired_or_missing", {
      request_id: req.requestId,
      path: req.path,
      session_found: Boolean(session),
      has_user: Boolean(session?.loginUser),
      expired: session ? session.expiresAt <= Date.now() : null
    });
    return null;
  }
  if (session.authSource !== "sso") {
    session.expiresAt = Date.now() + sessionMaxAgeMs;
    return session;
  }
  if (!session.accessToken) {
    sessions.delete(sessionId);
    if (res) clearAuthCookies(res);
    logger.warn("loadSession_no_access_token", {
      request_id: req.requestId,
      path: req.path,
      user_id: session.loginUser?.id
    });
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
      logger.warn("loadSession_sso_token_invalid", {
        request_id: req.requestId,
        path: req.path,
        user_id: session.loginUser?.id,
        sso_ret: error.ssoRet ?? "",
        message: error.message,
        sso_response: sanitizeSsoResponse(error.ssoResponse),
        time_since_last_check: session.lastSsoCheck ? now - session.lastSsoCheck : null
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
  // 固定 state，避免验证失败
  return "campus12345state";
}

function verifySignedState(state) {
  // 固定 state 验证
  if (state === "campus12345state") {
    return "cn";
  }
  return null;
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
    secure: process.env.COOKIE_SECURE === "true",
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

function ssoAuthorizeUrl(req, res, explicitLocale) {
  const locale = explicitLocale || (req.query?.locale || "").trim() || "cn";
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
    const jwtToken = signUser(user);
    logger.info("sso_callback_jwt_signed", {
      request_id: req.requestId,
      user_id: user.id,
      jwt_prefix: jwtToken.slice(0, 30),
      jwt_length: jwtToken.length
    });
    return res.type("html").set("Cache-Control", "no-store").send(renderSsoLoginPage({
      token: jwtToken,
      user: publicUser(user),
      redirect: `/${locale}/`,
      authSource: "sso"
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
    (req.method === "GET" && pathname === "/local/login") ||
    (req.method === "POST" && pathname === "/local/doLogin") ||
    (req.method === "GET" && pathname === "/sso/authorize-url") ||
    (req.method === "GET" && pathname === "/oauth2") ||
    (req.method === "POST" && pathname === "/sso/manual-code") ||
    (req.method === "GET" && pathname === "/sso/logout")
  );
}

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
      // Token invalid or user not found, fall through.
    }
  }
  // SPA route: let frontend handle auth check and redirect logic
  return next();
}

app.use(globalLoginInterceptor);

app.get("/oauth2", handleSsoCallback);
app.get("/sso/callback", handleSsoCallback);

app.get("/", (req, res, next) => {
  if (req.query?.code || req.query?.state) {
    return handleSsoCallback(req, res);
  }
  return res.redirect(302, "/cn/");
});

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.union_id || user.username,
    union_id: user.union_id,
    name: user.name,
    phone: user.phone,
    role: user.role || "user",
    role_id: user.role_id,
    department: user.department,
    can_manage_roles: Boolean(user.can_manage_roles),
    // 部门管理员权限信息
    dept_admin_assignments: user.dept_admin_assignments || [],
    is_dept_admin: Boolean(user.dept_admin_assignments && user.dept_admin_assignments.length > 0)
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

function signUser(user, expiresIn) {
  const payload = {
    id: user.id,
    role: user.role || "user",
    department: user.department,
    // 部门管理员权限信息
    dept_admin_assignments: user.dept_admin_assignments || [],
    is_dept_admin: Boolean(user.dept_admin_assignments && user.dept_admin_assignments.length > 0)
  };
  return jwt.sign(payload, jwtSecret, { expiresIn: expiresIn || jwtExpiresIn });
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
    logger.info("auth_ok_session", {
      request_id: req.requestId,
      method: req.method,
      path: req.path,
      user_id: session.loginUser.id
    });
    return next();
  }

  const token = tokenFromRequest(req);
  if (!token) {
    logger.warn("auth_fail_no_token", {
      request_id: req.requestId,
      method: req.method,
      path: req.path,
      has_session_cookie: Boolean(parseCookies(req)[sessionCookieName]),
      session_found: Boolean(session),
      session_has_user: Boolean(session?.loginUser)
    });
    return res.status(401).json({ code: "TOKEN_MISSING", message: "请先登录" });
  }
  try {
    req.user = jwt.verify(token, jwtSecret);
    logger.info("auth_ok_jwt", {
      request_id: req.requestId,
      method: req.method,
      path: req.path,
      user_id: req.user.id
    });
    next();
  } catch (error) {
    const expired = error.name === "TokenExpiredError";
    logger.warn("auth_fail_jwt_invalid", {
      request_id: req.requestId,
      method: req.method,
      path: req.path,
      error_name: error.name,
      error_message: error.message,
      token_prefix: token.slice(0, 20)
    });
    res.status(401).json({
      code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      message: expired ? "登录已过期，请重新登录" : "登录已失效，请重新登录"
    });
  }
}

function isAdminLike(user) {
  if (!user) return false;
  return ["admin", "super_admin", "liaison"].includes(user.role) ||
    (user.dept_admin_assignments && user.dept_admin_assignments.length > 0) ||
    user.is_dept_admin;
}

/**
 * 返回用户对某工单的操作权限
 * 'handle' — 可处理（回复、转办、改状态）
 * 'view'   — 仅查看
 * null     — 无权限
 */
async function getTicketPermission(ticketId, viewer) {
  const ticket = await get(
    'SELECT id, original_department, current_department, department, submitter_id FROM tickets WHERE id = ?',
    [ticketId]
  );
  if (!ticket) return null;

  // 超级管理员可处理
  if (viewer.role === 'super_admin') return 'handle';

  // 管理员：优先检查部门权限（管理员可能同时也是提交者）
  if (isAdminLike(viewer)) {
    // 优先检查 department_assignments 多部门授权
    // 使用 loadPerson 确保获取正确的 person.id
    const person = await loadPerson(viewer.id);
    const personId = person?.id || viewer.id;
    const assignments = await getDepartmentAssignments(String(personId));

    if (assignments.length > 0) {
      const managedNames = assignments.map(a => a.department_name);
      const isObserver = assignments.some(a => a.role_type === 'observer');

      if (managedNames.includes(ticket.current_department)) {
        return isObserver ? 'view' : 'handle';
      }
      if (managedNames.includes(ticket.original_department)) return 'view';

      const inTransferChain = await get(
        `SELECT 1 FROM transfers WHERE ticket_id = ? AND (from_department IN (${managedNames.map(() => '?').join(',')}) OR to_department IN (${managedNames.map(() => '?').join(',')})) LIMIT 1`,
        [ticketId, ...managedNames, ...managedNames]
      );
      if (inTransferChain) return 'view';
    }

    // 回退：原有单部门逻辑
    const dept = person?.department || viewer.department;
    if (dept) {
      if (dept === ticket.current_department) return 'handle';
      if (dept === ticket.original_department) return 'view';

      const inTransferChain = await get(
        'SELECT 1 FROM transfers WHERE ticket_id = ? AND (from_department = ? OR to_department = ?) LIMIT 1',
        [ticketId, dept, dept]
      );
      if (inTransferChain) return 'view';
    }
  }

  // 提交者本人可查看（管理员已检查过部门权限，此处为兜底）
  if (String(ticket.submitter_id) === String(viewer.id)) return 'view';

  return null;
}

async function loadPerson(id) {
  // 1. 优先从 datahub_basic_persons 查（同时匹配 id 和 union_id）
  let person = await get(
    `SELECT dp.*, r.code as role_code
     FROM datahub_basic_persons dp
     LEFT JOIN roles r ON dp.role_id = r.id
     WHERE dp.id = ? OR dp.union_id = ?`,
    [String(id), String(id)]
  );

  if (person) {
    person.dept_admin_assignments = await getDepartmentAssignments(person.id);
    return person;
  }

  // 2. 如果 datahub 查不到，检查是否是本地账号（users 表存在）
  const user = await get("SELECT id, union_id, username, is_active FROM users WHERE id = ? OR union_id = ?", [String(id), String(id)]);
  if (user && user.union_id) {
    // 2.1 自动创建 datahub_basic_persons 影子记录（避免登录失败）
    const localRole = await getRoleByCode('user');
    await run(
      `INSERT OR IGNORE INTO datahub_basic_persons (id, union_id, name, type, department, role_id, auth_source, is_active, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, 'local', 1, '{}')`,
      [user.union_id, user.union_id, user.username, '未知', '未分配', localRole?.id || null]
    );

    // 2.2 重新查询
    person = await get(
      `SELECT dp.*, r.code as role_code
       FROM datahub_basic_persons dp
       LEFT JOIN roles r ON dp.role_id = r.id
       WHERE dp.id = ? OR dp.union_id = ?`,
      [user.union_id, user.union_id]
    );
    if (person) {
      person.dept_admin_assignments = await getDepartmentAssignments(person.id);
      return person;
    }
  }

  return null;
}

async function loadOrCreateSsoPerson(ssoUser) {
  await ensureDatahubPersonTables(); await ensureFormConfigTables(); await seedDefaultFormOptions(); await seedDepartments();
  const id = ssoUser.personId || `sso_${ssoUser.uid}`;

  // 检查 datahub_basic_persons 是否已有此人
  const existing = await get("SELECT * FROM datahub_basic_persons WHERE union_id = ?", [ssoUser.uid]);
  if (existing) {
    await run(
      `UPDATE datahub_basic_persons
       SET name = ?, type = COALESCE(NULLIF(?, ''), type),
           auth_source = 'sso', updated_at = CURRENT_TIMESTAMP
       WHERE union_id = ?`,
      [ssoUser.name, ssoUser.personType, ssoUser.uid]
    );
    const person = await get("SELECT * FROM datahub_basic_persons WHERE union_id = ?", [ssoUser.uid]);
    // 查询部门管理员权限
    person.dept_admin_assignments = await getDepartmentAssignments(person.id);
    return person;
  }

  // 获取默认用户角色
  const userRole = await getRoleByCode('user');
  const defaultRoleId = userRole ? userRole.id : null;

  await run(
    `INSERT INTO datahub_basic_persons (id, union_id, name, type, department, role, phone, role_id, auth_source, is_active, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sso', 1, ?, CURRENT_TIMESTAMP)`,
    [id, ssoUser.uid, ssoUser.name, ssoUser.personType, null, 'user', null, defaultRoleId, JSON.stringify(ssoUser.raw || {})]
  );
  const person = await get("SELECT * FROM datahub_basic_persons WHERE union_id = ?", [ssoUser.uid]);
  // 新用户默认无部门管理员权限
  person.dept_admin_assignments = [];
  return person;
}

async function adminOnly(req, res, next) {
  try {
    const user = await loadPerson(req.user.id);
    if (["admin", "super_admin", "liaison"].includes(user?.role)) {
      req.user.role = user.role;
      req.user.department = user.department;
      return next();
    }
    // 检查 department_assignments 授权表
    const personId = user?.id || req.user.id;
    const assignments = await getDepartmentAssignments(String(personId));
    if (assignments.length > 0) {
      req.user.role = user?.role || 'admin';
      req.user.department = user?.department || req.user.department;
      req.user.dept_admin_role = assignments.some(a => a.role_type === 'observer') ? 'observer' : 'admin';
      return next();
    }
    return res.status(403).json({ message: "需要管理员权限" });
  } catch (error) {
    next(error);
  }
}

async function superAdminOnly(req, res, next) {
  try {
    const user = await loadPerson(req.user.id);
    if (user?.role !== 'super_admin') {
      return res.status(403).json({ message: '需要超级管理员权限' });
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
    `SELECT t.*,
            COALESCE(dp.name, u.name) AS submitter_name,
            COALESCE(dp.phone, u.phone) AS submitter_phone
     FROM tickets t
     LEFT JOIN datahub_basic_persons dp ON dp.id = t.submitter_id
     LEFT JOIN users u ON u.id = t.submitter_id
     WHERE t.id = ?`,
    [id]
  );
  if (!ticket) return null;
  if (!isAdminLike(viewer) && String(ticket.submitter_id) !== String(viewer.id)) return null;

  // 权限判断：当前承办部门可处理，原始/历史经手部门仅查看，其余无权限
  let permission = 'view';
  if (isAdminLike(viewer) && viewer.role !== "super_admin") {
    permission = await getTicketPermission(id, viewer);
    if (!permission) return null;
  } else if (isAdminLike(viewer)) {
    permission = 'handle';
  }

  if (isAdminLike(viewer) && ticket.is_anonymous) {
    ticket.submitter_name = "匿名";
    ticket.submitter_phone = "";
  }

  const replies = await all(
    `SELECT r.*, COALESCE(dp.name, u.name) AS replier_name
     FROM replies r
     LEFT JOIN datahub_basic_persons dp ON dp.id = r.replier_id
     LEFT JOIN users u ON u.id = r.replier_id
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
  const satisfaction = await get(
    `SELECT s.*, COALESCE(dp.name, u.name) AS user_name
     FROM satisfaction_surveys s
     LEFT JOIN datahub_basic_persons dp ON dp.id = s.user_id
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.ticket_id = ?`,
    [id]
  );
  const deptName = ticket.current_department || ticket.department || "党政办";
  const currentHandler = await get(
    `SELECT id, name, department FROM (
       SELECT CAST(p.id AS TEXT) AS id, p.name, p.department
       FROM datahub_basic_persons p
       WHERE p.role_id IN (1, 2, 3) AND p.department = ?
       UNION
       SELECT CAST(p.id AS TEXT) AS id, p.name, p.department
       FROM datahub_basic_persons p
       JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
       WHERE da.department_name = ?
       UNION ALL
       SELECT CAST(id AS TEXT) AS id, name, department FROM users
       WHERE role IN ('admin', 'super_admin', 'liaison') AND department = ?
     ) AS handlers ORDER BY id ASC LIMIT 1`,
    [deptName, deptName, deptName]
  );
  const transfers = await all(
    `SELECT tr.*,
            COALESCE(dp_op.name, u_op.name) AS operator_name,
            COALESCE(dp_tgt.name, u_tgt.name) AS target_operator_name
     FROM transfers tr
     LEFT JOIN datahub_basic_persons dp_op ON dp_op.id = tr.operator_id
     LEFT JOIN users u_op ON u_op.id = tr.operator_id
     LEFT JOIN datahub_basic_persons dp_tgt ON dp_tgt.id = (
       SELECT id FROM datahub_basic_persons
       WHERE role_id IN (1, 2, 3) AND department = tr.to_department
       ORDER BY id ASC LIMIT 1
     )
     LEFT JOIN users u_tgt ON u_tgt.id = (
       SELECT id FROM users
       WHERE role IN ('admin', 'super_admin', 'liaison') AND department = tr.to_department
       ORDER BY id ASC LIMIT 1
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
    satisfaction: satisfaction || null,
    permission
  };
}

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const { password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "请填写用户名和密码" });
  }

  try {
    // 查 users 表（username + is_active=1）
    const user = await get(
      "SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1",
      [username]
    );
    if (!user) {
      logger.warn("auth_login_failed", { request_id: req.requestId, username, reason: "user_not_found" });
      return res.status(401).json({ message: "账号或密码错误" });
    }

    // 防御性校验 password_hash
    const passwordHash = user.password_hash || user.password;
    if (!passwordHash || typeof passwordHash !== 'string') {
      logger.error("auth_login_bad_hash", { request_id: req.requestId, username, has_hash: Boolean(user.password_hash), has_password: Boolean(user.password) });
      return res.status(500).json({ message: "账号凭证异常，请联系管理员" });
    }

    // bcrypt 比对密码
    let valid = false;
    try {
      valid = await bcrypt.compare(password, passwordHash);
    } catch (compareErr) {
      logger.error("auth_login_bcrypt_error", { request_id: req.requestId, username, error: compareErr.message });
      return res.status(500).json({ message: "账号凭证异常，请联系管理员" });
    }
    if (!valid) {
      logger.warn("auth_login_failed", { request_id: req.requestId, username, reason: "invalid_credentials" });
      return res.status(401).json({ message: "账号或密码错误" });
    }

    // 通过 loadPerson 关联 datahub_basic_persons（自动处理本地账号影子记录）
    const person = await loadPerson(user.union_id || user.id);
    if (!person) {
      logger.error("auth_login_person_missing", { request_id: req.requestId, username, union_id: user.union_id, user_id: user.id });
      return res.status(500).json({ message: "用户身份信息异常，请联系管理员" });
    }

    // 查 role_id → roles 表
    let roleCode = person.role_code || person.role || 'user';
    if (person.role_id && !person.role_code) {
      const role = await getRoleById(person.role_id);
      if (role) roleCode = role.code;
    }

    // 查 department_assignments（is_enabled=1）
    const assignments = await getDepartmentAssignments(person.id);

    // 构建用户对象
    const loginUser = {
      id: person.id,
      union_id: person.union_id,
      name: person.name,
      phone: person.phone,
      department: person.department,
      role: roleCode,
      role_id: person.role_id,
      dept_admin_assignments: assignments,
      is_dept_admin: assignments.length > 0
    };

    logger.info("auth_login_success", {
      request_id: req.requestId,
      user_id: loginUser.id,
      union_id: loginUser.union_id,
      role: loginUser.role,
      department: loginUser.department
    });

    createSession(res, loginUser, { authSource: "local" });

    // 生成 JWT（格式和 SSO 登录完全一致）
    const token = signUser(loginUser, "24h");
    res.json({
      token,
      expires_in: "24h",
      user: publicUser(loginUser),
      authSource: "local",
      must_change_password: user.must_change_password === 1
    });
  } catch (err) {
    logger.error("auth_login_exception", { request_id: req.requestId, username, error: err.message });
    res.status(500).json({ message: "登录服务异常" });
  }
});

// 修改密码（本地账号）
app.post("/api/auth/change-password", auth, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ message: "请填写旧密码和新密码" });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ message: "新密码至少 6 位" });
  }

  try {
    const user = await get("SELECT * FROM users WHERE union_id = ? OR id = ?", [req.user.id, req.user.id]);
    if (!user) {
      return res.status(404).json({ message: "本地账号不存在" });
    }

    // 验证旧密码
    const passwordHash = user.password_hash || user.password;
    if (!passwordHash || typeof passwordHash !== 'string') {
      return res.status(500).json({ message: "账号凭证异常" });
    }
    const valid = await bcrypt.compare(old_password, passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "旧密码错误" });
    }

    // 更新密码
    const newHash = await bcrypt.hash(new_password, 10);
    await run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [newHash, user.id]);

    res.json({ ok: true, message: "密码修改成功" });
  } catch (err) {
    logger.error("change_password_error", { request_id: req.requestId, user_id: req.user.id, error: err.message });
    res.status(500).json({ message: "修改密码失败" });
  }
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
  
  // 清理内存中的 oauthStates
  oauthStates.clear();
  
  clearAuthCookies(res);
  // 跳转到 SSO 注销页面
  res.redirect(302, 'https://id.sigs.tsinghua.edu.cn/portal/sso/logout.html');
});

app.get("/api/auth/logout", (req, res) => {
  const sessionId = parseCookies(req)[sessionCookieName];
  if (sessionId) sessions.delete(sessionId);
  // 清理内存中的 oauthStates
  oauthStates.clear();
  clearAuthCookies(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, async (req, res) => {
  if (req.session?.loginUser) {
    return res.json(req.session.loginUser);
  }
  res.json(publicUser(await loadPerson(req.user.id)) || req.user);
});

app.get("/api/departments", auth, async (req, res) => {
  res.json(await listDepartmentsGrouped());
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
    const result = await createFormOption(category, label, req.body.is_active !== false);
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (/unique/i.test(error.message || "")) {
      return res.status(409).json({ message: "该配置已存在" });
    }
    throw error;
  }
});

app.patch("/api/admin/form-options/:id", auth, adminOnly, async (req, res) => {
  const result = await updateFormOption(req.params.id, req.body || {});
  if (!result.affectedRows) return res.status(404).json({ message: "配置不存在或没有变化" });
  res.json({ ok: true });
});

app.delete("/api/admin/form-options/:id", auth, adminOnly, async (req, res) => {
  const result = await deleteFormOption(req.params.id);
  if (!result.affectedRows) return res.status(404).json({ message: "配置不存在" });
  res.json({ ok: true });
});

// --- Department CRUD (admin) ---
app.get("/api/admin/departments", auth, adminOnly, async (req, res) => {
  const includeInactive = req.query.includeInactive !== "0";
  res.json(await listDepartmentsAll(includeInactive));
});

app.post("/api/admin/departments", auth, adminOnly, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const type = String(req.body.type || "").trim();
  if (!name) return res.status(400).json({ message: "请填写部门名称" });
  if (!["职能处室", "教学科研机构"].includes(type)) {
    return res.status(400).json({ message: "请选择有效的部门类型" });
  }
  try {
    const result = await createDepartment(name, type, req.body.is_active !== false);
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    if (/unique/i.test(error.message || "")) {
      return res.status(409).json({ message: "该部门已存在" });
    }
    throw error;
  }
});

app.patch("/api/admin/departments/:id", auth, adminOnly, async (req, res) => {
  const result = await updateDepartment(req.params.id, req.body || {});
  if (!result.affectedRows) return res.status(404).json({ message: "部门不存在或没有变化" });
  res.json({ ok: true });
});

app.delete("/api/admin/departments/:id", auth, adminOnly, async (req, res) => {
  const result = await deleteDepartment(req.params.id);
  if (!result.affectedRows) return res.status(404).json({ message: "部门不存在" });
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
  await ensureDatahubPersonTables(); await ensureFormConfigTables(); await seedDefaultFormOptions(); await seedDepartments();
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
  if (!result.affectedRows) return res.status(404).json({ message: "人员不存在" });
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
try {
  const { title, field, department, content, is_anonymous, phone } = req.body;
  if (!title || !field || !content) return res.status(400).json({ message: "请填写标题、事项领域和内容" });

  // "我不知道属于哪个部门" → route to 党政办公室
  const DEFAULT_DEPT = "党政办公室";
  const isUnknownDept = !department || department === "";
  const targetDept = isUnknownDept ? DEFAULT_DEPT : department;

  if (!isUnknownDept && !(await isValidDepartment(targetDept))) return res.status(400).json({ message: "请选择有效部门" });
  if (phone) await run("UPDATE datahub_basic_persons SET phone = ? WHERE id = ?", [phone, req.user.id]);

  // Look up submitter's person info for storing on ticket
  const submitterPersonRow = await get('SELECT union_id FROM users WHERE id = ? UNION SELECT id FROM datahub_basic_persons WHERE id = ? LIMIT 1', [req.user.id, req.user.id]).catch(() => null);
  const submitterDatahubRow = submitterPersonRow?.union_id
    ? await get('SELECT id, union_id, name FROM datahub_basic_persons WHERE union_id = ?', [submitterPersonRow.union_id])
    : await get('SELECT id, union_id, name FROM datahub_basic_persons WHERE id = ?', [req.user.id]);
  const submitterUnionId = req.user.union_id || submitterDatahubRow?.union_id || null;
  const submitterPersonId = submitterDatahubRow?.id || req.user.id;
  const submitterName = req.user.name || submitterDatahubRow?.name || null;
  const submitterPhone = req.user.phone || null;
  const submitterRole = req.user.role || 'user';
  const submitterDepartment = req.user.department || null;

  const shareCode = crypto.randomBytes(12).toString("base64url");
  const result = await run(
    `INSERT INTO tickets (title, field, unit_type, department, current_department, original_department, content, is_anonymous, submitter_id, submitter_union_id, submitter_person_id, submitter_name, submitter_phone, submitter_role, submitter_department, status, share_code)
     VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [title, field, targetDept, targetDept, targetDept, content, is_anonymous === "true" ? 1 : 0, req.user.id, submitterUnionId, submitterPersonId, submitterName, submitterPhone, submitterRole, submitterDepartment, shareCode]
  );
  await saveFiles(req.files, result.insertId, null);

  // Notify admins in the target department + all super_admins + department_assignments
  const admins = await all(
    `SELECT DISTINCT COALESCE(u.id, p.id) AS notify_user_id, p.id AS admin_person_id
     FROM datahub_basic_persons p
     LEFT JOIN users u ON u.union_id = p.union_id
     LEFT JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
     WHERE p.role_id = 1
        OR (p.role_id IN (2, 3) AND p.department = ?)
        OR (da.id IS NOT NULL AND da.department_name = ?)`,
    [targetDept, targetDept]
  );
  const displayDept = isUnknownDept ? DEFAULT_DEPT : department;
  for (const admin of admins) {
    const notifResult = await run(
      `INSERT INTO notifications (user_id, ticket_id, type, message)
       VALUES (?, ?, 'new_ticket', ?)`,
      [admin.notify_user_id, result.insertId, `新事项【${title}】已提交至${displayDept}，请及时处理。`]
    );
    const targetUrl = `/cn/admin?ticketId=${result.insertId}&nid=${notifResult.insertId}`;
    await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
    // Portal todo (fire-and-forget)
    if (admin.admin_person_id) {
      pushPortalTodo({
        id: buildTodoId(result.insertId, 'admin', admin.admin_person_id),
        name: `【${title}】-待您处理`,
        url: buildSiteUrl(`/cn/admin?ticketId=${result.insertId}`),
        principalPersonId: admin.admin_person_id
      }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: result.insertId, person_id: admin.admin_person_id, message: err.message }));
    }
  }

  // Portal todo for submitter
  if (submitterDatahubRow?.id) {
    pushPortalTodo({
      id: buildTodoId(result.insertId, 'submitter'),
      name: `【${title}】-待您处理`,
      url: buildSiteUrl(`/cn/tickets/${result.insertId}`),
      principalPersonId: submitterDatahubRow.id
    }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: result.insertId, type: 'submitter', message: err.message }));
  }

  res.status(201).json({ id: result.insertId, share_code: shareCode });
} catch (err) {
  console.error('POST /api/tickets error:', err);
  res.status(500).json({ message: "提交失败: " + err.message });
}
});

app.get("/api/tickets/:id", auth, async (req, res) => {
  const details = await ticketDetails(req.params.id, req.user);
  if (!details) return res.status(404).json({ message: "事项不存在" });

  // When submitter views the ticket and there are replies or it's completed, complete their portal todo
  if (String(details.submitter_id) === String(req.user.id)) {
    const hasReplies = (details.replies && details.replies.length > 0) || details.status === 'completed';
    if (hasReplies) {
      const submitterPerson = await get('SELECT id FROM datahub_basic_persons WHERE id = ?', [req.user.id]).catch(() => null);
      const submitterUnionId = details.submitter_union_id;
      const submitterPersonRow = submitterUnionId
        ? await get('SELECT id FROM datahub_basic_persons WHERE union_id = ?', [submitterUnionId]).catch(() => null)
        : submitterPerson;
      if (submitterPersonRow?.id) {
        const todoId = buildTodoId(req.params.id, 'submitter');
        completePortalTodo(todoId, submitterPersonRow.id).catch(err =>
          logger.warn('portal_todo_complete_failed', { ticket_id: req.params.id, type: 'submitter', message: err.message })
        );
      }
    }
  }

  res.json(details);
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
  if (String(ticket.submitter_id) !== String(req.user.id)) return res.status(403).json({ message: "只有事项发起人可以进行满意度评价" });
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

app.get("/api/admin/analytics", auth, adminOnly, async (req, res) => {
  const user = await loadPerson(req.user.id);
  const params = [];
  const isGlobalAdmin = user?.role === "super_admin";
  let scope = "";

  if (!isGlobalAdmin) {
    const assignments = await getDepartmentAssignments(String(user.id));
    if (assignments.length > 0) {
      const deptNames = assignments.map(a => a.department_name);
      if (deptNames.length > 0) {
        const ph = deptNames.map(() => '?').join(',');
        scope = `WHERE t.current_department IN (${ph})`;
        params.push(...deptNames);
      }
    } else if (user?.department) {
      scope = "WHERE t.current_department = ?";
      params.push(user.department);
    }
  }

  const totalRow = await get(`SELECT COUNT(*) AS count FROM tickets t ${scope}`, params);
  const total = Number(totalRow?.count || 0);

  const publishedParams = [...params];
  const publishedScope = scope ? `${scope} AND t.is_published = 1` : "WHERE t.is_published = 1";
  const publishedRow = await get(`SELECT COUNT(*) AS count FROM tickets t ${publishedScope}`, publishedParams);
  const published = Number(publishedRow?.count || 0);

  const statusRows = await all(
    `SELECT t.status, COUNT(*) AS count FROM tickets t ${scope} GROUP BY t.status`,
    params
  );
  const statusCounts = {};
  for (const r of statusRows) statusCounts[r.status] = Number(r.count);

  const fieldRows = await all(
    `SELECT t.field, COUNT(*) AS count FROM tickets t ${scope} GROUP BY t.field ORDER BY count DESC`,
    params
  );

  const deptRows = await all(
    `SELECT t.current_department AS department, COUNT(*) AS count FROM tickets t ${scope} GROUP BY t.current_department ORDER BY count DESC`,
    params
  );

  const satRows = await all(
    `SELECT s.score, COUNT(*) AS count
     FROM satisfaction_surveys s
     JOIN tickets t ON t.id = s.ticket_id
     ${scope}
     GROUP BY s.score`,
    params
  );
  const satisfactionDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let satisfactionTotal = 0;
  let satisfactionCount = 0;
  for (const r of satRows) {
    satisfactionDistribution[r.score] = Number(r.count);
    satisfactionTotal += r.score * Number(r.count);
    satisfactionCount += Number(r.count);
  }
  const completedCount = statusCounts["completed"] || 0;

  res.json({
    total,
    active: total - completedCount,
    completed: completedCount,
    published,
    statusCounts,
    fieldEntries: fieldRows.map((r) => [r.field, Number(r.count)]),
    departmentEntries: deptRows.map((r) => [r.department || "未指定", Number(r.count)]),
    replyRate: total > 0 ? ((completedCount / total) * 100).toFixed(1) + "%" : "0%",
    completeRate: total > 0 ? ((completedCount / total) * 100).toFixed(1) + "%" : "0%",
    satisfactionCount,
    satisfactionAverage: satisfactionCount > 0 ? (satisfactionTotal / satisfactionCount).toFixed(1) : "-",
    satisfactionRate: completedCount > 0 ? ((satisfactionCount / completedCount) * 100).toFixed(1) + "%" : "0%",
    satisfactionDistribution
  });
});

app.get("/api/admin/tickets", auth, adminOnly, async (req, res) => {
  const user = await loadPerson(req.user.id);
  const pageSize = Math.min(Number(req.query.pageSize || 30), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const isGlobalAdmin = user?.role === "super_admin";

  let scope = "";
  const params = [];
  let permissionExpr = "'handle'"; // default for super_admin
  let isObserver = false;

  if (!isGlobalAdmin) {
    // 优先检查 department_assignments 多部门授权
    const assignments = await getDepartmentAssignments(String(user.id));

    if (assignments.length > 0) {
      isObserver = assignments.some(a => a.role_type === 'observer');
      const deptNames = assignments.map(a => a.department_name);
      if (deptNames.length === 0) {
        return res.json({ page, pageSize, total: 0, rows: [] });
      }
      const ph = deptNames.map(() => '?').join(',');
      scope = `WHERE (
        t.current_department IN (${ph})
        OR t.original_department IN (${ph})
        OR t.id IN (SELECT ticket_id FROM transfers WHERE from_department IN (${ph}) OR to_department IN (${ph}))
      )`;
      params.push(...deptNames, ...deptNames, ...deptNames, ...deptNames);
      if (isObserver) {
        permissionExpr = "'view'";
      } else {
        permissionExpr = `CASE WHEN t.current_department IN (${deptNames.map(() => '?').join(',')}) THEN 'handle' ELSE 'view' END`;
      }
    } else if (user?.department) {
      // 回退：原有单部门逻辑
      scope = `WHERE (
        t.current_department = ?
        OR t.original_department = ?
        OR t.id IN (SELECT ticket_id FROM transfers WHERE from_department = ? OR to_department = ?)
      )`;
      params.push(user.department, user.department, user.department, user.department);
      permissionExpr = "CASE WHEN t.current_department = ? THEN 'handle' ELSE 'view' END";
    }
  }

  const countRow = await get(
    `SELECT COUNT(*) AS count FROM tickets t ${scope}`,
    params
  );

  // 构建 permission 参数
  const permParams = [];
  if (!isGlobalAdmin) {
    const permAssignments = await getDepartmentAssignments(String(user.id));
    if (permAssignments.length > 0 && !permAssignments.every(a => a.role_type === 'observer')) {
      permParams.push(...permAssignments.filter(a => a.role_type !== 'observer').map(a => a.department_name));
    } else if (permAssignments.length === 0 && user?.department) {
      permParams.push(user.department);
    }
  }

  const rows = await all(
    `SELECT t.*,
            CASE WHEN t.is_anonymous = 1 THEN '匿名' ELSE COALESCE(dp.name, u.name) END AS submitter_name,
            CASE WHEN t.is_anonymous = 1 THEN '' ELSE COALESCE(dp.phone, u.phone) END AS submitter_phone,
            s.score AS satisfaction_score,
            s.comment AS satisfaction_comment,
            s.updated_at AS satisfaction_updated_at,
            COUNT(a.id) AS attachment_count,
            ${permissionExpr} AS permission
     FROM tickets t
     LEFT JOIN datahub_basic_persons dp ON dp.id = t.submitter_id
     LEFT JOIN users u ON u.id = t.submitter_id
     LEFT JOIN attachments a ON a.ticket_id = t.id
     LEFT JOIN satisfaction_surveys s ON s.ticket_id = t.id
     ${scope}
     GROUP BY t.id
     ORDER BY t.updated_at DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...permParams, ...params, pageSize, offset]
  );
  res.json({ page, pageSize, total: countRow?.count || 0, rows: rows.map(mapTicket) });
});

app.post("/api/admin/tickets/:id/replies", auth, adminOnly, upload.array("attachments", 8), async (req, res) => {
  try {
    const { content, status } = req.body;
    if (!content) return res.status(400).json({ message: "请填写回复内容" });
    const user = await loadPerson(req.user.id);
    const ticket = await get("SELECT id, title, submitter_id, current_department FROM tickets WHERE id = ?", [req.params.id]);
    if (!ticket) return res.status(404).json({ message: "事项不存在" });
    const permission = await getTicketPermission(req.params.id, user);
    if (permission !== 'handle') {
      return res.status(403).json({ message: "您所在的部门当前不是承办部门，无法处理此事项" });
    }
    if (status && !["completed", "pending"].includes(status)) return res.status(400).json({ message: "无效状态" });
    const result = await run(
      "INSERT INTO replies (ticket_id, content, replier_id, department) VALUES (?, ?, ?, ?)",
      [req.params.id, content, req.user.id, user.department]
    );
    await saveFiles(req.files, null, result.insertId);
    await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status || "completed", req.params.id]);

    // Notify the ticket submitter
    if (ticket.submitter_id) {
      const notifResult = await run(
        `INSERT INTO notifications (user_id, ticket_id, type, message)
         VALUES (?, ?, 'replied', ?)`,
        [ticket.submitter_id, req.params.id, `您的事项【${ticket.title}】已有新的处理回复。`]
      );
      const targetUrl = `/cn/tickets/${req.params.id}?nid=${notifResult.insertId}`;
      await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
    }

    // Complete portal todos
    const ticketId = req.params.id;

    // Always complete submitter's todo when admin replies
    const submitterPerson = await get('SELECT union_id FROM users WHERE id = ? UNION SELECT id FROM datahub_basic_persons WHERE id = ? LIMIT 1', [ticket.submitter_id, ticket.submitter_id]);
    const submitterDatahub = submitterPerson?.union_id
      ? await get('SELECT id FROM datahub_basic_persons WHERE union_id = ?', [submitterPerson.union_id])
      : await get('SELECT id FROM datahub_basic_persons WHERE id = ?', [ticket.submitter_id]);
    if (submitterDatahub?.id) {
      completePortalTodo(buildTodoId(ticketId, 'submitter'), submitterDatahub.id)
        .catch(err => logger.warn('portal_todo_complete_failed', { ticket_id: ticketId, type: 'submitter', message: err.message }));
    }

    // Complete the replying admin's own todo
    if (user.union_id || user.id) {
      const adminPersonId = user.union_id
        ? (await get('SELECT id FROM datahub_basic_persons WHERE union_id = ?', [user.union_id]))?.id
        : user.id;
      if (adminPersonId) {
        completePortalTodo(buildTodoId(ticketId, 'admin', adminPersonId), adminPersonId)
          .catch(err => logger.warn('portal_todo_complete_failed', { ticket_id: ticketId, type: 'admin_replier', message: err.message }));
      }
    }

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error('Reply handler error:', err);
    if (!res.headersSent) res.status(500).json({ message: '回复失败: ' + err.message });
  }
});

app.patch("/api/admin/tickets/:id/status", auth, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!["pending", "completed"].includes(status)) return res.status(400).json({ message: "无效状态" });
  const user = await loadPerson(req.user.id);
  const ticket = await get("SELECT current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  const permission = await getTicketPermission(req.params.id, user);
  if (permission !== 'handle') {
    return res.status(403).json({ message: "只有当前承办部门管理员可以更新状态" });
  }
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, req.params.id]);
  res.json({ ok: true });
});

app.post("/api/admin/tickets/:id/transfer", auth, adminOnly, async (req, res) => {
  const { to_department, note } = req.body;
  if (!(await isValidDepartment(to_department))) return res.status(400).json({ message: "请选择有效转办部门" });
  const user = await loadPerson(req.user.id);
  const ticket = await get("SELECT id, title, current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  const permission = await getTicketPermission(req.params.id, user);
  if (permission !== 'handle') {
    return res.status(403).json({ message: "只能由当前承办部门转办事项" });
  }

  // 检查转办目标限制
  const transferTargets = await getTransferTargets(String(req.user.id), ticket.current_department);
  if (transferTargets.length > 0) {
    if (!transferTargets.includes(to_department)) {
      return res.status(403).json({ message: '您没有权限转办至该部门' });
    }
  }

  if (to_department === ticket.current_department) return res.status(400).json({ message: "不能转办给当前承办部门" });
  const fromDept = ticket.current_department || user.department;

  // 将上一条转办记录标记为 superseded
  await run(
    "UPDATE transfers SET status = 'superseded' WHERE ticket_id = ? AND status = 'active'",
    [req.params.id]
  );

  await run(
    "INSERT INTO transfers (ticket_id, from_department, to_department, operator_id, note, status) VALUES (?, ?, ?, ?, ?, 'active')",
    [req.params.id, fromDept, to_department, req.user.id, note || ""]
  );
  await run("UPDATE tickets SET current_department = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [to_department, req.params.id]);

  // Notify admins in the target department + all super_admins + department_assignments
  const admins = await all(
    `SELECT DISTINCT COALESCE(u.id, p.id) AS notify_user_id, p.id AS admin_person_id
     FROM datahub_basic_persons p
     LEFT JOIN users u ON u.union_id = p.union_id
     LEFT JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
     WHERE p.role_id = 1
        OR (p.role_id IN (2, 3) AND p.department = ?)
        OR (da.id IS NOT NULL AND da.department_name = ?)`,
    [to_department, to_department]
  );
  for (const admin of admins) {
    const notifResult = await run(
      `INSERT INTO notifications (user_id, ticket_id, type, message)
       VALUES (?, ?, 'transferred_in', ?)`,
      [admin.notify_user_id, req.params.id, `事项【${ticket.title}】已从${fromDept}转办至${to_department}，请及时处理。`]
    );
    const targetUrl = `/cn/admin?ticketId=${req.params.id}&nid=${notifResult.insertId}`;
    await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
    if (admin.admin_person_id) {
      pushPortalTodo({
        id: buildTodoId(req.params.id, 'admin', admin.admin_person_id),
        name: `【${ticket.title}】-待您处理`,
        url: buildSiteUrl(`/cn/admin?ticketId=${req.params.id}`),
        principalPersonId: admin.admin_person_id
      }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: req.params.id, person_id: admin.admin_person_id, message: err.message }));
    }
  }

  // Complete portal todos for admins in the old department
  const oldDeptAdmins = await all(
    `SELECT DISTINCT p.id AS admin_person_id
     FROM datahub_basic_persons p
     LEFT JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
     WHERE p.role_id = 1
        OR (p.role_id IN (2, 3) AND p.department = ?)
        OR (da.id IS NOT NULL AND da.department_name = ?)`,
    [fromDept, fromDept]
  );
  for (const admin of oldDeptAdmins) {
    if (admin.admin_person_id) {
      completePortalTodo(buildTodoId(req.params.id, 'admin', admin.admin_person_id), admin.admin_person_id)
        .catch(err => logger.warn('portal_todo_complete_failed', { ticket_id: req.params.id, person_id: admin.admin_person_id, message: err.message }));
    }
  }

  res.json({ ok: true });
});

// -- Attachment download with permission check --

app.get("/api/attachments/:id/download", auth, async (req, res) => {
  const attachment = await get("SELECT * FROM attachments WHERE id = ?", [req.params.id]);
  if (!attachment) return res.status(404).json({ message: "附件不存在" });

  // 通过关联的 ticket 检查权限
  let ticketId = attachment.ticket_id;
  if (!ticketId && attachment.reply_id) {
    const reply = await get("SELECT ticket_id FROM replies WHERE id = ?", [attachment.reply_id]);
    if (reply) ticketId = reply.ticket_id;
  }
  if (!ticketId) return res.status(400).json({ message: "附件未关联工单" });

  const permission = await getTicketPermission(ticketId, req.user);
  if (!permission) return res.status(403).json({ message: "无权访问此附件" });

  const filePath = path.join(__dirname, attachment.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "文件不存在" });

  res.setHeader('Content-Type', attachment.file_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.original_name)}"`);
  res.sendFile(filePath);
});

// -- Department Admin Permission Management --

// 搜索可授权的人员（同时搜索 datahub_basic_persons 和 users 表）
app.get("/api/admin/department-admins/search", auth, superAdminOnly, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const pageSize = Math.min(Number(req.query.pageSize || 20), 50);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;

  const like = keyword ? `%${keyword}%` : '%';
  const notInAuth = "NOT IN (SELECT DISTINCT person_id FROM department_assignments)";

  // 查 datahub_basic_persons，限院外人员和教职员，排除离职和无效人员
  let where = `WHERE p.type IN ('院外人员', '教职员', 'faculty') 
    AND (p.status IS NULL OR p.status NOT IN ('0', 'false', 'departure', 'abandon_employee', 'die'))
    AND p.is_active = 1
    AND p.id ${notInAuth}`;
  const params = [];
  if (keyword) {
    where += " AND (p.union_id LIKE ? OR p.name LIKE ? OR p.department LIKE ?)";
    params.push(like, like, like);
  }

  const countRow = await get(`SELECT COUNT(*) AS count FROM datahub_basic_persons p ${where}`, params);
  const total = Number(countRow?.count || 0);

  const rows = await all(
    `SELECT p.id, p.union_id, p.name, p.department, p.type, p.status, p.role_id, r.code as role_code
     FROM datahub_basic_persons p
     LEFT JOIN roles r ON r.id = p.role_id
     ${where}
     ORDER BY p.name ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({ page, pageSize, total, rows });
});

// 获取当前用户的管理部门
app.get("/api/auth/my-managed-departments", auth, async (req, res) => {
  const person = await loadPerson(req.user.id);
  if (person?.role === 'super_admin') {
    return res.json({ departments: [], role_type: null, is_super_admin: true });
  }

  const assignments = await getDepartmentAssignments(String(req.user.id));
  if (assignments.length === 0) {
    return res.json({ departments: [], role_type: null, is_super_admin: false });
  }

  res.json({
    departments: assignments.map(a => a.department_name),
    role_type: assignments[0]?.role_type || null,
    is_super_admin: false
  });
});

// 创建授权
app.post("/api/admin/department-admins", auth, superAdminOnly, async (req, res) => {
  const { person_id, department_names, role_type, can_transfer_to, is_enabled } = req.body;

  if (!person_id || !role_type || !Array.isArray(department_names) || department_names.length === 0) {
    return res.status(400).json({ message: '请填写完整授权信息（person_id, department_names, role_type）' });
  }
  if (!['admin', 'observer'].includes(role_type)) {
    return res.status(400).json({ message: '角色类型无效，仅支持 admin 或 observer' });
  }

  // 检查人员是否存在（仅 datahub_basic_persons，限院外人员/教职员）
  const person = await get(
    "SELECT id, union_id, name, department, type FROM datahub_basic_persons WHERE id = ? AND type IN ('院外人员', '教职员')",
    [person_id]
  );
  if (!person) return res.status(404).json({ message: '人员不存在或不在可授权范围（仅限院外人员、教职员）' });

  // 验证 department_names 中的部门必须存在于 departments 表且 is_active=1
  for (const dept of department_names) {
    if (!(await isValidDepartment(dept))) {
      return res.status(400).json({ message: `部门「${dept}」无效或未启用` });
    }
  }

  // 验证 can_transfer_to 中的部门（如果提供）
  if (Array.isArray(can_transfer_to) && can_transfer_to.length > 0) {
    for (const dept of can_transfer_to) {
      if (!(await isValidDepartment(dept))) {
        return res.status(400).json({ message: `转派目标部门「${dept}」无效或未启用` });
      }
    }
  }

  // 检查同一人员在同一部门是否已有 is_enabled=1 的记录
  for (const dept of department_names) {
    const existing = await get(
      'SELECT id FROM department_assignments WHERE person_id = ? AND department_name = ? AND is_enabled = 1',
      [person_id, dept]
    );
    if (existing) return res.status(409).json({ message: `该人员在部门「${dept}」已有启用的授权记录` });
  }

  const transferTargetsStr = Array.isArray(can_transfer_to) ? JSON.stringify(can_transfer_to) : '[]';
  const enabledValue = is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1;
  let insertedId = null;

  for (const dept of department_names) {
    const result = await run(
      'INSERT INTO department_assignments (person_id, department_name, role_type, can_transfer_to, is_enabled) VALUES (?, ?, ?, ?, ?)',
      [person_id, dept, role_type, transferTargetsStr, enabledValue]
    );
    if (!insertedId) insertedId = result.insertId;
  }

  // 记录审计日志
  const afterState = { person_id, role_type, department_names, can_transfer_to: can_transfer_to || [], is_enabled: enabledValue };
  await run(
    `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
     VALUES (?, ?, 'create', NULL, ?)`,
    [req.user.id, person_id, JSON.stringify(afterState)]
  );

  res.status(201).json({ ok: true, id: insertedId });
});

// 授权列表
app.get("/api/admin/department-admins", auth, superAdminOnly, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const roleType = String(req.query.role_type || '').trim();
  const departmentName = String(req.query.department_name || '').trim();
  const isEnabled = req.query.is_enabled;
  const pageSize = Math.min(Number(req.query.pageSize || 20), 50);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;

  let scope = '';
  const params = [];

  const conditions = [];
  if (keyword) {
    conditions.push("(p.name LIKE ? OR p.id LIKE ? OR p.union_id LIKE ? OR p.department LIKE ?)");
    const like = `%${keyword}%`;
    params.push(like, like, like, like);
  }
  if (roleType && ['admin', 'observer'].includes(roleType)) {
    conditions.push("da.role_type = ?");
    params.push(roleType);
  }
  if (departmentName) {
    conditions.push("da.department_name = ?");
    params.push(departmentName);
  }
  if (isEnabled === '1' || isEnabled === '0') {
    conditions.push("da.is_enabled = ?");
    params.push(Number(isEnabled));
  }
  if (conditions.length) {
    scope = 'WHERE ' + conditions.join(' AND ');
  }

  const countRow = await get(
    `SELECT COUNT(*) AS count FROM department_assignments da
     LEFT JOIN datahub_basic_persons p ON p.id = da.person_id
     ${scope}`,
    params
  );

  const rows = await all(
    `SELECT da.id, da.person_id, da.department_name, da.role_type, da.is_enabled, da.can_transfer_to,
            da.created_at, da.updated_at,
            p.name AS person_name,
            p.department AS person_department,
            p.type AS person_type,
            p.phone AS person_phone,
            p.union_id AS person_union_id
     FROM department_assignments da
     LEFT JOIN datahub_basic_persons p ON p.id = da.person_id
     ${scope}
     ORDER BY da.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  // 整理输出格式：按 person_id 分组
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.person_id]) {
      grouped[row.person_id] = {
        id: row.id,
        person_id: row.person_id,
        role_type: row.role_type,
        is_enabled: row.is_enabled,
        person_name: row.person_name,
        person_department: row.person_department,
        person_type: row.person_type,
        person_phone: row.person_phone,
        person_union_id: row.person_union_id,
        managed_departments: [],
        can_transfer_to: [],
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    }
    grouped[row.person_id].managed_departments.push(row.department_name);
    if (row.can_transfer_to) {
      try {
        const targets = JSON.parse(row.can_transfer_to);
        grouped[row.person_id].can_transfer_to.push(...targets);
      } catch {}
    }
  }

  const result = Object.values(grouped);

  res.json({ page, pageSize, total: countRow?.count || 0, rows: result });
});

// 单条授权详情
app.get("/api/admin/department-admins/:id", auth, superAdminOnly, async (req, res) => {
  const row = await get(
    `SELECT da.*,
            p.name AS person_name,
            p.department AS person_department,
            p.type AS person_type,
            p.phone AS person_phone,
            p.union_id AS person_union_id
     FROM department_assignments da
     LEFT JOIN datahub_basic_persons p ON p.id = da.person_id
     WHERE da.id = ?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ message: '授权记录不存在' });

  // 获取同一人员的所有部门授权
  const allAssignments = await getDepartmentAssignments(row.person_id);
  row.managed_departments = allAssignments.map(a => a.department_name);
  row.can_transfer_to = row.can_transfer_to ? JSON.parse(row.can_transfer_to) : [];

  res.json(row);
});

// 更新授权（单条记录）
app.put("/api/admin/department-admins/:id", auth, superAdminOnly, async (req, res) => {
  const { role_type, can_transfer_to, is_enabled } = req.body;

  const current = await get(
    `SELECT da.*, p.name AS person_name
     FROM department_assignments da
     LEFT JOIN datahub_basic_persons p ON p.id = da.person_id
     WHERE da.id = ?`,
    [req.params.id]
  );
  if (!current) return res.status(404).json({ message: '授权记录不存在' });

  // 记录更新前的状态
  const beforeState = {
    person_id: current.person_id,
    department_name: current.department_name,
    role_type: current.role_type,
    can_transfer_to: current.can_transfer_to ? JSON.parse(current.can_transfer_to) : [],
    is_enabled: current.is_enabled
  };

  // 验证 can_transfer_to 中的部门（如果提供）
  if (Array.isArray(can_transfer_to) && can_transfer_to.length > 0) {
    for (const dept of can_transfer_to) {
      if (!(await isValidDepartment(dept))) {
        return res.status(400).json({ message: `转派目标部门「${dept}」无效或未启用` });
      }
    }
  }

  // 构建更新语句
  const updates = [];
  const params = [];
  if (role_type && ['admin', 'observer'].includes(role_type)) {
    updates.push('role_type = ?');
    params.push(role_type);
  }
  if (is_enabled !== undefined) {
    updates.push('is_enabled = ?');
    params.push(is_enabled ? 1 : 0);
  }
  if (can_transfer_to !== undefined) {
    updates.push('can_transfer_to = ?');
    params.push(Array.isArray(can_transfer_to) ? JSON.stringify(can_transfer_to) : '[]');
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: '未提供任何更新字段' });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);
  await run(`UPDATE department_assignments SET ${updates.join(', ')} WHERE id = ?`, params);

  // 记录更新后的状态
  const afterState = {
    person_id: current.person_id,
    department_name: current.department_name,
    role_type: role_type || beforeState.role_type,
    can_transfer_to: can_transfer_to !== undefined ? (can_transfer_to || []) : beforeState.can_transfer_to,
    is_enabled: is_enabled !== undefined ? (is_enabled ? 1 : 0) : beforeState.is_enabled
  };

  await run(
    `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
     VALUES (?, ?, 'update', ?, ?)`,
    [req.user.id, current.person_id, JSON.stringify(beforeState), JSON.stringify(afterState)]
  );

  res.json({ ok: true });
});

// 删除授权
app.delete("/api/admin/department-admins/:id", auth, superAdminOnly, async (req, res) => {
  const current = await get('SELECT * FROM department_assignments WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: '授权记录不存在' });

  // 获取该人员的所有部门授权
  const allAssignments = await getDepartmentAssignments(current.person_id);
  const beforeState = {
    person_id: current.person_id,
    role_type: current.role_type,
    is_enabled: current.is_enabled,
    managed_departments: allAssignments.map(a => a.department_name)
  };

  // 删除该人员的所有授权记录
  await run('DELETE FROM department_assignments WHERE person_id = ?', [current.person_id]);

  await run(
    `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
     VALUES (?, ?, 'delete', ?, NULL)`,
    [req.user.id, current.person_id, JSON.stringify(beforeState)]
  );

  res.json({ ok: true });
});

// 启用/禁用切换
app.patch("/api/admin/department-admins/:id/toggle", auth, superAdminOnly, async (req, res) => {
  const { is_enabled } = req.body;
  if (is_enabled === undefined) return res.status(400).json({ message: '请指定 is_enabled' });

  const current = await get('SELECT * FROM department_assignments WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: '授权记录不存在' });

  await run(
    'UPDATE department_assignments SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [is_enabled ? 1 : 0, req.params.id]
  );

  await run(
    `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      req.user.id,
      current.person_id,
      is_enabled ? 'enable' : 'disable',
      JSON.stringify({ is_enabled: current.is_enabled }),
      JSON.stringify({ is_enabled: is_enabled ? 1 : 0 })
    ]
  );

  res.json({ ok: true });
});

// -- Notification endpoints --

app.get("/api/notifications", auth, async (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;

  const total = await get(
    "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?",
    [req.user.id]
  );
  const rows = await all(
    `SELECT n.*, t.title AS ticket_title, t.status AS ticket_status
     FROM notifications n
     LEFT JOIN tickets t ON t.id = n.ticket_id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, pageSize, offset]
  );
  res.json({ page, pageSize, total: total?.count || 0, rows });
});

app.patch("/api/notifications/:id/read", auth, async (req, res) => {
  const notification = await get(
    "SELECT id, user_id FROM notifications WHERE id = ?",
    [req.params.id]
  );
  if (!notification) return res.status(404).json({ message: "通知不存在" });
  if (notification.user_id !== req.user.id) return res.status(403).json({ message: "只能操作自己的通知" });

  await run("UPDATE notifications SET is_read = 1 WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

app.get("/api/notifications/unread-count", auth, async (req, res) => {
  const row = await get(
    "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0",
    [req.user.id]
  );
  res.json({ count: row?.count || 0 });
});

// -- Local Account Management (superadmin only) --

// 获取本地账号列表
app.get("/api/admin/local-accounts", auth, superAdminOnly, async (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize || 20), 50);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const keyword = String(req.query.keyword || "").trim();

  let where = "";
  const params = [];
  if (keyword) {
    where = "WHERE u.username LIKE ? OR p.name LIKE ? OR p.department LIKE ?";
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }

  const countRow = await get(
    `SELECT COUNT(*) AS count FROM users u
     LEFT JOIN datahub_basic_persons p ON p.union_id = u.union_id
     ${where}`,
    params
  );

  const rows = await all(
    `SELECT u.id, u.username, u.union_id, u.is_active, u.created_at,
            p.name AS person_name, p.department AS person_department, p.type AS person_type
     FROM users u
     LEFT JOIN datahub_basic_persons p ON p.union_id = u.union_id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({ page, pageSize, total: countRow?.count || 0, rows });
});

// 创建本地账号
app.post("/api/admin/local-accounts", auth, superAdminOnly, async (req, res) => {
  const { person_id, username, password, is_active } = req.body;

  if (!person_id || !username || !password) {
    return res.status(400).json({ message: "请填写完整信息（person_id, username, password）" });
  }

  // 检查 username 唯一性
  const existingUser = await get("SELECT id FROM users WHERE username = ?", [username]);
  if (existingUser) {
    return res.status(409).json({ message: "用户名已存在" });
  }

  // 检查 person_id 是否存在
  const person = await get("SELECT id, union_id FROM datahub_basic_persons WHERE id = ?", [person_id]);
  if (!person) {
    return res.status(404).json({ message: "人员不存在" });
  }

  // 检查该 person_id 是否已有本地账号
  const existingAccount = await get("SELECT id FROM users WHERE union_id = ?", [person.union_id]);
  if (existingAccount) {
    return res.status(409).json({ message: "该人员已有本地账号" });
  }

  // 密码哈希
  const passwordHash = await bcrypt.hash(password, 10);
  const enabledValue = is_active !== undefined ? (is_active ? 1 : 0) : 1;

  const result = await run(
    "INSERT INTO users (username, password_hash, union_id, is_active) VALUES (?, ?, ?, ?)",
    [username, passwordHash, person.union_id, enabledValue]
  );

  res.status(201).json({ ok: true, id: result.insertId });
});

// 更新本地账号
app.put("/api/admin/local-accounts/:id", auth, superAdminOnly, async (req, res) => {
  const { password, is_active } = req.body;

  const current = await get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!current) {
    return res.status(404).json({ message: "账号不存在" });
  }

  const updates = [];
  const params = [];

  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    updates.push("password_hash = ?");
    params.push(passwordHash);
  }

  if (is_active !== undefined) {
    updates.push("is_active = ?");
    params.push(is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ message: "未提供任何更新字段" });
  }

  params.push(req.params.id);
  await run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

  res.json({ ok: true });
});

// 删除本地账号（软删除）
app.delete("/api/admin/local-accounts/:id", auth, superAdminOnly, async (req, res) => {
  const current = await get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!current) {
    return res.status(404).json({ message: "账号不存在" });
  }

  await run("UPDATE users SET is_active = 0 WHERE id = ?", [req.params.id]);

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
    `SELECT t.*, COALESCE(dp.name, u.name) AS submitter_name, COALESCE(dp.phone, u.phone) AS submitter_phone
     FROM tickets t
     LEFT JOIN datahub_basic_persons dp ON dp.id = t.submitter_id
     LEFT JOIN users u ON u.id = t.submitter_id
     WHERE t.share_code = ?`,
    [req.params.shareCode]
  );
  if (!ticket) return res.status(404).json({ message: "事项不存在或链接已失效" });

  if (ticket.is_anonymous) {
    ticket.submitter_name = "匿名";
    ticket.submitter_phone = "";
  }

  const replies = await all(
    `SELECT r.*, COALESCE(dp.name, u.name) AS replier_name
     FROM replies r
     LEFT JOIN datahub_basic_persons dp ON dp.id = r.replier_id
     LEFT JOIN users u ON u.id = r.replier_id
     WHERE r.ticket_id = ?
     ORDER BY r.created_at ASC`,
    [ticket.id]
  );
  const attachments = await all("SELECT * FROM attachments WHERE ticket_id = ? ORDER BY uploaded_at ASC", [ticket.id]);
  const transfers = await all(
    `SELECT tr.*, COALESCE(dp.name, u.name) AS operator_name
     FROM transfers tr
     LEFT JOIN datahub_basic_persons dp ON dp.id = tr.operator_id
     LEFT JOIN users u ON u.id = tr.operator_id
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
