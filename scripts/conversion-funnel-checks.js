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
    crypto: { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i += 1) bytes[i] = i + 1; } },
    analytics: { events: [], logEvent(name, params) { this.events.push({ name, params }); } },
    document: { readyState: "loading", addEventListener() {}, getElementById(id) { return nodes[id] || null; } },
    setTimeout() {},
    APP_CONFIG: {},
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

const localStorage = memoryStorage();
const first = createWindow({ localStorage });
const id = first.window.BalanceLaboralConversion.getInstallationId();
assert.match(id, /^[0-9a-f]{32}$/);
assert.strictEqual(first.window.BalanceLaboralConversion.getInstallationId(), id, "installation id must persist");
first.window.BalanceLaboralConversion.recordAppOpen(null);
assert.strictEqual(first.window.analytics.events[0].name, "app_open");
assert.strictEqual(first.window.analytics.events[0].params.access_mode, "anonymous");
assert.strictEqual(first.window.analytics.events[0].params.is_returning, false);
first.window.BalanceLaboralConversion.recordAppOpen(null);
assert.strictEqual(first.window.analytics.events.length, 1, "app_open is emitted once per session");

const returning = createWindow({ localStorage });
returning.window.BalanceLaboralConversion.recordAppOpen(null);
assert.strictEqual(returning.window.analytics.events[0].params.is_returning, true, "second installation visit is returning");
assert.strictEqual(returning.window.analytics.events[1].name, "anonymous_return_visit");

const prompt = createWindow({ diasMarcados: {
  "2026-08-01": { tipo: "trabajado" }, "2026-08-02": { tipo: "trabajado" }, "2026-08-03": { tipo: "trabajado" },
} });
prompt.window.BalanceLaboralConversion.trackShiftAdded();
assert.strictEqual(prompt.window.analytics.events[0].name, "shift_added");
assert.strictEqual(prompt.window.analytics.events[0].params.shift_count_bucket, "2_3");
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
assert.strictEqual(activity.window.analytics.events[0].params.province_or_city, "Donostia");

const authenticated = createWindow({ user: { uid: "not-sent-to-analytics" } });
assert.strictEqual(authenticated.window.BalanceLaboralConversion.showRegistrationPrompt("shifts_3"), false, "authenticated users never see anonymous prompts");
authenticated.window.BalanceLaboralConversion.trackPremiumPrompt("pdf_export");
authenticated.window.BalanceLaboralConversion.trackPremiumCheckoutStarted();
authenticated.window.BalanceLaboralConversion.trackPremiumActivationConfirmed(true);
assert.deepStrictEqual(Array.from(authenticated.window.analytics.events, (event) => event.name), [
  "premium_prompt_shown", "premium_checkout_started", "premium_activated",
]);

const premium = createWindow({ user: { uid: "premium-user" } });
premium.window.esPremium = true;
premium.window.BalanceLaboralConversion.trackPremiumPrompt("pdf_export");
assert.strictEqual(premium.window.analytics.events.length, 0, "Premium users do not receive Premium prompts");

console.log("conversion funnel checks passed");
