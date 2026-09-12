"use strict";

const assert = require("assert");
const {
    hashPurchaseToken,
    validatePurchaseInput,
    normalizeSubscriptionPurchase,
    userHasPremiumEntitlement,
    buildGooglePlayEntitlement,
} = require("./play-billing");

function purchase({ state, expiryTime, productId = "premium_monthly" }) {
    return {
        subscriptionState: state,
        acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGEMENT_PENDING",
        lineItems: [{
            productId,
            expiryTime,
            autoRenewingPlan: { autoRenewEnabled: true },
            latestSuccessfulOrderId: "GPA.test",
        }],
    };
}

const future = "2030-01-01T00:00:00Z";
const expired = "2020-01-01T00:00:00Z";

assert.deepStrictEqual(validatePurchaseInput({ purchaseToken: "too-short", productId: "premium_monthly" }), {
    ok: false,
    code: "invalid_purchase_token",
});
assert.deepStrictEqual(validatePurchaseInput({ purchaseToken: "a-valid-play-token", productId: "not-premium" }), {
    ok: false,
    code: "unsupported_product",
});

const active = normalizeSubscriptionPurchase(purchase({
    state: "SUBSCRIPTION_STATE_ACTIVE",
    expiryTime: future,
}));
assert.strictEqual(active.entitled, true);
assert.strictEqual(active.acknowledgementPending, true);

const grace = normalizeSubscriptionPurchase(purchase({
    state: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    expiryTime: future,
}));
assert.strictEqual(grace.entitled, true);

const pending = normalizeSubscriptionPurchase(purchase({
    state: "SUBSCRIPTION_STATE_PENDING",
    expiryTime: future,
}));
assert.strictEqual(pending.entitled, false);

const revoked = normalizeSubscriptionPurchase(purchase({
    state: "SUBSCRIPTION_STATE_EXPIRED",
    expiryTime: expired,
}));
assert.strictEqual(revoked.entitled, false);

const playEntitlement = buildGooglePlayEntitlement({
    normalizedPurchase: active,
    purchaseToken: "a-valid-play-token",
    source: "purchase",
});
assert.strictEqual(playEntitlement.purchaseReference, hashPurchaseToken("a-valid-play-token"));
assert.strictEqual(
    hashPurchaseToken("a-valid-play-token"),
    hashPurchaseToken("a-valid-play-token"),
    "la misma compra debe usar la misma referencia idempotente",
);
assert.strictEqual(userHasPremiumEntitlement({ billing: { googlePlay: playEntitlement } }), true);
assert.strictEqual(userHasPremiumEntitlement({
    billing: { googlePlay: { active: false }, stripe: { active: true } },
}), true);
assert.strictEqual(userHasPremiumEntitlement({
    billing: { googlePlay: { active: false }, stripe: { active: false } },
}), false);

console.log("Play Billing backend checks passed.");
