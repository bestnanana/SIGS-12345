const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const secretEnvNames = new Set([
  "JWT_SECRET",
  "SSO_CLIENT_SECRET",
  "SSO_STATE_SECRET",
  "DATAHUB_API_KEY",
  "DB_PASSWORD",
  "PORTAL_TODO_API_KEY"
]);

const placeholderValues = new Set([
  "",
  "change-this",
  "change-this-to-random-string",
  "please-change-me",
  "please-change-me-to-a-random-string",
  "your-client-secret",
  "your-datahub-api-key",
  "your-db-password",
  "your-jwt-secret",
  "your-portal-todo-api-key",
  "your-sso-state-secret"
]);

test("tracked source does not provide secret fallbacks", () => {
  for (const relativePath of ["server/db_mysql.js", "server/portal-todo.js"]) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /process\.env\.(DB_PASSWORD|DATAHUB_API_KEY|PORTAL_TODO_API_KEY|SSO_CLIENT_SECRET)\s*\|\|/,
      `${relativePath} must require secrets from the environment`
    );
  }
});

test("tracked environment templates contain placeholders for secrets", () => {
  for (const relativePath of [".env.example", "scripts/package-linux.sh", "scripts/package-offline.sh"]) {
    const source = read(relativePath);
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=([^\r\n]*)$/);
      if (!match || !secretEnvNames.has(match[1])) continue;
      assert(
        placeholderValues.has(match[2]),
        `${relativePath} must use a placeholder for ${match[1]}`
      );
    }
  }
});

test("attachments are served only through authenticated download routes", () => {
  const server = read("server/index.js");
  const ticketDetail = read("client/src/pages/TicketDetailPage.jsx");
  const adminPage = read("client/src/pages/AdminPage.jsx");

  assert.doesNotMatch(server, /app\.use\("\/uploads",\s*express\.static/);
  assert.doesNotMatch(server, /pathname\.startsWith\("\/uploads\/"\)/);
  assert.doesNotMatch(server, /req\.query\?\.token/);
  assert.doesNotMatch(ticketDetail, /item\.file_path/);
  assert.doesNotMatch(adminPage, /\?token=/);
});

test("MySQL code paths do not use SQLite-only insert syntax", () => {
  for (const relativePath of ["server/index.js", "scripts/migrate-db.sql"]) {
    assert.doesNotMatch(read(relativePath), /INSERT OR IGNORE/i, relativePath);
  }
});

test("local account creation writes required users columns", () => {
  const server = read("server/index.js");
  assert.match(
    server,
    /INSERT INTO users \(username, password, password_hash, name, union_id, is_active\)/,
    "local accounts must satisfy the users table NOT NULL columns"
  );
});

test("ticket creation resolves submitter datahub rows by id before union id", () => {
  const server = read("server/index.js");
  assert.doesNotMatch(
    server,
    /SELECT union_id FROM users WHERE id = \? UNION SELECT id FROM datahub_basic_persons WHERE id = \?/,
    "datahub person id must not be returned as a union_id"
  );
  assert.match(
    server,
    /FROM datahub_basic_persons\s+WHERE id = \? OR union_id = \?/,
    "SSO users should resolve directly from datahub_basic_persons by id"
  );
});

test("expired auth state redirects instead of leaving the SPA loading", () => {
  const app = read("client/src/App.jsx");
  assert.match(
    app,
    /function redirectToSso\(\)/,
    "App should centralize SSO redirect handling"
  );
  assert.match(
    app,
    /handleAuthExpired[\s\S]*redirectToSso\(\)/,
    "401 auth-expired events should redirect non-login pages"
  );
  assert.match(
    app,
    /\.catch\(\(\) => \{[\s\S]*redirectToSso\(\)/,
    "failed /auth/me checks should redirect non-login pages"
  );
  assert.doesNotMatch(
    app,
    /Should have been redirected to SSO by now; show loading/,
    "unauthenticated non-login pages must not rely on a stale loading screen"
  );
});

test("deployment packages exclude local database state and include client build output", () => {
  for (const relativePath of ["scripts/package-linux.sh", "scripts/package-offline.sh"]) {
    const source = read(relativePath);
    assert.match(source, /client\/dist/, `${relativePath} must copy client/dist`);
    assert.match(source, /server\/data/, `${relativePath} must remove copied database state`);
  }
});
