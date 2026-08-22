const { detectConvenioCriteria, normalizeText } = require("./convenio-metadata");

const LABOR_TERMS = [
  "vacaciones",
  "jornada",
  "horas",
  "hora",
  "convenio",
  "permiso",
  "permisos",
  "mudanza",
  "traslado de domicilio",
  "asuntos propios",
  "baja",
  "incapacidad",
  "salario",
  "smi",
  "nomina",
  "nómina",
  "contrato",
  "despido",
  "finiquito",
  "excedencia",
  "erte",
  "ere",
  "lactancia",
  "maternidad",
  "paternidad",
  "conciliacion",
  "conciliación",
  "festivos",
  "festivo",
  "calendario laboral",
  "plus",
  "nocturnidad",
  "antiguedad",
  "antigüedad",
  "cotizacion",
  "cotización",
  "jubilacion",
  "jubilación",
  "sepe",
  "seguridad social",
  "inspeccion de trabajo",
  "inspección de trabajo",
  "boda",
  "matrimonio",
  "trabajo",
  "empresa",
  "empleador",
  "pagar",
  "pago",
  "cobrar",
  "cobro",
  "turno",
  "turnos",
  "huelga",
];

const COLLECTIVE_TERMS = [
  "convenio",
  "vacaciones",
  "jornada",
  "horas",
  "permiso",
  "permisos",
  "mudanza",
  "traslado de domicilio",
  "asuntos propios",
  "plus",
  "nocturnidad",
  "festivos",
  "festivo",
  "calendario laboral",
  "boda",
  "matrimonio",
  "camarero",
  "camarera",
  "cocinero",
  "cocinera",
  "hotel",
  "hoteles",
  "alojamientos",
  "hosteleria",
  "hostelería",
];

const CURRENT_LABOR_TERMS = [
  "salario minimo",
  "salario mínimo",
  "smi",
  "bases de cotizacion",
  "bases de cotización",
  "base de cotizacion",
  "base de cotización",
  "edad de jubilacion",
  "edad de jubilación",
  "permiso parental",
  "reforma laboral",
  "normativa vigente",
  "vigente",
  "actual",
  "actualizado",
  "actualizada",
  "seguridad social",
  "sepe",
  "inspeccion de trabajo",
  "inspección de trabajo",
];

const GENERAL_LABOR_PATTERNS = [
  "que es",
  "qué es",
  "que significa",
  "qué significa",
  "diferencia entre",
  "en que consiste",
  "en qué consiste",
];

const GENERAL_LABOR_TERMS = [
  "despido objetivo",
  "despido disciplinario",
  "ere",
  "erte",
  "excedencia voluntaria",
  "antiguedad consolidada",
  "antigüedad consolidada",
  "finiquito",
  "contrato indefinido",
  "contrato temporal",
  "baja voluntaria",
];

const OUT_OF_SCOPE_TERMS = [
  "futbol",
  "fútbol",
  "mundial",
  "eurovision",
  "eurovisión",
  "pelicula",
  "película",
  "peliculas",
  "películas",
  "receta",
  "recetas",
  "famoso",
  "famosos",
  "viaje",
  "viajes",
  "apuesta",
  "apuestas",
  "videojuego",
  "videojuegos",
  "clima",
  "tiempo mañana",
  "restaurante",
  "restaurantes",
  "messi",
  "eurocopa",
  "champions",
  "laliga",
  "netflix",
  "cancion",
  "canción",
  "horoscopo",
  "horóscopo",
];

function includesAny(normalized, terms) {
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function hasQuestionPattern(normalized) {
  return includesAny(normalized, GENERAL_LABOR_PATTERNS);
}

function classifyLaborIntent({ pregunta, ciudad = "", sector = "" }) {
  const normalized = normalizeText(pregunta);
  const hasLabor = includesAny(normalized, LABOR_TERMS);
  const hasOutOfScope = includesAny(normalized, OUT_OF_SCOPE_TERMS);

  if (!normalized) {
    return {
      intent: "needs_clarification",
      reason: "empty_question",
      message: "Escribe una duda laboral o sobre tu convenio para poder ayudarte.",
    };
  }

  if (hasOutOfScope && hasLabor) {
    return {
      intent: "mixed_labor",
      reason: "out_of_scope_with_labor_signal",
    };
  }

  if (hasOutOfScope && !hasLabor) {
    return {
      intent: "out_of_scope",
      reason: "non_labor_topic",
    };
  }

  if (!hasLabor) {
    return {
      intent: "out_of_scope",
      reason: "no_labor_signal",
    };
  }

  if (includesAny(normalized, CURRENT_LABOR_TERMS)) {
    return {
      intent: "current_labor",
      reason: "current_or_official_labor_signal",
    };
  }

  if (normalized.includes("festivo") || normalized.includes("calendario laboral")) {
    return {
      intent: "current_labor",
      reason: "labor_calendar_signal",
    };
  }

  if (hasQuestionPattern(normalized) && includesAny(normalized, GENERAL_LABOR_TERMS)) {
    return {
      intent: "general_labor",
      reason: "labor_definition_signal",
    };
  }

  if (normalized.includes("que convenio") || normalized.includes("qué convenio")) {
    const criteria = detectConvenioCriteria({ pregunta, ciudad, sector });
    if (!criteria.provinces.length || !criteria.sectorKeys.length) {
      return {
        intent: "needs_clarification",
        reason: "missing_convenio_criteria",
        message: "Indícame tu trabajo o sector y tu provincia o ciudad para localizar el convenio correcto.",
      };
    }
  }

  if (includesAny(normalized, COLLECTIVE_TERMS)) {
    return {
      intent: "collective_agreement",
      reason: "collective_agreement_signal",
    };
  }

  return {
    intent: "general_labor",
    reason: "generic_labor_signal",
  };
}

module.exports = {
  classifyLaborIntent,
};
