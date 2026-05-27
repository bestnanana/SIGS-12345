const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const bcrypt = require("bcryptjs");
const logger = require("./logger");

const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "app.db");
const lockPath = path.join(dataDir, "app.db.lock");
const backupDir = path.join(dataDir, "backups");
const adminDepartments = ["信息中心", "党政办", "学工办", "培养处", "财务办", "人事办"];

let db;
let lockFd = null;
let lockToken = null;
let persistTimer = null;
let lastBackupTime = 0;
const persistDebounceMs = 2000;
const backupIntervalMs = 60 * 60 * 1000;
const defaultFormOptionSeeds = {
  fields: ["\u6559\u52a1", "\u4eba\u4e8b", "\u5b66\u5de5", "\u79d1\u7814", "\u540e\u52e4", "\u4fe1\u606f\u5316", "\u5176\u4ed6", "\u56fd\u9645\u5b66\u751f\u5b66\u8005"],
  departments: ["\u4fe1\u6570\u4e2d\u5fc3", "\u515a\u653f\u529e", "\u5b66\u5de5\u529e", "\u57f9\u517b\u5904", "\u8d22\u52a1\u529e", "\u4eba\u4e8b\u529e"]
};

function normalizeSql(sql) {
  return String(sql || "").trim().replace(/^--.*$/gm, "").trim().toLowerCase();
}

function isWriteSql(sql) {
  return /^(insert|update|delete|replace|create|alter|drop|truncate|vacuum|reindex|attach|detach)\b/.test(normalizeSql(sql));
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
        throw new Error(`数据库正在被进程 ${lockInfo.pid} 使用，请先停止旧后端进程。`);
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
  process.once("exit", () => {
    flushPersist();
    releaseDbLock();
  });
  ["SIGINT", "SIGTERM", "SIGHUP"].forEach((signal) => {
    process.once(signal, () => {
      flushPersist();
      releaseDbLock();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  });
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupCurrentDb() {
  if (!fs.existsSync(dbPath)) return;
  const now = Date.now();
  if (now - lastBackupTime < backupIntervalMs) return;
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `app.${timestampForFile()}.db`);
  fs.copyFileSync(dbPath, backupPath);
  lastBackupTime = now;
  logger.info("db_backup_created", { backup_path: backupPath });
}

function persist() {
  if (lockFd === null) throw new Error("当前进程没有数据库写入锁。");
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersist();
  }, persistDebounceMs);
}

function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
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
}

function normalizeParams(params) {
  if (Array.isArray(params)) return params;
  if (!params || typeof params !== "object") return [];
  return params;
}

function run(sql, params = [], options = {}) {
  const stmt = db.prepare(sql);
  stmt.bind(normalizeParams(params));
  while (stmt.step()) {
    // Drain rows for statements that return rows.
  }
  stmt.free();
  const row = db.exec("SELECT last_insert_rowid() AS lastID, changes() AS changes")[0]?.values?.[0] || [0, 0];
  if (options.persist !== false && isWriteSql(sql)) persist();
  return Promise.resolve({ lastID: row[0], changes: row[1] });
}

function allSync(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(normalizeParams(params));
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return Promise.resolve(allSync(sql, params)[0]);
}

function all(sql, params = []) {
  return Promise.resolve(allSync(sql, params));
}

async function initDb() {
  acquireDbLock();
  installLockCleanup();
  const existingDb = fs.existsSync(dbPath);
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, "..", "node_modules", "sql.js", "dist", file)
  });
  db = existingDb ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

  await run("PRAGMA foreign_keys = ON", [], { persist: false });
  await ensureSchema();
  await seedDefaultFormOptions();
  await seedDefaultPeople();
}

async function ensureSchema() {
  await ensureDatahubPersonTables();
  await ensureAdminUserTables();
  await ensureFormConfigTables();
  await run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      field TEXT NOT NULL,
      unit_type TEXT,
      department TEXT,
      content TEXT NOT NULL,
      is_anonymous BOOLEAN DEFAULT 0,
      submitter_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      current_department TEXT DEFAULT '党政办',
      is_published BOOLEAN DEFAULT 0,
      published_at DATETIME,
      ai_category TEXT,
      ai_suggestion TEXT,
      share_code TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      replier_id TEXT NOT NULL REFERENCES datahub_basic_persons(id),
      department TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      reply_id INTEGER REFERENCES replies(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      from_department TEXT NOT NULL,
      to_department TEXT NOT NULL,
      operator_id TEXT NOT NULL REFERENCES datahub_basic_persons(id),
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES datahub_basic_persons(id),
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ticket_id, user_id, type)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS satisfaction_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES datahub_basic_persons(id),
      score INTEGER NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const satisfactionColumns = await all("PRAGMA table_info(satisfaction_surveys)");
  const hasSatisfactionColumn = (name) => satisfactionColumns.some((item) => item.name === name);
  if (!hasSatisfactionColumn("comment")) await run("ALTER TABLE satisfaction_surveys ADD COLUMN comment TEXT");
  if (!hasSatisfactionColumn("updated_at")) await run("ALTER TABLE satisfaction_surveys ADD COLUMN updated_at DATETIME");

  const ticketColumns = await all("PRAGMA table_info(tickets)");
  if (!ticketColumns.some((item) => item.name === "share_code")) {
    await run("ALTER TABLE tickets ADD COLUMN share_code TEXT");
    await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_share_code ON tickets(share_code)");
  }

  await normalizeTicketStatuses();
}

async function normalizeTicketStatuses() {
  await run(`
    UPDATE tickets
    SET status = 'pending'
    WHERE status IS NULL
       OR status = ''
       OR status NOT IN ('pending', 'completed')
  `);
}

async function ensureDatahubPersonTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS datahub_basic_persons (
      id TEXT PRIMARY KEY,
      union_id TEXT,
      name TEXT,
      type TEXT,
      category TEXT,
      department TEXT,
      status TEXT,
      appoint_attr TEXT,
      appointment_form TEXT,
      hire_post TEXT,
      write_date TEXT,
      username TEXT UNIQUE,
      password TEXT,
      password_hash TEXT,
      phone TEXT,
      role TEXT DEFAULT 'user',
      can_manage_roles INTEGER DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const columns = await all("PRAGMA table_info(datahub_basic_persons)");
  const hasColumn = (name) => columns.some((item) => item.name === name);
  if (!hasColumn("username")) await run("ALTER TABLE datahub_basic_persons ADD COLUMN username TEXT");
  if (!hasColumn("password")) await run("ALTER TABLE datahub_basic_persons ADD COLUMN password TEXT");
  if (!hasColumn("password_hash")) await run("ALTER TABLE datahub_basic_persons ADD COLUMN password_hash TEXT");
  if (!hasColumn("phone")) await run("ALTER TABLE datahub_basic_persons ADD COLUMN phone TEXT");
  if (!hasColumn("role")) await run("ALTER TABLE datahub_basic_persons ADD COLUMN role TEXT DEFAULT 'user'");
  if (!hasColumn("can_manage_roles")) await run("ALTER TABLE datahub_basic_persons ADD COLUMN can_manage_roles INTEGER DEFAULT 0");
  await run("UPDATE datahub_basic_persons SET password_hash = password WHERE (password_hash IS NULL OR password_hash = '') AND password IS NOT NULL AND password != ''");
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_datahub_basic_persons_username ON datahub_basic_persons(username)");
  await run("CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_union_id ON datahub_basic_persons(union_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_department ON datahub_basic_persons(department)");
  await run("CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_write_date ON datahub_basic_persons(write_date)");

  await run(`
    CREATE TABLE IF NOT EXISTS datahub_basic_person_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      start_date TEXT NOT NULL,
      page_size INTEGER NOT NULL,
      fetched_count INTEGER DEFAULT 0,
      upserted_count INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      error_message TEXT
    )
  `);
}

async function ensureAdminUserTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      union_id TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      department TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureFormConfigTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS form_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, label)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_form_options_category ON form_options(category)");
  await run("CREATE INDEX IF NOT EXISTS idx_form_options_active ON form_options(category, is_active, sort_order)");
}

async function seedDefaultFormOptions() {
  const count = await get("SELECT COUNT(*) AS count FROM form_options");
  if ((count?.count || 0) > 0) return;
  for (const [category, labels] of Object.entries(defaultFormOptionSeeds)) {
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      await run(
        `INSERT INTO form_options (category, label, sort_order, is_active)
         VALUES (?, ?, ?, 1)`,
        [category, label, index]
      );
    }
  }
}

async function seedDefaultPeople() {
  // Seed student user (SSO only, no local password)
  const studentExisting = await get("SELECT id FROM datahub_basic_persons WHERE username = ?", ["student"]);
  if (!studentExisting) {
    await run(
      `INSERT INTO datahub_basic_persons (id, union_id, username, name, phone, department, role, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["local_student", "student", "student", "学生用户", "13800000001", null, "user", "{}"]
    );
  }

  // Seed admin users into admin_users table
  const adminAccounts = [
    ["super_admin", "super_admin", "超级管理员", "super_admin", "党政办"],
    ["admin", "admin", "张明", "admin", "党政办"],
    ["admin2", "admin2", "李晨", "admin", "信息中心"],
    ["admin3", "admin3", "管理员", "admin", "党政办"],
    ["xszx_admin", "xszx_admin", "周宁", "admin", "信息中心"],
    ["xgb_admin", "xgb_admin", "王芳", "admin", "学工办"],
    ["pyc_admin", "pyc_admin", "陈静", "admin", "培养处"],
    ["cwb_admin", "cwb_admin", "赵磊", "admin", "财务办"],
    ["rsb_admin", "rsb_admin", "刘洋", "admin", "人事办"],
    ["xxzx_liaison", "xxzx_liaison", "信息中心联络员", "liaison", "信息中心"],
    ["dzb_liaison", "dzb_liaison", "党政办联络员", "liaison", "党政办"],
    ["xgb_liaison", "xgb_liaison", "学工办联络员", "liaison", "学工办"],
    ["pyc_liaison", "pyc_liaison", "培养处联络员", "liaison", "培养处"],
    ["cwb_liaison", "cwb_liaison", "财务办联络员", "liaison", "财务办"],
    ["rsb_liaison", "rsb_liaison", "人事办联络员", "liaison", "人事办"]
  ];

  // Specific admin accounts with fixed password (union_id matches Datahub)
  const fixedAccounts = [
    ["B19712", "陈杨", "admin", "信息与数据服务中心"],
    ["S07704", "吴志勇", "admin", "数据与信息研究院"],
    ["X23009", "黄思强", "admin", "党政办"],
    ["zhaozhuqing", "赵竹青", "admin", "党政办"]
  ];
  const fixedHash = await bcrypt.hash("123456", 10);
  for (const [unionId, name, role, department] of fixedAccounts) {
    await run(
      `INSERT INTO admin_users (union_id, password_hash, name, role, department)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(union_id) DO UPDATE SET
         password_hash = excluded.password_hash,
         name = excluded.name,
         role = excluded.role,
         department = excluded.department,
         updated_at = CURRENT_TIMESTAMP`,
      [unionId, fixedHash, name, role, department]
    );
    // Update the real Datahub person record with admin role
    await run(
      "UPDATE datahub_basic_persons SET role = ?, department = ?, updated_at = CURRENT_TIMESTAMP WHERE union_id = ?",
      [role, department, unionId]
    );
  }
  console.log("--- 指定管理员账号 ---");
  fixedAccounts.forEach(([unionId, name]) => console.log(`  ${unionId} / 123456  (${name})`));

  const seededUsers = [];
  for (const [unionId, , name, role, department] of adminAccounts) {
    const existing = await get("SELECT id FROM admin_users WHERE union_id = ?", [unionId]);
    if (existing) {
      // Ensure datahub_basic_persons record exists for SSO login
      await run(
        `INSERT INTO datahub_basic_persons (id, union_id, username, name, department, role, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           union_id = excluded.union_id,
           name = excluded.name,
           department = excluded.department,
           role = excluded.role,
           updated_at = CURRENT_TIMESTAMP`,
        [`local_${unionId}`, unionId, unionId, name, department, role, "{}"]
      );
      seededUsers.push({ username: unionId, name, password: "(已设置)", role, department });
      continue;
    }

    const rawPassword = crypto.randomBytes(6).toString("base64url").slice(0, 8);
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    await run(
      `INSERT INTO admin_users (union_id, password_hash, name, role, department)
       VALUES (?, ?, ?, ?, ?)`,
      [unionId, passwordHash, name, role, department]
    );
    // Also ensure datahub_basic_persons record for SSO login and frontend user info
    await run(
      `INSERT INTO datahub_basic_persons (id, union_id, username, name, department, role, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         union_id = excluded.union_id,
         name = excluded.name,
         department = excluded.department,
         role = excluded.role,
         updated_at = CURRENT_TIMESTAMP`,
      [`local_${unionId}`, unionId, unionId, name, department, role, "{}"]
    );
    seededUsers.push({ username: unionId, name, password: rawPassword, role, department });
  }

  if (seededUsers.some((u) => u.password !== "(已设置)")) {
    logger.info("seed_admin_accounts_created", { accounts: seededUsers.map((u) => ({ username: u.username, role: u.role, department: u.department })) });
    console.log("--- 预置后台管理账号密码（请妥善保存） ---");
    seededUsers.forEach((u) => {
      console.log(`  ${u.username} / ${u.password}  (${u.name}, ${u.role}, ${u.department})`);
    });
    console.log("------------------------------------------");
  }
}

async function listFormOptions(category = null, includeInactive = false) {
  const params = [];
  const clauses = [];
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }
  if (!includeInactive) clauses.push("is_active = 1");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return all(
    `SELECT id, category, label, sort_order, is_active, created_at, updated_at
     FROM form_options
     ${where}
     ORDER BY category ASC, sort_order ASC, id ASC`,
    params
  );
}

async function listFormOptionsGrouped(includeInactive = false) {
  const rows = await listFormOptions(null, includeInactive);
  return Object.fromEntries(
    [
      ["fields", rows.filter((row) => row.category === "fields" || row.category === "field")],
      ["departments", rows.filter((row) => row.category === "departments" || row.category === "department")]
    ]
  );
}

async function getFormOptionLabels(category) {
  const rows = await listFormOptions(category, false);
  return rows.map((row) => row.label);
}

async function createFormOption(category, label, sortOrder = 0, isActive = true) {
  return run(
    `INSERT INTO form_options (category, label, sort_order, is_active, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [category, label, Number(sortOrder) || 0, isActive ? 1 : 0]
  );
}

async function updateFormOption(id, fields = {}) {
  const updates = [];
  const params = [];
  if (typeof fields.label === "string") {
    updates.push("label = ?");
    params.push(fields.label);
  }
  if (fields.sort_order !== undefined) {
    updates.push("sort_order = ?");
    params.push(Number(fields.sort_order) || 0);
  }
  if (fields.is_active !== undefined) {
    updates.push("is_active = ?");
    params.push(fields.is_active ? 1 : 0);
  }
  if (fields.category && Object.keys(defaultFormOptionSeeds).includes(fields.category)) {
    updates.push("category = ?");
    params.push(fields.category);
  }
  if (!updates.length) return { changes: 0 };
  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(id);
  return run(`UPDATE form_options SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function deleteFormOption(id) {
  return run("DELETE FROM form_options WHERE id = ?", [id]);
}

async function upsertDatahubBasicPersons(rows = []) {
  await ensureDatahubPersonTables();
  let upserted = 0;
  for (const row of rows) {
    if (!row.id) continue;
    await run(
      `INSERT INTO datahub_basic_persons (
         id, union_id, name, type, category, department, status,
         appoint_attr, appointment_form, hire_post, write_date, raw_json,
         synced_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         union_id = excluded.union_id,
         name = excluded.name,
         type = excluded.type,
         category = excluded.category,
         department = excluded.department,
         status = excluded.status,
         appoint_attr = excluded.appoint_attr,
         appointment_form = excluded.appointment_form,
         hire_post = excluded.hire_post,
         write_date = excluded.write_date,
         raw_json = excluded.raw_json,
         role = COALESCE(datahub_basic_persons.role, 'user'),
         synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [
        row.id,
        row.union_id,
        row.name,
        row.type,
        row.category,
        row.department,
        row.status,
        row.appoint_attr,
        row.appointment_form,
        row.hire_post,
        row.write_date,
        row.raw_json
      ]
    );
    upserted += 1;
  }
  return upserted;
}

module.exports = {
  initDb,
  run,
  get,
  all,
  adminDepartments,
  ensureDatahubPersonTables,
  upsertDatahubBasicPersons,
  ensureFormConfigTables,
  seedDefaultFormOptions,
  listFormOptions,
  listFormOptionsGrouped,
  getFormOptionLabels,
  createFormOption,
  updateFormOption,
  deleteFormOption,
  flushPersist
};
