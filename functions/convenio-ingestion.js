"use strict";

const MAX_ATOMIC_CHUNKS = 499;
// Full official texts can exceed the former per-document ceiling. The unchanged monthly ceiling
// remains the aggregate spend guard; this per-source cap still rejects oversized inputs.
const MAX_EMBEDDING_TOKENS_PER_DOCUMENT = 100_000;
const MAX_EMBEDDING_TOKENS_PER_MONTH = 250_000;

function vectorValues(value) {
  if (value && typeof value.toArray === "function") return value.toArray();
  if (value && Array.isArray(value.values)) return value.values;
  return Array.isArray(value) ? value : null;
}

function omitUndefinedFields(value) {
  if (Array.isArray(value)) return value.map(omitUndefinedFields);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .map(([key, fieldValue]) => [key, omitUndefinedFields(fieldValue)]));
}

function validateChunkSet(docs, {
  fileName,
  sourceSha256,
  totalChunks,
  docType,
  embeddingModel,
  dimensions,
}) {
  if (!Array.isArray(docs) || docs.length !== totalChunks || docs.length > MAX_ATOMIC_CHUNKS) {
    throw new Error("INGESTION_CHUNK_SET_INCOMPLETE");
  }
  const indexes = new Set();
  for (const doc of docs) {
    const data = typeof doc.data === "function" ? doc.data() : doc;
    if ((data.file_name || data.fileName) !== fileName || data.sourceSha256 !== sourceSha256 || data.chunkTotal !== totalChunks ||
        ![`staged_${docType}`, docType].includes(data.doc_type) || !Number.isInteger(data.chunkIndex) ||
        data.chunkIndex < 0 || data.chunkIndex >= totalChunks || indexes.has(data.chunkIndex)) {
      throw new Error("INGESTION_CHUNK_SET_INCONSISTENT");
    }
    const vector = vectorValues(data.vector);
    if (!vector || vector.length !== dimensions || data.embeddingModel !== embeddingModel ||
        data.outputDimensionality !== dimensions || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("INGESTION_EMBEDDING_INVALID");
    }
    indexes.add(data.chunkIndex);
  }
  if (indexes.size !== totalChunks) throw new Error("INGESTION_CHUNK_SET_INCOMPLETE");
  return true;
}

async function activateChunkSet({
  db,
  refs,
  fileName,
  sourceSha256,
  totalChunks,
  docType,
  embeddingModel,
  dimensions,
  now = new Date(),
}) {
  if (refs.length > MAX_ATOMIC_CHUNKS) throw new Error("INGESTION_ATOMIC_LIMIT_EXCEEDED");
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    validateChunkSet(snapshots, { fileName, sourceSha256, totalChunks, docType, embeddingModel, dimensions });
    for (const ref of refs) {
      transaction.update(ref, { doc_type: docType, activatedAt: now });
    }
  });
  return { activatedChunks: refs.length };
}

async function reserveEmbeddingBudget(db, estimatedTokens, now = new Date()) {
  if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0 || estimatedTokens > MAX_EMBEDDING_TOKENS_PER_DOCUMENT) {
    throw new Error("INGESTION_DOCUMENT_BUDGET_EXCEEDED");
  }
  if (estimatedTokens === 0) return { estimatedTokens: 0, monthReservedTokens: null };
  const month = now.toISOString().slice(0, 7);
  const ref = db.collection("convenio_monitor_control").doc(`ingestion_budget_${month}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const reserved = snapshot.exists ? Number(snapshot.data().estimatedTokensReserved || 0) : 0;
    if (!Number.isSafeInteger(reserved) || reserved < 0 || reserved + estimatedTokens > MAX_EMBEDDING_TOKENS_PER_MONTH) {
      throw new Error("INGESTION_MONTHLY_BUDGET_EXCEEDED");
    }
    transaction.set(ref, {
      month,
      estimatedTokensReserved: reserved + estimatedTokens,
      updatedAt: now,
    }, { merge: true });
    return { estimatedTokens, monthReservedTokens: reserved + estimatedTokens };
  });
}

async function rollbackChunkSet({
  db,
  refs,
  catalogRef,
  fileName,
  sourceSha256,
  totalChunks,
  docType,
  embeddingModel,
  dimensions,
  now = new Date(),
}) {
  if (refs.length > MAX_ATOMIC_CHUNKS) throw new Error("INGESTION_ATOMIC_LIMIT_EXCEEDED");
  await db.runTransaction(async (transaction) => {
    const [catalogSnapshot, ...chunkSnapshots] = await Promise.all([
      transaction.get(catalogRef),
      ...refs.map((ref) => transaction.get(ref)),
    ]);
    if (!catalogSnapshot.exists || !catalogSnapshot.data().fileNames?.includes(fileName) ||
        chunkSnapshots.some((snapshot) => snapshot.data()?.doc_type !== docType)) {
      throw new Error("INGESTION_ROLLBACK_STATE_MISMATCH");
    }
    validateChunkSet(chunkSnapshots, { fileName, sourceSha256, totalChunks, docType, embeddingModel, dimensions });
    const catalog = catalogSnapshot.data();
    const remainingFiles = catalog.fileNames.filter((name) => name !== fileName);
    const remainingSources = (catalog.documentSources || []).filter((source) => source.fileName !== fileName);
    for (const ref of refs) transaction.update(ref, { doc_type: `staged_${docType}`, deactivatedAt: now });
    transaction.update(catalogRef, {
      fileNames: remainingFiles,
      documentSources: remainingSources,
      ...(remainingFiles.length ? {} : { active: false, catalogStatus: "inactive" }),
      updatedAt: now,
    });
  });
  return { deactivatedChunks: refs.length };
}

module.exports = {
  MAX_ATOMIC_CHUNKS,
  MAX_EMBEDDING_TOKENS_PER_DOCUMENT,
  MAX_EMBEDDING_TOKENS_PER_MONTH,
  vectorValues,
  omitUndefinedFields,
  validateChunkSet,
  activateChunkSet,
  reserveEmbeddingBudget,
  rollbackChunkSet,
};
