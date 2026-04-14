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

var nombresMeses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

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
