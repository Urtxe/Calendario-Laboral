"use strict";

const GENERAL_LABOR_WARNING =
  "Esta es una orientación general y no está verificada en tu convenio; para una decisión concreta, contrástala con tu convenio, empresa o asesoramiento profesional.";

function construirRespuestaConsulta({
  respuesta,
  sourceType,
  grounded,
  warning = null,
  fallbackReason = null,
  fuentes = [],
  ...legacyFields
}) {
  return {
    respuesta,
    sourceType,
    grounded: Boolean(grounded),
    warning: warning || null,
    fallbackReason: fallbackReason || null,
    fuentes: Array.isArray(fuentes) ? fuentes : [],
    ...legacyFields,
  };
}

module.exports = {
  GENERAL_LABOR_WARNING,
  construirRespuestaConsulta,
};
