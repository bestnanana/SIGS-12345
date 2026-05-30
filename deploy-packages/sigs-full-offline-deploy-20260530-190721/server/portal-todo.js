const PORTAL_TODO_URL = 'https://api-test.sigs.tsinghua.edu.cn:6690/v1/sync/portal_todo_list';
const PORTAL_TODO_HEADERS = {
  'Authorization-Type': 'Apikey',
  'Authorization': 'xppae4Tcr7YFI1h2UG4rHQ5ooX0dzuzs',
  'ServiceId': 'QX1oRe',
  'Accept': 'application/vnd.api+json',
  'Content-Type': 'application/json'
};
const PORTAL_TODO_KIND_ID = 'jsjb';
const PORTAL_TODO_PREFIX = '028d0a7edb_';
const PORTAL_PERSON_PREFIX = 'syncperson_';
const SITE_BASE_URL = (process.env.SITE_BASE_URL || 'http://10.103.0.148').replace(/\/$/, '');

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
      principal: { data: { id: `${PORTAL_PERSON_PREFIX}${principalPersonId}`, type: 'person' } }
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
