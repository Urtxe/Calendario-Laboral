const { GoogleAuth } = require("google-auth-library");

const MAX_CACHE_AGE_MS = 5 * 60 * 1000;
const PERIODS = new Set(["7d", "30d", "90d", "current_month"]);

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

function gaErrorDetails(error) {
    // google-auth-library surfaces HTTP failures under response, rather than
    // directly on Error. Keep the original response out of the client response.
    const apiError = error && error.response && error.response.data && error.response.data.error || {};
    const status = Number(error && error.status || error && error.response && error.response.status || apiError.code) || 503;
    const apiStatus = String(apiError.status || "");
    const rawMessage = String(apiError.message || error && error.message || "");
    const message = rawMessage
        .replace(/properties\/\d+/gi, "properties/[redacted]")
        .replace(/\b\d{6,}\b/g, "[redacted]")
        .slice(0, 500);
    const permissionFailure = status === 401 || status === 403 || /permission|credential|scope|unauthenticated/i.test(`${apiStatus} ${rawMessage}`);
    const invalidRequest = status === 400 || /invalid argument|invalid.*(metric|dimension|date|property)|unsupported/i.test(`${apiStatus} ${rawMessage}`);
    const code = error && ["missing_configuration", "permissions_error", "configuration_error", "query_error"].includes(error.code)
        ? error.code
        : permissionFailure ? "permissions_error" : invalidRequest ? "configuration_error" : "query_error";
    const clientMessage = code === "missing_configuration"
        ? "La Function no ha recibido el ID de propiedad GA4 desde su configuración segura."
        : code === "permissions_error"
        ? "GA4 denegó el acceso de lectura a la cuenta de ejecución."
        : code === "configuration_error"
            ? "GA4 rechazó el formato de una consulta (propiedad, fechas, métrica o dimensión)."
            : "GA4 no pudo completar la consulta. Revisa el diagnóstico de metricasGa4.";
    return { status, code, apiStatus, message, clientMessage };
}

function createGa4Client({ propertyId, auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/analytics.readonly"] }) }) {
    propertyId = String(propertyId || "").trim();
    if (!/^\d+$/.test(propertyId)) {
        const error = new Error("GA4_PROPERTY_ID no está configurado con un ID numérico de propiedad.");
        error.status = 503;
        error.code = "missing_configuration";
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
            andGroup: { expressions: [
                { filter: { fieldName: "eventName", inListFilter: { values: events } } },
                { filter: { fieldName: "customEvent:event_revision", stringFilter: { value: "v3" } } },
            ] },
        },
        limit: 100,
    };
}

async function optionalReport(client, request) {
    try {
        return await client.runReport(request);
    } catch {
        // Optional cards must never prevent the standard metrics dashboard from
        // loading. Their absence is rendered as an empty/unavailable breakdown.
        return { rows: [] };
    }
}

async function optionalReportWithAvailability(client, request) {
    try {
        return { report: await client.runReport(request), available: true };
    } catch {
        return { report: { rows: [] }, available: false };
    }
}

function buildActivationCohorts(report, range, completedThrough) {
    const cohorts = new Map();
    for (const row of parseMetricRows(report)) {
        const [date, event, day, kind] = row.dimensions;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < range.startDate || date > range.endDate || date > completedThrough) continue;
        if (!cohorts.has(date)) cohorts.set(date, { date, activated: 0, registered: 0, returns: {} });
        const cohort = cohorts.get(date);
        if (event === "first_shift_saved") cohort.activated = row.metrics[0];
        if (event === "signup_completed") cohort.registered = row.metrics[0];
        if (event === "cohort_return" && ["1", "7", "30"].includes(day) && ["open", "shift"].includes(kind)) cohort.returns[`${day}_${kind}`] = row.metrics[0];
    }
    return [...cohorts.values()].filter(c => c.activated > 0).sort((a, b) => a.date.localeCompare(b.date)).map(cohort => ({
        date: cohort.date, activated: cohort.activated, registered: cohort.registered,
        registrationRate: cohort.activated >= 5 && cohort.registered <= cohort.activated ? Math.round(cohort.registered / cohort.activated * 1000) / 10 : null,
        retention: [1, 7, 30].map(day => {
            const mature = Date.parse(cohort.date) + day * 86400000 <= Date.parse(completedThrough);
            return { day, mature, opened: mature ? cohort.returns[`${day}_open`] || 0 : null, saved: mature ? cohort.returns[`${day}_shift`] || 0 : null,
                openRate: mature && cohort.activated >= 5 && (cohort.returns[`${day}_open`] || 0) <= cohort.activated ? Math.round((cohort.returns[`${day}_open`] || 0) / cohort.activated * 1000) / 10 : null,
                saveRate: mature && cohort.activated >= 5 && (cohort.returns[`${day}_shift`] || 0) <= cohort.activated ? Math.round((cohort.returns[`${day}_shift`] || 0) / cohort.activated * 1000) / 10 : null };
        }),
    }));
}

async function queryGrowthMetrics(client, dateRange) {
    const events = ["convenio_cta_clicked", "calendar_configured", "first_shift_saved", "repeat_shift_saved", "signup_completed", "premium_prompt_shown", "premium_checkout_started", "premium_activation_confirmed"];
    const request = eventReport(dateRange, events);
    request.metrics = [{ name: "totalUsers" }, { name: "eventCount" }];
    const completedThrough = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const cohortRequest = eventReport({ startDate: dateRange.startDate, endDate: completedThrough }, ["first_shift_saved", "signup_completed", "cohort_return"]);
    cohortRequest.dimensions = [{ name: "customEvent:activation_cohort" }, { name: "eventName" }, { name: "customEvent:retention_day" }, { name: "customEvent:activity_kind" }];
    cohortRequest.metrics = [{ name: "totalUsers" }];
    cohortRequest.limit = 10000;
    const [totals, origin, cohorts, landing, providers] = await Promise.all([
        optionalReportWithAvailability(client, request),
        optionalReportWithAvailability(client, { ...request, dimensions: [{ name: "customEvent:origin_page" }, { name: "eventName" }], limit: 500 }),
        dateRange.startDate <= completedThrough ? optionalReportWithAvailability(client, cohortRequest) : Promise.resolve({ available: true, report: {} }),
        optionalReportWithAvailability(client, { dateRanges: [dateRange], dimensions: [{ name: "landingPage" }, { name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], dimensionFilter: { filter: { fieldName: "landingPage", stringFilter: { matchType: "BEGINS_WITH", value: "/convenios/" } } }, limit: 100 }),
        optionalReportWithAvailability(client, { ...request, dimensions: [{ name: "eventName" }, { name: "customEvent:provider" }], limit: 100 }),
    ]);
    const limited = cohorts.report.metadata?.subjectToThresholding || cohorts.report.metadata?.dataLossFromOtherRow;
    return {
        available: totals.available,
        totals: parseMetricRows(totals.report).map(r => ({ event: r.dimensions[0], users: r.metrics[0], events: r.metrics[1] })),
        originsAvailable: origin.available, origins: parseMetricRows(origin.report).filter(r => /^\/convenios\/[a-z0-9-]+$/.test(r.dimensions[0])).map(r => ({ page: r.dimensions[0], event: r.dimensions[1], users: r.metrics[0] })),
        landingAvailable: landing.available, landing: parseMetricRows(landing.report).filter(r => /^\/convenios\/[a-z0-9-]+\/?$/.test(r.dimensions[0])).map(r => ({ page: r.dimensions[0], channel: r.dimensions[1], sessions: r.metrics[0] })),
        providersAvailable: providers.available, providers: parseMetricRows(providers.report).filter(r => ["stripe", "google_play"].includes(r.dimensions[1])).map(r => ({ event: r.dimensions[0], provider: r.dimensions[1], users: r.metrics[0] })),
        cohortsAvailable: cohorts.available && !limited,
        cohorts: cohorts.available && !limited ? buildActivationCohorts(cohorts.report, dateRange, completedThrough) : [],
        completedThrough,
        definition: "Fuente: GA4, solo consentimiento y revisión v3. Usuarios por evento, no un embudo secuencial. Primera jornada: nuevo día trabajado persistido con cero jornadas conocidas. Cohortes por fecha UTC de activación; observadas hasta el último día completo. D1/D7/D30 son días exactos, no ventanas. Tasas ocultas con menos de 5 activaciones. Sin identificación entre dispositivos; borrar datos o retirar consentimiento rompe la continuidad. Las entradas por canal usan la atribución estándar de GA4; el origen CTA solo dura la sesión. Premium activo es un derecho verificado por proveedor, no ingreso cobrado. No se calculan tasas CTA ni Premium dividiendo eventos independientes.",
        configuration: "Si un bloque no está disponible, revisar dimensiones de evento: event_revision, modo_acceso, auth_state, origin_page, activation_cohort, retention_day, activity_kind y provider. Cero filas significa datos insuficientes; no prueba ausencia de actividad.",
    };
}

async function queryMetrics(client, dateRange) {
    const growthPromise = queryGrowthMetrics(client, dateRange);
    const productEvents = ["calendar_configured", "shift_added", "balance_viewed", "ai_consultation_succeeded", "premium_checkout_started", "premium_activation_confirmed"];
    const funnelEvents = [
        "app_open",
        "calendar_configured",
        "shift_added",
        "balance_viewed",
        "registration_prompt_shown",
        "signup_started",
        "signup_completed",
        "premium_checkout_started",
        "premium_activation_confirmed",
        "ai_consultation_succeeded",
    ];
    const last24Hours = { startDate: "yesterday", endDate: "today" };

    const [overview, daily, productResult, funnelResult] = await Promise.all([
        client.runReport({ dateRanges: [dateRange], metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "newUsers" }, { name: "engagedSessions" }, { name: "engagementRate" }, { name: "averageSessionDuration" }] }),
        client.runReport({ dateRanges: [dateRange], dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }, { name: "sessions" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: 100 }),
        optionalReportWithAvailability(client, eventReport(dateRange, productEvents)),
        optionalReportWithAvailability(client, eventReport(dateRange, funnelEvents)),
    ]);
    const product = productResult.report;
    const funnelReport = funnelResult.report;

    const [devices, browsers, languages, locations, acquisition, pages, events24h, lastEvent] = await Promise.all([
        optionalReport(client, { dateRanges: [dateRange], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "activeUsers" }], limit: 20 }),
        optionalReport(client, { dateRanges: [dateRange], dimensions: [{ name: "browser" }], metrics: [{ name: "activeUsers" }], limit: 20 }),
        optionalReport(client, { dateRanges: [dateRange], dimensions: [{ name: "language" }], metrics: [{ name: "activeUsers" }], limit: 20 }),
        optionalReport(client, { dateRanges: [dateRange], dimensions: [{ name: "country" }, { name: "region" }, { name: "city" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 30 }),
        optionalReport(client, { dateRanges: [dateRange], dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 20 }),
        optionalReport(client, { dateRanges: [dateRange], dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 20 }),
        optionalReport(client, { dateRanges: [last24Hours], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 100 }),
        optionalReport(client, { dateRanges: [last24Hours], dimensions: [{ name: "date" }, { name: "eventName" }], metrics: [{ name: "eventCount" }], orderBys: [{ dimension: { dimensionName: "date" }, desc: true }], limit: 1 }),
    ]);

    let newReturning = null;
    try {
        newReturning = await client.runReport({ dateRanges: [dateRange], dimensions: [{ name: "newVsReturning" }], metrics: [{ name: "activeUsers" }], limit: 2 });
    } catch (error) { /* Returning-user data stays unavailable instead of being estimated. */ }

    let accessMode = { available: false, values: [], reason: "Registra modo_acceso, auth_state y event_revision como dimensiones de evento en GA4." };
    let authState = { available: false, values: [], reason: accessMode.reason };
    let platformEvents = [];
    try {
        const report = await client.runReport({
            dateRanges: [dateRange],
            dimensions: [{ name: "customEvent:modo_acceso" }, { name: "eventName" }, { name: "customEvent:auth_state" }],
            metrics: [{ name: "eventCount" }],
            dimensionFilter: { andGroup: { expressions: [
                { filter: { fieldName: "eventName", inListFilter: { values: ["app_open", ...productEvents] } } },
                { filter: { fieldName: "customEvent:event_revision", stringFilter: { value: "v3" } } },
            ] } },
            limit: 50,
        });
        const rows = parseMetricRows(report);
        const aggregateByDimension = (index, filter) => {
            const totals = new Map();
            rows.filter(filter).forEach((row) => totals.set(row.dimensions[index], (totals.get(row.dimensions[index]) || 0) + row.metrics[0]));
            return Array.from(totals, ([label, value]) => ({ label, value }));
        };
        const appOpenRows = (row) => row.dimensions[1] === "app_open";
        accessMode = { available: true, values: aggregateByDimension(0, appOpenRows) };
        authState = { available: true, values: aggregateByDimension(2, appOpenRows) };
        const platformLabels = {
            calendar_configured: "calendario",
            shift_added: "jornada guardada",
            balance_viewed: "balance consultado",
            ai_consultation_succeeded: "consulta IA satisfactoria",
            premium_checkout_started: "checkout Premium iniciado",
            premium_activation_confirmed: "Premium activado",
        };
        const byPlatformAndEvent = new Map();
        rows.filter((row) => platformLabels[row.dimensions[1]]).forEach((row) => {
            const label = `${row.dimensions[0]} · ${platformLabels[row.dimensions[1]]}`;
            byPlatformAndEvent.set(label, (byPlatformAndEvent.get(label) || 0) + row.metrics[0]);
        });
        platformEvents = Array.from(byPlatformAndEvent, ([label, value]) => ({ label, value }));
    } catch (error) {
        accessMode.reason = "Registra modo_acceso, auth_state y event_revision como dimensiones personalizadas de evento en GA4; los datos nuevos aparecerán tras configurarlas.";
        authState.reason = accessMode.reason;
    }

    const overviewRow = parseMetricRows(overview)[0] || { metrics: [0, 0, 0, 0, 0, 0] };
    const returningRows = parseMetricRows(newReturning || {});
    const returningUsers = newReturning ? (returningRows.find((row) => row.dimensions[0] === "returning") || { metrics: [0] }).metrics[0] : null;
    const dailyRows = parseMetricRows(daily);
    const productByEvent = metricByEvent(product);
    const funnelByEvent = metricByEvent(funnelReport);
    const funnel = [
        { id: "app_open", label: "Visita o apertura", value: funnelByEvent.app_open || 0 },
        { id: "product_use", label: "Uso del calendario o balance", value: (funnelByEvent.calendar_configured || 0) + (funnelByEvent.shift_added || 0) + (funnelByEvent.balance_viewed || 0) },
        { id: "registration_prompt_shown", label: "Aviso de registro mostrado", value: funnelByEvent.registration_prompt_shown || 0 },
        { id: "signup_started", label: "Registro iniciado", value: funnelByEvent.signup_started || 0 },
        { id: "signup_completed", label: "Registro completado", value: funnelByEvent.signup_completed || 0 },
        { id: "premium_checkout_started", label: "Checkout Premium iniciado", value: funnelByEvent.premium_checkout_started || 0 },
        { id: "premium_activation_confirmed", label: "Premium activado confirmado", value: funnelByEvent.premium_activation_confirmed || 0 },
    ];

    const lastEventRow = parseMetricRows(lastEvent)[0];
    return {
        growth: await growthPromise,
        overview: {
            activeUsers: overviewRow.metrics[0] || 0,
            sessions: overviewRow.metrics[1] || 0,
            newUsers: overviewRow.metrics[2] || 0,
            returningUsers,
            returningRate: returningUsers !== null && overviewRow.metrics[0] ? Number(((returningUsers / overviewRow.metrics[0]) * 100).toFixed(1)) : null,
            engagedSessions: overviewRow.metrics[3] || 0,
            engagementRate: Number(((overviewRow.metrics[4] || 0) * 100).toFixed(1)),
            averageSessionDuration: Number((overviewRow.metrics[5] || 0).toFixed(1)),
        },
        daily: dailyRows.map((row) => ({ date: row.dimensions[0], activeUsers: row.metrics[0], sessions: row.metrics[1] })),
        product: {
            available: productResult.available,
            unavailableReason: productResult.available ? "" : "Registra event_revision como dimensión de evento en GA4 para separar los eventos corregidos del histórico anterior.",
            calendarConfigured: productByEvent.calendar_configured || 0,
            shiftsAdded: productByEvent.shift_added || 0,
            balancesViewed: productByEvent.balance_viewed || 0,
            aiConsultations: productByEvent.ai_consultation_succeeded || 0,
            premiumCheckoutStarted: productByEvent.premium_checkout_started || 0,
            premiumActivationConfirmed: productByEvent.premium_activation_confirmed || 0,
            accessMode,
            authState,
            platformEvents,
            devices: parseMetricRows(devices).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
            browsers: parseMetricRows(browsers).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
            languages: parseMetricRows(languages).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
            locations: parseMetricRows(locations).map((row) => ({ label: row.dimensions.filter((value) => value && value !== "(not set)").reverse().join(" · "), value: row.metrics[0] })).filter((row) => row.label),
            acquisition: parseMetricRows(acquisition).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
            pages: parseMetricRows(pages).map((row) => ({ label: row.dimensions[0], value: row.metrics[0] })),
        },
        funnel,
        funnelAvailable: funnelResult.available,
        funnelUnavailableReason: funnelResult.available ? "" : "Registra event_revision como dimensión de evento en GA4 para separar los eventos corregidos del histórico anterior.",
        measurement: {
            status: "ok",
            eventsLast24h: metricByEvent(events24h),
            lastEvent: lastEventRow ? { dateHourMinute: lastEventRow.dimensions[0], name: lastEventRow.dimensions[1], count: lastEventRow.metrics[0] } : null,
            message: lastEventRow ? "GA4 está devolviendo datos." : "GA4 respondió correctamente, pero no recibió eventos durante las últimas 24 horas.",
        },
    };
}

function createGa4MetricsHandler({ getPropertyId, createClient = createGa4Client, now = () => new Date() }) {
    const cache = new Map();
    const pending = new Map();
    return async (req, res) => {
        if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido.", code: "method_not_allowed" });
        if (req.rawBody && req.rawBody.length > 2048) return res.status(413).json({ error: "Solicitud demasiado grande.", code: "invalid_request" });
        if (req.body != null && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== "period"))) return res.status(400).json({ error: "Solo se admite el periodo.", code: "invalid_request" });

        let range;
        try {
            range = resolvePeriod((req.body || {}).period || "30d", now());
        } catch (error) {
            return res.status(error.status || 400).json({ error: error.message, code: error.code || "invalid_request" });
        }

        const { period, ...dateRange } = range;
        const cacheKey = period;
        const rangeKey = `${dateRange.startDate}:${dateRange.endDate}`;
        const cached = cache.get(cacheKey);
        if (cached && cached.rangeKey === rangeKey && now().getTime() - cached.createdAt < (cached.status === 200 ? MAX_CACHE_AGE_MS : 30000)) {
            return res.status(cached.status).json({ ...cached.value, cached: true, updatedAt: new Date(cached.createdAt).toISOString(), range });
        }

        const pendingKey = `${period}:${rangeKey}`;
        const shared = pending.has(pendingKey);
        // Four fixed periods, one shared read per period; cache failures briefly
        // too, so an unavailable GA4 property cannot trigger a retry storm.
        if (!shared) pending.set(pendingKey, (async () => {
          try {
            return { status: 200, value: await queryMetrics(createClient({ propertyId: getPropertyId() }), dateRange) };
          } catch (error) {
            const details = gaErrorDetails(error);
            // This log deliberately excludes the property ID, credentials and response data.
            console.error("metricasGa4: Analytics Data API error", {
                httpStatus: details.status,
                apiStatus: details.apiStatus || null,
                message: details.message || null,
            });
            return { status: details.status, value: {
                error: "No se pudieron consultar las métricas de GA4.",
                code: details.code,
                measurement: { status: details.code, message: details.clientMessage },
            } };
          }
        })());
        const result = await pending.get(pendingKey);
        if (!shared) {
            cache.set(cacheKey, { ...result, rangeKey, createdAt: now().getTime() });
            pending.delete(pendingKey);
        }
        return res.status(result.status).json({ ...result.value, cached: shared, updatedAt: now().toISOString(), range });
    };
}

module.exports = { MAX_CACHE_AGE_MS, createGa4Client, createGa4MetricsHandler, gaErrorDetails, queryMetrics, resolvePeriod, buildActivationCohorts };
