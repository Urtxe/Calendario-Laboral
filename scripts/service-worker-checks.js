"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const serviceWorker = fs.readFileSync(path.join(repoRoot, "service-worker.js"), "utf8");
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8"));
const criticalAssets = ["index.html", "src/js/app/ui.js", "src/js/firebase-config.js"];

function fingerprintAssets(files) {
  const content = files.map((file) => {
    const hash = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(repoRoot, file)))
      .digest("hex");
    return `${file}\n${hash}`;
  }).join("\n");
  return crypto.createHash("sha256").update(content).digest("hex");
}

const fingerprint = fingerprintAssets(criticalAssets);
const revisionMatch = serviceWorker.match(/CRITICAL_ASSET_REVISION = '([a-f0-9]{64})'/);
const cacheVersionMatch = serviceWorker.match(/CACHE_VERSION = '([^']+)'/);

assert(revisionMatch, "service-worker.js debe declarar CRITICAL_ASSET_REVISION");
assert(cacheVersionMatch, "service-worker.js debe declarar CACHE_VERSION");
assert.strictEqual(
  revisionMatch[1],
  fingerprint,
  "Un cambio en index.html o JS crítico exige actualizar CRITICAL_ASSET_REVISION y CACHE_VERSION",
);
assert(
  cacheVersionMatch[1].includes(fingerprint.slice(0, 12)),
  "CACHE_VERSION debe incluir la huella de assets críticos para invalidar cache-first",
);
assert.match(serviceWorker, /self\.skipWaiting\(\)/);
assert.match(serviceWorker, /self\.clients\.claim\(\)/);
assert.match(serviceWorker, /event\.respondWith\(cacheFirstStatic\(request\)\)/);

const serviceWorkerHeaders = firebaseConfig.hosting.headers.find((entry) => entry.source === "/service-worker.js");
assert(serviceWorkerHeaders, "firebase.json debe definir headers para service-worker.js");
const cacheControl = serviceWorkerHeaders.headers.find((header) => header.key === "Cache-Control");
assert(cacheControl && /no-cache/.test(cacheControl.value) && /no-store/.test(cacheControl.value),
  "service-worker.js no debe quedar en caché HTTP");

console.log("OK  La caché PWA invalida assets críticos y el service worker no queda en caché HTTP.");
