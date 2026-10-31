const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "js", "app", "premium-upsell.js"), "utf8");

function createHarness({ premium = false, trial = true, playTwa = false, trialAvailability = false, seen = false, pending = false } = {}) {
  const local = new Map();
  const session = new Map();
  if (seen) session.set("bl_premium_welcome_seen_v1", "1");
  if (pending) session.set("bl_premium_welcome_pending_v1", "1");
  const body = {
    children: [],
    appendChild(node) { this.children.push(node); node.parent = this; },
    removeChild(node) { this.children = this.children.filter((child) => child !== node); },
  };
  const document = {
    body, blockers: [], listeners: {}, readyState: "loading",
    activeElement: { focus() { document.activeElement = this; } },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    querySelectorAll() { return this.blockers; },
    getElementById(id) { return body.children.find((node) => node.id === id) || null; },
    createElement() {
      return {
        attributes: {}, listeners: {}, style: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name] || null; },
        addEventListener(name, handler) { this.listeners[name] = handler; },
        remove() { if (this.parent) this.parent.removeChild(this); },
        focus() { document.activeElement = this; },
        querySelector(selector) {
          if (!this.parts) this.parts = new Map();
          if (!this.parts.has(selector)) {
            this.parts.set(selector, {
              textContent: "", listeners: {},
              addEventListener(name, handler) { this.listeners[name] = handler; },
              focus() { document.activeElement = this; },
            });
          }
          return this.parts.get(selector);
        },
        querySelectorAll() {
          return [this.querySelector(".premium-upsell-close"), this.querySelector(".premium-welcome-cta"), this.querySelector(".premium-upsell-later")];
        },
      };
    },
  };
  const listeners = {};
  const timers = new Map();
  let nextTimerId = 1;
  let observerCallback = null;
  const calls = { premium: [], register: [] };
  const window = {
    document, esPremium: premium, usuarioActual: null,
    APP_CONFIG: { stripeTrialEnabled: trial },
    BALANCE_LABORAL_PREMIUM_STATUS: null,
    localStorage: { getItem(key) { return local.get(key) || null; }, setItem(key, value) { local.set(key, value); } },
    sessionStorage: { getItem(key) { return session.get(key) || null; }, setItem(key, value) { session.set(key, value); }, removeItem(key) { session.delete(key); } },
    esContextoPlayTwa() { return playTwa; },
    PlayBillingService: { getTrialAvailability() { return typeof trialAvailability === "function" ? trialAvailability() : Promise.resolve(trialAvailability); } },
    addEventListener(name, handler) { listeners[name] = handler; },
    setTimeout(handler, delay = 0) { if (!delay) { handler(); return 0; } const id = nextTimerId++; timers.set(id, handler); return id; },
    clearTimeout(timer) { timers.delete(timer); },
    getComputedStyle(node) { return { display: node.style.display || (node.parentElement && node.parentElement.style.display) || "block", visibility: node.style.visibility || "visible" }; },
    MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} disconnect() {} },
    abrirModalPremium(trigger) { calls.premium.push(trigger); },
    mostrarRegistro(source) { calls.register.push(source); },
  };
  vm.runInNewContext(source, { window, Date }, { filename: "premium-upsell.js" });
  return {
    window, document, calls, local, session,
    expireTimers() { Array.from(timers.values()).forEach((handler) => handler()); timers.clear(); },
    ready() { document.listeners.DOMContentLoaded(); },
    status(detail) {
      window.BALANCE_LABORAL_PREMIUM_STATUS = detail;
      window.usuarioActual = detail.uid ? { uid: detail.uid } : null;
      listeners["balance-premium-status"]({ detail });
    },
    unblock() { document.blockers = []; if (observerCallback) observerCallback(); },
  };
}

(async function runChecks() {
const entry = createHarness();
entry.document.blockers = [{ hidden: false, style: {}, getAttribute() { return null; } }];
entry.ready();
entry.status({ uid: null, premium: false, ready: true });
assert.strictEqual(entry.document.body.children.length, 0, "welcome waits until the consent dialog is gone");
entry.unblock();
assert.strictEqual(entry.document.body.children.length, 1);
const welcome = entry.document.body.children[0];
assert.strictEqual(welcome.attributes["aria-modal"], "true");
assert.match(welcome.innerHTML, /7 días gratis de Premium/);
assert.match(welcome.innerHTML, /5 consultas IA al mes/);
assert.match(welcome.innerHTML, /Consultas IA sin cuota mensual/);
assert.match(welcome.innerHTML, /al terminar los 7 días se cobrará el plan elegido/);
assert.match(welcome.innerHTML, /El precio del plan elegido se mostrará antes de confirmar/);
assert.doesNotMatch(welcome.innerHTML, /Oferta limitada|cuenta atrás|premium-history-preview|Cifras ficticias/);
assert.match(welcome.querySelector(".premium-welcome-cta").textContent, /Crear cuenta y ver la prueba/);
assert.strictEqual(entry.window.PremiumUpsell.maybeNudge("shifts_3"), false, "entry welcome suppresses nudges in this tab session");
welcome.querySelector(".premium-welcome-cta").listeners.click();
assert.deepStrictEqual(entry.calls.register, ["premium_offer"]);
assert.strictEqual(entry.session.get("bl_premium_welcome_pending_v1"), "1");
entry.status({ uid: "new-user", premium: false, ready: true });
assert.deepStrictEqual(entry.calls.premium, ["other"], "newly authenticated free users continue to existing plan pricing once");
entry.status({ uid: "new-user", premium: false, ready: true });
assert.deepStrictEqual(entry.calls.premium, ["other"], "pending registration intent is consumed once");
assert.strictEqual(entry.session.has("bl_premium_welcome_pending_v1"), false);

const authenticatedFree = createHarness();
authenticatedFree.ready();
authenticatedFree.status({ uid: "free-user", premium: false, ready: true });
assert.match(authenticatedFree.document.body.children[0].querySelector(".premium-welcome-cta").textContent, /Ver planes y probar Premium/);
authenticatedFree.document.body.children[0].querySelector(".premium-welcome-cta").listeners.click();
assert.deepStrictEqual(authenticatedFree.calls.premium, ["other"], "free CTA opens plans without starting checkout");

const backdrop = createHarness();
backdrop.ready();
backdrop.status({ uid: null, premium: false, ready: true });
const backdropDialog = backdrop.document.body.children[0];
backdropDialog.listeners.click({ target: backdropDialog });
assert.strictEqual(backdrop.document.body.children.length, 0, "backdrop click dismisses the welcome dialog");

const closedModal = createHarness();
closedModal.ready();
closedModal.document.blockers = [{ hidden: false, style: {}, getAttribute() { return null; }, getClientRects() { return []; } }];
closedModal.status({ uid: null, premium: false, ready: true });
assert.strictEqual(closedModal.document.body.children.length, 1, "a dialog in a hidden parent does not block entry welcome");

const keyboard = createHarness();
keyboard.ready();
const originalFocus = keyboard.document.activeElement;
keyboard.status({ uid: null, premium: false, ready: true });
const keyboardDialog = keyboard.document.body.children[0];
const controls = keyboardDialog.querySelectorAll("button");
keyboard.document.activeElement = controls[0];
let prevented = false;
keyboardDialog.listeners.keydown({ key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
assert.strictEqual(prevented, true, "focus cycles within the welcome dialog");
assert.strictEqual(keyboard.document.activeElement, controls[2]);
keyboardDialog.listeners.keydown({ key: "Escape", preventDefault() {} });
assert.strictEqual(keyboard.document.body.children.length, 0);
assert.strictEqual(keyboard.document.activeElement, originalFocus, "Escape restores the previous focus target");

const loading = createHarness();
loading.ready();
loading.status({ uid: "loading-user", premium: false, ready: false });
assert.strictEqual(loading.document.body.children.length, 0, "unverified account state never gets a welcome offer");
loading.status({ uid: "premium-user", premium: true, ready: true });
assert.strictEqual(loading.document.body.children.length, 0, "Premium users are never shown the offer");
assert.strictEqual(loading.session.get("bl_premium_welcome_seen_v1"), "1", "Premium status consumes the entry opportunity for this tab");

const staleState = createHarness({ pending: true });
staleState.document.blockers = [{ hidden: false, style: {}, getAttribute() { return null; } }];
staleState.ready();
staleState.status({ uid: "free-user", premium: false, ready: true });
staleState.status({ uid: "premium-user", premium: false, ready: false });
staleState.unblock();
assert.deepStrictEqual(staleState.calls.premium, [], "an unresolved or changed account cannot open plans from a stale pending intent");
staleState.status({ uid: "premium-user", premium: true, ready: true });
assert.strictEqual(staleState.session.has("bl_premium_welcome_pending_v1"), false, "verified Premium clears pending registration intent");

const returningTab = createHarness({ seen: true });
returningTab.ready();
returningTab.status({ uid: null, premium: false, ready: true });
assert.strictEqual(returningTab.document.body.children.length, 0, "welcome appears once per tab session");
returningTab.window.usuarioActual = { uid: "free-user" };
assert.strictEqual(returningTab.window.PremiumUpsell.maybeNudge("shifts_3"), false, "a saved entry welcome suppresses nudges after reload in the same tab session");

const playTwa = createHarness({ trial: true, playTwa: true });
playTwa.ready();
playTwa.status({ uid: null, premium: false, ready: true });
await Promise.resolve();
await Promise.resolve();
await new Promise((resolve) => setImmediate(resolve));
assert.doesNotMatch(playTwa.document.body.children[0].innerHTML, /7 días gratis|ver la prueba/i, "Stripe trial config does not imply Google Play eligibility");

const eligiblePlayTwa = createHarness({ trial: false, playTwa: true, trialAvailability: true });
eligiblePlayTwa.ready();
eligiblePlayTwa.status({ uid: null, premium: false, ready: true });
await Promise.resolve();
await Promise.resolve();
await new Promise((resolve) => setImmediate(resolve));
assert.match(eligiblePlayTwa.document.body.children[0].innerHTML, /7 días gratis de Premium/, "Play trial copy is shown only after product catalog confirmation");

const slowPlayCatalog = createHarness({ playTwa: true, trialAvailability: () => new Promise(() => {}) });
slowPlayCatalog.ready();
slowPlayCatalog.status({ uid: null, premium: false, ready: true });
assert.strictEqual(slowPlayCatalog.document.body.children.length, 0, "welcome waits briefly for the Play catalog");
slowPlayCatalog.expireTimers();
await Promise.resolve();
await Promise.resolve();
await new Promise((resolve) => setImmediate(resolve));
assert.strictEqual(slowPlayCatalog.document.body.children.length, 1, "a slow Play catalog falls back to generic Premium copy");
assert.doesNotMatch(slowPlayCatalog.document.body.children[0].innerHTML, /7 días gratis/);

const disabledTrial = createHarness({ trial: false });
disabledTrial.ready();
disabledTrial.status({ uid: null, premium: false, ready: true });
assert.doesNotMatch(disabledTrial.document.body.children[0].innerHTML, /7 días|prueba gratuita/i, "trial copy is omitted when the configured provider has no trial");

const contextual = createHarness();
assert.strictEqual(contextual.window.PremiumUpsell.show("annual_history"), true);
assert.strictEqual(contextual.document.body.children[0].attributes["aria-modal"], "true");
contextual.document.body.children[0].querySelector(".premium-upsell-cta").listeners.click();
assert.deepStrictEqual(contextual.calls.premium, ["annual_history"]);
assert.strictEqual(contextual.window.PremiumUpsell.maybeNudge("app_open"), false, "app opens never create an upsell nudge");

const nudges = createHarness();
nudges.window.usuarioActual = { uid: "user" };
assert.strictEqual(nudges.window.PremiumUpsell.maybeNudge("shifts_3"), true, "meaningful usage can show an unobtrusive nudge");
assert.strictEqual(nudges.window.PremiumUpsell.maybeNudge("active_days_2"), false, "nudges are frequency limited");
nudges.document.body.children[0].querySelector(".premium-upsell-nudge-close").listeners.click();
assert(nudges.local.has("bl_premium_nudge_dismissed_at"), "nudge dismissal cooldown is persisted");
assert.strictEqual(createHarness({ premium: true }).window.PremiumUpsell.show("annual_history"), false, "Premium users cannot be upsold contextually");

console.log("Premium upsell checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
