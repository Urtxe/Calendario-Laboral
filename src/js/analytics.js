// Google Analytics / Firebase Analytics is optional. The SDK is not loaded and
// no analytics event is sent until the visitor has explicitly accepted it.
const ANALYTICS_CONSENT_STORAGE_KEY = "balance_laboral_analytics_consent_v1";
const ANALYTICS_SDK_URL = "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics-compat.js";
const FIREBASE_APP_SDK_URL = "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js";

let analytics = null;
const analyticsSdkPromises = new Map();
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
    if (!hasAnalyticsConsent() || !analytics) return;
    analytics.logEvent(name, { ...params, modo_acceso: accessMode(), auth_state: authState(), event_revision: "v2" });
}

// The conversion funnel retains its public API but cannot bypass consent.
window.analytics = { logEvent: safeEvent };

function registerAppOpen() {
    if (appOpenRegistered || !hasAnalyticsConsent()) return;
    appOpenRegistered = true;
    safeEvent("app_open");
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
        dialog.innerHTML = '<div class="analytics-consent__content"><h2 id="analytics-consent-title">Analítica opcional</h2><p>Si aceptas, usamos Google Analytics para medir visitas. Google puede usar sus propias cookies e identificadores seudónimos. No enviamos preguntas, respuestas ni datos de jornadas.</p><p>Puedes cambiar tu decisión desde <a href="/?analytics=preferences">Preferencias de analítica</a> o consultar la <a href="/privacy">Política de privacidad</a>.</p><div class="analytics-consent__actions"><button type="button" class="analytics-consent__reject" data-analytics-consent="denied">Rechazar</button><button type="button" class="analytics-consent__accept" data-analytics-consent="granted">Aceptar analítica</button></div></div>';
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
    document.querySelectorAll("[data-analytics-consent]").forEach((button) => {
        button.addEventListener("click", () => saveAnalyticsConsent(button.dataset.analyticsConsent));
    });
    const showPreferences = new URLSearchParams(window.location.search).get("analytics") === "preferences";
    updateConsentUi({ forceOpen: showPreferences });
    if (hasAnalyticsConsent()) enableAnalytics();
}

document.addEventListener("DOMContentLoaded", initializeAnalyticsConsent);

function trackExportacionPDF(resultado) { if (resultado === "exito") safeEvent("pdf_exported"); }
