const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/js/analytics.js"), "utf8");
const seoDirectory = path.join(__dirname, "..", "seo");
const seoPages = fs.readdirSync(seoDirectory).filter((file) => file.endsWith(".html"));
assert.equal(seoPages.length, 29, "the static SEO set currently contains the listing and 28 detail pages");
for (const file of seoPages) {
  const html = fs.readFileSync(path.join(seoDirectory, file), "utf8");
  assert(html.includes('<script defer src="/src/js/analytics.js"></script>'), `${file} must load the consent-gated analytics wrapper`);
  assert(html.includes('<script defer src="/src/js/firebase-public-config.js"></script>'), `${file} must share the public Firebase config`);
  assert(html.includes('<a href="/?analytics=preferences">Preferencias de analítica</a>'), `${file} must let visitors change their preference`);
  assert(!html.includes("firebase-analytics-compat.js"), `${file} must not load Analytics before consent`);
}
const stored = new Map([
  ["bl_anonymous_installation_id", "legacy-id"],
  ["bl_anonymous_visit_state_v1", "legacy-count"],
  ["balance_laboral_analytics_return_v1", "legacy-return"],
]);
const scripts = [];
const documentListeners = {};
const state = { collection: [], events: [], dialog: null };
const storage = {
  getItem(key) { return stored.has(key) ? stored.get(key) : null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); },
};

const document = {
  cookie: "",
  head: { appendChild(node) {
    if (node.tagName === "LINK") return;
    scripts.push(node.src);
    if (node.src.includes("firebase-app-compat.js")) {
      context.firebase = {
        apps: [],
        initializeApp(config) { this.apps.push(config); },
      };
    } else if (node.src.includes("firebase-analytics-compat.js")) {
      context.firebase.analytics = () => ({
        logEvent(name, params) { state.events.push({ name, params }); },
        setAnalyticsCollectionEnabled(enabled) { state.collection.push(enabled); },
      });
    }
    node.onload();
  } },
  body: { appendChild(node) { if (node.id === "analytics-consent") state.dialog = node; } },
  createElement(tag) {
    return {
      tagName: tag.toUpperCase(), dataset: {}, hidden: false,
      setAttribute() {}, querySelectorAll() { return []; },
    };
  },
  getElementById(id) { return id === "analytics-consent" ? state.dialog : null; },
  querySelectorAll() { return []; },
  addEventListener(name, callback) { documentListeners[name] = callback; },
};

const context = {
  document,
  localStorage: storage,
  navigator: { language: "es-ES", standalone: false },
  location: { hostname: "balancelaboral.es", origin: "https://balancelaboral.es", search: "" },
  matchMedia: () => ({ matches: false }),
  URLSearchParams,
  console,
  Promise,
  Map,
  setTimeout,
};
context.window = context;
context.BALANCE_LABORAL_FIREBASE_CONFIG = { measurementId: "G-TEST" };
context.BALANCE_LABORAL_ANALYTICS_MEASUREMENT_ID = "G-TEST";
vm.runInNewContext(source, context, { filename: "analytics.js" });
assert.equal(storage.getItem("bl_anonymous_installation_id"), null, "legacy install identifiers are removed without being sent");
assert.equal(storage.getItem("bl_anonymous_visit_state_v1"), null, "legacy visit counters are removed");
assert.equal(storage.getItem("balance_laboral_analytics_return_v1"), null, "legacy return markers are removed");

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

(async () => {
  documentListeners.DOMContentLoaded();
  context.analytics.logEvent("before_consent", {});
  assert.deepEqual(state.events, [], "events are blocked before consent");
  assert.equal(scripts.length, 0, "Firebase Analytics SDK is not loaded before consent");

  context.configurarConsentimientoAnalitica("granted");
  await flush();
  assert.deepEqual(state.events.map((event) => event.name), ["app_open"]);
  assert.deepEqual(JSON.parse(JSON.stringify(state.events[0].params)), { modo_acceso: "web", auth_state: "anonymous", event_revision: "v2" });
  assert.equal(scripts.length, 2, "the static page loads Firebase app and Analytics only after acceptance");

  context.configurarConsentimientoAnalitica("denied");
  context.analytics.logEvent("revoked", {});
  assert.deepEqual(state.collection, [true, false]);
  assert.equal(state.events.length, 1, "revocation stops subsequent events");

  context.configurarConsentimientoAnalitica("granted");
  await flush();
  context.analytics.logEvent("after_reacceptance", {});
  assert.deepEqual(state.collection, [true, false, true]);
  assert.deepEqual(state.events.map((event) => event.name), ["app_open", "after_reacceptance"], "reacceptance resumes collection without duplicating app_open");

  context.esContextoPlayTwa = () => true;
  context.BALANCE_LABORAL_AUTH_STATE = "authenticated";
  context.analytics.logEvent("twa_authenticated", {});
  assert.deepEqual(JSON.parse(JSON.stringify(state.events.at(-1).params)), { modo_acceso: "android_twa", auth_state: "authenticated", event_revision: "v2" });
  assert(!JSON.stringify(state.events).match(/uid|email|installation/i), "event payloads contain no user or installation identifiers");
  console.log("analytics consent checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
