"use strict";

const assert = require("assert");
const {
    RECENT_AUTH_MAX_AGE_SECONDS,
    cancelStripeSubscriptionForAccountDeletion,
    cleanupDeletedAccount,
    deleteAccountSafely,
    deleteFirestoreAccountTree,
    removeStripeCustomerWhenPossible,
    verifyRecentAuthenticatedUser,
} = require("./account-deletion");

const tests = [];

function mockFirestore({ userData = null, purchases = [], recursiveDelete = async () => {} } = {}) {
    const barrierData = new Map();
    const purchaseData = new Map(purchases.map((purchase, index) => [String(index), { ...purchase }]));
    const db = {
        collection(name) {
            if (name === "accountDeletions") {
                return { doc: (uid) => ({
                    get: async () => ({ exists: barrierData.has(uid), data: () => barrierData.get(uid) }),
                    set: async (value) => barrierData.set(uid, value),
                }) };
            }
            if (name === "playBillingPurchases") {
                return { where: (field, operator, value) => ({
                    limit: () => ({ get: async () => {
                        const docs = [...purchaseData.entries()]
                            .filter(([, row]) => row[field] === value)
                            .slice(0, 400)
                            .map(([id, row]) => ({ id, ref: { id }, data: () => row }));
                        return { docs, empty: docs.length === 0 };
                    } }),
                }) };
            }
            return { doc: (uid) => ({ get: async () => ({ exists: Boolean(userData), data: () => userData }) }) };
        },
        batch() {
            const writes = [];
            return {
                set: (ref, value) => writes.push([ref.id, value]),
                commit: async () => writes.forEach(([id, value]) => purchaseData.set(id, value)),
            };
        },
        async runTransaction(callback) {
            return callback({
                get: async (ref) => ({ exists: barrierData.has(ref.path || "user-1"), data: () => barrierData.get(ref.path || "user-1") }),
                set: (ref, value) => barrierData.set(ref.path || "user-1", value),
            });
        },
        recursiveDelete,
        barrierData,
        purchaseData,
    };
    // Transaction doc references in this minimal test double carry their UID.
    const originalCollection = db.collection.bind(db);
    db.collection = (name) => {
        const collection = originalCollection(name);
        if (name === "accountDeletions") {
            const originalDoc = collection.doc;
            collection.doc = (uid) => ({ ...originalDoc(uid), path: uid });
        }
        return collection;
    };
    return db;
}

function test(name, fn) {
    tests.push({ name, fn });
}

function resourceMissingError() {
    const error = new Error("missing");
    error.code = "resource_missing";
    return error;
}

test("rechaza borrado sin token", async () => {
    const result = await verifyRecentAuthenticatedUser({
        auth: { verifyIdToken: async () => ({ uid: "never" }) },
        idToken: "",
        nowSeconds: 1000,
    });

    assert.deepStrictEqual(result.ok, false);
    assert.strictEqual(result.code, "unauthenticated");
});

test("acepta solo un token autenticado recientemente", async () => {
    const nowSeconds = 10_000;
    const auth = {
        verifyIdToken: async () => ({ uid: "user-1", auth_time: nowSeconds - 60 }),
    };
    const valid = await verifyRecentAuthenticatedUser({ auth, idToken: "token", nowSeconds });
    assert.deepStrictEqual(valid, { ok: true, uid: "user-1" });

    auth.verifyIdToken = async () => ({
        uid: "user-1",
        auth_time: nowSeconds - RECENT_AUTH_MAX_AGE_SECONDS - 1,
    });
    const expired = await verifyRecentAuthenticatedUser({ auth, idToken: "token", nowSeconds });
    assert.strictEqual(expired.code, "requires_recent_login");
});

test("borra recursivamente el arbol de usuarios, incluidas subcolecciones futuras como usage/ai", async () => {
    const userRef = { path: "usuarios/user-1" };
    let recursivelyDeleted = null;
    const db = {
        collection: (name) => ({
            doc: (uid) => {
                assert.strictEqual(name, "usuarios");
                assert.strictEqual(uid, "user-1");
                return userRef;
            },
        }),
        recursiveDelete: async (ref) => {
            recursivelyDeleted = ref;
        },
    };

    await deleteFirestoreAccountTree({ db, uid: "user-1" });
    assert.strictEqual(recursivelyDeleted, userRef);
});

test("un error de Stripe al cancelar impide borrar Firestore y Firebase Auth", async () => {
    const calls = [];
    const db = mockFirestore({ userData: { stripeSubscriptionId: "sub-1", subscriptionStatus: "active" }, recursiveDelete: async () => calls.push("firestore") });
    const auth = { deleteUser: async () => calls.push("auth") };
    const stripe = {
        subscriptions: {
            retrieve: async () => ({ status: "active" }),
            cancel: async () => {
                throw new Error("Stripe unavailable");
            },
        },
        customers: { del: async () => calls.push("customer") },
    };

    await assert.rejects(
        () => deleteAccountSafely({ db, auth, stripe, stripeConfigured: true, uid: "user-1" }),
        (error) => error.code === "stripe_subscription_cancel_failed",
    );
    assert.deepStrictEqual(calls, []);
});

test("cancela una suscripcion activa inmediatamente antes del borrado", async () => {
    const calls = [];
    const stripe = {
        subscriptions: {
            retrieve: async (id) => {
                calls.push(`retrieve:${id}`);
                return { status: "active" };
            },
            cancel: async (id) => calls.push(`cancel:${id}`),
        },
    };

    const result = await cancelStripeSubscriptionForAccountDeletion({
        stripe,
        subscriptionId: "sub-1",
        uid: "user-1",
    });

    assert.deepStrictEqual(calls, ["retrieve:sub-1", "cancel:sub-1"]);
    assert.strictEqual(result.status, "cancelled");
    assert.strictEqual(result.endsImmediately, true);
});

test("no intenta cancelar una suscripcion ya terminal", async () => {
    const stripe = {
        subscriptions: {
            retrieve: async () => ({ status: "canceled" }),
            cancel: async () => assert.fail("no debe cancelar una suscripcion ya cancelada"),
        },
    };

    const result = await cancelStripeSubscriptionForAccountDeletion({
        stripe,
        subscriptionId: "sub-1",
        uid: "user-1",
    });
    assert.strictEqual(result.status, "already_inactive");
});

test("continua si el cliente Stripe no puede eliminarse y deja constancia de retencion", async () => {
    const stripe = {
        customers: {
            del: async () => {
                throw new Error("retained for accounting");
            },
        },
    };

    const result = await removeStripeCustomerWhenPossible({
        stripe,
        customerId: "cus-1",
        uid: "user-1",
    });
    assert.strictEqual(result.status, "retained");
});

test("una suscripcion ya eliminada en Stripe no bloquea el borrado", async () => {
    const stripe = {
        subscriptions: { retrieve: async () => { throw resourceMissingError(); } },
    };
    const result = await cancelStripeSubscriptionForAccountDeletion({
        stripe,
        subscriptionId: "sub-missing",
        uid: "user-1",
    });
    assert.strictEqual(result.status, "not_found");
});

test("elimina Auth solo despues de cancelar Stripe y borrar Firestore", async () => {
    const calls = [];
    const db = mockFirestore({ userData: { stripeSubscriptionId: "sub-1", stripeCustomerId: "cus-1" }, recursiveDelete: async () => calls.push("firestore") });
    const stripe = {
        subscriptions: {
            retrieve: async () => ({ status: "active" }),
            cancel: async () => calls.push("subscription"),
        },
        customers: { del: async () => calls.push("customer") },
    };
    const auth = { deleteUser: async () => calls.push("auth") };

    await deleteAccountSafely({ db, auth, stripe, stripeConfigured: true, uid: "user-1" });
    assert.deepStrictEqual(calls, ["subscription", "customer", "firestore", "auth"]);
});

test("marker duradero permite reintentar borrado parcial sin repetir Stripe", async () => {
    let deletes = 0;
    const db = mockFirestore({
        userData: { stripeSubscriptionId: "sub-1" },
        recursiveDelete: async () => {
            deletes += 1;
            if (deletes === 1) throw new Error("temporary recursive delete failure");
        },
    });
    const stripeCalls = [];
    const stripe = {
        subscriptions: {
            retrieve: async () => { stripeCalls.push("retrieve"); return { status: "active" }; },
            cancel: async () => stripeCalls.push("cancel"),
        },
        customers: { del: async () => {} },
    };
    const auth = { deleteUser: async () => {} };

    await assert.rejects(() => deleteAccountSafely({ db, auth, stripe, stripeConfigured: true, uid: "user-1" }));
    assert.deepStrictEqual(db.barrierData.get("user-1"), {
        accountDeleted: true,
        subscription: { status: "cancelled", endsImmediately: true },
        customer: { status: "not_linked" },
    });
    await deleteAccountSafely({ db, auth, stripe, stripeConfigured: false, uid: "user-1" });
    assert.deepStrictEqual(stripeCalls, ["retrieve", "cancel"]);
    assert.strictEqual(deletes, 2);
});

test("neutraliza compras conservando solo la huella de anti-transferencia", async () => {
    const db = mockFirestore({
        purchases: [
            { uid: "user-1", productId: "premium", status: "active", token: "secret" },
            { uid: "other", productId: "premium", status: "active", token: "other" },
        ],
    });
    const auth = { deleteUser: async () => {} };
    await deleteAccountSafely({ db, auth, stripeConfigured: false, uid: "user-1" });
    assert.deepStrictEqual(db.purchaseData.get("0"), { accountDeleted: true });
    assert.deepStrictEqual(db.purchaseData.get("1"), { uid: "other", productId: "premium", status: "active", token: "other" });
});

test("el borrado de Auth es idempotente cuando ya no existe el usuario", async () => {
    const db = mockFirestore();
    const auth = { deleteUser: async () => { const error = new Error("missing"); error.code = "auth/user-not-found"; throw error; } };
    const result = await deleteAccountSafely({ db, auth, stripeConfigured: false, uid: "user-1" });
    assert.strictEqual(result.subscription.status, "not_checked");
});

test("un fallo de Auth conserva el marcador y un reintento no repite Stripe", async () => {
    const db = mockFirestore({ userData: { stripeSubscriptionId: "sub-1" } });
    let stripeCalls = 0;
    let authCalls = 0;
    const stripe = {
        subscriptions: {
            retrieve: async () => { stripeCalls += 1; return { status: "active" }; },
            cancel: async () => { stripeCalls += 1; },
        },
        customers: { del: async () => {} },
    };
    const auth = { deleteUser: async () => {
        authCalls += 1;
        if (authCalls === 1) throw new Error("temporarily unavailable");
    } };

    await assert.rejects(() => deleteAccountSafely({ db, auth, stripe, stripeConfigured: true, uid: "user-1" }), (error) => error.code === "auth_delete_failed");
    assert.strictEqual(db.barrierData.has("user-1"), true);
    await deleteAccountSafely({ db, auth, stripe, stripeConfigured: false, uid: "user-1" });
    assert.strictEqual(stripeCalls, 2);
    assert.strictEqual(authCalls, 2);
});

test("limpia todas las páginas de compras en lotes seguros", async () => {
    const db = mockFirestore({ purchases: Array.from({ length: 805 }, (_, index) => ({ uid: "user-1", token: `token-${index}` })) });
    const auth = { deleteUser: async () => {} };
    await deleteAccountSafely({ db, auth, stripeConfigured: false, uid: "user-1" });
    assert.strictEqual(db.purchaseData.size, 805);
    assert([...db.purchaseData.values()].every((purchase) => Object.keys(purchase).length === 1 && purchase.accountDeleted === true));
});

test("borra cuentas gratuitas y Play sin cancelar, revocar o reembolsar compras Play", async () => {
    for (const userData of [{}, { billing: { googlePlay: { active: true, productId: "premium_monthly" } } }]) {
        const db = mockFirestore({ userData, purchases: [{ uid: "user-1", productId: "premium_monthly" }] });
        let authDeleted = 0;
        const forbidden = async () => assert.fail("no payment provider operation is expected");
        const result = await deleteAccountSafely({ db, auth: { deleteUser: async () => { authDeleted += 1; } },
            stripe: { subscriptions: { retrieve: forbidden, cancel: forbidden }, customers: { del: forbidden } },
            stripeConfigured: true, uid: "user-1" });
        assert.strictEqual(result.subscription.endsImmediately, false);
        assert.strictEqual(authDeleted, 1);
        assert.deepStrictEqual(db.purchaseData.get("0"), { accountDeleted: true });
    }
});

test("la limpieza externa Auth establece barrera y es repetible sin operaciones de pago", async () => {
    const db = mockFirestore({ purchases: [{ uid: "user-1" }] });
    await cleanupDeletedAccount({ db, uid: "user-1" });
    await cleanupDeletedAccount({ db, uid: "user-1" });
    assert.deepStrictEqual(db.barrierData.get("user-1"), { accountDeleted: true });
    assert.deepStrictEqual(db.purchaseData.get("0"), { accountDeleted: true });
});

async function run() {
    let failures = 0;
    for (const current of tests) {
        try {
            await current.fn();
            console.log(`OK  ${current.name}`);
        } catch (error) {
            failures += 1;
            console.error(`FAIL ${current.name}`);
            console.error(`     ${error.message}`);
        }
    }

    if (failures) process.exit(1);
    console.log(`\n${tests.length} comprobaciones de borrado de cuenta pasaron.`);
}

run();
