const assert = require("node:assert/strict");
const test = require("node:test");
const { createGa4Client, createGa4MetricsHandler, gaErrorDetails, queryMetrics, resolvePeriod, buildActivationCohorts } = require("./metrics-ga4");

function response() {
    return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}

test("limita los periodos y calcula el mes actual", () => {
    assert.throws(() => resolvePeriod("365d"), { code: "invalid_period" });
    assert.deepEqual(resolvePeriod("current_month", new Date("2026-09-02T12:00:00Z")), { period: "current_month", startDate: "2026-09-01", endDate: "2026-09-02" });
});

test("el endpoint público no requiere token", async () => {
    const reports = [];
    const handler = createGa4MetricsHandler({
        getPropertyId: () => "123",
        createClient: () => ({ runReport: async (request) => { reports.push(request); return { rows: [] }; } }),
    });
    const result = response();
    await handler({ method: "POST", body: {} }, result);
    assert.equal(result.statusCode, 200);
    assert(reports.every((request) => (request.dateRanges || []).every((dateRange) => !Object.hasOwn(dateRange, "period"))));
    assert(reports.some((request) => (request.dimensions || []).some((dimension) => dimension.name === "newVsReturning")), "el panel usa la dimensión GA4 nuevo/recurrente");
    assert(reports.some((request) => JSON.stringify(request.dimensionFilter || {}).includes("customEvent:event_revision") && JSON.stringify(request.dimensionFilter).includes("v3")), "los eventos del panel excluyen el histórico no fiable");
});

test("acepta un ID de propiedad de GA4 con salto de línea final", () => {
    assert.doesNotThrow(() => createGa4Client({ propertyId: "123\n", auth: {} }));
});

test("el endpoint público no necesita datos de Firestore", async () => {
    const handler = createGa4MetricsHandler({
        getPropertyId: () => "123",
        createClient: () => ({ runReport: async () => ({ rows: [] }) }),
        now: () => new Date("2026-09-02T12:00:00Z"),
    });
    const result = response();
    await handler({ method: "POST", body: { period: "7d" } }, result);
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
        getPropertyId: () => "",
    });
    const result = response();
    await handler({ method: "POST", body: { period: "7d" } }, result);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.code, "missing_configuration");
    assert.match(result.body.measurement.message, /configuración segura/);
});

test("un desglose opcional rechazado no bloquea las métricas estándar", async () => {
    const requestedDimensions = [];
    const value = await queryMetrics({
        runReport: async (request) => {
            const dimension = request.dimensions && request.dimensions[0] && request.dimensions[0].name;
            requestedDimensions.push(dimension);
            if (["deviceCategory", "browser", "language", "country", "sessionDefaultChannelGroup", "pagePath"].includes(dimension)) throw new Error("optional report unavailable");
            return { rows: [] };
        },
    }, { startDate: "2026-09-01", endDate: "2026-09-02" });
    assert.equal(value.overview.activeUsers, 0);
    assert.deepEqual(value.product.devices, []);
    assert.deepEqual(value.product.locations, []);
    assert(requestedDimensions.includes("country") && requestedDimensions.includes("sessionDefaultChannelGroup") && requestedDimensions.includes("pagePath"));
    assert.equal(value.measurement.status, "ok");
});

test("usa retorno GA4 estándar y agrega plataforma y estado de cuenta por app_open", async () => {
    const value = await queryMetrics({
        runReport: async (request) => {
            const dimensions = (request.dimensions || []).map((dimension) => dimension.name);
            if (dimensions[0] === "newVsReturning") return { rows: [
                { dimensionValues: [{ value: "new" }], metricValues: [{ value: "5" }] },
                { dimensionValues: [{ value: "returning" }], metricValues: [{ value: "7" }] },
            ] };
            if (dimensions[0] === "customEvent:modo_acceso") return { rows: [
                { dimensionValues: [{ value: "android_twa" }, { value: "app_open" }, { value: "authenticated" }], metricValues: [{ value: "3" }] },
                { dimensionValues: [{ value: "web" }, { value: "app_open" }, { value: "anonymous" }], metricValues: [{ value: "2" }] },
                { dimensionValues: [{ value: "web" }, { value: "app_open" }, { value: "authenticated" }], metricValues: [{ value: "4" }] },
                { dimensionValues: [{ value: "pwa" }, { value: "shift_added" }, { value: "anonymous" }], metricValues: [{ value: "5" }] },
            ] };
            if (dimensions[0] === "eventName") return { rows: [] };
            if (!dimensions.length && request.metrics?.[0]?.name === "activeUsers") return { rows: [{ metricValues: ["12", "20", "5", "10", "0.5", "45"].map((value) => ({ value })) }] };
            return { rows: [] };
        },
    }, { startDate: "2026-09-01", endDate: "2026-09-02" });

    assert.equal(value.overview.returningUsers, 7);
    assert.equal(value.overview.returningRate, 58.3);
    assert.deepEqual(value.product.accessMode.values, [{ label: "android_twa", value: 3 }, { label: "web", value: 6 }]);
    assert.deepEqual(value.product.authState.values, [{ label: "authenticated", value: 7 }, { label: "anonymous", value: 2 }]);
    assert.deepEqual(value.product.platformEvents, [{ label: "pwa · jornada guardada", value: 5 }]);
});

test("oculta los eventos de producto hasta registrar event_revision", async () => {
    const value = await queryMetrics({
        runReport: async (request) => {
            if (JSON.stringify(request.dimensionFilter || {}).includes("customEvent:event_revision")) throw new Error("custom dimension is not registered");
            return { rows: [] };
        },
    }, { startDate: "2026-09-01", endDate: "2026-09-02" });

    assert.equal(value.product.available, false);
    assert.match(value.product.unavailableReason, /event_revision/);
    assert.equal(value.funnelAvailable, false);
    assert.equal(value.overview.activeUsers, 0, "standard GA4 metrics remain available");
});

test("las cohortes respetan fecha de activación, periodo y madurez por día exacto", () => {
    const row = (date, event, count, day = "(not set)", kind = "(not set)") => ({ dimensionValues: [date, event, day, kind].map(value => ({ value })), metricValues: [{ value: String(count) }] });
    const result = buildActivationCohorts({ rows: [
        row("2026-09-01", "first_shift_saved", 10), row("2026-09-01", "signup_completed", 3),
        row("2026-09-01", "cohort_return", 4, "1", "open"), row("2026-09-01", "cohort_return", 2, "1", "shift"),
        row("2026-09-20", "first_shift_saved", 2), row("2026-08-31", "first_shift_saved", 99),
        row("2026-10-01", "first_shift_saved", 99), row("2026-09-02", "cohort_return", 1, "7", "open"),
    ] }, { startDate: "2026-09-01", endDate: "2026-09-30" }, "2026-09-21");
    assert.equal(result.length, 2, "no se mezclan cohortes de otro periodo o sin denominador");
    assert.equal(result[0].registrationRate, 30);
    assert.equal(result[0].retention[0].openRate, 40);
    assert.equal(result[0].retention[0].saveRate, 20);
    assert.equal(result[0].retention[2].mature, false);
    assert.equal(result[0].retention[2].opened, null, "una cohorte inmadura no es retención cero");
    assert.equal(result[1].registrationRate, null, "no se presentan tasas con muestras menores a 5");
});

test("dimensiones de crecimiento ausentes no se presentan como ceros válidos", async () => {
    const result = await queryMetrics({ runReport: async request => {
        if ((request.dimensions || []).some(d => /activation_cohort|origin_page|provider/.test(d.name))) throw new Error("not registered");
        return { rows: [] };
    } }, { startDate: "2026-09-01", endDate: "2026-09-30" });
    assert.equal(result.growth.cohortsAvailable, false);
    assert.equal(result.growth.originsAvailable, false);
    assert.equal(result.growth.providersAvailable, false);
});

test("el panel público limita solicitudes y comparte consultas simultáneas", async () => {
    let clients = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const handler = createGa4MetricsHandler({ getPropertyId: () => "123", createClient: () => {
        clients++;
        return { runReport: async () => { await gate; return { rows: [] }; } };
    } });
    for (const req of [
        { method: "GET" }, { method: "POST", body: { period: "365d" } },
        { method: "POST", body: { period: "7d", dimensions: ["userId"] } },
        { method: "POST", body: [] }, { method: "POST", body: {}, rawBody: Buffer.alloc(2049) },
    ]) {
        const res = response(); await handler(req, res);
        assert(res.statusCode >= 400);
    }
    assert.equal(clients, 0, "solicitudes arbitrarias no consultan GA4");
    const first = response(), second = response();
    const reads = [handler({ method: "POST", body: { period: "7d" } }, first), handler({ method: "POST", body: { period: "7d" } }, second)];
    assert.equal(clients, 1);
    release(); await Promise.all(reads);
    const third = response(); await handler({ method: "POST", body: { period: "7d" } }, third);
    assert.equal(clients, 1);
    assert.equal(third.body.cached, true);
});

test("los errores se cachean y el cambio de fecha invalida el periodo", async () => {
    let clock = new Date("2026-10-16T23:59:00Z"), calls = 0;
    const handler = createGa4MetricsHandler({ now: () => clock, getPropertyId: () => { calls++; return ""; } });
    for (let i = 0; i < 2; i++) { const res = response(); await handler({ method: "POST", body: {} }, res); assert.equal(res.statusCode, 503); }
    assert.equal(calls, 1);
    clock = new Date("2026-10-17T00:00:00Z");
    await handler({ method: "POST", body: {} }, response());
    assert.equal(calls, 2);
});
