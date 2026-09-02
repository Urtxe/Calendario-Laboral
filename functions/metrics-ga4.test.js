const assert = require("node:assert/strict");
const test = require("node:test");
const { createGa4MetricsHandler, resolvePeriod } = require("./metrics-ga4");

function response() {
    return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}

test("limita los periodos y calcula el mes actual", () => {
    assert.throws(() => resolvePeriod("365d"), { code: "invalid_period" });
    assert.deepEqual(resolvePeriod("current_month", new Date("2026-09-02T12:00:00Z")), { period: "current_month", startDate: "2026-09-01", endDate: "2026-09-02" });
});

test("el endpoint rechaza peticiones sin token y sin claim admin", async () => {
    const handler = createGa4MetricsHandler({ verifyIdToken: async () => ({}), getPropertyId: () => "123" });
    const unauthenticated = response();
    await handler({ method: "POST", get: () => "", body: {} }, unauthenticated);
    assert.equal(unauthenticated.statusCode, 401);
    const forbidden = response();
    await handler({ method: "POST", get: () => "Bearer token", body: {} }, forbidden);
    assert.equal(forbidden.statusCode, 403);
});

test("el endpoint permite al administrador y no necesita datos de Firestore", async () => {
    const handler = createGa4MetricsHandler({
        verifyIdToken: async () => ({ admin: true }),
        getPropertyId: () => "123",
        createClient: () => ({ runReport: async () => ({ rows: [] }) }),
        now: () => new Date("2026-09-02T12:00:00Z"),
    });
    const result = response();
    await handler({ method: "POST", get: () => "Bearer token", body: { period: "7d" } }, result);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.overview.activeUsers, 0);
    assert.equal(result.body.measurement.status, "ok");
});
