const { normalizeText } = require("./convenio-metadata");

const STATUTE_SOURCE_NAME = "Estatuto de los Trabajadores";

const STATUTE_RULES = [
  {
    id: "et_art_37_3_traslado_domicilio",
    article: "artículo 37.3",
    topic: "traslado de domicilio habitual",
    queryTerms: ["mudanza", "traslado de domicilio", "domicilio habitual"],
    exactTerms: ["traslado de domicilio", "domicilio habitual"],
    answer: "Como mínimo legal, tienes derecho a 1 día retribuido por traslado de domicilio habitual. Este permiso no consume vacaciones.",
  },
  {
    id: "et_art_37_3_matrimonio",
    article: "artículo 37.3",
    topic: "matrimonio",
    queryTerms: ["matrimonio", "casarme", "boda"],
    exactTerms: ["matrimonio"],
    answer: "Como mínimo legal, tienes derecho a 15 días naturales retribuidos por matrimonio.",
  },
  {
    id: "et_art_38_vacaciones",
    article: "artículo 38",
    topic: "vacaciones anuales",
    queryTerms: ["vacaciones", "dias de vacaciones", "días de vacaciones"],
    exactTerms: ["vacaciones"],
    answer: "Como mínimo legal, tienes derecho a 30 días naturales de vacaciones al año.",
  },
  {
    id: "et_nacimiento_cuidado_normativa_especifica",
    article: "normativa específica sobre nacimiento y cuidado",
    topic: "nacimiento y cuidado",
    queryTerms: ["nacimiento", "paternidad", "maternidad", "cuidado de menor", "cuidado del menor"],
    exactTerms: ["nacimiento", "cuidado"],
    answer: "No tengo una respuesta exacta en la fuente local mínima. Para nacimiento y cuidado hay que revisar la normativa específica aplicable.",
  },
];

function containsAny(normalizedText, terms) {
  return terms.some((term) => normalizedText.includes(normalizeText(term)));
}

function findWorkersStatuteFallback(question) {
  const normalizedQuestion = normalizeText(question);
  if (!normalizedQuestion) return null;

  return STATUTE_RULES.find((rule) => containsAny(normalizedQuestion, rule.queryTerms)) || null;
}

function buildWorkersStatuteFallbackResponse(rule, { convenioFileName = "" } = {}) {
  const prefix = convenioFileName
    ? "No he encontrado una mejora específica en el convenio recuperado. "
    : "No he encontrado un convenio aplicable con los datos de la pregunta. ";

  return `${prefix}${rule.answer}\n\nFuente: ${STATUTE_SOURCE_NAME}, ${rule.article}.`;
}

function buildWorkersStatuteSource(rule) {
  return {
    id: rule.id,
    fileName: STATUTE_SOURCE_NAME,
    file_name: STATUTE_SOURCE_NAME,
    convenioId: "estatuto_trabajadores",
    chunkIndex: null,
    doc_type: "base_local",
    fuente: "base",
    distancia: null,
  };
}

module.exports = {
  buildWorkersStatuteFallbackResponse,
  buildWorkersStatuteSource,
  findWorkersStatuteFallback,
};
