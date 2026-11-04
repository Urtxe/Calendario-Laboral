"use strict";

// Usage: node admin-year-summary-backfill.js [--dry-run | --apply]
// Defaults to a read-only dry run. Use --apply only after reviewing its aggregate counts.
const admin = require("firebase-admin");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const {
  LEGACY_PROFILE_FIELDS,
  parseYearId,
  processAdminYearSummaryBackfillPage,
  yearsInLegacyData,
} = require("./admin-year-summary");

const PROJECT_ID = "calendario-laboral-252b1";
const PAGE_SIZE = 100;

function parseArguments(args) {
  if (args.includes("--help")) return { help: true };
  if (args.some((argument) => !["--apply", "--dry-run"].includes(argument)) ||
      (args.includes("--apply") && args.includes("--dry-run"))) {
    return { error: "invalid_arguments" };
  }
  return { apply: args.includes("--apply") };
}

function exactYearCandidate(documentSnapshot) {
  const segments = documentSnapshot.ref.path.split("/");
  if (segments.length !== 4 || segments[0] !== "usuarios" || segments[2] !== "years" || !parseYearId(segments[3])) {
    return null;
  }
  return { userId: segments[1], yearId: segments[3] };
}

function addStats(total, page) {
  for (const [key, value] of Object.entries(page)) {
    if (typeof value === "number") total[key] = (total[key] || 0) + value;
    else if (key === "errorCodes") {
      for (const [code, count] of Object.entries(value)) {
        total.errorCodes[code] = (total.errorCodes[code] || 0) + count;
      }
    }
  }
}

function newStats() {
  return {
    yearDocumentsScanned: 0,
    profilesScanned: 0,
    legacyYearsFound: 0,
    legacyYearsCoveredByYearDocument: 0,
    candidates: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    absent: 0,
    wouldUpdate: 0,
    wouldDelete: 0,
    errors: 0,
    errorCodes: Object.create(null),
  };
}

async function runBackfill({ db, apply, serverTimestamp }) {
  const stats = newStats();
  let yearCursor = null;
  while (true) {
    let query = db.collectionGroup("years")
      .select("updatedAt")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (yearCursor) query = query.startAfter(yearCursor);
    const page = await query.get();
    if (page.empty) break;

    stats.yearDocumentsScanned += page.docs.length;
    const candidates = page.docs.map(exactYearCandidate).filter(Boolean);
    const actions = await processAdminYearSummaryBackfillPage({ db, candidates, apply, serverTimestamp });
    addStats(stats, actions);
    yearCursor = page.docs[page.docs.length - 1];
    if (page.docs.length < PAGE_SIZE) break;
  }

  let userCursor = null;
  while (true) {
    let query = db.collection("usuarios")
      .select(...LEGACY_PROFILE_FIELDS)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (userCursor) query = query.startAfter(userCursor);
    const page = await query.get();
    if (page.empty) break;

    stats.profilesScanned += page.docs.length;
    let candidates = [];
    for (const userSnapshot of page.docs) {
      for (const yearId of yearsInLegacyData(userSnapshot.data() || {})) {
        stats.legacyYearsFound += 1;
        const yearSnapshot = await userSnapshot.ref.collection("years").doc(yearId).get();
        if (yearSnapshot.exists) {
          stats.legacyYearsCoveredByYearDocument += 1;
          continue;
        }
        candidates.push({ userId: userSnapshot.id, yearId });
        if (candidates.length === PAGE_SIZE) {
          const actions = await processAdminYearSummaryBackfillPage({
            db,
            candidates,
            apply,
            serverTimestamp,
          });
          addStats(stats, actions);
          candidates = [];
        }
      }
    }
    if (candidates.length) {
      const actions = await processAdminYearSummaryBackfillPage({
        db,
        candidates,
        apply,
        serverTimestamp,
      });
      addStats(stats, actions);
    }

    userCursor = page.docs[page.docs.length - 1];
    if (page.docs.length < PAGE_SIZE) break;
  }
  return stats;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log("Usage: node admin-year-summary-backfill.js [--dry-run | --apply]");
    console.log("Default: --dry-run (no Firestore writes). --apply writes the generated summaries.");
    return 0;
  }
  if (options.error) {
    console.log(JSON.stringify({ ok: false, errorCode: options.error }));
    return 2;
  }

  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();
  try {
    const stats = await runBackfill({
      db,
      apply: options.apply,
      serverTimestamp: () => FieldValue.serverTimestamp(),
    });
    console.log(JSON.stringify({
      ok: stats.errors === 0,
      project: PROJECT_ID,
      mode: options.apply ? "apply" : "dry-run",
      stats,
    }, null, 2));
    return stats.errors === 0 ? 0 : 1;
  } finally {
    try {
      await db.terminate();
    } catch {
      // Shutdown errors are intentionally omitted to keep the output aggregate-only.
    }
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    const rawCode = String(error?.code || "unknown");
    const errorCode = /^[A-Za-z0-9_./-]{1,60}$/.test(rawCode) ? rawCode : "unknown";
    console.log(JSON.stringify({ ok: false, project: PROJECT_ID, errorCode }));
    process.exitCode = 1;
  });
}

module.exports = { exactYearCandidate, parseArguments, runBackfill };
