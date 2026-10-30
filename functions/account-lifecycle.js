"use strict";

const PURCHASE_PAGE_SIZE = 400;

function deletionBarrierRef(db, uid) {
    return db.collection("accountDeletions").doc(uid);
}

function sanitizeBillingResult(billing) {
    const source = billing || {};
    const subscription = source.subscription || {};
    const customer = source.customer || {};
    return {
        subscription: {
            status: typeof subscription.status === "string" ? subscription.status : "not_checked",
            endsImmediately: subscription.endsImmediately === true,
        },
        customer: {
            status: typeof customer.status === "string" ? customer.status : "not_checked",
        },
    };
}

// Retain this pseudonymous UID barrier indefinitely: it blocks stale-token writers,
// while purchase document hashes remain as the anti-transfer tombstones.
async function readAccountDeletionBarrier(db, uid) {
    const snapshot = await deletionBarrierRef(db, uid).get();
    return snapshot.exists ? snapshot.data() || {} : null;
}

async function createAccountDeletionBarrier(db, uid, billing) {
    const ref = deletionBarrierRef(db, uid);
    const value = { accountDeleted: true, ...sanitizeBillingResult(billing) };
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) return snapshot.data() || {};
        transaction.set(ref, value);
        return value;
    });
}

async function ensureAccountDeletionBarrier(db, uid) {
    const ref = deletionBarrierRef(db, uid);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) return snapshot.data() || {};
        const value = { accountDeleted: true };
        transaction.set(ref, value);
        return value;
    });
}

async function hasAccountDeletionBarrier({ db, uid, transaction }) {
    const ref = deletionBarrierRef(db, uid);
    const snapshot = transaction ? await transaction.get(ref) : await ref.get();
    return snapshot.exists;
}

async function neutralizePlayBillingPurchases(db, uid) {
    const collection = db.collection("playBillingPurchases");
    while (true) {
        const page = await collection.where("uid", "==", uid).limit(PURCHASE_PAGE_SIZE).get();
        if (page.empty || page.docs.length === 0) return;
        for (let offset = 0; offset < page.docs.length; offset += PURCHASE_PAGE_SIZE) {
            const batch = db.batch();
            for (const document of page.docs.slice(offset, offset + PURCHASE_PAGE_SIZE)) {
                batch.set(document.ref, { accountDeleted: true });
            }
            await batch.commit();
        }
    }
}

module.exports = {
    PURCHASE_PAGE_SIZE,
    createAccountDeletionBarrier,
    deletionBarrierRef,
    ensureAccountDeletionBarrier,
    hasAccountDeletionBarrier,
    neutralizePlayBillingPurchases,
    readAccountDeletionBarrier,
    sanitizeBillingResult,
};
