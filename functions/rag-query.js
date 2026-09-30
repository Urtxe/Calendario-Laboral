"use strict";

const { normalizeText } = require("./convenio-metadata");

const MAX_CONSULTA_RAG_LENGTH = 500;

function construirConsultaRag({ preguntaParaBusqueda, intent, sector = "", ciudad = "", territorio = "", convenio = "" }) {
  if (intent === "out_of_scope" || preguntaParaBusqueda.length >= MAX_CONSULTA_RAG_LENGTH) {
    return preguntaParaBusqueda;
  }

  const preguntaNormalizada = normalizeText(preguntaParaBusqueda);
  const tema = /\bhoras?\s+(?:extra\w*|extraordinari\w*|de mas)\b/.test(preguntaNormalizada) ||
      (/\bhoras?\b/.test(preguntaNormalizada) && /\b(?:mas|compensar\w*)\b/.test(preguntaNormalizada))
    ? "horas extra compensacion descanso"
    : /\bvacaciones\b/.test(preguntaNormalizada)
      ? "vacaciones dias naturales laborables"
      : /\b(?:jornada|horas?)\b/.test(preguntaNormalizada)
        ? "jornada anual duracion laboral"
        : "";

  const vistos = new Set(preguntaNormalizada.split(" "));
  let consultaRag = preguntaParaBusqueda;
  for (const fragmento of [tema, normalizeText(sector) === "general" ? "" : sector, ciudad, territorio, convenio]) {
    const palabras = normalizeText(fragmento).split(" ").filter((palabra) => palabra && !vistos.has(palabra));
    const nuevas = [...new Set(palabras)];
    if (!nuevas.length) continue;
    const agregado = ` ${nuevas.join(" ")}`;
    if (consultaRag.length + agregado.length > MAX_CONSULTA_RAG_LENGTH) break;
    consultaRag += agregado;
    nuevas.forEach((palabra) => vistos.add(palabra));
  }
  return consultaRag;
}

module.exports = { construirConsultaRag, MAX_CONSULTA_RAG_LENGTH };
