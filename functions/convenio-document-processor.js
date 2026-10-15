"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { inventory } = require("./convenio-monitor");
const { parseConvenioFileName, sanitizeId } = require("./convenio-metadata");
const { assertOfficialHttpsUrl, downloadOfficialPdf } = require("./official-convenio-document");

const STATE_COLLECTION = "convenio_monitor_state";
const CONTROL_PATH = "convenio_monitor_control/document_ingestion";
const BOG_HOST = "egoitza.gipuzkoa.eus";
const LEASE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function prepareBogSalaryMetadata(agreement, entry, document) {
  if (!agreement || entry.officialCode !== agreement.officialCode ||
      !/^(?:REVISI[ÓO]N SALARIAL|TABLA SALARIAL)$/i.test(entry.transactionType || "")) {
    throw new Error("DOCUMENT_RELATION_NOT_DETERMINISTIC");
  }
  const url = assertOfficialHttpsUrl(entry.publicationUrl, [BOG_HOST]);
  const match = url.pathname.match(/^\/gao-bog\/castell\/bog\/(20\d{2})\/(\d{2})\/(\d{2})\/c(\d{2})(\d{5})\.pdf$/i);
  if (!match || url.search || Number(match[1].slice(-2)) !== Number(match[4])) throw new Error("DOCUMENT_PUBLICATION_ID_INVALID");
  const [, year, month, day, , number] = match;
  const publicationDate = `${year}-${month}-${day}`;
  if (new Date(`${publicationDate}T00:00:00Z`).toISOString().slice(0, 10) !== publicationDate) throw new Error("DOCUMENT_PUBLICATION_DATE_INVALID");
  const identifier = `GAO-I-${year}-${number}`;
  const text = document.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
  const codePattern = new RegExp(`\\bcodigo\\s*${agreement.officialCode}\\b`);
  const sector = agreement.title.split("·")[0].trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/)[0];
  const salaryYear = Number(year);
  const isRevision = /^REVISI[ÓO]N SALARIAL$/i.test(entry.transactionType);
  const heading = new RegExp(`${isRevision ? "revision salarial" : "tablas salariales"} (?:para (?:el ano )?)?${year}\\b`);
  if (!codePattern.test(text) || !text.includes(sector) || !/gipuzkoa/.test(text) ||
      !text.includes(identifier.toLowerCase()) || !heading.test(text) || !/anexo|eranskina/.test(text) ||
      !/boletin oficial de gipuzkoa/.test(text) || document.pageCount < 1) {
    throw new Error("DOCUMENT_SCOPE_OR_ANNEX_NOT_VERIFIED");
  }
  const kind = isRevision ? "revision-salarial" : "tablas-salariales";
  const fileName = `BOG-${publicationDate}-${agreement.officialCode}-${kind}-${year}.pdf`;
  const base = parseConvenioFileName(`Convenio ${agreement.title} ${year}.pdf`);
  if (base.province !== "GIPUZKOA" || base.sectorKeys.length !== 1) throw new Error("DOCUMENT_INVENTORY_SCOPE_UNSUPPORTED");
  return {
    fileName,
    title: `${isRevision ? "Revisión salarial" : "Tablas salariales"} ${year} — ${agreement.title}`,
    province: base.province,
    autonomousCommunity: base.autonomousCommunity,
    sectorKeys: base.sectorKeys,
    yearStart: salaryYear,
    yearEnd: salaryYear,
    catalogKey: `${sanitizeId(base.sectorKeys[0])}_gipuzkoa_${isRevision ? "revision_salarial" : "tablas_salariales"}_${year}`,
    officialCode: agreement.officialCode,
    publication: { bulletin: "BOG", date: publicationDate, identifier, url: url.toString() },
    officialSourceUrl: url.toString(),
    sourceSha256: document.sha256,
    sourcePageCount: document.pageCount,
    sourceDocumentType: isRevision ? "salary_revision" : "salary_tables",
    sourceVerification: "verified",
    automaticIngestionEligible: true,
    salaryEvidenceVerifiedThroughYear: salaryYear,
    applicationWarning: "Publicación salarial oficial incorporada como fuente complementaria; no determina por sí sola la aplicabilidad individual del convenio.",
  };
}

async function claimPending(db, agreementId, now, token) {
  const ref = db.collection(STATE_COLLECTION).doc(agreementId);
  return db.runTransaction(async (transaction) => {
    const [control, state] = await Promise.all([transaction.get(db.doc(CONTROL_PATH)), transaction.get(ref)]);
    if (!control.exists || control.data().paused !== false || !state.exists) return null;
    const entries = state.data().pendingEntries || [];
    const index = entries.findIndex((entry) => {
      const expiredLease = entry.status === "documentary_processing" &&
        new Date(entry.processingLeaseUntil?.toDate?.() || entry.processingLeaseUntil || 0) <= now;
      if (!["pending_documentary_verification", "documentary_retry"].includes(entry.status) && !expiredLease) return false;
      if ((entry.documentaryAttemptCount || 0) >= MAX_ATTEMPTS) return false;
      const due = entry.nextDocumentaryAttemptAt?.toDate?.() || entry.nextDocumentaryAttemptAt;
      return !due || new Date(due) <= now;
    });
    if (index < 0) return null;
    const updated = entries.map((entry, i) => i === index ? {
      ...entry, status: "documentary_processing", processingToken: token,
      processingLeaseUntil: new Date(now.getTime() + LEASE_MS),
      documentaryAttemptCount: (entry.documentaryAttemptCount || 0) + 1,
    } : entry);
    transaction.update(ref, { pendingEntries: updated });
    return { entry: updated[index], signature: updated[index].signature };
  });
}

async function finishPending(db, agreementId, signature, token, update) {
  const ref = db.collection(STATE_COLLECTION).doc(agreementId);
  await db.runTransaction(async (transaction) => {
    const state = await transaction.get(ref);
    if (!state.exists) return;
    const entries = state.data().pendingEntries || [];
    const index = entries.findIndex((entry) => entry.signature === signature && entry.processingToken === token);
    if (index < 0) return;
    transaction.update(ref, { pendingEntries: entries.map((entry, i) => i === index ? {
      ...entry, ...update, processingToken: null, processingLeaseUntil: null,
    } : entry) });
  });
}

async function processPendingDocument(db, agreementId, { now = new Date(), log = console } = {}) {
  const agreement = inventory.find((item) => item.id === agreementId);
  if (!agreement?.officialCode) return { status: "unknown_agreement" };
  const token = crypto.randomUUID();
  const claim = await claimPending(db, agreementId, now, token);
  if (!claim) return { status: "no_due_pending" };
  const { entry, signature } = claim;
  let temporaryPath;
  let temporaryDirectory;
  try {
    if (!entry.publicationUrl) throw new Error("DOCUMENT_PUBLICATION_URL_MISSING");
    const url = assertOfficialHttpsUrl(entry.publicationUrl, [BOG_HOST]);
    if (!url.pathname.endsWith(".pdf")) throw new Error("DOCUMENT_OFFICIAL_PDF_UNAVAILABLE");
    const { buffer, sha256 } = await downloadOfficialPdf(url.toString(), { allowedHosts: [BOG_HOST] });
    const { loadPdfText, processFile } = require("./ingest-conventios");
    const parsed = await loadPdfText(buffer);
    const metadata = prepareBogSalaryMetadata(agreement, entry, { ...parsed, sha256 });
    const catalog = await db.collection("catalogo_convenios").doc(metadata.catalogKey).get();
    if (catalog.exists && catalog.data().sourceSha256 === sha256 && catalog.data().fileNames?.includes(metadata.fileName)) {
      await finishPending(db, agreementId, signature, token, { status: "resolved", documentCatalogKey: metadata.catalogKey, sourceSha256: sha256, resolvedAt: now, newChunks: 0 });
      return { status: "duplicate", catalogKey: metadata.catalogKey };
    }
    if (catalog.exists) throw new Error("DOCUMENT_CATALOG_CONFLICT");
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "convenio-official-"));
    temporaryPath = path.join(temporaryDirectory, metadata.fileName);
    await fs.writeFile(temporaryPath, buffer, { flag: "wx" });
    const result = await processFile(temporaryPath, { metadataOverride: metadata, keepSource: true });
    if (!result.chunks) throw new Error("DOCUMENT_TEXT_UNREADABLE");
    await finishPending(db, agreementId, signature, token, { status: "resolved", documentCatalogKey: metadata.catalogKey, sourceSha256: sha256, resolvedAt: now, newChunks: result.newChunks });
    log.info("convenio_document_ingested", { agreementId, catalogKey: metadata.catalogKey, chunks: result.newChunks });
    return { status: "ingested", catalogKey: metadata.catalogKey, chunks: result.newChunks };
  } catch (error) {
    const upstreamStatus = Number(error.status || error.code);
    const code = [429, 500, 502, 503, 504].includes(upstreamStatus)
      ? `DOCUMENT_UPSTREAM_HTTP_${upstreamStatus}`
      : [4, 14].includes(upstreamStatus) ? `DOCUMENT_UPSTREAM_GRPC_${upstreamStatus}`
        : String(error.message || "DOCUMENT_ERROR").slice(0, 100);
    const retryable = /^(?:OFFICIAL_PDF_HTTP_(?:429|5\d\d)|OFFICIAL_PDF_TIMEOUT|INGESTION_MONTHLY_BUDGET_EXCEEDED|DOCUMENT_UPSTREAM_HTTP_(?:429|5\d\d)|DOCUMENT_UPSTREAM_GRPC_(?:4|14))$/.test(code) && entry.documentaryAttemptCount < MAX_ATTEMPTS;
    await finishPending(db, agreementId, signature, token, {
      status: retryable ? "documentary_retry" : "pending_manual_verification",
      lastDocumentaryError: code,
      lastDocumentaryAttemptAt: now,
      nextDocumentaryAttemptAt: retryable ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
    });
    log.warn("convenio_document_pending", { agreementId, errorCode: code, retryable });
    return { status: retryable ? "retry_scheduled" : "manual_verification_required", errorCode: code };
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

module.exports = { prepareBogSalaryMetadata, claimPending, finishPending, processPendingDocument };
