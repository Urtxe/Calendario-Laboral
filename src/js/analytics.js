// ============================================
// ANALITICA DE SESION ANONIMA - BALANCE LABORAL
// ============================================

const analytics = (() => {
    try {
        const firebaseAnalytics = firebase.analytics();
        if (window.APP_CONFIG && window.APP_CONFIG.analyticsEnabled === false) {
            if (typeof firebaseAnalytics.setAnalyticsCollectionEnabled === 'function') {
                firebaseAnalytics.setAnalyticsCollectionEnabled(false);
            }
            return { logEvent() {} };
        }
        return firebaseAnalytics;
    } catch (error) {
        console.warn('Analytics no disponible, se usará un cliente sin-op:', error);
        return { logEvent() {} };
    }
})();
window.analytics = analytics;
const APP_VERSION = '1.0.7';
const ANON_SESSION_STORAGE_KEY = 'balance_laboral_anon_session_v1';
const DEFAULT_ANON_ACTIONS = {
    calendario_clicks: 0,
    datos_usuario_clicks: 0,
    cambios_mes: 0,
    cambios_anio: 0,
    modos_seleccionados: 0,
    aperturas_premium: 0,
    intentos_pdf: 0,
    errores: 0
};

let anonSessionCache = null;
let anonSessionReadyPromise = null;
let analyticsInitialized = false;
let visitaRegistrada = false;

function detectarDeviceClass() {
    const width = Math.min(window.innerWidth || window.screen.width || 0, window.screen.width || 0) || 0;

    if (width <= 767) return 'movil';
    if (width <= 1024) return 'tablet';
    return 'escritorio';
}

function detectarBrowserFamily() {
    const ua = navigator.userAgent || '';

    if (/Edg\//.test(ua)) return 'Edge';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
    return 'Otro';
}

function detectarOsFamily() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';

    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Win/i.test(platform)) return 'Windows';
    if (/Mac/i.test(platform)) return 'macOS';
    if (/Linux/i.test(platform)) return 'Linux';
    return 'Otro';
}

function obtenerThemeActual() {
    const bodyTieneDarkMode = document.body && document.body.classList.contains('dark-mode');
    const prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return (bodyTieneDarkMode || prefiereOscuro) ? 'oscuro' : 'claro';
}

function obtenerLoadBucket(tiempoCarga) {
    if (tiempoCarga < 1000) return '0-1s';
    if (tiempoCarga < 3000) return '1-3s';
    if (tiempoCarga < 5000) return '3-5s';
    return '>5s';
}

function formatearInicioSesion(date) {
    const anio = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const dia = String(date.getDate()).padStart(2, '0');
    const hora = String(date.getHours()).padStart(2, '0');
    return `${anio}-${mes}-${dia} ${hora}:00`;
}

function generarSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }

    return Math.random().toString(36).slice(2, 14);
}

function leerSesionAnonimaStorage() {
    try {
        const raw = sessionStorage.getItem(ANON_SESSION_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('No se pudo leer la sesion anonima:', error);
        return null;
    }
}

function guardarSesionAnonimaStorage(sessionData) {
    try {
        sessionStorage.setItem(ANON_SESSION_STORAGE_KEY, JSON.stringify(sessionData));
    } catch (error) {
        console.warn('No se pudo guardar la sesion anonima:', error);
    }
}

function obtenerSesionAnonima() {
    if (anonSessionCache) return anonSessionCache;

    const existente = leerSesionAnonimaStorage();
    if (existente && existente.session_id && existente.inicio_sesion) {
        existente.visit_id = null;
        existente.visit_creada = false;
        anonSessionCache = existente;
        return anonSessionCache;
    }

    anonSessionCache = {
        session_id: generarSessionId(),
        inicio_sesion: formatearInicioSesion(new Date()),
        visit_id: null,
        visit_creada: false
    };

    guardarSesionAnonimaStorage(anonSessionCache);
    return anonSessionCache;
}

function construirDocumentoSesionAnonima() {
    const tiempoCarga = Math.round(performance.now());
    const sesion = obtenerSesionAnonima();
    const payload = {
        visit_id: sesion.visit_id || generarVisitId(sesion.session_id),
        session_id: sesion.session_id,
        inicio_sesion: sesion.inicio_sesion,
        device_class: detectarDeviceClass(),
        browser_family: detectarBrowserFamily(),
        os_family: detectarOsFamily(),
        language: (navigator.language || 'es').split('-')[0].toLowerCase(),
        theme: obtenerThemeActual(),
        load_bucket: obtenerLoadBucket(tiempoCarga),
        app_version: APP_VERSION,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (!sesion.visit_creada) {
        payload.acciones = { ...DEFAULT_ANON_ACTIONS };
    }

    return payload;
}

function generarVisitId(sessionId) {
    const now = new Date();
    const anio = String(now.getFullYear());
    const mes = String(now.getMonth() + 1).padStart(2, '0');
    const dia = String(now.getDate()).padStart(2, '0');
    const hora = String(now.getHours()).padStart(2, '0');
    const minuto = String(now.getMinutes()).padStart(2, '0');
    const segundo = String(now.getSeconds()).padStart(2, '0');
    const milisegundo = String(now.getMilliseconds()).padStart(3, '0');
    return `${anio}${mes}${dia}_${hora}${minuto}${segundo}${milisegundo}_${sessionId}`;
}

function getAnonSessionRef() {
    const sesion = obtenerSesionAnonima();
    return db.collection('visitasAnonimas').doc(sesion.visit_id);
}

function asegurarDocumentoSesionAnonima() {
    if (window.usuarioActual) return Promise.resolve(null);
    if (anonSessionReadyPromise) return anonSessionReadyPromise;

    const sesion = obtenerSesionAnonima();
    if (sesion.visit_creada && sesion.visit_id) {
        return Promise.resolve(null);
    }

    sesion.visit_id = sesion.visit_id || generarVisitId(sesion.session_id);
    const payload = construirDocumentoSesionAnonima();
    anonSessionReadyPromise = getAnonSessionRef().set(payload, { merge: true }).catch(error => {
        console.error('Error creando sesion anonima:', error);
        anonSessionReadyPromise = null;
        throw error;
    }).then(() => {
        const sesion = obtenerSesionAnonima();
        sesion.visit_creada = true;
        guardarSesionAnonimaStorage(sesion);
    });

    return anonSessionReadyPromise;
}

function incrementarAccionAnonima(nombreAccion, cantidad = 1) {
    // Firebase Analytics is the source of truth for product events. Keep this
    // compatibility hook so older UI calls remain safe, but do not duplicate
    // detailed behavioural telemetry in Firestore.
    return undefined;
}

async function registrarVisita() {
    if (visitaRegistrada) return;

    const tiempoCarga = Math.round(performance.now());
    const esPWA = window.matchMedia('(display-mode: standalone)').matches;

    const deviceInfo = {
        modo_acceso: esPWA ? 'PWA_Instalada' : 'Navegador_Web',
        device_class: detectarDeviceClass(),
        browser_family: detectarBrowserFamily(),
        os_family: detectarOsFamily(),
        language: (navigator.language || 'es').split('-')[0].toLowerCase(),
        theme: obtenerThemeActual(),
        load_bucket: obtenerLoadBucket(tiempoCarga),
        app_version: APP_VERSION
    };

    analytics.logEvent('session_start_advanced', deviceInfo);

    visitaRegistrada = true;
}

function trackUsoHerramienta(tipo) {
    analytics.logEvent('uso_herramienta', {
        tipo_accion: tipo,
        es_premium: localStorage.getItem('esPremium') === 'true'
    });

    incrementarAccionAnonima('modos_seleccionados');
}

function trackCambioMes() {
    incrementarAccionAnonima('cambios_mes');
}

function trackCambioAnio() {
    incrementarAccionAnonima('cambios_anio');
}

function trackClickCalendario() {
    incrementarAccionAnonima('calendario_clicks');
}

function trackClickDatosUsuario() {
    incrementarAccionAnonima('datos_usuario_clicks');
}

function trackAperturaPremium() {
    incrementarAccionAnonima('aperturas_premium');
}

function trackExportacionPDF(resultado) {
    analytics.logEvent('exportar_pdf', {
        resultado: resultado
    });

    if (resultado === 'intento') {
        incrementarAccionAnonima('intentos_pdf');
    }
}

window.onerror = function(message, source, lineno, colno, error) {
    analytics.logEvent('error_tecnico', {
        categoria: 'client_error'
    });

    incrementarAccionAnonima('errores');
};

function inicializarAnalytics() {
    if (analyticsInitialized) return;
    analyticsInitialized = true;

    auth.onAuthStateChanged(function(user) {
        window.usuarioActual = user;
        registrarVisita().catch(error => console.error('Error registrando visita:', error));
    });

    setTimeout(() => {
        if (!visitaRegistrada) {
            window.usuarioActual = auth.currentUser || window.usuarioActual;
            registrarVisita().catch(error => console.error('Error registrando visita (fallback):', error));
        }
    }, 2500);
}

document.addEventListener('DOMContentLoaded', inicializarAnalytics);
