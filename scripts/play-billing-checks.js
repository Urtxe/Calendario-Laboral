"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src/js/app/play-billing-service.js"), "utf8");
const STORE = "https://play.google.com/billing";

function button() {
  return {
    disabled: false,
    listeners: {},
    attributes: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function billingWindow({ inTwa = true, service, paymentResponse, fetchResponse } = {}) {
  const plans = { children: [], appendChild(child) { this.children.push(child); } };
  const status = { textContent: "" };
  const close = button();
  const restore = button();
  const restoreLabel = { textContent: "Restaurar compras" };
  restore.querySelector = (selector) => selector === "span" ? restoreLabel : null;
  let modal = null;
  const alerts = [];
  const warnings = [];
  const requests = [];
  const completions = [];

  function PaymentRequest(methods, details) {
    requests.push({ methods, details });
    this.show = async () => paymentResponse || {
      details: { purchaseToken: "purchase-token-for-test" },
      complete: async (result) => completions.push(result),
    };
  }

  const document = {
    body: { appendChild(element) { modal = element; } },
    createElement() {
      const element = button();
      element.style = {};
      element.remove = () => { if (modal === element) modal = null; };
      element.querySelector = (selector) => ({
        ".pricing-plans": plans,
        ".play-billing-status": status,
        ".close-btn": close,
        ".play-restore": restore,
      })[selector] || null;
      return element;
    },
    getElementById(id) { return id === "play-billing-modal" ? modal : null; },
  };
  const window = {
    esContextoPlayTwa: () => inTwa,
    PaymentRequest,
    getDigitalGoodsService: async () => service,
    usuarioActual: { uid: "test-user", getIdToken: async () => "firebase-id-token" },
    alert: (message) => alerts.push(message),
    console: { warn: (_message, details) => warnings.push(details) },
    fetch: async () => fetchResponse || { ok: true, json: async () => ({ premiumActive: true }) },
  };
  vm.runInNewContext(source, {
    window,
    document,
    fetch: window.fetch,
    Intl,
    navigator: { language: "es-ES" },
  });
  return { window, plans, status, alerts, warnings, requests, completions, restore, restoreLabel, get modal() { return modal; } };
}

async function availability({ inTwa, paymentRequest, digitalGoods }) {
  const window = {
    esContextoPlayTwa: () => inTwa,
    PaymentRequest: paymentRequest ? function PaymentRequest() {} : undefined,
    getDigitalGoodsService: digitalGoods ? async () => ({}) : undefined,
  };
  vm.runInNewContext(source, { window, document: {}, Intl, navigator: { language: "es-ES" } });
  return window.PlayBillingService.isAvailable();
}

(async () => {
  assert.strictEqual(await availability({ inTwa: true, paymentRequest: true, digitalGoods: true }), true);
  assert.strictEqual(await availability({ inTwa: false, paymentRequest: true, digitalGoods: true }), false);
  assert.strictEqual(await availability({ inTwa: true, paymentRequest: false, digitalGoods: true }), false);

  const products = [
    { itemId: "premium_monthly", title: "Mensual", price: { currency: "EUR", value: "2.99" } },
    { itemId: "premium_yearly", title: "Anual", price: { currency: "EUR", value: "29.99" } },
  ];
  const loaded = billingWindow({ service: { getDetails: async (ids) => {
    assert.deepStrictEqual(Array.from(ids), ["premium_monthly", "premium_yearly"]);
    return products;
  }, listPurchases: async () => [] } });
  await loaded.window.PlayBillingService.openPremiumModal();
  assert(loaded.modal.className.includes("modal-overlay"), "el selector debe usar el overlay visible de la aplicación");
  assert.strictEqual(loaded.status.textContent, "Elige un plan para continuar con Google Play.");
  assert.strictEqual(loaded.plans.children.length, 2, "debe renderizar ambos productos de Play");

  // This is the callback registered on each rendered plan. It must create the
  // official Payment Request with the Play method, then verify its token.
  await loaded.plans.children[0].listeners.click();
  assert.strictEqual(loaded.requests[0].methods.length, 1);
  assert.strictEqual(loaded.requests[0].methods[0].supportedMethods, STORE);
  assert.strictEqual(loaded.requests[0].methods[0].data.sku, "premium_monthly");
  assert.strictEqual(loaded.requests[0].details.total.label, "Total");
  assert.strictEqual(loaded.requests[0].details.total.amount.currency, "EUR");
  assert.strictEqual(loaded.requests[0].details.total.amount.value, "0");
  assert.deepStrictEqual(loaded.completions, ["success"]);

  await loaded.restore.listeners.click();
  assert.strictEqual(loaded.restore.disabled, false);
  assert.strictEqual(loaded.restoreLabel.textContent, "Restaurar compras");
  assert.strictEqual(loaded.status.textContent, "No hay compras activas para restaurar.");

  const unavailable = billingWindow({ service: { getDetails: async () => { throw new Error("products_unavailable"); } } });
  await unavailable.window.PlayBillingService.openPremiumModal();
  assert.match(unavailable.status.textContent, /No se han podido cargar los planes/);
  assert.strictEqual(unavailable.warnings.length, 1);
  assert.strictEqual(unavailable.warnings[0].stage, "load_products");
  assert.strictEqual(unavailable.warnings[0].code, "products_unavailable");

  const ui = fs.readFileSync(path.join(repoRoot, "src/js/app/ui.js"), "utf8");
  const index = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const androidManifest = fs.readFileSync(path.join(repoRoot, "android/twa/app/src/main/AndroidManifest.xml"), "utf8");
  const delegationService = fs.readFileSync(path.join(repoRoot, "android/twa/app/src/main/java/es/balancelaboral/app/DelegationService.java"), "utf8");
  const backend = fs.readFileSync(path.join(repoRoot, "functions/index.js"), "utf8");
  assert.match(ui, /window\.abrirModalPremium[\s\S]*PlayBillingService\.openPremiumModal/);
  assert.match(index, /id="btn-upgrade"[\s\S]*onclick="abrirModalPremium\(\)"/);
  assert.match(index, /src\/js\/app\/play-billing-service\.js/);
  assert.match(androidManifest, /playbilling\.provider\.PaymentActivity/);
  assert.match(androidManifest, /playbilling\.provider\.PaymentService/);
  assert.match(delegationService, /DigitalGoodsRequestHandler/);
  assert.match(backend, /serviceAccount: PLAY_BILLING_RUNTIME_SERVICE_ACCOUNT/);
  assert.match(backend, /GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT/);
  assert.match(backend, /payload\.email !== PLAY_BILLING_RTDN_PUSH_SERVICE_ACCOUNT/);
  assert.match(backend, /payload\.email_verified !== true/);
  console.log("Play Billing web checks passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
