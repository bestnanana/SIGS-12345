require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { initDb, run, get, all, adminDepartments } = require("./db");
const { askMinimax } = require("./minimax");
const logger = require("./logger");

const app = express();
const defaultPort = process.env.NODE_ENV === "production" ? 80 : 3001;
const port = process.env.PORT || defaultPort;
const jwtSecret = process.env.JWT_SECRET || "dev-secret";
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "8h";
const uploadDir = path.join(__dirname, "uploads");
const allowedExt = new Set([".txt", ".docx", ".xlsx", ".pdf", ".png", ".jpg", ".jpeg", ".zip", ".avi", ".mp4"]);
const SUPER_ADMIN_LEVEL = 0;

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
    if (!allowedExt.has(ext)) {
      cb(new Error("不支持的附件类型"));
      return;
    }
    cb(null, true);
  }
});

app.use(cors());
app.use(logger.requestLogger);
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

// Serve React static build
const distPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(distPath));

function adminLevelOf(user) {
  if (user?.role !== "admin") return null;
  return Number(user.admin_level ?? 2);
}

function canResetPasswordByLevel(operatorLevel, targetRole, targetLevel) {
  if (operatorLevel === SUPER_ADMIN_LEVEL) return true;
  if (operatorLevel === 1) return targetRole !== "admin" || targetLevel === 2;
  return targetRole !== "admin";
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    phone: user.phone,
    role: user.role,
    department: user.department,
    admin_level: adminLevelOf(user)
  };
}

function publicHandler(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    department: user.department,
    admin_level: Number(user.admin_level ?? 2)
  };
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, role: user.role, department: user.department, admin_level: adminLevelOf(user) },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "请先登录" });

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

async function adminOnly(req, res, next) {
  try {
    const user = await get(
      `SELECT u.role, u.department, a.level AS admin_level
       FROM users u
       LEFT JOIN admins a ON a.user_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (user?.role !== "admin") return res.status(403).json({ message: "需要管理员权限" });
    req.user.role = user.role;
    req.user.department = user.department;
    req.user.admin_level = adminLevelOf(user);
    next();
  } catch (error) {
    next(error);
  }
}

async function firstLevelAdminOnly(req, res, next) {
  try {
    const user = await get(
      `SELECT u.role, u.department, a.level AS admin_level
       FROM users u
       LEFT JOIN admins a ON a.user_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (user?.role !== "admin") return res.status(403).json({ message: "需要管理员权限" });
    if (![SUPER_ADMIN_LEVEL, 1].includes(adminLevelOf(user))) return res.status(403).json({ message: "需要1级或超级管理员权限" });
    req.user.role = user.role;
    req.user.department = user.department;
    req.user.admin_level = adminLevelOf(user);
    next();
  } catch (error) {
    next(error);
  }
}

async function leaderAdminOnly(req, res, next) {
  return firstLevelAdminOnly(req, res, next);
}

function mapTicket(row) {
  if (!row) return row;
  return {
    ...row,
    is_anonymous: Boolean(row.is_anonymous)
  };
}

async function ticketDetails(id, viewer) {
  const ticket = await get(
    `SELECT t.*, u.name AS submitter_name, u.phone AS submitter_phone
     FROM tickets t
     JOIN users u ON u.id = t.submitter_id
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
    `SELECT r.*, u.name AS replier_name
     FROM replies r
     JOIN users u ON u.id = r.replier_id
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
    `SELECT u.id, u.name, u.department, a.level AS admin_level
     FROM admins a
     JOIN users u ON u.id = a.user_id
     WHERE u.role = 'admin' AND a.department = ?
     ORDER BY CASE WHEN a.level = 2 THEN 0 WHEN a.level = 1 THEN 1 ELSE 2 END,
              a.id ASC
     LIMIT 1`,
    [ticket.current_department || ticket.department || "党政办"]
  );
  const transfers = await all(
    `SELECT tr.*, u.name AS operator_name, target_admin.name AS target_operator_name
     FROM transfers tr
     JOIN users u ON u.id = tr.operator_id
     LEFT JOIN users target_admin ON target_admin.id = (
       SELECT a.user_id
       FROM admins a
       JOIN users au ON au.id = a.user_id
       WHERE au.role = 'admin' AND a.department = tr.to_department
       ORDER BY CASE WHEN a.level = 2 THEN 0 WHEN a.level = 1 THEN 1 ELSE 2 END,
                a.id ASC
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

async function saveFiles(files, ticketId = null, replyId = null) {
  for (const file of files || []) {
    await run(
      `INSERT INTO attachments (ticket_id, reply_id, filename, original_name, file_path, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, replyId, file.filename, file.originalname, `/uploads/${file.filename}`, file.size, file.mimetype]
    );
  }
}

async function ensureReplyApprovalTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS reply_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      requested_status TEXT NOT NULL DEFAULT 'processing',
      requester_id INTEGER NOT NULL,
      department TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_reviewer_id INTEGER,
      reviewer_id INTEGER,
      review_note TEXT,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (assigned_reviewer_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id)
    )
  `);
  const columns = await all("PRAGMA table_info(reply_approvals)");
  if (!columns.some((item) => item.name === "assigned_reviewer_id")) {
    await run("ALTER TABLE reply_approvals ADD COLUMN assigned_reviewer_id INTEGER");
  }
  await run(`
    CREATE TABLE IF NOT EXISTS reply_approval_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (approval_id) REFERENCES reply_approvals(id)
    )
  `);
}

async function saveApprovalFiles(files, approvalId) {
  for (const file of files || []) {
    await run(
      `INSERT INTO reply_approval_attachments (approval_id, filename, original_name, file_path, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [approvalId, file.filename, file.originalname, `/uploads/${file.filename}`, file.size, file.mimetype]
    );
  }
}

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await get(
    `SELECT u.*, a.level AS admin_level
     FROM users u
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.username = ?`,
    [username]
  );
  if (!user || !bcrypt.compareSync(password, user.password)) {
    logger.warn("auth_login_failed", {
      request_id: req.requestId,
      username,
      reason: "invalid_credentials"
    });
    return res.status(401).json({ message: "用户名或密码错误" });
  }
  logger.info("auth_login_success", {
    request_id: req.requestId,
    user_id: user.id,
    username: user.username,
    role: user.role,
    department: user.department,
    admin_level: adminLevelOf(user)
  });
  res.json({
    token: signUser(user),
    expires_in: jwtExpiresIn,
    user: publicUser(user)
  });
});

app.get("/api/auth/me", auth, async (req, res) => {
  const user = await get(
    `SELECT u.id, u.username, u.name, u.phone, u.role, u.department, a.level AS admin_level
     FROM users u
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.id = ?`,
    [req.user.id]
  );
  res.json(publicUser(user));
});

app.get("/api/departments", auth, async (req, res) => {
  res.json(adminDepartments);
});

app.get("/api/admin/users", auth, firstLevelAdminOnly, async (req, res) => {
  const users = await all(
    `SELECT u.id, u.username, u.name, u.phone, u.role, u.department, u.created_at,
            a.level AS admin_level, a.department AS admin_department, a.updated_at AS admin_updated_at,
            assigner.name AS assigned_by_name
     FROM users u
     LEFT JOIN admins a ON a.user_id = u.id
     LEFT JOIN users assigner ON assigner.id = a.assigned_by
     ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
              COALESCE(a.level, 9) ASC,
              u.id ASC`
  );
  res.json(users.map((user) => ({
    ...user,
    admin_level: user.role === "admin" ? Number(user.admin_level ?? 2) : null
  })));
});

app.get("/api/admin/password-users", auth, adminOnly, async (req, res) => {
  const currentLevel = Number(req.user.admin_level ?? 2);
  const users = await all(
    `SELECT u.id, u.username, u.name, u.phone, u.role, u.department, u.created_at,
            a.level AS admin_level, a.department AS admin_department
     FROM users u
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.id <> ?
     ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
              COALESCE(a.level, 9) ASC,
              u.id ASC`,
    [req.user.id]
  );

  res.json(users.map((item) => {
    const targetLevel = item.role === "admin" ? Number(item.admin_level ?? 2) : null;
    return {
      ...item,
      admin_level: targetLevel,
      can_reset_password: canResetPasswordByLevel(currentLevel, item.role, targetLevel)
    };
  }));
});

app.patch("/api/admin/users/:id/admin", auth, firstLevelAdminOnly, async (req, res) => {
  const { role = "admin", level, department } = req.body;
  const adminLevel = Number(level);
  const userId = Number(req.params.id);
  const operatorLevel = Number(req.user.admin_level ?? 2);

  if (!Number.isInteger(userId)) return res.status(400).json({ message: "无效用户" });
  if (!["user", "admin"].includes(role)) return res.status(400).json({ message: "请选择有效身份" });
  if (role === "admin" && ![SUPER_ADMIN_LEVEL, 1, 2].includes(adminLevel)) return res.status(400).json({ message: "请选择有效管理员等级" });
  if (role === "admin" && adminLevel === SUPER_ADMIN_LEVEL && operatorLevel !== SUPER_ADMIN_LEVEL) {
    return res.status(403).json({ message: "只有超级管理员可以授予超级管理员权限" });
  }
  if (role === "admin" && !adminDepartments.includes(department)) return res.status(400).json({ message: "请选择有效部门" });
  if (userId === req.user.id && (role !== "admin" || adminLevel !== operatorLevel)) {
    return res.status(400).json({ message: "不能降低自己的管理员权限" });
  }

  const target = await get(
    `SELECT u.id, u.role, a.level AS admin_level
     FROM users u
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );
  if (!target) return res.status(404).json({ message: "用户不存在" });
  const targetLevel = target.role === "admin" ? Number(target.admin_level ?? 2) : null;
  if (targetLevel === SUPER_ADMIN_LEVEL && operatorLevel !== SUPER_ADMIN_LEVEL) {
    return res.status(403).json({ message: "只有超级管理员可以调整超级管理员权限" });
  }

  if (role === "user") {
    await run("UPDATE users SET role = 'user' WHERE id = ?", [userId]);
    await run("DELETE FROM admins WHERE user_id = ?", [userId]);

    const updatedUser = await get(
      `SELECT u.id, u.username, u.name, u.phone, u.role, u.department, a.level AS admin_level
       FROM users u
       LEFT JOIN admins a ON a.user_id = u.id
       WHERE u.id = ?`,
      [userId]
    );
    logger.info("admin_permission_updated", {
      request_id: req.requestId,
      operator_id: req.user.id,
      target_user_id: userId,
      role: "user"
    });
    return res.json(publicUser(updatedUser));
  }

  await run("UPDATE users SET role = 'admin', department = ? WHERE id = ?", [department, userId]);

  const adminRecord = await get("SELECT id FROM admins WHERE user_id = ?", [userId]);
  if (adminRecord) {
    await run(
      "UPDATE admins SET level = ?, department = ?, assigned_by = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
      [adminLevel, department, req.user.id, userId]
    );
  } else {
    await run(
      "INSERT INTO admins (user_id, level, department, assigned_by) VALUES (?, ?, ?, ?)",
      [userId, adminLevel, department, req.user.id]
    );
  }

  const updated = await get(
    `SELECT u.id, u.username, u.name, u.phone, u.role, u.department, a.level AS admin_level
     FROM users u
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );
  logger.info("admin_permission_updated", {
    request_id: req.requestId,
    operator_id: req.user.id,
    target_user_id: userId,
    role: "admin",
    department,
    admin_level: adminLevel
  });
  res.json(publicUser(updated));
});

app.patch("/api/admin/users/:id/password", auth, adminOnly, async (req, res) => {
  const { password } = req.body;
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ message: "无效用户" });
  if (userId === req.user.id) return res.status(400).json({ message: "不能在此处重置自己的密码" });
  if (!password || String(password).length < 6) {
    return res.status(400).json({ message: "新密码至少需要6位" });
  }

  const operatorLevel = Number(req.user.admin_level ?? 2);
  const target = await get(
    `SELECT u.id, u.role, a.level AS admin_level
     FROM users u
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );
  if (!target) return res.status(404).json({ message: "用户不存在" });

  const targetLevel = target.role === "admin" ? Number(target.admin_level ?? 2) : null;
  const canReset = canResetPasswordByLevel(operatorLevel, target.role, targetLevel);
  if (!canReset) return res.status(403).json({ message: "只能重置低一级管理员或普通用户的密码" });

  await run("UPDATE users SET password = ? WHERE id = ?", [bcrypt.hashSync(String(password), 10), userId]);
  logger.info("admin_password_reset", {
    request_id: req.requestId,
    operator_id: req.user.id,
    target_user_id: userId
  });
  res.json({ ok: true });
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

  if (phone) {
    await run("UPDATE users SET phone = ? WHERE id = ?", [phone, req.user.id]);
  }

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

  logger.info("ticket_created", {
    request_id: req.requestId,
    ticket_id: result.lastID,
    submitter_id: req.user.id,
    field,
    department,
    attachment_count: req.files?.length || 0,
    is_anonymous: is_anonymous === "true"
  });
  res.status(201).json({ id: result.lastID, ai });
});

app.get("/api/tickets/:id", auth, async (req, res) => {
  const details = await ticketDetails(req.params.id, req.user);
  if (!details) return res.status(404).json({ message: "事项不存在" });
  res.json(details);
});

app.post("/api/tickets/:id/ratings", auth, async (req, res) => {
  const { type } = req.body;
  if (!["like", "dislike", "favorite"].includes(type)) {
    return res.status(400).json({ message: "无效评价类型" });
  }
  const exists = await get("SELECT id FROM tickets WHERE id = ?", [req.params.id]);
  if (!exists) return res.status(404).json({ message: "事项不存在" });

  await run("INSERT OR IGNORE INTO ratings (ticket_id, user_id, type) VALUES (?, ?, ?)", [
    req.params.id,
    req.user.id,
    type
  ]);
  logger.info("ticket_rated", {
    request_id: req.requestId,
    ticket_id: Number(req.params.id),
    user_id: req.user.id,
    type
  });
  res.json({ ok: true });
});

app.get("/api/admin/tickets", auth, adminOnly, async (req, res) => {
  const user = await get("SELECT department FROM users WHERE id = ?", [req.user.id]);
  const params = [];
  let scope = "";
  if (user?.department && user.department !== "党政办") {
    scope = "WHERE t.current_department = ?";
    params.push(user.department);
  }
  const rows = await all(
    `SELECT t.*,
            CASE WHEN t.is_anonymous = 1 THEN '匿名' ELSE u.name END AS submitter_name,
            CASE WHEN t.is_anonymous = 1 THEN '' ELSE u.phone END AS submitter_phone,
            COUNT(a.id) AS attachment_count
     FROM tickets t
     JOIN users u ON u.id = t.submitter_id
     LEFT JOIN attachments a ON a.ticket_id = t.id
     ${scope}
     GROUP BY t.id
     ORDER BY t.updated_at DESC, t.created_at DESC`,
    params
  );
  res.json(rows.map(mapTicket));
});

app.post("/api/admin/tickets/:id/replies", auth, adminOnly, upload.array("attachments", 8), async (req, res) => {
  const { content, status, approval_user_id } = req.body;
  if (!content) return res.status(400).json({ message: "请填写回复内容" });

  const user = await get("SELECT department FROM users WHERE id = ?", [req.user.id]);
  const ticket = await get("SELECT id, current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (!user?.department || user.department !== ticket.current_department) {
    return res.status(403).json({ message: "事项已转办，只有当前承办部门可以回复处理" });
  }

  if (status && !["completed", "processing"].includes(status)) {
    return res.status(400).json({ message: "????" });
  }

  if (Number(req.user.admin_level ?? 2) === 2) {
    await ensureReplyApprovalTables();
    const approvalUserId = Number(approval_user_id);
    if (!Number.isInteger(approvalUserId)) {
      return res.status(400).json({ message: "??????" });
    }
    const reviewer = await get(
      `SELECT u.id, u.department, a.level AS admin_level
       FROM users u
       JOIN admins a ON a.user_id = u.id
       WHERE u.id = ? AND u.role = 'admin'`,
      [approvalUserId]
    );
    if (!reviewer || ![0, 1].includes(Number(reviewer.admin_level ?? 2))) {
      return res.status(400).json({ message: "????????" });
    }
    if (Number(reviewer.admin_level ?? 2) !== 0 && reviewer.department !== user.department) {
      return res.status(400).json({ message: "?????????????????" });
    }
    const pendingApproval = await get(
      "SELECT id FROM reply_approvals WHERE ticket_id = ? AND requester_id = ? AND status = 'pending'",
      [req.params.id, req.user.id]
    );
    if (pendingApproval) {
      return res.status(409).json({ message: "??????????????????" });
    }
    const approvalResult = await run(
      `INSERT INTO reply_approvals (ticket_id, content, requested_status, requester_id, department, assigned_reviewer_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.id, content, status || "processing", req.user.id, user.department, approvalUserId]
    );
    await saveApprovalFiles(req.files, approvalResult.lastID);
    await run("UPDATE tickets SET status = 'leader_approval', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
    logger.info("ticket_reply_approval_requested", {
      request_id: req.requestId,
      ticket_id: Number(req.params.id),
      approval_id: approvalResult.lastID,
      requester_id: req.user.id,
      department: user.department,
      assigned_reviewer_id: approvalUserId
    });
    return res.status(202).json({ id: approvalResult.lastID, approval_required: true });
  }

  const result = await run(
    "INSERT INTO replies (ticket_id, content, replier_id, department) VALUES (?, ?, ?, ?)",
    [req.params.id, content, req.user.id, user.department]
  );
  await saveFiles(req.files, null, result.lastID);
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    status || "processing",
    req.params.id
  ]);

  logger.info("ticket_replied", {
    request_id: req.requestId,
    ticket_id: Number(req.params.id),
    reply_id: result.lastID,
    operator_id: req.user.id,
    department: user.department,
    status: status || "processing",
    attachment_count: req.files?.length || 0
  });
  res.status(201).json({ id: result.lastID });
});

app.patch("/api/admin/tickets/:id/status", auth, adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!["pending", "processing", "completed"].includes(status)) {
    return res.status(400).json({ message: "无效状态" });
  }
  const user = await get("SELECT department FROM users WHERE id = ?", [req.user.id]);
  const ticket = await get("SELECT current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (!user?.department || user.department !== ticket.current_department) {
    return res.status(403).json({ message: "只有当前承办部门可以更新状态" });
  }
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [status, req.params.id]);
  logger.info("ticket_status_updated", {
    request_id: req.requestId,
    ticket_id: Number(req.params.id),
    operator_id: req.user.id,
    department: user.department,
    status
  });
  res.json({ ok: true });
});

app.get("/api/admin/approval-reviewers", auth, adminOnly, async (req, res) => {
  const user = await get("SELECT department FROM users WHERE id = ?", [req.user.id]);
  const rows = await all(
    `SELECT u.id, u.name, u.department, a.level AS admin_level
     FROM users u
     JOIN admins a ON a.user_id = u.id
     WHERE u.role = 'admin' AND a.level IN (0, 1)
       AND (a.level = 0 OR a.department = ?)
     ORDER BY a.level ASC, u.id ASC`,
    [user?.department || req.user.department]
  );
  res.json(rows.map((item) => ({ ...item, admin_level: Number(item.admin_level ?? 2) })));
});

app.get("/api/leader/reply-approvals", auth, leaderAdminOnly, async (req, res) => {
  await ensureReplyApprovalTables();
  const params = [];
  let scope = "WHERE ra.status = 'pending' AND ra.assigned_reviewer_id = ?";
  params.push(req.user.id);
  const rows = await all(
    `SELECT ra.*, t.title AS ticket_title, t.field, t.department AS ticket_department,
            t.current_department, t.content AS ticket_content, t.created_at AS ticket_created_at,
            requester.name AS requester_name, reviewer.name AS assigned_reviewer_name
     FROM reply_approvals ra
     JOIN tickets t ON t.id = ra.ticket_id
     JOIN users requester ON requester.id = ra.requester_id
     LEFT JOIN users reviewer ON reviewer.id = ra.assigned_reviewer_id
     ${scope}
     ORDER BY ra.created_at ASC`,
    params
  );
  const ids = rows.map((item) => item.id);
  const attachments = ids.length
    ? await all(
      `SELECT * FROM reply_approval_attachments
       WHERE approval_id IN (${ids.map(() => "?").join(",")})
       ORDER BY uploaded_at ASC`,
      ids
    )
    : [];
  const attachmentsByApproval = attachments.reduce((acc, item) => {
    acc[item.approval_id] = [...(acc[item.approval_id] || []), item];
    return acc;
  }, {});
  res.json(rows.map((item) => ({
    ...item,
    attachments: attachmentsByApproval[item.id] || []
  })));
});

app.patch("/api/leader/reply-approvals/:id", auth, leaderAdminOnly, async (req, res) => {
  const { action, note = "" } = req.body;
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ message: "请选择有效审批操作" });
  }
  await ensureReplyApprovalTables();
  const approval = await get(
    `SELECT ra.*, t.current_department
     FROM reply_approvals ra
     JOIN tickets t ON t.id = ra.ticket_id
     WHERE ra.id = ?`,
    [req.params.id]
  );
  if (!approval) return res.status(404).json({ message: "审批记录不存在" });
  if (approval.status !== "pending") return res.status(409).json({ message: "该回复已审批" });
  if (Number(req.user.admin_level ?? 2) !== SUPER_ADMIN_LEVEL && approval.department !== req.user.department) {
    return res.status(403).json({ message: "只能审批本部门回复" });
  }

  if (action === "reject") {
    await run(
      `UPDATE reply_approvals
       SET status = 'rejected', reviewer_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id, note, req.params.id]
    );
    await run("UPDATE tickets SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [approval.ticket_id]);
    logger.info("ticket_reply_approval_rejected", {
      request_id: req.requestId,
      approval_id: Number(req.params.id),
      reviewer_id: req.user.id
    });
    return res.json({ ok: true });
  }

  const result = await run(
    "INSERT INTO replies (ticket_id, content, replier_id, department) VALUES (?, ?, ?, ?)",
    [approval.ticket_id, approval.content, approval.requester_id, approval.department]
  );
  const approvalFiles = await all("SELECT * FROM reply_approval_attachments WHERE approval_id = ?", [approval.id]);
  for (const file of approvalFiles) {
    await run(
      `INSERT INTO attachments (ticket_id, reply_id, filename, original_name, file_path, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [null, result.lastID, file.filename, file.original_name, file.file_path, file.file_size, file.file_type]
    );
  }
  await run("UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    approval.requested_status === "replied" ? "processing" : approval.requested_status || "processing",
    approval.ticket_id
  ]);
  await run(
    `UPDATE reply_approvals
     SET status = 'approved', reviewer_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [req.user.id, note, req.params.id]
  );
  logger.info("ticket_reply_approval_approved", {
    request_id: req.requestId,
    approval_id: Number(req.params.id),
    reply_id: result.lastID,
    reviewer_id: req.user.id
  });
  res.json({ ok: true, reply_id: result.lastID });
});

app.post("/api/admin/tickets/:id/transfer", auth, adminOnly, async (req, res) => {
  const { to_department, note } = req.body;
  if (!adminDepartments.includes(to_department)) return res.status(400).json({ message: "请选择有效转办部门" });

  const user = await get("SELECT department FROM users WHERE id = ?", [req.user.id]);
  const ticket = await get("SELECT id, current_department FROM tickets WHERE id = ?", [req.params.id]);
  if (!ticket) return res.status(404).json({ message: "事项不存在" });
  if (!user?.department || user.department !== ticket.current_department) {
    return res.status(403).json({ message: "只能由当前承办部门转办事项" });
  }
  if (to_department === ticket.current_department) {
    return res.status(400).json({ message: "不能转办给当前承办部门" });
  }

  await run(
    "INSERT INTO transfers (ticket_id, from_department, to_department, operator_id, note) VALUES (?, ?, ?, ?, ?)",
    [req.params.id, ticket.current_department || "党政办", to_department, req.user.id, note || ""]
  );
  await run("UPDATE tickets SET current_department = ?, status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    to_department,
    req.params.id
  ]);
  logger.info("ticket_transferred", {
    request_id: req.requestId,
    ticket_id: Number(req.params.id),
    operator_id: req.user.id,
    from_department: ticket.current_department || "党政办",
    to_department,
    has_note: Boolean(note)
  });
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
  logger.info("ticket_publish_updated", {
    request_id: req.requestId,
    ticket_id: Number(req.params.id),
    operator_id: req.user.id,
    is_published: Boolean(is_published)
  });
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
  res.status(404).json({ message: "接口不存在，请确认后端已更新并重启" });
});

// SPA fallback - serve index.html for all non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

initDb()
  .then(() => {
    app.listen(port, () => {
      logger.info("server_started", { port });
      console.log(`API server running at http://localhost:${port}`);
      console.log("Seed users: student/123456, admin/123456");
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
