"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "js", "app", "ui.js"), "utf8");
const normalizedSource = source.replace(/\r\n/g, "\n");

const labels = [
  "Según tu convenio",
  "Información oficial actualizada",
  "Orientación general de IA",
  "Necesito concretar tu convenio",
];

for (const label of labels) {
  assert(source.includes(label), `Falta etiqueta de procedencia: ${label}`);
}
assert(source.includes("data.warning"), "La interfaz debe mostrar warning cuando el backend lo entregue");
assert(source.includes("const LIMITE_CONSULTAS_GRATIS = 50;"), "La UI debe usar 50 consultas gratuitas diarias");
assert(source.includes("200 consultas IA al día"), "La UI debe reflejar el límite Premium diario");
assert(source.includes("anadirProcedenciaRespuestaLegal(mensajeRespuesta, data);"), "La respuesta debe recibir procedencia y aviso");
assert(source.includes("preguntaAnterior: ultimaPreguntaLegal"), "La UI debe enviar solo la pregunta anterior");
assert(source.includes("pregunta.length <= LIMITE_PREGUNTA_ANTERIOR_IA"), "La UI debe limitar el historial");
assert(normalizedSource.includes("ultimaPreguntaLegal = \"\";\n  contextoLaboralSesion = null;\n  limpiarMensajesLegales();"), "La UI debe olvidar el contexto al abrir una sesión");
assert(source.includes("const contextoLaboral = contextoLaboralSesion || {"), "La UI debe reutilizar los datos configurados");
assert(source.includes("data.convenioDetectado.sectorKeys[0]"), "La UI debe conservar el convenio resuelto en la sesión");
assert(source.includes("contextoLaboralSesion = null;\n};") || normalizedSource.includes("contextoLaboralSesion = null;\n};"), "Cerrar el asesor debe limpiar el contexto de sesión");
assert(!source.includes('localStorage.getItem("convenioFileName")'), "No debe confiar en un convenio local sin validar");

console.log("OK  La UI muestra las cuatro procedencias, el aviso y las cuotas diarias.");
