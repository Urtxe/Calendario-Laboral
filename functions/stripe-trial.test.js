"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { userHasPremiumEntitlement } = require("./play-billing");

const source = readFileSync(path.join(__dirname, "index.js"), "utf8");
const start = source.indexOf("function getStripeId(");
const end = source.indexOf("// 1. WEBHOOK DE STRIPE", start);
assert(start >= 0 && end > start, "Missing Stripe handler source boundaries");
const stripeSource = source.slice(start, end);

function setup({ user = {}, blocked = false, subscription = null } = {}) {
    let storedUser = structuredClone(user);
    const userRef = {
        id: "user-1",
        async get() { return { exists: true, data: () => structuredClone(storedUser) }; },
    };
    const db = {
        collection(name) {
            assert.equal(name, "usuarios");
            return { doc: () => userRef };
        },
        async runTransaction(callback) {
            const writes = [];
            const result = await callback({
                get: async () => ({ exists: true, data: () => structuredClone(storedUser) }),
                set: (_ref, value, options) => writes.push({ value, merge: options && options.merge }),
            });
            for (const write of writes) {
                storedUser = write.merge ? { ...storedUser, ...write.value } : write.value;
            }
            return result;
        },
    };
    const context = vm.createContext({
        db,
        premiumStripePriceIds: [],
        premiumStripeProductIds: ["prod-premium"],
        userHasPremiumEntitlement,
        hasAccountDeletionBarrier: async () => blocked,
        FieldValue: { serverTimestamp: () => "server-timestamp" },
        stripeWarn() {},
        stripeLog() {},
        getStripeClient: () => ({
            subscriptions: { retrieve: async () => subscription },
        }),
        console,
    });
    vm.runInContext(stripeSource, context);
    return { context, readUser: () => structuredClone(storedUser) };
}

const futureEnd = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

test("completed no-payment checkout grants a verified trial only until trial_end", async () => {
    const subscription = {
        id: "sub-trial",
        status: "trialing",
        trial_end: futureEnd,
        current_period_end: futureEnd + 100,
        cancel_at_period_end: false,
        items: { data: [{
            current_period_end: futureEnd + 500,
            price: { id: "price-premium", product: "prod-premium" },
        }] },
    };
    const { context, readUser } = setup({ subscription });
    await context.handleCheckoutSessionCompleted({
        status: "complete",
        mode: "subscription",
        payment_status: "no_payment_required",
        client_reference_id: "user-1",
        customer: "cus-1",
        subscription: "sub-trial",
    });
    const user = readUser();
    assert.equal(user.billing.stripe.status, "trialing");
    assert.equal(user.billing.stripe.expiresAt, new Date(futureEnd * 1000).toISOString());
    assert.equal(user.stripeCurrentPeriodEnd, futureEnd);
    assert.equal(user.tipoCuenta, "premium");
});

test("subscription updates grant future trials and reject expired trials despite stale premium flags", async () => {
    const { context, readUser } = setup({
        user: { tipoCuenta: "premium" },
        subscription: {
            id: "sub-trial",
            status: "trialing",
            items: { data: [{
                current_period_end: futureEnd,
                price: { id: "price-premium", product: "prod-premium" },
            }] },
        },
    });
    await context.handleSubscriptionUpdated({
        id: "sub-trial", status: "trialing", trial_end: futureEnd, metadata: { uid: "user-1" }, customer: "cus-1",
        items: { data: [{ price: { id: "price-premium", product: "prod-premium" } }] },
    });
    assert.equal(readUser().billing.stripe.active, true);

    const expiredUser = {
        tipoCuenta: "premium",
        billing: { stripe: { active: true, status: "trialing", expiresAt: new Date(Date.now() - 1000).toISOString() } },
    };
    assert.equal(userHasPremiumEntitlement(expiredUser), false);
});

test("trials without a future end fail closed and deletion barriers still block writes", async () => {
    const missingEnd = setup({ subscription: {
        id: "sub-trial", status: "trialing", items: { data: [{ price: { id: "price-premium", product: "prod-premium" } }] },
    } });
    await missingEnd.context.handleSubscriptionUpdated({
        id: "sub-trial", status: "trialing", metadata: { uid: "user-1" }, customer: "cus-1",
        items: { data: [{ price: { id: "price-premium", product: "prod-premium" } }] },
    });
    assert.equal(missingEnd.readUser().billing, undefined);

    const blocked = setup({ blocked: true, subscription: {
        id: "sub-trial", status: "trialing", items: { data: [{ current_period_end: futureEnd, price: { id: "price-premium", product: "prod-premium" } }] },
    } });
    await blocked.context.handleSubscriptionUpdated({
        id: "sub-trial", status: "trialing", trial_end: futureEnd, metadata: { uid: "user-1" }, customer: "cus-1",
        items: { data: [{ current_period_end: futureEnd, price: { id: "price-premium", product: "prod-premium" } }] },
    });
    assert.deepEqual(blocked.readUser(), {});
});

test("provider expiry checks accept Unix seconds and prevent manual premium fallback", () => {
    assert.equal(userHasPremiumEntitlement({ billing: { stripe: {
        active: true, status: "active", expiresAt: futureEnd,
    } } }), true);
    assert.equal(userHasPremiumEntitlement({ billing: { stripe: {
        active: true, status: "active", expiresAt: Math.floor(Date.now() / 1000) - 1,
    } }, tipoCuenta: "premium" }), false);
    assert.equal(userHasPremiumEntitlement({ billing: { stripe: {
        active: true, status: "trialing",
    } }, tipoCuenta: "premium" }), false);
});

test("paid active subscriptions keep access through the matched item's billing period", async () => {
    const { context, readUser } = setup();
    await context.handleSubscriptionUpdated({
        id: "sub-paid", status: "active", metadata: { uid: "user-1" }, customer: "cus-1",
        items: { data: [{ current_period_end: futureEnd, price: { id: "price-premium", product: "prod-premium" } }] },
    });
    assert.equal(readUser().tipoCuenta, "premium");
    assert.equal(readUser().billing.stripe.expiresAt, new Date(futureEnd * 1000).toISOString());
});

test("trial cancellation at period end keeps access; immediate cancellation preserves independent Play", async () => {
    const { context, readUser } = setup({ user: { billing: { googlePlay: { active: true, expiresAt: futureEnd } } } });
    const trial = {
        id: "sub-trial", status: "trialing", trial_end: futureEnd, cancel_at_period_end: true,
        metadata: { uid: "user-1" }, customer: "cus-1",
        items: { data: [{ price: { id: "price-premium", product: "prod-premium" } }] },
    };
    await context.handleSubscriptionUpdated(trial);
    assert.equal(readUser().billing.stripe.cancelAtPeriodEnd, true);
    assert.equal(readUser().billing.stripe.active, true);
    await context.handleSubscriptionUpdated({ ...trial, status: "canceled" });
    assert.equal(readUser().billing.stripe.active, false);
    assert.equal(readUser().tipoCuenta, "premium");
});

test("unpaid one-time checkout never grants a trial or Premium", async () => {
    const { context, readUser } = setup();
    await context.handleCheckoutSessionCompleted({ status: "complete", mode: "payment", payment_status: "unpaid", client_reference_id: "user-1" });
    assert.deepEqual(readUser(), {});
});
