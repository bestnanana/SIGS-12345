const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const bcrypt = require("bcryptjs");
const logger = require("./logger");

const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "app.db");
const lockPath = path.join(dataDir, "app.db.lock");
const backupDir = path.join(dataDir, "backups");
let db;
let lockFd = null;
let lockToken = null;
let bootstrapping = false;
let protectBootWrites = false;
let backedUpBeforeWrite = false;
const adminDepartments = ["信数中心", "党政办", "学工办", "培养处", "财务办", "人事办"];

function normalizeSql(sql) {
  return String(sql || "").trim().replace(/^--.*$/gm, "").trim().toLowerCase();
}

function isWriteSql(sql) {
  const normalized = normalizeSql(sql);
  if (!normalized) return false;
  return /^(insert|update|delete|replace|create|alter|drop|truncate|vacuum|reindex|attach|detach)\b/.test(normalized);
}

function isProcessAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readLockInfo() {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function acquireDbLock() {
  fs.mkdirSync(dataDir, { recursive: true });
  lockToken = `${process.pid}-${Date.now()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockFd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(lockFd, JSON.stringify({
        pid: process.pid,
        token: lockToken,
        started_at: new Date().toISOString(),
        db_path: dbPath
      }, null, 2));
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      const lockInfo = readLockInfo();
      if (lockInfo?.pid && isProcessAlive(Number(lockInfo.pid))) {
        logger.error("db_lock_conflict", {
          lock_path: lockPath,
          owner_pid: lockInfo.pid
        });
        throw new Error(`数据库保护已阻止启动：app.db 正被进程 ${lockInfo.pid} 使用。请先停止旧后端进程，避免覆盖数据库文件。`);
      }

      fs.unlinkSync(lockPath);
    }
  }
}

function releaseDbLock() {
  if (lockFd !== null) {
    try {
      fs.closeSync(lockFd);
    } catch (error) {
      // Ignore close errors during shutdown.
    }
    lockFd = null;
  }

  const lockInfo = readLockInfo();
  if (lockInfo?.token === lockToken) {
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      // Ignore cleanup errors during shutdown.
    }
  }
}

function installLockCleanup() {
  process.once("exit", releaseDbLock);
  ["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
    process.once(signal, () => {
      releaseDbLock();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  });
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupCurrentDb() {
  if (backedUpBeforeWrite || !fs.existsSync(dbPath)) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `app.${timestampForFile()}.before-write.db`);
  fs.copyFileSync(dbPath, backupPath);
  logger.info("db_backup_created", { backup_path: backupPath });
  backedUpBeforeWrite = true;
}

function persist() {
  if (lockFd === null) {
    throw new Error("数据库保护已阻止写入：当前进程没有 app.db 写入锁。");
  }

  const data = Buffer.from(db.export());
  if (fs.existsSync(dbPath)) {
    const current = fs.readFileSync(dbPath);
    if (current.equals(data)) return;
  }

  backupCurrentDb();
  const tmpPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, dbPath);
  logger.info("db_persisted", {
    db_path: dbPath,
    bytes: data.length
  });
}

function normalizeParams(params) {
  if (Array.isArray(params)) return params;
  if (!params || typeof params !== "object") return [];
  return params;
}

function run(sql, params = [], options = {}) {
  if (bootstrapping && protectBootWrites && isWriteSql(sql) && !options.allowBootWrite) {
    throw new Error("数据库保护已阻止启动阶段写库。现有 app.db 不会被服务端初始化、迁移或种子数据覆盖。");
  }

  const stmt = db.prepare(sql);
  stmt.bind(normalizeParams(params));
  while (stmt.step()) {
    // Drain result rows for statements that return data.
  }
  stmt.free();
  const row = db.exec("SELECT last_insert_rowid() AS lastID, changes() AS changes")[0]?.values?.[0] || [0, 0];
  if (options.persist !== false && isWriteSql(sql)) {
    persist();
  }
  return Promise.resolve({ lastID: row[0], changes: row[1] });
}

function get(sql, params = []) {
  const rows = allSync(sql, params);
  return Promise.resolve(rows[0]);
}

function all(sql, params = []) {
  return Promise.resolve(allSync(sql, params));
}

function allSync(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(normalizeParams(params));
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function initDb() {
  acquireDbLock();
  installLockCleanup();
  const existingDb = fs.existsSync(dbPath);
  protectBootWrites = existingDb && process.env.DB_PROTECT_EXISTING_ON_BOOT !== "0";
  bootstrapping = true;

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, "..", "node_modules", "sql.js", "dist", file)
  });
  db = existingDb ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

  await run("PRAGMA foreign_keys = ON", [], { persist: false });

  await ensureTable("users", `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      department TEXT,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable("admins", `
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      level INTEGER NOT NULL DEFAULT 2 CHECK(level IN (0, 1, 2)),
      department TEXT NOT NULL,
      assigned_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (assigned_by) REFERENCES users(id)
    )
  `);

  await ensureTable("tickets", `
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      field TEXT NOT NULL,
      unit_type TEXT,
      department TEXT,
      content TEXT NOT NULL,
      is_anonymous BOOLEAN DEFAULT 0,
      submitter_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      current_department TEXT DEFAULT '党政办',
      is_published BOOLEAN DEFAULT 0,
      published_at DATETIME,
      ai_category TEXT,
      ai_suggestion TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submitter_id) REFERENCES users(id)
    )
  `);

  await ensureTable("replies", `
    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      replier_id INTEGER NOT NULL,
      department TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (replier_id) REFERENCES users(id)
    )
  `);

  await ensureTable("attachments", `
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      reply_id INTEGER,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (reply_id) REFERENCES replies(id)
    )
  `);

  await ensureTable("transfers", `
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      from_department TEXT NOT NULL,
      to_department TEXT NOT NULL,
      operator_id INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (operator_id) REFERENCES users(id)
    )
  `);

  await ensureTable("ratings", `
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ticket_id, user_id, type),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await migrateSchema();

  const userCount = await get("SELECT COUNT(*) AS count FROM users");
  if (userCount.count === 0) {
    if (protectBootWrites) {
      console.warn("数据库保护：现有 app.db 用户表为空，已跳过启动阶段种子用户写入。");
      bootstrapping = false;
      return;
    }
    const password = bcrypt.hashSync("123456", 10);
    await run(
      "INSERT INTO users (username, password, name, phone, role) VALUES (?, ?, ?, ?, ?)",
      ["student", password, "张同学", "13800000001", "user"],
      { allowBootWrite: true }
    );
  }

  if (protectBootWrites) {
    logger.info("db_boot_seed_skipped", { db_path: dbPath });
    console.log("数据库保护：已跳过启动阶段管理员种子数据同步，现有 app.db 不会被覆盖。");
  } else {
    await seedDepartmentAdmins();
  }
  bootstrapping = false;
}

function tableExists(name) {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
  stmt.bind([name]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

async function ensureTable(name, createSql) {
  if (tableExists(name)) return;
  if (protectBootWrites) {
    throw new Error(`数据库保护已阻止创建缺失表 ${name}。请先人工备份并确认迁移方案。`);
  }
  await run(createSql, [], { allowBootWrite: true });
}

async function migrateSchema() {
  if (protectBootWrites) {
    logger.info("db_boot_migration_skipped", { db_path: dbPath });
    console.log("数据库保护：已跳过启动阶段 schema 迁移，现有 app.db 不会被 ALTER/UPDATE 覆盖。");
    return;
  }

  const userColumns = await all("PRAGMA table_info(users)");
  if (!userColumns.some((item) => item.name === "password")) {
    await run("ALTER TABLE users ADD COLUMN password TEXT");
    await run("UPDATE users SET password = ? WHERE password IS NULL OR password = ''", [
      bcrypt.hashSync("123456", 10)
    ]);
  }
  if (!userColumns.some((item) => item.name === "department")) {
    await run("ALTER TABLE users ADD COLUMN department TEXT");
  }

  const adminTable = await get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'admins'");
  if (adminTable?.sql && !adminTable.sql.includes("0, 1, 2") && !adminTable.sql.includes("0,1,2")) {
    await run("ALTER TABLE admins RENAME TO admins_old");
    await run(`
      CREATE TABLE admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        level INTEGER NOT NULL DEFAULT 2 CHECK(level IN (0, 1, 2)),
        department TEXT NOT NULL,
        assigned_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (assigned_by) REFERENCES users(id)
      )
    `);
    await run(`
      INSERT INTO admins (id, user_id, level, department, assigned_by, created_at, updated_at)
      SELECT id, user_id, level, department, assigned_by, created_at, updated_at
      FROM admins_old
    `);
    await run("DROP TABLE admins_old");
  }

  const ticketColumns = await all("PRAGMA table_info(tickets)");
  if (!ticketColumns.some((item) => item.name === "current_department")) {
    await run("ALTER TABLE tickets ADD COLUMN current_department TEXT DEFAULT '党政办'");
  }
  if (!ticketColumns.some((item) => item.name === "is_published")) {
    await run("ALTER TABLE tickets ADD COLUMN is_published BOOLEAN DEFAULT 0");
  }
  if (!ticketColumns.some((item) => item.name === "published_at")) {
    await run("ALTER TABLE tickets ADD COLUMN published_at DATETIME");
  }
  await run("UPDATE tickets SET current_department = COALESCE(NULLIF(current_department, ''), '党政办')");
}

async function seedDepartmentAdmins() {
  const password = bcrypt.hashSync("123456", 10);
  const accounts = [
    ["super_admin", "超级管理员", "010-62789999", "党政办", 0],
    ["admin", "张明", "010-62780000", "党政办", 1],
    ["admin2", "李晨", "010-62780001", "信数中心", 2],
    ["xszx_admin", "周宁", "010-62780001", "信数中心", 2],
    ["xgb_admin", "王芳", "010-62780002", "学工办", 2],
    ["pyc_admin", "陈静", "010-62780003", "培养处", 2],
    ["cwb_admin", "赵磊", "010-62780004", "财务办", 2],
    ["rsb_admin", "刘洋", "010-62780005", "人事办", 2]
  ];

  for (const [username, name, phone, department, level] of accounts) {
    const existing = await get("SELECT id FROM users WHERE username = ?", [username]);
    if (existing) {
      await run("UPDATE users SET name = ?, phone = ? WHERE username = ?", [
        name,
        phone,
        username
      ]);
    } else {
      await run(
        "INSERT INTO users (username, password, name, phone, role, department) VALUES (?, ?, ?, ?, 'admin', ?)",
        [username, password, name, phone, department]
      );
    }

    const user = await get("SELECT id, role FROM users WHERE username = ?", [username]);
    const adminRecord = await get("SELECT id FROM admins WHERE user_id = ?", [user.id]);

    if (username === "super_admin") {
      await run("UPDATE users SET role = 'admin', department = ? WHERE id = ?", [department, user.id]);
    }

    if (adminRecord && username === "super_admin") {
      await run(
        "UPDATE admins SET level = ?, department = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
        [level, department, user.id]
      );
    } else if (!adminRecord && (user.role === "admin" || username === "super_admin")) {
      await run(
        "INSERT INTO admins (user_id, level, department, assigned_by) VALUES (?, ?, ?, ?)",
        [user.id, level, department, null]
      );
    }
  }
}

module.exports = {
  initDb,
  run,
  get,
  all,
  adminDepartments
};
