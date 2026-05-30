const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (url) {
      pool = mysql.createPool(url);
    } else {
      pool = mysql.createPool({
        host: process.env.DB_HOST || '219.223.170.14',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'response_test',
        password: process.env.DB_PASSWORD || 'Uxhq03H??P]axvWFx_}3',
        database: process.env.DB_NAME || 'response_test',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        dateStrings: true,
        charset: 'utf8mb4'
      });
    }
  }
  return pool;
}

async function run(sql, params = []) {
  const [res] = await getPool().execute(sql, params);
  return { affectedRows: res.affectedRows, insertId: res.insertId };
}

async function get(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows[0];
}

async function all(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

const adminDepartments = ['信数中心', '党政办', '学工办', '培养处', '财务办', '人事办'];

async function initDb() {
  // Ensure database exists
  const dbName = process.env.DB_NAME || 'response_test';
  const conn = await getPool().getConnection();
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS `' + dbName + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await conn.query('USE `' + dbName + '`');
  } finally {
    conn.release();
  }

  // Users
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(191) NOT NULL UNIQUE,
      password VARCHAR(191) NOT NULL,
      name VARCHAR(191) NOT NULL,
      phone VARCHAR(32),
      department VARCHAR(64),
      role VARCHAR(32) DEFAULT 'user',
      union_id VARCHAR(191) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  try { await run("ALTER TABLE users ADD COLUMN union_id VARCHAR(191) DEFAULT NULL"); } catch {}

  // Tickets
  await run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(191) NOT NULL,
      field VARCHAR(191) NOT NULL,
      unit_type VARCHAR(64),
      department VARCHAR(64),
      content TEXT NOT NULL,
      is_anonymous TINYINT(1) DEFAULT 0,
      submitter_id BIGINT NOT NULL,
      status VARCHAR(32) DEFAULT 'pending',
      current_department VARCHAR(64) DEFAULT '党政办',
      is_published TINYINT(1) DEFAULT 0,
      published_at TIMESTAMP NULL,
      ai_category VARCHAR(191),
      ai_suggestion TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (submitter_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Replies
  await run(`
    CREATE TABLE IF NOT EXISTS replies (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT NOT NULL,
      content TEXT NOT NULL,
      replier_id BIGINT NOT NULL,
      department VARCHAR(64) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (replier_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Attachments
  await run(`
    CREATE TABLE IF NOT EXISTS attachments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT,
      reply_id BIGINT,
      filename VARCHAR(191) NOT NULL,
      original_name VARCHAR(191) NOT NULL,
      file_path VARCHAR(255) NOT NULL,
      file_size BIGINT NOT NULL,
      file_type VARCHAR(128) NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (reply_id) REFERENCES replies(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Transfers
  await run(`
    CREATE TABLE IF NOT EXISTS transfers (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT NOT NULL,
      from_department VARCHAR(64) NOT NULL,
      to_department VARCHAR(64) NOT NULL,
      operator_id BIGINT NOT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (operator_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Notifications
  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      ticket_id BIGINT NOT NULL,
      type VARCHAR(64) NOT NULL,
      message VARCHAR(512) NOT NULL,
      target_url VARCHAR(512) DEFAULT '',
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Migration: add target_url column if missing (for existing databases)
  try {
    await run("ALTER TABLE notifications ADD COLUMN target_url VARCHAR(512) DEFAULT '' AFTER message");
  } catch (_) { /* column already exists */ }

  // Satisfaction surveys
  await run(`
    CREATE TABLE IF NOT EXISTS satisfaction_surveys (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      score INT NOT NULL,
      comment TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_satisfaction_ticket (ticket_id),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
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

  // Migration: tickets.add original_department, transfers.add status
  try { await run("ALTER TABLE tickets ADD COLUMN original_department VARCHAR(64) DEFAULT NULL"); } catch {}
  try { await run("UPDATE tickets SET original_department = department WHERE original_department IS NULL"); } catch {}
  try { await run("ALTER TABLE transfers ADD COLUMN status VARCHAR(32) DEFAULT 'active'"); } catch {}
  try { await run("ALTER TABLE tickets ADD COLUMN share_code VARCHAR(64) DEFAULT NULL"); } catch {}

  await ensureDatahubPersonTables();
  await ensureFormConfigTables();
  await seedDefaultFormOptions();
  await seedDepartments();
  await ensureDepartmentAdminTables();

  // Migration: notifications.ticket_id nullable (for system notifications without a ticket)
  try { await run("ALTER TABLE notifications MODIFY ticket_id BIGINT NULL"); } catch {}
}


async function ensureDatahubPersonTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS datahub_basic_persons (
      id VARCHAR(191) PRIMARY KEY,
      union_id VARCHAR(191),
      name VARCHAR(191),
      type VARCHAR(64),
      category VARCHAR(64),
      department VARCHAR(64),
      status VARCHAR(64),
      appoint_attr VARCHAR(64),
      appointment_form VARCHAR(64),
      hire_post VARCHAR(64),
      write_date VARCHAR(32),
      username VARCHAR(191) UNIQUE,
      password VARCHAR(191),
      password_hash VARCHAR(191),
      phone VARCHAR(32),
      role VARCHAR(32) DEFAULT 'user',
      can_manage_roles TINYINT(1) DEFAULT 0,
      raw_json TEXT NOT NULL,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_union_id ON datahub_basic_persons(union_id)`).catch(() => {});
  await run(`CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_department ON datahub_basic_persons(department)`).catch(() => {});
  await run(`
    CREATE TABLE IF NOT EXISTS datahub_basic_person_sync_runs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL,
      start_date VARCHAR(32) NOT NULL,
      page_size INT NOT NULL,
      fetched_count INT DEFAULT 0,
      upserted_count INT DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'running',
      error_message TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureFormConfigTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS form_options (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(64) NOT NULL,
      label VARCHAR(191) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_category_label (category, label)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_form_options_category ON form_options(category)`).catch(() => {});
  await run(`CREATE INDEX IF NOT EXISTS idx_form_options_active ON form_options(category, is_active, sort_order)`).catch(() => {});
  await run(`
    CREATE TABLE IF NOT EXISTS departments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL UNIQUE,
      type VARCHAR(64) NOT NULL COMMENT '职能处室 or 教学科研机构',
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
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
       ON DUPLICATE KEY UPDATE
         union_id = VALUES(union_id),
         name = VALUES(name),
         type = VALUES(type),
         category = VALUES(category),
         department = VALUES(department),
         status = VALUES(status),
         appoint_attr = VALUES(appoint_attr),
         appointment_form = VALUES(appointment_form),
         hire_post = VALUES(hire_post),
         write_date = VALUES(write_date),
         raw_json = VALUES(raw_json),
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
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      person_id VARCHAR(191) NOT NULL,
      role_type VARCHAR(32) NOT NULL DEFAULT 'admin',
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      allowed_transfer_targets TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_dept_admin_person (person_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS department_admin_departments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_id BIGINT NOT NULL,
      department_name VARCHAR(191) NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES department_admins(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_admin_dept (admin_id, department_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS permission_audit_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      operator_id VARCHAR(191) NOT NULL,
      target_person_id VARCHAR(191) NOT NULL,
      action VARCHAR(64) NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
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

    // 通知被禁用者
    await run(
      `INSERT INTO notifications (user_id, ticket_id, type, message)
       VALUES (?, NULL, 'admin_disabled', ?)`,
      [admin.person_id, `您的部门管理员权限已被系统自动停用（人员状态变更）。`]
    );

    // 通知超级管理员
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
