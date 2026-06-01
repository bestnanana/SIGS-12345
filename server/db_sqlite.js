const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function getDb() {
  if (!db) {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'app.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// Async wrappers to match mysql2 API
async function run(sql, params = []) {
  try {
    const result = getDb().prepare(sql).run(...params);
    return { affectedRows: result.changes, insertId: result.lastInsertRowid };
  } catch (e) {
    if (e.message.includes('duplicate column name') || e.message.includes('already exists')) {
      return { affectedRows: 0, insertId: 0 };
    }
    throw e;
  }
}

async function get(sql, params = []) {
  try {
    return getDb().prepare(sql).get(...params) || null;
  } catch {
    return null;
  }
}

async function all(sql, params = []) {
  try {
    return getDb().prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function hasColumn(table, column) {
  const cols = getDb().prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

function safeAddColumn(table, column, definition) {
  if (!hasColumn(table, column)) {
    getDb().prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

const adminDepartments = ['信数中心', '党政办', '学工办', '培养处', '财务办', '人事办'];

async function initDb() {
  const database = getDb();

  // Users
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      department TEXT,
      role TEXT DEFAULT 'user',
      union_id TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  safeAddColumn('users', 'union_id', 'TEXT DEFAULT NULL');

  // Token Persons (SSO 登录用户)
  await run(`
    CREATE TABLE IF NOT EXISTS token_persons (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      name TEXT NOT NULL,
      person_type TEXT,
      department TEXT,
      role TEXT DEFAULT 'user',
      phone TEXT,
      raw_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tickets
  await run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      field TEXT NOT NULL,
      unit_type TEXT,
      department TEXT,
      content TEXT NOT NULL,
      is_anonymous INTEGER DEFAULT 0,
      submitter_id TEXT NOT NULL,
      submitter_union_id TEXT,
      submitter_person_id TEXT,
      submitter_name TEXT,
      status TEXT DEFAULT 'pending',
      current_department TEXT DEFAULT '党政办',
      is_published INTEGER DEFAULT 0,
      published_at DATETIME,
      ai_category TEXT,
      ai_suggestion TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Replies
  await run(`
    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      replier_id TEXT NOT NULL,
      department TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    )
  `);

  // Attachments
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

  // Transfers
  await run(`
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      from_department TEXT NOT NULL,
      to_department TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    )
  `);

  // Notifications
  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ticket_id INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      target_url TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    )
  `);
  safeAddColumn('notifications', 'target_url', "TEXT DEFAULT ''");

  // Satisfaction surveys
  await run(`
    CREATE TABLE IF NOT EXISTS satisfaction_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    )
  `);

  // Seed admin users if empty
  const row = await get('SELECT COUNT(*) as count FROM users');
  if (Number(row.count) === 0) {
    const bcrypt = require('bcryptjs');
    const password = bcrypt.hashSync('123456', 10);
    await run(
      'INSERT INTO users (username, password, name, phone, role) VALUES (?, ?, ?, ?, ?)',
      ['student', password, '张同学', '13800000001', 'user']
    );
    const accounts = [
      ['admin', '党政办管理员', '010-62780000', '党政办公室'],
      ['admin2', '信数中心管理员', '010-62780001', '信息与数据服务中心'],
      ['xszx_admin', '信数中心管理员', '010-62780001', '信息与数据服务中心'],
      ['xgb_admin', '学工办管理员', '010-62780002', '学生工作办公室'],
      ['pyc_admin', '培养处管理员', '010-62780003', '培养处'],
      ['cwb_admin', '财务办管理员', '010-62780004', '财务办公室'],
      ['rsb_admin', '人事办管理员', '010-62780005', '人事办公室']
    ];
    for (const [username, name, phone, department] of accounts) {
      await run(
        'INSERT INTO users (username, password, name, phone, role, department) VALUES (?, ?, ?, ?, ?, ?)',
        [username, password, name, phone, 'admin', department]
      );
    }
  }

  // Migrations
  safeAddColumn('tickets', 'original_department', 'TEXT DEFAULT NULL');
  await run("UPDATE tickets SET original_department = department WHERE original_department IS NULL");
  safeAddColumn('transfers', 'status', "TEXT DEFAULT 'active'");
  safeAddColumn('tickets', 'share_code', 'TEXT DEFAULT NULL');
  safeAddColumn('tickets', 'submitter_union_id', 'TEXT DEFAULT NULL');
  safeAddColumn('tickets', 'submitter_person_id', 'TEXT DEFAULT NULL');
  safeAddColumn('tickets', 'submitter_name', 'TEXT DEFAULT NULL');

  await ensureDatahubPersonTables();
  await ensureFormConfigTables();
  await seedDefaultFormOptions();
  await seedDepartments();
  await ensureDepartmentAdminTables();
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
      raw_json TEXT NOT NULL,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_union_id ON datahub_basic_persons(union_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_department ON datahub_basic_persons(department)`);
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
      UNIQUE (category, label)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_form_options_category ON form_options(category)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_form_options_active ON form_options(category, is_active, sort_order)`);
  await run(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function seedDefaultFormOptions() {
  const count = await get("SELECT COUNT(*) AS count FROM form_options");
  if ((count?.count || 0) > 0) return;
  const seeds = {
    fields: ["教务","人事","学工","科研","后勤","信息化","其他","国际学生学者"],
  };
  for (const [category, labels] of Object.entries(seeds)) {
    for (let i=0;i<labels.length;i++) {
      await run(
        "INSERT INTO form_options (category, label, sort_order, is_active) VALUES (?, ?, ?, 1)",
        [category, labels[i], i]
      );
    }
  }
}

async function seedDepartments() {
  const count = await get("SELECT COUNT(*) AS count FROM departments");
  if ((count?.count || 0) > 0) return;
  const seeds = [
    { type: "职能处室", names: ["党政办公室","党委组织办公室","宣传办公室","教职工工作办公室","学生工作办公室","培养处","科研处","发展规划办公室","全球事务办公室","人事办公室","培训学院","总务办公室","财务办公室","信息与数据服务中心"] },
    { type: "教学科研机构", names: ["生物医药与健康工程研究院","海洋工程研究院","环境与生态研究院","材料研究院","未来人居研究院","数据与信息研究院","创新管理研究院","人文社会科学部","医院管理研究院","国际开放创新教育中心"] },
  ];
  let i = 0;
  for (const { type, names } of seeds) {
    for (const name of names) {
      await run(
        "INSERT INTO departments (name, type, sort_order, is_active) VALUES (?, ?, ?, 1)",
        [name, type, i++]
      );
    }
  }
}

async function listDepartmentsGrouped() {
  const rows = await all(
    "SELECT id, name, type, sort_order FROM departments WHERE is_active = 1 ORDER BY sort_order ASC"
  );
  const groups = {};
  for (const row of rows) {
    if (!groups[row.type]) groups[row.type] = [];
    groups[row.type].push(row);
  }
  return groups;
}

async function listDepartmentsAll(includeInactive = false) {
  const where = includeInactive ? "" : "WHERE is_active = 1";
  return all(
    `SELECT id, name, type, sort_order, is_active FROM departments ${where} ORDER BY sort_order ASC, id ASC`
  );
}

async function createDepartment(name, type, isActive = true) {
  const row = await get("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM departments");
  return run(
    "INSERT INTO departments (name, type, sort_order, is_active) VALUES (?, ?, ?, ?)",
    [name, type, row.next_order, isActive ? 1 : 0]
  );
}

async function updateDepartment(id, fields = {}) {
  const updates = [];
  const params = [];
  if (typeof fields.name === "string") {
    updates.push("name = ?");
    params.push(fields.name.trim());
  }
  if (typeof fields.type === "string" && ["职能处室", "教学科研机构"].includes(fields.type)) {
    updates.push("type = ?");
    params.push(fields.type);
  }
  if (fields.sort_order !== undefined) {
    updates.push("sort_order = ?");
    params.push(Number(fields.sort_order) || 0);
  }
  if (fields.is_active !== undefined) {
    updates.push("is_active = ?");
    params.push(fields.is_active ? 1 : 0);
  }
  if (!updates.length) return { affectedRows: 0 };
  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(id);
  return run(`UPDATE departments SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function deleteDepartment(id) {
  return run("DELETE FROM departments WHERE id = ?", [id]);
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
  return Object.fromEntries([
    ["fields", rows.filter((row) => row.category === "fields" || row.category === "field")],
    ["departments", rows.filter((row) => row.category === "departments" || row.category === "department")]
  ]);
}

async function getFormOptionLabels(category) {
  const rows = await listFormOptions(category, false);
  return rows.map((row) => row.label);
}

async function createFormOption(category, label, isActive = true) {
  const row = await get("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM form_options WHERE category = ?", [category]);
  return run(
    "INSERT INTO form_options (category, label, sort_order, is_active, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    [category, label, row.next_order, isActive ? 1 : 0]
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
  if (fields.category && ["fields","departments"].includes(fields.category)) {
    updates.push("category = ?");
    params.push(fields.category);
  }
  if (!updates.length) return { affectedRows: 0 };
  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(id);
  return run(`UPDATE form_options SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function deleteFormOption(id) {
  return run("DELETE FROM form_options WHERE id = ?", [id]);
}

async function upsertDatahubBasicPersons(rows = []) {
  await ensureDatahubPersonTables();
  const stmt = getDb().prepare(`
    INSERT INTO datahub_basic_persons (
      id, union_id, name, type, category, department, status,
      appoint_attr, appointment_form, hire_post, write_date, raw_json,
      synced_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
      updated_at = CURRENT_TIMESTAMP
  `);

  let upserted = 0;
  for (const row of rows) {
    if (!row.id) continue;
    stmt.run(
      row.id, row.union_id, row.name, row.type, row.category,
      row.department, row.status, row.appoint_attr, row.appointment_form,
      row.hire_post, row.write_date, row.raw_json
    );
    upserted += 1;
  }
  return upserted;
}

async function isValidDepartment(name) {
  const row = await get(
    "SELECT id FROM departments WHERE name = ? AND is_active = 1",
    [name]
  );
  return Boolean(row);
}

async function ensureDepartmentAdminTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS department_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT NOT NULL UNIQUE,
      role_type TEXT NOT NULL DEFAULT 'admin',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      allowed_transfer_targets TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS department_admin_departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      department_name TEXT NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES department_admins(id) ON DELETE CASCADE,
      UNIQUE (admin_id, department_name)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS permission_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id TEXT NOT NULL,
      target_person_id TEXT NOT NULL,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function disableAdminsForInactivePersons() {
  const toDisable = await all(
    `SELECT da.id, da.person_id, p.name, p.status
     FROM department_admins da
     JOIN datahub_basic_persons p ON p.id = da.person_id
     WHERE da.is_enabled = 1 AND p.status = '0'`
  );

  let count = 0;
  for (const admin of toDisable) {
    const managedDepts = await all(
      'SELECT department_name FROM department_admin_departments WHERE admin_id = ?',
      [admin.id]
    );
    const beforeState = { person_id: admin.person_id, is_enabled: 1, managed_departments: managedDepts.map(d => d.department_name) };

    await run('UPDATE department_admins SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);

    const afterState = { ...beforeState, is_enabled: 0 };
    await run(
      `INSERT INTO permission_audit_log (operator_id, target_person_id, action, before_json, after_json)
       VALUES ('system', ?, 'auto_disable', ?, ?)`,
      [admin.person_id, JSON.stringify(beforeState), JSON.stringify(afterState)]
    );

    await run(
      `INSERT INTO notifications (user_id, ticket_id, type, message)
       VALUES (?, NULL, 'admin_disabled', ?)`,
      [admin.person_id, `您的部门管理员权限已被系统自动停用（人员状态变更）。`]
    );

    const superAdmins = await all(
      "SELECT id FROM datahub_basic_persons WHERE role = 'super_admin'"
    );
    for (const sa of superAdmins) {
      await run(
        `INSERT INTO notifications (user_id, ticket_id, type, message)
         VALUES (?, NULL, 'admin_disabled', ?)`,
        [sa.id, `人员【${admin.name}】状态变更为离职，已自动停用其部门管理员权限。`]
      );
    }

    count++;
  }
  return count;
}

module.exports = { initDb, run, get, all, adminDepartments, isValidDepartment, ensureDatahubPersonTables, ensureFormConfigTables, seedDefaultFormOptions, seedDepartments, listDepartmentsGrouped, listDepartmentsAll, createDepartment, updateDepartment, deleteDepartment, listFormOptions, listFormOptionsGrouped, getFormOptionLabels, createFormOption, updateFormOption, deleteFormOption, upsertDatahubBasicPersons, ensureDepartmentAdminTables, disableAdminsForInactivePersons };
