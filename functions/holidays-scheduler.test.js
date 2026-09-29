"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CITIES } = require("./holidays-dry-run");
const { yearsToSync, runScheduledHolidaySync } = require("./holidays-scheduler");

test("elige año actual y siguiente según Europe/Madrid, incluso en cambio de año", () => {
  assert.deepEqual(yearsToSync(new Date("2026-09-29T12:00:00Z")), [2026, 2027]);
  assert.deepEqual(yearsToSync(new Date("2026-12-31T23:30:00Z")), [2027, 2028]);
});

test("programación llama al mismo sincronizador para ambos años y resume resultados mixtos", async () => {
  const calls = [];
  const logs = [];
  const log = { info: (name, data) => logs.push([name, data]), warn: (name, data) => logs.push([name, data]), error: (name, data) => logs.push([name, data]) };
  const sync = async (year, db, options) => {
    calls.push([year, db, options.write]);
    return CITIES.map(city => ({
      city, year, status: city === "Bilbao" ? "complete" : city === "Sevilla" ? "error" : "partial",
      action: city === "Bilbao" ? year === 2026 ? "created" : "unchanged" : city === "Sevilla" ? "error" : "partial",
      sources: [],
    }));
  };
  const db = {};
  await runScheduledHolidaySync(db, { now: new Date("2026-09-29T12:00:00Z"), sync, log });
  assert.deepEqual(calls, [[2026, db, true], [2027, db, true]]);
  assert.deepEqual(logs.filter(([name]) => name === "official_holidays_sync").map(([, data]) => [data.year, data.checked, data.complete, data.created, data.unchanged, data.partial, data.errors]), [[2026, 10, 1, 1, 0, 8, 1], [2027, 10, 1, 0, 1, 8, 1]]);
  assert.deepEqual(logs.filter(([name]) => name === "official_holidays_issue").map(([, data]) => [data.city, data.errorCode]), [["Sevilla", "SOURCE_ERROR"], ["Sevilla", "SOURCE_ERROR"]]);
});

test("fallo global de un año permite comprobar el siguiente y queda registrado", async () => {
  const calls = [];
  const errors = [];
  const sync = async year => {
    calls.push(year);
    if (year === 2026) throw new Error("fallo del índice");
    return CITIES.map(city => ({ city, status: "pending", action: "pending", sources: [] }));
  };
  await assert.rejects(runScheduledHolidaySync({}, { now: new Date("2026-09-29T12:00:00Z"), sync, log: { info() {}, warn() {}, error: (_, data) => errors.push(data) } }), /2026/);
  assert.deepEqual(calls, [2026, 2027]);
  assert.equal(errors[0].errorCode, "YEAR_SYNC_ERROR");
});
