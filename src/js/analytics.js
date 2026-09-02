// Analítica agregada en GA4. No se guardan visitas individuales en Firestore ni
// se envían emails, UID de Firebase ni identificadores locales a Analytics.
const analytics = (() => {
    try { return firebase.analytics(); }
    catch (error) { console.warn("Analytics no disponible; los eventos no se enviarán.", error); return { logEvent() {} }; }
})();
window.analytics = analytics;

const ANALYTICS_SESSION_KEY = "balance_laboral_analytics_session_v2";
let analyticsInitialized = false;
let appOpenRegistered = false;

function accessMode() {
    if (typeof window.esContextoPlayTwa === "function" && window.esContextoPlayTwa()) return "TWA";
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) return "PWA";
    return "web";
}
function deviceClass() { const width = Math.min(window.innerWidth || 0, window.screen.width || 0) || 0; return width <= 767 ? "movil" : width <= 1024 ? "tablet" : "escritorio"; }
function browserFamily() { const ua = navigator.userAgent || ""; if (/Edg\//.test(ua)) return "Edge"; if (/Firefox\//.test(ua)) return "Firefox"; if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chrome"; if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari"; return "Otro"; }
function safeEvent(name, params = {}) { analytics.logEvent(name, params); }

function registerAppOpen() {
    if (appOpenRegistered) return;
    appOpenRegistered = true;
    let returning = false;
    try { returning = localStorage.getItem(ANALYTICS_SESSION_KEY) === "1"; localStorage.setItem(ANALYTICS_SESSION_KEY, "1"); } catch (error) { /* storage may be blocked */ }
    const context = { modo_acceso: accessMode(), clase_dispositivo: deviceClass(), navegador: browserFamily(), idioma: (navigator.language || "es").split("-")[0].toLowerCase() };
    safeEvent("app_open", context);
    if (returning) safeEvent("anonymous_return_visit", { modo_acceso: context.modo_acceso });
}

function trackUsoHerramienta(tipo) { safeEvent("calendar_configured", { tipo_accion: String(tipo || "desconocido").slice(0, 40), modo_acceso: accessMode() }); }
function trackClickCalendario() { safeEvent("shift_added", { modo_acceso: accessMode() }); safeEvent("calendar_configured", { modo_acceso: accessMode() }); }
function trackClickDatosUsuario() { safeEvent("balance_viewed", { modo_acceso: accessMode() }); }
function trackAperturaPremium() { safeEvent("premium_prompt_shown", { modo_acceso: accessMode() }); }
function trackExportacionPDF(resultado) { safeEvent("pdf_exported", { resultado: resultado === "exito" ? "exito" : "intento", modo_acceso: accessMode() }); }
function trackSignupStarted() { safeEvent("signup_started", { modo_acceso: accessMode() }); }
function trackSignupCompleted() { safeEvent("signup_completed", { modo_acceso: accessMode() }); }
function trackRegistrationPromptShown() { safeEvent("registration_prompt_shown", { modo_acceso: accessMode() }); }
function trackPremiumCheckoutStarted() { safeEvent("premium_checkout_started", { modo_acceso: accessMode() }); }

function inicializarAnalytics() { if (analyticsInitialized) return; analyticsInitialized = true; registerAppOpen(); }
document.addEventListener("DOMContentLoaded", inicializarAnalytics);
