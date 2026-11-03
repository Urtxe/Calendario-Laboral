"use strict";

// One-shot, read-only live validation. This deliberately avoids the authenticated
// HTTP handler because that path reserves and consumes production quota records.
require("dotenv").config({ path: __dirname + "/.env" });
const assert = require("node:assert/strict");
const { GoogleGenAI } = require("@google/genai");
const admin = require("firebase-admin");
const {
  applyKnownSourceVerificationOverrides,
  CATALOGO_CONVENIOS,
  detectConvenioCriteria,
  hasUnindexedSalaryEvidence,
  resolveCatalogEntry,
  resolveCatalogReference,
} = require("./convenio-metadata");
const { embedContent, generateContentWithRetry } = require("./gemini-client");

const PROJECT_ID = "calendario-laboral-252b1";
const MODEL = "gemini-3.5-flash-lite";
const EMBEDDING_MODEL = "gemini-embedding-001";
const DIMENSIONS = 768;
const LIMIT = 5;
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.API_KEY;

if (process.env.GEMINI_LIVE_TEST !== "1") throw new Error("Define GEMINI_LIVE_TEST=1 para ejecutar la prueba online.");
if (!API_KEY) throw new Error("No hay una clave Gemini disponible; no se muestra su valor.");
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const ai = new GoogleGenAI({ apiKey: API_KEY, httpOptions: { timeout: 20_000, retryOptions: { attempts: 1 } } });

async function loadCatalog() {
  const snapshot = await db.collection(CATALOGO_CONVENIOS).get();
  return snapshot.docs.map((doc) => applyKnownSourceVerificationOverrides({ id: doc.id, ...doc.data() }));
}

function resolve(catalog, question, city, sector, reference) {
  const criteria = detectConvenioCriteria({ pregunta: question, ciudad: city, sector });
  if (reference) return resolveCatalogReference(catalog, reference, criteria);
  const result = resolveCatalogEntry(catalog, criteria);
  return result.status === "resolved" ? result.entry : result;
}

async function retrieve(question, entry) {
  assert.equal(entry.sourceVerification, "verified", `Fuente no verificada: ${entry.id}`);
  const embeddedBatch = await embedContent(ai, EMBEDDING_MODEL, question, {
    taskType: "RETRIEVAL_QUERY", outputDimensionality: DIMENSIONS,
  });
  const embedded = embeddedBatch[0];
  assert.equal(embedded.length, DIMENSIONS);
  const chunks = [];
  for (const fileName of entry.fileNames || []) {
    const result = await db.collection("vectores_convenios")
      .where("doc_type", "==", "especifico")
      .where("file_name", "==", fileName)
      .findNearest({ vectorField: "vector", queryVector: embedded, distanceMeasure: "COSINE", limit: LIMIT, distanceResultField: "distancia" })
      .get();
    for (const doc of result.docs) chunks.push({ id: doc.id, ...doc.data() });
  }
  assert(chunks.length > 0, `Sin chunks para ${entry.id}`);
  assert(chunks.every((chunk) => (entry.fileNames || []).includes(chunk.file_name)), "Recuperación salió de los archivos del convenio resuelto.");
  return chunks.sort((a, b) => (a.distancia ?? 9) - (b.distancia ?? 9)).slice(0, LIMIT);
}

function contextFor(chunks) {
  return chunks.map((chunk) => `[Fuente: ${chunk.file_name}; página ${chunk.pageNumber || "s/d"}; chunk ${chunk.chunkIndex ?? chunk.id}]\n${chunk.texto}`).join("\n\n---\n\n");
}

async function ask({ question, chunks, thinkingLevel = "medium" }) {
  const started = Date.now();
  const makeRequest = (maxOutputTokens) => ({
    systemInstruction: [
      "Eres un asesor laboral. Usa exclusivamente los fragmentos y responde en español.",
      "Distingue fechas y periodos. No mezcles provincias ni convenios.",
      "No inventes derechos, importes ni artículos. Si falta evidencia suficiente, abstente explícitamente.",
      "Al final cita exactamente el nombre del documento usado. No cites documentos que no aparezcan en el contexto.",
      "Responde de forma breve y concreta.",
    ].join(" "),
    contents: [{ role: "user", parts: [{ text: `Pregunta: ${question}\n\nFragmentos recuperados:\n${contextFor(chunks)}` }] }],
    generationConfig: { maxOutputTokens, thinkingConfig: { thinkingLevel } },
  });
  const first = await generateContentWithRetry(ai, MODEL, makeRequest(3072));
  const firstUsage = first.usageMetadata || {};
  const retriedMaxTokens = first.candidates?.[0]?.finishReason === "MAX_TOKENS";
  const result = retriedMaxTokens ? await generateContentWithRetry(ai, MODEL, makeRequest(4096)) : first;
  const retryUsage = retriedMaxTokens ? result.usageMetadata || {} : {};
  const elapsedMs = Date.now() - started;
  const candidate = result.candidates?.[0];
  const responseText = typeof result.text === "string" ? result.text : "";
  const report = {
    thinkingLevel,
    finishReason: candidate?.finishReason || "UNKNOWN",
    inputTokens: (retriedMaxTokens ? firstUsage.promptTokenCount || 0 : 0) + (result.usageMetadata?.promptTokenCount || 0),
    outputTokens: (retriedMaxTokens ? firstUsage.candidatesTokenCount || 0 : 0) + (result.usageMetadata?.candidatesTokenCount || 0),
    thoughtTokens: (retriedMaxTokens ? firstUsage.thoughtsTokenCount || 0 : 0) + (result.usageMetadata?.thoughtsTokenCount || 0),
    retriedMaxTokens,
    latencyMs: elapsedMs,
    answer: responseText,
  };
  assert.equal(report.finishReason, "STOP", `Gemini terminó con ${report.finishReason}`);
  assert(responseText.trim(), "Gemini devolvió una respuesta vacía.");
  return report;
}

async function main() {
  assert.equal(process.env.GCLOUD_PROJECT || PROJECT_ID, PROJECT_ID, "Proyecto Firestore inesperado.");
  const catalog = await loadCatalog();
  const results = [];

  // Barcelona: 2025 is unverified locally; 2026 tables are a separate verified edition.
  const barcelona2025 = resolve(catalog, "convenio limpieza Barcelona 2025", "Barcelona", "limpieza");
  const barcelona2026 = resolve(catalog, "tablas salariales convenio limpieza Barcelona 2026", "Barcelona", "limpieza");
  assert.equal(barcelona2025.status, "source_unverified", `No se bloqueó 2025: ${barcelona2025.id || barcelona2025.status}`);
  assert.equal(barcelona2026.id, "limpieza_catalunya_barcelona_tablas_2026");
  assert.deepEqual(barcelona2026.fileNames, ["Acuerdo parcial Limpieza Cataluña 2026 tablas Barcelona Girona Lleida.pdf"]);
  const cleaningQuestion = "¿Qué periodo de aplicación cubren las tablas salariales de limpieza de edificios de Barcelona de 2026? No mezcles información de Tarragona.";
  const cleaningChunks = await retrieve(cleaningQuestion, barcelona2026);
  assert(cleaningChunks.every((chunk) => !/tarragona/i.test(chunk.file_name)));
  const levels = [];
  for (const level of ["minimal", "low", "medium"]) {
    const answer = await ask({ question: cleaningQuestion, chunks: cleaningChunks, thinkingLevel: level });
    assert.match(answer.answer, /01\/01\/2026|1\/01\/2026/i, `${level}: omitió el inicio del primer periodo.`);
    assert.match(answer.answer, /31\/08\/2026/i, `${level}: omitió el fin del primer periodo.`);
    assert.match(answer.answer, /01\/09\/2026/i, `${level}: omitió el inicio del segundo periodo.`);
    assert.match(answer.answer, /31\/12\/2026/i, `${level}: omitió el fin del segundo periodo.`);
    assert.match(answer.answer, /Acuerdo parcial Limpieza Cataluña 2026 tablas Barcelona Girona Lleida.pdf/i, `${level}: falta cita documental verificable.`);
    assert.doesNotMatch(answer.answer, /Tarragona/i, `${level}: mezcló otra provincia.`);
    levels.push(answer);
  }
  results.push({ test: "A-limpieza-barcelona", selected: barcelona2026.id, blocked2025: barcelona2025.status, sources: [...new Set(cleaningChunks.map((c) => c.file_name))], levels });

  // Málaga 2026 salaries must be stopped before Gemini because the tables are not indexed/verified.
  const malagaQuestion = "¿Cuáles son los salarios de hostelería en Málaga para 2026?";
  const malaga = resolve(catalog, malagaQuestion, "Málaga", "hosteleria");
  assert(malaga && malaga.status !== "source_unverified");
  assert.equal(hasUnindexedSalaryEvidence(malaga, malagaQuestion, 2026), true);
  const handler = require("node:fs").readFileSync(require("node:path").join(__dirname, "index.js"), "utf8");
  assert.match(handler, /fallbackReason: "unindexed_salary_source"[\s\S]*?fuentes: \[\],[\s\S]*?quotaConsumed: false/);
  results.push({ test: "B-hosteleria-malaga", result: "bloqueo determinista, sin llamada de generación ni importe afirmado", selected: malaga.id });

  // Navarra historic transport copy is explicitly unverified and must not enter retrieval.
  const navarraQuestion = "¿Qué jornada establece el convenio de transporte de Navarra?";
  const navarra = resolve(catalog, navarraQuestion, "Navarra", "transporte");
  assert.equal(navarra.status, "source_unverified");
  await assert.rejects(() => retrieve(navarraQuestion, navarra), /Fuente no verificada/);
  results.push({ test: "C-transporte-navarra", result: "fuente histórica excluida; no se consultaron chunks", status: navarra.status });

  // The UI stores the first resolved agreement and sends it on subsequent turns.
  const ui = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/js/app/ui.js"), "utf8");
  assert.match(ui, /contextoLaboralSesion = \{[\s\S]*?convenioFileName: data\.convenioUsado/);
  assert.match(ui, /contextoLaboral\.convenioFileName \? \{ convenioFileName: contextoLaboral\.convenioFileName \}/);
  const dialogQuestion = "Trabajo en hostelería en Málaga. ¿Qué convenio colectivo debo consultar?";
  const dialogEntry = resolve(catalog, dialogQuestion, "Málaga", "hosteleria");
  assert.equal(dialogEntry.id, "alojamientos_hosteleria_malaga_2018_2027");
  let session = { ciudad: "Málaga", sector: "hosteleria", convenioFileName: dialogEntry.fileNames[0] };
  const turns = [];
  for (const question of [
    dialogQuestion,
    "¿Cuántos días de vacaciones tengo?",
    "¿Cuál es la jornada anual?",
  ]) {
    const selected = resolve(catalog, question, session.ciudad, session.sector, session.convenioFileName);
    assert.equal(selected.id, dialogEntry.id, `Se perdió el convenio de sesión en: ${question}`);
    const chunks = await retrieve(question, selected);
    const answer = await ask({ question, chunks, thinkingLevel: "medium" });
    assert(chunks.some((chunk) => answer.answer.includes(chunk.file_name)), "Falta cita en el turno conversacional.");
    assert(chunks.every((chunk) => selected.fileNames.includes(chunk.file_name)));
    if (/vacaciones/i.test(question)) assert.match(answer.answer, /30 días naturales/i);
    if (/jornada anual/i.test(question)) assert.match(answer.answer, /1\.800 horas anuales/i);
    turns.push({ question, selected: selected.id, sources: [...new Set(chunks.map((c) => c.file_name))], ...answer });
  }
  results.push({ test: "D-conversacion-tres-turnos", turns });
  const generations = [
    ...levels,
    ...turns,
  ];
  const inputTokens = generations.reduce((sum, item) => sum + item.inputTokens, 0);
  const outputTokens = generations.reduce((sum, item) => sum + item.outputTokens + item.thoughtTokens, 0);
  const estimatedGenerationCostUSD = inputTokens * 0.30 / 1_000_000 + outputTokens * 2.50 / 1_000_000;
  console.log(JSON.stringify({ project: PROJECT_ID, model: MODEL, embeddingModel: EMBEDDING_MODEL, dimensions: DIMENSIONS, readOnlyFirestore: true, httpAuthQuotaFlow: "no ejecutado: evita escrituras de cuota en producción", tokenTotals: { inputTokens, outputTokensIncludingThinking: outputTokens }, estimatedGenerationCostUSD, estimatedEmbeddingCostUpperBoundUSD: 0.00015, results }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(`Live RAG validation failed: ${error.message}`);
  process.exit(1);
});
