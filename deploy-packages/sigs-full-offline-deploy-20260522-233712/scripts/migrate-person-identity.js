require("dotenv").config();
process.env.DB_PROTECT_EXISTING_ON_BOOT = "0";

const fs = require("fs");
const path = require("path");
const { initDb, all, get, run, ensureDatahubPersonTables } = require("../server/db");

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function tableExists(name) {
  const row = await get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);
  return Boolean(row);
}

async function columnNames(table) {
  return (await all(`PRAGMA table_info(${quoteIdent(table)})`)).map((item) => item.name);
}

async function copyTableWithUserMap(table, columnMap, idMap) {
  if (!(await tableExists(table))) return;
  const columns = await columnNames(table);
  const temp = `${table}_person_migration_${Date.now()}`;
  await run(`ALTER TABLE ${quoteIdent(table)} RENAME TO ${quoteIdent(temp)}`);

  const createSql = {
    tickets: `
      CREATE TABLE tickets (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    replies: `
      CREATE TABLE replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        replier_id TEXT NOT NULL,
        department TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    transfers: `
      CREATE TABLE transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        from_department TEXT NOT NULL,
        to_department TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    ratings: `
      CREATE TABLE ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ticket_id, user_id, type)
      )
    `
  }[table];
  await run(createSql);

  const oldRows = await all(`SELECT * FROM ${quoteIdent(temp)}`);
  for (const row of oldRows) {
    const next = {};
    for (const column of columns) {
      if (columnMap[column]) {
        next[column] = idMap.get(String(row[column])) || row[column];
      } else {
        next[column] = row[column];
      }
    }
    const insertColumns = Object.keys(next);
    const placeholders = insertColumns.map(() => "?").join(", ");
    await run(
      `INSERT INTO ${quoteIdent(table)} (${insertColumns.map(quoteIdent).join(", ")}) VALUES (${placeholders})`,
      insertColumns.map((column) => next[column])
    );
  }
  await run(`DROP TABLE ${quoteIdent(temp)}`);
}

async function main() {
  await initDb();
  await ensureDatahubPersonTables();

  const idMap = new Map();
  if (await tableExists("users")) {
    const users = await all("SELECT * FROM users");
    const adminIds = new Set();
    if (await tableExists("admins")) {
      for (const item of await all("SELECT user_id FROM admins")) adminIds.add(Number(item.user_id));
    }

    for (const user of users) {
      const personId = user.username ? `local_${user.username}` : `legacy_user_${user.id}`;
      idMap.set(String(user.id), personId);
      await run(
        `INSERT INTO datahub_basic_persons (id, union_id, username, password_hash, name, phone, department, role, raw_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           union_id = COALESCE(datahub_basic_persons.union_id, excluded.union_id),
           username = excluded.username,
           password_hash = excluded.password_hash,
           name = excluded.name,
           phone = excluded.phone,
           department = excluded.department,
           role = excluded.role,
           updated_at = CURRENT_TIMESTAMP`,
        [
          personId,
          user.username || personId,
          user.username || personId,
          user.password,
          user.name || user.username || personId,
          user.phone || "",
          user.department || "",
          user.role === "admin" || adminIds.has(Number(user.id)) ? "admin" : "user",
          JSON.stringify({ migrated_from_users_id: user.id })
        ]
      );
    }
  }

  await copyTableWithUserMap("tickets", { submitter_id: true }, idMap);
  await copyTableWithUserMap("replies", { replier_id: true }, idMap);
  await copyTableWithUserMap("transfers", { operator_id: true }, idMap);
  await copyTableWithUserMap("ratings", { user_id: true }, idMap);

  for (const table of ["admins", "reply_approval_attachments", "reply_approvals", "users"]) {
    if (await tableExists(table)) await run(`DROP TABLE ${quoteIdent(table)}`);
  }

  const dbPath = path.join(process.cwd(), "server", "data", "app.db");
  console.log(JSON.stringify({
    ok: true,
    migrated_users: idMap.size,
    persons: (await get("SELECT COUNT(*) AS count FROM datahub_basic_persons")).count,
    db_size: fs.statSync(dbPath).size
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
