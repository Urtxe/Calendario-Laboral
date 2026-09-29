"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const functions = require("./index");
const expected = {
  stripeWebhook: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  deleteAccount: ["STRIPE_SECRET_KEY"],
  consultarConvenio: ["GEMINI_API_KEY"],
  metricasGa4: ["GA4_PROPERTY_ID"],
  syncOfficialHolidays: [],
  googlePlayRtdn: [],
  verifyGooglePlayPurchase: [],
  limpiarDatosAlBorrarUsuario: [],
};

test("each Function binds only its required secrets", () => {
  for (const [name, secrets] of Object.entries(expected)) {
    const bound = (functions[name].__endpoint.secretEnvironmentVariables || []).map(secret => secret.key);
    assert.deepEqual(bound.sort(), [...secrets].sort(), name);
  }
});

test("shared deploy environment does not contain scoped secrets", () => {
  for (const name of [".env", ".env.calendario-laboral-252b1"]) {
    const file = path.join(__dirname, name);
    if (!fs.existsSync(file)) continue;
    const keys = fs.readFileSync(file, "utf8").match(/^\s*(?:STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|GEMINI_API_KEY)\s*=/gm) || [];
    assert.equal(keys.length, 0, `${name} contains a scoped secret`);
  }
});
