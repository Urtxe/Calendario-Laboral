"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SUMMARY_COLLECTION,
  buildAdminYearSummary,
  changedLegacyYears,
  parseYearId,
  processAdminYearSummaryBackfillPage,
  syncAdminProfileLegacySummaries,
  syncAdminYearSummary,
} = require("./admin-year-summary");

function memoryDb(entries) {
  const documents = new Map(Object.entries(entries));
  let writes = 0;
  const reference = (documentPath) => ({
    path: documentPath,
    collection(name) { return collection(`${documentPath}/${name}`); },
  });
  const collection = (collectionPath) => ({
    doc(id) { return reference(`${collectionPath}/${id}`); },
  });

  return {
    documents,
    get writes() { return writes; },
    collection,
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({
        async get(ref) {
          const value = documents.get(ref.path);
          return { exists: value !== undefined, data: () => value };
        },
        set(ref, value) { pending.push(() => documents.set(ref.path, value)); },
        delete(ref) { pending.push(() => documents.delete(ref.path)); },
      });
      pending.forEach((write) => { write(); writes += 1; });
      return result;
    },
  };
}

function summaryPath(userId, year) {
  return `usuarios/${userId}/${SUMMARY_COLLECTION}/${year}`;
}

test("calcula el mismo balance anual de la app, incluye futuro y separa extras", () => {
  const summary = buildAdminYearSummary({
    horasAnuales: 1800,
    tipoJornada: 0.5,
    diasMarcados: {
      "2026-01-02": { tipo: "trabajado" },
      "2026-01-03": { tipo: "baja" },
      "2026-01-04": { tipo: "trabajado", esFestivo: true },
      "2026-12-20": { tipo: "trabajado" },
      "2026-12-21": { tipo: "trabajado", esFestivo: true },
    },
    horasExtraPorDia: { "2026-01-02": 3 },
    horasExtraCompensadas: { "2026-01": true },
  }, 2026, "2026-06-01");

  assert.deepEqual(summary, {
    available: true,
    year: 2026,
    computedDays: 5,
    holidayDays: 2,
    estimatedHours: 20,
    requiredHours: 896,
    balanceHours: -876,
    balanceDays: -219,
    overtimeHoursEntered: 3,
    compensatedOvertimeMonths: 1,
    includesFuturePlans: true,
    calculationVersion: 1,
    note: "Estimación según el calendario: cada día marcado como trabajado o baja cuenta como jornada; se incluyen marcas futuras. Las horas extra se muestran aparte y no son horas reales fichadas.",
  });
  assert.equal(Object.keys(summary).some((key) => /uid|email|date|absence/i.test(key)), false);
});

test("jornada personalizada conserva el factor sin redondeos intermedios", () => {
  const diasMarcados = Object.fromEntries(Array.from({ length: 32 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    return [date, { tipo: "trabajado" }];
  }));
  const summary = buildAdminYearSummary({
    horasAnuales: 1800,
    tipoJornada: 0.3333,
    diasMarcados,
  }, 2026, "2026-12-31");

  assert.equal(summary.estimatedHours, 85);
  assert.equal(summary.requiredHours, 600);
  assert.equal(summary.balanceHours, -515);
  assert.equal(summary.balanceDays, -193);
});

test("año inválido no consulta ni escribe documentos", async () => {
  assert.equal(parseYearId("02026"), null);
  assert.equal(parseYearId("2026.0"), null);
  assert.equal(parseYearId("2101"), null);
  assert.equal(parseYearId("2026"), 2026);

  const db = memoryDb({});
  assert.deepEqual(await syncAdminYearSummary({
    db,
    userId: "alice",
    yearId: "2026.0",
    serverTimestamp: () => "timestamp",
  }), { status: "invalid_path" });
  assert.equal(db.writes, 0);
});

test("sin configuración anual escribe solo estado no disponible, no cifras obsoletas", async () => {
  const db = memoryDb({
    "usuarios/alice": { email: "alice@example.test" },
    "usuarios/alice/years/2026": { diasMarcados: { "2026-01-02": { tipo: "trabajado" } } },
  });

  const result = await syncAdminYearSummary({ db, userId: "alice", yearId: "2026", serverTimestamp: () => "timestamp" });
  assert.equal(result.status, "updated");
  assert.deepEqual(db.documents.get(summaryPath("alice", 2026)), {
    available: false,
    year: 2026,
    reason: "missing_annual_setup",
    calculationVersion: 1,
    updatedAt: "timestamp",
  });
});

test("lee datos actuales bajo transacción e ignora duplicados sin reescribir", async () => {
  const base = {
    available: true,
    year: 2026,
    computedDays: 1,
    holidayDays: 0,
    estimatedHours: 8,
    requiredHours: 1800,
    balanceHours: -1792,
    balanceDays: -224,
    overtimeHoursEntered: 0,
    compensatedOvertimeMonths: 0,
    includesFuturePlans: true,
    calculationVersion: 1,
    note: "Estimación según el calendario: cada día marcado como trabajado o baja cuenta como jornada; se incluyen marcas futuras. Las horas extra se muestran aparte y no son horas reales fichadas.",
  };
  const db = memoryDb({
    "usuarios/alice": { objetivosAnuales: { 2026: 1800 }, tipoJornadaPorAnio: { 2026: 1 } },
    "usuarios/alice/years/2026": { diasMarcados: { "2026-01-02": { tipo: "trabajado" } } },
    [summaryPath("alice", 2026)]: { ...base, updatedAt: "previous" },
  });

  const result = await syncAdminYearSummary({ db, userId: "alice", yearId: "2026", serverTimestamp: () => "new" });
  assert.deepEqual(result, { status: "unchanged" });
  assert.equal(db.writes, 0);
  assert.equal(db.documents.get(summaryPath("alice", 2026)).updatedAt, "previous");
});

test("barrera de borrado o perfil ausente impiden recreación y borran solo el resumen", async () => {
  const summary = { available: true, old: true };
  const tombstoneDb = memoryDb({
    "usuarios/alice": { ciudadActual: "Donostia" },
    "usuarios/alice/years/2026": { horasAnuales: 1800, tipoJornada: 1 },
    "accountDeletions/alice": { deleted: true },
    [summaryPath("alice", 2026)]: summary,
  });
  assert.deepEqual(await syncAdminYearSummary({ db: tombstoneDb, userId: "alice", yearId: "2026", serverTimestamp: () => "timestamp" }), { status: "deleted" });
  assert.equal(tombstoneDb.documents.has("usuarios/alice"), true);
  assert.equal(tombstoneDb.documents.has("usuarios/alice/years/2026"), true);
  assert.equal(tombstoneDb.documents.has(summaryPath("alice", 2026)), false);

  const missingProfileDb = memoryDb({
    "usuarios/alice/years/2026": { horasAnuales: 1800, tipoJornada: 1 },
    [summaryPath("alice", 2026)]: summary,
  });
  await syncAdminYearSummary({ db: missingProfileDb, userId: "alice", yearId: "2026", serverTimestamp: () => "timestamp" });
  assert.equal(missingProfileDb.documents.has(summaryPath("alice", 2026)), false);
  assert.equal(missingProfileDb.documents.has("usuarios/alice/years/2026"), true);
});

test("elimina el resumen cuando desaparece toda fuente anual", async () => {
  const db = memoryDb({
    "usuarios/alice": { email: "alice@example.test" },
    "usuarios/alice/years/2026": { updatedAt: "source doc but no annual data" },
    [summaryPath("alice", 2026)]: { available: true, stale: true },
  });

  assert.deepEqual(await syncAdminYearSummary({ db, userId: "alice", yearId: "2026", serverTimestamp: () => "timestamp" }), { status: "deleted" });
  assert.equal(db.documents.has(summaryPath("alice", 2026)), false);
});

test("backfill dry-run calcula acciones sin escribir", async () => {
  const db = memoryDb({
    "usuarios/alice": { email: "alice@example.test" },
    "usuarios/alice/years/2026": { horasAnuales: 1800, tipoJornada: 1 },
  });
  const stats = await processAdminYearSummaryBackfillPage({
    db,
    candidates: [{ userId: "alice", yearId: "2026" }],
    serverTimestamp: () => "timestamp",
  });
  assert.equal(stats.candidates, 1);
  assert.equal(stats.wouldUpdate, 1);
  assert.equal(db.writes, 0);
  assert.equal(db.documents.has(summaryPath("alice", 2026)), false);
});

test("backfill apply ejecuta acciones mediante el sincronizador transaccional", async () => {
  const db = memoryDb({
    "usuarios/alice": { email: "alice@example.test" },
    "usuarios/alice/years/2026": { horasAnuales: 1800, tipoJornada: 1 },
  });
  const stats = await processAdminYearSummaryBackfillPage({
    db,
    candidates: [{ userId: "alice", yearId: "2026" }],
    apply: true,
    serverTimestamp: () => "timestamp",
  });
  assert.equal(stats.updated, 1);
  assert.equal(db.writes, 1);
  assert.equal(db.documents.get(summaryPath("alice", 2026)).available, true);
});

test("procesa solo años legacy modificados y no consulta años de otros usuarios", async () => {
  assert.deepEqual(changedLegacyYears(
    { diasMarcados: { "2025-12-31": { tipo: "trabajado" } }, objetivosAnuales: { 2025: 1800 } },
    { diasMarcados: { "2025-12-31": { tipo: "trabajado" } }, objetivosAnuales: { 2026: 1800 } },
  ), ["2025", "2026"]);
  assert.deepEqual(changedLegacyYears(
    { email: "old@example.test" },
    { email: "new@example.test" },
  ), []);

  const db = memoryDb({
    "usuarios/alice": {
      objetivosAnuales: { 2026: 1800 },
      tipoJornadaPorAnio: { 2026: 1 },
      diasMarcados: { "2026-01-02": { tipo: "trabajado" } },
    },
  });
  const result = await syncAdminProfileLegacySummaries({
    db,
    userId: "alice",
    before: {},
    after: {
      objetivosAnuales: { 2026: 1800 },
      tipoJornadaPorAnio: { 2026: 1 },
      diasMarcados: { "2026-01-02": { tipo: "trabajado" } },
    },
    serverTimestamp: () => "timestamp",
  });
  assert.deepEqual(result.years, ["2026"]);
  assert.equal(db.documents.get(summaryPath("alice", 2026)).balanceHours, -1792);
  assert.equal(db.writes, 1);
});

test("un año guardado antes del perfil se materializa cuando se crea el perfil", async () => {
  const db = memoryDb({
    "usuarios/alice/years/2026": {
      horasAnuales: 1800,
      tipoJornada: 1,
      diasMarcados: { "2026-01-02": { tipo: "trabajado" } },
    },
  });

  assert.deepEqual(await syncAdminYearSummary({
    db,
    userId: "alice",
    yearId: "2026",
    serverTimestamp: () => "timestamp",
  }), { status: "absent" });
  db.documents.set("usuarios/alice", { email: "alice@example.test" });

  const result = await syncAdminProfileLegacySummaries({
    db,
    userId: "alice",
    before: {},
    after: { email: "alice@example.test" },
    existingYearIds: ["2026"],
    serverTimestamp: () => "timestamp",
  });
  assert.deepEqual(result.years, ["2026"]);
  assert.equal(db.documents.get(summaryPath("alice", 2026)).balanceHours, -1792);
});

test("un año guardado después del perfil se materializa con el trigger anual", async () => {
  const db = memoryDb({ "usuarios/alice": { email: "alice@example.test" } });
  const profileResult = await syncAdminProfileLegacySummaries({
    db,
    userId: "alice",
    before: {},
    after: { email: "alice@example.test" },
    existingYearIds: [],
    serverTimestamp: () => "timestamp",
  });
  assert.deepEqual(profileResult.years, []);

  db.documents.set("usuarios/alice/years/2026", {
    horasAnuales: 1800,
    tipoJornada: 1,
    diasMarcados: { "2026-01-02": { tipo: "trabajado" } },
  });
  const yearResult = await syncAdminYearSummary({
    db,
    userId: "alice",
    yearId: "2026",
    serverTimestamp: () => "timestamp",
  });
  assert.deepEqual(yearResult, { status: "updated" });
  assert.equal(db.documents.get(summaryPath("alice", 2026)).balanceHours, -1792);
});

test("la subcolección de resumen está explícitamente cerrada al cliente", () => {
  const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  assert.match(rules, /match \/resumenes\/{yearId}\s*\{\s*allow read, write: if false;/);
});
