const { fetchBasicPersons } = require("./datahub");
const { ensureDatahubPersonTables, run, upsertDatahubBasicPersons, disableAdminsForInactivePersons } = require("./db_sqlite");
const logger = require("./logger");

async function syncBasicPersons(options = {}) {
  const startDate = options.startDate || options.start_date || "2024-05-01";
  const pageSize = Number(options.pageSize || options.page_size || 500);
  const maxPages = Number(options.maxPages || options.max_pages || 0);

  await ensureDatahubPersonTables();
  const syncRun = await run(
    "INSERT INTO datahub_basic_person_sync_runs (start_date, page_size) VALUES (?, ?)",
    [startDate, pageSize]
  );

  let fetchedCount = 0;
  let upsertedCount = 0;
  let offset = Number(options.offset || 0);
  let pageCount = 0;

  try {
    while (true) {
      if (maxPages > 0 && pageCount >= maxPages) break;
      const data = await fetchBasicPersons({ sql_args: [startDate, pageSize, offset] });
      const rows = data.rows || [];
      if (rows.length === 0) break;

      fetchedCount += rows.length;
      upsertedCount += await upsertDatahubBasicPersons(rows);
      pageCount += 1;

      logger.info("datahub_basic_persons_sync_page", {
        sync_run_id: syncRun.insertId,
        offset,
        page_size: pageSize,
        row_count: rows.length
      });

      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    await run(
      `UPDATE datahub_basic_person_sync_runs
       SET finished_at = CURRENT_TIMESTAMP,
           fetched_count = ?,
           upserted_count = ?,
           status = 'success'
       WHERE id = ?`,
      [fetchedCount, upsertedCount, syncRun.insertId]
    );

    // 离职人员自动禁用管理员权限
    try {
      const disabledCount = await disableAdminsForInactivePersons();
      if (disabledCount > 0) {
        logger.info("datahub_auto_disable_admins", {
          sync_run_id: syncRun.insertId,
          disabled_count: disabledCount
        });
      }
    } catch (err) {
      logger.error("datahub_auto_disable_admins_failed", {
        sync_run_id: syncRun.insertId,
        error: err.message
      });
    }

    return {
      sync_run_id: syncRun.insertId,
      start_date: startDate,
      page_size: pageSize,
      fetched_count: fetchedCount,
      upserted_count: upsertedCount,
      page_count: pageCount
    };
  } catch (error) {
    await run(
      `UPDATE datahub_basic_person_sync_runs
       SET finished_at = CURRENT_TIMESTAMP,
           fetched_count = ?,
           upserted_count = ?,
           status = 'failed',
           error_message = ?
       WHERE id = ?`,
      [fetchedCount, upsertedCount, error.message, syncRun.insertId]
    );
    throw error;
  }
}

module.exports = {
  syncBasicPersons
};
