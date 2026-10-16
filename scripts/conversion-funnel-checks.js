const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "js", "conversion-funnel.js"), "utf8");

function memoryStorage(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function createWindow(options = {}) {
  const nodes = {};
  ["registration-prompt-modal", "registration-prompt-title", "registration-prompt-text", "registration-prompt-dismiss", "tipoJornada"].forEach((id) => {
    nodes[id] = {
      dataset: {}, style: {}, textContent: "", value: id === "tipoJornada" ? "1" : "",
      setAttribute(key, value) { this[key] = value; }, focus() { this.focused = true; },
    };
  });
  const window = {
    window: null,
    localStorage: options.localStorage || memoryStorage(),
    sessionStorage: options.sessionStorage || memoryStorage(),
    analytics: { events: [], logEvent(name, params) { this.events.push({ name, params }); } },
    document: { readyState: "loading", addEventListener() {}, getElementById(id) { return nodes[id] || null; } },
    setTimeout() {},
    APP_CONFIG: {},
    tieneConsentimientoAnalitica() { return options.analyticsConsent !== false; },
    usuarioActual: options.user || null,
    diasMarcados: options.diasMarcados || {},
    sectorUsuario: "general",
    ciudadActual: "Donostia",
    Uint8Array,
    Date,
  };
  window.window = window;
  vm.runInNewContext(source, window, { filename: "conversion-funnel.js" });
  return { window, nodes };
}

const first = createWindow();
assert.strictEqual(first.window.localStorage.getItem("bl_anonymous_installation_id"), null, "analytics setup must not create an installation identifier");
assert.strictEqual(first.window.BalanceLaboralConversion.recordAppOpen, undefined, "app_open has one emitter in consented Analytics");
assert(!source.includes("bl_anonymous_installation_id"), "conversion funnel must not persist an analytics installation identifier");
assert(!source.includes("anonymous_return_visit"), "returning users are reported by GA4's standard dimension");

const prompt = createWindow({ diasMarcados: {
  "2026-08-01": { tipo: "trabajado" }, "2026-08-02": { tipo: "trabajado" }, "2026-08-03": { tipo: "trabajado" },
} });
prompt.window.BalanceLaboralConversion.trackShiftAdded();
assert.strictEqual(prompt.window.analytics.events[0].name, "shift_added");
assert.deepStrictEqual(JSON.parse(JSON.stringify(prompt.window.analytics.events[0].params)), {}, "shift events must not include calendar or account details");
assert.strictEqual(prompt.nodes["registration-prompt-modal"].style.display, "flex", "three shifts shows a prompt");
prompt.window.BalanceLaboralConversion.closeRegistrationPrompt("dismiss");
assert.strictEqual(prompt.window.BalanceLaboralConversion.canShowRegistrationPrompt(), false, "a dismissal blocks prompts for the session");
assert.strictEqual(prompt.window.analytics.events.at(-1).name, "registration_prompt_dismissed");

const activity = createWindow();
activity.window.BalanceLaboralConversion.trackCalendarConfigured();
activity.window.BalanceLaboralConversion.trackBalanceViewed("neutral");
activity.window.BalanceLaboralConversion.trackSignupStarted("header");
activity.window.BalanceLaboralConversion.trackSignupCompleted();
assert.deepStrictEqual(Array.from(activity.window.analytics.events, (event) => event.name), [
  "calendar_configured", "balance_viewed", "signup_started", "signup_completed",
]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(activity.window.analytics.events[0].params)), {}, "calendar events must not include workplace details");

const authenticated = createWindow({ user: { uid: "not-sent-to-analytics" } });
assert.strictEqual(authenticated.window.BalanceLaboralConversion.showRegistrationPrompt("shifts_3"), false, "authenticated users never see anonymous prompts");
authenticated.window.BalanceLaboralConversion.trackPremiumPrompt("pdf_export");
authenticated.window.BalanceLaboralConversion.trackPremiumCheckoutStarted();
authenticated.window.BalanceLaboralConversion.trackPremiumActivationConfirmed(true);
assert(!authenticated.window.analytics.events.some(e => e.name === "premium_activation_confirmed"), "tipoCuenta alone does not verify an entitlement");
authenticated.window.BalanceLaboralConversion.trackPremiumActivationConfirmed(true, { billing: { stripe: { active: true, source: "stripe" } } });
authenticated.window.BalanceLaboralConversion.trackPremiumActivationConfirmed(true, { billing: { stripe: { active: true, source: "stripe" } } });
authenticated.window.BalanceLaboralConversion.trackAIConsultationSucceeded();
assert.deepStrictEqual(Array.from(authenticated.window.analytics.events, (event) => event.name), [
  "premium_prompt_shown", "premium_checkout_started", "premium_activation_confirmed", "ai_consultation_succeeded",
]);
assert(!JSON.stringify(authenticated.window.analytics.events).includes("not-sent-to-analytics"), "Analytics events must not contain user IDs");
const play = createWindow({ user: { uid: "not-transmitted" } });
play.window.BalanceLaboralConversion.trackPremiumCheckoutStarted("google_play");
play.window.BalanceLaboralConversion.trackPremiumActivationConfirmed(true, { billing: { stripe: { active: true, source: "stripe" } } });
assert.equal(play.window.analytics.events.length, 1, "a Stripe entitlement does not confirm a Play checkout");
play.window.BalanceLaboralConversion.trackPremiumActivationConfirmed(true, { billing: { googlePlay: { active: true, source: "google_play", expiresAt: "2000-01-01" } } });
assert.equal(play.window.analytics.events.length, 1, "expired rights do not confirm activation");
play.window.BalanceLaboralConversion.trackPremiumActivationConfirmed(true, { billing: { googlePlay: { active: true, source: "google_play" } } });
assert.equal(play.window.analytics.events.at(-1).params.provider, "google_play");

const withoutConsent = createWindow({ user: { uid: "private-user" }, analyticsConsent: false });
withoutConsent.window.BalanceLaboralConversion.trackPremiumCheckoutStarted();
assert.strictEqual(withoutConsent.window.sessionStorage.getItem("bl_conversion_session_v1"), null, "checkout attribution is not stored before consent");
withoutConsent.window.BalanceLaboralConversion.trackShiftAdded({ previousWorkedCount: 0 });
withoutConsent.window.BalanceLaboralConversion.trackSignupCompleted();
assert.strictEqual(withoutConsent.window.analytics.events.length, 0);
assert.strictEqual(withoutConsent.window.localStorage.getItem("bl_activation_cohort_v3"), null);

const activated = createWindow();
activated.window.BalanceLaboralConversion.trackShiftAdded({ previousWorkedCount: 0 });
activated.window.BalanceLaboralConversion.trackShiftAdded({ previousWorkedCount: 1 });
activated.window.BalanceLaboralConversion.trackShiftAdded({ previousWorkedCount: 0 });
activated.window.BalanceLaboralConversion.trackSignupCompleted("google", "local-dedupe-only");
activated.window.BalanceLaboralConversion.trackSignupCompleted("google", "local-dedupe-only");
assert.equal(activated.window.analytics.events.filter(e => e.name === "first_shift_saved").length, 1);
assert.equal(activated.window.analytics.events.filter(e => e.name === "repeat_shift_saved").length, 1);
assert.equal(activated.window.analytics.events.filter(e => e.name === "signup_completed").length, 1);
assert(!JSON.stringify(activated.window.analytics.events).includes("local-dedupe-only"));
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
activated.window.localStorage.setItem("bl_activation_cohort_v3", JSON.stringify({ activated: yesterday }));
activated.window.BalanceLaboralConversion.trackReturn("open");
activated.window.BalanceLaboralConversion.trackReturn("open");
activated.window.BalanceLaboralConversion.trackReturn("shift");
const returns = activated.window.analytics.events.filter(e => e.name === "cohort_return");
assert.equal(returns.length, 2);
assert.equal(returns[0].params.retention_day, "1");
assert.equal(returns[1].params.activity_kind, "shift");
activated.window.BalanceLaboralConversion.clearAnalyticsAttribution();
assert.equal(activated.window.localStorage.getItem("bl_activation_cohort_v3"), null);
const existing = createWindow();
existing.window.BalanceLaboralConversion.trackShiftAdded({ previousWorkedCount: 4 });
assert(!existing.window.analytics.events.some(e => e.name === "first_shift_saved"), "existing calendars do not invent a historical activation");

const premium = createWindow({ user: { uid: "premium-user" } });
premium.window.esPremium = true;
premium.window.BalanceLaboralConversion.trackPremiumPrompt("pdf_export");
assert.strictEqual(premium.window.analytics.events.length, 0, "Premium users do not receive Premium prompts");

// Exercise the real Auth completion handlers with resolved/rejected providers.
const authSource = fs.readFileSync(path.join(__dirname, "..", "src/js/firebase-config.js"), "utf8");
async function authScenario({ register = false, google = false, isNewUser = false, profileExists = true, failSave = false } = {}) {
  const events = [];
  const nodes = { email: { value: "private@example.test" }, password: { value: "private-password" }, "btn-auth": {}, "error-message": { style: {} } };
  const window = { authMode: register ? "register" : "login", cerrarModal() {}, analytics: { logEvent(name) { events.push(name); } }, BalanceLaboralConversion: { trackSignupCompleted() { events.push("signup_completed"); }, trackSignupStarted() {} } };
  const user = { uid: "private-user", email: "private@example.test" };
  const context = { window, document: { getElementById: id => nodes[id] }, auth: {
    currentUser: user, createUserWithEmailAndPassword: async () => ({ user }), signInWithEmailAndPassword: async () => ({ user }),
    signInWithPopup: async () => ({ user, additionalUserInfo: { isNewUser } }),
  }, db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: profileExists }), set: async () => { if (failSave) throw new Error("test-save-failed"); } }) }) },
  firebase: { auth: { GoogleAuthProvider: function() {} } }, planSeleccionado: "free", console: { error() {} }, mostrarErrorAuth() {}, traducirErrorGoogle() {}, setTimeout() {} };
  vm.runInNewContext(authSource.slice(authSource.indexOf("window.autenticar ="), authSource.indexOf("window.cerrarSesion =")), context);
  if (google) window.autenticarConGoogle(); else window.autenticar();
  await new Promise(resolve => setImmediate(resolve));
  return events;
}
(async () => {
  assert.deepEqual(await authScenario({ register: true }), ["signup_completed"]);
  assert.deepEqual(await authScenario({ register: true, failSave: true }), []);
  assert.deepEqual(await authScenario(), ["login"]);
  assert.deepEqual(await authScenario({ google: true, isNewUser: true, profileExists: false }), ["signup_completed"]);
  assert.deepEqual(await authScenario({ google: true, isNewUser: false, profileExists: false }), ["login"], "crear un perfil ausente no implica un alta nueva en Auth");
  console.log("conversion funnel checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
