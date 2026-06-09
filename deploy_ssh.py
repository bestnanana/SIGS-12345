"""Check the remote application's MySQL data path.

This helper intentionally uses the same remote MySQL target as the application.
It must not create, read, or depend on any local SQLite/sql.js database file.
"""

import paramiko
import os
import sys


REMOTE_HOST = os.getenv("DEPLOY_HOST", "219.223.170.20")
REMOTE_USER = os.getenv("DEPLOY_USER", "cy")
REMOTE_APP_DIR = os.getenv("REMOTE_APP_DIR", "/home/cy/campus-12345/current")


def require_env(name):
    value = os.getenv(name)
    if not value:
        print(f"Missing required environment variable: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def check_remote_mysql():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    password = require_env("DEPLOY_PASSWORD")
    client.connect(REMOTE_HOST, username=REMOTE_USER, password=password, timeout=10)

    script = r"""const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '219.223.170.14',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'response_test',
  password: requireEnv('DB_PASSWORD'),
  database: process.env.DB_NAME || 'response_test',
  waitForConnections: true,
  connectionLimit: 2,
  dateStrings: true,
  charset: 'utf8mb4'
});

(async () => {
  const [[db]] = await pool.query('SELECT DATABASE() AS database_name, @@hostname AS mysql_host');
  console.log('=== remote_mysql ===');
  console.log(JSON.stringify(db, null, 2));

  const [assignments] = await pool.query(`
    SELECT da.id, da.person_id, tp.name, tp.union_id, da.role, da.department, da.is_active
    FROM department_admins da
    LEFT JOIN token_persons tp ON tp.id = da.person_id
    ORDER BY da.id DESC
    LIMIT 20
  `);
  console.log('=== recent_department_admins ===');
  console.log(JSON.stringify(assignments, null, 2));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
"""

    command = f"cd {REMOTE_APP_DIR} && cat > /tmp/check_remote_mysql.js << 'SCRIPT_EOF'\n{script}\nSCRIPT_EOF\nnode /tmp/check_remote_mysql.js"
    _, stdout, stderr = client.exec_command(command, timeout=20)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out)
    if err:
        print("ERR:", err)
    client.close()


if __name__ == "__main__":
    check_remote_mysql()
