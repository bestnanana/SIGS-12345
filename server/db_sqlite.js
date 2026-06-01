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

async function initDb() {
  const database = getDb();

  // Users (本地登录凭证表)
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      union_id TEXT DEFAULT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (union_id) REFERENCES datahub_basic_persons(union_id)
    )
  `);
  // 兼容旧表结构：添加新字段
  safeAddColumn('users', 'password_hash', 'TEXT');
  safeAddColumn('users', 'is_active', 'INTEGER DEFAULT 1');
  safeAddColumn('users', 'must_change_password', 'INTEGER DEFAULT 0');
  // 迁移旧数据：将 password 字段数据复制到 password_hash（仅当 password_hash 为空时）
  await run(`UPDATE users SET password_hash = password WHERE password_hash IS NULL AND password IS NOT NULL`).catch(() => {});
  // 删除旧字段（SQLite 不支持 DROP COLUMN，保留兼容）

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
      submitter_phone TEXT,
      submitter_role TEXT,
      submitter_department TEXT,
      status TEXT DEFAULT 'pending',
      current_department TEXT DEFAULT '党政办',
      current_handler_id TEXT,
      original_department TEXT DEFAULT NULL,
      share_code TEXT DEFAULT NULL,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      from_handler_id TEXT,
      to_handler_id TEXT,
      note TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Satisfaction surveys
  await run(`
    CREATE TABLE IF NOT EXISTS satisfaction_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ratings
  await run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ticket_id, user_id, type)
    )
  `);

  // 初始化 RBAC 表
  await ensureRbacTables();
  
  // 初始化人员表
  await ensureDatahubPersonTables();
  
  // 初始化部门管理员表
  await ensureDepartmentAssignmentTables();
  
  // 初始化配置表
  await ensureFormConfigTables();
  
  // 种子数据
  await seedRolesAndPermissions();
  await seedSuperadmin();
  await seedDefaultFormOptions();
  await seedDepartments();
}

// ==================== RBAC 权限体系 ====================

async function ensureRbacTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      module TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
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

async function seedRolesAndPermissions() {
  const roleCount = await get("SELECT COUNT(*) as count FROM roles");
  if (roleCount.count > 0) return;

  // 插入角色
  const insertRole = getDb().prepare("INSERT INTO roles (code, name, is_system) VALUES (?, ?, ?)");
  insertRole.run("super_admin", "超级管理员", 1);
  insertRole.run("dept_admin", "部门管理员", 1);
  insertRole.run("liaison", "联络员", 1);
  insertRole.run("user", "普通用户", 1);

  // 插入权限
  const insertPerm = getDb().prepare("INSERT INTO permissions (code, name, module) VALUES (?, ?, ?)");
  const permissions = [
    ["ticket.create", "创建工单", "ticket"],
    ["ticket.view", "查看工单", "ticket"],
    ["ticket.view_own", "查看自己的工单", "ticket"],
    ["ticket.reply", "回复工单", "ticket"],
    ["ticket.transfer", "转办工单", "ticket"],
    ["ticket.manage", "管理工单", "ticket"],
    ["ticket.publish", "发布工单", "ticket"],
    ["ticket.delete", "删除工单", "ticket"],
    ["admin.config", "系统配置", "admin"],
    ["admin.user_manage", "用户管理", "admin"],
    ["admin.view_analytics", "查看统计", "admin"],
  ];
  for (const [code, name, module] of permissions) {
    insertPerm.run(code, name, module);
  }

  // 角色-权限关联
  const insertRolePerm = getDb().prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
  const allPerms = await all("SELECT id, code FROM permissions");
  const permMap = {};
  for (const p of allPerms) permMap[p.code] = p.id;

  const roles = await all("SELECT id, code FROM roles");
  const roleMap = {};
  for (const r of roles) roleMap[r.code] = r.id;

  // super_admin: 所有权限
  for (const p of allPerms) {
    insertRolePerm.run(roleMap.super_admin, p.id);
  }

  // dept_admin: 工单相关权限
  for (const code of ["ticket.view", "ticket.reply", "ticket.transfer", "ticket.manage", "admin.view_analytics"]) {
    insertRolePerm.run(roleMap.dept_admin, permMap[code]);
  }

  // liaison: 查看和回复
  for (const code of ["ticket.view", "ticket.reply"]) {
    insertRolePerm.run(roleMap.liaison, permMap[code]);
  }

  // user: 创建和查看自己的
  for (const code of ["ticket.create", "ticket.view_own"]) {
    insertRolePerm.run(roleMap.user, permMap[code]);
  }
}

async function seedSuperadmin() {
  const bcrypt = require('bcryptjs');

  // 1. 先确保 super_admin 角色存在（解决 roles 表未初始化的问题）
  let superAdminRole = await getRoleByCode('super_admin');
  if (!superAdminRole) {
    await run(
      "INSERT INTO roles (code, name, is_system) VALUES (?, ?, ?)",
      ['super_admin', '超级管理员', 1]
    );
    superAdminRole = await getRoleByCode('super_admin');
    if (!superAdminRole) return;
  }

  // 2. 确保 datahub_basic_persons 中有 superadmin 记录
  const existingPerson = await get("SELECT id FROM datahub_basic_persons WHERE union_id = 'local_superadmin'");
  if (!existingPerson) {
    await run(
      `INSERT INTO datahub_basic_persons (id, union_id, name, type, department, role, role_id, auth_source, is_active, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'local', 1, '{}')`,
      ['local_superadmin', 'local_superadmin', '超级管理员', '教职员', '党政办公室', 'super_admin', superAdminRole.id]
    );
  }

  // 3. 检查 users 表是否已有 superadmin
  const existingUser = await get("SELECT id, union_id, password, password_hash, is_active FROM users WHERE username = 'superadmin'");

  if (existingUser) {
    // 3.1 修复缺失的 union_id
    if (!existingUser.union_id) {
      await run("UPDATE users SET union_id = 'local_superadmin' WHERE id = ?", [existingUser.id]);
    }

    // 3.2 修复密码字段（关键！旧表可能只有 password 没有 password_hash）
    if (!existingUser.password_hash) {
      let newHash;
      if (existingUser.password) {
        // 旧字段有密码，先判断是否是 bcrypt 格式（$2a$ 或 $2b$ 开头）
        if (existingUser.password.startsWith('$2')) {
          newHash = existingUser.password;
        } else {
          newHash = bcrypt.hashSync(existingUser.password, 10);
        }
      } else {
        const defaultPwd = process.env.SUPERADMIN_DEFAULT_PASSWORD || 'superadmin123';
        newHash = bcrypt.hashSync(defaultPwd, 10);
        console.warn('[seedSuperadmin] superadmin 密码已重置为默认值，请登录后尽快修改');
      }
      await run("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?", [newHash, existingUser.id]);
    }

    // 3.3 确保账号启用
    if (!existingUser.is_active) {
      await run("UPDATE users SET is_active = 1 WHERE id = ?", [existingUser.id]);
    }

    return;
  }

  // 4. 全新安装：创建 superadmin
  const defaultPwd = process.env.SUPERADMIN_DEFAULT_PASSWORD || 'superadmin123';
  const passwordHash = bcrypt.hashSync(defaultPwd, 10);
  await run(
    "INSERT INTO users (username, password_hash, union_id, is_active, must_change_password) VALUES (?, ?, ?, 1, 1)",
    ['superadmin', passwordHash, 'local_superadmin']
  );
  console.log('[seedSuperadmin] 已创建默认 superadmin 账号（首次登录需修改密码）');
}

// ==================== 人员数据表 ====================

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
      person_id TEXT,
      username TEXT UNIQUE,
      password TEXT,
      password_hash TEXT,
      phone TEXT,
      role TEXT DEFAULT 'user',
      role_id INTEGER,
      auth_source TEXT DEFAULT 'sync',
      is_active INTEGER DEFAULT 1,
      can_manage_roles INTEGER DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '{}',
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (role_id) REFERENCES roles(id)
    )
  `);

  // 添加新字段（如果不存在）
  safeAddColumn('datahub_basic_persons', 'person_id', 'TEXT');
  safeAddColumn('datahub_basic_persons', 'role_id', 'INTEGER');
  safeAddColumn('datahub_basic_persons', 'auth_source', "TEXT DEFAULT 'sync'");
  safeAddColumn('datahub_basic_persons', 'is_active', 'INTEGER DEFAULT 1');

  // 创建索引
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_union_id ON datahub_basic_persons(union_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_department ON datahub_basic_persons(department)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_person_id ON datahub_basic_persons(person_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_role_id ON datahub_basic_persons(role_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_is_active ON datahub_basic_persons(is_active)`);

  // 同步记录表
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

// ==================== 部门管理员配置表 ====================

async function ensureDepartmentAssignmentTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS department_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT NOT NULL,
      department_name TEXT NOT NULL,
      role_type TEXT NOT NULL DEFAULT 'processor',
      can_transfer_to TEXT DEFAULT '[]',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (person_id) REFERENCES datahub_basic_persons(id),
      UNIQUE(person_id, department_name)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_dept_assignments_person ON department_assignments(person_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_dept_assignments_dept ON department_assignments(department_name)`);
}

// ==================== 表单配置表 ====================

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

// ==================== 种子数据 ====================

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

// ==================== RBAC 查询函数 ====================

async function getRoleByCode(code) {
  return get("SELECT * FROM roles WHERE code = ?", [code]);
}

async function getRoleById(id) {
  return get("SELECT * FROM roles WHERE id = ?", [id]);
}

async function getPermissionsByRoleId(roleId) {
  return all(
    `SELECT p.* FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     WHERE rp.role_id = ?`,
    [roleId]
  );
}

async function getPersonPermissions(personId) {
  const person = await get("SELECT role_id FROM datahub_basic_persons WHERE id = ?", [personId]);
  if (!person || !person.role_id) return [];
  return getPermissionsByRoleId(person.role_id);
}

async function hasPermission(personId, permissionCode) {
  const perms = await getPersonPermissions(personId);
  return perms.some(p => p.code === permissionCode);
}

// ==================== 部门管理员函数 ====================

async function getDepartmentAssignments(personId) {
  return all(
    "SELECT * FROM department_assignments WHERE person_id = ? AND is_enabled = 1",
    [personId]
  );
}

async function isDepartmentAdmin(personId, departmentName) {
  const assignment = await get(
    "SELECT id FROM department_assignments WHERE person_id = ? AND department_name = ? AND is_enabled = 1",
    [personId, departmentName]
  );
  return Boolean(assignment);
}

async function getTransferTargets(personId, departmentName) {
  const assignment = await get(
    "SELECT can_transfer_to FROM department_assignments WHERE person_id = ? AND department_name = ? AND is_enabled = 1",
    [personId, departmentName]
  );
  if (!assignment || !assignment.can_transfer_to) return [];
  try {
    return JSON.parse(assignment.can_transfer_to);
  } catch {
    return [];
  }
}

// ==================== 人员数据同步 ====================

async function upsertDatahubBasicPersons(rows = []) {
  await ensureDatahubPersonTables();
  
  // 获取默认用户角色
  const userRole = await getRoleByCode('user');
  const defaultRoleId = userRole ? userRole.id : null;
  
  const stmt = getDb().prepare(`
    INSERT INTO datahub_basic_persons (
      id, union_id, name, type, category, department, status,
      appoint_attr, appointment_form, hire_post, write_date, person_id, raw_json,
      role_id, auth_source, is_active, synced_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sync', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
      person_id = excluded.person_id,
      raw_json = excluded.raw_json,
      is_active = excluded.is_active,
      role_id = COALESCE(datahub_basic_persons.role_id, excluded.role_id),
      synced_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `);

  let upserted = 0;
  for (const row of rows) {
    if (!row.id) continue;
    
    // 跳过本地账号（auth_source='local'），避免同步覆盖
    const existing = await get("SELECT auth_source FROM datahub_basic_persons WHERE id = ?", [row.id]);
    if (existing && existing.auth_source === 'local') continue;
    
    // 判断是否活跃：status 为 true 或 on_the_job 视为活跃，其余（departure/retire/die/false/0）视为非活跃
    const activeStatuses = new Set(['true', 'on_the_job', '在校', '在职']);
    const inactiveStatuses = new Set(['false', '0', 'departure', 'retire', 'die', 'abandon_employee', '离职', '退休']);
    let isActive = 1; // 默认活跃
    if (row.status) {
      if (activeStatuses.has(row.status)) {
        isActive = 1;
      } else if (inactiveStatuses.has(row.status)) {
        isActive = 0;
      }
      // 未知状态保持默认 active=1
    }
    stmt.run(
      row.id, row.union_id, row.name, row.type, row.category,
      row.department, row.status, row.appoint_attr, row.appointment_form,
      row.hire_post, row.write_date, row.person_id, row.raw_json,
      defaultRoleId, isActive
    );
    upserted += 1;
  }
  return upserted;
}

// ==================== 部门相关函数 ====================

async function isValidDepartment(name) {
  const row = await get(
    "SELECT id FROM departments WHERE name = ? AND is_active = 1",
    [name]
  );
  return Boolean(row);
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

// ==================== 表单选项函数 ====================

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

// ==================== 离职人员处理 ====================

async function disableAdminsForInactivePersons() {
  // 找出状态为离职的人员中，有部门管理员权限的
  const toDisable = await all(
    `SELECT da.id, da.person_id, p.name, p.status
     FROM department_assignments da
     JOIN datahub_basic_persons p ON p.id = da.person_id
     WHERE da.is_enabled = 1 AND (p.status = '0' OR p.is_active = 0)`
  );

  let count = 0;
  for (const admin of toDisable) {
    const beforeState = { person_id: admin.person_id, is_enabled: 1 };
    
    await run('UPDATE department_assignments SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);

    const afterState = { person_id: admin.person_id, is_enabled: 0 };
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

    count++;
  }

  // 通知超级管理员
  if (count > 0) {
    const superAdmins = await all(
      `SELECT p.id FROM datahub_basic_persons p 
       JOIN roles r ON r.id = p.role_id 
       WHERE r.code = 'super_admin' AND p.is_active = 1`
    );
    for (const sa of superAdmins) {
      await run(
        `INSERT INTO notifications (user_id, ticket_id, type, message)
         VALUES (?, NULL, 'admin_disabled', ?)`,
        [sa.id, `系统自动停用了 ${count} 名离职人员的部门管理员权限。`]
      );
    }
  }

  return count;
}

// ==================== 导出 ====================

module.exports = {
  // 基础函数
  getDb,
  run,
  get,
  all,
  hasColumn,
  safeAddColumn,
  initDb,
  
  // RBAC
  ensureRbacTables,
  seedRolesAndPermissions,
  getRoleByCode,
  getRoleById,
  getPermissionsByRoleId,
  getPersonPermissions,
  hasPermission,
  
  // 人员
  ensureDatahubPersonTables,
  upsertDatahubBasicPersons,
  
  // 部门管理员
  ensureDepartmentAssignmentTables,
  getDepartmentAssignments,
  isDepartmentAdmin,
  getTransferTargets,
  
  // 部门
  isValidDepartment,
  listDepartmentsGrouped,
  listDepartmentsAll,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  
  // 表单
  ensureFormConfigTables,
  seedDefaultFormOptions,
  seedDepartments,
  listFormOptions,
  listFormOptionsGrouped,
  getFormOptionLabels,
  createFormOption,
  updateFormOption,
  deleteFormOption,
  
  // 离职处理
  disableAdminsForInactivePersons
};
