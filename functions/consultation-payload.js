"use strict";

const { MAX_PREVIOUS_QUESTION_LENGTH, validarPreguntaAnterior } = require("./conversation-context");
const { isSupportedLaborLocation, isSupportedLaborSector, normalizeText } = require("./convenio-metadata");

const ALLOWED_FIELDS = [
  "pregunta", "preguntaAnterior", "ciudad", "ciudadActual", "location", "sector", "sectorUsuario",
  "profesion", "convenioFileName", "file_name", "fileName", "convenioNombre", "convenioId",
];
const OPTIONAL_FIELDS = ALLOWED_FIELDS.filter((field) => field !== "pregunta");
const MAX_CONTEXT_LENGTH = 240;

function tieneContentTypeJson(req) {
  return (req.get("content-type") || "").toLowerCase().includes("application/json");
}

function validarPayloadBasicoConsulta(req) {
  if (!tieneContentTypeJson(req)) {
    return { ok: false, status: 400, error: "La solicitud debe enviarse como application/json." };
  }
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "El cuerpo de la solicitud debe ser un objeto JSON." };
  }
  if (Object.keys(body).some((field) => !ALLOWED_FIELDS.includes(field))) {
    return { ok: false, status: 400, error: "La solicitud contiene campos no permitidos." };
  }
  if (OPTIONAL_FIELDS.some((field) => body[field] !== undefined && typeof body[field] !== "string")) {
    return { ok: false, status: 400, error: "Los datos de contexto deben ser texto." };
  }
  if (OPTIONAL_FIELDS.some((field) => field !== "preguntaAnterior" && body[field]?.length > MAX_CONTEXT_LENGTH)) {
    return { ok: false, status: 400, error: "Los datos de contexto son demasiado largos." };
  }
  if (["sector", "sectorUsuario", "profesion"].some((field) =>
    body[field] && normalizeText(body[field]) !== "general" && !isSupportedLaborSector(body[field])) ||
      ["ciudad", "ciudadActual", "location"].some((field) => body[field] && !isSupportedLaborLocation(body[field]))) {
    return { ok: false, status: 400, error: "El sector o territorio no está soportado." };
  }
  if (!validarPreguntaAnterior(body.preguntaAnterior)) {
    return { ok: false, status: 400, error: `La pregunta anterior no puede superar ${MAX_PREVIOUS_QUESTION_LENGTH} caracteres.` };
  }
  return { ok: true, body };
}

module.exports = { tieneContentTypeJson, validarPayloadBasicoConsulta };
