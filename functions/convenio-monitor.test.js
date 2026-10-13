"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { inventory, parseRegconRows, assertCompleteRegconResult, isDue, pendingEntryCount, reviewInterval, addCalendarMonths, fetchRegcon, runMonthlyConvenioReview } = require("./convenio-monitor");

function memoryDb() {
  const values = new Map();
  let transactionQueue = Promise.resolve();
  const ref = (path) => ({
    path,
    async get() { return { exists: values.has(path), data: () => values.get(path) }; },
    async set(value, options = {}) { values.set(path, options.merge ? { ...(values.get(path) || {}), ...value } : value); },
  });
  return {
    values,
    doc: (path) => ref(path),
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(callback) {
      const result = transactionQueue.then(() => callback({
        get: (document) => document.get(),
        set: (document, value) => { values.set(document.path, value); },
        delete: (document) => { values.delete(document.path); },
      }));
      transactionQueue = result.catch(() => {});
      return result;
    },
  };
}

test("inventario deriva exactamente las 28 fichas documentales, sin crear otra lista manual", () => {
  assert.equal(inventory.length, 28);
  assert.deepEqual(inventory.map((item) => item.number), Array.from({ length: 28 }, (_, index) => index + 1));
  assert.ok(inventory.every((item) => item.id && item.title));
});

test("selecciona revisión bimestral con pendientes, periodo pactado terminado o fuente incompleta", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  const pending = { documentaryStatus: "VERIFICADO CON ACTUALIZACIONES PENDIENTES", pactEndYear: 2028 };
  const ended = { documentaryStatus: "VERIFICADO", pactEndYear: 2025 };
  const current = { documentaryStatus: "VERIFICADO", pactEndYear: 2028 };
  const incomplete = { documentaryStatus: "INCOMPLETO", pactEndYear: 2028 };
  assert.equal(reviewInterval(pending, now), 2);
  assert.equal(reviewInterval(ended, now), 2);
  assert.equal(reviewInterval(incomplete, now), 2);
  assert.equal(reviewInterval(current, now), 6);
  assert.equal(reviewInterval({ documentaryStatus: "VERIFICADO", pactEndYear: 2028 }, now, { pendingEntries: [{ status: "pending_documentary_verification" }] }), 2);
  assert.equal(reviewInterval({ documentaryStatus: "VERIFICADO", pactEndYear: 2028 }, now, { pendingEntries: [{ status: "resolved" }] }), 6);
  assert.equal(pendingEntryCount({ pendingEntries: [{ status: "resolved" }, { status: "pending_baseline_reconciliation" }] }), 1);
  assert.equal(addCalendarMonths(new Date("2026-08-31T10:00:00Z"), 2).toISOString(), "2026-10-31T10:00:00.000Z");
  assert.equal(addCalendarMonths(new Date("2026-12-31T10:00:00Z"), 2).toISOString(), "2027-02-28T10:00:00.000Z");
});

test("omite fuentes todavía no vencidas y exige primera revisión en el inventario inicial", () => {
  const agreement = { sourceUrl: "https://expinterweb.mites.gob.es/regcon/pub/consultaCodigoMapas?convenioMapa=12345678901234" };
  const now = new Date("2026-10-13T10:00:00Z");
  assert.equal(isDue(agreement, null, now), true);
  assert.equal(isDue(agreement, { nextReviewAt: new Date("2026-12-01T00:00:00Z") }, now), false);
  assert.equal(isDue({ sourceUrl: null }, { nextReviewAt: new Date("2026-12-01T00:00:00Z") }, now), false);
  assert.equal(isDue(agreement, { nextReviewAt: "invalid" }, now), true);
});

test("detecta filas REGCON sin tratar una lectura como verificación documental", () => {
  const html = `<table><tr><td>08004295011994</td><td>Transporte Barcelona</td><td>CONVENIO COLECTIVO (TEXTO NUEVO)</td><td>Barcelona</td><td>29/09/2026</td><td>01/01/2026</td><td>31/12/2028</td></tr><tr><td>otra fila</td></tr></table>`;
  const rows = parseRegconRows(html, "08004295011994");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].registrationDate, "29/09/2026");
  assert.match(rows[0].transactionType, /CONVENIO COLECTIVO/);
  assert.equal(rows[0].signature.length, 64);
  const salaryRows = parseRegconRows(`<tr><td>12345678901234</td><td>CONVENIO COLECTIVO HOSTELERIA</td><td>TABLA SALARIAL</td><td>Málaga</td><td>14/04/2026</td></tr><tr><td>12345678901234</td><td>CONVENIO COLECTIVO HOSTELERIA</td><td>MODIFICACIÓN</td><td>Málaga</td><td>02/02/2024</td></tr>`, "12345678901234");
  assert.deepEqual(salaryRows.map((row) => row.transactionType), ["TABLA SALARIAL", "MODIFICACIÓN"]);
  const duplicates = parseRegconRows(`<tr><td>12345678901234</td><td>HOSTELERIA</td><td>TABLA SALARIAL</td><td>Málaga</td><td>14/04/2026</td></tr><tr><td>12345678901234</td><td>HOSTELERIA</td><td>TABLA SALARIAL</td><td>Málaga</td><td>14/04/2026</td></tr>`, "12345678901234");
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].occurrences, 2);
  assert.throws(() => assertCompleteRegconResult("Resultados 1 - 15 de 18", rows), /REGCON_RESULT_INCOMPLETE/);
  assert.throws(() => assertCompleteRegconResult("Página de error", []), /REGCON_RESULT_INCOMPLETE/);
  assert.doesNotThrow(() => assertCompleteRegconResult("Resultados 1 - 2 de 2", rows));
});

test("REGCON rechaza redirecciones, hosts y respuestas fuera del límite", async () => {
  const agreement = { officialCode: "12345678901234", sourceUrl: "https://expinterweb.mites.gob.es/regcon/pub/consultaCodigoMapas?convenioMapa=12345678901234" };
  await assert.rejects(fetchRegcon({ ...agreement, sourceUrl: "https://example.com/" }, async () => {}), /REGCON_URL_NOT_ALLOWED/);
  await assert.rejects(fetchRegcon(agreement, async () => ({ status: 302, ok: false, headers: new Headers() })), /REGCON_REDIRECT_BLOCKED/);
  await assert.rejects(fetchRegcon(agreement, async () => ({ status: 200, ok: true, headers: new Headers({ "content-type": "text/html", "content-length": "99999999" }) })), /REGCON_RESPONSE_TOO_LARGE/);
  await assert.rejects(fetchRegcon(agreement, async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "text/html" } })), /REGCON_RESPONSE_TOO_LARGE/);
});

test("primera ejecución establece baseline sin convertir asientos históricos en novedades y aplaza fichas sin REGCON", async () => {
  const db = memoryDb();
  const logs = [];
  let fetchCount = 0;
  const now = new Date();
  const htmlFor = (code) => `<table><tr><td>${code}</td><td>SECTOR</td><td>CONVENIO COLECTIVO (TEXTO NUEVO)</td><td>01/09/2026</td></tr></table>`;
  const result = await runMonthlyConvenioReview(db, {
    now,
    fetchImpl: async (url) => { fetchCount += 1; return new Response(htmlFor(new URL(url).searchParams.get("convenioMapa")), { status: 200, headers: { "content-type": "text/html" } }); },
    log: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  });
  assert.equal(result.examined, 28);
  assert.equal(result.blocked, 3);
  assert.equal(result.checked, 25);
  assert.equal(result.status, "partial");
  assert.equal(result.geminiCalls, 0);
  assert.equal(db.values.get("convenio_monitor_state/convenio-16").lastResult, "baseline_established_no_historical_novelties");
  assert.equal(db.values.get("convenio_monitor_state/convenio-16").pendingEntries.length, 0);
  assert.equal(db.values.get("convenio_monitor_state/convenio-16").knownSignatures.length, 1);
  assert.equal(db.values.get("convenio_monitor_state/convenio-18").status, "blocked_missing_official_regcon_reference");
  assert.equal(isDue(inventory.find((item) => item.id === "convenio-18"), db.values.get("convenio_monitor_state/convenio-18"), new Date(now.getTime() + 24 * 60 * 60 * 1000)), false);
  assert.ok(db.values.get("convenio_monitor_control/monthly_lock").expiresAt <= new Date());
  const second = await runMonthlyConvenioReview(db, { now: new Date(now.getTime() + 60_000), fetchImpl: async () => { fetchCount += 1; throw new Error("unexpected refetch"); }, log: { info() {}, warn() {} } });
  assert.equal(second.status, "partial");
  assert.equal(second.checked, 0);
  assert.equal(fetchCount, 25);
  assert.equal(db.values.get("convenio_monitor_state/convenio-16").pendingEntries.length, 0);
  const executions = [...db.values.entries()].filter(([path]) => path.startsWith("convenio_monitor_runs/"));
  assert.equal(executions.length, 2);
  assert.deepEqual(executions.map(([, value]) => value.status).sort(), ["partial", "partial"]);
  assert.equal(executions[0][1].executionId === executions[1][1].executionId, false);
});

test("fallos por resultado incompleto no avanzan última revisión correcta ni crean novedades", async () => {
  const db = memoryDb();
  const agreement = inventory.find((item) => item.sourceUrl);
  const now = new Date("2026-10-13T10:00:00Z");
  await assert.rejects(runMonthlyConvenioReview(db, {
    now,
    fetchImpl: async () => new Response(`<html>${agreement.officialCode} Resultados 1 - 15 de 18</html>`, { headers: { "content-type": "text/html" } }),
    log: { info() {}, warn() {} },
  }), /comprobación de fuentes falló/);
  const state = db.values.get(`convenio_monitor_state/${agreement.id}`);
  assert.equal(state.status, "source_check_failed");
  assert.equal(state.lastSuccessfulCheckAt, undefined);
  assert.equal(state.lastErrorCode, "REGCON_RESULT_INCOMPLETE");
  assert.equal(state.pendingEntries, undefined);
});

test("serializa ejecuciones concurrentes y libera solo el lease propio", async () => {
  const db = memoryDb();
  let releaseFetch;
  const pausedFetch = new Promise((resolve) => { releaseFetch = resolve; });
  const htmlFor = (code) => `<table><tr><td>${code}</td><td>SECTOR</td><td>CONVENIO COLECTIVO</td><td>fecha</td></tr></table>`;
  const first = runMonthlyConvenioReview(db, {
    now: new Date("2026-10-13T10:00:00Z"),
    fetchImpl: async (url) => { await pausedFetch; return new Response(htmlFor(new URL(url).searchParams.get("convenioMapa")), { headers: { "content-type": "text/html" } }); },
    log: { info() {}, warn() {} },
  });
  const second = await runMonthlyConvenioReview(db, { now: new Date("2026-10-13T10:00:01Z"), log: { info() {}, warn() {} } });
  assert.equal(second.status, "locked");
  releaseFetch();
  await first;
  const lock = db.values.get("convenio_monitor_control/monthly_lock");
  assert.ok(lock.expiresAt <= new Date());
});
