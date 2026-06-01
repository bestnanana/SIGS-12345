/**
 * 从远端 MySQL 复制数据到本地 SQLite
 * Usage: node scripts/migrate-mysql-to-sqlite.js
 */
const mysql = require('mysql2/promise');
const Database = require('better-sqlite3');
const path = require('path');

const TABLES = [
  'users',
  'tickets',
  'replies',
  'attachments',
  'transfers',
  'notifications',
  'satisfaction_surveys',
  'datahub_basic_persons',
  'datahub_basic_person_sync_runs',
  'form_options',
  'departments',
  'department_admins',
  'department_admin_departments',
  'permission_audit_log',
];

async function main() {
  // 连接 MySQL
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '219.223.170.14',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'response_test',
    password: process.env.DB_PASSWORD || 'Uxhq03H??P]axvWFx_}3',
    database: process.env.DB_NAME || 'response_test',
    dateStrings: true,
  });

  // 连接 SQLite
  const sqliteDb = new Database(path.join(__dirname, '..', 'server', 'data', 'app.db'));
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = OFF'); // 导入时关闭外键检查

  let totalRows = 0;

  for (const table of TABLES) {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows (skip)`);
      continue;
    }

    // 获取列名
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const colNames = columns.map(c => `\`${c}\``).join(', ');
    const stmt = sqliteDb.prepare(`INSERT OR REPLACE INTO ${table} (${colNames}) VALUES (${placeholders})`);

    const insertMany = sqliteDb.transaction((rows) => {
      for (const row of rows) {
        const values = columns.map(c => {
          const v = row[c];
          // SQLite 不需要特殊处理，undefined 会被转为 null
          return v === undefined ? null : v;
        });
        stmt.run(...values);
      }
    });

    insertMany(rows);
    console.log(`  ${table}: ${rows.length} rows`);
    totalRows += rows.length;
  }

  // 重置自增序列（仅对 INTEGER PRIMARY KEY AUTOINCREMENT 的表）
  const seqTables = ['users', 'tickets', 'replies', 'attachments', 'transfers',
    'notifications', 'satisfaction_surveys', 'datahub_basic_person_sync_runs',
    'form_options', 'departments', 'department_admins', 'department_admin_departments',
    'permission_audit_log'];

  for (const table of seqTables) {
    try {
      const maxId = sqliteDb.prepare(`SELECT MAX(id) as maxId FROM ${table}`).get();
      if (maxId && maxId.maxId != null) {
        sqliteDb.prepare(
          `INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)`
        ).run(table, maxId.maxId);
      }
    } catch { /* table might not have autoincrement */ }
  }

  sqliteDb.pragma('foreign_keys = ON');
  await pool.end();
  console.log(`\nDone. Total: ${totalRows} rows migrated.`);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
