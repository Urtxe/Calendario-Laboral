// ============================================
// SISTEMA DE ANALÍTICA AVANZADA - BALANCE LABORAL
// ============================================

const analytics = firebase.analytics();

/**
 * Registra la visita inicial con datos técnicos no invasivos
 */
async function registrarVisita() {
    const tiempoCarga = Math.round(performance.now());
    const esPWA = window.matchMedia('(display-mode: standalone)').matches;
    const prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const deviceInfo = {
        modo_acceso: esPWA ? 'PWA_Instalada' : 'Navegador_Web',
        resolucion: `${window.screen.width}x${window.screen.height}`,
        idioma: navigator.language,
        tema_visual: prefiereOscuro ? 'Oscuro' : 'Claro',
        tiempo_carga_ms: tiempoCarga,
        version_app: '1.0.7' // Cámbialo cuando actualices la app
    };

    // 1. Log a Google Analytics (Estadísticas generales)
    analytics.logEvent('session_start_advanced', deviceInfo);

    // 2. Registro en Firestore (Solo si está logueado para ver su historial técnico)
    if (window.usuarioActual) {
        db.collection('usuarios').doc(window.usuarioActual.uid).collection('visitas').add({
            ...deviceInfo,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    }else {
        // SI NO HAY USUARIO, GUARDA EN LA CARPETA GENERAL DE ANÓNIMOS
        db.collection('visitasAnonimas').add({
            ...deviceInfo,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
}
}

/**
 * Registra qué herramientas se usan más (Abonable, Extra, etc.)
 * Llama a esto desde tu función seleccionarModo(tipo)
 */
function trackUsoHerramienta(tipo) {
    analytics.logEvent('uso_herramienta', {
        tipo_accion: tipo,
        es_premium: localStorage.getItem('esPremium') === 'true'
    });
}

/**
 * Registra si el PDF se descarga correctamente
 * Útil para detectar fallos en móviles viejos
 */
function trackExportacionPDF(resultado, errorMsg = '') {
    analytics.logEvent('exportar_pdf', {
        resultado: resultado, // 'exito' o 'error'
        error: errorMsg,
        mes: nombresMeses[mesActual]
    });
}

/**
 * Captura errores de código automáticamente para que puedas arreglarlos
 */
window.onerror = function(message, source, lineno, colno, error) {
    analytics.logEvent('error_tecnico', {
        mensaje: message,
        linea: lineno,
        archivo: source
    });
};

// Iniciar registro al cargar la página
document.addEventListener('DOMContentLoaded', registrarVisita);
