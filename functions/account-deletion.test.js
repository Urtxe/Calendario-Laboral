"use strict";

const assert = require("assert");
const {
    RECENT_AUTH_MAX_AGE_SECONDS,
    cancelStripeSubscriptionForAccountDeletion,
    deleteAccountSafely,
    deleteFirestoreAccountTree,
    removeStripeCustomerWhenPossible,
    verifyRecentAuthenticatedUser,
} = require("./account-deletion");

const tests = [];

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
    const db = {
        collection: () => ({
            doc: () => ({
                get: async () => ({
                    exists: true,
                    data: () => ({ stripeSubscriptionId: "sub-1", subscriptionStatus: "active" }),
                }),
            }),
        }),
        recursiveDelete: async () => calls.push("firestore"),
    };
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
    const userRef = {
        get: async () => ({
            exists: true,
            data: () => ({ stripeSubscriptionId: "sub-1", stripeCustomerId: "cus-1" }),
        }),
    };
    const db = {
        collection: () => ({ doc: () => userRef }),
        recursiveDelete: async () => calls.push("firestore"),
    };
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
