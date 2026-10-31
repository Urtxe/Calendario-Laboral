"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const play = require("./play-billing");
const lifecycle = require("./account-lifecycle");

const source = readFileSync(path.join(__dirname, "index.js"), "utf8");
function section(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert(first >= 0 && last > first, `Missing source boundaries: ${start}`);
    return source.slice(first, last);
}

// Model optimistic transactions: reads record versions, writes remain buffered,
// and a concurrent barrier commit forces the entire callback to run again.
function firestore(initial = {}) {
    const rows = new Map();
    const versions = new Map();
    const copy = (value) => value === undefined ? undefined : structuredClone(value);
    const db = {
        commits: [],
        retries: 0,
        beforeCommit: null,
        write(key, value) {
            if (value === undefined) rows.delete(key);
            else rows.set(key, copy(value));
            versions.set(key, (versions.get(key) || 0) + 1);
        },
        read: (key) => copy(rows.get(key)),
        collection(name) {
            return { doc: (id) => ({
                id,
                path: `${name}/${id}`,
                get: async () => snapshot(`${name}/${id}`),
            }) };
        },
        async runTransaction(callback) {
            for (let attempt = 0; attempt < 8; attempt += 1) {
                const reads = new Map();
                const writes = [];
                const result = await callback({
                    async get(ref) {
                        assert.equal(writes.length, 0, "Firestore reads must precede writes");
                        reads.set(ref.path, versions.get(ref.path) || 0);
                        return snapshot(ref.path);
                    },
                    set: (ref, value, options) => writes.push({ key: ref.path, value: copy(value), merge: options && options.merge }),
                    update: (ref, value) => writes.push({ key: ref.path, value: copy(value), merge: true }),
                });
                const hook = db.beforeCommit;
                db.beforeCommit = null;
                if (hook) await hook();
                if ([...reads].some(([key, version]) => (versions.get(key) || 0) !== version)) {
                    db.retries += 1;
                    continue;
                }
                for (const { key, value, merge } of writes) {
                    db.write(key, merge ? { ...db.read(key), ...value } : value);
                    db.commits.push(key);
                }
                return result;
            }
            throw new Error("Transaction retry limit exceeded");
        },
    };
    function snapshot(key) {
        const value = db.read(key);
        return { exists: value !== undefined, data: () => copy(value) };
    }
    for (const [key, value] of Object.entries(initial)) db.write(key, value);
    return db;
}

const token = "purchase-token-for-lifecycle-test";
const purchasePath = `playBillingPurchases/${play.hashPurchaseToken(token)}`;
const normalized = {
    productId: "premium_monthly",
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    expiryTime: "2099-01-01T00:00:00Z",
    entitled: true,
    autoRenewEnabled: true,
    acknowledgementPending: true,
};

function handlers(db, lookup = async () => ({})) {
    const calls = { acknowledgements: 0, lookups: 0 };
    const context = vm.createContext({
        db, ...play, ...lifecycle,
        FieldValue: { serverTimestamp: () => "server-timestamp" },
        normalizeSubscriptionPurchase: () => normalized,
        playDeveloperClient: {
            getSubscription: async () => { calls.lookups += 1; return lookup(); },
            acknowledgeSubscription: async () => { calls.acknowledgements += 1; },
        },
        console: { warn() {}, error() {} },
        Buffer,
        exports: {},
        onRequest: (_options, handler) => handler,
        PLAY_BILLING_FUNCTION_OPTIONS: {},
        projectId: "demo-balance-play",
        PLAY_BILLING_RTDN_PUSH_SERVICE_ACCOUNT: "push@example.test",
        verifyRtdnOidcToken: async () => {},
    });
    vm.runInContext([
        section("function playBillingError(", "// Authenticated endpoint used exclusively"),
        section("async function updatePremiumEntitlements(", "async function activatePremiumFromStripe("),
        section("async function liquidarReservaCuotaIA(", "function nombreEventoRespuesta("),
        section("exports.googlePlayRtdn =", "\n});") + "\n});",
    ].join("\n"), context);
    return { context, calls };
}

function persist(context, options = {}) {
    return context.persistVerifiedGooglePlayPurchase({
        uid: "user-1", purchaseToken: token, normalizedPurchase: normalized, source: "rtdn", ...options,
    });
}

test("normal and duplicate verified purchases update one linked entitlement", async () => {
    const db = firestore({ "usuarios/user-1": { email: "kept@example.test" } });
    const { context } = handlers(db);
    assert.equal(await persist(context), true);
    assert.equal(await persist(context), true);
    assert.equal(db.read("usuarios/user-1").email, "kept@example.test");
    assert.equal(db.read("usuarios/user-1").billing.googlePlay.active, true);
    assert.equal(db.read(purchasePath).uid, "user-1");
});

test("a deletion barrier committed after Play reads retries and discards buffered writes", async () => {
    const db = firestore({ "usuarios/user-1": {}, [purchasePath]: { uid: "user-1" } });
    const { context } = handlers(db);
    db.beforeCommit = () => lifecycle.ensureAccountDeletionBarrier(db, "user-1");
    assert.equal(await persist(context), null);
    assert.equal(db.retries, 1);
    assert.deepEqual(db.read("usuarios/user-1"), {});
    assert.deepEqual(db.read(purchasePath), { uid: "user-1" });
    assert.deepEqual(db.commits, ["accountDeletions/user-1"]);
});

test("missing and deletion-blocked profiles cannot be recreated by purchase or restore", async () => {
    for (const initial of [{}, { "usuarios/user-1": {}, "accountDeletions/user-1": { accountDeleted: true } }]) {
        const db = firestore(initial);
        const { context } = handlers(db);
        assert.equal(await persist(context), null);
        for (const source of ["purchase", "restore"]) {
            await assert.rejects(persist(context, { source }), (error) => error.code === "account_unavailable");
        }
        assert.deepEqual(db.commits, []);
    }
});

test("retained token tombstones reject transfer to another existing account", async () => {
    const db = firestore({ "usuarios/new-user": {}, [purchasePath]: { accountDeleted: true } });
    const { context } = handlers(db);
    await assert.rejects(persist(context, { uid: "new-user", source: "restore" }), (error) => error.code === "purchase_already_linked");
    assert.deepEqual(db.read(purchasePath), { accountDeleted: true });
    assert.deepEqual(db.commits, []);
});

test("ignored RTDN verification does not acknowledge the purchase", async () => {
    const db = firestore({ "accountDeletions/user-1": { accountDeleted: true } });
    const { context, calls } = handlers(db);
    const result = await context.verifyAndPersistGooglePlayPurchase({
        uid: "user-1", purchaseToken: token, requestedProductId: "premium_monthly", source: "rtdn",
    });
    assert.equal(result.ignored, true);
    assert.equal(calls.lookups, 1);
    assert.equal(calls.acknowledgements, 0);
    assert.deepEqual(db.commits, []);
});

test("late and duplicate RTDN deliveries after a stale UID lookup return 204 without recreation", async () => {
    const db = firestore({ "usuarios/user-1": {}, [purchasePath]: { uid: "user-1", productId: "premium_monthly" } });
    const { context, calls } = handlers(db, async () => {
        await lifecycle.ensureAccountDeletionBarrier(db, "user-1");
        db.write("usuarios/user-1", undefined);
        db.write(purchasePath, { accountDeleted: true });
    });
    const request = { method: "POST", body: { message: { data: Buffer.from(JSON.stringify({
        packageName: play.PLAY_PACKAGE_NAME,
        subscriptionNotification: { purchaseToken: token },
    })).toString("base64") } } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = { status(code) { this.code = code; return this; }, send() { return this; } };
        await context.exports.googlePlayRtdn(request, response);
        assert.equal(response.code, 204);
    }
    assert.equal(calls.lookups, 1);
    assert.equal(calls.acknowledgements, 0);
    assert.equal(db.read("usuarios/user-1"), undefined);
    assert.deepEqual(db.read(purchasePath), { accountDeleted: true });
});

test("Stripe skips missing or blocked profiles and retries a concurrent deletion barrier", async () => {
    for (const initial of [{}, { "usuarios/user-1": {}, "accountDeletions/user-1": { accountDeleted: true } }]) {
        const db = firestore(initial);
        const { context } = handlers(db);
        assert.equal(await context.updatePremiumEntitlements(db.collection("usuarios").doc("user-1"), "stripe", { active: true }), false);
        assert.deepEqual(db.commits, []);
    }
    const db = firestore({ "usuarios/user-1": {} });
    const { context } = handlers(db);
    db.beforeCommit = () => lifecycle.ensureAccountDeletionBarrier(db, "user-1");
    assert.equal(await context.updatePremiumEntitlements(db.collection("usuarios").doc("user-1"), "stripe", { active: true }), false);
    assert.equal(db.retries, 1);
    assert.deepEqual(db.read("usuarios/user-1"), {});
});

test("quota settlement cannot recreate subcollections of a blocked account", async () => {
    const db = firestore({ "accountDeletions/user-1": { accountDeleted: true } });
    const { context } = handlers(db);
    assert.equal(await context.liquidarReservaCuotaIA({
        userRef: db.collection("usuarios").doc("user-1"),
        reservationRef: { path: "usuarios/user-1/reservations/pending" },
    }, { consume: true }), false);
    assert.deepEqual(db.commits, []);
});

test("Stripe changes preserve an independently active Play entitlement", async () => {
    const db = firestore({ "usuarios/user-1": { billing: { googlePlay: { active: true } } } });
    const { context } = handlers(db);
    const ref = db.collection("usuarios").doc("user-1");
    assert.equal(await context.updatePremiumEntitlements(ref, "stripe", { active: true }), true);
    assert.equal(await context.updatePremiumEntitlements(ref, "stripe", { active: false }), true);
    assert.equal(db.read("usuarios/user-1").billing.googlePlay.active, true);
    assert.equal(db.read("usuarios/user-1").tipoCuenta, "premium");
});
