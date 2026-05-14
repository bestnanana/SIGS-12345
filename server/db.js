const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "data", "app.db");
let db;
const adminDepartments = ["信数中心", "党政办", "学工办", "培养处", "财务办", "人事办"];

function persist() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function normalizeParams(params) {
  if (Array.isArray(params)) return params;
  if (!params || typeof params !== "object") return [];
  return params;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(normalizeParams(params));
  while (stmt.step()) {
    // Drain result rows for statements that return data.
  }
  stmt.free();
  const row = db.exec("SELECT last_insert_rowid() AS lastID, changes() AS changes")[0]?.values?.[0] || [0, 0];
  persist();
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
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, "..", "node_modules", "sql.js", "dist", file)
  });
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();

  await run("PRAGMA foreign_keys = ON");

  await run(`
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

  await run(`
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

  await run(`
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

  await run(`
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

  await run(`
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

  await run(`
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

  await run(`
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
    const password = bcrypt.hashSync("123456", 10);
    await run(
      "INSERT INTO users (username, password, name, phone, role) VALUES (?, ?, ?, ?, ?)",
      ["student", password, "张同学", "13800000001", "user"]
    );
  }

  await seedDepartmentAdmins();
}

async function migrateSchema() {
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
