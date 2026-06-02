const PORTAL_TODO_URL = 'https://api-test.sigs.tsinghua.edu.cn:6690/v1/sync/portal_todo_list';
const PORTAL_TODO_HEADERS = {
  'Authorization-Type': 'Apikey',
  'Authorization': process.env.PORTAL_TODO_API_KEY || 'xppae4Tcr7YFI1h2UG4rHQ5ooX0dzuzs',
  'ServiceId': process.env.PORTAL_TODO_SERVICE_ID || 'QX1oRe',
  'Accept': 'application/vnd.api+json',
  'Content-Type': 'application/json'
};
const PORTAL_TODO_KIND_ID = 'jsjb';
const PORTAL_TODO_PREFIX = '028d0a7edb_';
const PORTAL_PERSON_PREFIX = 'syncperson_';
const SITE_BASE_URL = (process.env.SITE_BASE_URL || 'http://219.223.170.20').replace(/\/$/, '');

// 黑名单：这些 union_id 的人不会收到统一待办推送
// 院领导及院长助理
const PORTAL_TODO_BLACKLIST = new Set([
  '1996990202',   // 刘惠琴
  '2017990001',   // 欧阳证
  '1995990283',   // 左剑恶
  'S09708',       // 关添
  'F2016002',     // 刘碧录
  'S10703',       // 李欢
  '2010990159',   // 付昊桓
  'S21712',       // 胡振中
  'S12707',       // 吴乾元
  'B15703',       // 宋岩
]);

// 延迟引入数据库模块，避免循环依赖
let dbModule = null;
function getDb() {
  if (!dbModule) {
    dbModule = require('./db_mysql');
  }
  return dbModule;
}

// 检查人员是否在白名单中（通过 person_id 查询 union_id）
async function getPersonUnionId(personId) {
  try {
    const db = getDb();
    const person = await db.get("SELECT union_id FROM datahub_basic_persons WHERE id = ?", [personId]);
    return person?.union_id || null;
  } catch {
    return null;
  }
}

async function isPersonAllowed(personId) {
  const unionId = await getPersonUnionId(personId);
  if (!unionId) return false;
  return PORTAL_TODO_WHITELIST.has(unionId);
}

function buildSiteUrl(path) {
  return `${SITE_BASE_URL}${path}`;
}

function buildTodoId(ticketId, role, personId) {
  return `${PORTAL_TODO_PREFIX}${ticketId}_${role}${personId ? '_' + personId : ''}`;
}

function toCstDate(date) {
  const d = new Date(date || Date.now());
  return d.toISOString().replace('Z', '+08:00');
}

async function pushPortalTodo({ id, name, url, status = 'pending', startDate, principalPersonId }) {
  // 黑名单检查：黑名单中的人员不接收统一待办
  if (!principalPersonId) {
    return null; // 没有 personId，跳过
  }

  // 获取 union_id 用于黑名单检查和 principal ID
  const unionId = await getPersonUnionId(principalPersonId);
  if (!unionId) {
    return null; // 找不到 union_id，跳过
  }

  // 黑名单中的人不发送
  if (PORTAL_TODO_BLACKLIST.has(unionId)) {
    return null;
  }

  const body = {
    id,
    type: 'portal_todo_list',
    attributes: {
      name,
      url: url || null,
      category: 'todo',
      status,
      start_date: toCstDate(startDate)
    },
    relationships: {
      kind: { data: { id: PORTAL_TODO_KIND_ID, type: 'portal_todo_list_kind' } },
      principal: { data: { id: `${PORTAL_PERSON_PREFIX}${unionId}`, type: 'person' } }
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(PORTAL_TODO_URL, {
      method: 'PUT',
      headers: PORTAL_TODO_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.errors?.[0]?.detail || json?.message || res.statusText;
      throw new Error(`Portal todo push failed (${res.status}): ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function completePortalTodo(todoId, principalPersonId) {
  return pushPortalTodo({ id: todoId, name: '-', status: 'done', principalPersonId });
}

module.exports = { pushPortalTodo, completePortalTodo, buildTodoId, buildSiteUrl, PORTAL_TODO_PREFIX, PORTAL_PERSON_PREFIX };
