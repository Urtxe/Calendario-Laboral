// Google Analytics / Firebase Analytics is optional. The SDK is not loaded and
// no analytics event is sent until the visitor has explicitly accepted it.
const ANALYTICS_CONSENT_STORAGE_KEY = "balance_laboral_analytics_consent_v1";
const ANALYTICS_SDK_URL = "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics-compat.js";
const FIREBASE_APP_SDK_URL = "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js";

let analytics = null;
const analyticsSdkPromises = new Map();
let analyticsInitialized = false;
let appOpenRegistered = false;
const pendingAnalyticsEvents = [];
const PRODUCT_EVENTS = new Set(["app_open", "calendar_configured", "shift_added", "first_shift_saved", "repeat_shift_saved", "balance_viewed", "signup_started", "signup_completed", "login", "registration_prompt_shown", "registration_prompt_clicked", "registration_prompt_dismissed", "premium_prompt_shown", "premium_checkout_started", "premium_activation_confirmed", "ai_consultation_succeeded", "pdf_exported", "convenio_cta_clicked", "cohort_return"]);

function safePagePath() {
    const path = window.location.pathname || "/";
    return path.length + window.location.origin.length <= 1000 && /^\/convenios(?:\/[a-z0-9-]+)?\/?$/.test(path) ? path : "/";
}

function isSeoOrigin(value) {
    return typeof value === "string" && value.length <= 100 && /^\/convenios\/[a-z0-9-]+$/.test(value);
}

function safeReferrer() {
    try {
        const host = new URL(document.referrer).hostname;
        if (host === window.location.hostname) return window.location.origin + "/";
        if (/^(?:www\.)?google\.[a-z.]+$/.test(host)) return "https://www.google.com/";
        if (["www.bing.com", "duckduckgo.com", "search.yahoo.com"].includes(host)) return `https://${host}/`;
        const socialHosts = {
            "facebook.com": "www.facebook.com", "www.facebook.com": "www.facebook.com", "m.facebook.com": "www.facebook.com", "l.facebook.com": "www.facebook.com", "lm.facebook.com": "www.facebook.com",
            "instagram.com": "www.instagram.com", "www.instagram.com": "www.instagram.com", "l.instagram.com": "www.instagram.com",
            "linkedin.com": "www.linkedin.com", "www.linkedin.com": "www.linkedin.com", "lnkd.in": "www.linkedin.com",
            "t.co": "t.co", "x.com": "x.com", "twitter.com": "twitter.com",
            "www.youtube.com": "www.youtube.com", "m.youtube.com": "www.youtube.com", "youtu.be": "www.youtube.com",
            "www.tiktok.com": "www.tiktok.com", "tiktok.com": "www.tiktok.com",
        };
        if (Object.prototype.hasOwnProperty.call(socialHosts, host)) return `https://${socialHosts[host]}/`;
    } catch (_) { /* Unknown and potentially sensitive referrers are omitted. */ }
    return "";
}

function safeParams(params) {
    const result = {};
    const enums = {
        source: ["registration_prompt", "header", "settings", "other"],
        trigger: ["shifts_3", "active_days_2", "balance_views_2", "annual_history", "pdf_export", "advanced_overtime", "other"],
        provider: ["stripe", "google_play"], method: ["email", "google"],
        retention_day: ["1", "7", "30"], activity_kind: ["open", "shift"],
    };
    for (const [key, values] of Object.entries(enums)) if (values.includes(params[key])) result[key] = params[key];
    if (typeof params.activation_cohort === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.activation_cohort)) result.activation_cohort = params.activation_cohort;
    if (isSeoOrigin(params.origin_page)) result.origin_page = params.origin_page;
    return result;
}

function readAnalyticsConsent() {
    try {
        const value = localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
        return value === "granted" || value === "denied" ? value : null;
    } catch (error) {
        return null;
    }
}

function hasAnalyticsConsent() { return readAnalyticsConsent() === "granted"; }

function clearLegacyAnalyticsMarkers() {
    try {
        localStorage.removeItem("bl_anonymous_installation_id");
        localStorage.removeItem("bl_anonymous_visit_state_v1");
        localStorage.removeItem("balance_laboral_analytics_return_v1");
    } catch (error) { /* Storage can be blocked. */ }
}

clearLegacyAnalyticsMarkers();

function setAnalyticsDisabled(disabled) {
    const measurementId = window.BALANCE_LABORAL_ANALYTICS_MEASUREMENT_ID;
    if (measurementId) window[`ga-disable-${measurementId}`] = disabled;
}

function clearGoogleAnalyticsCookies() {
    const hostname = window.location.hostname;
    const labels = hostname.split(".");
    const domains = ["", hostname, `.${hostname}`];
    if (labels.length > 2) domains.push(`.${labels.slice(-2).join(".")}`);
    const cookieNames = document.cookie.split(";").map((item) => item.trim().split("=")[0]).filter((name) => /^_ga(?:_|$)/.test(name));
    for (const name of cookieNames) {
        for (const domain of domains) {
            document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}; SameSite=Lax`;
        }
    }
}

function disableAnalytics() {
    pendingAnalyticsEvents.length = 0;
    try { sessionStorage.removeItem("bl_seo_origin_v1"); sessionStorage.removeItem("bl_seo_pending_cta_v3"); localStorage.removeItem("bl_activation_cohort_v3"); } catch (_) { /* Optional storage. */ }
    setAnalyticsDisabled(true);
    if (analytics && typeof analytics.setAnalyticsCollectionEnabled === "function") analytics.setAnalyticsCollectionEnabled(false);
    if (window.BalanceLaboralConversion && typeof window.BalanceLaboralConversion.clearAnalyticsAttribution === "function") window.BalanceLaboralConversion.clearAnalyticsAttribution();
    clearGoogleAnalyticsCookies();
}

function loadScript(url) {
    if (analyticsSdkPromises.has(url)) return analyticsSdkPromises.get(url);
    const promise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar Firebase Analytics."));
        document.head.appendChild(script);
    });
    analyticsSdkPromises.set(url, promise);
    return promise.catch((error) => {
        analyticsSdkPromises.delete(url);
        throw error;
    });
}

async function loadAnalyticsSdk() {
    if (window.firebase && typeof window.firebase.analytics === "function") return;
    if (!window.firebase || typeof window.firebase.initializeApp !== "function") {
        await loadScript(FIREBASE_APP_SDK_URL);
    }
    if (!window.firebase.apps || !window.firebase.apps.length) {
        if (!window.BALANCE_LABORAL_FIREBASE_CONFIG) throw new Error("Falta la configuración pública de Firebase.");
        window.firebase.initializeApp(window.BALANCE_LABORAL_FIREBASE_CONFIG);
    }
    await loadScript(ANALYTICS_SDK_URL);
}

function accessMode() {
    if (typeof window.esContextoPlayTwa === "function" && window.esContextoPlayTwa()) return "android_twa";
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) return "pwa";
    return "web";
}

function authState() {
    if (window.BALANCE_LABORAL_AUTH_STATE) return window.BALANCE_LABORAL_AUTH_STATE;
    return window.usuarioActual && window.usuarioActual.uid ? "authenticated" : "anonymous";
}

function safeEvent(name, params = {}) {
    if (!hasAnalyticsConsent() || !PRODUCT_EVENTS.has(name)) return;
    const payload = { ...safeParams(params), modo_acceso: accessMode(), auth_state: authState() === "authenticated" ? "authenticated" : "anonymous", event_revision: "v3" };
    try {
        const origin = sessionStorage.getItem("bl_seo_origin_v1");
        if (isSeoOrigin(origin) && !payload.origin_page) payload.origin_page = origin;
    } catch (_) { /* Optional attribution. */ }
    if (!analytics) { if (pendingAnalyticsEvents.length < 30) pendingAnalyticsEvents.push([name, payload]); return; }
    try { analytics.logEvent(name, payload); } catch (_) { /* Analytics must not interrupt product actions. */ }
}

// The conversion funnel retains its public API but cannot bypass consent.
window.analytics = { logEvent: safeEvent };

function consumePendingSeoClick() {
    if (!hasAnalyticsConsent() || !["/", "/index.html"].includes(window.location.pathname || "/")) return;
    try {
        const pending = JSON.parse(sessionStorage.getItem("bl_seo_pending_cta_v3") || "null");
        sessionStorage.removeItem("bl_seo_pending_cta_v3");
        if (pending && isSeoOrigin(pending.page) && Date.now() - pending.createdAt >= 0 && Date.now() - pending.createdAt <= 5 * 60 * 1000) safeEvent("convenio_cta_clicked", { origin_page: pending.page });
    } catch (_) { /* Optional, short-lived navigation handoff. */ }
}

function registerAppOpen() {
    if (appOpenRegistered || !hasAnalyticsConsent() || (window.location.pathname && window.location.pathname !== "/" && window.location.pathname !== "/index.html")) return;
    appOpenRegistered = true;
    consumePendingSeoClick();
    safeEvent("app_open");
    if (window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackReturn("open");
}

async function enableAnalytics() {
    if (!hasAnalyticsConsent()) return;
    if (analyticsInitialized && analytics) {
        setAnalyticsDisabled(false);
        if (typeof analytics.setAnalyticsCollectionEnabled === "function") analytics.setAnalyticsCollectionEnabled(true);
        return;
    }
    try {
        setAnalyticsDisabled(false);
        await loadAnalyticsSdk();
        if (!hasAnalyticsConsent()) {
            setAnalyticsDisabled(true);
            return;
        }
        // Set defaults before SDK initialization, including its automatic page view.
        // Enhanced measurement must also exclude automatic outbound/form tracking in GA4.
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function() { window.dataLayer.push(arguments); };
        window.gtag("set", { page_location: window.location.origin + safePagePath(), page_referrer: safeReferrer(), page_title: safePagePath() === "/" ? "Balance Laboral" : "Convenios | Balance Laboral", allow_google_signals: false, allow_ad_personalization_signals: false });
        analytics = firebase.analytics();
        if (typeof analytics.setAnalyticsCollectionEnabled === "function") analytics.setAnalyticsCollectionEnabled(true);
        analyticsInitialized = true;
        pendingAnalyticsEvents.splice(0).forEach(([name, payload]) => { try { analytics.logEvent(name, payload); } catch (_) { /* Optional measurement. */ } });
        registerAppOpen();
    } catch (error) {
        setAnalyticsDisabled(true);
        console.warn("Analytics no se pudo inicializar; no se enviarán eventos.", error);
    }
}

function updateConsentUi({ forceOpen = false } = {}) {
    let dialog = document.getElementById("analytics-consent");
    if (!dialog && document.body && (forceOpen || readAnalyticsConsent() === null)) {
        const style = document.createElement("link");
        style.rel = "stylesheet";
        style.href = "/src/css/components/_analytics-consent.css";
        document.head.appendChild(style);
        dialog = document.createElement("section");
        dialog.id = "analytics-consent";
        dialog.className = "analytics-consent";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "false");
        dialog.setAttribute("aria-labelledby", "analytics-consent-title");
        dialog.innerHTML = '<div class="analytics-consent__content"><h2 id="analytics-consent-title">Analítica opcional</h2><p>Si aceptas, usamos Google Analytics mediante Firebase Analytics para medir visitas, clics desde convenios, uso, registro, Premium y regresos D1/D7/D30. Guardamos localmente el origen de la sesión y una fecha de activación con marcas de deduplicación. Google puede usar sus propias cookies e identificadores seudónimos. No enviamos tu email, UID de Firebase ni el contenido de jornadas o consultas IA.</p><p>Puedes cambiar tu decisión desde <a href="/?analytics=preferences">Preferencias de analítica</a> o consultar la <a href="/privacy">Política de privacidad</a>.</p><div class="analytics-consent__actions"><button type="button" class="analytics-consent__reject" data-analytics-consent="denied">Rechazar</button><button type="button" class="analytics-consent__accept" data-analytics-consent="granted">Aceptar analítica</button></div></div>';
        document.body.appendChild(dialog);
        dialog.querySelectorAll("[data-analytics-consent]").forEach((button) => button.addEventListener("click", () => saveAnalyticsConsent(button.dataset.analyticsConsent)));
    }
    if (!dialog) return;
    dialog.hidden = forceOpen ? false : readAnalyticsConsent() !== null;
}

function saveAnalyticsConsent(value) {
    const granted = value === "granted";
    try { localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, granted ? "granted" : "denied"); } catch (error) { /* Storage can be blocked. */ }
    if (granted) enableAnalytics();
    else disableAnalytics();
    updateConsentUi();
}

window.abrirPreferenciasAnalitica = function() {
    updateConsentUi({ forceOpen: true });
    document.getElementById("analytics-consent")?.querySelector("button")?.focus();
};
window.configurarConsentimientoAnalitica = saveAnalyticsConsent;
window.tieneConsentimientoAnalitica = hasAnalyticsConsent;

function initializeAnalyticsConsent() {
    if (!hasAnalyticsConsent()) disableAnalytics();
    document.querySelectorAll("[data-analytics-consent]").forEach((button) => {
        button.addEventListener("click", () => saveAnalyticsConsent(button.dataset.analyticsConsent));
    });
    const showPreferences = new URLSearchParams(window.location.search).get("analytics") === "preferences";
    updateConsentUi({ forceOpen: showPreferences });
    if (hasAnalyticsConsent()) enableAnalytics();
}

document.addEventListener("DOMContentLoaded", initializeAnalyticsConsent);

// Installed apps can stay loaded for days; a visible resume is also a return.
document.addEventListener("visibilitychange", function() {
    const path = window.location.pathname || "/";
    if (document.visibilityState === "visible" && ["/", "/index.html"].includes(path) && hasAnalyticsConsent() && window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackReturn("open");
});

// Shared by existing SEO pages: no CTA markup or legal content needs changing.
document.addEventListener("click", function(event) {
    const link = event.target.closest && event.target.closest('a.btn[href="/"]');
    const origin = safePagePath();
    if (!link || !isSeoOrigin(origin) || !hasAnalyticsConsent()) return;
    try { sessionStorage.setItem("bl_seo_origin_v1", origin); } catch (_) { /* Optional attribution. */ }
    if (event.preventDefault && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !(event.button > 0) && link.target !== "_blank") {
        // Emit once on app arrival: Firebase can lose events on source unload.
        // Native navigation stays immediate; no identifier or URL parameter.
        try { sessionStorage.setItem("bl_seo_pending_cta_v3", JSON.stringify({ page: origin, createdAt: Date.now() })); return; } catch (_) { /* Blocked storage: best-effort source event. */ }
    }
    safeEvent("convenio_cta_clicked", { origin_page: origin });
});

function trackExportacionPDF(resultado) { if (resultado === "exito") safeEvent("pdf_exported"); }
