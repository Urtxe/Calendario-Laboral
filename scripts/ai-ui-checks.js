"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "js", "app", "ui.js"), "utf8");

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

console.log("OK  La UI muestra las cuatro procedencias, el aviso y las cuotas diarias.");
