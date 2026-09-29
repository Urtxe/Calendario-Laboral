"use strict";

const { FieldValue } = require("firebase-admin/firestore");
const { PROJECT_ID, CITIES, collect, normalize, compare } = require("./holidays-dry-run");

const AUTHORITIES = new Set(["definitive", "official_municipal"]);

function evaluate(row, stored, year) {
  if (!CITIES.includes(row.city) || row.year !== year || !Number.isInteger(year) || year < 2026) throw new Error("Ciudad o año inesperado");
  if (!Array.isArray(row.dates)) throw new Error("Fechas de origen ausentes");
  const normalized = normalize(row.dates, year);
  if (normalized.length !== row.dates.length || JSON.stringify(normalized) !== JSON.stringify(row.dates)) throw new Error("Fechas de origen sin normalizar, duplicadas o desordenadas");
  const publicable = row.status === "complete" && AUTHORITIES.has(row.sourceAuthority);
  if (row.status !== "complete") return { action: ["partial", "pending", "unsupported", "error"].includes(row.status) ? row.status : "error", publicable: false };
  if (row.dates.length !== 14 || !Array.isArray(row.sources) || row.sources.length < 2 || row.sources.some(url => { try { return new URL(url).protocol !== "https:"; } catch { return true; } })) throw new Error("Calendario completo sin 14 fechas o fuentes oficiales identificables");
  if (!publicable) return { action: "not_publicable", publicable: false };
  if (stored !== null && (!Array.isArray(stored?.fechas) || new Set(stored.fechas).size !== stored.fechas.length)) return { action: "error", publicable: true, comparison: { result: "ERROR", reason: "Firestore: fechas ausentes o duplicadas" } };
  const comparison = compare(row, stored, year);
  if (comparison.result === "ERROR") return { action: "error", publicable: true, comparison };
  if (stored === null) return { action: "created", publicable: true, comparison };
  return { action: comparison.result === "MATCH" ? "unchanged" : "conflict", publicable: true, comparison };
}

function trace(row, decision, timestamp) {
  return {
    city: row.city,
    year: row.year,
    status: row.status,
    publicable: decision.publicable,
    lastCheckedAt: timestamp,
    ...(row.status === "complete" || row.status === "partial" ? { lastSuccessfulExtractionAt: timestamp } : {}),
    sources: row.sources || [],
    sourceAuthority: row.sourceAuthority || "pending",
    dateCount: row.dates.length,
    publicationResult: decision.action,
    ...(decision.action === "error" ? { errorCode: row.status === "error" ? "SOURCE_ERROR" : "VALIDATION_ERROR" } : {}),
    ...(decision.action === "conflict" ? { missingInFirestore: decision.comparison.missingInFirestore, extraInFirestore: decision.comparison.extraInFirestore } : {}),
  };
}

async function synchronize(year, db, { write = false, rows = null, timestamp = FieldValue.serverTimestamp() } = {}) {
  const sources = rows || await collect(year);
  const seen = new Set();
  const results = [];
  for (const row of sources) {
    if (seen.has(row.city)) throw new Error(`Ciudad duplicada: ${row.city}`);
    seen.add(row.city);
    try {
      const holidayRef = db.doc(`festivos_oficiales/${row.city}/años/${year}`);
      const traceRef = db.doc(`festivos_sync/${row.city}_${year}`);
      const snapshot = await holidayRef.get();
      let decision = evaluate(row, snapshot.exists ? snapshot.data() : null, year);
      if (write) {
        if (decision.action === "created") {
          const batch = db.batch();
          batch.create(holidayRef, { fechas: row.dates });
          batch.set(traceRef, trace(row, decision, timestamp));
          try { await batch.commit(); }
          catch (error) {
            if (error.code !== 6 && error.code !== "already-exists") throw error;
            const current = await holidayRef.get();
            decision = evaluate(row, current.exists ? current.data() : null, year);
            if (decision.action === "created") throw error;
            await traceRef.set(trace(row, decision, timestamp));
          }
        } else await traceRef.set(trace(row, decision, timestamp));
      }
      results.push({ city: row.city, year, status: row.status, publicable: decision.publicable, action: write ? decision.action : `WOULD_${decision.action === "created" ? "CREATE" : decision.action === "unchanged" ? "SKIP" : decision.action === "conflict" ? "CONFLICT" : "NOT_PUBLISH"}`, dateCount: row.dates.length, sources: row.sources, ...(decision.comparison?.result === "DIFFERENT" && snapshot.exists ? { missingInFirestore: decision.comparison.missingInFirestore, extraInFirestore: decision.comparison.extraInFirestore } : {}) });
    } catch (error) {
      results.push({ city: row.city, year, status: "error", publicable: false, action: write ? "error" : "WOULD_NOT_PUBLISH", dateCount: row.dates?.length || 0, sources: row.sources || [], error: error.message });
    }
  }
  return results;
}

async function main() {
  const mode = process.argv[2];
  const year = Number(process.argv[3]);
  if (!["preview", "sync"].includes(mode) || year !== 2027) throw new Error("Uso: node holidays-publish.js preview|sync 2027");
  for (const active of [process.env.GCLOUD_PROJECT, process.env.GCP_PROJECT, process.env.FIREBASE_PROJECT_ID, process.env.FIREBASE_CONFIG && JSON.parse(process.env.FIREBASE_CONFIG).projectId]) {
    if (active && active !== PROJECT_ID) throw new Error(`Proyecto activo distinto de ${PROJECT_ID}`);
  }
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();
  const rows = await collect(year);
  const preview = await synchronize(year, db, { rows });
  if (preview.length !== CITIES.length) throw new Error("El extractor no devolvió las diez ciudades soportadas");
  console.log(JSON.stringify({ projectId: PROJECT_ID, year, mode: "preview", results: preview }, null, 2));
  if (mode === "sync") {
    const result = await synchronize(year, db, { write: true, rows });
    console.log(JSON.stringify({ projectId: PROJECT_ID, year, mode: "sync", results: result }, null, 2));
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { evaluate, trace, synchronize };
