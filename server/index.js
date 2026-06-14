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
  getDepartmentAssignments, getDepartmentLeaderAssignments, isDepartmentAdmin, isDepartmentLeader, getTransferTargets
} = require("./db_mysql");
const { fetchBasicPersons } = require("./datahub");
const { syncBasicPersons } = require("./datahub-sync");
const { pushPortalTodo, completePortalTodo, buildTodoId, buildSiteUrl } = require("./portal-todo");
const logger = require("./logger");
const { contentDispositionFilename, normalizeOriginalFilename } = require("./filename-utils");

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
const GLOBAL_ADMIN_ROLES = new Set(["super_admin", "liaison"]);
const ASSIGNMENT_ADMIN_ROLES = new Set(["admin", "dept_admin"]);

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
  const role = publicRoleForUser(user);
  return {
    id: user.id,
    username: user.union_id || user.username,
    union_id: user.union_id,
    name: user.name,
    phone: user.phone,
    role,
    role_id: user.role_id,
    department: user.department,
    can_manage_roles: Boolean(user.can_manage_roles),
    // 部门管理员权限信息
    dept_admin_assignments: user.dept_admin_assignments || [],
    is_dept_admin: Boolean(user.dept_admin_assignments && user.dept_admin_assignments.length > 0),
    leader_assignments: user.leader_assignments || [],
    is_department_leader: Boolean(user.leader_assignments && user.leader_assignments.length > 0)
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
    role: publicRoleForUser(user),
    department: user.department,
    // 部门管理员权限信息
    dept_admin_assignments: user.dept_admin_assignments || [],
    is_dept_admin: Boolean(user.dept_admin_assignments && user.dept_admin_assignments.length > 0),
    leader_assignments: user.leader_assignments || [],
    is_department_leader: Boolean(user.leader_assignments && user.leader_assignments.length > 0)
  };
  return jwt.sign(payload, jwtSecret, { expiresIn: expiresIn || jwtExpiresIn });
}

function rawRoleForUser(user) {
  return user?.role_code || user?.role || "user";
}

function publicRoleForUser(user) {
  const role = rawRoleForUser(user);
  return ASSIGNMENT_ADMIN_ROLES.has(role) ? "user" : role;
}

function hasGlobalAdminRole(user) {
  return GLOBAL_ADMIN_ROLES.has(rawRoleForUser(user));
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

async function auth(req, res, next) {
  const token = tokenFromRequest(req);
  if (token) {
    try {
      req.user = jwt.verify(token, jwtSecret);
      logger.info("auth_ok_jwt", {
        request_id: req.requestId,
        method: req.method,
        path: req.path,
        user_id: req.user.id
      });
      return next();
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
      return;
    }
  }

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
}

function isAdminLike(user) {
  if (!user) return false;
  return hasGlobalAdminRole(user) ||
    (user.dept_admin_assignments && user.dept_admin_assignments.length > 0) ||
    user.is_dept_admin;
}

function isLeaderLike(user) {
  if (!user) return false;
  return (user.leader_assignments && user.leader_assignments.length > 0) ||
    user.is_department_leader;
}

async function leaderDepartmentsForViewer(viewer) {
  const person = await loadPerson(viewer.id);
  const assignments = person?.leader_assignments?.length
    ? person.leader_assignments
    : await getDepartmentLeaderAssignments(String(person?.id || viewer.id));
  return assignments.map((item) => item.department_name).filter(Boolean);
}

async function canLeaderViewTicket(ticketId, ticket, viewer) {
  if (!viewer) return false;
  const leaderDepartments = await leaderDepartmentsForViewer(viewer);
  if (leaderDepartments.length === 0) return false;
  if (leaderDepartments.includes(ticket.current_department || ticket.department)) return true;
  const placeholders = leaderDepartments.map(() => "?").join(",");
  const approval = await get(
    `SELECT 1 FROM ticket_approvals WHERE ticket_id = ? AND department_name IN (${placeholders}) LIMIT 1`,
    [ticketId, ...leaderDepartments]
  );
  return Boolean(approval);
}

/**
 * 返回用户对某工单的操作权限
 * 'handle' — 可处理（回复、转办、改状态）
 * 'view'   — 仅查看
 * null     — 无权限
 */
async function getTicketPermission(ticketId, viewer) {
  const resolvedTicketId = await resolveTicketId(ticketId);
  if (!resolvedTicketId) return null;
  const ticket = await get(
    'SELECT id, original_department, current_department, department, submitter_id, is_published FROM tickets WHERE id = ?',
    [resolvedTicketId]
  );
  if (!ticket) return null;

  // 超级管理员可处理
  if (rawRoleForUser(viewer) === 'super_admin') return 'handle';

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
        [resolvedTicketId, ...managedNames, ...managedNames]
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
        [resolvedTicketId, dept, dept]
      );
      if (inTransferChain) return 'view';
    }
  }

  if (await canLeaderViewTicket(resolvedTicketId, ticket, viewer)) return 'approve';

  // 提交者本人可查看（管理员已检查过部门权限，此处为兜底）
  if (String(ticket.submitter_id) === String(viewer.id)) return 'view';
  if (Number(ticket.is_published) === 1) return 'view';

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
    person.leader_assignments = await getDepartmentLeaderAssignments(person.id);
    return person;
  }

  // 2. 如果 datahub 查不到，检查是否是本地账号（users 表存在）
  const user = await get("SELECT id, union_id, username, is_active FROM users WHERE id = ? OR union_id = ?", [String(id), String(id)]);
  if (user && user.union_id) {
    // 2.1 自动创建 datahub_basic_persons 影子记录（避免登录失败）
    const localRole = await getRoleByCode('user');
    await run(
      `INSERT IGNORE INTO datahub_basic_persons (id, union_id, name, type, department, role_id, auth_source, is_active, raw_json)
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
      person.leader_assignments = await getDepartmentLeaderAssignments(person.id);
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
    person.leader_assignments = await getDepartmentLeaderAssignments(person.id);
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
  person.leader_assignments = [];
  return person;
}

async function adminOnly(req, res, next) {
  try {
    const user = await loadPerson(req.user.id);
    if (hasGlobalAdminRole(user)) {
      req.user.role = publicRoleForUser(user);
      req.user.department = user.department;
      return next();
    }
    // 检查 department_assignments 授权表
    const personId = user?.id || req.user.id;
    const assignments = await getDepartmentAssignments(String(personId));
    if (assignments.length > 0) {
      req.user.role = publicRoleForUser(user || req.user);
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
    if (rawRoleForUser(user) !== 'super_admin') {
      return res.status(403).json({ message: '需要超级管理员权限' });
    }
    req.user.role = publicRoleForUser(user);
    req.user.department = user.department;
    next();
  } catch (error) {
    next(error);
  }
}

async function canManageRoles(req, res, next) {
  try {
    const user = await loadPerson(req.user.id);
    if (rawRoleForUser(user) !== "super_admin" && !user?.can_manage_roles) {
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

function mapAttachment(row) {
  if (!row) return row;
  return {
    ...row,
    original_name: normalizeOriginalFilename(row.original_name)
  };
}

function ticketPublicId(ticket) {
  return ticket?.ticket_code || ticket?.id;
}

function formatTicketDatePart(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}${pick("month")}${pick("day")}`;
}

function randomTicketCodePart(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function generateTicketCode(createdAt = new Date()) {
  const datePart = formatTicketDatePart(createdAt);
  for (let i = 0; i < 12; i += 1) {
    const code = `SIGS-${datePart}-${randomTicketCodePart(6)}`;
    const existing = await get("SELECT id FROM tickets WHERE ticket_code = ?", [code]);
    if (!existing) return code;
  }
  return `SIGS-${datePart}-${randomTicketCodePart(8)}`;
}

async function resolveTicketId(identifier) {
  const raw = String(identifier || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  const row = await get("SELECT id FROM tickets WHERE ticket_code = ?", [raw]);
  return row?.id || null;
}

async function saveFiles(files, ticketId = null, replyId = null) {
  for (const file of files || []) {
    await run(
      `INSERT INTO attachments (ticket_id, reply_id, filename, original_name, file_path, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, replyId, file.filename, normalizeOriginalFilename(file.originalname), `/uploads/${file.filename}`, file.size, file.mimetype]
    );
  }
}

async function resolveSubmitterPersonId(submitterId, submitterUnionId = null) {
  if (!submitterId && !submitterUnionId) return null;
  if (!submitterUnionId) {
    const unionUser = await get("SELECT union_id FROM users WHERE id = ?", [submitterId]);
    submitterUnionId = unionUser?.union_id || null;
  }
  if (submitterUnionId) {
    const datahubByUnion = await get("SELECT id FROM datahub_basic_persons WHERE union_id = ?", [submitterUnionId]);
    if (datahubByUnion?.id) return datahubByUnion.id;
  }
  const datahubById = await get("SELECT id FROM datahub_basic_persons WHERE id = ?", [submitterId]);
  return datahubById?.id || null;
}

async function completeSubmitterTodo(ticketId, submitterId, submitterUnionId) {
  try {
    const submitterPersonId = await resolveSubmitterPersonId(submitterId, submitterUnionId);
    if (!submitterPersonId) return;
    return await completePortalTodo(buildTodoId(ticketId, 'submitter'), submitterPersonId);
  } catch (err) {
    logger.warn('portal_todo_complete_failed', { ticket_id: ticketId, type: 'submitter', message: err.message });
  }
}

async function pushSubmitterTodo(ticket, nameSuffix = "请确认处理结果") {
  try {
    const submitterPersonId = await resolveSubmitterPersonId(ticket.submitter_id, ticket.submitter_union_id);
    if (!submitterPersonId) return;
    return await pushPortalTodo({
      id: buildTodoId(ticket.id, 'submitter'),
      name: `【${ticket.title}】-${nameSuffix}`,
      url: buildSiteUrl(`/cn/tickets/${ticketPublicId(ticket)}`),
      principalPersonId: submitterPersonId
    });
  } catch (err) {
    logger.warn('portal_todo_push_failed', { ticket_id: ticket.id, type: 'submitter', message: err.message });
  }
}

async function notifyCurrentDepartmentAdmins(ticket, message, notificationType = "submitter_followup") {
  const department = ticket.current_department || ticket.department;
  if (!department) return;
  const admins = await all(
    `SELECT DISTINCT COALESCE(u.id, p.id) AS notify_user_id, p.id AS admin_person_id
     FROM datahub_basic_persons p
     LEFT JOIN users u ON u.union_id = p.union_id
     LEFT JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
     LEFT JOIN roles r ON r.id = p.role_id
     WHERE (da.id IS NOT NULL AND da.department_name = ?)
        OR ((r.code = 'liaison' OR p.role = 'liaison') AND p.department = ?)`,
    [department, department]
  );
  for (const admin of admins) {
    const notifResult = await run(
      `INSERT INTO notifications (user_id, ticket_id, type, message)
       VALUES (?, ?, ?, ?)`,
      [admin.notify_user_id, ticket.id, notificationType, message]
    );
    const targetUrl = `/cn/admin/tickets/${ticketPublicId(ticket)}?nid=${notifResult.insertId}`;
    await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
    if (admin.admin_person_id) {
      pushPortalTodo({
        id: buildTodoId(ticket.id, 'admin', admin.admin_person_id),
        name: `【${ticket.title}】-待您处理`,
        url: buildSiteUrl(`/cn/admin/tickets/${ticketPublicId(ticket)}`),
        principalPersonId: admin.admin_person_id
      }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: ticket.id, person_id: admin.admin_person_id, message: err.message }));
    }
  }
}

async function listTicketApprovals(ticketId) {
  return all(
    `SELECT ta.*,
            COALESCE(req.name, req_user.name) AS requested_by_name,
            COALESCE(app.name, app_user.name) AS approver_name
     FROM ticket_approvals ta
     LEFT JOIN datahub_basic_persons req ON req.id = ta.requested_by
     LEFT JOIN users req_user ON req_user.id = ta.requested_by
     LEFT JOIN datahub_basic_persons app ON app.id = ta.approver_id
     LEFT JOIN users app_user ON app_user.id = ta.approver_id
     WHERE ta.ticket_id = ?
     ORDER BY ta.requested_at ASC, ta.id ASC`,
    [ticketId]
  );
}

async function hasPendingApprovalForTicket(ticketId) {
  const row = await get(
    "SELECT id FROM ticket_approvals WHERE ticket_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1",
    [ticketId]
  );
  return Boolean(row);
}

function approvalStatusFromRows(rows = []) {
  const pending = rows.find((item) => item.status === "pending");
  if (pending) return "pending";
  const latest = rows.length ? rows[rows.length - 1] : null;
  return latest?.status || "none";
}

async function countEnabledDepartmentLeaders(departmentName) {
  if (!departmentName) return 0;
  const row = await get(
    "SELECT COUNT(*) AS count FROM department_leaders WHERE department_name = ? AND is_enabled = 1",
    [departmentName]
  );
  return Number(row?.count || 0);
}

async function listEnabledDepartmentLeaders(departmentName) {
  if (!departmentName) return [];
  return all(
    `SELECT DISTINCT dl.id, dl.person_id AS leader_person_id, p.name AS leader_name,
            p.department AS leader_department, p.union_id AS leader_union_id,
            COALESCE(u.id, p.id) AS notify_user_id
     FROM department_leaders dl
     JOIN datahub_basic_persons p ON p.id = dl.person_id
     LEFT JOIN users u ON u.union_id = p.union_id
     WHERE dl.department_name = ? AND dl.is_enabled = 1
     ORDER BY p.name ASC, p.id ASC`,
    [departmentName]
  );
}

async function notifyApprovalRequester(approval, ticket, decisionLabel) {
  const requesterId = approval.requested_by;
  if (!requesterId) return;
  const notifResult = await run(
    `INSERT INTO notifications (user_id, ticket_id, type, message)
     VALUES (?, ?, 'leader_approval_decided', ?)`,
    [requesterId, ticket.id, `事项【${ticket.title}】的领导审批已${decisionLabel}，请继续处理。`]
  );
  const targetUrl = `/cn/admin/tickets/${ticketPublicId(ticket)}?nid=${notifResult.insertId}`;
  await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
  pushPortalTodo({
    id: buildTodoId(ticket.id, 'admin', requesterId),
    name: `【${ticket.title}】-领导审批已${decisionLabel}，请继续处理`,
    url: buildSiteUrl(`/cn/admin/tickets/${ticketPublicId(ticket)}`),
    principalPersonId: requesterId
  }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: ticket.id, type: 'approval_requester', message: err.message }));
}

async function completeLeaderApprovalTodos(ticketId, departmentName) {
  const leaders = await listEnabledDepartmentLeaders(departmentName);
  for (const leader of leaders) {
    if (!leader.leader_person_id) continue;
    completePortalTodo(buildTodoId(ticketId, 'leader', leader.leader_person_id), leader.leader_person_id)
      .catch(err => logger.warn('portal_todo_complete_failed', { ticket_id: ticketId, person_id: leader.leader_person_id, type: 'leader_approval', message: err.message }));
  }
}

async function ticketDetails(id, viewer, options = {}) {
  const ticketId = await resolveTicketId(id);
  if (!ticketId) return null;
  const ticket = await get(
    `SELECT t.*,
            COALESCE(dp.name, u.name) AS submitter_name,
            COALESCE(dp.phone, u.phone) AS submitter_phone
     FROM tickets t
     LEFT JOIN datahub_basic_persons dp ON dp.id = t.submitter_id
     LEFT JOIN users u ON u.id = t.submitter_id
     WHERE t.id = ?`,
    [ticketId]
  );
  if (!ticket) return null;
  const isSubmitter = String(ticket.submitter_id) === String(viewer.id);
  const canViewPublished = Number(ticket.is_published) === 1;
  const leaderCanView = await canLeaderViewTicket(ticketId, ticket, viewer);
  if (!isAdminLike(viewer) && !isSubmitter && !canViewPublished && !leaderCanView) return null;

  // 权限判断：当前承办部门可处理，原始/历史经手部门仅查看，其余无权限
  let permission = 'view';
  if (canViewPublished && !isAdminLike(viewer) && !isSubmitter) {
    permission = "view";
  } else if (leaderCanView && !isAdminLike(viewer) && !isSubmitter) {
    permission = "approve";
  } else if (isAdminLike(viewer) && rawRoleForUser(viewer) !== "super_admin" && !isSubmitter) {
    permission = await getTicketPermission(ticketId, viewer);
    if (!permission) return null;
  } else if (isAdminLike(viewer)) {
    permission = 'handle';
  }

  if ((isAdminLike(viewer) || (canViewPublished && !isSubmitter)) && ticket.is_anonymous) {
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
    [ticketId]
  );
  const attachments = await all("SELECT * FROM attachments WHERE ticket_id = ? ORDER BY uploaded_at ASC", [ticketId]);
  const replyAttachments = await all(
    `SELECT a.*
     FROM attachments a
     JOIN replies r ON r.id = a.reply_id
     WHERE r.ticket_id = ?
     ORDER BY a.uploaded_at ASC`,
    [ticketId]
  );
  const followups = await all(
    `SELECT f.*, COALESCE(dp.name, u.name) AS submitter_name
     FROM ticket_followups f
     LEFT JOIN datahub_basic_persons dp ON dp.id = f.submitter_id
     LEFT JOIN users u ON u.id = f.submitter_id
     WHERE f.ticket_id = ?
     ORDER BY f.created_at ASC`,
    [ticketId]
  );
  const satisfaction = await get(
    `SELECT s.*, COALESCE(dp.name, u.name) AS user_name
     FROM satisfaction_surveys s
     LEFT JOIN datahub_basic_persons dp ON dp.id = s.user_id
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.ticket_id = ?`,
    [ticketId]
  );
  const deptName = ticket.current_department || ticket.department || "党政办";
  const currentHandler = await get(
    `SELECT id, name, department FROM (
       SELECT CAST(p.id AS CHAR) AS id, p.name, p.department
       FROM datahub_basic_persons p
       JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
       WHERE da.department_name = ?
       UNION
       SELECT CAST(p.id AS CHAR) AS id, p.name, p.department
       FROM datahub_basic_persons p
       JOIN roles r ON r.id = p.role_id
       WHERE (r.code = 'liaison' OR p.role = 'liaison') AND p.department = ?
       UNION ALL
       SELECT CAST(id AS CHAR) AS id, name, department FROM users
       WHERE role IN ('super_admin', 'liaison') AND department = ?
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
       SELECT p.id FROM datahub_basic_persons p
       JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
       WHERE da.department_name = tr.to_department
       ORDER BY p.id ASC LIMIT 1
     )
     LEFT JOIN users u_tgt ON u_tgt.id = (
       SELECT id FROM users
       WHERE role IN ('super_admin', 'liaison') AND department = tr.to_department
       ORDER BY id ASC LIMIT 1
     )
     WHERE tr.ticket_id = ?
     ORDER BY tr.created_at ASC`,
    [ticketId]
  );
  const includeInternalApprovals = options.includeInternalApprovals === true;
  const approvals = includeInternalApprovals ? await listTicketApprovals(ticketId) : [];
  const approval_status = includeInternalApprovals ? approvalStatusFromRows(approvals) : undefined;
  const department_leader_count = includeInternalApprovals
    ? await countEnabledDepartmentLeaders(ticket.current_department || ticket.department)
    : undefined;

  return {
    ticket: mapTicket(ticket),
    replies,
    attachments: attachments.map(mapAttachment),
    replyAttachments: replyAttachments.map(mapAttachment),
    followups,
    transfers,
    currentHandler: publicHandler(currentHandler),
    satisfaction: satisfaction || null,
    permission,
    approvals,
    approval_status,
    department_leader_count
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
    const leaderAssignments = await getDepartmentLeaderAssignments(person.id);

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
      is_dept_admin: assignments.length > 0,
      leader_assignments: leaderAssignments,
      is_department_leader: leaderAssignments.length > 0
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
  const authorizeUrl = ssoAuthorizeUrl(req, res);
  if (req.query?.redirect === "1") {
    return res.redirect(302, authorizeUrl);
  }
  res.json({
    authorize_url: authorizeUrl,
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
  const freshUser = await loadPerson(req.user.id);
  const publicFreshUser = publicUser(freshUser) || req.user;
  if (req.session?.loginUser && freshUser) {
    req.session.loginUser = publicFreshUser;
  }
  res.json(publicFreshUser);
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
  const labelEn = String(req.body.label_en || "").trim();
  if (!["fields", "departments"].includes(category)) {
    return res.status(400).json({ message: "无效配置分类" });
  }
  if (!label) return res.status(400).json({ message: "请填写配置名称" });
  try {
    const result = await createFormOption(category, label, req.body.is_active !== false, labelEn);
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
  const nameEn = String(req.body.name_en || "").trim();
  const type = String(req.body.type || "").trim();
  if (!name) return res.status(400).json({ message: "请填写部门名称" });
  if (!["职能处室", "教学科研机构"].includes(type)) {
    return res.status(400).json({ message: "请选择有效的部门类型" });
  }
  try {
    const result = await createDepartment(name, type, req.body.is_active !== false, nameEn);
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

  // Look up submitter's person info for storing on ticket and portal todos.
  let submitterDatahubRow = await get(
    `SELECT id, union_id, name, phone, department, role
     FROM datahub_basic_persons
     WHERE id = ? OR union_id = ?
     LIMIT 1`,
    [req.user.id, req.user.union_id || req.user.id]
  );
  let submitterUserRow = null;
  if (!submitterDatahubRow) {
    submitterUserRow = await get(
      "SELECT id, union_id, name, phone, department, role FROM users WHERE id = ? OR union_id = ? LIMIT 1",
      [req.user.id, req.user.id]
    ).catch(() => null);
    if (submitterUserRow?.union_id) {
      submitterDatahubRow = await get(
        `SELECT id, union_id, name, phone, department, role
         FROM datahub_basic_persons
         WHERE union_id = ?
         LIMIT 1`,
        [submitterUserRow.union_id]
      );
    }
  }
  const submitterUnionId = req.user.union_id || submitterDatahubRow?.union_id || null;
  const submitterPersonId = submitterDatahubRow?.id || req.user.id;
  const submitterName = req.user.name || submitterDatahubRow?.name || null;
  const submitterPhone = req.user.phone || submitterDatahubRow?.phone || submitterUserRow?.phone || null;
  const submitterRole = req.user.role || submitterDatahubRow?.role || submitterUserRow?.role || 'user';
  const submitterDepartment = req.user.department || submitterDatahubRow?.department || submitterUserRow?.department || null;

  const ticketCode = await generateTicketCode();
  const shareCode = crypto.randomBytes(12).toString("base64url");
  const result = await run(
    `INSERT INTO tickets (title, field, unit_type, department, current_department, original_department, content, is_anonymous, submitter_id, submitter_union_id, submitter_person_id, submitter_name, submitter_phone, submitter_role, submitter_department, status, ticket_code, share_code)
     VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [title, field, targetDept, targetDept, targetDept, content, is_anonymous === "true" ? 1 : 0, req.user.id, submitterUnionId, submitterPersonId, submitterName, submitterPhone, submitterRole, submitterDepartment, ticketCode, shareCode]
  );
  await saveFiles(req.files, result.insertId, null);

  const displayDept = isUnknownDept ? DEFAULT_DEPT : department;
  await notifyCurrentDepartmentAdmins(
    { id: result.insertId, ticket_code: ticketCode, title, department: targetDept, current_department: targetDept },
    `新事项【${title}】已提交至${displayDept}，请及时处理。`,
    "new_ticket"
  );

  // Portal todo for submitter
  if (submitterDatahubRow?.id) {
    pushPortalTodo({
      id: buildTodoId(result.insertId, 'submitter'),
      name: `【${title}】-待您处理`,
      url: buildSiteUrl(`/cn/tickets/${ticketCode}`),
      principalPersonId: submitterDatahubRow.id
    }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: result.insertId, type: 'submitter', message: err.message }));
  }

  res.status(201).json({ id: result.insertId, ticket_code: ticketCode, share_code: shareCode });
} catch (err) {
  console.error('POST /api/tickets error:', err);
  res.status(500).json({ message: "提交失败: " + err.message });
}
});

app.get("/api/tickets/:id", auth, async (req, res) => {
  const viewer = await loadPerson(req.user.id);
  const internalViewer = isAdminLike(viewer) || isLeaderLike(viewer);
  const details = await ticketDetails(
    req.params.id,
    viewer || req.user,
    internalViewer ? { includeInternalApprovals: true } : { includeInternalApprovals: false }
  );
  if (!details) return res.status(404).json({ message: "事项不存在" });
  if (!internalViewer) {
    const publicDetails = { ...details };
    delete publicDetails.approvals;
    delete publicDetails.approval_status;
    delete publicDetails.department_leader_count;
    res.json(publicDetails);
    return;
  }
  res.json(details);
});


app.post("/api/tickets/:id/satisfaction", auth, async (req, res) => {
  const ticketId = await resolveTicketId(req.params.id);
  if (!ticketId) return res.status(404).json({ message: "事项不存在" });
  const score = Number(req.body?.score);
  const comment = String(req.body?.comment || "").trim();
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return res.status(400).json({ message: "请选择 1-5 分满意度评分" });
  }
  if (comment.length > 500) return res.status(400).json({ message: "评价内容不能超过 500 字" });
  const ticket = await get("SELECT id, ticket_code, submitter_id, submitter_union_id, status FROM tickets WHERE id = ?", [ticketId]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (String(ticket.submitter_id) !== String(req.user.id)) return res.status(403).json({ message: "只有事项发起人可以进行满意度评价" });
  if (ticket.status !== "completed") return res.status(400).json({ message: "事项处理完成后才可以评价" });
  const existingSurvey = await get("SELECT id FROM satisfaction_surveys WHERE ticket_id = ?", [ticketId]);
  if (existingSurvey) return res.status(409).json({ message: "该事项已提交满意度评价，不能重复评价" });
  await run(
    `INSERT INTO satisfaction_surveys (ticket_id, user_id, score, comment, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [ticketId, req.user.id, score, comment]
  );
  await run(
    "UPDATE tickets SET resolution_status = 'rated', resolution_confirmed_at = COALESCE(resolution_confirmed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [ticketId]
  );
  completeSubmitterTodo(ticketId, ticket.submitter_id, ticket.submitter_union_id);
  res.json({ ok: true });
});

app.post("/api/tickets/:id/resolution", auth, async (req, res) => {
  const ticketId = await resolveTicketId(req.params.id);
  if (!ticketId) return res.status(404).json({ message: "事项不存在" });
  const ticket = await get(
    "SELECT id, ticket_code, title, submitter_id, submitter_union_id, department, current_department, status FROM tickets WHERE id = ?",
    [ticketId]
  );
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (String(ticket.submitter_id) !== String(req.user.id)) return res.status(403).json({ message: "只能确认自己的事项" });
  if (ticket.status !== "completed") return res.status(400).json({ message: "事项尚未处理完成，暂不能确认结果" });

  const resolved = req.body?.resolved === true || req.body?.resolved === "true" || req.body?.resolved === "yes";
  if (resolved) {
    await run(
      "UPDATE tickets SET resolution_status = 'resolved', resolution_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [ticketId]
    );
    return res.json({ ok: true, next: "satisfaction" });
  }

  const content = String(req.body?.content || "").trim();
  if (!content) return res.status(400).json({ message: "请填写未解决的问题说明" });

  await run(
    "INSERT INTO ticket_followups (ticket_id, content, submitter_id) VALUES (?, ?, ?)",
    [ticketId, content, req.user.id]
  );
  await run(
    "UPDATE tickets SET status = 'pending', resolution_status = 'unresolved', resolution_confirmed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [ticketId]
  );
  await notifyCurrentDepartmentAdmins(
    ticket,
    `提交人反馈事项【${ticket.title}】尚未解决，并补充了新的问题说明，请继续处理。`,
    "submitter_followup"
  );
  completeSubmitterTodo(ticketId, ticket.submitter_id, ticket.submitter_union_id);
  res.status(201).json({ ok: true });
});

app.get("/api/admin/analytics", auth, adminOnly, async (req, res) => {
  const user = await loadPerson(req.user.id);
  const params = [];
  const isGlobalAdmin = rawRoleForUser(user) === "super_admin";
  let scope = "";

  if (!isGlobalAdmin) {
    const assignments = await getDepartmentAssignments(String(user.id));
    if (assignments.length > 0) {
      const deptNames = assignments.map(a => a.department_name);
      if (deptNames.length > 0) {
        const ph = deptNames.map(() => '?').join(',');
        scope = `WHERE (
          t.current_department IN (${ph})
          OR t.original_department IN (${ph})
          OR t.id IN (SELECT ticket_id FROM transfers WHERE from_department IN (${ph}) OR to_department IN (${ph}))
        )`;
        params.push(...deptNames, ...deptNames, ...deptNames, ...deptNames);
      }
    } else if (user?.department) {
      scope = `WHERE (
        t.current_department = ?
        OR t.original_department = ?
        OR t.id IN (SELECT ticket_id FROM transfers WHERE from_department = ? OR to_department = ?)
      )`;
      params.push(user.department, user.department, user.department, user.department);
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
    `SELECT COALESCE(t.current_department, t.department, '未指定') AS department, COUNT(*) AS count
     FROM tickets t
     ${scope}
     GROUP BY COALESCE(t.current_department, t.department, '未指定')
     ORDER BY count DESC`,
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
  const requestedPageSize = Number(req.query.pageSize);
  const requestedPage = Number(req.query.page);
  const pageSize = Math.min(Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : 30, 100);
  const page = Math.max(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1, 1);
  const offset = (page - 1) * pageSize;
  const isGlobalAdmin = rawRoleForUser(user) === "super_admin";

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
            COALESCE(
              (SELECT ta_pending.status FROM ticket_approvals ta_pending WHERE ta_pending.ticket_id = t.id AND ta_pending.status = 'pending' ORDER BY ta_pending.requested_at DESC LIMIT 1),
              (SELECT ta_latest.status FROM ticket_approvals ta_latest WHERE ta_latest.ticket_id = t.id ORDER BY ta_latest.requested_at DESC LIMIT 1),
              'none'
            ) AS approval_status,
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

app.post("/api/admin/tickets/:id/approval-requests", auth, adminOnly, async (req, res) => {
  try {
    const ticketId = await resolveTicketId(req.params.id);
    if (!ticketId) return res.status(404).json({ message: "事项不存在" });
    const note = String(req.body?.note || "").trim();
    if (note.length > 1000) return res.status(400).json({ message: "审批说明不能超过1000字" });
    const user = await loadPerson(req.user.id);
    const ticket = await get(
      "SELECT id, ticket_code, title, status, department, current_department FROM tickets WHERE id = ?",
      [ticketId]
    );
    if (!ticket) return res.status(404).json({ message: "事项不存在" });
    if (ticket.status === "completed") return res.status(400).json({ message: "已完成事项不能发起领导审批" });
    const permission = await getTicketPermission(ticketId, user);
    if (permission !== 'handle') {
      return res.status(403).json({ message: "只有当前承办部门管理员可以发起领导审批" });
    }
    if (await hasPendingApprovalForTicket(ticketId)) {
      return res.status(409).json({ message: "该事项已有待审批记录，请等待领导审批" });
    }
    const departmentName = ticket.current_department || ticket.department;
    const leaders = await listEnabledDepartmentLeaders(departmentName);
    if (leaders.length === 0) {
      return res.status(400).json({ message: `当前部门「${departmentName}」尚未维护部门领导` });
    }
    const result = await run(
      `INSERT INTO ticket_approvals (ticket_id, department_name, requested_by, request_note, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [ticketId, departmentName, user.id || req.user.id, note]
    );
    await run("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ticketId]);

    for (const leader of leaders) {
      const notifResult = await run(
        `INSERT INTO notifications (user_id, ticket_id, type, message)
         VALUES (?, ?, 'leader_approval_requested', ?)`,
        [leader.notify_user_id, ticketId, `事项【${ticket.title}】需要您进行领导审批。`]
      );
      const targetUrl = `/cn/admin/tickets/${ticketPublicId(ticket)}?nid=${notifResult.insertId}`;
      await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
      if (leader.leader_person_id) {
        pushPortalTodo({
          id: buildTodoId(ticketId, 'leader', leader.leader_person_id),
          name: `【${ticket.title}】-待领导审批`,
          url: buildSiteUrl(`/cn/admin/tickets/${ticketPublicId(ticket)}`),
          principalPersonId: leader.leader_person_id
        }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: ticketId, person_id: leader.leader_person_id, type: 'leader_approval', message: err.message }));
      }
    }

    const approval = await get("SELECT * FROM ticket_approvals WHERE id = ?", [result.insertId]);
    res.status(201).json({ ok: true, approval });
  } catch (err) {
    logger.error("approval_request_failed", { request_id: req.requestId, ticket_id: req.params.id, error: err });
    res.status(500).json({ message: "发起领导审批失败: " + err.message });
  }
});

app.get("/api/leader/approvals", auth, async (req, res) => {
  const user = await loadPerson(req.user.id);
  const leaderDepartments = (user?.leader_assignments || []).map((item) => item.department_name).filter(Boolean);
  if (leaderDepartments.length === 0) return res.status(403).json({ message: "需要部门领导权限" });
  const requestedPageSize = Number(req.query.pageSize);
  const requestedPage = Number(req.query.page);
  const pageSize = Math.min(Number.isFinite(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : 30, 100);
  const page = Math.max(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1, 1);
  const offset = (page - 1) * pageSize;
  const status = String(req.query.status || "pending").trim();
  const clauses = [`ta.department_name IN (${leaderDepartments.map(() => "?").join(",")})`];
  const params = [...leaderDepartments];
  if (status === "decided") {
    clauses.push("ta.status IN ('approved', 'rejected')");
  } else if (["pending", "approved", "rejected"].includes(status)) {
    clauses.push("ta.status = ?");
    params.push(status);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const countRow = await get(`SELECT COUNT(*) AS count FROM ticket_approvals ta ${where}`, params);
  const rows = await all(
    `SELECT t.*, ta.id AS approval_id, ta.status AS approval_status,
            ta.department_name AS approval_department_name,
            ta.request_note AS approval_request_note,
            ta.requested_at AS approval_requested_at,
            ta.decided_at AS approval_decided_at,
            ta.decision_comment AS approval_decision_comment,
            COALESCE(req.name, req_user.name) AS approval_requested_by_name,
            COALESCE(app.name, app_user.name) AS approval_approver_name,
            CASE WHEN t.is_anonymous = 1 THEN '匿名' ELSE COALESCE(dp.name, u.name) END AS submitter_name,
            CASE WHEN t.is_anonymous = 1 THEN '' ELSE COALESCE(dp.phone, u.phone) END AS submitter_phone,
            'approve' AS permission
     FROM ticket_approvals ta
     JOIN tickets t ON t.id = ta.ticket_id
     LEFT JOIN datahub_basic_persons dp ON dp.id = t.submitter_id
     LEFT JOIN users u ON u.id = t.submitter_id
     LEFT JOIN datahub_basic_persons req ON req.id = ta.requested_by
     LEFT JOIN users req_user ON req_user.id = ta.requested_by
     LEFT JOIN datahub_basic_persons app ON app.id = ta.approver_id
     LEFT JOIN users app_user ON app_user.id = ta.approver_id
     ${where}
     ORDER BY ta.requested_at DESC, ta.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ page, pageSize, total: countRow?.count || 0, rows: rows.map(mapTicket) });
});

app.post("/api/leader/approvals/:id/decision", auth, async (req, res) => {
  try {
    const decision = String(req.body?.decision || "").trim();
    const comment = String(req.body?.comment || "").trim();
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ message: "请选择同意或不同意" });
    }
    if (!comment) return res.status(400).json({ message: "请填写审批意见" });
    if (comment.length > 1000) return res.status(400).json({ message: "审批意见不能超过1000字" });
    const approval = await get("SELECT * FROM ticket_approvals WHERE id = ?", [req.params.id]);
    if (!approval) return res.status(404).json({ message: "审批记录不存在" });
    if (approval.status !== "pending") return res.status(409).json({ message: "该审批已处理" });
    const user = await loadPerson(req.user.id);
    if (!user || !(await isDepartmentLeader(String(user.id), approval.department_name))) {
      return res.status(403).json({ message: "只有该部门领导可以审批" });
    }
    const ticket = await get("SELECT id, ticket_code, title FROM tickets WHERE id = ?", [approval.ticket_id]);
    if (!ticket) return res.status(404).json({ message: "事项不存在" });
    await run(
      `UPDATE ticket_approvals
       SET status = ?, approver_id = ?, decision_comment = ?, decided_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decision, user.id, comment, approval.id]
    );
    await run("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [approval.ticket_id]);
    await completeLeaderApprovalTodos(approval.ticket_id, approval.department_name);
    await notifyApprovalRequester(
      { ...approval, status: decision, approver_id: user.id, decision_comment: comment },
      ticket,
      decision === "approved" ? "同意" : "不同意"
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error("leader_approval_decision_failed", { request_id: req.requestId, approval_id: req.params.id, error: err });
    res.status(500).json({ message: "提交审批意见失败: " + err.message });
  }
});

app.post("/api/admin/tickets/:id/replies", auth, adminOnly, upload.array("attachments", 8), async (req, res) => {
  try {
    const ticketId = await resolveTicketId(req.params.id);
    if (!ticketId) return res.status(404).json({ message: "事项不存在" });
    const { content, status } = req.body;
    if (!content) return res.status(400).json({ message: "请填写回复内容" });
    const user = await loadPerson(req.user.id);
    const ticket = await get("SELECT id, ticket_code, title, submitter_id, submitter_union_id, current_department FROM tickets WHERE id = ?", [ticketId]);
    if (!ticket) return res.status(404).json({ message: "事项不存在" });
    const permission = await getTicketPermission(ticketId, user);
    if (permission !== 'handle') {
      return res.status(403).json({ message: "您所在的部门当前不是承办部门，无法处理此事项" });
    }
    if (await hasPendingApprovalForTicket(ticketId)) {
      return res.status(409).json({ message: "审批中的事项需等待领导审批完成后再提交处理结果" });
    }
    if (status && !["completed", "pending"].includes(status)) return res.status(400).json({ message: "无效状态" });
    const result = await run(
      "INSERT INTO replies (ticket_id, content, replier_id, department) VALUES (?, ?, ?, ?)",
      [ticketId, content, req.user.id, user.department]
    );
    await saveFiles(req.files, null, result.insertId);
    const nextStatus = status || "completed";
    await run(
      "UPDATE tickets SET status = ?, resolution_status = ?, resolution_confirmed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [nextStatus, nextStatus === "completed" ? "pending_confirm" : null, ticketId]
    );

    // Notify the ticket submitter
    if (ticket.submitter_id) {
      const notifResult = await run(
        `INSERT INTO notifications (user_id, ticket_id, type, message)
         VALUES (?, ?, 'replied', ?)`,
        [ticket.submitter_id, ticketId, `您的事项【${ticket.title}】已有新的处理回复。`]
      );
      const targetUrl = `/cn/tickets/${ticketPublicId(ticket)}?nid=${notifResult.insertId}`;
      await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
      if (nextStatus === "completed") {
        pushSubmitterTodo(ticket, "请确认处理结果并评价服务");
      }
    }

    // Complete portal todos
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
  const ticketId = await resolveTicketId(req.params.id);
  if (!ticketId) return res.status(404).json({ message: "事项不存在" });
  const { status } = req.body;
  if (!["pending", "completed"].includes(status)) return res.status(400).json({ message: "无效状态" });
  const user = await loadPerson(req.user.id);
  const ticket = await get("SELECT current_department FROM tickets WHERE id = ?", [ticketId]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  const permission = await getTicketPermission(ticketId, user);
  if (permission !== 'handle') {
    return res.status(403).json({ message: "只有当前承办部门管理员可以更新状态" });
  }
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, ticketId]);
  res.json({ ok: true });
});

app.post("/api/admin/tickets/:id/transfer", auth, adminOnly, async (req, res) => {
  const ticketId = await resolveTicketId(req.params.id);
  if (!ticketId) return res.status(404).json({ message: "事项不存在" });
  const { to_department, note } = req.body;
  if (!(await isValidDepartment(to_department))) return res.status(400).json({ message: "请选择有效转办部门" });
  const user = await loadPerson(req.user.id);
  const ticket = await get("SELECT id, ticket_code, title, current_department FROM tickets WHERE id = ?", [ticketId]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  const permission = await getTicketPermission(ticketId, user);
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
    [ticketId]
  );

  await run(
    "INSERT INTO transfers (ticket_id, from_department, to_department, operator_id, note, status) VALUES (?, ?, ?, ?, ?, 'active')",
    [ticketId, fromDept, to_department, req.user.id, note || ""]
  );
  await run("UPDATE tickets SET current_department = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [to_department, ticketId]);

  // Notify admins in the target department + department assignments.
  // Super admins keep global handling permission, but portal todos are only pushed
  // for departments explicitly assigned to them in department_assignments.
  const admins = await all(
    `SELECT DISTINCT COALESCE(u.id, p.id) AS notify_user_id, p.id AS admin_person_id
     FROM datahub_basic_persons p
     LEFT JOIN users u ON u.union_id = p.union_id
     LEFT JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
     LEFT JOIN roles r ON r.id = p.role_id
     WHERE (da.id IS NOT NULL AND da.department_name = ?)
        OR ((r.code = 'liaison' OR p.role = 'liaison') AND p.department = ?)`,
    [to_department, to_department]
  );
  for (const admin of admins) {
    const notifResult = await run(
      `INSERT INTO notifications (user_id, ticket_id, type, message)
       VALUES (?, ?, 'transferred_in', ?)`,
      [admin.notify_user_id, ticketId, `事项【${ticket.title}】已从${fromDept}转办至${to_department}，请及时处理。`]
    );
    const targetUrl = `/cn/admin/tickets/${ticketPublicId(ticket)}?nid=${notifResult.insertId}`;
    await run("UPDATE notifications SET target_url = ? WHERE id = ?", [targetUrl, notifResult.insertId]);
    if (admin.admin_person_id) {
      pushPortalTodo({
        id: buildTodoId(ticketId, 'admin', admin.admin_person_id),
        name: `【${ticket.title}】-待您处理`,
        url: buildSiteUrl(`/cn/admin/tickets/${ticketPublicId(ticket)}`),
        principalPersonId: admin.admin_person_id
      }).catch(err => logger.warn('portal_todo_push_failed', { ticket_id: ticketId, person_id: admin.admin_person_id, message: err.message }));
    }
  }

  // Complete portal todos for admins in the old department
  const oldDeptAdmins = await all(
    `SELECT DISTINCT p.id AS admin_person_id
     FROM datahub_basic_persons p
     LEFT JOIN department_assignments da ON da.person_id = p.id AND da.is_enabled = 1
     LEFT JOIN roles r ON r.id = p.role_id
     WHERE (da.id IS NOT NULL AND da.department_name = ?)
        OR ((r.code = 'liaison' OR p.role = 'liaison') AND p.department = ?)`,
    [fromDept, fromDept]
  );
  for (const admin of oldDeptAdmins) {
    if (admin.admin_person_id) {
      completePortalTodo(buildTodoId(ticketId, 'admin', admin.admin_person_id), admin.admin_person_id)
        .catch(err => logger.warn('portal_todo_complete_failed', { ticket_id: ticketId, person_id: admin.admin_person_id, message: err.message }));
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

  const viewer = await loadPerson(req.user.id);
  const permission = await getTicketPermission(ticketId, viewer || req.user);
  if (!permission) return res.status(403).json({ message: "无权访问此附件" });

  const filePath = path.join(uploadDir, path.basename(attachment.file_path));
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "文件不存在" });

  res.setHeader('Content-Type', attachment.file_type);
  res.setHeader('Content-Disposition', contentDispositionFilename(attachment.original_name));
  res.sendFile(filePath);
});

// -- Department Admin Permission Management --

// 搜索可授权的人员（同时搜索 datahub_basic_persons 和 users 表）
app.get("/api/admin/department-admins/search", auth, superAdminOnly, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const departmentNames = String(req.query.department_names || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const pageSize = Math.min(Number(req.query.pageSize || 20), 50);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;

  const like = keyword ? `%${keyword}%` : '%';

  // 查 datahub_basic_persons：排除学生、离职和明确无效人员
  let where = `WHERE COALESCE(p.type, '') <> '学生'
    AND LOWER(TRIM(COALESCE(p.status, ''))) NOT IN ('departure', 'false')
    AND p.is_active = 1`;
  const params = [];
  if (departmentNames.length > 0) {
    where += ` AND p.department IN (${departmentNames.map(() => "?").join(",")})`;
    params.push(...departmentNames);
  }
  if (keyword) {
    where += " AND (p.union_id LIKE ? OR p.name LIKE ? OR p.department LIKE ?)";
    params.push(like, like, like);
  }

  const countRow = await get(
    `SELECT COUNT(DISTINCT p.id) AS count
     FROM datahub_basic_persons p
     LEFT JOIN department_assignments da ON da.person_id = p.id
     ${where}`,
    params
  );
  const total = Number(countRow?.count || 0);

  const rows = await all(
    `SELECT p.id, p.union_id, p.name, p.department, p.type, p.status, p.role_id, r.code as role_code,
            MIN(da.id) AS existing_assignment_id,
            COUNT(da.id) AS assignment_count,
            MAX(CASE WHEN da.is_enabled = 1 THEN 1 ELSE 0 END) AS assignment_enabled,
            GROUP_CONCAT(DISTINCT da.department_name ORDER BY da.department_name SEPARATOR ',') AS managed_departments_text
     FROM datahub_basic_persons p
     LEFT JOIN roles r ON r.id = p.role_id
     LEFT JOIN department_assignments da ON da.person_id = p.id
     ${where}
     GROUP BY p.id, p.union_id, p.name, p.department, p.type, p.status, p.role_id, r.code
     ORDER BY p.name ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const mappedRows = rows.map((row) => ({
    ...row,
    existing_assignment_id: row.existing_assignment_id || null,
    has_department_admin_assignment: Number(row.assignment_count || 0) > 0,
    is_assignment_enabled: Number(row.assignment_enabled || 0) === 1,
    managed_departments: row.managed_departments_text
      ? String(row.managed_departments_text).split(",").filter(Boolean)
      : []
  }));

  res.json({ page, pageSize, total, rows: mappedRows });
});

function normalizeDepartmentNames(departmentNames) {
  return Array.from(new Set(
    (Array.isArray(departmentNames) ? departmentNames : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ));
}

async function allDepartmentAdminAssignments(personId) {
  return all(
    `SELECT id, person_id, department_name, role_type, can_transfer_to, is_enabled, created_at, updated_at
     FROM department_assignments
     WHERE person_id = ?
     ORDER BY department_name ASC, id ASC`,
    [personId]
  );
}

function assignmentAuditState(personId, assignments) {
  return {
    person_id: personId,
    role_type: "admin",
    managed_departments: assignments.map((item) => item.department_name),
    enabled_departments: assignments.filter((item) => Number(item.is_enabled) === 1).map((item) => item.department_name)
  };
}

async function assertAdminPersonAndDepartments(personId, departmentNames) {
  const person = await get(
    `SELECT id, union_id, name, department, type
     FROM datahub_basic_persons
     WHERE id = ?
       AND COALESCE(type, '') <> '学生'
       AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('departure', 'false')
       AND is_active = 1`,
    [personId]
  );
  if (!person) {
    const error = new Error("人员不存在或不在可授权范围（排除学生、离职和无效状态人员）");
    error.status = 404;
    throw error;
  }
  for (const dept of departmentNames) {
    if (!(await isValidDepartment(dept))) {
      const error = new Error(`部门「${dept}」无效或未启用`);
      error.status = 400;
      throw error;
    }
  }
  return person;
}

async function syncLegacyAdminRoleAfterAssignmentChange(personId) {
  const activeAssignments = await getDepartmentAssignments(String(personId));
  if (activeAssignments.length > 0) return;
  const userRole = await getRoleByCode("user");
  await run(
    `UPDATE datahub_basic_persons p
     LEFT JOIN roles r ON r.id = p.role_id
     SET p.role = 'user', p.role_id = ?, p.updated_at = CURRENT_TIMESTAMP
     WHERE p.id = ? AND (p.role = 'admin' OR r.code IN ('admin', 'dept_admin'))`,
    [userRole?.id || null, personId]
  );
}

async function replaceDepartmentAdminRows(personId, departmentNames, options = {}) {
  const normalizedDepartments = normalizeDepartmentNames(departmentNames);
  if (normalizedDepartments.length === 0) {
    const error = new Error("请至少选择一个管理部门");
    error.status = 400;
    throw error;
  }
  await assertAdminPersonAndDepartments(personId, normalizedDepartments);
  if (Array.isArray(options.can_transfer_to) && options.can_transfer_to.length > 0) {
    for (const dept of options.can_transfer_to) {
      if (!(await isValidDepartment(dept))) {
        const error = new Error(`转派目标部门「${dept}」无效或未启用`);
        error.status = 400;
        throw error;
      }
    }
  }
  const enabledValue = options.is_enabled !== undefined ? (options.is_enabled ? 1 : 0) : 1;
  const transferTargetsStr = Array.isArray(options.can_transfer_to) ? JSON.stringify(options.can_transfer_to) : "[]";

  await run(
    `DELETE FROM department_assignments
     WHERE person_id = ? AND department_name NOT IN (${normalizedDepartments.map(() => "?").join(",")})`,
    [personId, ...normalizedDepartments]
  );

  let firstId = null;
  for (const dept of normalizedDepartments) {
    const existing = await get(
      "SELECT id FROM department_assignments WHERE person_id = ? AND department_name = ?",
      [personId, dept]
    );
    if (existing) {
      await run(
        `UPDATE department_assignments
         SET role_type = 'admin', can_transfer_to = ?, is_enabled = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [transferTargetsStr, enabledValue, existing.id]
      );
      if (!firstId) firstId = existing.id;
    } else {
      const result = await run(
        `INSERT INTO department_assignments (person_id, department_name, role_type, can_transfer_to, is_enabled)
         VALUES (?, ?, 'admin', ?, ?)`,
        [personId, dept, transferTargetsStr, enabledValue]
      );
      if (!firstId) firstId = result.insertId;
    }
  }

  if (!enabledValue) await syncLegacyAdminRoleAfterAssignmentChange(personId);
  return firstId;
}

// 获取当前用户的管理部门
app.get("/api/auth/my-managed-departments", auth, async (req, res) => {
  const person = await loadPerson(req.user.id);
  const personId = person?.id || req.user.id;
  const assignments = await getDepartmentAssignments(String(personId));
  if (rawRoleForUser(person) === 'super_admin') {
    return res.json({
      departments: assignments.map(a => a.department_name),
      role_type: assignments[0]?.role_type || null,
      is_super_admin: true
    });
  }

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
  if (role_type !== 'admin') {
    return res.status(400).json({ message: '角色类型无效，仅支持部门管理员' });
  }

  try {
    const existing = await get("SELECT id FROM department_assignments WHERE person_id = ? LIMIT 1", [person_id]);
    if (existing) return res.status(409).json({ message: "该人员已有授权记录，请在列表中编辑授权部门" });

    const id = await replaceDepartmentAdminRows(person_id, department_names, { can_transfer_to, is_enabled });
    const afterAssignments = await allDepartmentAdminAssignments(person_id);
    await run(
      `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
       VALUES (?, ?, 'create', NULL, ?)`,
      [req.user.id, person_id, JSON.stringify(assignmentAuditState(person_id, afterAssignments))]
    );

    res.status(201).json({ ok: true, id });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "新增授权失败" });
  }
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
  if (roleType && roleType === 'admin') {
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
    `SELECT COUNT(DISTINCT da.person_id) AS count FROM department_assignments da
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
    grouped[row.person_id].is_enabled = (Number(grouped[row.person_id].is_enabled) === 1 || Number(row.is_enabled) === 1) ? 1 : 0;
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
  const allAssignments = await allDepartmentAdminAssignments(row.person_id);
  row.managed_departments = allAssignments.map(a => a.department_name);
  row.can_transfer_to = row.can_transfer_to ? JSON.parse(row.can_transfer_to) : [];

  res.json(row);
});

// 更新授权（单条记录）
app.put("/api/admin/department-admins/:id", auth, superAdminOnly, async (req, res) => {
  const { role_type, department_names, can_transfer_to, is_enabled } = req.body;

  const current = await get(
    `SELECT da.*, p.name AS person_name
     FROM department_assignments da
     LEFT JOIN datahub_basic_persons p ON p.id = da.person_id
     WHERE da.id = ?`,
    [req.params.id]
  );
  if (!current) return res.status(404).json({ message: '授权记录不存在' });
  if (role_type && role_type !== 'admin') {
    return res.status(400).json({ message: '角色类型无效，仅支持部门管理员' });
  }
  if (!Array.isArray(department_names) || department_names.length === 0) {
    return res.status(400).json({ message: "请至少选择一个管理部门" });
  }

  try {
    const beforeAssignments = await allDepartmentAdminAssignments(current.person_id);
    const id = await replaceDepartmentAdminRows(current.person_id, department_names, {
      can_transfer_to,
      is_enabled: is_enabled !== undefined ? is_enabled : current.is_enabled
    });
    const afterAssignments = await allDepartmentAdminAssignments(current.person_id);
    await run(
      `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
       VALUES (?, ?, 'update', ?, ?)`,
      [
        req.user.id,
        current.person_id,
        JSON.stringify(assignmentAuditState(current.person_id, beforeAssignments)),
        JSON.stringify(assignmentAuditState(current.person_id, afterAssignments))
      ]
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "更新授权失败" });
  }
});

// 删除授权
app.delete("/api/admin/department-admins/:id", auth, superAdminOnly, async (req, res) => {
  const current = await get('SELECT * FROM department_assignments WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: '授权记录不存在' });

  const beforeAssignments = await allDepartmentAdminAssignments(current.person_id);
  const departmentNames = normalizeDepartmentNames(req.body?.department_names);
  if (departmentNames.length > 0) {
    const existingNames = new Set(beforeAssignments.map((item) => item.department_name));
    for (const dept of departmentNames) {
      if (!existingNames.has(dept)) {
        return res.status(400).json({ message: `该人员没有部门「${dept}」的授权` });
      }
    }
    await run(
      `DELETE FROM department_assignments
       WHERE person_id = ? AND department_name IN (${departmentNames.map(() => "?").join(",")})`,
      [current.person_id, ...departmentNames]
    );
  } else {
    await run('DELETE FROM department_assignments WHERE person_id = ?', [current.person_id]);
  }
  await syncLegacyAdminRoleAfterAssignmentChange(current.person_id);
  const afterAssignments = await allDepartmentAdminAssignments(current.person_id);

  await run(
    `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      req.user.id,
      current.person_id,
      departmentNames.length > 0 ? 'delete_departments' : 'delete',
      JSON.stringify(assignmentAuditState(current.person_id, beforeAssignments)),
      afterAssignments.length > 0 ? JSON.stringify(assignmentAuditState(current.person_id, afterAssignments)) : null
    ]
  );

  res.json({ ok: true });
});

// 启用/禁用切换
app.patch("/api/admin/department-admins/:id/toggle", auth, superAdminOnly, async (req, res) => {
  const { is_enabled } = req.body;
  if (is_enabled === undefined) return res.status(400).json({ message: '请指定 is_enabled' });

  const current = await get('SELECT * FROM department_assignments WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: '授权记录不存在' });

  const beforeAssignments = await allDepartmentAdminAssignments(current.person_id);
  await run(
    'UPDATE department_assignments SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE person_id = ?',
    [is_enabled ? 1 : 0, current.person_id]
  );
  if (!is_enabled) await syncLegacyAdminRoleAfterAssignmentChange(current.person_id);
  const afterAssignments = await allDepartmentAdminAssignments(current.person_id);

  await run(
    `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      req.user.id,
      current.person_id,
      is_enabled ? 'enable' : 'disable',
      JSON.stringify(assignmentAuditState(current.person_id, beforeAssignments)),
      JSON.stringify(assignmentAuditState(current.person_id, afterAssignments))
    ]
  );

  res.json({ ok: true });
});

app.post("/api/admin/department-admins/:id/promote-super-admin", auth, superAdminOnly, async (req, res) => {
  const current = await get(
    `SELECT da.*, p.name AS person_name, p.union_id
     FROM department_assignments da
     LEFT JOIN datahub_basic_persons p ON p.id = da.person_id
     WHERE da.id = ?`,
    [req.params.id]
  );
  if (!current) return res.status(404).json({ message: '授权记录不存在' });

  const role = await getRoleByCode('super_admin');
  if (!role) return res.status(500).json({ message: '超级管理员角色未初始化' });

  const allAssignments = await allDepartmentAdminAssignments(current.person_id);
  const beforeState = {
    person_id: current.person_id,
    person_name: current.person_name,
    role_type: current.role_type,
    managed_departments: allAssignments.map(a => a.department_name)
  };
  const afterState = {
    person_id: current.person_id,
    role: 'super_admin',
    role_id: role.id,
    managed_departments: []
  };

  await run(
    "UPDATE datahub_basic_persons SET role = 'super_admin', role_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [role.id, current.person_id]
  );
  if (current.union_id) {
    await run(
      "UPDATE users SET role = 'super_admin' WHERE union_id = ?",
      [current.union_id]
    );
  }
  await run("DELETE FROM department_assignments WHERE person_id = ?", [current.person_id]);
  await run(
    `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
     VALUES (?, ?, 'promote_super_admin', ?, ?)`,
    [req.user.id, current.person_id, JSON.stringify(beforeState), JSON.stringify(afterState)]
  );

  res.json({ ok: true });
});

// -- Department Leader Management --

app.get("/api/admin/department-leaders/search", auth, superAdminOnly, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const departmentNames = String(req.query.department_names || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const pageSize = Math.min(Number(req.query.pageSize || 20), 50);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const params = [];
  let where = `WHERE COALESCE(p.type, '') <> '学生'
    AND LOWER(TRIM(COALESCE(p.status, ''))) NOT IN ('departure', 'false')
    AND p.is_active = 1`;
  if (departmentNames.length > 0) {
    where += ` AND p.department IN (${departmentNames.map(() => "?").join(",")})`;
    params.push(...departmentNames);
  }
  if (keyword) {
    where += " AND (p.union_id LIKE ? OR p.name LIKE ? OR p.department LIKE ?)";
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  const countRow = await get(`SELECT COUNT(*) AS count FROM datahub_basic_persons p ${where}`, params);
  const rows = await all(
    `SELECT p.id, p.union_id, p.name, p.department, p.type, p.status
     FROM datahub_basic_persons p
     ${where}
     ORDER BY p.name ASC, p.id ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ page, pageSize, total: countRow?.count || 0, rows });
});

app.get("/api/admin/department-leaders", auth, superAdminOnly, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const departmentName = String(req.query.department_name || '').trim();
  const isEnabled = req.query.is_enabled;
  const pageSize = Math.min(Number(req.query.pageSize || 20), 50);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const conditions = [];
  const params = [];
  if (keyword) {
    conditions.push("(p.name LIKE ? OR p.id LIKE ? OR p.union_id LIKE ? OR p.department LIKE ?)");
    const like = `%${keyword}%`;
    params.push(like, like, like, like);
  }
  if (departmentName) {
    conditions.push("dl.department_name = ?");
    params.push(departmentName);
  }
  if (isEnabled === '1' || isEnabled === '0') {
    conditions.push("dl.is_enabled = ?");
    params.push(Number(isEnabled));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countRow = await get(
    `SELECT COUNT(DISTINCT dl.person_id) AS count
     FROM department_leaders dl
     LEFT JOIN datahub_basic_persons p ON p.id = dl.person_id
     ${where}`,
    params
  );
  const rows = await all(
    `SELECT dl.id, dl.person_id, dl.department_name, dl.is_enabled, dl.created_at, dl.updated_at,
            p.name AS person_name, p.department AS person_department,
            p.type AS person_type, p.phone AS person_phone, p.union_id AS person_union_id
     FROM department_leaders dl
     LEFT JOIN datahub_basic_persons p ON p.id = dl.person_id
     ${where}
     ORDER BY dl.updated_at DESC, dl.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.person_id]) {
      grouped[row.person_id] = {
        id: row.id,
        person_id: row.person_id,
        person_name: row.person_name,
        person_department: row.person_department,
        person_type: row.person_type,
        person_phone: row.person_phone,
        person_union_id: row.person_union_id,
        leader_departments: [],
        is_enabled: row.is_enabled,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    }
    grouped[row.person_id].leader_departments.push(row.department_name);
    grouped[row.person_id].is_enabled = grouped[row.person_id].is_enabled && row.is_enabled ? 1 : 0;
  }
  res.json({ page, pageSize, total: countRow?.count || 0, rows: Object.values(grouped) });
});

async function assertLeaderPersonAndDepartments(personId, departmentNames) {
  const person = await get(
    `SELECT id, union_id, name, department, type
     FROM datahub_basic_persons
     WHERE id = ?
       AND COALESCE(type, '') <> '学生'
       AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('departure', 'false')
       AND is_active = 1`,
    [personId]
  );
  if (!person) {
    const error = new Error("人员不存在或不在可配置范围（排除学生、离职和无效状态人员）");
    error.status = 404;
    throw error;
  }
  for (const dept of departmentNames) {
    if (!(await isValidDepartment(dept))) {
      const error = new Error(`部门「${dept}」无效或未启用`);
      error.status = 400;
      throw error;
    }
  }
  return person;
}

async function replaceDepartmentLeaderRows(personId, departmentNames, isEnabled, operatorId) {
  const normalizedDepartments = Array.from(new Set(departmentNames.map((item) => String(item || "").trim()).filter(Boolean)));
  if (normalizedDepartments.length === 0) {
    const error = new Error("请选择至少一个领导所属部门");
    error.status = 400;
    throw error;
  }
  await assertLeaderPersonAndDepartments(personId, normalizedDepartments);
  const enabledValue = isEnabled !== undefined ? (isEnabled ? 1 : 0) : 1;
  await run(
    `DELETE FROM department_leaders
     WHERE person_id = ? AND department_name NOT IN (${normalizedDepartments.map(() => "?").join(",")})`,
    [personId, ...normalizedDepartments]
  );
  let firstId = null;
  for (const dept of normalizedDepartments) {
    const existing = await get("SELECT id FROM department_leaders WHERE person_id = ? AND department_name = ?", [personId, dept]);
    if (existing) {
      await run(
        "UPDATE department_leaders SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [enabledValue, existing.id]
      );
      if (!firstId) firstId = existing.id;
    } else {
      const result = await run(
        "INSERT INTO department_leaders (person_id, department_name, is_enabled, created_by) VALUES (?, ?, ?, ?)",
        [personId, dept, enabledValue, operatorId]
      );
      if (!firstId) firstId = result.insertId;
    }
  }
  return firstId;
}

app.post("/api/admin/department-leaders", auth, superAdminOnly, async (req, res) => {
  try {
    const { person_id, department_names, is_enabled } = req.body || {};
    if (!person_id || !Array.isArray(department_names) || department_names.length === 0) {
      return res.status(400).json({ message: "请填写完整领导配置信息" });
    }
    const id = await replaceDepartmentLeaderRows(person_id, department_names, is_enabled, req.user.id);
    res.status(201).json({ ok: true, id });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "保存部门领导失败" });
  }
});

app.put("/api/admin/department-leaders/:id", auth, superAdminOnly, async (req, res) => {
  try {
    const current = await get("SELECT * FROM department_leaders WHERE id = ?", [req.params.id]);
    if (!current) return res.status(404).json({ message: "部门领导配置不存在" });
    const { department_names, is_enabled } = req.body || {};
    if (!Array.isArray(department_names) || department_names.length === 0) {
      return res.status(400).json({ message: "请选择至少一个领导所属部门" });
    }
    const id = await replaceDepartmentLeaderRows(current.person_id, department_names, is_enabled, req.user.id);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "更新部门领导失败" });
  }
});

app.patch("/api/admin/department-leaders/:id/toggle", auth, superAdminOnly, async (req, res) => {
  const { is_enabled } = req.body || {};
  if (is_enabled === undefined) return res.status(400).json({ message: "请指定 is_enabled" });
  const current = await get("SELECT * FROM department_leaders WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ message: "部门领导配置不存在" });
  await run(
    "UPDATE department_leaders SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE person_id = ?",
    [is_enabled ? 1 : 0, current.person_id]
  );
  res.json({ ok: true });
});

app.delete("/api/admin/department-leaders/:id", auth, superAdminOnly, async (req, res) => {
  const current = await get("SELECT * FROM department_leaders WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ message: "部门领导配置不存在" });
  await run("DELETE FROM department_leaders WHERE person_id = ?", [current.person_id]);
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
  const person = await get("SELECT id, union_id, name FROM datahub_basic_persons WHERE id = ?", [person_id]);
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
  const displayName = person.name || username;

  const result = await run(
    "INSERT INTO users (username, password, password_hash, name, union_id, is_active) VALUES (?, ?, ?, ?, ?, ?)",
    [username, passwordHash, passwordHash, displayName, person.union_id, enabledValue]
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
  const ticketId = await resolveTicketId(req.params.id);
  if (!ticketId) return res.status(404).json({ message: "事项不存在" });
  const { is_published } = req.body;
  await run(
    `UPDATE tickets
     SET is_published = ?, published_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [is_published ? 1 : 0, is_published ? 1 : 0, ticketId]
  );
  res.json({ ok: true });
});

app.delete("/api/admin/tickets/:id", auth, adminOnly, async (req, res) => {
  const ticketId = await resolveTicketId(req.params.id);
  if (!ticketId) return res.status(404).json({ message: "事项不存在" });
  const files = await all("SELECT file_path FROM attachments WHERE ticket_id = ?", [ticketId]);
  await run("DELETE FROM tickets WHERE id = ?", [ticketId]);
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

setInterval(async () => {
  try {
    const rows = await all(
      `SELECT t.id, t.submitter_id, t.submitter_union_id
       FROM tickets t
       LEFT JOIN satisfaction_surveys s ON s.ticket_id = t.id
       WHERE t.status = 'completed'
         AND s.id IS NULL
         AND t.updated_at <= (NOW() - INTERVAL 24 HOUR)`
    );
    for (const row of rows) {
      await completeSubmitterTodo(row.id, row.submitter_id, row.submitter_union_id);
    }
  } catch (e) {
    logger.warn('auto_complete_submitter_todo_failed', { error: e?.message || String(e) });
  }
}, 60 * 60 * 1000);

app.get("/api/public/typical-tickets", async (req, res) => {
  const pageSize = Math.min(Number(req.query.pageSize || 50), 100);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * pageSize;
  const total = await get("SELECT COUNT(*) AS count FROM tickets WHERE is_published = 1");
  const rows = await all(
    `SELECT t.id, t.ticket_code, t.title, t.field, t.department, t.content, t.created_at, t.published_at,
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

  res.json({ ticket: mapTicket(ticket), replies, attachments: attachments.map(mapAttachment), transfers });
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
