var sectorUsuario = 'general';
var ciudadActual = 'Donostia';
var esHosteleria = false;
var festivosCargados = [];
var esPremium = localStorage.getItem('esPremium') === 'true';
window.esPremium = esPremium;
var mesActual = new Date().getMonth();
var anioActual = new Date().getFullYear();
var diasMarcados = {};
var objetivosAnuales = {};
var tipoJornadaPorAnio = {};
var horasExtraPorDia = {};
var horasExtraCompensadas = {};
var modoSeleccionado = null;
var fechaSeleccionadaParaExtras = null;
var planSeleccionado = 'gratis';
var usuarioActual = null;
var ANON_CALENDAR_STORAGE_KEY = 'balance_laboral_anonymous_calendar_v1';
var ANON_CALENDAR_MIGRATION_KEY = 'balance_laboral_anonymous_calendar_migration_pending_v1';

var nombresMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function obtenerDatosAnonimosLocales() {
    try {
        var raw = localStorage.getItem(ANON_CALENDAR_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('No se pudieron leer los datos locales del calendario:', error);
        return null;
    }
}

function cargarDatosAnonimosLocales() {
    var datos = obtenerDatosAnonimosLocales();
    if (!datos || typeof datos !== 'object') return false;

    ciudadActual = typeof datos.ciudadActual === 'string' ? datos.ciudadActual : ciudadActual;
    sectorUsuario = typeof datos.sectorUsuario === 'string' ? datos.sectorUsuario : sectorUsuario;
    esHosteleria = sectorUsuario === 'hosteleria' || sectorUsuario === 'alojamientos';
    diasMarcados = datos.diasMarcados && typeof datos.diasMarcados === 'object' ? datos.diasMarcados : {};
    objetivosAnuales = datos.objetivosAnuales && typeof datos.objetivosAnuales === 'object' ? datos.objetivosAnuales : {};
    tipoJornadaPorAnio = datos.tipoJornadaPorAnio && typeof datos.tipoJornadaPorAnio === 'object' ? datos.tipoJornadaPorAnio : {};
    horasExtraPorDia = datos.horasExtraPorDia && typeof datos.horasExtraPorDia === 'object' ? datos.horasExtraPorDia : {};
    horasExtraCompensadas = datos.horasExtraCompensadas && typeof datos.horasExtraCompensadas === 'object' ? datos.horasExtraCompensadas : {};
    return true;
}

function guardarDatosAnonimosLocales() {
    if (usuarioTieneSesion()) return;
    try {
        localStorage.setItem(ANON_CALENDAR_STORAGE_KEY, JSON.stringify({
            ciudadActual: ciudadActual,
            sectorUsuario: sectorUsuario,
            diasMarcados: diasMarcados,
            objetivosAnuales: objetivosAnuales,
            tipoJornadaPorAnio: tipoJornadaPorAnio,
            horasExtraPorDia: horasExtraPorDia,
            horasExtraCompensadas: horasExtraCompensadas
        }));
    } catch (error) {
        console.warn('No se pudieron guardar los datos locales del calendario:', error);
    }
}

window.marcarMigracionAnonimaPendiente = function() {
    try { localStorage.setItem(ANON_CALENDAR_MIGRATION_KEY, 'true'); } catch (_) { /* Storage is optional. */ }
};
window.hayMigracionAnonimaPendiente = function() {
    try { return localStorage.getItem(ANON_CALENDAR_MIGRATION_KEY) === 'true'; } catch (_) { return false; }
};
window.confirmarMigracionAnonima = function() {
    try { localStorage.removeItem(ANON_CALENDAR_MIGRATION_KEY); } catch (_) { /* Storage is optional. */ }
};

cargarDatosAnonimosLocales();

function sincronizarEstadoPremium(valor) {
    esPremium = !!valor;
    window.esPremium = esPremium;
    localStorage.setItem('esPremium', esPremium ? 'true' : 'false');
}

function usuarioTieneSesion() {
    return !!(window.usuarioActual && window.usuarioActual.uid);
}

function usuarioPuedeUsarPremium() {
    return usuarioTieneSesion() && !!window.esPremium;
}

function obtenerReferenciaUsuario() {
    return db.collection('usuarios').doc(usuarioActual.uid);
}

function filtrarObjetosPorAnio(origen, anio) {
    var prefijo = anio + '-';
    var salida = {};

    if (!origen) return salida;

    Object.keys(origen).forEach(function(clave) {
        if (clave.startsWith(prefijo)) {
            salida[clave] = origen[clave];
        }
    });

    return salida;
}

function combinarDatosDeAnio(docData, anio) {
    if (!docData) return;

    if (docData.diasMarcados) {
        diasMarcados = Object.assign({}, diasMarcados, docData.diasMarcados);
    }
    if (docData.horasExtraPorDia) {
        horasExtraPorDia = Object.assign({}, horasExtraPorDia, docData.horasExtraPorDia);
    }
    if (docData.horasExtraCompensadas) {
        horasExtraCompensadas = Object.assign({}, horasExtraCompensadas, docData.horasExtraCompensadas);
    }
    if (docData.horasAnuales !== undefined && docData.horasAnuales !== null) {
        objetivosAnuales[anio] = docData.horasAnuales;
    }
    if (docData.tipoJornada !== undefined && docData.tipoJornada !== null) {
        tipoJornadaPorAnio[anio] = docData.tipoJornada;
    }
}
