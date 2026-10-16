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
  sessionStorage: storage,
  navigator: { language: "es-ES", standalone: false },
  location: { hostname: "balancelaboral.es", origin: "https://balancelaboral.es", pathname: "/", search: "?email=secret@example.test" },
  matchMedia: () => ({ matches: false }),
  URLSearchParams,
  URL,
  console,
  Promise,
  Map,
  setTimeout,
};
context.window = context;
context.BALANCE_LABORAL_FIREBASE_CONFIG = { measurementId: "G-TEST" };
context.BALANCE_LABORAL_ANALYTICS_MEASUREMENT_ID = "G-TEST";
vm.runInNewContext(source, context, { filename: "analytics.js" });
for (const [referrer, expected] of [
  ["https://www.google.es/search?q=private@example.test", "https://www.google.com/"],
  ["https://l.facebook.com/l.php?u=private@example.test", "https://www.facebook.com/"],
  ["https://l.instagram.com/?u=private@example.test", "https://www.instagram.com/"],
  ["https://www.linkedin.com/in/private-user?tracking=secret", "https://www.linkedin.com/"],
  ["https://t.co/private-token", "https://t.co/"],
  ["https://private.example.test/private-user?email=secret", ""],
]) {
  document.referrer = referrer;
  assert.equal(context.safeReferrer(), expected, "only recognized origin hosts survive referrer sanitization");
}
document.referrer = "";
assert.equal(context.safeParams({ origin_page: "/convenios/" + "a".repeat(100) }).origin_page, undefined, "custom values over GA4's 100-character limit are excluded");
const fullParams = context.safeParams({ source: "header", trigger: "shifts_3", provider: "stripe", method: "email", retention_day: "30", activity_kind: "shift", activation_cohort: "2026-10-16", origin_page: "/convenios/limpieza-barcelona" });
assert.deepEqual(Object.keys(context.safeParams({ prefilled_email: "private@example.test", client_reference_id: "private-user", access_token: "secret", id_token: "secret", code: "secret", query: "private question", shift: "private work details" })), [], "payment, authentication and work payloads never pass the allowlist");
assert(Object.keys(fullParams).length + 3 <= 25, "custom payload plus platform, authentication and revision fits the parameter limit");
for (const [key, value] of Object.entries(fullParams)) assert(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) && typeof value === "string" && value.length <= 100, "custom parameter names and values fit GA4 limits");
context.location.pathname = "/convenios/" + "a".repeat(1000);
assert.equal(context.safePagePath(), "/", "oversized page locations are reduced to the safe root");
context.location.pathname = "/";
const allowedEvents = vm.runInNewContext("Array.from(PRODUCT_EVENTS)", context);
for (const name of allowedEvents) assert(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name) && !/^(ga_|google_|firebase_)/.test(name), "event names comply with GA4 naming limits");
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
  assert.deepEqual(JSON.parse(JSON.stringify(state.events[0].params)), { modo_acceso: "web", auth_state: "anonymous", event_revision: "v3" });
  assert(!JSON.stringify(context.dataLayer).includes("secret@example.test"), "initial Analytics defaults never include query parameters");
  assert.equal(scripts.length, 2, "the static page loads Firebase app and Analytics only after acceptance");
  const countBeforePageView = state.events.length;
  context.analytics.logEvent("page_view", {});
  assert.equal(state.events.length, countBeforePageView, "manual page_view is excluded; the SDK is the sole page-view emitter");
  assert(!JSON.stringify(context.dataLayer).includes('"config"'), "the wrapper does not add another SDK configuration/page view");

  context.configurarConsentimientoAnalitica("denied");
  context.analytics.logEvent("revoked", {});
  assert.deepEqual(state.collection, [true, false]);
  assert.equal(state.events.length, 1, "revocation stops subsequent events");

  context.configurarConsentimientoAnalitica("granted");
  await flush();
  context.analytics.logEvent("balance_viewed", {});
  assert.deepEqual(state.collection, [true, false, true]);
  assert.deepEqual(state.events.map((event) => event.name), ["app_open", "balance_viewed"], "reacceptance resumes collection without duplicating app_open");

  context.esContextoPlayTwa = () => true;
  context.BALANCE_LABORAL_AUTH_STATE = "authenticated";
  context.analytics.logEvent("shift_added", { email: "private@example.test", uid: "private-user", hours: 8, origin_page: "/?email=private" });
  assert.deepEqual(JSON.parse(JSON.stringify(state.events.at(-1).params)), { modo_acceso: "android_twa", auth_state: "authenticated", event_revision: "v3" });
  context.esContextoPlayTwa = () => false;
  context.matchMedia = () => ({ matches: true });
  context.analytics.logEvent("balance_viewed");
  assert.equal(state.events.at(-1).params.modo_acceso, "pwa");
  let resumes = 0;
  context.BalanceLaboralConversion = { trackReturn(kind) { if (kind === "open") resumes++; } };
  document.visibilityState = "visible";
  documentListeners.visibilitychange();
  assert.equal(resumes, 1, "a PWA resume is observed without reloading the page or duplicating app_open");
  context.location.pathname = "/convenios/hosteleria-gipuzkoa";
  documentListeners.click({ target: { closest: () => ({}) } });
  assert.equal(state.events.at(-1).name, "convenio_cta_clicked");
  assert.equal(state.events.at(-1).params.origin_page, "/convenios/hosteleria-gipuzkoa");
  const countBeforeNavigation = state.events.length;
  documentListeners.click({ target: { closest: () => ({ href: "/" }) }, preventDefault() { throw new Error("navigation must stay native"); } });
  assert.equal(state.events.length, countBeforeNavigation, "same-tab CTA is emitted by one destination only");
  assert.equal(JSON.parse(storage.getItem("bl_seo_pending_cta_v3")).page, "/convenios/hosteleria-gipuzkoa");
  context.location.pathname = "/";
  context.consumePendingSeoClick();
  context.consumePendingSeoClick();
  assert.equal(state.events.length, countBeforeNavigation + 1, "arrival and reload cannot duplicate the CTA");
  assert.equal(storage.getItem("bl_seo_pending_cta_v3"), null);
  storage.setItem("bl_seo_pending_cta_v3", JSON.stringify({ page: "/convenios/limpieza-barcelona", createdAt: Date.now() - 6 * 60 * 1000 }));
  context.consumePendingSeoClick();
  assert.equal(state.events.length, countBeforeNavigation + 1, "expired handoffs do not invent later clicks");
  context.location.pathname = "/convenios/hosteleria-gipuzkoa";
  documentListeners.click({ target: { closest: () => ({ href: "/" }) }, ctrlKey: true, preventDefault() { throw new Error("modifier navigation must stay native"); } });
  assert.equal(state.events.length, countBeforeNavigation + 2, "modifier clicks retain a source event without a handoff");
  context.location.pathname = "/";
  context.analytics.logEvent("first_shift_saved");
  assert.equal(state.events.at(-1).params.origin_page, "/convenios/hosteleria-gipuzkoa");
  context.configurarConsentimientoAnalitica("denied");
  const count = state.events.length;
  documentListeners.click({ target: { closest: () => ({}) } });
  context.analytics.logEvent("first_shift_saved");
  assert.equal(state.events.length, count);
  assert.equal(storage.getItem("bl_seo_origin_v1"), null);
  assert.equal(storage.getItem("bl_seo_pending_cta_v3"), null);
  documentListeners.visibilitychange();
  assert.equal(resumes, 1, "rejected consent also prevents resume tracking");
  assert(!JSON.stringify(state.events).match(/uid|email|installation/i), "event payloads contain no user or installation identifiers");
  console.log("analytics consent checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
