"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const play = require("./play-billing");
const lifecycle = require("./account-lifecycle");
const quota = require("./quota-policy");
const reservations = require("./quota-reservation-policy");

const source = readFileSync(path.join(__dirname, "index.js"), "utf8");
function section(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert(first >= 0 && last > first, `Missing source boundaries: ${start}`);
    return source.slice(first, last);
}

function memoryFirestore(initial = {}) {
    const rows = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
    const versions = new Map();
    const collectionVersions = new Map();
    let nextId = 0;
    const copy = (value) => value === undefined ? undefined : structuredClone(value);
    const merge = (target, value) => {
        const output = { ...(target || {}) };
        for (const [key, item] of Object.entries(value || {})) {
            output[key] = item && item.__increment !== undefined
                ? Number(output[key] || 0) + item.__increment
                : copy(item);
        }
        return output;
    };
    const ref = (documentPath) => ({
        id: documentPath.split("/").at(-1),
        path: documentPath,
        collection: (name) => collection(`${documentPath}/${name}`),
        get: async () => snapshot(documentPath),
    });
    const collection = (collectionPath) => ({
        doc: (id = `generated-${++nextId}`) => ref(`${collectionPath}/${id}`),
        where(field, operator, value) {
            assert.equal(operator, "==");
            return {
                path: collectionPath,
                field,
                value,
                get: async () => querySnapshot(collectionPath, field, value),
            };
        },
    });
    function snapshot(documentPath) {
        const value = rows.get(documentPath);
        return { exists: value !== undefined, data: () => copy(value), ref: ref(documentPath), id: documentPath.split("/").at(-1) };
    }
    function querySnapshot(collectionPath, field, value) {
        const prefix = `${collectionPath}/`;
        const docs = [...rows.entries()]
            .filter(([key, row]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/") && row[field] === value)
            .map(([key, row]) => ({ id: key.split("/").at(-1), ref: ref(key), data: () => copy(row) }));
        return { docs, empty: docs.length === 0 };
    }
    const db = {
        commits: [],
        retries: 0,
        read: (documentPath) => copy(rows.get(documentPath)),
        write(documentPath, value) {
            if (value === undefined) rows.delete(documentPath);
            else rows.set(documentPath, copy(value));
            versions.set(documentPath, (versions.get(documentPath) || 0) + 1);
            const parent = documentPath.slice(0, documentPath.lastIndexOf("/"));
            collectionVersions.set(parent, (collectionVersions.get(parent) || 0) + 1);
        },
        collection,
        async runTransaction(callback) {
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const reads = new Map();
                const queryReads = new Map();
                const writes = [];
                const transaction = {
                    async get(target) {
                        assert.equal(writes.length, 0, "Firestore reads must precede writes");
                        if (target && target.__query) return querySnapshot(target.path, target.field, target.value);
                        if (target && target.path && target.field) {
                            queryReads.set(target.path, collectionVersions.get(target.path) || 0);
                            return querySnapshot(target.path, target.field, target.value);
                        }
                        reads.set(target.path, versions.get(target.path) || 0);
                        return snapshot(target.path);
                    },
                    set: (target, value, options) => writes.push({ path: target.path, value: copy(value), merge: Boolean(options && options.merge) }),
                    update: (target, value) => writes.push({ path: target.path, value: copy(value), merge: true }),
                };
                const result = await callback(transaction);
                if ([...reads].some(([key, version]) => (versions.get(key) || 0) !== version) ||
                    [...queryReads].some(([key, version]) => (collectionVersions.get(key) || 0) !== version)) {
                    db.retries += 1;
                    continue;
                }
                for (const write of writes) {
                    const value = write.merge ? merge(rows.get(write.path), write.value) : write.value;
                    db.write(write.path, value);
                    db.commits.push(write.path);
                }
                return result;
            }
            throw new Error("Transaction retry limit exceeded");
        },
    };
    // Firestore CollectionReference.where returns a query object; mark it so transaction.get can track phantoms.
    const originalCollection = db.collection;
    db.collection = (name) => {
        const value = originalCollection(name);
        const originalDoc = value.doc;
        value.doc = (id) => originalDoc(id);
        const originalWhere = value.where;
        value.where = (field, operator, expected) => ({
            __query: true,
            path: name,
            field,
            value: expected,
            get: async () => querySnapshot(name, field, expected),
        });
        return value;
    };
    return db;
}

function quotaHandlers(db, startMs = Date.parse("2026-03-10T12:00:00.000Z")) {
    let clockMs = startMs;
    Date.now = () => clockMs;
    class TestDate extends Date {
        constructor(...args) { super(...(args.length ? args : [clockMs])); }
        static now() { return clockMs; }
    }
    const context = vm.createContext({
        db,
        ...play,
        ...lifecycle,
        ...quota,
        ...reservations,
        Date: TestDate,
        FieldValue: {
            serverTimestamp: () => new TestDate(),
            increment: (amount) => ({ __increment: amount }),
        },
        randomUUID: () => `reservation-${++reservationId}`,
        AI_USAGE_COLLECTION: "usage",
        AI_USAGE_DOC: "ai",
        AI_QUOTA_RESERVATIONS_COLLECTION: "ai_reservations",
        exports: {},
    });
    vm.runInContext(section("class QuotaError", "function nombreEventoRespuesta("), context);
    return {
        context,
        now: () => clockMs,
        advance: (milliseconds) => { clockMs += milliseconds; },
    };
}

let reservationId = 0;
const userRef = "usuarios/u1";
const usagePath = `${userRef}/usage/ai`;
const reservationCollection = `${userRef}/ai_reservations`;
const freeProfile = { tipoCuenta: "free" };
const realDateNow = Date.now;
test.after(() => { Date.now = realDateNow; });

async function reserve(runtime, uid = "u1") {
    return runtime.context.reservarCuotaConsultaIA(uid);
}

async function settle(runtime, quotaInfo, consume = false) {
    return runtime.context.liquidarReservaCuotaIA(quotaInfo, { consume });
}

test("reserve and refund transactions enforce five free uses, then reject the sixth", async () => {
    const db = memoryFirestore({ [userRef]: freeProfile });
    const runtime = quotaHandlers(db);
    for (let i = 1; i <= 5; i += 1) {
        const quotaInfo = await reserve(runtime);
        assert.equal(quotaInfo.used, i);
        assert.equal(await settle(runtime, quotaInfo, true), true);
        runtime.advance(2_001);
    }
    await assert.rejects(reserve(runtime), (error) => error.code === "free_monthly_quota_exceeded");
    assert.equal(db.read(usagePath).freeMonthlyCount, 5);

    // A real refund releases a slot exactly once.
    const refundDb = memoryFirestore({ [userRef]: freeProfile });
    const refundRuntime = quotaHandlers(refundDb);
    const refundable = await reserve(refundRuntime);
    assert.equal(await settle(refundRuntime, refundable), true);
    assert.equal(await settle(refundRuntime, refundable), false);
    assert.equal(refundDb.read(usagePath).freeMonthlyCount, 0);
});

test("concurrent requests serialize to one reservation and cannot consume twice", async () => {
    const db = memoryFirestore({ [userRef]: freeProfile });
    const runtime = quotaHandlers(db);
    const settled = await Promise.allSettled([reserve(runtime), reserve(runtime)]);
    const success = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item) => item.status === "rejected");
    assert.equal(success.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, "request_in_progress");
    assert.equal(db.retries, 1);
    const reservation = success[0].value;
    assert.equal(await settle(runtime, reservation, true), true);
    assert.equal(await settle(runtime, reservation, true), false);
    assert.equal(db.read(usagePath).totalConsumed, 1);
});

test("month rollover ignores legacy daily counters and expiration of prior-month reservations", async () => {
    const oldReservation = {
        state: "reserved", plan: "free", monthKey: "2026-02",
        expiresAt: new Date("2026-03-01T00:00:00.000Z"),
    };
    const db = memoryFirestore({
        [userRef]: freeProfile,
        [usagePath]: {
            freeDailyKey: "2026-03-10", freeDailyCount: 50,
            freeMonthlyKey: "2026-03", freeMonthlyCount: 1,
        },
        [`${reservationCollection}/expired-old`]: oldReservation,
    });
    const runtime = quotaHandlers(db);
    const next = await reserve(runtime);
    assert.equal(next.used, 2);
    assert.equal(db.read(`${reservationCollection}/expired-old`).state, "expired");
    assert.equal(db.read(usagePath).freeDailyCount, 50);
    assert.equal(db.read(usagePath).freeMonthlyCount, 2);
});

test("a prior-month refund does not decrement the current month's counter", async () => {
    const db = memoryFirestore({
        [userRef]: freeProfile,
        [usagePath]: { freeMonthlyKey: "2026-03", freeMonthlyCount: 2 },
        [`${reservationCollection}/prior`]: {
            state: "reserved", plan: "free", monthKey: "2026-02",
            expiresAt: new Date("2026-03-10T13:00:00.000Z"),
        },
    });
    const runtime = quotaHandlers(db);
    const quotaInfo = {
        reservationRef: { path: `${reservationCollection}/prior`, id: "prior" },
        userRef: { id: "u1", collection: (name) => db.collection(`${userRef}/${name}`) },
        plan: "free", monthKey: "2026-02",
    };
    assert.equal(await settle(runtime, quotaInfo), true);
    assert.equal(db.read(usagePath).freeMonthlyCount, 2);
    assert.equal(db.read(`${reservationCollection}/prior`).state, "refunded");
});

test("Premium can consume more than 200 successful queries without a numeric quota", async () => {
    const db = memoryFirestore({ [userRef]: { tipoCuenta: "premium" } });
    const runtime = quotaHandlers(db);
    let last;
    for (let i = 0; i < 201; i += 1) {
        last = await reserve(runtime);
        assert.equal(last.limit, null);
        assert.equal(last.used, null);
        assert.equal(last.period, "unlimited");
        await settle(runtime, last, true);
        runtime.advance(2_001);
    }
    assert.equal(db.read(usagePath).totalConsumed, 201);
    assert.equal(db.read(usagePath).premiumDailyCount, undefined);
});

test("expired trial entitlement uses the free monthly quota and deletion barriers block reservations", async () => {
    const db = memoryFirestore({
        [userRef]: {
            tipoCuenta: "premium",
            billing: { googlePlay: { active: true, status: "trialing", expiresAt: "2020-01-01T00:00:00Z" } },
        },
    });
    const runtime = quotaHandlers(db);
    const free = await reserve(runtime);
    assert.equal(free.plan, "free");
    assert.equal(free.limit, quota.FREE_AI_MONTHLY_LIMIT);
    await settle(runtime, free);

    await lifecycle.ensureAccountDeletionBarrier(db, "u1");
    await assert.rejects(reserve(runtime), (error) => error.code === "user_profile_not_found");
    assert.equal(db.read(usagePath).freeMonthlyCount, 0);
});
