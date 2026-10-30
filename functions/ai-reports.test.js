"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const {
    MAX_REPORTS_PER_DAY,
    MAX_RESPONSE_LENGTH,
    MAX_REQUEST_BYTES,
    MIN_REPORT_INTERVAL_MS,
    RETENTION_MS,
    RATE_LIMIT_RETENTION_MS,
    createAIReportsHandler,
    cleanupExpiredAIReports,
} = require("./ai-reports");

test("HTTP wrapper enforces real CORS, preflight and configured App Check before accepting reports", async () => {
    const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
    const cors = source.slice(source.indexOf("function esOrigenPermitidoConsulta("), source.indexOf("function extraerTextoRespuesta("));
    const wrapper = source.slice(source.indexOf("exports.reportAIResponse ="), source.indexOf("// BORRADO DE CUENTA:"));
    let accepted = 0;
    const context = vm.createContext({
        projectId: "demo-balance-play",
        exports: {}, onRequest: (_options, handler) => handler,
        CONSULTAR_CONVENIO_ALLOWED_ORIGINS: new Set(["https://balancelaboral.es"]),
        CONSULTAR_CONVENIO_DEV_ORIGIN_PATTERN: /^http:\/\/localhost:\d+$/,
        APP_CHECK_ENFORCEMENT: true,
        verificarAppCheckConsulta: async (req) => ({ ok: req.appCheckOK === true }),
        aiReportsHandler: async (_req, res) => { accepted += 1; return res.status(201).json({ ok: true }); },
    });
    vm.runInContext(cors + "\n" + wrapper, context);
    async function call(origin, method = "POST", appCheckOK = true) {
        const output = { headers: {} };
        await context.exports.reportAIResponse({ method, appCheckOK, get: () => origin }, {
            set(key, value) { output.headers[key] = value; return this; },
            status(code) { output.status = code; return this; },
            json(body) { output.body = body; return this; }, send() { return this; },
        });
        return output;
    }
    assert.equal((await call("https://evil.invalid")).status, 403);
    assert.equal((await call("https://balancelaboral.es", "OPTIONS")).status, 204);
    assert.equal((await call("https://balancelaboral.es", "POST", false)).status, 401);
    assert.equal(accepted, 0);
    const valid = await call("https://balancelaboral.es");
    assert.equal(valid.status, 201);
    assert.equal(valid.headers["Access-Control-Allow-Origin"], "https://balancelaboral.es");
    assert.equal(valid.headers["Cache-Control"], "no-store");
    assert.equal(accepted, 1);
});

function createHarness() {
    const documents = new Map();
    let timestamp = Date.UTC(2026, 0, 2, 10);
    let transactionQueue = Promise.resolve();
    const db = {
        collection: (collection) => ({
            doc: (id) => ({ key: `${collection}/${id}` }),
        }),
        runTransaction(work) {
            const pending = transactionQueue.then(() => {
                const transaction = {
                    get: async (ref) => ({ exists: documents.has(ref.key), data: () => documents.get(ref.key) }),
                    create: (ref, value) => {
                        if (documents.has(ref.key)) throw new Error("already exists");
                        documents.set(ref.key, value);
                    },
                    set: (ref, value) => documents.set(ref.key, value),
                };
                return work(transaction);
            });
            transactionQueue = pending.catch(() => {});
            return pending;
        },
    };
    const handler = createAIReportsHandler({
        auth: { verifyIdToken: async (token, checkRevoked) => {
            assert.equal(checkRevoked, true, "revoked Firebase tokens are rejected");
            if (token !== "valid") throw new Error("bad token");
            return { uid: "user-123" };
        } },
        db,
        now: () => timestamp,
    });
    async function call({ method = "POST", token = "valid", contentType = "application/json", body } = {}) {
        let result;
        const req = {
            method,
            headers: { authorization: token ? `Bearer ${token}` : "", "content-type": contentType },
            body: body === undefined ? { reason: "inaccurate", response: "Respuesta" } : body,
        };
        const res = { status(code) { result = { status: code }; return this; }, json(payload) { result.body = payload; return this; } };
        await handler(req, res);
        return result;
    }
    return { call, documents, setTime: (value) => { timestamp = value; } };
}

test("rejects unsupported request, missing/invalid auth, and invalid report data", async () => {
    const { call } = createHarness();
    assert.equal((await call({ method: "GET" })).status, 405);
    assert.equal((await call({ contentType: "text/plain" })).status, 415);
    assert.equal((await call({ token: "" })).status, 401);
    assert.equal((await call({ token: "invalid" })).status, 401);
    assert.equal((await call({ body: { reason: "other", response: "valid", extra: "x".repeat(MAX_REQUEST_BYTES) } })).status, 413);
    assert.equal((await call({ body: { reason: "prompt-leak", response: "Respuesta" } })).status, 400);
    assert.equal((await call({ body: { reason: "other", response: " " } })).status, 400);
    assert.equal((await call({ body: { reason: "other", response: "x".repeat(MAX_RESPONSE_LENGTH + 1) } })).status, 400);
});

test("stores only the bounded response and allowlisted reason without the UID, and is idempotent", async () => {
    const { call, documents } = createHarness();
    const first = await call({ body: { reason: "unsafe", response: "  Respuesta a revisar  ", question: "Pregunta privada", email: "user@example.com" } });
    assert.deepEqual(first, { status: 201, body: { ok: true, duplicate: false } });
    const report = [...documents.entries()].find(([key]) => key.startsWith("aiReports/"))[1];
    assert.deepEqual(Object.keys(report).sort(), ["createdAt", "expiresAt", "reason", "response"]);
    assert.equal(report.response, "Respuesta a revisar");
    assert.equal(report.reason, "unsafe");
    assert.equal(report.expiresAt.getTime() - report.createdAt.getTime(), RETENTION_MS);
    assert.equal(JSON.stringify([...documents.values()]).includes("user-123"), false);
    const rate = [...documents.entries()].find(([key]) => key.startsWith("aiReportRateLimits/"))[1];
    assert.equal(rate.expiresAt.getTime() - report.createdAt.getTime(), RATE_LIMIT_RETENTION_MS);
    const duplicate = await call({ body: { reason: "unsafe", response: "  Respuesta a revisar  " } });
    assert.deepEqual(duplicate, { status: 200, body: { ok: true, duplicate: true } });
    assert.equal([...documents.keys()].filter((key) => key.startsWith("aiReports/")).length, 1);
});

test("enforces minute and daily limits per authenticated account, resetting at UTC day boundary", async () => {
    const { call, setTime } = createHarness();
    assert.equal((await call()).status, 201);
    assert.equal((await call({ body: { reason: "other", response: "different" } })).status, 429);
    setTime(Date.UTC(2026, 0, 2, 10) + MIN_REPORT_INTERVAL_MS);
    for (let index = 1; index < MAX_REPORTS_PER_DAY; index += 1) {
        assert.equal((await call({ body: { reason: "other", response: `Response ${index}` } })).status, 201);
        setTime(Date.UTC(2026, 0, 2, 10) + (index + 1) * MIN_REPORT_INTERVAL_MS);
    }
    assert.equal((await call({ body: { reason: "other", response: "daily limit" } })).status, 429);
    setTime(Date.UTC(2026, 0, 3, 0));
    assert.equal((await call({ body: { reason: "other", response: "next day" } })).status, 201);
});

test("account deletion barrier rejects new reports even with a valid Firebase token", async () => {
    const { call, documents } = createHarness();
    documents.set("accountDeletions/user-123", { accountDeleted: true });
    assert.deepEqual(await call(), { status: 403, body: { code: "account_unavailable" } });
    assert.equal([...documents.keys()].some((key) => key.startsWith("aiReports/")), false);
});

test("serializes competing reports through the transaction quota", async () => {
    const { call, documents } = createHarness();
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => call({
        body: { reason: "other", response: `Parallel report ${index}` },
    })));
    assert.equal(responses.filter((result) => result.status === 201).length, 1);
    assert.equal(responses.filter((result) => result.status === 429).length, 5);
    assert.equal([...documents.keys()].filter((key) => key.startsWith("aiReports/")).length, 1);
});

test("cleanup removes expired reports and rate-limit records in a bounded batch", async () => {
    const cutoff = new Date(Date.UTC(2026, 0, 1));
    const collections = {
        aiReports: [
            { id: "old-report", expiresAt: new Date(cutoff.getTime() - 1) },
            { id: "live-report", expiresAt: new Date(cutoff.getTime() + 1) },
        ],
        aiReportRateLimits: [
            { id: "old-rate", expiresAt: new Date(cutoff.getTime()) },
        ],
    };
    const deleted = [];
    const db = {
        collection(name) {
            return {
                where(field, operator, value) {
                    assert.equal(field, "expiresAt");
                    assert.equal(operator, "<=");
                    assert.equal(value.getTime(), cutoff.getTime());
                    return this;
                },
                limit(size) { this.pageSize = size; return this; },
                async get() {
                    const docs = collections[name]
                        .filter((doc) => doc.expiresAt <= cutoff)
                        .slice(0, this.pageSize)
                        .map((doc) => ({ ref: { id: doc.id } }));
                    return { docs };
                },
            };
        },
        batch() {
            const refs = [];
            return {
                delete(ref) { refs.push(ref); },
                async commit() { deleted.push(...refs.map((ref) => ref.id)); },
            };
        },
    };
    assert.deepEqual(await cleanupExpiredAIReports({ db, now: cutoff.getTime() }), { deleted: 2, hasMore: false });
    assert.deepEqual(deleted.sort(), ["old-rate", "old-report"]);
});

test("cleanup caps one run at 500 deletes and signals another page", async () => {
    const cutoff = new Date(Date.UTC(2026, 0, 1));
    const docs = Array.from({ length: 501 }, (_, index) => ({ ref: { id: `report-${index}` } }));
    let queryLimit;
    let deleted = 0;
    const db = {
        collection() {
            return {
                where() { return this; },
                limit(size) { queryLimit = size; return this; },
                async get() { return { docs }; },
            };
        },
        batch() {
            let count = 0;
            return {
                delete() { count += 1; },
                async commit() { deleted = count; },
            };
        },
    };
    assert.deepEqual(await cleanupExpiredAIReports({ db, now: cutoff.getTime() }), { deleted: 500, hasMore: true });
    assert.equal(queryLimit, 501);
    assert.equal(deleted, 500);
});
