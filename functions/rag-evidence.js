"use strict";

// Firestore devuelve distancia coseno: cuanto menor, mejor. Este valor es un
// guardarraíl conservador inicial, centralizado para poder calibrarlo con un
// conjunto de evaluación real antes de relajarlo. No convierte el top-k en
// evidencia por sí solo.
const CONVENIO_RAG_MAX_DISTANCE = 0.45;

function hasUsableText(chunk) {
  return Boolean(chunk && String(chunk.texto || "").trim());
}

function hasSemanticEvidence(chunk, maxDistance = CONVENIO_RAG_MAX_DISTANCE) {
  return hasUsableText(chunk) &&
    Number.isFinite(chunk.distancia) &&
    chunk.distancia <= maxDistance;
}

function hasKeywordEvidence(chunk) {
  return hasUsableText(chunk) && chunk.retrievalMethod === "keyword";
}

function evaluarEvidenciaConvenio(chunks, { maxDistance = CONVENIO_RAG_MAX_DISTANCE } = {}) {
  const specificChunks = (chunks || []).filter((chunk) =>
    chunk && chunk.doc_type === "especifico" && hasUsableText(chunk)
  );
  const relevantChunks = specificChunks.filter((chunk) =>
    hasSemanticEvidence(chunk, maxDistance) || hasKeywordEvidence(chunk)
  );

  return {
    suficiente: relevantChunks.length >= 1,
    reason: relevantChunks.length
      ? null
      : specificChunks.length
        ? "insufficient_rag_evidence"
        : "no_convenio",
    totalSpecificChunks: specificChunks.length,
    relevantChunks: relevantChunks.length,
    maxDistance,
  };
}

module.exports = {
  CONVENIO_RAG_MAX_DISTANCE,
  evaluarEvidenciaConvenio,
};
