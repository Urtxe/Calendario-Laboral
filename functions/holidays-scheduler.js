"use strict";

const logger = require("firebase-functions/logger");
const { CITIES } = require("./holidays-dry-run");
const { synchronize } = require("./holidays-publish");

function yearsToSync(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("Fecha de ejecución inválida");
  const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", year: "numeric" }).format(now));
  return [year, year + 1];
}

async function runScheduledHolidaySync(db, { now = new Date(), sync = synchronize, log = logger } = {}) {
  const failures = [];
  for (const year of yearsToSync(now)) {
    try {
      const rows = await sync(year, db, { write: true });
      if (rows.length !== CITIES.length) throw new Error(`Se esperaban ${CITIES.length} ciudades; llegaron ${rows.length}`);
      const count = predicate => rows.filter(predicate).length;
      log.info("official_holidays_sync", {
        year, checked: rows.length, complete: count(row => row.status === "complete"),
        created: count(row => row.action === "created"), unchanged: count(row => row.action === "unchanged"),
        partial: count(row => row.status === "partial"), pending: count(row => row.status === "pending"),
        notPublicable: count(row => row.action === "not_publicable"), conflicts: count(row => row.action === "conflict"),
        errors: count(row => row.action === "error"),
      });
      for (const row of rows.filter(item => ["conflict", "error"].includes(item.action))) {
        log.warn("official_holidays_issue", {
          city: row.city, year, status: row.status, source: row.sources?.[0] || null,
          errorCode: row.action === "conflict" ? "CONFLICT" : row.error ? "SYNC_ERROR" : "SOURCE_ERROR",
        });
      }
    } catch (error) {
      failures.push(year);
      log.error("official_holidays_year_error", { year, checked: 0, city: null, status: "error", source: null, errorCode: "YEAR_SYNC_ERROR", message: error.message });
    }
  }
  if (failures.length) throw new Error(`Sincronización anual fallida: ${failures.join(", ")}`);
}

module.exports = { yearsToSync, runScheduledHolidaySync };
