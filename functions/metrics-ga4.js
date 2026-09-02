const { GoogleAuth } = require("google-auth-library");

const MAX_CACHE_AGE_MS = 5 * 60 * 1000;
const PERIODS = new Set(["7d", "30d", "90d", "current_month"]);
const cache = new Map();

function isoDate(date) {
    return date.toISOString().slice(0, 10);
}

function resolvePeriod(period, now = new Date()) {
    if (!PERIODS.has(period)) {
        const error = new Error("Periodo no permitido.");
        error.status = 400;
        error.code = "invalid_period";
        throw error;
    }

    const end = new Date(now);
    const start = new Date(now);
    if (period === "current_month") {
        start.setUTCDate(1);
    } else {
        start.setUTCDate(start.getUTCDate() - (Number.parseInt(period, 10) - 1));
    }

    return { startDate: isoDate(start), endDate: isoDate(end), period };
}

function parseMetricRows(report) {
    return (report.rows || []).map((row) => ({
        dimensions: (row.dimensionValues || []).map((item) => item.value),
        metrics: (row.metricValues || []).map((item) => Number(item.value || 0)),
    }));
}

function metricByEvent(report) {
    return Object.fromEntries(parseMetricRows(report).map((row) => [row.dimensions[0], row.metrics[0] || 0]));
}

function classifyGaError(error) {
    const status = Number(error && error.status) || 0;
    const message = String((error && error.message) || "");
    if (status === 401 || status === 403 || /permission|credential|scope/i.test(message)) return "permissions_error";
    if (status === 400 || /property|invalid argument/i.test(message)) return "configuration_error";
    return "query_error";
}

function createGa4Client({ propertyId, auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/analytics.readonly"] }) }) {
    if (!/^\d+$/.test(String(propertyId || ""))) {
        const error = new Error("GA4_PROPERTY_ID no está configurado con un ID numérico de propiedad.");
        error.status = 503;
        error.code = "configuration_error";
        throw error;
    }

    async function runReport(request) {
        const client = await auth.getClient();
        const response = await client.request({
            url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
            method: "POST",
            data: request,
        });
        return response.data;
    }

    return { runReport };
}

function eventReport(dateRange, events) {
    return {
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
            filter: {
                fieldName: "eventName",
                inListFilter: { values: events },
            },
        },
        limit: 100,
    };
}

async function queryMetrics(client, dateRange) {
    const productEvents = ["calendar_configured", "shift_added", "balance_viewed"];
    const funnelEvents = [
        "app_open",
        "calendar_configured",
        "shift_added",
        "balance_viewed",
        "registration_prompt_shown",
        "signup_started",
        "signup_completed",
        "premium_activated",
    ];
    const last24Hours = { startDate: "yesterday", endDate: "today" };

    const [overview, daily, product, funnelReport, devices, browsers, languages, events24h, lastEvent] = await Promise.all([
        client.runReport({ dateRanges: [dateRange], metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "newUsers" }, { name: "returningUsers" }] }),
        client.runReport({ dateRanges: [dateRange], dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }, { name: "sessions" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: 100 }),
        client.runReport(eventReport(dateRange, productEvents)),
        client.runReport(eventReport(dateRange, funnelEvents)),
        client.runReport({ dateRanges: [dateRange], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "activeUsers" }], limit: 20 }),
        client.runReport({ dateRanges: [dateRange], dimensions: [{ name: "browser" }], metrics: [{ name: "activeUsers" }], limit: 20 }),
        client.runReport({ dateRanges: [dateRange], dimensions: [{ name: "language" }], metrics: [{ name: "activeUsers" }], limit: 20 }),
        client.runReport({ dateRanges: [last24Hours], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 100 }),
        client.runReport({ dateRanges: [last24Hours], dimensions: [{ name: "dateHourMinute" }, { name: "eventName" }], metrics: [{ name: "eventCount" }], orderBys: [{ dimension: { dimensionName: "dateHourMinute" }, desc: true }], limit: 1 }),
    ]);

    let accessMode = { available: false, values: [], reason: "La dimensión personalizada modo_acceso no está registrada en GA4." };
    try {
        const report = await client.runReport({
            dateRanges: [dateRange],
            dimensions: [{ name: "customEvent:modo_acceso" }],
            metrics: [{ name: "eventCount" }],
            dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "app_open" } } },
            limit: 20,
        });
        accessMode = { available: true, values: parseMetricRows(report).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })) };
    } catch (error) {
        accessMode.reason = "La dimensión personalizada modo_acceso no está disponible todavía en GA4.";
    }

    const overviewRow = parseMetricRows(overview)[0] || { metrics: [0, 0, 0, 0] };
    const dailyRows = parseMetricRows(daily);
    const productByEvent = metricByEvent(product);
    const funnelByEvent = metricByEvent(funnelReport);
    const funnel = [
        { id: "app_open", label: "Visita o apertura", value: funnelByEvent.app_open || 0 },
        { id: "product_use", label: "Uso del calendario o balance", value: (funnelByEvent.calendar_configured || 0) + (funnelByEvent.shift_added || 0) + (funnelByEvent.balance_viewed || 0) },
        { id: "registration_prompt_shown", label: "Aviso de registro mostrado", value: funnelByEvent.registration_prompt_shown || 0 },
        { id: "signup_started", label: "Registro iniciado", value: funnelByEvent.signup_started || 0 },
        { id: "signup_completed", label: "Registro completado", value: funnelByEvent.signup_completed || 0 },
        { id: "premium_activated", label: "Premium activado", value: funnelByEvent.premium_activated || 0 },
    ].map((step, index, all) => ({
        ...step,
        conversionFromPrevious: index === 0 || all[index - 1].value === 0 ? null : Number(((step.value / all[index - 1].value) * 100).toFixed(1)),
    }));

    const lastEventRow = parseMetricRows(lastEvent)[0];
    return {
        overview: {
            activeUsers: overviewRow.metrics[0] || 0,
            sessions: overviewRow.metrics[1] || 0,
            newUsers: overviewRow.metrics[2] || 0,
            returningUsers: overviewRow.metrics[3] || 0,
            returningRate: overviewRow.metrics[0] ? Number(((overviewRow.metrics[3] / overviewRow.metrics[0]) * 100).toFixed(1)) : 0,
        },
        daily: dailyRows.map((row) => ({ date: row.dimensions[0], activeUsers: row.metrics[0], sessions: row.metrics[1] })),
        product: {
            calendarConfigured: productByEvent.calendar_configured || 0,
            shiftsAdded: productByEvent.shift_added || 0,
            balancesViewed: productByEvent.balance_viewed || 0,
            accessMode,
            devices: parseMetricRows(devices).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
            browsers: parseMetricRows(browsers).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
            languages: parseMetricRows(languages).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
        },
        funnel,
        measurement: {
            status: "ok",
            eventsLast24h: metricByEvent(events24h),
            lastEvent: lastEventRow ? { dateHourMinute: lastEventRow.dimensions[0], name: lastEventRow.dimensions[1], count: lastEventRow.metrics[0] } : null,
            message: lastEventRow ? "GA4 está devolviendo datos." : "GA4 respondió correctamente, pero no recibió eventos durante las últimas 24 horas.",
        },
    };
}

function createGa4MetricsHandler({ verifyIdToken, getPropertyId, createClient = createGa4Client, now = () => new Date() }) {
    return async (req, res) => {
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido.", code: "method_not_allowed" });
        const token = String(req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
        if (!token) return res.status(401).json({ error: "Autenticación requerida.", code: "unauthenticated" });

        let decoded;
        try {
            decoded = await verifyIdToken(token[1]);
        } catch {
            return res.status(401).json({ error: "Sesión no válida.", code: "unauthenticated" });
        }
        if (decoded.admin !== true) return res.status(403).json({ error: "No tienes permiso para ver métricas.", code: "permission_denied" });

        let range;
        try {
            range = resolvePeriod((req.body || {}).period || "30d", now());
        } catch (error) {
            return res.status(error.status || 400).json({ error: error.message, code: error.code || "invalid_request" });
        }

        const cacheKey = range.period;
        const cached = cache.get(cacheKey);
        if (cached && now().getTime() - cached.createdAt < MAX_CACHE_AGE_MS) {
            return res.json({ ...cached.value, cached: true, updatedAt: new Date(cached.createdAt).toISOString() });
        }

        try {
            const value = await queryMetrics(createClient({ propertyId: getPropertyId() }), range);
            cache.set(cacheKey, { createdAt: now().getTime(), value });
            return res.json({ ...value, cached: false, updatedAt: now().toISOString(), range });
        } catch (error) {
            const code = error.code || classifyGaError(error);
            return res.status(error.status || 503).json({
                error: "No se pudieron consultar las métricas de GA4.",
                code,
                measurement: { status: code, message: code === "permissions_error" ? "La cuenta de servicio no tiene acceso de lector a la propiedad de GA4." : "Falta configuración de GA4 o la consulta no se pudo completar." },
            });
        }
    };
}

module.exports = { MAX_CACHE_AGE_MS, createGa4Client, createGa4MetricsHandler, queryMetrics, resolvePeriod };
