"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "js", "app", "ui.js"), "utf8");
const normalizedSource = source.replace(/\r\n/g, "\n");

const labels = [
  "Según tu convenio",
  "Información oficial actualizada",
  "Orientación general de IA",
  "Necesito concretar tu convenio",
  "Normativa laboral general consultada",
  "Información documental incompleta",
];

for (const label of labels) {
  assert(source.includes(label), `Falta etiqueta de procedencia: ${label}`);
}
assert(source.includes("data.warning"), "La interfaz debe mostrar warning cuando el backend lo entregue");
assert(source.includes("const LIMITE_CONSULTAS_GRATIS = 5;"), "La UI debe usar cinco consultas gratuitas por mes");
assert(source.includes('"Sin cuota mensual de consultas; uso personal, con protección antiabuso."'), "La UI debe describir el uso Premium ilimitado con protección antiabuso");
assert(!/consultas gratuitas (?:de hoy|diarias)|consultas IA al día/.test(source), "La UI no debe mostrar la antigua cuota diaria");
assert(source.includes('code === "free_monthly_quota_exceeded"'), "Solo el rechazo por cuota mensual agota la cuota en la UI");
assert(source.includes('code === "request_in_progress"') && source.includes('code === "rate_limited"'), "Los errores temporales 429 deben mostrarse por separado");
assert(!source.includes("setConsultasUsadas(getConsultasUsadas() + 1)"), "Los errores y aclaraciones no deben incrementar una cuota local estimada");
assert(source.includes("db.collection(\"usuarios\").doc(uid).collection(\"usage\").doc(\"ai\").get()"), "La cuota inicial debe sincronizarse desde el documento de uso del servidor");
assert(source.includes("Europe/Madrid"), "El mes de cuota debe seguir el calendario de Madrid");
assert(source.includes("anadirProcedenciaRespuestaLegal(mensajeRespuesta, data);"), "La respuesta debe recibir procedencia y aviso");
assert(source.includes("preguntaAnterior: ultimaPreguntaLegal"), "La UI debe enviar solo la pregunta anterior");
assert(source.includes("pregunta.length <= LIMITE_PREGUNTA_ANTERIOR_IA"), "La UI debe limitar el historial");
assert(normalizedSource.includes("ultimaPreguntaLegal = \"\";\n  contextoLaboralSesion = null;\n  limpiarMensajesLegales();"), "La UI debe olvidar el contexto al abrir una sesión");
assert(source.includes("const contextoLaboral = contextoLaboralSesion || {"), "La UI debe reutilizar los datos configurados");
assert(source.includes("data.convenioDetectado.sectorKeys[0]"), "La UI debe conservar el convenio resuelto en la sesión");
assert(source.includes("contextoLaboralSesion = null;\n};") || normalizedSource.includes("contextoLaboralSesion = null;\n};"), "Cerrar el asesor debe limpiar el contexto de sesión");
assert(!source.includes('localStorage.getItem("convenioFileName")'), "No debe confiar en un convenio local sin validar");

const quotaStart = source.indexOf("const LIMITE_CONSULTAS_GRATIS = 5;");
const quotaEnd = source.indexOf("function limpiarMensajesLegales()", quotaStart);
const quotaHarness = source.slice(quotaStart, quotaEnd) + `
  window.__quota = { getMesCuotaLegal, getAsesorLegalStorageKey, getConsultasUsadas,
    getConsultasRestantes, setConsultasUsadas, setCuotaLegalDesdeRespuesta,
    formatearResetCuotaLegal, getModoAsesorLegal };
`;
const storage = new Map([["balance_laboral_asesor_legal_alice_2026-10", JSON.stringify({ month: "2026-10", used: 4 })]]);
const quotaWindow = { usuarioActual: { uid: "alice" }, esPremium: false };
const quotaContext = {
  window: quotaWindow,
  localStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } },
  usuarioTieneSesion() { return !!quotaWindow.usuarioActual; },
  usuarioPuedeUsarPremium() { return quotaWindow.esPremium; },
  Date, Intl, Number, Math, Object, JSON,
};
vm.runInNewContext(quotaHarness, quotaContext, { filename: "ui-quota-functions.js" });
const quota = quotaWindow.__quota;
assert.strictEqual(quota.getMesCuotaLegal(new Date("2026-10-31T22:59:00.000Z")), "2026-10", "The Madrid calendar retains October before local midnight");
assert.strictEqual(quota.getMesCuotaLegal(new Date("2026-10-31T23:30:00.000Z")), "2026-11", "The Madrid calendar rolls over at local midnight");
assert.strictEqual(quota.getAsesorLegalStorageKey("2026-10"), "balance_laboral_asesor_legal_alice_2026-10");
assert.strictEqual(quota.getConsultasUsadas("2026-10"), 4);
assert.strictEqual(quota.getConsultasUsadas("2026-11"), 0, "A cached previous-month count cannot carry into the new month");
quota.setConsultasUsadas(5, "2026-11-01T00:00:00.000Z");
assert.strictEqual(quota.getConsultasRestantes(), 0);
assert.match(quota.formatearResetCuotaLegal(), /1 de noviembre/i);
assert.strictEqual(quota.setCuotaLegalDesdeRespuesta({ plan: "free", period: "month", used: 2, limit: 5, remaining: 3, resetAt: "2026-11-01T00:00:00.000Z" }), true);
assert.strictEqual(quota.getConsultasRestantes(), 3, "A server quota response refreshes the displayed count");
quotaWindow.esPremium = true;
assert.strictEqual(quota.getConsultasRestantes(), Infinity, "A Premium account has no monthly client quota");

console.log("OK  La UI muestra procedencia, errores y cuotas mensuales de Madrid.");
