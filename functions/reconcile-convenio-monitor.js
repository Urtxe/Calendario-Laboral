"use strict";

// One-time recovery for the first REGCON Excel export failures. The monthly
// scheduler never passes reconcileHistoricalFailures.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { inventory, runMonthlyConvenioReview } = require("./convenio-monitor");

const PROJECT_ID = "calendario-laboral-252b1";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
  const apply = process.argv.includes("--apply");
  const snapshot = await db.collection("convenio_monitor_state").get();
  const targets = snapshot.docs.filter((doc) => {
    const state = doc.data();
    return state.status === "source_check_failed" && state.lastErrorCode === "REGCON_RESULT_INCOMPLETE" &&
      !state.baselineEstablished && inventory.some((item) => item.id === doc.id && item.sourceUrl);
  });
  console.log(JSON.stringify({ project: PROJECT_ID, mode: apply ? "apply" : "preview", targets: targets.map((doc) => doc.id) }));
  if (!apply || !targets.length) return;

  const control = await db.collection("convenio_monitor_control").get();
  const backup = JSON.stringify({
    project: PROJECT_ID,
    savedAt: new Date().toISOString(),
    documents: [...snapshot.docs, ...control.docs].map((doc) => ({ path: doc.ref.path, updateTime: doc.updateTime.toDate().toISOString(), data: doc.data() })),
  }, null, 2);
  const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "BalanceLaboral", "firestore-backups");
  await fs.mkdir(dir, { recursive: true });
  const name = `regcon-reconciliation-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.json`;
  const backupPath = path.join(dir, name);
  await fs.writeFile(backupPath, backup, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ backupPath, backupSha256: crypto.createHash("sha256").update(backup).digest("hex"), documents: snapshot.size + control.size }));

  const result = await runMonthlyConvenioReview(db, { reconcileHistoricalFailures: true });
  console.log(JSON.stringify({ status: result.status, examined: result.examined, checked: result.checked, newEntries: result.newEntries, failed: result.failed, blocked: result.blocked, deferred: result.deferred, executionId: result.executionId }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
