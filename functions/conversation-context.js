"use strict";

const { normalizeText } = require("./convenio-metadata");
const { classifyLaborIntent } = require("./intent-classifier");

const MAX_PREVIOUS_QUESTION_LENGTH = 300;

function validarPreguntaAnterior(value) {
  return value === undefined ||
    (typeof value === "string" && value.length <= MAX_PREVIOUS_QUESTION_LENGTH);
}

function prepararContextoConversacional(pregunta, preguntaAnterior = "") {
  const anterior = preguntaAnterior.trim();
  const actual = normalizeText(pregunta);
  // ponytail: cubrimos elipsis frecuentes de un turno; ampliar solo con casos evaluados.
  const esRepregunta = /^(?:y si (?:hago|trabajo|curro) (?:\d+|mas\b|menos\b)|(?:y )?(?:eso\b|(?:me )?(?:lo|la|los|las)\b)|son (?:naturales|laborables)\b)/.test(actual);
  const intencionActual = classifyLaborIntent({ pregunta });
  const intencionAnterior = anterior && classifyLaborIntent({ pregunta: anterior });

  if (!esRepregunta || !intencionAnterior || intencionAnterior.intent === "out_of_scope" ||
      intencionActual.reason === "non_labor_topic") {
    return { preguntaParaBusqueda: pregunta, preguntaAnterior: "" };
  }

  return { preguntaParaBusqueda: `${anterior} ${pregunta}`, preguntaAnterior: anterior };
}

module.exports = { MAX_PREVIOUS_QUESTION_LENGTH, prepararContextoConversacional, validarPreguntaAnterior };
