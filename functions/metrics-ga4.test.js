const assert = require("node:assert/strict");
const test = require("node:test");
const { createGa4MetricsHandler, gaErrorDetails, queryMetrics, resolvePeriod } = require("./metrics-ga4");

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

test("clasifica y sanea errores HTTP de Analytics Data API", () => {
    const details = gaErrorDetails({
        response: {
            status: 400,
            data: { error: { status: "INVALID_ARGUMENT", message: "Invalid metric for properties/518524627" } },
        },
    });
    assert.equal(details.status, 400);
    assert.equal(details.code, "configuration_error");
    assert.match(details.message, /properties\/\[redacted\]/);
    assert.doesNotMatch(details.message, /518524627/);
});

test("distingue una configuración segura ausente de una consulta inválida", async () => {
    const handler = createGa4MetricsHandler({
        verifyIdToken: async () => ({ admin: true }),
        getPropertyId: () => "",
    });
    const result = response();
    await handler({ method: "POST", get: () => "Bearer token", body: { period: "7d" } }, result);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.code, "missing_configuration");
    assert.match(result.body.measurement.message, /configuración segura/);
});

test("un desglose opcional rechazado no bloquea las métricas estándar", async () => {
    const value = await queryMetrics({
        runReport: async (request) => {
            const dimension = request.dimensions && request.dimensions[0] && request.dimensions[0].name;
            if (["deviceCategory", "browser", "language"].includes(dimension)) throw new Error("optional report unavailable");
            return { rows: [] };
        },
    }, { startDate: "2026-09-01", endDate: "2026-09-02" });
    assert.equal(value.overview.activeUsers, 0);
    assert.deepEqual(value.product.devices, []);
    assert.equal(value.measurement.status, "ok");
});
