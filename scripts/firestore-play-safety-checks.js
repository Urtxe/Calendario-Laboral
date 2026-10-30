"use strict";

// Only a local disposable emulator is accepted, even if the shell has production credentials.
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const project = "demo-balance-play";
const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8088";
assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/, "Only a loopback emulator is allowed");
process.env.FIRESTORE_EMULATOR_HOST = host;
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents/`;
const uid = `play-safety-${randomUUID()}`;
const ownedPaths = new Set();

function token(user) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode({ alg: "none", typ: "JWT" })}.${encode({
        sub: user, user_id: user, aud: project, iss: `https://securetoken.google.com/${project}`,
        iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: "password" },
    })}.`;
}

async function request(path, { method = "GET", admin = false, user = uid, fields } = {}) {
    if (admin && method === "PATCH") ownedPaths.add(path);
    return fetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${admin ? "owner" : token(user)}`, "Content-Type": "application/json" },
        body: fields ? JSON.stringify({ fields }) : undefined,
    });
}

async function run() {
    const profile = `usuarios/${uid}`;
    const fields = { email: { stringValue: "local-test@example.invalid" } };
    assert.equal((await request(profile, { method: "PATCH", fields })).status, 200);
    ownedPaths.add(profile);
    assert.equal((await request(profile)).status, 200);
    assert.equal((await request(profile, { user: `${uid}-other` })).status, 403);
    assert.equal((await request(profile, { method: "PATCH", fields: { tipoCuenta: { stringValue: "premium" } } })).status, 403);
    const year = `${profile}/years/2026`;
    assert.equal((await request(year, { method: "PATCH", fields: { hours: { integerValue: "1" } } })).status, 200);
    ownedPaths.add(year);
    assert.equal((await request(`${profile}/usage/ai`, { method: "PATCH", fields })).status, 403);
    for (const collection of ["playBillingPurchases", "accountDeletions", "aiReports", "aiReportRateLimits"]) {
        const path = `${collection}/${uid}`;
        assert.equal((await request(path, { method: "PATCH", fields })).status, 403, collection);
        assert.equal((await request(path)).status, 403, collection);
    }
    const barrier = `accountDeletions/${uid}`;
    assert.equal((await request(barrier, { method: "PATCH", admin: true, fields: { accountDeleted: { booleanValue: true } } })).status, 200);
    assert.equal((await request(profile)).status, 403);
    assert.equal((await request(year, { method: "PATCH", fields })).status, 403);
    assert.equal((await request(`${profile}/visitas/new`, { method: "PATCH", fields })).status, 403);
    assert.equal((await request(barrier, { method: "DELETE" })).status, 403);
    await request(profile, { method: "DELETE", admin: true });
    assert.equal((await request(profile, { method: "PATCH", fields })).status, 403, "A stale token cannot recreate a deleted profile");
    console.log("OK Firestore real: ownership, protected billing, private collections and stale-token recreation.");

    const localRequire = createRequire(require("node:path").resolve(__dirname, "../functions/package.json"));
    const { initializeApp, deleteApp } = localRequire("firebase-admin/app");
    const { getFirestore } = localRequire("firebase-admin/firestore");
    const { createAIReportsHandler } = require("../functions/ai-reports");
    const app = initializeApp({ projectId: project }, uid);
    const db = getFirestore(app);
    const reporter = `${uid}-reporter`;
    const response = `Local emulator report ${uid}`;
    const day = new Date().toISOString().slice(0, 10);
    const rateKey = createHash("sha256").update(reporter).digest("hex");
    const reportKey = createHash("sha256").update(`${reporter}\n${day}\nunsafe\n${response}`).digest("hex");
    ownedPaths.add(`aiReportRateLimits/${rateKey}`);
    ownedPaths.add(`aiReports/${reportKey}`);
    async function report(user, text) {
        const handler = createAIReportsHandler({ auth: { verifyIdToken: async () => ({ uid: user }) }, db });
        let status;
        await handler({ method: "POST", headers: { authorization: "Bearer emulator-only", "content-type": "application/json" }, body: { reason: "unsafe", response: text } }, {
            status(code) { status = code; return this; }, json() { return this; },
        });
        return status;
    }
    try {
        assert.equal(await report(uid, response), 403, "Deleted account cannot submit reports");
        const results = await Promise.all(Array.from({ length: 6 }, () => report(reporter, response)));
        assert.equal(results.filter((code) => code === 201).length, 1);
        assert.equal(results.filter((code) => code === 200).length, 5, "Duplicate reports are idempotent under real contention");
        assert.equal(await report(reporter, `${response}-second`), 429);
        const stored = (await db.collection("aiReports").doc(reportKey).get()).data();
        assert.deepEqual(Object.keys(stored).sort(), ["createdAt", "expiresAt", "reason", "response"]);
        assert.equal(stored.response, response);
        assert.equal((await request(`aiReports/${reportKey}`, { user: reporter })).status, 403, "The reporter cannot read a stored report");
        assert.equal((await request(`aiReports/${reportKey}`, { user: `${reporter}-other` })).status, 403, "Other users cannot read a stored report");
        assert.equal((await fetch(base + `aiReports/${reportKey}`)).status, 403, "Anonymous clients cannot read a stored report");
        assert.equal((await request("aiReports", { user: reporter })).status, 403, "Clients cannot list reports");
        assert.equal((await request(`aiReports/${reportKey}`, { method: "PATCH", user: reporter, fields })).status, 403, "The reporter cannot overwrite a stored report");
        console.log("OK Firestore real: concurrent report idempotency, rate limit and deleted-account guard.");
        console.log("OK Firestore real: stored report readable by backend only, not by reporter, other or anonymous clients.");
    } finally {
        await db.terminate();
        await deleteApp(app);
    }
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const path of ownedPaths) await request(path, { method: "DELETE", admin: true }).catch(() => {});
});
