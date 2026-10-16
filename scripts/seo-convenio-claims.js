"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CLAIMS_PATH = path.join(__dirname, "../seo/data/convenios.claims.json");
const STATUSES = new Set(["verificada", "pendiente", "contradictoria"]);
const OFFICIAL_HOSTS = new Set(["egoitza.gipuzkoa.eus", "dogc.gencat.cat", "portaldogc.gencat.cat", "contractaciopublica.cat"]);

function officialUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !OFFICIAL_HOSTS.has(url.hostname)) return false;
    if (url.hostname === "egoitza.gipuzkoa.eus") return url.pathname.startsWith("/gao-bog/") && url.pathname.endsWith(".pdf");
    if (url.hostname === "dogc.gencat.cat") return url.pathname.includes("/document-del-dogc/") && url.searchParams.has("documentId");
    if (url.hostname === "portaldogc.gencat.cat") return url.pathname.endsWith("/PdfProviderServlet") && (url.searchParams.has("documentId") || url.searchParams.has("versionId"));
    return url.pathname.startsWith("/portal-api/descarrega-document/");
  } catch {
    return false;
  }
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateClaims(data) {
  if (data.version !== 1 || !data.convenios || typeof data.convenios !== "object") throw new Error("Catálogo de afirmaciones inválido");
  for (const [slug, claims] of Object.entries(data.convenios)) {
    if (!Array.isArray(claims)) throw new Error(`Afirmaciones inválidas: ${slug}`);
    const ids = new Set();
    for (const claim of claims) {
      if (!claim.id || ids.has(claim.id) || !claim.materia || !claim.texto || !STATUSES.has(claim.estado) ||
          !claim.documentoOficial || !claim.ambito || !("referencia" in claim) || !claim.periodoEfectos || !claim.procedencia) {
        throw new Error(`Esquema incompleto: ${slug}/${claim.id || "sin-id"}`);
      }
      ids.add(claim.id);
      if (claim.estado === "verificada" && (!claim.documentoOficial.identificador || !claim.documentoOficial.titulo ||
          !officialUrl(claim.documentoOficial.url) || !validDate(claim.documentoOficial.fechaPublicacion) ||
          !claim.ambito.funcional || !claim.ambito.territorial || !claim.referencia ||
          !claim.periodoEfectos.descripcion ||
          (claim.periodoEfectos.desde && !validDate(claim.periodoEfectos.desde)) ||
          (claim.periodoEfectos.hasta && !validDate(claim.periodoEfectos.hasta)) ||
          (claim.periodoEfectos.desde && claim.periodoEfectos.hasta && claim.periodoEfectos.desde > claim.periodoEfectos.hasta) ||
          claim.procedencia.tipo !== "cotejo_manual" ||
          !claim.procedencia.evidencia || typeof claim.evidenciaTextual !== "string" || !claim.evidenciaTextual.trim())) {
        throw new Error(`Afirmación sin evidencia oficial completa: ${slug}/${claim.id}`);
      }
      if (claim.correccionOficial && (!claim.correccionOficial.identificador || !claim.correccionOficial.titulo ||
          !officialUrl(claim.correccionOficial.url) || !validDate(claim.correccionOficial.fechaPublicacion) ||
          !claim.correccionOficial.referencia)) {
        throw new Error(`Corrección oficial incompleta: ${slug}/${claim.id}`);
      }
    }
  }
  return data;
}

function publishableClaims(claims) {
  const blocked = new Set(claims.filter((claim) => claim.estado === "contradictoria").map((claim) => claim.materia));
  const seen = new Set();
  return claims.filter((claim) => {
    if (claim.estado !== "verificada" || blocked.has(claim.materia)) return false;
    if (seen.has(claim.materia)) throw new Error(`Afirmaciones verificadas duplicadas: ${claim.materia}`);
    seen.add(claim.materia);
    return true;
  });
}

function loadClaims() {
  return validateClaims(JSON.parse(fs.readFileSync(CLAIMS_PATH, "utf8")));
}

module.exports = { loadClaims, validateClaims, publishableClaims, officialUrl };
