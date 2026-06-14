const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { contentDispositionFilename, normalizeOriginalFilename } = require("../server/filename-utils");

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

test("deployment helpers do not embed production secrets", () => {
  for (const relativePath of ["deploy_ssh.py", "deploy_frontend_ssh.py"]) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /c@Xx503y/, `${relativePath} must not hard-code the SSH password`);
    assert.doesNotMatch(source, /DEFAULT_PASSWORD\s*=\s*["'][^"']+["']/, `${relativePath} must not define a password fallback`);
    assert.doesNotMatch(source, /REMOTE_PASSWORD\s*=\s*["'][^"']+["']/, `${relativePath} must not define a password fallback`);
  }

  const mysqlCheck = read("deploy_ssh.py");
  assert.doesNotMatch(mysqlCheck, /DB_PASSWORD\s*\|\|/, "remote MySQL checks must not fall back to a real DB password");
  assert.doesNotMatch(mysqlCheck, /Uxhq03H/, "remote MySQL checks must not embed the DB password");
});

test("frontend deployment helper targets the active release symlink", () => {
  const source = read("deploy_frontend_ssh.py");
  assert.match(source, /DEFAULT_REMOTE_DIR\s*=\s*["']\/home\/cy\/campus-12345\/current["']/);
  assert.doesNotMatch(source, /\/opt\/sigs-0531/);
});

test("vite loads frontend environment values from the repository env file", () => {
  const viteConfig = read("vite.config.mjs");
  assert.match(viteConfig, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(viteConfig, /envDir:\s*repoRoot/);
  assert.match(read(".env.example"), /^VITE_INTERNATIONAL_DEPARTMENT_NAME=/m);
});

test("legacy patch artifacts are not tracked as application files", () => {
  assert.equal(fs.existsSync(path.join(root, "server/index.js.patch")), false);
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

test("public copy uses typical matters and my matters naming", () => {
  const i18n = read("client/src/i18n.jsx");

  assert.match(i18n, /"nav\.myTickets":\s*"我的事项"/);
  assert.match(i18n, /"typical\.title":\s*"典型事项"/);
  assert.match(i18n, /"nav\.typical":\s*"Typical Matters"/);
  assert.doesNotMatch(i18n, /"nav\.myTickets":\s*"我发起的"/);
  assert.doesNotMatch(i18n, /典型问题/);
});

test("home page only surfaces typical matters", () => {
  const home = read("client/src/pages/HomePage.jsx");

  assert.match(home, /<TypicalIssuesPanel\s+showHeader=\{false\}/);
  assert.doesNotMatch(home, /api\.get\("\/tickets"/);
  assert.doesNotMatch(home, /home\.myTicketsDesc/);
  assert.doesNotMatch(home, /home\.unresolved/);
});

test("admin ticket details are routed pages with attachment selection summary", () => {
  const admin = read("client/src/pages/AdminPage.jsx");

  assert.match(admin, /navigate\(`\/admin\/tickets\/\$\{ticketRouteId\(ticket\)\}`\)/);
  assert.match(admin, /setFiles\(\(current\) => current\.filter/);
  assert.match(admin, /file\.name/);
  assert.doesNotMatch(admin, /fixed inset-0 z-50/);
});

test("attachment downloads preserve non-ascii filenames", () => {
  const server = read("server/index.js");
  const filenameUtils = read("server/filename-utils.js");

  assert.match(server, /normalizeOriginalFilename\(file\.originalname\)/);
  assert.match(server, /contentDispositionFilename\(attachment\.original_name\)/);
  assert.match(filenameUtils, /filename\*=UTF-8''/);
  assert.doesNotMatch(server, /filename="\$\{encodeURIComponent\(attachment\.original_name\)\}"/);
});

test("attachment original names are normalized before storage and display", () => {
  const mojibake = "âæ ¡å­12345âå¹³å°ç¨æ·æä½æå20251015.pdf";
  const chineseMojibake = Buffer.from("服务器迁移.png", "utf8").toString("latin1");

  assert.equal(
    normalizeOriginalFilename(mojibake),
    "“校园12345”平台用户操作指南20251015.pdf"
  );
  assert.equal(normalizeOriginalFilename(chineseMojibake), "服务器迁移.png");
  assert.equal(normalizeOriginalFilename("Snipaste_2026-06-01_23-03-55.png"), "Snipaste_2026-06-01_23-03-55.png");
  assert.match(contentDispositionFilename(mojibake), /filename\*=UTF-8''/);
});

test("leader approvals use isolated tables instead of changing public ticket status", () => {
  const db = read("server/db_mysql.js");
  const server = read("server/index.js");

  assert.match(db, /CREATE TABLE IF NOT EXISTS department_leaders/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS ticket_approvals/);
  assert.match(db, /UNIQUE KEY uniq_department_leaders_person_department/);
  assert.doesNotMatch(db, /ALTER TABLE tickets ADD COLUMN approval_status/);
  assert.match(server, /app\.post\("\/api\/admin\/tickets\/:id\/approval-requests"/);
  assert.match(server, /app\.post\("\/api\/leader\/approvals\/:id\/decision"/);
});

test("leader approval stays internal and ordinary ticket responses do not expose it", () => {
  const server = read("server/index.js");
  const admin = read("client/src/pages/AdminPage.jsx");
  const detail = read("client/src/pages/TicketDetailPage.jsx");

  assert.match(server, /includeInternalApprovals:\s*true/);
  assert.match(server, /delete\s+publicDetails\.approvals/);
  assert.match(server, /delete\s+publicDetails\.approval_status/);
  assert.doesNotMatch(detail, /approval_status|approvals|领导审批|leaderApproval/);
  assert.match(admin, /approval_status|approvals|leaderApproval/);
});

test("leaders can approve but cannot submit department handling replies", () => {
  const server = read("server/index.js");
  const app = read("client/src/App.jsx");
  const layout = read("client/src/components/Layout.jsx");

  assert.match(server, /permission\s*=\s*['"]approve['"]|permission\s*===\s*['"]approve['"]/);
  assert.match(server, /hasPendingApprovalForTicket\(ticketId\)/);
  assert.match(server, /审批中的事项需等待领导审批完成后再提交处理结果/);
  assert.match(app, /is_department_leader/);
  assert.match(layout, /is_department_leader/);
});

test("department admin access depends on active assignment rows", () => {
  const server = read("server/index.js");
  const app = read("client/src/App.jsx");
  const layout = read("client/src/components/Layout.jsx");

  assert.match(server, /const GLOBAL_ADMIN_ROLES = new Set\(\["super_admin", "liaison"\]\)/);
  assert.match(server, /function publicRoleForUser\(user\)/);
  assert.match(server, /UPDATE department_assignments SET is_enabled = \?, updated_at = CURRENT_TIMESTAMP WHERE person_id = \?/);
  assert.match(server, /syncLegacyAdminRoleAfterAssignmentChange\(current\.person_id\)/);
  assert.doesNotMatch(server, /\["admin", "super_admin", "liaison"\]\.includes\(user\?\.role\)/);
  assert.doesNotMatch(app, /role === "admin"/);
  assert.doesNotMatch(layout, /role === "admin"/);
});

test("department permission creation searches personnel before choosing departments", () => {
  const manager = read("client/src/components/PermissionManager.jsx");
  const i18n = read("client/src/i18n.jsx");

  assert.match(manager, /admin\.stepSearchPerson/);
  assert.match(manager, /admin\.stepChooseDepartmentsAfterPerson/);
  assert.match(manager, /deleteMode === "selected"/);
  assert.match(manager, /api\.delete\(`\/admin\/department-admins\/\$\{deleteTarget\.id\}`/);
  assert.doesNotMatch(manager, /department_names:\s*form\.managed_departments\.join/);
  assert.doesNotMatch(manager, /disabled=\{form\.managed_departments\.length === 0\}/);
  assert.match(i18n, /"admin\.deleteSelectedDepartments"/);
});

test("authorization person eligibility excludes students and invalid statuses", () => {
  const server = read("server/index.js");

  assert.match(server, /COALESCE\(p\.type, ''\) <> '学生'/);
  assert.match(server, /LOWER\(TRIM\(COALESCE\(p\.status, ''\)\)\) NOT IN \('departure', 'false'\)/);
  assert.match(server, /COALESCE\(type, ''\) <> '学生'/);
  assert.match(server, /LOWER\(TRIM\(COALESCE\(status, ''\)\)\) NOT IN \('departure', 'false'\)/);
  assert.doesNotMatch(server, /type IN \('院外人员', '教职员', 'faculty'\)/);
  assert.doesNotMatch(server, /p\.status = 'true'/);
  assert.doesNotMatch(server, /status = 'on_the_job'/);
});

test("authorization search surfaces people with existing permissions", () => {
  const server = read("server/index.js");
  const manager = read("client/src/components/PermissionManager.jsx");
  const i18n = read("client/src/i18n.jsx");

  assert.doesNotMatch(server, /NOT IN \(SELECT DISTINCT person_id FROM department_assignments\)/);
  assert.match(server, /GROUP_CONCAT\(DISTINCT da\.department_name/);
  assert.match(server, /existing_assignment_id/);
  assert.match(server, /has_department_admin_assignment/);
  assert.match(manager, /has_department_admin_assignment/);
  assert.match(manager, /admin\.existingPermission/);
  assert.match(manager, /openEdit\(\{/);
  assert.match(i18n, /"admin\.existingPermission"/);
});
