require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { initDb, run, get, all, adminDepartments, ensureDatahubPersonTables } = require("./db");
const { fetchBasicPersons } = require("./datahub");
const { syncBasicPersons } = require("./datahub-sync");
const { askMinimax } = require("./minimax");
const logger = require("./logger");

const app = express();
const defaultPort = process.env.NODE_ENV === "production" ? 80 : 3001;
const port = process.env.PORT || defaultPort;
const jwtSecret = process.env.JWT_SECRET || "dev-secret";
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "8h";
const uploadDir = path.join(__dirname, "uploads");
const allowedExt = new Set([".txt", ".docx", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg", ".zip", ".avi", ".mp4"]);

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
app.use(express.static(distPath));

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.union_id,
    union_id: user.union_id,
    name: user.name,
    phone: user.phone,
    role: user.role || "user",
    department: user.department
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

function auth(req, res, next) {
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

async function loadPerson(id) {
  return get("SELECT * FROM datahub_basic_persons WHERE id = ?", [id]);
}

async function adminOnly(req, res, next) {
  try {
    const user = await loadPerson(req.user.id);
    if (user?.role !== "admin") return res.status(403).json({ message: "需要管理员权限" });
    req.user.role = "admin";
    req.user.department = user.department;
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
  if (viewer.role !== "admin" && ticket.submitter_id !== viewer.id) return null;
  if (viewer.role === "admin" && ticket.is_anonymous) {
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
  const currentHandler = await get(
    `SELECT id, name, department
     FROM datahub_basic_persons
     WHERE role = 'admin' AND department = ?
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
       WHERE role = 'admin' AND department = tr.to_department
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
    ratings: ratings.reduce((acc, item) => ({ ...acc, [item.type]: item.count }), {})
  };
}

app.post("/api/auth/login", async (req, res) => {
  const unionId = String(req.body.union_id || req.body.username || "").trim();
  const { password } = req.body;
  const user = await get(
    `SELECT *
     FROM datahub_basic_persons
     WHERE union_id = ?
     LIMIT 1`,
    [unionId]
  );
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    logger.warn("auth_login_failed", { request_id: req.requestId, union_id: unionId, reason: "invalid_credentials" });
    return res.status(401).json({ message: "账号或密码错误" });
  }
  logger.info("auth_login_success", {
    request_id: req.requestId,
    user_id: user.id,
    union_id: user.union_id,
    role: user.role,
    department: user.department
  });
  res.json({
    token: signUser(user),
    expires_in: jwtExpiresIn,
    user: publicUser(user)
  });
});

app.get("/api/auth/me", auth, async (req, res) => {
  res.json(publicUser(await loadPerson(req.user.id)));
});

app.get("/api/departments", auth, async (req, res) => {
  res.json(adminDepartments);
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
  const params = [];
  let where = "";
  if (keyword) {
    where = "WHERE name LIKE ? OR union_id LIKE ? OR department LIKE ?";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const total = await get(`SELECT COUNT(*) AS count FROM datahub_basic_persons ${where}`, params);
  const rows = await all(
    `SELECT id, union_id, name, type, category, department, status,
            appoint_attr, appointment_form, hire_post, write_date, synced_at, role
     FROM datahub_basic_persons
     ${where}
     ORDER BY write_date DESC, id ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ page, pageSize, total: total?.count || 0, rows });
});

app.get("/api/tickets", auth, async (req, res) => {
  const rows = await all(
    `SELECT t.*, COUNT(a.id) AS attachment_count
     FROM tickets t
     LEFT JOIN attachments a ON a.ticket_id = t.id
     WHERE t.submitter_id = ?
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
    [req.user.id]
  );
  res.json(rows.map(mapTicket));
});

app.post("/api/tickets", auth, upload.array("attachments", 8), async (req, res) => {
  const { title, field, department, content, is_anonymous, phone } = req.body;
  if (!title || !field || !department || !content) return res.status(400).json({ message: "请填写标题、事项领域、部门和内容" });
  if (!adminDepartments.includes(department)) return res.status(400).json({ message: "请选择有效部门" });
  if (phone) await run("UPDATE datahub_basic_persons SET phone = ? WHERE id = ?", [phone, req.user.id]);

  const result = await run(
    `INSERT INTO tickets (title, field, unit_type, department, current_department, content, is_anonymous, submitter_id, status)
     VALUES (?, ?, '', ?, '党政办', ?, ?, ?, 'pending')`,
    [title, field, department, content, is_anonymous === "true" ? 1 : 0, req.user.id]
  );
  await saveFiles(req.files, result.lastID, null);

  const ai = await askMinimax({ title, field, department, content });
  await run("UPDATE tickets SET ai_category = ?, ai_suggestion = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    ai.category,
    ai.suggestion,
    result.lastID
  ]);
  res.status(201).json({ id: result.lastID, ai });
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

app.get("/api/admin/tickets", auth, adminOnly, async (req, res) => {
  const user = await loadPerson(req.user.id);
  const params = [];
  let scope = "";
  if (user?.department && user.department !== "党政办") {
    scope = "WHERE t.current_department = ?";
    params.push(user.department);
  }
  const rows = await all(
    `SELECT t.*,
            CASE WHEN t.is_anonymous = 1 THEN '匿名' ELSE p.name END AS submitter_name,
            CASE WHEN t.is_anonymous = 1 THEN '' ELSE p.phone END AS submitter_phone,
            COUNT(a.id) AS attachment_count
     FROM tickets t
     JOIN datahub_basic_persons p ON p.id = t.submitter_id
     LEFT JOIN attachments a ON a.ticket_id = t.id
     ${scope}
     GROUP BY t.id
     ORDER BY t.updated_at DESC, t.created_at DESC`,
    params
  );
  res.json(rows.map(mapTicket));
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
  if (status && !["completed", "processing"].includes(status)) return res.status(400).json({ message: "无效状态" });
  const result = await run(
    "INSERT INTO replies (ticket_id, content, replier_id, department) VALUES (?, ?, ?, ?)",
    [req.params.id, content, req.user.id, user.department]
  );
  await saveFiles(req.files, null, result.lastID);
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status || "processing", req.params.id]);
  res.status(201).json({ id: result.lastID });
});

app.patch("/api/admin/tickets/:id/status", auth, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!["pending", "processing", "completed"].includes(status)) return res.status(400).json({ message: "无效状态" });
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
  await run("UPDATE tickets SET current_department = ?, status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [to_department, req.params.id]);
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

app.get("/api/public/typical-tickets", async (req, res) => {
  const rows = await all(
    `SELECT t.id, t.title, t.field, t.department, t.content, t.created_at, t.published_at,
            r.content AS reply_content, r.department AS reply_department, r.created_at AS reply_time
     FROM tickets t
     LEFT JOIN replies r ON r.id = (
       SELECT id FROM replies WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
     )
     WHERE t.is_published = 1
     ORDER BY t.published_at DESC`
  );
  res.json(rows);
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

app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

initDb()
  .then(() => {
    app.listen(port, () => {
      logger.info("server_started", { port });
      console.log(`API server running at http://localhost:${port}`);
      console.log("Seed accounts: student/123456, admin/123456");
    });
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
