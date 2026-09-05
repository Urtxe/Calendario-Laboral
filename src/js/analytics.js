// Google Analytics / Firebase Analytics is optional. The SDK is not loaded and
// no analytics event is sent until the visitor has explicitly accepted it.
const ANALYTICS_CONSENT_STORAGE_KEY = "balance_laboral_analytics_consent_v1";
const ANALYTICS_RETURN_VISIT_KEY = "balance_laboral_analytics_return_v1";
const ANALYTICS_SDK_URL = "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics-compat.js";

let analytics = null;
let analyticsSdkPromise = null;
let analyticsInitialized = false;
let appOpenRegistered = false;

function readAnalyticsConsent() {
    try {
        const value = localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
        return value === "granted" || value === "denied" ? value : null;
    } catch (error) {
        return null;
    }
}

function hasAnalyticsConsent() { return readAnalyticsConsent() === "granted"; }

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
    setAnalyticsDisabled(true);
    if (analytics && typeof analytics.setAnalyticsCollectionEnabled === "function") analytics.setAnalyticsCollectionEnabled(false);
    try { localStorage.removeItem(ANALYTICS_RETURN_VISIT_KEY); } catch (error) { /* Storage can be blocked. */ }
    clearGoogleAnalyticsCookies();
}

function loadAnalyticsSdk() {
    if (window.firebase && typeof window.firebase.analytics === "function") return Promise.resolve();
    if (analyticsSdkPromise) return analyticsSdkPromise;
    analyticsSdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = ANALYTICS_SDK_URL;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar Google Analytics."));
        document.head.appendChild(script);
    });
    return analyticsSdkPromise;
}

function accessMode() {
    if (typeof window.esContextoPlayTwa === "function" && window.esContextoPlayTwa()) return "TWA";
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) return "PWA";
    return "web";
}

function deviceClass() {
    const width = Math.min(window.innerWidth || 0, window.screen.width || 0) || 0;
    return width <= 767 ? "movil" : width <= 1024 ? "tablet" : "escritorio";
}

function browserFamily() {
    const ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "Edge";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
    return "Otro";
}

function safeEvent(name, params = {}) {
    if (!hasAnalyticsConsent() || !analytics) return;
    analytics.logEvent(name, params);
}

// The conversion funnel retains its public API but cannot bypass consent.
window.analytics = { logEvent: safeEvent };

function registerAppOpen() {
    if (appOpenRegistered || !hasAnalyticsConsent()) return;
    appOpenRegistered = true;
    let returning = false;
    try {
        returning = localStorage.getItem(ANALYTICS_RETURN_VISIT_KEY) === "1";
        localStorage.setItem(ANALYTICS_RETURN_VISIT_KEY, "1");
    } catch (error) { /* Storage can be blocked. */ }
    const context = {
        modo_acceso: accessMode(),
        clase_dispositivo: deviceClass(),
        navegador: browserFamily(),
        idioma: (navigator.language || "es").split("-")[0].toLowerCase(),
    };
    safeEvent("app_open", context);
    if (returning) safeEvent("anonymous_return_visit", { modo_acceso: context.modo_acceso });
}

async function enableAnalytics() {
    if (!hasAnalyticsConsent() || analyticsInitialized) return;
    try {
        setAnalyticsDisabled(false);
        await loadAnalyticsSdk();
        if (!hasAnalyticsConsent()) {
            setAnalyticsDisabled(true);
            return;
        }
        analytics = firebase.analytics();
        if (typeof analytics.setAnalyticsCollectionEnabled === "function") analytics.setAnalyticsCollectionEnabled(true);
        analyticsInitialized = true;
        registerAppOpen();
    } catch (error) {
        setAnalyticsDisabled(true);
        console.warn("Analytics no se pudo inicializar; no se enviarán eventos.", error);
    }
}

function updateConsentUi({ forceOpen = false } = {}) {
    const dialog = document.getElementById("analytics-consent");
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

function initializeAnalyticsConsent() {
    document.querySelectorAll("[data-analytics-consent]").forEach((button) => {
        button.addEventListener("click", () => saveAnalyticsConsent(button.dataset.analyticsConsent));
    });
    const showPreferences = new URLSearchParams(window.location.search).get("analytics") === "preferences";
    updateConsentUi({ forceOpen: showPreferences });
    if (hasAnalyticsConsent()) enableAnalytics();
}

document.addEventListener("DOMContentLoaded", initializeAnalyticsConsent);

function trackUsoHerramienta(tipo) { safeEvent("calendar_configured", { tipo_accion: String(tipo || "desconocido").slice(0, 40), modo_acceso: accessMode() }); }
function trackClickCalendario() { safeEvent("shift_added", { modo_acceso: accessMode() }); safeEvent("calendar_configured", { modo_acceso: accessMode() }); }
function trackClickDatosUsuario() { safeEvent("balance_viewed", { modo_acceso: accessMode() }); }
function trackAperturaPremium() { safeEvent("premium_prompt_shown", { modo_acceso: accessMode() }); }
function trackExportacionPDF(resultado) { safeEvent("pdf_exported", { resultado: resultado === "exito" ? "exito" : "intento", modo_acceso: accessMode() }); }
function trackSignupStarted() { safeEvent("signup_started", { modo_acceso: accessMode() }); }
function trackSignupCompleted() { safeEvent("signup_completed", { modo_acceso: accessMode() }); }
function trackRegistrationPromptShown() { safeEvent("registration_prompt_shown", { modo_acceso: accessMode() }); }
function trackPremiumCheckoutStarted() { safeEvent("premium_checkout_started", { modo_acceso: accessMode() }); }
