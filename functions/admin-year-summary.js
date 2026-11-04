"use strict";

const { isDeepStrictEqual } = require("node:util");
const { mergeYearData, summarizePersonalYear } = require("./personal-labor-context");

const SUMMARY_COLLECTION = "resumenes";
const BACKFILL_CONCURRENCY = 4;
const LEGACY_PROFILE_FIELDS = [
  "diasMarcados",
  "objetivosAnuales",
  "tipoJornadaPorAnio",
  "horasExtraPorDia",
  "horasExtraCompensadas",
];

function parseYearId(value) {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= 2000 && year <= 2100 ? year : null;
}

function hasYearData(data) {
  return data.horasAnuales !== undefined || data.tipoJornada !== undefined ||
    Object.keys(data.diasMarcados).length > 0 ||
    Object.keys(data.horasExtraPorDia).length > 0 ||
    Object.keys(data.horasExtraCompensadas).length > 0;
}

function buildAdminYearSummary(data, year, asOf) {
  const calculated = summarizePersonalYear(data, year, asOf, { includeOvertime: true });
  if (!calculated.available) {
    return {
      available: false,
      year,
      reason: calculated.reason,
      calculationVersion: 1,
    };
  }

  const computedDays = calculated.computedDaysToDate + calculated.futurePlannedDays;
  const holidayDays = calculated.holidayDaysToDate + calculated.futurePlannedHolidayDays;
  const annualHours = Number(data.horasAnuales);
  const scheduleFactor = Number(data.tipoJornada);
  const hoursPerDay = 8 * scheduleFactor;
  const estimatedHours = computedDays * hoursPerDay;
  const requiredHours = annualHours * scheduleFactor - holidayDays * 4 * scheduleFactor;
  const balanceHours = Math.round(estimatedHours - requiredHours);

  return {
    available: true,
    year,
    computedDays,
    holidayDays,
    estimatedHours: Math.round(estimatedHours),
    requiredHours: Math.round(requiredHours),
    balanceHours,
    balanceDays: Math.round(balanceHours / hoursPerDay),
    overtimeHoursEntered: calculated.overtimeHoursEntered,
    compensatedOvertimeMonths: calculated.monthsMarkedOvertimeCompensated,
    includesFuturePlans: true,
    calculationVersion: 1,
    note: "Estimación según el calendario: cada día marcado como trabajado o baja cuenta como jornada; se incluyen marcas futuras. Las horas extra se muestran aparte y no son horas reales fichadas.",
  };
}

function withoutUpdatedAt(data) {
  const { updatedAt, ...content } = data || {};
  return content;
}

function yearsInLegacyData(data = {}) {
  const years = new Set();
  for (const field of LEGACY_PROFILE_FIELDS) {
    const values = data[field];
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    for (const key of Object.keys(values)) {
      const candidate = /^(\d{4})(?:-|$)/.exec(key)?.[1];
      if (candidate && parseYearId(candidate)) years.add(candidate);
    }
  }
  return years;
}

function changedLegacyYears(before = {}, after = {}) {
  const years = new Set();
  for (const field of LEGACY_PROFILE_FIELDS) {
    if (isDeepStrictEqual(before[field], after[field])) continue;
    for (const year of yearsInLegacyData({ [field]: before[field] })) years.add(year);
    for (const year of yearsInLegacyData({ [field]: after[field] })) years.add(year);
  }
  return [...years].sort();
}

async function syncAdminYearSummary({ db, userId, yearId, serverTimestamp, dryRun = false }) {
  const year = parseYearId(yearId);
  if (!year || typeof userId !== "string" || !userId) return { status: "invalid_path" };

  const profileRef = db.collection("usuarios").doc(userId);
  const yearRef = profileRef.collection("years").doc(yearId);
  const tombstoneRef = db.collection("accountDeletions").doc(userId);
  const summaryRef = profileRef.collection(SUMMARY_COLLECTION).doc(yearId);

  return db.runTransaction(async (transaction) => {
    const [tombstoneSnapshot, profileSnapshot, yearSnapshot, summarySnapshot] = await Promise.all([
      transaction.get(tombstoneRef),
      transaction.get(profileRef),
      transaction.get(yearRef),
      transaction.get(summaryRef),
    ]);

    const removeSummary = () => {
      if (!summarySnapshot.exists) return { status: "absent" };
      if (dryRun) return { status: "would_delete" };
      transaction.delete(summaryRef);
      return { status: "deleted" };
    };

    if (tombstoneSnapshot.exists || !profileSnapshot.exists) return removeSummary();

    const profileData = profileSnapshot.data() || {};
    const yearData = yearSnapshot.exists ? yearSnapshot.data() || {} : {};
    const mergedData = mergeYearData(profileData, yearData, year);
    if (!hasYearData(mergedData)) return removeSummary();

    const summary = buildAdminYearSummary(mergedData, year);
    const existing = summarySnapshot.exists ? summarySnapshot.data() || {} : {};
    if (isDeepStrictEqual(withoutUpdatedAt(existing), summary)) return { status: "unchanged" };
    if (dryRun) return { status: "would_update" };

    transaction.set(summaryRef, { ...summary, updatedAt: serverTimestamp() });
    return { status: "updated" };
  });
}

function safeErrorCode(error) {
  const code = String(error?.code || "unknown");
  return /^[A-Za-z0-9_./-]{1,60}$/.test(code) ? code : "unknown";
}

async function processAdminYearSummaryBackfillPage({ db, candidates, apply = false, serverTimestamp }) {
  const stats = {
    candidates: candidates.length,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    absent: 0,
    wouldUpdate: 0,
    wouldDelete: 0,
    errors: 0,
    errorCodes: Object.create(null),
  };
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < candidates.length) {
      const candidate = candidates[nextIndex];
      nextIndex += 1;
      try {
        const result = await syncAdminYearSummary({
          db,
          userId: candidate.userId,
          yearId: candidate.yearId,
          serverTimestamp,
          dryRun: !apply,
        });
        if (result.status === "invalid_path") {
          stats.errors += 1;
          stats.errorCodes.invalid_path = (stats.errorCodes.invalid_path || 0) + 1;
        } else {
          const statusKey = { would_update: "wouldUpdate", would_delete: "wouldDelete" }[result.status] || result.status;
          if (Object.hasOwn(stats, statusKey)) stats[statusKey] += 1;
          else {
            stats.errors += 1;
            stats.errorCodes.unknown_status = (stats.errorCodes.unknown_status || 0) + 1;
          }
        }
      } catch (error) {
        const code = safeErrorCode(error);
        stats.errors += 1;
          stats.errorCodes[code] = (stats.errorCodes[code] || 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BACKFILL_CONCURRENCY, candidates.length) }, worker));
  return stats;
}

async function syncAdminProfileLegacySummaries({ db, userId, before = {}, after = {}, existingYearIds = [], serverTimestamp }) {
  if (typeof userId !== "string" || !userId) return { status: "invalid_path", years: [] };
  const years = new Set(changedLegacyYears(before, after));
  for (const yearId of existingYearIds) {
    if (parseYearId(yearId)) years.add(yearId);
  }
  const orderedYears = [...years].sort();
  const results = await Promise.all(orderedYears.map((yearId) => syncAdminYearSummary({
    db,
    userId,
    yearId,
    serverTimestamp,
  })));
  return { status: "processed", years: orderedYears, results };
}

module.exports = {
  changedLegacyYears,
  LEGACY_PROFILE_FIELDS,
  SUMMARY_COLLECTION,
  buildAdminYearSummary,
  processAdminYearSummaryBackfillPage,
  parseYearId,
  syncAdminProfileLegacySummaries,
  syncAdminYearSummary,
  yearsInLegacyData,
};
