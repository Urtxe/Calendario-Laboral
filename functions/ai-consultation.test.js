"use strict";

const assert = require("assert");
const { construirRespuestaConsulta, GENERAL_LABOR_WARNING } = require("./consultation-contract");
const { CONVENIO_RAG_MAX_DISTANCE, evaluarEvidenciaConvenio } = require("./rag-evidence");
const { FREE_AI_DAILY_LIMIT, PREMIUM_AI_DAILY_LIMIT, limiteDiarioIA } = require("./quota-policy");
const {
  AI_QUOTA_RESERVATION_TTL_MS,
  isReservationExpired,
  liquidarEstadoReserva,
  resumirReservasCaducadas,
} = require("./quota-reservation-policy");
const { isEnabled: isOfficialWebFallbackEnabled } = require("./official-web-fallback");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("evidencia semántica suficiente permite respuesta de convenio", () => {
  const result = evaluarEvidenciaConvenio([{
    doc_type: "especifico",
    texto: "Artículo 12. Vacaciones.",
    distancia: CONVENIO_RAG_MAX_DISTANCE - 0.01,
    retrievalMethod: "vector",
  }]);
  assert.strictEqual(result.suficiente, true);
  assert.strictEqual(result.reason, null);
});

test("fragmentos lejanos no se presentan como evidencia de convenio", () => {
  const result = evaluarEvidenciaConvenio([{
    doc_type: "especifico",
    texto: "Artículo sin relación.",
    distancia: CONVENIO_RAG_MAX_DISTANCE + 0.01,
    retrievalMethod: "vector",
  }]);
  assert.strictEqual(result.suficiente, false);
  assert.strictEqual(result.reason, "insufficient_rag_evidence");
});

test("coincidencia keyword explícita cuenta como evidencia trazable", () => {
  const result = evaluarEvidenciaConvenio([{
    doc_type: "especifico",
    texto: "Permisos y licencias: traslado de domicilio.",
    retrievalMethod: "keyword",
  }]);
  assert.strictEqual(result.suficiente, true);
});

test("contrato homogéneo incluye procedencia, evidencia, aviso y fallback", () => {
  const result = construirRespuestaConsulta({
    respuesta: "Orientación.",
    sourceType: "general_ai",
    grounded: false,
    warning: GENERAL_LABOR_WARNING,
    fallbackReason: "insufficient_rag_evidence",
  });
  assert.deepStrictEqual(
    Object.keys(result).slice(0, 6),
    ["respuesta", "sourceType", "grounded", "warning", "fallbackReason", "fuentes"],
  );
  assert.strictEqual(result.fuentes.length, 0);
  assert.strictEqual(result.warning, GENERAL_LABOR_WARNING);
});

test("cuotas diarias son 50 Free y 200 Premium", () => {
  assert.strictEqual(FREE_AI_DAILY_LIMIT, 50);
  assert.strictEqual(PREMIUM_AI_DAILY_LIMIT, 200);
  assert.strictEqual(limiteDiarioIA(false), 50);
  assert.strictEqual(limiteDiarioIA(true), 200);
});

test("fallback oficial está activo por defecto y admite apagado de emergencia", () => {
  assert.strictEqual(isOfficialWebFallbackEnabled({}), true);
  assert.strictEqual(isOfficialWebFallbackEnabled({ ENABLE_WEB_FALLBACK: "false" }), false);
  assert.strictEqual(isOfficialWebFallbackEnabled({ ENABLE_WEB_FALLBACK: "true" }), true);
});

test("una reserva pendiente caducada deja de contar para la cuota", () => {
  const nowMs = 1_000_000;
  const result = resumirReservasCaducadas([
    {
      state: "reserved",
      plan: "free",
      dayKey: "2026-08-23",
      expiresAt: new Date(nowMs - 1),
    },
  ], { today: "2026-08-23", nowMs });

  assert.strictEqual(isReservationExpired(result.expiredReservations[0], nowMs), true);
  assert.strictEqual(result.expiredByPlan.free, 1);
  assert.strictEqual(50 - result.expiredByPlan.free < FREE_AI_DAILY_LIMIT, true);
});

test("una caída simulada entre reserva y liquidación se recupera al expirar", () => {
  const nowMs = 2_000_000;
  const result = resumirReservasCaducadas([
    {
      state: "reserved",
      plan: "premium",
      dayKey: "2026-08-23",
      expiresAt: new Date(nowMs - 1),
    },
  ], { today: "2026-08-23", nowMs });

  const usedAfterRecovery = 200 - result.expiredByPlan.premium;
  assert.strictEqual(usedAfterRecovery, 199);
  assert.strictEqual(usedAfterRecovery < PREMIUM_AI_DAILY_LIMIT, true);
  assert.strictEqual(AI_QUOTA_RESERVATION_TTL_MS, 5 * 60 * 1000);
});

test("liquidar o devolver dos veces la misma reserva no cambia dos veces", () => {
  const firstConsume = liquidarEstadoReserva("reserved", true);
  const secondConsume = liquidarEstadoReserva(firstConsume.state, true);
  const firstRefund = liquidarEstadoReserva("reserved", false);
  const secondRefund = liquidarEstadoReserva(firstRefund.state, false);

  assert.deepStrictEqual(firstConsume, { changed: true, state: "consumed" });
  assert.strictEqual(secondConsume.changed, false);
  assert.deepStrictEqual(firstRefund, { changed: true, state: "refunded" });
  assert.strictEqual(secondRefund.changed, false);
});

let failures = 0;
for (const item of tests) {
  try {
    item.fn();
    console.log(`OK  ${item.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${item.name}`);
    console.error(`     ${error.message}`);
  }
}

if (failures) process.exit(1);
console.log(`\n${tests.length} comprobaciones de consulta IA pasaron.`);
