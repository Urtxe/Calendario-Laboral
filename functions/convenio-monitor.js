"use strict";

const crypto = require("node:crypto");
const inventory = require("./convenio-monitor-inventory.generated.json");

const STATE_COLLECTION = "convenio_monitor_state";
const RUNS_COLLECTION = "convenio_monitor_runs";
const LOCK_PATH = "convenio_monitor_control/monthly_lock";
const CYCLE_PATH = "convenio_monitor_control/monthly_cycle";
const REGCON_HOST = "expinterweb.mites.gob.es";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_EXPORT_ROWS = 500;
const MAX_TECHNICAL_RETRIES = 6;
const TWO_MONTHS = 2;
const SIX_MONTHS = 6;
const LOCK_MS = 2 * 60 * 60 * 1000;

function normalizeHtml(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_, hexadecimal) => String.fromCodePoint(parseInt(hexadecimal, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseRegconRows(html, officialCode) {
  const relevantType = /^(?:CONVENIO COLECTIVO(?:\s+\(TEXTO NUEVO\))?|TABLA SALARIAL|MODIFICACI[ÓO]N|REVISI[ÓO]N SALARIAL(?: AUTOM[ÁA]TICA)?|ACUERDOS? DE COMISI[ÓO]N PARITARIA|ACUERDO PARCIAL|ACUERDOS DERIVADOS DE CONVENIOS|PR[ÓO]RROGA|PROMOCI[ÓO]N DE NEGOCIACI[ÓO]N|DENUNCIA(?:\s*-\s*PROMOCI[ÓO]N DE NEGOCIACI[ÓO]N)?|CORRECCI[ÓO]N(?: DE ERRORES)?)$/i;
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => normalizeHtml(cell));
    return { cells, text: cells.join(" ") };
  }).filter(({ cells }) => cells.includes(officialCode) && relevantType.test(cells[2] || ""));
  const unique = new Map();
  for (const { cells } of rows) {
    const key = cells.join("\u001f");
    const existing = unique.get(key);
    if (existing) existing.occurrences += 1;
    else unique.set(key, { cells, occurrences: 1 });
  }
  return [...unique.values()].map(({ cells, occurrences }) => {
    const text = cells.join(" ");
    return {
      officialCode: cells[0],
      signature: crypto.createHash("sha256").update(cells.join("\u001f")).digest("hex"),
      summary: text.slice(0, 260),
      registrationDate: /^\d{2}\/\d{2}\/\d{4}$/.test(cells[4] || "") ? cells[4] : null,
      transactionType: cells[2],
      occurrences,
    };
  });
}

function announcedResultCount(html) {
  const resultText = normalizeHtml(html);
  const page = resultText.match(/Resultados\s*(\d+)\s*-\s*(\d+)\s*de\s*(\d+)/i);
  if (!page || Number(page[1]) !== 1 || Number(page[2]) < 1 || Number(page[2]) > Number(page[3]) || Number(page[3]) < 1) throw new Error("REGCON_RESULT_INCOMPLETE");
  return Number(page[3]);
}

function decodeXmlValue(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_, hexadecimal) => String.fromCodePoint(parseInt(hexadecimal, 16))).trim();
}

function parseRegconExport(xml, officialCode, expectedRows) {
  if (!/^\s*<\?xml\b/i.test(xml) || !/<Workbook\b/i.test(xml) || !/<Worksheet\b/i.test(xml)) throw new Error("REGCON_UNEXPECTED_EXPORT");
  const rows = [];
  const relevantType = /^(?:CONVENIO COLECTIVO(?:\s+\(TEXTO NUEVO\))?|TABLA SALARIAL|MODIFICACI[ÓO]N|REVISI[ÓO]N SALARIAL(?:\s+AUTOM[ÁA]TICA)?|ACUERDOS? DE COMISI[ÓO]N PARITARIA|ACUERDO PARCIAL|ACUERDOS DERIVADOS DE CONVENIOS|PR[ÓO]RROGA|PROMOCI[ÓO]N DE NEGOCIACI[ÓO]N|DENUNCIA(?:\s*-\s*PROMOCI[ÓO]N DE NEGOCIACI[ÓO]N)?|CORRECCI[ÓO]N(?: DE ERRORES)?)$/i;
  for (const [, rowXml] of xml.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi)) {
    const cells = [...rowXml.matchAll(/<Cell\b[^>]*>([\s\S]*?)<\/Cell>/gi)].map(([, cell]) => decodeXmlValue((cell.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i) || [])[1] || ""));
    if (!cells.length || /^(?:C�digo|Código) del Acuerdo$/.test(cells[0])) continue;
    if (cells.length !== 8) throw new Error("REGCON_RESULT_INCOMPLETE");
    if (cells[0] !== officialCode) throw new Error("REGCON_EXPORT_CODE_MISMATCH");
    rows.push(cells);
  }
  if (rows.length !== expectedRows || rows.length === 0 || rows.length > MAX_EXPORT_ROWS) throw new Error("REGCON_RESULT_INCOMPLETE");
  const unique = new Map();
  for (const cells of rows) {
    if (!relevantType.test(cells[2] || "")) continue;
    const key = cells.join("\u001f");
    const existing = unique.get(key);
    if (existing) existing.occurrences += 1;
    else unique.set(key, { cells, occurrences: 1 });
  }
  return [...unique.values()].map(({ cells, occurrences }) => ({
    officialCode: cells[0],
    signature: crypto.createHash("sha256").update(cells.join("\u001f")).digest("hex"),
    summary: cells.join(" ").slice(0, 260),
    registrationDate: /^\d{2}\/\d{2}\/\d{4}$/.test(cells[4] || "") ? cells[4] : null,
    transactionType: cells[2],
    occurrences,
  }));
}

async function readBoundedText(response, maxBytes) {
  if (!response.body) throw new Error("REGCON_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("REGCON_RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks);
  const declaration = body.subarray(0, 256).toString("ascii").match(/<\?xml[^>]*encoding=["']([^"']+)/i);
  return new TextDecoder(declaration?.[1] || "utf-8", { fatal: false }).decode(body);
}

function isDue(agreement, state, now) {
  if (agreement.sourceUrl && state?.status === "blocked_missing_official_regcon_reference" && state.officialCode !== agreement.officialCode) return true;
  if (state?.status === "source_check_failed" && (state.technicalFailureCount || 0) < MAX_TECHNICAL_RETRIES) {
    const lastAttempt = state.lastAttemptAt?.toDate ? state.lastAttemptAt.toDate() : new Date(state.lastAttemptAt);
    if (!state.lastAttemptAt || Number.isNaN(lastAttempt.getTime())) return true;
    return `${lastAttempt.getUTCFullYear()}-${String(lastAttempt.getUTCMonth() + 1).padStart(2, "0")}` !== `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (!state?.nextReviewAt) return true;
  const dueAt = state.nextReviewAt.toDate ? state.nextReviewAt.toDate() : new Date(state.nextReviewAt);
  return Number.isNaN(dueAt.getTime()) || dueAt <= now;
}

function pendingEntryCount(state) {
  return (state?.pendingEntries || []).filter((entry) => !["resolved", "rejected", "closed"].includes(entry.status)).length;
}

function reviewInterval(agreement, now, state = null) {
  const status = agreement.documentaryStatus.toLocaleLowerCase("es");
  const endedPeriod = agreement.pactEndYear != null && agreement.pactEndYear < now.getFullYear();
  const pending = /pendiente|incompleto|actualizaci[oó]n/.test(status) || pendingEntryCount(state) > 0 || /failed|blocked/.test(state?.status || "");
  return endedPeriod || pending ? TWO_MONTHS : SIX_MONTHS;
}

function addCalendarMonths(date, months) {
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

async function fetchRegcon(agreement, fetchImpl = fetch, { requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = new URL(agreement.sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== REGCON_HOST || url.pathname !== "/regcon/pub/consultaCodigoMapas" || url.searchParams.get("convenioMapa") !== agreement.officialCode) {
    throw new Error("REGCON_URL_NOT_ALLOWED");
  }
  const controller = new AbortController();
  const cookies = new Map();
  let totalResponseBytes = 0;
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const request = async (method, body = null) => {
    const headers = { accept: "text/html, application/vnd.ms-excel, application/xml", ...(cookies.size ? { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}) };
    if (body) headers["content-type"] = "application/x-www-form-urlencoded";
    const response = await fetchImpl(url, { method, body, redirect: "manual", signal: controller.signal, headers });
    if (response.status >= 300 && response.status < 400) throw new Error("REGCON_REDIRECT_BLOCKED");
    if (!response.ok) throw new Error(`REGCON_HTTP_${response.status}`);
    const setCookies = response.headers.getSetCookie?.() || (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
    for (const cookie of setCookies) {
      const first = cookie.split(";", 1)[0];
      const delimiter = first.indexOf("=");
      if (delimiter > 0) cookies.set(first.slice(0, delimiter), first.slice(delimiter + 1));
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) throw new Error("REGCON_RESPONSE_TOO_LARGE");
    const content = await readBoundedText(response, MAX_RESPONSE_BYTES);
    totalResponseBytes += Buffer.byteLength(content, "utf8");
    if (totalResponseBytes > MAX_RESPONSE_BYTES) throw new Error("REGCON_RESPONSE_TOO_LARGE");
    return { contentType, content };
  };
  try {
    const page = await request("GET");
    if (!page.contentType.includes("text/html")) throw new Error("REGCON_UNEXPECTED_CONTENT_TYPE");
    if (!page.content.includes(agreement.officialCode)) throw new Error("REGCON_CODE_NOT_PRESENT");
    const expectedRows = announcedResultCount(page.content);
    if (expectedRows > MAX_EXPORT_ROWS) throw new Error("REGCON_RESULT_INCOMPLETE");
    const exportForm = new URLSearchParams({ idConvenioResolucion: "", tokenBloqueoDescarga: "", _exportarExcelPublicoXML: "Exportar Excel" });
    const exported = await request("POST", exportForm.toString());
    if (!exported.contentType.includes("application/vnd.ms-excel") && !exported.contentType.includes("application/xml") && !exported.contentType.includes("text/xml")) throw new Error("REGCON_UNEXPECTED_EXPORT");
    return parseRegconExport(exported.content, agreement.officialCode, expectedRows);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function acquireLock(db, now, leaseToken) {
  const ref = db.doc(LOCK_PATH);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : {};
    const expiresAt = current.expiresAt?.toDate ? current.expiresAt.toDate() : current.expiresAt ? new Date(current.expiresAt) : null;
    if (expiresAt && expiresAt > now) return false;
    transaction.set(ref, { leaseToken, acquiredAt: now, expiresAt: new Date(now.getTime() + LOCK_MS) });
    return true;
  });
}

async function releaseLock(db, leaseToken, now) {
  const lockRef = db.doc(LOCK_PATH);
  await db.runTransaction(async (transaction) => {
    const lock = await transaction.get(lockRef);
    if (lock.exists && lock.data().leaseToken === leaseToken) transaction.set(lockRef, { expiresAt: now, releasedAt: now }, { merge: true });
  });
}

async function runMonthlyConvenioReview(db, {
  now = new Date(),
  fetchImpl = fetch,
  log = console,
} = {}) {
  const runId = now.toISOString().slice(0, 7);
  const leaseToken = crypto.randomUUID();
  const executionId = `${runId}-${now.getTime()}-${leaseToken.slice(0, 8)}`;
  if (!(await acquireLock(db, now, leaseToken))) return { status: "locked", runId };
  const runRef = db.collection(RUNS_COLLECTION).doc(executionId);
  const cycleRef = db.doc(CYCLE_PATH);
  let cycle;
  try {
    cycle = await cycleRef.get();
  } catch (error) {
    await releaseLock(db, leaseToken, new Date());
    throw error;
  }
  if (cycle.exists && cycle.data().lastCompleteCycle === runId) {
    await releaseLock(db, leaseToken, new Date());
    return { status: "already_complete", runId, executionId };
  }

  const counts = { examined: 0, checked: 0, newEntries: 0, pending: 0, blocked: 0, failed: 0, deferred: 0 };
  const started = Date.now();
  await runRef.set({ runId, executionId, startedAt: now, status: "running", inventoryCount: inventory.length }, { merge: true });
  try {
    for (const agreement of inventory) {
      const stateRef = db.collection(STATE_COLLECTION).doc(agreement.id);
      const stateSnapshot = await stateRef.get();
      const state = stateSnapshot.exists ? stateSnapshot.data() : null;
      counts.examined += 1;
      if (!isDue(agreement, state, now)) {
        if (/failed|blocked/.test(state?.status || "") || pendingEntryCount(state) > 0) counts.deferred += 1;
        continue;
      }
      counts.pending += pendingEntryCount(state);
      if (!agreement.sourceUrl) {
        counts.blocked += 1;
        counts.pending += 1;
        await stateRef.set({ agreementId: agreement.id, officialCode: null, status: "blocked_missing_official_regcon_reference", sourceCheck: agreement.sourceCheck, lastAttemptAt: now, nextReviewAt: addCalendarMonths(now, reviewInterval(agreement, now)) }, { merge: true });
        continue;
      }
      try {
        const rows = await fetchRegcon(agreement, fetchImpl);
        const known = new Set([...(state?.knownSignatures || []), ...(state?.pendingEntries || []).map((entry) => entry.signature)]);
        const additions = rows.filter((row) => !known.has(row.signature));
        const baseline = !state?.baselineEstablished;
        const newEntries = baseline ? [] : additions;
        counts.checked += 1;
        counts.newEntries += newEntries.length;
        const pendingEntries = [...(state?.pendingEntries || []), ...newEntries.map(({ officialCode, signature, registrationDate, transactionType, summary, occurrences }) => ({ officialCode, signature, registrationDate, transactionType, summary, occurrences, status: "pending_documentary_verification", detectedAt: now }))];
        const interval = reviewInterval(agreement, now, { pendingEntries });
        await stateRef.set({
          agreementId: agreement.id,
          officialCode: agreement.officialCode,
          title: agreement.title,
          source: "REGCON",
          sourceCheck: "available",
          status: "source_checked",
          lastSuccessfulCheckAt: now,
          nextReviewAt: addCalendarMonths(now, interval),
          baselineEstablished: true,
          lastErrorCode: null,
          technicalFailureCount: 0,
          knownSignatures: [...new Set([...(state?.knownSignatures || []), ...rows.map((row) => row.signature)])],
          latestRows: rows.slice(0, 20).map(({ signature, registrationDate, transactionType, summary, occurrences }) => ({ signature, registrationDate, transactionType, summary, occurrences })),
          pendingEntries,
          lastResult: baseline ? "baseline_established_no_historical_novelties" : newEntries.length ? "new_regcon_entries_pending_verification" : "no_new_regcon_entries",
        }, { merge: true });
        log.info("convenio_monitor_source_checked", { runId, executionId, agreementId: agreement.id, officialCode: agreement.officialCode, rows: rows.length, newEntries: newEntries.length, baseline });
      } catch (error) {
        counts.failed += 1;
        counts.pending += 1;
        const errorCode = error.name === "AbortError" ? "REGCON_TIMEOUT" : String(error.message || "SOURCE_ERROR").slice(0, 80);
        const technicalFailureCount = (state?.technicalFailureCount || 0) + 1;
        const exhausted = technicalFailureCount >= MAX_TECHNICAL_RETRIES;
        await stateRef.set({ agreementId: agreement.id, officialCode: agreement.officialCode, lastAttemptAt: now, nextReviewAt: addCalendarMonths(now, exhausted ? SIX_MONTHS : TWO_MONTHS), technicalFailureCount, lastErrorCode: errorCode, status: exhausted ? "source_check_retry_exhausted" : "source_check_failed" }, { merge: true });
        log.warn("convenio_monitor_source_failed", { runId, executionId, agreementId: agreement.id, officialCode: agreement.officialCode, errorCode, technicalFailureCount, exhausted });
      }
    }
    const hasFailures = counts.failed > 0;
    const status = hasFailures || counts.blocked > 0 || counts.pending > 0 || counts.deferred > 0 ? "partial" : counts.checked === 0 ? "no_due_agreements" : "complete";
    const summary = { runId, executionId, completedAt: new Date(), status, ...counts, durationMs: Date.now() - started, geminiCalls: 0, embeddingCalls: 0, estimatedAiCostUsd: 0 };
    await runRef.set(summary, { merge: true });
    if (status === "complete") await cycleRef.set({ lastCompleteCycle: runId, lastCompleteAt: summary.completedAt, latestExecutionId: executionId }, { merge: true });
    log.info("convenio_monitor_run_complete", summary);
    if (hasFailures) throw new Error(`La comprobación de fuentes falló para ${counts.failed} convenios; ejecútese de nuevo tras corregir la fuente.`);
    return summary;
  } catch (error) {
    await runRef.set({ runId, executionId, status: "partial", completedAt: new Date(), durationMs: Date.now() - started, errorCode: String(error.message || "RUN_ERROR").slice(0, 120) }, { merge: true });
    throw error;
  } finally {
    await releaseLock(db, leaseToken, new Date());
  }
}

module.exports = { inventory, parseRegconRows, parseRegconExport, announcedResultCount, isDue, pendingEntryCount, reviewInterval, addCalendarMonths, fetchRegcon, runMonthlyConvenioReview };
