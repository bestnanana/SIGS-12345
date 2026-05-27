const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const logDir = process.env.LOG_DIR || path.join(__dirname, "logs");
const maxLogLineLength = Number(process.env.LOG_MAX_LINE_LENGTH || 12000);

function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function logPath() {
  return path.join(logDir, `app-${todayStamp()}.log`);
}

function sanitize(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (Array.isArray(value)) return value.map(sanitize);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["password", "token", "authorization", "Authorization"].includes(key))
        .map(([key, item]) => [key, sanitize(item)])
    );
  }

  return value;
}

function writeLog(level, event, details = {}) {
  ensureLogDir();
  const entry = {
    time: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    ...sanitize(details)
  };
  let line = JSON.stringify(entry);
  if (line.length > maxLogLineLength) {
    line = JSON.stringify({
      time: entry.time,
      level,
      event,
      pid: process.pid,
      truncated: true,
      message: line.slice(0, maxLogLineLength)
    });
  }
  fs.appendFile(logPath(), `${line}\n`, "utf8", (err) => {
    if (err) console.error("log_write_failed", err);
  });
}

function requestId() {
  return crypto.randomBytes(8).toString("hex");
}

function requestLogger(req, res, next) {
  req.requestId = req.headers["x-request-id"] || requestId();
  const start = Date.now();
  res.setHeader("X-Request-Id", req.requestId);

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    writeLog(level, "http_request", {
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: durationMs,
      user_id: req.user?.id,
      user_role: req.user?.role,
      ip: req.ip
    });
  });

  next();
}

const logger = {
  info: (event, details) => writeLog("info", event, details),
  warn: (event, details) => writeLog("warn", event, details),
  error: (event, details) => writeLog("error", event, details),
  requestLogger
};

module.exports = logger;
