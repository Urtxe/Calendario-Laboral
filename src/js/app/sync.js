window.cargarDatosDesdeFirebase = function() {
    if (!usuarioActual) return;
    mostrarSync(true);
    var userRef = obtenerReferenciaUsuario();
    var datosAnonimos = window.hayMigracionAnonimaPendiente && window.hayMigracionAnonimaPendiente()
        ? obtenerDatosAnonimosLocales()
        : null;

    diasMarcados = {};
    objetivosAnuales = {};
    tipoJornadaPorAnio = {};
    horasExtraPorDia = {};
    horasExtraCompensadas = {};

    Promise.all([
        userRef.get(),
        userRef.collection('years').get()
    ]).then(function(resultados) {
        var doc = resultados[0];
        var yearsSnap = resultados[1];

        if (doc.exists) {
            var d = doc.data();
            ciudadActual = d.ciudadActual || 'Donostia';
            sectorUsuario = d.sectorUsuario || (d.esHosteleria ? 'hosteleria' : 'general');
            esHosteleria = (sectorUsuario === 'hosteleria' || sectorUsuario === 'alojamientos');

            if (d.diasMarcados) diasMarcados = Object.assign({}, diasMarcados, d.diasMarcados);
            if (d.objetivosAnuales) objetivosAnuales = Object.assign({}, objetivosAnuales, d.objetivosAnuales);
            if (d.tipoJornadaPorAnio) tipoJornadaPorAnio = Object.assign({}, tipoJornadaPorAnio, d.tipoJornadaPorAnio);
            if (d.horasExtraPorDia) horasExtraPorDia = Object.assign({}, horasExtraPorDia, d.horasExtraPorDia);
            if (d.horasExtraCompensadas) horasExtraCompensadas = Object.assign({}, horasExtraCompensadas, d.horasExtraCompensadas);
        }

        yearsSnap.forEach(function(yearDoc) {
            combinarDatosDeAnio(yearDoc.data(), yearDoc.id);
        });

        if (datosAnonimos && yearsSnap.empty) {
            ciudadActual = datosAnonimos.ciudadActual || ciudadActual;
            sectorUsuario = datosAnonimos.sectorUsuario || sectorUsuario;
            esHosteleria = sectorUsuario === 'hosteleria' || sectorUsuario === 'alojamientos';
            diasMarcados = datosAnonimos.diasMarcados || diasMarcados;
            objetivosAnuales = datosAnonimos.objetivosAnuales || objetivosAnuales;
            tipoJornadaPorAnio = datosAnonimos.tipoJornadaPorAnio || tipoJornadaPorAnio;
            horasExtraPorDia = datosAnonimos.horasExtraPorDia || horasExtraPorDia;
            horasExtraCompensadas = datosAnonimos.horasExtraCompensadas || horasExtraCompensadas;
        }

        document.getElementById('ciudadUsuario').value = ciudadActual;
        var selectorSector = document.getElementById('sectorUsuario');
        if (selectorSector) selectorSector.value = sectorUsuario;

        cargarFestivosOficiales(ciudadActual, anioActual);

        if (objetivosAnuales[anioActual] !== undefined) {
            document.getElementById('horasAnuales').value = objetivosAnuales[anioActual];
        }

        if (tipoJornadaPorAnio[anioActual] !== undefined) {
            var valorCargado = tipoJornadaPorAnio[anioActual];
            var selector = document.getElementById('tipoJornada');
            var inputCustom = document.getElementById('inputJornadaCustom');
            var valoresEstandar = ["1", "0.875", "0.75", "0.625", "0.5"];

            if (selector) {
                if (valoresEstandar.includes(valorCargado.toString())) {
                    selector.value = valorCargado;
                    if (inputCustom) inputCustom.style.display = 'none';
                } else {
                    selector.value = 'custom';
                    if (inputCustom) {
                        inputCustom.value = valorCargado;
                        inputCustom.style.display = 'block';
                    }
                }
            }
        }

        renderTodo();
        mostrarSync(false);
        if (datosAnonimos && yearsSnap.empty) guardarTodoEnFirebase();
    }).catch(function(e) {
        console.error("Error Firestore:", e);
        mostrarSync(false);
        cargarFestivosOficiales('Donostia', anioActual);
        renderTodo();
    });
};

function guardarTodoEnFirebase() {
    if (!usuarioActual) {
        guardarDatosAnonimosLocales();
        return;
    }
    mostrarSync(true);

    var userRef = obtenerReferenciaUsuario();
    var yearRef = userRef.collection('years').doc(String(anioActual));
    var jornadaActual = obtenerValorJornada();
    var horasAnualesActuales = parseInt(document.getElementById('horasAnuales').value) || 0;

    tipoJornadaPorAnio[anioActual] = jornadaActual;
    objetivosAnuales[anioActual] = horasAnualesActuales;

    Promise.all([
        userRef.set({
            ciudadActual: ciudadActual,
            sectorUsuario: sectorUsuario,
            esHosteleria: (sectorUsuario === 'hosteleria' || sectorUsuario === 'alojamientos'),
            diasMarcados: firebase.firestore.FieldValue.delete(),
            objetivosAnuales: firebase.firestore.FieldValue.delete(),
            tipoJornadaPorAnio: firebase.firestore.FieldValue.delete(),
            horasExtraPorDia: firebase.firestore.FieldValue.delete(),
            horasExtraCompensadas: firebase.firestore.FieldValue.delete()
        }, { merge: true }),
        yearRef.set({
            horasAnuales: horasAnualesActuales,
            tipoJornada: jornadaActual,
            diasMarcados: filtrarObjetosPorAnio(diasMarcados, anioActual),
            horasExtraPorDia: filtrarObjetosPorAnio(horasExtraPorDia, anioActual),
            horasExtraCompensadas: filtrarObjetosPorAnio(horasExtraCompensadas, anioActual),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
    ]).then(function() {
        mostrarSync(false);
        if (window.hayMigracionAnonimaPendiente && window.hayMigracionAnonimaPendiente()) {
            window.confirmarMigracionAnonima();
        }
        console.log("☁️ Datos sincronizados. Jornada guardada: " + tipoJornadaPorAnio[anioActual]);
        actualizarTablaResumen();
    }).catch(function(e) {
        console.error("Error al guardar:", e);
        mostrarSync(false);
    });
}

function mostrarSync(m) {
    var indicator = document.getElementById('sync-indicator');
    if (indicator) indicator.style.display = m ? 'block' : 'none';
}
