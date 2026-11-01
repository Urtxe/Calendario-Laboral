"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dateKeyInYear,
  formatPersonalLaborContext,
  isPersonalLaborQuestion,
  loadPersonalYearContext,
  mergeYearData,
  normalizeYear,
  resolvePersonalYear,
  summarizePersonalYear,
  wantsOvertimeDetails,
  wantsVacationDetails,
} = require("./personal-labor-context");

function memoryDb(entries) {
  const reads = [];
  const reference = (path) => ({
    path,
    collection(name) { return reference(`${path}/${name}`); },
    doc(id) { return reference(`${path}/${id}`); },
  });
  return {
    reads,
    collection: (name) => reference(name),
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          reads.push(ref.path);
          const exists = Object.hasOwn(entries, ref.path);
          return { exists, data: () => entries[ref.path] };
        },
      });
    },
  };
}

test("detecta preguntas personales de jornada sin ampliar consultas genéricas", () => {
  assert.equal(isPersonalLaborQuestion("¿Cuántos días debería trabajar este año?"), true);
  assert.equal(isPersonalLaborQuestion("Con lo que he apuntado, ¿cuántas horas me faltan?"), true);
  assert.equal(isPersonalLaborQuestion("¿Cuántas horas extra tengo y cuáles están compensadas?"), true);
  assert.equal(isPersonalLaborQuestion("¿Qué vacaciones reconoce el convenio?"), false);
  assert.equal(wantsOvertimeDetails("¿Cuántas horas extra he anotado?"), true);
  assert.equal(isPersonalLaborQuestion("¿Cuántos días de vacaciones tengo apuntados?"), true);
  assert.equal(wantsVacationDetails("¿Cuántos días de vacaciones tengo apuntados?"), true);
});

test("valida año y fecha real, y solo une datos del año solicitado", () => {
  assert.equal(normalizeYear("2026", 2025), 2026);
  assert.equal(normalizeYear("../../usuarios/otro", 2025), 2025);
  assert.equal(resolvePersonalYear("¿Cuántos días me faltan en 2025?", 2026), 2025);
  assert.equal(resolvePersonalYear("Compara mi balance de 2025 y 2026", 2026), null);
  assert.equal(dateKeyInYear("2026-02-28", 2026), true);
  assert.equal(dateKeyInYear("2026-02-30", 2026), false);
  assert.equal(dateKeyInYear("2025-12-31", 2026), false);
  const merged = mergeYearData({
    objetivosAnuales: { 2026: 1800 },
    tipoJornadaPorAnio: { 2026: 0.5 },
    diasMarcados: { "2026-01-01": { tipo: "trabajado" }, "2025-12-31": { tipo: "trabajado" } },
  }, {
    horasAnuales: 1750,
    diasMarcados: { "2026-01-01": { tipo: "baja" } },
  }, 2026);
  assert.equal(merged.horasAnuales, 1750);
  assert.equal(merged.tipoJornada, 0.5);
  assert.deepEqual(merged.diasMarcados, { "2026-01-01": { tipo: "baja" } });
});

test("calcula balance del año según la app y separa lo registrado de la planificación futura", () => {
  const summary = summarizePersonalYear({
    horasAnuales: 1800,
    tipoJornada: 0.5,
    diasMarcados: {
      "2026-01-02": { tipo: "trabajado" },
      "2026-01-03": { tipo: "baja" },
      "2026-01-04": { tipo: "trabajado", esFestivo: true },
      "2026-12-20": { tipo: "trabajado" },
      "2026-12-21": { tipo: "trabajado", esFestivo: true },
      "2026-02-30": { tipo: "trabajado" },
      "2025-12-31": { tipo: "trabajado" },
      "2026-01-05": { tipo: "vacaciones" },
      "2026-01-06": { tipo: "vacaciones" },
      "2026-12-22": { tipo: "vacaciones" },
    },
  }, 2026, "2026-06-01");
  assert.equal(summary.available, true);
  assert.equal(summary.annualTargetHours, 900);
  assert.equal(summary.hoursPerTypicalDay, 4);
  assert.equal(summary.computedDaysToDate, 3);
  assert.equal(summary.computedHoursToDate, 12);
  assert.equal(summary.holidayDaysToDate, 1);
  assert.equal(summary.balanceHoursToDate, -886);
  assert.equal(summary.equivalentFullDaysRemaining, 221.5);
  assert.equal(summary.remainingHoursAfterKnownPlans, 876);
  assert.equal(summary.equivalentUnmarkedDaysAfterKnownPlans, 219);
  assert.equal(summary.futurePlannedDays, 2);
  assert.equal(summary.futurePlannedHolidayDays, 1);
  assert.equal(summary.appBalanceHoursIncludingFuturePlans, -876);

  const text = formatPersonalLaborContext(summary);
  assert.match(text, /Balance que muestra actualmente.*-876 horas/);
  assert.doesNotMatch(text, /2026-01-02|2026-01-03|\bbaja\b|\bemail\b|\buid\b/i);

  const vacationSummary = summarizePersonalYear({
    horasAnuales: 1800,
    tipoJornada: 1,
    diasMarcados: {
      "2026-01-05": { tipo: "vacaciones" },
      "2026-12-22": { tipo: "vacaciones" },
      "2026-01-06": { tipo: "baja" },
    },
  }, 2026, "2026-06-01", { includeVacations: true });
  assert.equal(vacationSummary.vacationDaysRecordedToDate, 1);
  assert.equal(vacationSummary.futureVacationDaysMarked, 1);
  assert.match(formatPersonalLaborContext(vacationSummary), /no indica el saldo de vacaciones disponible/);
});

test("no inventa objetivo o jornada y mantiene las horas extra separadas", () => {
  assert.deepEqual(summarizePersonalYear({ horasAnuales: 1800 }, 2026), {
    available: false,
    reason: "missing_annual_setup",
  });
  const summary = summarizePersonalYear({
    horasAnuales: 1800,
    tipoJornada: 1,
    horasExtraPorDia: { "2026-01-02": 2, "2026-01-03": 4, "2025-12-31": 99, "2026-01-04": 25 },
    horasExtraCompensadas: { "2026-01": true, "2026-02": false, "2026-13": true },
  }, 2026, "2026-06-01", { includeOvertime: true });
  assert.equal(summary.overtimeHoursEntered, 6);
  assert.equal(summary.monthsMarkedOvertimeCompensated, 1);
  assert.match(summary.overtimeNote, /sin vincular horas concretas/);
});

test("lee solo el uid autenticado y el año pedido; rechaza barrera de borrado", async () => {
  const db = memoryDb({
    "usuarios/alice": { email: "alice@example.test", objetivosAnuales: { 2026: 1800 }, tipoJornadaPorAnio: { 2026: 1 } },
    "usuarios/alice/years/2026": { diasMarcados: { "2026-01-02": { tipo: "trabajado" } } },
    "usuarios/bob": { objetivosAnuales: { 2026: 2000 }, tipoJornadaPorAnio: { 2026: 1 } },
    "accountDeletions/deleted": { accountDeleted: true },
  });
  const ownContext = await loadPersonalYearContext(db, "alice", 2026, "2026-06-01");
  assert.equal(ownContext.available, true);
  assert.equal(ownContext.computedDaysToDate, 1);
  assert.deepEqual(db.reads.sort(), [
    "accountDeletions/alice",
    "usuarios/alice",
    "usuarios/alice/years/2026",
  ].sort());

  const deletedContext = await loadPersonalYearContext(db, "deleted", 2026, "2026-06-01");
  assert.deepEqual(deletedContext, { available: false, reason: "account_unavailable" });
  assert.equal(db.reads.includes("usuarios/bob"), false);
});
