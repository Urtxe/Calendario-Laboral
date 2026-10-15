"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { inventory, parseRegconRows, parseRegconExport, announcedResultCount, isDue, pendingEntryCount, documentaryRetryDue, reviewInterval, addCalendarMonths, fetchRegcon, runMonthlyConvenioReview } = require("./convenio-monitor");

function regconPage(code, total = 2) {
  return `<html><form action="/regcon/pub/consultaCodigoMapas?convenioMapa=${code}"></form><span>Resultados 1 - ${Math.min(15, total)} de ${total}</span><a href="/regcon/pub/consultaCodigoMapas?pagina=2">2</a>${code}</html>`;
}

function regconExport(code, rows) {
  const records = rows.map((cells) => `<Row>${cells.map((cell) => `<Cell><Data ss:Type="String">${cell}</Data></Cell>`).join("")}</Row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Workbook><Worksheet><Table>${records}</Table></Worksheet></Workbook>`;
}

function response(body, contentType = "text/html", status = 200, headers = {}) {
  return new Response(body, { status, headers: { "content-type": contentType, ...headers } });
}

function exportFetch(code, rows, overrides = {}) {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(new URL(url).hostname, "expinterweb.mites.gob.es");
    if (calls === 1) {
      assert.equal(options.method, "GET");
      return response(regconPage(code, overrides.announced ?? rows.length), "text/html", 200, { "set-cookie": "JSESSIONID=test; Path=/; HttpOnly" });
    }
    assert.equal(options.method, "POST");
    assert.match(options.headers.cookie, /JSESSIONID=test/);
    return response(overrides.body ?? regconExport(code, rows), overrides.contentType ?? "application/vnd.ms-excel", overrides.status ?? 200);
  };
  Object.defineProperty(fetchImpl, "calls", { get: () => calls });
  return fetchImpl;
}

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
  assert.equal(inventory.find((item) => item.number === 26).pactEndYear, 2009, "la cadencia usa el periodo verificado del convenio, no el nombre local del PDF");
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
  const newlyReferenced = inventory.find((item) => item.number === 26);
  assert.equal(isDue(newlyReferenced, { status: "blocked_missing_official_regcon_reference", officialCode: null, nextReviewAt: new Date("2026-12-13T00:00:00Z") }, now), true);
  const failedLastMonth = { status: "source_check_failed", technicalFailureCount: 2, lastAttemptAt: new Date("2026-09-13T10:00:00Z"), nextReviewAt: new Date("2026-11-13T10:00:00Z") };
  assert.equal(isDue(agreement, failedLastMonth, now), true);
  assert.equal(isDue(agreement, { ...failedLastMonth, lastAttemptAt: now }, now), false);
  assert.equal(isDue(agreement, { ...failedLastMonth, technicalFailureCount: 6, nextReviewAt: new Date("2027-04-13T10:00:00Z") }, now), false);
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
  assert.equal(rows[0].officialCode, "08004295011994");
  assert.equal(announcedResultCount("Resultados 1 - 15 de 22"), 22);
  assert.throws(() => announcedResultCount("Página de error"), /REGCON_RESULT_INCOMPLETE/);
  assert.throws(() => announcedResultCount("Resultados 1 - 16 de 15"), /REGCON_RESULT_INCOMPLETE/);
  assert.throws(() => announcedResultCount("Resultados 2 - 15 de 22"), /REGCON_RESULT_INCOMPLETE/);
});

test("conserva la URL oficial de la exportación solo en asientos nuevos", () => {
  const code = "20100035012014";
  const rows = parseRegconExport(regconExport(code, [[code, "Alojamientos Gipuzkoa", "REVISIÓN SALARIAL", "Guipúzcoa", "16/02/2026", "01/01/2025", "31/12/2028", "https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/16/c2600553.pdf"]]), code, 1);
  assert.equal(rows[0].publicationUrl, "https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/16/c2600553.pdf");
  const withoutUrl = parseRegconExport(regconExport(code, [[code, "Alojamientos Gipuzkoa", "REVISIÓN SALARIAL", "Guipúzcoa", "16/02/2026", "01/01/2025", "31/12/2028", ""]]), code, 1);
  assert.equal(rows[0].signature, withoutUrl[0].signature, "una URL añadida al asiento histórico no crea una novedad");
  assert.equal(rows[0].signature, withoutUrl[0].legacySignature, "conserva las firmas del baseline anterior");
  const duplicated = parseRegconExport(regconExport(code, [
    [code, "Alojamientos Gipuzkoa", "REVISIÓN SALARIAL", "Guipúzcoa", "16/02/2026", "01/01/2025", "31/12/2028", ""],
    [code, "Alojamientos Gipuzkoa", "REVISIÓN SALARIAL", "Guipúzcoa", "16/02/2026", "01/01/2025", "31/12/2028", rows[0].publicationUrl],
  ]), code, 2);
  assert.equal(duplicated.length, 1);
  assert.equal(duplicated[0].publicationUrl, rows[0].publicationUrl);
  assert.equal(parseRegconExport(regconExport(code, [[code, "Alojamientos Gipuzkoa", "REVISIÓN SALARIAL", "Guipúzcoa", "16/02/2026", "01/01/2025", "31/12/2028", "http://bop.diba.cat/anuncio/1"]]), code, 1)[0].publicationUrl, null);
});

test("despierta el reintento documental vencido aunque REGCON no venza", async () => {
  const db = memoryDb();
  const now = new Date("2026-11-01T04:00:00Z");
  const agreement = inventory.find((item) => item.id === "convenio-02");
  const statePath = `convenio_monitor_state/${agreement.id}`;
  for (const item of inventory) db.values.set(`convenio_monitor_state/${item.id}`, {
    status: "source_checked", nextReviewAt: new Date("2026-12-01T04:00:00Z"), pendingEntries: [],
  });
  db.values.set(statePath, {
    status: "source_checked", baselineEstablished: true, nextReviewAt: new Date("2026-12-01T04:00:00Z"),
    pendingEntries: [{ signature: "retry", status: "documentary_retry", documentaryAttemptCount: 1,
      nextDocumentaryAttemptAt: new Date("2026-10-31T04:00:00Z") }],
  });
  assert.equal(documentaryRetryDue(db.values.get(statePath), now), true);
  const result = await runMonthlyConvenioReview(db, { now, fetchImpl: async () => { throw new Error("REGCON no vence"); }, log: { info() {}, warn() {} } });
  assert.equal(result.deferred > 0, true);
  assert.equal(db.values.get(statePath).documentaryWakeAt.toISOString(), now.toISOString());
  assert.equal(db.values.get(statePath).pendingEntries[0].status, "documentary_retry");
});

test("exportación oficial cubre varias páginas, deduplica filas e identifica inconsistencias", () => {
  const code = "12345678901234";
  const row = [code, "CONVENIO", "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2026", "https://boe.es/a"];
  const duplicate = parseRegconExport(regconExport(code, [row, row]), code, 2);
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].occurrences, 2);
  assert.equal(duplicate[0].officialCode, code);
  assert.throws(() => parseRegconExport(regconExport(code, [row]), code, 2), /REGCON_RESULT_INCOMPLETE/);
  assert.throws(() => parseRegconExport(regconExport(code, [["99999999999999", ...row.slice(1)]]), code, 1), /REGCON_EXPORT_CODE_MISMATCH/);
  assert.throws(() => parseRegconExport(regconExport(code, Array.from({ length: 501 }, (_, i) => [code, `Convenio ${i}`, "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2026", ""])), code, 501), /REGCON_RESULT_INCOMPLETE/);
  const announce22 = "Resultados 1 - 15 de 22";
  assert.equal(announcedResultCount(announce22), 22);
  assert.equal(parseRegconExport(regconExport(code, Array.from({ length: 22 }, (_, i) => [code, `Convenio ${i}`, "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2026", ""])), code, announcedResultCount(announce22)).length, 22);
});

test("REGCON exporta cobertura completa por su botón público; rechaza fallos, HTML inesperado y redirecciones", async () => {
  const agreement = { officialCode: "12345678901234", sourceUrl: "https://expinterweb.mites.gob.es/regcon/pub/consultaCodigoMapas?convenioMapa=12345678901234" };
  await assert.rejects(fetchRegcon({ ...agreement, sourceUrl: "https://example.com/" }, async () => {}), /REGCON_URL_NOT_ALLOWED/);
  await assert.rejects(fetchRegcon(agreement, async () => response("", "text/html", 302)), /REGCON_REDIRECT_BLOCKED/);
  await assert.rejects(fetchRegcon(agreement, async () => response("x", "text/html", 200, { "content-length": "99999999" })), /REGCON_RESPONSE_TOO_LARGE/);
  await assert.rejects(fetchRegcon(agreement, async () => response(regconPage(agreement.officialCode))), /REGCON_UNEXPECTED_EXPORT/);
  await assert.rejects(fetchRegcon(agreement, exportFetch(agreement.officialCode, [[agreement.officialCode, "X", "CONVENIO COLECTIVO"]], { contentType: "text/html" })), /REGCON_UNEXPECTED_EXPORT/);
  await assert.rejects(fetchRegcon(agreement, async (_url, options) => options.method === "GET" ? response(regconPage(agreement.officialCode)) : response("", "text/html", 302)), /REGCON_REDIRECT_BLOCKED/);
  await assert.rejects(fetchRegcon(agreement, async (_url, options) => options.method === "GET" ? response(regconPage(agreement.officialCode)) : response("<html>error</html>", "application/vnd.ms-excel")), /REGCON_UNEXPECTED_EXPORT/);
  await assert.rejects(fetchRegcon(agreement, async (_url, options) => options.method === "GET" ? response(regconPage(agreement.officialCode)) : new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")))), { requestTimeoutMs: 5 }), { name: "AbortError" });
  const allRowsFetch = exportFetch(agreement.officialCode, [ [agreement.officialCode, "A", "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2028", ""], [agreement.officialCode, "B", "CONVENIO COLECTIVO", "Madrid", "01/01/2023", "01/01/2023", "31/12/2026", ""] ]);
  assert.equal((await fetchRegcon(agreement, allRowsFetch)).length, 2);
  assert.equal(allRowsFetch.calls, 2, "el cliente usa la exportación pública y no recorre enlaces repetidos que pierden la búsqueda");
});

test("primera ejecución establece baseline sin convertir asientos históricos en novedades y aplaza fichas sin REGCON", async () => {
  const db = memoryDb();
  const logs = [];
  let fetchCount = 0;
  const now = new Date();
  const fetchForAgreement = async (url, options) => {
    fetchCount += 1;
    const code = new URL(url).searchParams.get("convenioMapa");
    const rows = [[code, "SECTOR", "CONVENIO COLECTIVO", "Madrid", "01/09/2026", "01/01/2026", "31/12/2028", ""]];
    return options.method === "GET" ? response(regconPage(code, 1), "text/html", 200, { "set-cookie": "JSESSIONID=test; Path=/" }) : response(regconExport(code, rows), "application/vnd.ms-excel");
  };
  const result = await runMonthlyConvenioReview(db, {
    now,
    fetchImpl: fetchForAgreement,
    log: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  });
  assert.equal(result.examined, 28);
  assert.equal(result.blocked, 2);
  assert.equal(result.checked, 26);
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
  assert.equal(fetchCount, 52);
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
  const previousSuccessfulCheck = new Date("2026-08-13T10:00:00Z");
  const previousSignature = "b".repeat(64);
  db.values.set(`convenio_monitor_state/${agreement.id}`, { status: "source_checked", lastSuccessfulCheckAt: previousSuccessfulCheck, knownSignatures: [previousSignature], baselineEstablished: true, pendingEntries: [] });
  await assert.rejects(runMonthlyConvenioReview(db, {
    now,
    fetchImpl: async (_url, options) => options.method === "GET"
      ? response(regconPage(agreement.officialCode, 18))
      : response(regconExport(agreement.officialCode, []), "application/vnd.ms-excel"),
    log: { info() {}, warn() {} },
  }), /comprobación de fuentes falló/);
  const state = db.values.get(`convenio_monitor_state/${agreement.id}`);
  assert.equal(state.status, "source_check_failed");
  assert.equal(state.lastSuccessfulCheckAt, previousSuccessfulCheck);
  assert.deepEqual(state.knownSignatures, [previousSignature]);
  assert.equal(state.lastErrorCode, "REGCON_RESULT_INCOMPLETE");
  assert.deepEqual(state.pendingEntries, []);
});

test("seis fallos distinguen bloqueo persistente de HTTP temporal", async () => {
  const agreement = inventory.find((item) => item.sourceUrl);
  const now = new Date("2026-10-13T10:00:00Z");
  for (const [failedFetch, expectedStatus, expectedReview] of [
    [async () => response("error", "text/html", 503), "source_check_degraded", "2026-12-13T10:00:00.000Z"],
    [async (_url, options) => options.method === "GET" ? response(regconPage(agreement.officialCode, 18)) : response(regconExport(agreement.officialCode, []), "application/vnd.ms-excel"), "source_check_retry_exhausted", "2027-04-13T10:00:00.000Z"],
  ]) {
    const db = memoryDb();
    for (const item of inventory) db.values.set(`convenio_monitor_state/${item.id}`, { nextReviewAt: new Date("2027-01-01T00:00:00Z") });
    db.values.set(`convenio_monitor_state/${agreement.id}`, { status: "source_check_failed", technicalFailureCount: 5, lastAttemptAt: new Date("2026-09-13T10:00:00Z") });
    await assert.rejects(runMonthlyConvenioReview(db, { now, fetchImpl: failedFetch, log: { info() {}, warn() {} } }), /comprobación de fuentes falló/);
    const state = db.values.get(`convenio_monitor_state/${agreement.id}`);
    assert.equal(state.status, expectedStatus);
    assert.equal(state.technicalFailureCount, 6);
    assert.equal(state.nextReviewAt.toISOString(), expectedReview);
  }
});

test("la primera exportación completa tras una parcial establece baseline sin alertas históricas", async () => {
  const db = memoryDb();
  const agreement = inventory.find((item) => item.sourceUrl);
  const now = new Date("2026-10-13T10:00:00Z");
  const partialSignature = "a".repeat(64);
  for (const item of inventory) db.values.set(`convenio_monitor_state/${item.id}`, { nextReviewAt: new Date("2027-01-01T00:00:00Z") });
  db.values.set(`convenio_monitor_state/${agreement.id}`, { status: "source_check_failed", technicalFailureCount: 1, lastAttemptAt: new Date("2026-09-13T10:00:00Z"), nextReviewAt: new Date("2026-11-13T10:00:00Z"), knownSignatures: [partialSignature] });
  const rows = [[agreement.officialCode, "SECTOR", "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2028", ""]];
  const result = await runMonthlyConvenioReview(db, { now, fetchImpl: exportFetch(agreement.officialCode, rows), log: { info() {}, warn() {} } });
  const state = db.values.get(`convenio_monitor_state/${agreement.id}`);
  assert.equal(result.checked, 1);
  assert.equal(result.newEntries, 0);
  assert.equal(state.baselineEstablished, true);
  assert.equal(state.lastResult, "baseline_established_no_historical_novelties");
  const completeSignature = crypto.createHash("sha256").update(rows[0].join("\u001f")).digest("hex");
  assert.deepEqual(state.knownSignatures.sort(), [partialSignature, completeSignature].sort());
  assert.equal(state.pendingEntries.length, 0);
});

test("reconciliación explícita comprueba un fallo heredado sin adelantar los demás estados", async () => {
  const db = memoryDb();
  const agreement = inventory.find((item) => item.sourceUrl);
  const now = new Date("2026-10-14T12:00:00Z");
  const row = [agreement.officialCode, "SECTOR", "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2028", ""];
  for (const item of inventory) db.values.set(`convenio_monitor_state/${item.id}`, {
    nextReviewAt: new Date("2026-12-13T00:00:00Z"), status: "source_checked",
  });
  db.values.set(`convenio_monitor_state/${agreement.id}`, {
    status: "source_check_failed", lastErrorCode: "REGCON_RESULT_INCOMPLETE", baselineEstablished: false,
    knownSignatures: [], pendingEntries: [], lastAttemptAt: new Date("2026-10-13T10:00:00Z"),
    nextReviewAt: new Date("2026-12-13T00:00:00Z"),
  });
  const fetchImpl = exportFetch(agreement.officialCode, [row]);
  const result = await runMonthlyConvenioReview(db, { now, fetchImpl, reconcileHistoricalFailures: true, log: { info() {}, warn() {} } });
  const state = db.values.get(`convenio_monitor_state/${agreement.id}`);
  assert.equal(result.checked, 1);
  assert.equal(result.newEntries, 0);
  assert.equal(fetchImpl.calls, 2);
  assert.equal(state.status, "source_checked");
  assert.equal(state.baselineEstablished, true);
  assert.equal(state.pendingEntries.length, 0);
  assert.equal(state.knownSignatures.length, 1);
  assert.equal(state.lastReconciliationRunId, "2026-10");
  assert.equal(state.lastSuccessfulCheckAt.toISOString(), now.toISOString());
  assert.equal(state.nextReviewAt.toISOString(), "2026-12-14T12:00:00.000Z");
  db.values.get("convenio_monitor_control/monthly_lock").expiresAt = now;
  const again = await runMonthlyConvenioReview(db, { now: new Date("2026-10-14T12:01:00Z"), fetchImpl: () => { throw new Error("unexpected fetch"); }, reconcileHistoricalFailures: true, log: { info() {}, warn() {} } });
  assert.equal(again.status, "already_complete");
});

test("la revisión es idempotente incluso si la firma está en pendientes y no en la lista limitada", async () => {
  const db = memoryDb();
  const agreement = inventory.find((item) => item.sourceUrl);
  const now = new Date("2026-10-13T10:00:00Z");
  const row = [agreement.officialCode, "SECTOR", "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2028", ""];
  const signature = crypto.createHash("sha256").update(row.join("\u001f")).digest("hex");
  for (const item of inventory) db.values.set(`convenio_monitor_state/${item.id}`, { nextReviewAt: new Date("2027-01-01T00:00:00Z") });
  db.values.set(`convenio_monitor_state/${agreement.id}`, { baselineEstablished: true, knownSignatures: [], pendingEntries: [{ signature, status: "pending_documentary_verification" }], nextReviewAt: new Date("2026-10-01T00:00:00Z") });
  const result = await runMonthlyConvenioReview(db, { now, fetchImpl: exportFetch(agreement.officialCode, [row]), log: { info() {}, warn() {} } });
  const state = db.values.get(`convenio_monitor_state/${agreement.id}`);
  assert.equal(result.newEntries, 0);
  assert.equal(state.pendingEntries.length, 1);
  assert.equal(state.pendingEntries[0].signature, signature);
});

test("serializa ejecuciones concurrentes y libera solo el lease propio", async () => {
  const db = memoryDb();
  let releaseFetch;
  const pausedFetch = new Promise((resolve) => { releaseFetch = resolve; });
  const fetchForAgreement = async (url, options) => {
    const code = new URL(url).searchParams.get("convenioMapa");
    await pausedFetch;
    return options.method === "GET" ? response(regconPage(code, 1), "text/html", 200, { "set-cookie": "JSESSIONID=test; Path=/" }) : response(regconExport(code, [[code, "SECTOR", "CONVENIO COLECTIVO", "Madrid", "01/01/2024", "01/01/2024", "31/12/2028", ""]]), "application/vnd.ms-excel");
  };
  const first = runMonthlyConvenioReview(db, {
    now: new Date("2026-10-13T10:00:00Z"),
    fetchImpl: fetchForAgreement,
    log: { info() {}, warn() {} },
  });
  const second = await runMonthlyConvenioReview(db, { now: new Date("2026-10-13T10:00:01Z"), log: { info() {}, warn() {} } });
  assert.equal(second.status, "locked");
  releaseFetch();
  await first;
  const lock = db.values.get("convenio_monitor_control/monthly_lock");
  assert.ok(lock.expiresAt <= new Date());
});
