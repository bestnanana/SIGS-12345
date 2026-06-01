require("dotenv").config();
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "server", "data", "app.db");
const BACKUP_PATH = path.join(__dirname, "..", "server", "data", `app.db.bak-${Date.now()}`);

function getDb() {
  return new Database(DB_PATH);
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function get(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

async function migrate() {
  console.log("=== 校园12345系统授权体系迁移 ===\n");

  // 备份数据库
  console.log("1. 备份数据库...");
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log(`   备份完成: ${BACKUP_PATH}\n`);

  const db = getDb();

  try {
    // 开始事务
    db.exec("BEGIN TRANSACTION");

    // Step 1: 获取现有数据
    console.log("2. 读取现有数据...");
    const adminUsers = all(db, "SELECT * FROM admin_users");
    const tokenPersons = all(db, "SELECT * FROM token_persons");
    const deptAdmins = all(db, "SELECT * FROM department_admins");
    const deptAdminDepts = all(db, "SELECT * FROM department_admin_departments");
    const persons = all(db, "SELECT * FROM datahub_basic_persons");
    
    console.log(`   admin_users: ${adminUsers.length} 条`);
    console.log(`   token_persons: ${tokenPersons.length} 条`);
    console.log(`   department_admins: ${deptAdmins.length} 条`);
    console.log(`   department_admin_departments: ${deptAdminDepts.length} 条`);
    console.log(`   datahub_basic_persons: ${persons.length} 条\n`);

    // Step 2: 创建 RBAC 表
    console.log("3. 创建 RBAC 权限表...");
    
    run(db, `
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    run(db, `
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        module TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    run(db, `
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL,
        permission_id INTEGER NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      )
    `);
    console.log("   roles, permissions, role_permissions 表已创建\n");

    // Step 3: 初始化角色和权限数据
    console.log("4. 初始化角色和权限...");

    // 插入角色
    const insertRole = db.prepare("INSERT OR IGNORE INTO roles (code, name, is_system) VALUES (?, ?, ?)");
    insertRole.run("super_admin", "超级管理员", 1);
    insertRole.run("dept_admin", "部门管理员", 1);
    insertRole.run("liaison", "联络员", 1);
    insertRole.run("user", "普通用户", 1);

    // 插入权限
    const insertPerm = db.prepare("INSERT OR IGNORE INTO permissions (code, name, module) VALUES (?, ?, ?)");
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
    const insertRolePerm = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
    const allPerms = all(db, "SELECT id, code FROM permissions");
    const permMap = {};
    for (const p of allPerms) permMap[p.code] = p.id;

    const superAdminRole = get(db, "SELECT id FROM roles WHERE code = 'super_admin'");
    const deptAdminRole = get(db, "SELECT id FROM roles WHERE code = 'dept_admin'");
    const liaisonRole = get(db, "SELECT id FROM roles WHERE code = 'liaison'");
    const userRole = get(db, "SELECT id FROM roles WHERE code = 'user'");

    // super_admin: 所有权限
    for (const p of allPerms) {
      insertRolePerm.run(superAdminRole.id, p.id);
    }

    // dept_admin: 工单相关权限
    for (const code of ["ticket.view", "ticket.reply", "ticket.transfer", "ticket.manage", "admin.view_analytics"]) {
      insertRolePerm.run(deptAdminRole.id, permMap[code]);
    }

    // liaison: 查看和回复
    for (const code of ["ticket.view", "ticket.reply"]) {
      insertRolePerm.run(liaisonRole.id, permMap[code]);
    }

    // user: 创建和查看自己的
    for (const code of ["ticket.create", "ticket.view_own"]) {
      insertRolePerm.run(userRole.id, permMap[code]);
    }

    console.log("   角色: super_admin, dept_admin, liaison, user");
    console.log(`   权限: ${permissions.length} 项`);
    console.log("   角色-权限关联已建立\n");

    // Step 4: 改造 datahub_basic_persons
    console.log("5. 改造 datahub_basic_persons 表...");
    
    // 添加新字段
    const safeAddColumn = (table, col, type) => {
      try { run(db, `ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch {}
    };
    
    safeAddColumn("datahub_basic_persons", "auth_source", "TEXT DEFAULT 'sync'");
    safeAddColumn("datahub_basic_persons", "is_active", "INTEGER DEFAULT 1");
    safeAddColumn("datahub_basic_persons", "role_id", "INTEGER");

    // 创建索引
    run(db, "CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_role_id ON datahub_basic_persons(role_id)");
    run(db, "CREATE INDEX IF NOT EXISTS idx_datahub_basic_persons_is_active ON datahub_basic_persons(is_active)");

    // 迁移 role 字段到 role_id
    console.log("   迁移 role -> role_id...");
    const roleMapping = {
      "super_admin": superAdminRole.id,
      "admin": deptAdminRole.id,
      "liaison": liaisonRole.id,
      "user": userRole.id
    };
    
    for (const [oldRole, newRoleId] of Object.entries(roleMapping)) {
      run(db, "UPDATE datahub_basic_persons SET role_id = ? WHERE role = ?", [newRoleId, oldRole]);
    }
    // 默认设置为 user 角色
    run(db, "UPDATE datahub_basic_persons SET role_id = ? WHERE role_id IS NULL", [userRole.id]);

    // 设置 is_active (status = 'true' 的为启用)
    run(db, "UPDATE datahub_basic_persons SET is_active = 1 WHERE status = 'true'");
    run(db, "UPDATE datahub_basic_persons SET is_active = 0 WHERE status = 'false' OR status IS NULL");

    console.log("   auth_source/is_active/role_id 字段已添加并迁移\n");

    // Step 5: 合并 admin_users 到 datahub_basic_persons
    console.log("6. 合并 admin_users 数据...");
    let mergedAdmins = 0;
    for (const admin of adminUsers) {
      const existing = get(db, "SELECT id FROM datahub_basic_persons WHERE union_id = ?", [admin.union_id]);
      if (existing) {
        // 已存在，更新角色
        const roleId = admin.role === "super_admin" ? superAdminRole.id : deptAdminRole.id;
        run(db, "UPDATE datahub_basic_persons SET role_id = ?, auth_source = 'local', is_active = 1 WHERE union_id = ?", 
          [roleId, admin.union_id]);
      } else {
        // 不存在，插入新记录
        run(db, `INSERT INTO datahub_basic_persons (id, union_id, name, department, role_id, auth_source, is_active, raw_json)
                 VALUES (?, ?, ?, ?, ?, 'local', 1, '{}')`,
          [admin.union_id, admin.union_id, admin.name, admin.department, deptAdminRole.id]);
      }
      mergedAdmins++;
    }
    console.log(`   合并 ${mergedAdmins} 条 admin_users 记录\n`);

    // Step 6: 合并 token_persons 到 datahub_basic_persons
    console.log("7. 合并 token_persons 数据...");
    let mergedTokens = 0;
    for (const tp of tokenPersons) {
      const existing = get(db, "SELECT id FROM datahub_basic_persons WHERE union_id = ? OR id = ?", [tp.uid, tp.id]);
      if (existing) {
        run(db, "UPDATE datahub_basic_persons SET auth_source = 'sso' WHERE id = ?", [existing.id]);
      } else {
        run(db, `INSERT INTO datahub_basic_persons (id, union_id, name, department, role_id, auth_source, is_active, phone, raw_json)
                 VALUES (?, ?, ?, ?, ?, 'sso', 1, ?, ?)`,
          [tp.id, tp.uid, tp.name, tp.department, userRole.id, tp.phone || null, tp.raw_json || '{}']);
      }
      mergedTokens++;
    }
    console.log(`   合并 ${mergedTokens} 条 token_persons 记录\n`);

    // Step 7: 创建 department_assignments 表
    console.log("8. 创建 department_assignments 表...");
    run(db, `
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
        FOREIGN KEY (department_name) REFERENCES departments(name),
        UNIQUE(person_id, department_name)
      )
    `);
    run(db, "CREATE INDEX IF NOT EXISTS idx_dept_assignments_person ON department_assignments(person_id)");
    run(db, "CREATE INDEX IF NOT EXISTS idx_dept_assignments_dept ON department_assignments(department_name)");

    // 迁移 department_admins 数据
    console.log("   迁移 department_admins...");
    let migratedDepts = 0;
    for (const da of deptAdmins) {
      const relatedDepts = deptAdminDepts.filter(d => d.admin_id === da.id);
      for (const dd of relatedDepts) {
        try {
          run(db, `INSERT OR IGNORE INTO department_assignments (person_id, department_name, role_type, can_transfer_to, is_enabled)
                   VALUES (?, ?, 'manager', ?, ?)`,
            [da.person_id, dd.department_name, da.allowed_transfer_targets || '[]', da.is_enabled]);
          migratedDepts++;
        } catch (e) {
          console.log(`   跳过 ${da.person_id} -> ${dd.department_name}: ${e.message}`);
        }
      }
    }
    console.log(`   迁移 ${migratedDepts} 条部门管理员记录\n`);

    // Step 8: 改造 tickets 和 transfers 表
    console.log("9. 改造 tickets/transfers 表...");
    safeAddColumn("tickets", "current_handler_id", "TEXT");
    safeAddColumn("transfers", "from_handler_id", "TEXT");
    safeAddColumn("transfers", "to_handler_id", "TEXT");
    console.log("   已添加 current_handler_id, from_handler_id, to_handler_id\n");

    // Step 9: 删除冗余表
    console.log("10. 删除冗余表...");
    // 先删除外键依赖
    run(db, "DROP TABLE IF EXISTS admin_users");
    run(db, "DROP TABLE IF EXISTS token_persons");
    run(db, "DROP TABLE IF EXISTS department_admin_departments");
    run(db, "DROP TABLE IF EXISTS department_admins");
    console.log("   已删除: admin_users, token_persons, department_admins, department_admin_departments\n");

    // 提交事务
    db.exec("COMMIT");
    console.log("=== 迁移完成 ===\n");

    // 输出统计
    const finalStats = {
      persons: get(db, "SELECT COUNT(*) as count FROM datahub_basic_persons").count,
      roles: get(db, "SELECT COUNT(*) as count FROM roles").count,
      permissions: get(db, "SELECT COUNT(*) as count FROM permissions").count,
      rolePermissions: get(db, "SELECT COUNT(*) as count FROM role_permissions").count,
      assignments: get(db, "SELECT COUNT(*) as count FROM department_assignments").count,
    };
    console.log("最终统计:");
    console.log(`  datahub_basic_persons: ${finalStats.persons}`);
    console.log(`  roles: ${finalStats.roles}`);
    console.log(`  permissions: ${finalStats.permissions}`);
    console.log(`  role_permissions: ${finalStats.rolePermissions}`);
    console.log(`  department_assignments: ${finalStats.assignments}`);

  } catch (error) {
    db.exec("ROLLBACK");
    console.error("迁移失败，已回滚:", error);
    throw error;
  } finally {
    db.close();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
