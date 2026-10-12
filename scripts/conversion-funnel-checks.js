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
authenticated.window.BalanceLaboralConversion.trackAIConsultationSucceeded();
assert.deepStrictEqual(Array.from(authenticated.window.analytics.events, (event) => event.name), [
  "premium_prompt_shown", "premium_checkout_started", "premium_activation_confirmed", "ai_consultation_succeeded",
]);
assert(!JSON.stringify(authenticated.window.analytics.events).includes("not-sent-to-analytics"), "Analytics events must not contain user IDs");

const withoutConsent = createWindow({ user: { uid: "private-user" }, analyticsConsent: false });
withoutConsent.window.BalanceLaboralConversion.trackPremiumCheckoutStarted();
assert.strictEqual(withoutConsent.window.sessionStorage.getItem("bl_conversion_session_v1"), null, "checkout attribution is not stored before consent");

const premium = createWindow({ user: { uid: "premium-user" } });
premium.window.esPremium = true;
premium.window.BalanceLaboralConversion.trackPremiumPrompt("pdf_export");
assert.strictEqual(premium.window.analytics.events.length, 0, "Premium users do not receive Premium prompts");

console.log("conversion funnel checks passed");
