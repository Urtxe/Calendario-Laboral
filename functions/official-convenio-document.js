"use strict";

const crypto = require("node:crypto");

const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

function assertOfficialHttpsUrl(value, allowedHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OFFICIAL_SOURCE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      !Array.isArray(allowedHosts) || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error("OFFICIAL_SOURCE_HOST_NOT_ALLOWED");
  }
  return url;
}

function verifyPdfBytes(buffer, maxBytes = DEFAULT_MAX_PDF_BYTES) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 512 || buffer.length > maxBytes ||
      !buffer.subarray(0, 8).toString("ascii").startsWith("%PDF-") ||
      !buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from("%%EOF"))) {
    throw new Error("OFFICIAL_PDF_INVALID_OR_INCOMPLETE");
  }
  return {
    sizeBytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

async function readBounded(response, maxBytes) {
  if (!response.body) throw new Error("OFFICIAL_PDF_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("OFFICIAL_PDF_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function downloadOfficialPdf(value, {
  allowedHosts,
  fetchImpl = fetch,
  maxBytes = DEFAULT_MAX_PDF_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const url = assertOfficialHttpsUrl(value, allowedHosts);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/pdf" },
    });
    if (response.status >= 300 && response.status < 400) throw new Error("OFFICIAL_PDF_REDIRECT_BLOCKED");
    if (!response.ok) throw new Error(`OFFICIAL_PDF_HTTP_${response.status}`);
    if (!(response.headers.get("content-type") || "").toLowerCase().split(";")[0].trim().includes("application/pdf")) {
      throw new Error("OFFICIAL_PDF_UNEXPECTED_CONTENT_TYPE");
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > maxBytes) throw new Error("OFFICIAL_PDF_TOO_LARGE");
    const buffer = await readBounded(response, maxBytes);
    return { buffer, ...verifyPdfBytes(buffer, maxBytes), url: url.toString() };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("OFFICIAL_PDF_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function storeOfficialPdf(bucket, objectName, document) {
  if (!bucket || !/^[a-z0-9/_-]+\.pdf$/i.test(objectName) || !document?.buffer || !document?.sha256) {
    throw new Error("OFFICIAL_PDF_STORAGE_ARGUMENT_INVALID");
  }
  const file = bucket.file(objectName);
  try {
    await file.save(document.buffer, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: "application/pdf",
        metadata: {
          sha256: document.sha256,
          officialSourceUrl: document.url,
          publicationIdentifier: document.publicationIdentifier,
        },
      },
    });
  } catch (error) {
    if (Number(error.code) !== 412) throw error;
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.sha256 !== document.sha256) throw new Error("OFFICIAL_PDF_STORAGE_COLLISION");
  }
  return `gs://${bucket.name}/${objectName}`;
}

function classifyOfficialDocument(title) {
  const value = String(title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/correccion/.test(value)) return "error_correction";
  if (/revision salarial|revision de tablas/.test(value)) return "salary_revision";
  if (/tabla|salario/.test(value)) return "salary_tables";
  if (/prorroga/.test(value)) return "extension";
  if (/acuerdo parcial|acord parcial/.test(value)) return "partial_amendment";
  if (/modificacion|modifica/.test(value)) return "partial_amendment";
  if (/acuerdo complementario|acuerdo de comision paritaria/.test(value)) return "complementary_agreement";
  if (/convenio|texto nuevo/.test(value)) return "collective_agreement";
  return "not_relevant";
}

module.exports = {
  DEFAULT_MAX_PDF_BYTES,
  DEFAULT_TIMEOUT_MS,
  assertOfficialHttpsUrl,
  verifyPdfBytes,
  downloadOfficialPdf,
  storeOfficialPdf,
  classifyOfficialDocument,
};
