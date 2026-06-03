require("dotenv").config();

const { initDb, get } = require("../server/db_mysql");
const { syncBasicPersons } = require("../server/datahub-sync");

async function main() {
  const startDate = process.argv[2] || process.env.DATAHUB_BASIC_PERSON_START_DATE || "2024-05-01";
  const pageSize = Number(process.argv[3] || process.env.DATAHUB_BASIC_PERSON_PAGE_SIZE || 500);
  const maxPages = Number(process.env.DATAHUB_BASIC_PERSON_MAX_PAGES || 0);

  await initDb();
  const result = await syncBasicPersons({ startDate, pageSize, maxPages });
  const total = await get("SELECT COUNT(*) AS count FROM datahub_basic_persons");
  console.log(JSON.stringify({
    ...result,
    stored_total: total?.count || 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
