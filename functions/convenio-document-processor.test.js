"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareBogSalaryMetadata, claimPending, finishPending } = require("./convenio-document-processor");

const agreement = { id: "convenio-02", title: "Alojamientos · Gipuzkoa", officialCode: "20100035012014" };
const entry = {
  signature: "sig-1", officialCode: agreement.officialCode, transactionType: "REVISIÓN SALARIAL",
  publicationUrl: "https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/16/c2600553.pdf",
};
const document = {
  text: "BOLETÍN OFICIAL de Gipuzkoa GAO-I-2026-00553 resolución de la revisión salarial para 2026 del Convenio Colectivo del sector de Alojamientos de Gipuzkoa (código 20100035012014). ANEXO II tablas salariales.",
  pageCount: 3, sha256: "a".repeat(64),
};

test("solo prepara revisión BOG con código, ámbito, año, identificador y anexo acreditados", () => {
  const metadata = prepareBogSalaryMetadata(agreement, entry, document);
  assert.equal(metadata.catalogKey, "alojamientos_gipuzkoa_revision_salarial_2026");
  assert.equal(metadata.publication.identifier, "GAO-I-2026-00553");
  assert.equal(metadata.sourceDocumentType, "salary_revision");
  assert.equal(metadata.sourceSha256, document.sha256);
  for (const [changed, code] of [
    [{ ...entry, officialCode: "20100035012015" }, "DOCUMENT_RELATION_NOT_DETERMINISTIC"],
    [{ ...entry, transactionType: "CONVENIO COLECTIVO" }, "DOCUMENT_RELATION_NOT_DETERMINISTIC"],
    [{ ...entry, publicationUrl: "https://example.com/file.pdf" }, "OFFICIAL_SOURCE_HOST_NOT_ALLOWED"],
    [{ ...entry, publicationUrl: "https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/30/c2600553.pdf" }, "DOCUMENT_PUBLICATION_DATE_INVALID"],
  ]) assert.throws(() => prepareBogSalaryMetadata(agreement, changed, document), new RegExp(code));
  for (const text of [document.text.replace(agreement.officialCode, "20100035012015"), document.text.replace("ANEXO", "APÉNDICE"), document.text.replace("Alojamientos", "Transporte"), document.text.replace("2026", "2025")]) {
    assert.throws(() => prepareBogSalaryMetadata(agreement, entry, { ...document, text }), /DOCUMENT_SCOPE_OR_ANNEX_NOT_VERIFIED/);
  }
});

function memoryDb() {
  const values = new Map();
  const ref = (key) => ({ key });
  return {
    values,
    doc: ref,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async runTransaction(callback) {
      return callback({
        get: async (reference) => ({ exists: values.has(reference.key), data: () => values.get(reference.key) }),
        update: (reference, data) => values.set(reference.key, { ...values.get(reference.key), ...data }),
      });
    },
  };
}

test("pausa, reclama una vez y finaliza el pendiente sin duplicar", async () => {
  const db = memoryDb();
  const now = new Date("2026-10-14T10:00:00Z");
  db.values.set("convenio_monitor_control/document_ingestion", { paused: true });
  db.values.set("convenio_monitor_state/convenio-02", { pendingEntries: [{ ...entry, status: "pending_documentary_verification" }] });
  assert.equal(await claimPending(db, agreement.id, now, "token"), null);
  db.values.set("convenio_monitor_control/document_ingestion", { paused: false });
  assert.equal((await claimPending(db, agreement.id, now, "token")).entry.documentaryAttemptCount, 1);
  assert.equal(await claimPending(db, agreement.id, now, "another"), null);
  await finishPending(db, agreement.id, entry.signature, "wrong", { status: "resolved" });
  assert.equal(db.values.get("convenio_monitor_state/convenio-02").pendingEntries[0].status, "documentary_processing");
  await finishPending(db, agreement.id, entry.signature, "token", { status: "resolved" });
  assert.equal(await claimPending(db, agreement.id, now, "another"), null);
  assert.equal(db.values.get("convenio_monitor_state/convenio-02").pendingEntries[0].status, "resolved");
});
