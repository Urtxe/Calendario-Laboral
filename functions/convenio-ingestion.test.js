"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertOfficialHttpsUrl,
  verifyPdfBytes,
  downloadOfficialPdf,
  storeOfficialPdf,
  classifyOfficialDocument,
} = require("./official-convenio-document");
const {
  activateChunkSet,
  validateChunkSet,
  omitUndefinedFields,
  reserveEmbeddingBudget,
  rollbackChunkSet,
  MAX_EMBEDDING_TOKENS_PER_DOCUMENT,
  MAX_EMBEDDING_TOKENS_PER_MONTH,
} = require("./convenio-ingestion");

function pdfBytes() {
  return Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(600, 0x20), Buffer.from("\n%%EOF\n")]);
}

function chunk(index, overrides = {}) {
  return {
    file_name: "source.pdf",
    fileName: "source.pdf",
    sourceSha256: "a".repeat(64),
    chunkTotal: 2,
    chunkIndex: index,
    doc_type: "staged_especifico",
    vector: { toArray: () => Array(768).fill(0.25) },
    embeddingModel: "gemini-embedding-001",
    outputDimensionality: 768,
    ...overrides,
  };
}

function fakeDb(initial) {
  const records = new Map(Object.entries(initial));
  let tail = Promise.resolve();
  return {
    records,
    collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction(callback) {
      const operation = tail.then(async () => {
        const pending = new Map();
        const tx = {
          async get(ref) {
            const data = records.get(ref.id);
            return { exists: Boolean(data), data: () => data };
          },
          update(ref, value) {
            pending.set(ref.id, { ...records.get(ref.id), ...value });
          },
          set(ref, value, options = {}) {
            const current = options.merge ? records.get(ref.id) || {} : {};
            pending.set(ref.id, { ...current, ...value });
          },
        };
        const result = await callback(tx);
        for (const [id, value] of pending) records.set(id, value);
        return result;
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}

function activationArgs(db) {
  return {
    db,
    refs: [{ id: "chunk-0" }, { id: "chunk-1" }],
    fileName: "source.pdf",
    sourceSha256: "a".repeat(64),
    totalChunks: 2,
    docType: "especifico",
    embeddingModel: "gemini-embedding-001",
    dimensions: 768,
    now: new Date("2026-10-14T12:00:00Z"),
  };
}

test("omits undefined catalog fields without changing dates or SDK value objects", () => {
  class SdkValue { constructor(value) { this.value = value; } }
  const sdkValue = new SdkValue("server timestamp sentinel");
  const result = omitUndefinedFields({
    present: "ok",
    absent: undefined,
    nested: [{ retained: 1, missing: undefined }],
    date: new Date("2026-01-01T00:00:00Z"),
    sdkValue,
  });
  assert.deepEqual(result, {
    present: "ok",
    nested: [{ retained: 1 }],
    date: new Date("2026-01-01T00:00:00Z"),
    sdkValue,
  });
  assert.equal(result.sdkValue, sdkValue);
});

test("accepts only HTTPS URLs on the exact official host allowlist", () => {
  assert.equal(assertOfficialHttpsUrl("https://bop.diba.cat/doc.pdf", ["bop.diba.cat"]).hostname, "bop.diba.cat");
  for (const url of ["http://bop.diba.cat/doc.pdf", "https://evil.example/doc.pdf", "https://user@bop.diba.cat/doc.pdf"]) {
    assert.throws(() => assertOfficialHttpsUrl(url, ["bop.diba.cat"]), /OFFICIAL_SOURCE/);
  }
});

test("validates PDF framing and hashes exact bytes", () => {
  const result = verifyPdfBytes(pdfBytes());
  assert.equal(result.sizeBytes, pdfBytes().length);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => verifyPdfBytes(Buffer.from("<html>")), /OFFICIAL_PDF_INVALID/);
  assert.throws(() => verifyPdfBytes(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(600)])), /OFFICIAL_PDF_INVALID/);
  assert.throws(() => verifyPdfBytes(pdfBytes(), 512), /OFFICIAL_PDF_INVALID/);
});

test("downloads a bounded PDF and rejects redirects, HTML, and oversized responses", async () => {
  const good = pdfBytes();
  const fetchImpl = async () => new Response(good, { status: 200, headers: { "content-type": "application/pdf" } });
  assert.equal((await downloadOfficialPdf("https://bop.diba.cat/doc.pdf", { allowedHosts: ["bop.diba.cat"], fetchImpl })).sha256, verifyPdfBytes(good).sha256);
  await assert.rejects(downloadOfficialPdf("https://bop.diba.cat/doc.pdf", {
    allowedHosts: ["bop.diba.cat"], fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/a.pdf" } }),
  }), /OFFICIAL_PDF_REDIRECT_BLOCKED/);
  await assert.rejects(downloadOfficialPdf("https://bop.diba.cat/doc.pdf", {
    allowedHosts: ["bop.diba.cat"], fetchImpl: async () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }),
  }), /OFFICIAL_PDF_UNEXPECTED_CONTENT_TYPE/);
  await assert.rejects(downloadOfficialPdf("https://bop.diba.cat/doc.pdf", {
    allowedHosts: ["bop.diba.cat"], maxBytes: 512, fetchImpl,
  }), /OFFICIAL_PDF_TOO_LARGE|OFFICIAL_PDF_INVALID/);
});

test("maps a stalled download to a bounded timeout", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await assert.rejects(downloadOfficialPdf("https://bop.diba.cat/doc.pdf", {
    allowedHosts: ["bop.diba.cat"], fetchImpl, timeoutMs: 5,
  }), /OFFICIAL_PDF_TIMEOUT/);
});

test("stores original PDFs immutably and detects a hash collision", async () => {
  let stored = null;
  const file = {
    async save(buffer, options) {
      assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
      stored = { buffer, metadata: options.metadata.metadata };
    },
    async getMetadata() { return [{ metadata: stored.metadata }]; },
  };
  const bucket = { name: "private-bucket", file: () => file };
  const document = { buffer: pdfBytes(), sha256: verifyPdfBytes(pdfBytes()).sha256, url: "https://bop.diba.cat/doc.pdf" };
  assert.equal(await storeOfficialPdf(bucket, "official-sources/doc.pdf", document), "gs://private-bucket/official-sources/doc.pdf");
  file.save = async () => { throw Object.assign(new Error("exists"), { code: 412 }); };
  assert.equal(await storeOfficialPdf(bucket, "official-sources/doc.pdf", document), "gs://private-bucket/official-sources/doc.pdf");
  stored.metadata.sha256 = "b".repeat(64);
  await assert.rejects(storeOfficialPdf(bucket, "official-sources/doc.pdf", document), /OFFICIAL_PDF_STORAGE_COLLISION/);
});

test("classifies only document types supported by deterministic title rules", () => {
  assert.equal(classifyOfficialDocument("Tablas salariales 2026"), "salary_tables");
  assert.equal(classifyOfficialDocument("Revisión de tablas salariales 2026"), "salary_revision");
  assert.equal(classifyOfficialDocument("Corrección de errores"), "error_correction");
  assert.equal(classifyOfficialDocument("Prórroga del convenio"), "extension");
  assert.equal(classifyOfficialDocument("Resolució EMT/427/2026 - Acord parcial de neteja"), "partial_amendment");
  assert.equal(classifyOfficialDocument("Acuerdo parcial de limpieza 2026"), "partial_amendment");
  assert.equal(classifyOfficialDocument("Convenio colectivo texto nuevo"), "collective_agreement");
  assert.equal(classifyOfficialDocument("Anuncio sin relación"), "not_relevant");
});

test("does not activate partial, duplicated, wrong-source, or invalid-vector chunk sets", async () => {
  const goodDocs = [chunk(0), chunk(1)];
  assert.equal(validateChunkSet(goodDocs, {
    fileName: "source.pdf", sourceSha256: "a".repeat(64), totalChunks: 2,
    docType: "especifico", embeddingModel: "gemini-embedding-001", dimensions: 768,
  }), true);
  const cases = [
    [goodDocs.slice(0, 1), /INGESTION_CHUNK_SET/],
    [[chunk(0), chunk(0)], /INGESTION_CHUNK_SET/],
    [[chunk(0), chunk(1, { sourceSha256: "b".repeat(64) })], /INGESTION_CHUNK_SET/],
    [[chunk(0), chunk(1, { vector: { toArray: () => [1] } })], /INGESTION_EMBEDDING_INVALID/],
  ];
  for (const [docs, error] of cases) assert.throws(() => validateChunkSet(docs, {
    fileName: "source.pdf", sourceSha256: "a".repeat(64), totalChunks: 2,
    docType: "especifico", embeddingModel: "gemini-embedding-001", dimensions: 768,
  }), error);
});

test("activates the complete document in one transaction and retries idempotently", async () => {
  const db = fakeDb({ "chunk-0": chunk(0), "chunk-1": chunk(1) });
  const args = activationArgs(db);
  assert.equal((await activateChunkSet(args)).activatedChunks, 2);
  assert.equal(db.records.get("chunk-0").doc_type, "especifico");
  assert.equal((await activateChunkSet(args)).activatedChunks, 2);
});

test("a failed activation leaves all chunks staged and concurrent retries converge", async () => {
  const db = fakeDb({ "chunk-0": chunk(0), "chunk-1": chunk(1, { sourceSha256: "b".repeat(64) }) });
  const args = activationArgs(db);
  await assert.rejects(activateChunkSet(args), /INGESTION_CHUNK_SET_INCONSISTENT/);
  assert.equal(db.records.get("chunk-0").doc_type, "staged_especifico");
  assert.equal(db.records.get("chunk-1").doc_type, "staged_especifico");

  const cleanDb = fakeDb({ "chunk-0": chunk(0), "chunk-1": chunk(1) });
  const concurrentArgs = activationArgs(cleanDb);
  await Promise.all([activateChunkSet(concurrentArgs), activateChunkSet(concurrentArgs)]);
  assert.equal(cleanDb.records.get("chunk-0").doc_type, "especifico");
  assert.equal(cleanDb.records.get("chunk-1").doc_type, "especifico");
});

test("monthly embedding budget reserves estimates transactionally and stops over-budget work", async () => {
  const db = fakeDb({});
  const now = new Date("2026-10-14T12:00:00Z");
  assert.deepEqual(await reserveEmbeddingBudget(db, 0, now), { estimatedTokens: 0, monthReservedTokens: null });
  assert.equal((await reserveEmbeddingBudget(db, 50_000, now)).monthReservedTokens, 50_000);
  assert.equal((await reserveEmbeddingBudget(db, 50_000, now)).monthReservedTokens, 100_000);
  assert.equal((await reserveEmbeddingBudget(db, 50_000, now)).monthReservedTokens, 150_000);
  assert.equal((await reserveEmbeddingBudget(db, 50_000, now)).monthReservedTokens, 200_000);
  assert.equal((await reserveEmbeddingBudget(db, 50_000, now)).monthReservedTokens, 250_000);
  await assert.rejects(reserveEmbeddingBudget(db, 1, now), /INGESTION_MONTHLY_BUDGET_EXCEEDED/);
  await assert.rejects(reserveEmbeddingBudget(db, 100_001, now), /INGESTION_DOCUMENT_BUDGET_EXCEEDED/);
  assert.equal(db.records.get("ingestion_budget_2026-10").estimatedTokensReserved, 250_000);
  assert.equal(MAX_EMBEDDING_TOKENS_PER_DOCUMENT, 100_000);
  assert.equal(MAX_EMBEDDING_TOKENS_PER_MONTH, 250_000);
  const fullTextDb = fakeDb({});
  assert.equal((await reserveEmbeddingBudget(fullTextDb, 88_200, now)).estimatedTokens, 88_200);
  await assert.rejects(reserveEmbeddingBudget(fullTextDb, 100_001, now), /INGESTION_DOCUMENT_BUDGET_EXCEEDED/);
});

test("rollback hides the complete publication and removes only its catalog source", async () => {
  const db = fakeDb({
    "chunk-0": chunk(0, { doc_type: "especifico" }),
    "chunk-1": chunk(1, { doc_type: "especifico" }),
    catalog: { fileNames: ["source.pdf"], documentSources: [{ fileName: "source.pdf" }], active: true },
  });
  const args = { ...activationArgs(db), catalogRef: { id: "catalog" } };
  assert.deepEqual(await rollbackChunkSet(args), { deactivatedChunks: 2 });
  assert.equal(db.records.get("chunk-0").doc_type, "staged_especifico");
  assert.deepEqual(db.records.get("catalog").fileNames, []);
  assert.equal(db.records.get("catalog").active, false);

  const mismatched = fakeDb({
    "chunk-0": chunk(0),
    "chunk-1": chunk(1),
    catalog: { fileNames: ["source.pdf"], active: true },
  });
  await assert.rejects(rollbackChunkSet({ ...activationArgs(mismatched), catalogRef: { id: "catalog" } }), /INGESTION_ROLLBACK_STATE_MISMATCH/);
  assert.equal(mismatched.records.get("chunk-0").doc_type, "staged_especifico");
});
