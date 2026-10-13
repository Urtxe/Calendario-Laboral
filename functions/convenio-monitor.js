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
  const relevantType = /^(?:CONVENIO COLECTIVO(?:\s+\(TEXTO NUEVO\))?|TABLA SALARIAL|MODIFICACI[ÓO]N|REVISI[ÓO]N SALARIAL(?: AUTOM[ÁA]TICA)?|ACUERDOS? DE COMISI[ÓO]N PARITARIA|ACUERDO PARCIAL|ACUERDOS DERIVADOS DE CONVENIOS|PR[ÓO]RROGA|DENUNCIA(?:\s*-\s*PROMOCI[ÓO]N DE NEGOCIACI[ÓO]N)?|CORRECCI[ÓO]N(?: DE ERRORES)?)$/i;
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
      signature: crypto.createHash("sha256").update(cells.join("\u001f")).digest("hex"),
      summary: text.slice(0, 260),
      registrationDate: /^\d{2}\/\d{2}\/\d{4}$/.test(cells[4] || "") ? cells[4] : null,
      transactionType: cells[2],
      occurrences,
    };
  });
}

function assertCompleteRegconResult(html, rows) {
  const resultText = normalizeHtml(html);
  const page = resultText.match(/Resultados\s*(\d+)\s*-\s*(\d+)\s*de\s*(\d+)/i);
  if (page && Number(page[2]) < Number(page[3])) throw new Error("REGCON_RESULT_INCOMPLETE");
  if (rows.length === 0) throw new Error("REGCON_RESULT_INCOMPLETE");
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
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function isDue(agreement, state, now) {
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

async function fetchRegcon(agreement, fetchImpl = fetch) {
  const url = new URL(agreement.sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== REGCON_HOST || url.pathname !== "/regcon/pub/consultaCodigoMapas" || url.searchParams.get("convenioMapa") !== agreement.officialCode) {
    throw new Error("REGCON_URL_NOT_ALLOWED");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { accept: "text/html" } });
    if (response.status >= 300 && response.status < 400) throw new Error("REGCON_REDIRECT_BLOCKED");
    if (!response.ok) throw new Error(`REGCON_HTTP_${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error("REGCON_UNEXPECTED_CONTENT_TYPE");
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("REGCON_RESPONSE_TOO_LARGE");
    const html = await readBoundedText(response, MAX_RESPONSE_BYTES);
    if (!html.includes(agreement.officialCode)) throw new Error("REGCON_CODE_NOT_PRESENT");
    const rows = parseRegconRows(html, agreement.officialCode);
    assertCompleteRegconResult(html, rows);
    return rows;
  } finally {
    clearTimeout(timeout);
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
        const known = new Set(state?.knownSignatures || []);
        const additions = rows.filter((row) => !known.has(row.signature));
        const baseline = !state?.baselineEstablished;
        const newEntries = baseline ? [] : additions;
        counts.checked += 1;
        counts.newEntries += newEntries.length;
        const pendingEntries = [...(state?.pendingEntries || []), ...newEntries.map(({ signature, registrationDate, transactionType, summary, occurrences }) => ({ signature, registrationDate, transactionType, summary, occurrences, status: "pending_documentary_verification", detectedAt: now }))].slice(-100);
        const interval = reviewInterval(agreement, now, { pendingEntries });
        await stateRef.set({
          agreementId: agreement.id,
          officialCode: agreement.officialCode,
          title: agreement.title,
          source: "REGCON",
          status: "source_checked",
          lastSuccessfulCheckAt: now,
          nextReviewAt: addCalendarMonths(now, interval),
          baselineEstablished: true,
          lastErrorCode: null,
          knownSignatures: [...new Set([...(state?.knownSignatures || []), ...rows.map((row) => row.signature)])].slice(-250),
          latestRows: rows.slice(0, 20).map(({ signature, registrationDate, transactionType, summary, occurrences }) => ({ signature, registrationDate, transactionType, summary, occurrences })),
          pendingEntries,
          lastResult: baseline ? "baseline_established_no_historical_novelties" : newEntries.length ? "new_regcon_entries_pending_verification" : "no_new_regcon_entries",
        }, { merge: true });
        log.info("convenio_monitor_source_checked", { runId, executionId, agreementId: agreement.id, officialCode: agreement.officialCode, rows: rows.length, newEntries: newEntries.length, baseline });
      } catch (error) {
        counts.failed += 1;
        counts.pending += 1;
        await stateRef.set({ agreementId: agreement.id, officialCode: agreement.officialCode, lastAttemptAt: now, nextReviewAt: addCalendarMonths(now, TWO_MONTHS), lastErrorCode: String(error.message || "SOURCE_ERROR").slice(0, 80), status: "source_check_failed" }, { merge: true });
        log.warn("convenio_monitor_source_failed", { runId, executionId, agreementId: agreement.id, officialCode: agreement.officialCode, errorCode: String(error.message || "SOURCE_ERROR").slice(0, 80) });
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

module.exports = { inventory, parseRegconRows, assertCompleteRegconResult, isDue, pendingEntryCount, reviewInterval, addCalendarMonths, fetchRegcon, runMonthlyConvenioReview };
