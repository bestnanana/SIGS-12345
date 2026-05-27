const DATAHUB_BASIC_PERSON_URL = process.env.DATAHUB_BASIC_PERSON_URL || "https://api.sigs.tsinghua.edu.cn/v1/basic/api_basic_person";
const DATAHUB_API_KEY = process.env.DATAHUB_API_KEY || "";
const DATAHUB_SERVICE_ID = process.env.DATAHUB_SERVICE_ID || "";

function assertDatahubConfig() {
  if (!DATAHUB_API_KEY || !DATAHUB_SERVICE_ID) {
    const error = new Error("Datahub接口未配置Apikey或ServiceId");
    error.status = 500;
    throw error;
  }
}

function normalizeBasicPersonQuery(body = {}) {
  if (Array.isArray(body.sql_args)) return body.sql_args;

  const startDate = body.startDate || body.start_date || "2024-05-01";
  const pageSize = Number(body.pageSize ?? body.page_size ?? 10);
  const offset = Number(body.offset ?? body.page ?? 0);
  return [startDate, pageSize, offset];
}

function normalizeBasicPersonRow(row = {}) {
  return {
    id: String(row.id || "").trim(),
    union_id: String(row.union_id || "").trim(),
    name: String(row.name || "").trim(),
    type: String(row.type || "").trim(),
    category: String(row.category || "").trim(),
    department: String(row.department || "").trim(),
    status: String(row.status || "").trim(),
    appoint_attr: String(row.appoint_attr || "").trim(),
    appointment_form: String(row.appointment_form || "").trim(),
    hire_post: String(row.hire_post || "").trim(),
    write_date: String(row.write_date || "").trim(),
    raw_json: JSON.stringify(row)
  };
}

async function fetchBasicPersons(body = {}) {
  assertDatahubConfig();
  const sqlArgs = normalizeBasicPersonQuery(body);
  const controller = new AbortController();
  const timeoutMs = Number(process.env.DATAHUB_TIMEOUT_MS || 30000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(DATAHUB_BASIC_PERSON_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Authorization-Type": "Apikey",
        Authorization: DATAHUB_API_KEY,
        ServiceId: DATAHUB_SERVICE_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sql_args: sqlArgs }),
      signal: controller.signal
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { message: text };
    }

    if (!response.ok || data.status === "error") {
      const error = new Error(data.message || data.msg || "Datahub人员基础信息接口调用失败");
      error.status = response.status || 502;
      error.response = data;
      throw error;
    }

    return {
      sql_args: sqlArgs,
      rows: Array.isArray(data.result?.rows) ? data.result.rows.map(normalizeBasicPersonRow) : [],
      raw: data
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchBasicPersons,
  normalizeBasicPersonRow
};
