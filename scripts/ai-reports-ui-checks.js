"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const callbacks = {};
const elements = [];
function createElement(tagName) {
  const element = {
    tagName,
    attributes: {},
    disabled: false,
    textContent: "",
    className: "",
    type: "",
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(name, callback) { callbacks[`${elements.length}:${name}`] = callback; },
    remove() { this.removed = true; },
  };
  elements.push(element);
  return element;
}
const requests = [];
const confirmations = [];
const window = {
  document: { createElement },
  usuarioActual: { getIdToken: async () => "firebase-token" },
  obtenerAppCheckToken: async () => "app-check-token",
  confirm: (message) => { confirmations.push(message); return true; },
  fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true };
  },
};
const servicePath = path.join(__dirname, "../src/js/app/ai-report-service.js");
vm.runInNewContext(fs.readFileSync(servicePath, "utf8"), { window });

async function main() {
  const container = { append(...children) { this.children = children; } };
  const answer = "Una respuesta de la IA";
  const button = window.LegalAIReports.attach(container, answer);
  assert.equal(button.textContent, "Informar de un problema");
  assert.equal(button.attributes["aria-label"], "Informar de un problema en esta respuesta");
  assert.equal(window.LegalAIReports.attach(container, answer), null, "a response gets one report button");
  await callbacks["2:click"]();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/aiReports");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer firebase-token");
  assert.equal(requests[0].options.headers["X-Firebase-AppCheck"], "app-check-token");
  assert.deepEqual(JSON.parse(requests[0].options.body), { reason: "other", response: answer });
  assert.equal(JSON.stringify(requests[0].options.body).includes("question"), false);
  assert.equal(button.removed, true);

  const longContainer = { append(...children) { this.children = children; } };
  window.LegalAIReports.attach(longContainer, "x".repeat(9_000));
  await callbacks["4:click"]();
  const longPayload = JSON.parse(requests[1].options.body);
  assert.equal(longPayload.response.length, 8_000);
  assert.match(confirmations[1], /primeros 8\.000 caracteres/);

  const firebaseSource = fs.readFileSync(path.join(__dirname, "../src/js/firebase-config.js"), "utf8");
  const tokenStart = firebaseSource.indexOf("window.obtenerAppCheckToken = async function()");
  const tokenEnd = firebaseSource.indexOf("\n};", tokenStart);
  assert(tokenStart >= 0 && tokenEnd > tokenStart);
  vm.runInNewContext(firebaseSource.slice(tokenStart, tokenEnd) + "\n};", {
    window,
    appCheck: { getToken: async () => { throw Object.assign(new Error("Automated attestation rejected"), { code: "appCheck/throttled" }); } },
    appCheckSiteKey: "test-site-key",
    firebase: { appCheck: {} },
    logAppCheckDebug() {},
  });
  const withoutAttestation = { append(...children) { this.children = children; } };
  window.LegalAIReports.attach(withoutAttestation, answer);
  await callbacks["6:click"]();
  assert.equal(requests.length, 3, "An attestation rejection does not prevent a Firebase-authenticated report request");
  assert.equal(requests[2].options.headers.Authorization, "Bearer firebase-token");
  assert.equal(requests[2].options.headers["X-Firebase-AppCheck"], undefined);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
