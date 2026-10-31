"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { userHasPremiumEntitlement } = require("../functions/play-billing");
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/js/app/premium-access.js"), "utf8"), { window, Date, Number });
const future = "2099-01-01T00:00:00Z";
const past = "2000-01-01T00:00:00Z";
for (const data of [
  {}, { tipoCuenta: "premium" },
  { tipoCuenta: "premium", billing: { stripe: { active: true, status: "trialing", expiresAt: future } } },
  { tipoCuenta: "premium", billing: { stripe: { active: true, status: "trialing", expiresAt: past } } },
  { tipoCuenta: "premium", billing: { stripe: { active: true, status: "trialing" } } },
  { billing: { stripe: { active: false }, googlePlay: { active: true, expiresAt: future } } },
  { stripeSubscriptionId: "legacy", subscriptionStatus: "active", stripeCurrentPeriodEnd: 4070908800 },
  { stripeSubscriptionId: "legacy", subscriptionStatus: "canceled", tipoCuenta: "premium" },
  { tipoCuenta: "premium", billing: { googlePlay: { active: false } } },
]) assert.equal(window.PremiumAccess.isPremium(data), userHasPremiumEntitlement(data), "Client and backend must agree on expiry/provider access");
const trial = { tipoCuenta: "premium", billing: { stripe: { active: true, status: "trialing", expiresAt: future } } };
assert(window.PremiumAccess.isPremium(trial, Date.parse(future) - 1));
assert.equal(window.PremiumAccess.isPremium(trial, Date.parse(future)), false, "A tab open beyond trial expiry loses access");
const state = fs.readFileSync(path.join(__dirname, "../src/js/app/state.js"), "utf8");
assert.match(state, /function usuarioPuedeUsarPremium\(\)[\s\S]*PremiumAccess\.isPremium/);
console.log("PASS Premium access: expiry, legacy timestamps, trial state and independent providers agree with backend.");
