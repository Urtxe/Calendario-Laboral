// ============================================
// 1. DATOS Y VARIABLES GLOBALES
// ============================================

var sectorUsuario = 'general';
var ciudadActual = 'Donostia';
var esHosteleria = false;
var festivosCargados = []; 
var esPremium = localStorage.getItem('esPremium') === 'true';
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
var usuarioActual = null

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

// ============================================
// 2. SISTEMA DE AUTENTICACIÓN (FIREBASE AUTH)
// ============================================
// ============================================
// 2. SISTEMA DE AUTENTICACIÓN (FIREBASE AUTH)
// ============================================

// ============================================
// 3. SINCRONIZACIÓN (FIRESTORE)
// ============================================
window.cargarDatosDesdeFirebase = function() {
    if (!usuarioActual) return;
    mostrarSync(true);
    var userRef = obtenerReferenciaUsuario();

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

            if (d.diasMarcados) {
                diasMarcados = Object.assign({}, diasMarcados, d.diasMarcados);
            }
            if (d.objetivosAnuales) {
                objetivosAnuales = Object.assign({}, objetivosAnuales, d.objetivosAnuales);
            }
            if (d.tipoJornadaPorAnio) {
                tipoJornadaPorAnio = Object.assign({}, tipoJornadaPorAnio, d.tipoJornadaPorAnio);
            }
            if (d.horasExtraPorDia) {
                horasExtraPorDia = Object.assign({}, horasExtraPorDia, d.horasExtraPorDia);
            }
            if (d.horasExtraCompensadas) {
                horasExtraCompensadas = Object.assign({}, horasExtraCompensadas, d.horasExtraCompensadas);
            }
        }

        diasMarcados = {};
        objetivosAnuales = {};
        tipoJornadaPorAnio = {};
        horasExtraPorDia = {};
        horasExtraCompensadas = {};

        yearsSnap.forEach(function(yearDoc) {
            var anio = yearDoc.id;
            combinarDatosDeAnio(yearDoc.data(), anio);
        });

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
    }).catch(function(e) {
        console.error("Error Firestore:", e);
        mostrarSync(false);
        cargarFestivosOficiales('Donostia', anioActual);
        renderTodo();
    });
}
function guardarTodoEnFirebase() {
    if (!usuarioActual) return;
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

// ============================================
// 4. LÓGICA DEL CALENDARIO Y RENDER
// ============================================
function renderTodo() {
    if (!document.getElementById('calendario')) return;

    renderCalendario();
    calcularBalance();
    actualizarTablaResumen();
    actualizarTablaHorasExtra();
}


function renderCalendario() {
    var calendario = document.getElementById('calendario');
    if (!calendario) return;
    calendario.innerHTML = '';
    
    var primerDia = new Date(anioActual, mesActual, 1).getDay();
    var diasMes = new Date(anioActual, mesActual + 1, 0).getDate();
    var desplazamiento = (primerDia === 0) ? 6 : primerDia - 1;

    for (var i = 0; i < desplazamiento; i++) {
        var vacio = document.createElement('div');
        vacio.className = 'day-cell empty';
        vacio.style.visibility = 'hidden';
        calendario.appendChild(vacio);
    }

    for (var dia = 1; dia <= diasMes; dia++) {
        let d = dia;
        var fecha = new Date(anioActual, mesActual, d);
        var key = getFechaKey(fecha);
        var celda = document.createElement('div');
        celda.className = 'day-cell';
        celda.innerHTML = `<span class="day-number">${d}</span>`;
        
        if (diasMarcados[key]) celda.classList.add(diasMarcados[key].tipo);
        
        if (esFestivo(fecha)) {
            celda.innerHTML += '<span class="emoji-festivo">🎉</span>';
        }
              
        // Aquí creamos la "BURBUJITA" para las horas extra
        if (horasExtraPorDia[key]) {
            celda.innerHTML += `<span class="extra-badge">+${horasExtraPorDia[key]}h</span>`;
        }
        
        celda.onclick = function() { procesarClickDia(d); };
        calendario.appendChild(celda);
    }
    document.getElementById('mesAnio').textContent = nombresMeses[mesActual] + ' ' + anioActual;
}

function procesarClickDia(dia) {
  
    var fecha = new Date(anioActual, mesActual, dia);
    var key = getFechaKey(fecha);
    if (modoSeleccionado === 'horasExtra') { abrirModalHorasExtra(key); return; }
    
    var tipo = modoSeleccionado || 'trabajado';
    if (diasMarcados[key] && diasMarcados[key].tipo === tipo) {
        delete diasMarcados[key];
    } else {
        diasMarcados[key] = { tipo: tipo, esFestivo: esFestivo(fecha) };
    }
    renderTodo();
    guardarTodoEnFirebase();
}

window.seleccionarModo = function(tipo) {
    if (tipo === 'horasExtra' && !esPremium) {
        abrirModalPremium();
        return;
    }
    
    if (typeof trackUsoHerramienta === 'function') trackUsoHerramienta(tipo);

    modoSeleccionado = (modoSeleccionado === tipo) ? null : tipo;
    actualizarVisualBotones();
};

function actualizarVisualBotones() {
    var botones = document.querySelectorAll('.action-buttons button');
    botones.forEach(btn => {
        let t = btn.className.split(' ')[0].replace('btn-', '');
        if (t === 'horas-extra') t = 'horasExtra';
        btn.style.outline = (t === modoSeleccionado) ? '3px solid #333' : 'none';
        btn.style.transform = (t === modoSeleccionado) ? 'scale(1.05)' : 'scale(1)';
    });
}
window.limpiarCalendario = function() {
    // 1. Creamos el prefijo del mes actual, por ejemplo: "2026-01-"
    const mesFormateado = (mesActual + 1).toString().padStart(2, '0');
    const prefijoMes = anioActual + '-' + mesFormateado + '-';

    // 2. Pedimos confirmación al usuario
    if (confirm("¿Estás seguro de que quieres borrar todos los datos de " + nombresMeses[mesActual] + "?")) { 
        
        // 3. Filtramos y borramos los días marcados de este mes
        Object.keys(diasMarcados).forEach(key => {
            if (key.startsWith(prefijoMes)) {
                delete diasMarcados[key];
            }
        });

        // 4. Filtramos y borramos las horas extra de este mes
        Object.keys(horasExtraPorDia).forEach(key => {
            if (key.startsWith(prefijoMes)) {
                delete horasExtraPorDia[key];
            }
        });

        // 5. Actualizamos la pantalla y guardamos los cambios en Firebase
        renderTodo(); 
        guardarTodoEnFirebase(); 
    }
};

// ============================================
// 5. GESTIÓN DE HORAS EXTRA
// ============================================
function abrirModalHorasExtra(key) {
    fechaSeleccionadaParaExtras = key;
    var partes = key.split('-');
    document.getElementById('fecha-extra-display').textContent = partes[2] + '/' + partes[1] + '/' + partes[0];
    document.getElementById('input-horas-extra').value = horasExtraPorDia[key] || '';
    document.getElementById('modal-horas-extra').style.display = 'flex';
}
window.guardarHorasExtra = function() {
    var v = parseFloat(document.getElementById('input-horas-extra').value) || 0;
    
    // --- LÓGICA DE LÍMITE DE 80H ---
    let anioCorte = fechaSeleccionadaParaExtras.split('-')[0]; // Extrae el año (ej: 2026)
    let totalAnualCalculado = 0;

    // Sumamos todas las extras del año actual, excepto el día que estamos editando ahora
    for (let fecha in horasExtraPorDia) {
        if (fecha.startsWith(anioCorte) && fecha !== fechaSeleccionadaParaExtras) {
            totalAnualCalculado += horasExtraPorDia[fecha];
        }
    }

    // Comprobamos si el nuevo valor excede el límite
    if (totalAnualCalculado + v > 80) {
        const exceso = (totalAnualCalculado + v) - 80;
        // Solo avisamos, ya que legalmente el trabajador debe registrarlas aunque sea ilegal que la empresa se las pida
        alert("⚠️ ATENCIÓN: Con estas horas sumas un total de " + (totalAnualCalculado + v) + "h extras en el año. Has superado el límite legal de 80h por " + exceso + "h.");
    }
    // -------------------------------

    if (v <= 0) delete horasExtraPorDia[fechaSeleccionadaParaExtras];
    else horasExtraPorDia[fechaSeleccionadaParaExtras] = v;

    cerrarModalHorasExtra(); 
    renderTodo(); 
    guardarTodoEnFirebase();
};
window.cerrarModalHorasExtra = function() { document.getElementById('modal-horas-extra').style.display = 'none'; };

window.toggleCompensado = function(m) {
    var k = anioActual + '-' + m;
    horasExtraCompensadas[k] = !horasExtraCompensadas[k];
    guardarTodoEnFirebase();
};

// ============================================
// 6. CÁLCULOS Y BALANCE (REPARADO)
// ============================================
function calcularBalance() {
    const elJornada = document.getElementById('tipoJornada');
    const elHorasAnuales = document.getElementById('horasAnuales');
    const elBalanceResult = document.getElementById('balanceResult');
    const elMsg = document.getElementById('balanceMensaje');

    if (!elJornada || !elHorasAnuales || !elBalanceResult) return;

    var j = obtenerValorJornada();
    var hD = 8 * j; 
    var hTrab = 0, diasT = 0, festT = 0;
    var hObj = objetivosAnuales[anioActual] || parseInt(elHorasAnuales.value) || 0;
    var hReq = hObj * j;

    for (var f in diasMarcados) {
        if (f.startsWith(anioActual)) {
            var d = diasMarcados[f];
            if (d.tipo === 'trabajado' || d.tipo === 'baja') {
                hTrab += hD; diasT++;
                if (d.esFestivo) { festT++; hReq -= (4 * j); }
            }
        }
    }

    var bal = Math.round(hTrab - hReq);
    var balDias = Math.round(bal / hD);

    // --- ACTIVACIÓN DE DATOS DEL DESPLEGABLE RESUMEN ---
    if(document.getElementById('diasTrabajados')) document.getElementById('diasTrabajados').textContent = diasT;
    if(document.getElementById('festivosTrabajados')) document.getElementById('festivosTrabajados').textContent = festT;
    if(document.getElementById('horasTrabajadas')) document.getElementById('horasTrabajadas').textContent = Math.round(hTrab) + 'h';
    if(document.getElementById('horasRequeridas')) document.getElementById('horasRequeridas').textContent = Math.round(hReq) + 'h';
    
    // Balance Final
    document.getElementById('balanceHoras').textContent = (bal >= 0 ? '+' : '') + bal ;
    document.getElementById('balanceDias').textContent = (bal >= 0 ? '+' : '') + balDias;
    
    if (elMsg) {
        if (bal > 0) elMsg.textContent = "¡Horas de más!";
        else if (bal < 0) elMsg.textContent = "Debes recuperar";
        else elMsg.textContent = "Balance al día";
    }

    elBalanceResult.className = 'balance-grid ' + (bal >= 0 ? 'positive' : 'negative');
}


// 2. Bloqueo de apertura para secciones Premium
window.toggleCard = function(headerElement) {
    const card = headerElement.parentElement;
    
    // Si la tarjeta es premium y el usuario no lo es, NO se abre
    if (card.classList.contains('premium-locked') && !esPremium) {
        abrirModalPremium(); // Lanza tu aviso de "Hazte Premium"
        return; 
    }

    card.classList.toggle('active');
    
    if (card.id) {
        const isOpen = card.classList.contains('active');
        localStorage.setItem('card_state_' + card.id, isOpen ? 'true' : 'false');
    }
    
    if (card.classList.contains('active')) {
        renderTodo(); 
    }
};

// 3. Orden correcto de la Tabla Histórica
function actualizarTablaResumen() {
    var cuerpo = document.getElementById('cuerpoTablaResumen');
    if (!cuerpo) return;
    cuerpo.innerHTML = '';
    
    var lista = [...new Set(Object.keys(diasMarcados).map(f => f.split('-')[0]))];
    lista.sort((a, b) => b - a);
    
    lista.forEach(anio => {
        var hT = 0, fT = 0;
        var jA = tipoJornadaPorAnio[anio] || 1;
        for (var f in diasMarcados) {
            if (f.startsWith(anio) && (diasMarcados[f].tipo === 'trabajado' || diasMarcados[f].tipo === 'baja')) {
                hT += (8 * jA); 
                if (diasMarcados[f].esFestivo) fT++;
            }
        }
        var oB = objetivosAnuales[anio] || 0;
        var hReqT = (oB * jA) - (fT * 4 * jA);
        var b = hT - hReqT;
        
        var fila = document.createElement('tr');
        // ORDEN: Año, H.Teóricas, Fest.Trabajados, H.Requeridas, H.Trabajadas, Balance
        fila.innerHTML = `
            <td><strong>${anio}</strong></td>
            <td>${oB}h</td>
            <td>${fT}</td>
            <td>${Math.round(hReqT)}h</td>
            <td>${Math.round(hT)}h</td>
            <td style="color:${b >= 0 ? '#4caf50' : '#f44336'}; font-weight:bold;">${b >= 0 ? '+' : ''}${Math.round(b)}h</td>
        `;
        cuerpo.appendChild(fila);
    });
}

function actualizarTablaHorasExtra() {
    var cuerpo = document.getElementById('cuerpoTablaHorasExtra');
    if (!cuerpo) return;
    cuerpo.innerHTML = '';
    
    var sumaAnual = 0; // Declaramos el contador
    var hM = {};

    // 1. Agrupamos por mes y calculamos la suma de todo el año
    for (var k in horasExtraPorDia) {
        if (k.startsWith(anioActual)) {
            let m = parseInt(k.split('-')[1]);
            hM[m] = (hM[m] || 0) + horasExtraPorDia[k];
            sumaAnual += horasExtraPorDia[k]; // Vamos sumando al total anual
        }
    }

    // 2. Dibujamos las filas de la tabla
    for (var i = 1; i <= 12; i++) {
        if (hM[i]) {
            var chk = horasExtraCompensadas[anioActual + '-' + i] ? 'checked' : '';
            cuerpo.innerHTML += `<tr><td><strong>${nombresMeses[i-1]}</strong></td><td style="color:#ff9800;font-weight:bold;">${hM[i]}h</td><td><input type="checkbox" onchange="toggleCompensado(${i})" ${chk}></td></tr>`;
        }
    }

    // 3. LÓGICA DE ALERTA 80H (Añadido aquí)
    const alertaElemento = document.getElementById('alerta-80h');
    const valorTotalElemento = document.getElementById('valor-total-anual');

    if (valorTotalElemento) {
        valorTotalElemento.innerText = sumaAnual + "h";
    }

    if (sumaAnual > 80) {
        if (alertaElemento) alertaElemento.style.display = 'block';
        if (valorTotalElemento) valorTotalElemento.style.color = '#ef4444'; // Rojo aviso
    } else {
        if (alertaElemento) alertaElemento.style.display = 'none';
        if (valorTotalElemento) valorTotalElemento.style.color = ''; // Color por defecto
    }
}

// ============================================
// 7. UTILIDADES Y EVENTOS (CORREGIDO)
// ============================================
function getFechaKey(f) { 
    return f.getFullYear() + '-' + (f.getMonth() + 1).toString().padStart(2, '0') + '-' + f.getDate().toString().padStart(2, '0'); 
}

window.cambiarMes = function(dir) {
    mesActual += dir;
    if (mesActual > 11) { mesActual = 0; anioActual++; } 
    else if (mesActual < 0) { mesActual = 11; anioActual--; }
    
    const anioInput = document.getElementById('inputAnio');
    if(anioInput) anioInput.value = anioActual;
    
    cargarFestivosOficiales(ciudadActual, anioActual);
};

window.ajustarValor = function(id, cambio) {
    var input = document.getElementById(id);
    if (!input) return;
    input.value = (parseInt(input.value) || 0) + cambio;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

document.addEventListener('DOMContentLoaded', function() {
    // 2. Configuración de Listeners con comprobación de existencia
    const setupListener = (id, event, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    };

    setupListener('ciudadUsuario', 'change', function() {
        ciudadActual = this.value;
        cargarFestivosOficiales(ciudadActual, anioActual);
        guardarTodoEnFirebase();
    });

    setupListener('inputAnio', 'input', function() {
        anioActual = parseInt(this.value) || new Date().getFullYear();
        cargarFestivosOficiales(ciudadActual, anioActual);
    });

    setupListener('horasAnuales', 'input', function() { 
        objetivosAnuales[anioActual] = parseInt(this.value) || 0; 
        renderTodo(); 
        guardarTodoEnFirebase(); 
    });

    setupListener('tipoJornada', 'change', function() { 
        tipoJornadaPorAnio[anioActual] = parseFloat(this.value); 
        renderTodo(); 
        guardarTodoEnFirebase(); 
    });

    setupListener('sectorUsuario', 'change', function() {
        sectorUsuario = this.value;
        renderTodo();
        guardarTodoEnFirebase(); 
    });

    // 3. Render inicial
    cargarFestivosOficiales(ciudadActual, anioActual);
    gestionarJornadaPersonalizada();
    renderTodo();
    if (typeof lucide !== 'undefined') lucide.createIcons();
});



// ============================================
// 8. PREMIUM Y LOGS DE SEGUIMIENTO
// ============================================

window.abrirModalPremium = function() {
    if (typeof window.esContextoPlayTwa === 'function' && window.esContextoPlayTwa()) {
        alert("La contratación y gestión de Premium no están disponibles en esta versión de Android. Si ya tienes Premium, puedes seguir utilizando sus funciones.");
        return;
    }

    const modal = document.getElementById('modal-pricing');
    if (modal) {
        modal.style.display = 'flex'; // ACTIVA EL FLOTANTE CENTRADO
    }
};

window.cerrarModalPricing = function() {
    const modal = document.getElementById('modal-pricing');
    if (modal) modal.style.display = 'none';
};

// Verifica el nivel en Firestore y actualiza la UI
function verificarNivelPremium(uid) {
    db.collection('usuarios').doc(uid).get().then(function(doc) {
        // Si el doc existe y el tipo de cuenta es premium, activamos
        esPremium = (doc.exists && doc.data().tipoCuenta === 'premium');
        window.esPremium = esPremium;
        localStorage.setItem('esPremium', esPremium.toString());
        actualizarInterfazPremium(esPremium);
    }).catch(e => {
        console.error("Error verificando premium:", e);
        actualizarInterfazPremium(false);
    });
}

function actualizarInterfazPremium(activar) {
    const sE = document.getElementById('seccion-horas-extra');
    const sH = document.getElementById('seccion-historial');
    const sP = document.getElementById('seccion-pdf'); 
    const btnP = document.getElementById('btnPDF');
    const emailContenedor = document.querySelector('.user-profile-info');
    const btnUpgrade = document.getElementById('btn-upgrade');
    const linkCancel = document.getElementById('link-cancelar-sub'); 
    // 1. Limpiamos cualquier rastro previo para evitar duplicados
    const oldBadge = document.querySelector('.pro-badge-email');
    if (oldBadge) oldBadge.remove();

    if (activar) {
        // ACTIVAMOS el estado Premium en el body para que el CSS oculte las etiquetas
        document.body.classList.add('is-premium');
        if (btnUpgrade) btnUpgrade.style.display = 'none'; // Ocultamos botón de compra
        if (linkCancel) linkCancel.style.display = 'inline'; // Mostramos link de cancelación

        if(sE) sE.classList.remove('premium-locked');
        if(sH) sH.classList.remove('premium-locked');
        if(sP) sP.classList.remove('premium-locked'); 

        // 2. CREAMOS la etiqueta dorada PREMIUM junto al email
        if (emailContenedor && !document.querySelector('.pro-badge-email')) {
            const badge = document.createElement('span');
            badge.className = 'pro-badge-email'; 
            badge.innerText = 'PREMIUM'; 
            emailContenedor.appendChild(badge);
        }

        if(btnP) { 
            btnP.classList.remove('bloqueado'); 
            btnP.innerText = "📄 Exportar Informe Mensual (PDF)"; 
        }
    } else {
        // DESACTIVAMOS el estado Premium y quitamos la clase del body
        document.body.classList.remove('is-premium');
        if (btnUpgrade) btnUpgrade.style.display = 'block'; // Mostramos botón de compra
        if (linkCancel) linkCancel.style.display = 'none'; // NUEVO: Ocultamos enlace de baja

        if(sE) sE.classList.add('premium-locked');
        if(sH) sH.classList.add('premium-locked');
        if(sP) sP.classList.add('premium-locked');
        if(btnP) { 
            btnP.classList.add('bloqueado'); 
            btnP.innerText = "📄 Exportar Informe Mensual (Premium 🔒)"; 
        }
    }
    // Añade esto para mayor seguridad:
    const info80 = document.getElementById('info-limite-80');
    if (info80) info80.style.display = esPremium ? 'inline' : 'none';
}
function cargarFestivosOficiales(ciudad, anio) {
    if(!db) return;
    const ruta = `festivos_oficiales/${ciudad}/años/${anio}`;
    console.log("🔍 Solicitando festivos a:", ruta);

    db.collection('festivos_oficiales').doc(ciudad).collection('años').doc(anio.toString()).get()
      .then(doc => {
          if (doc.exists) {
              festivosCargados = doc.data().fechas || [];
              console.log(`✅ EXITO: ${festivosCargados.length} festivos cargados para ${ciudad}`);
          } else {
              console.warn(`❌ No existe el documento en: ${ruta}`);
              festivosCargados = [];
          }
          renderTodo();
      }).catch(e => {
          console.error("Error festivos:", e);
          renderTodo();
      });
}

function esFestivo(f) { 
    var k = getFechaKey(f); 
    
    // --- FESTIVOS POR SECTOR ---
    if (ciudadActual === 'Donostia') {
    
    // Transporte: San Cristóbal (10 de Julio)
    if (sectorUsuario === 'transporte' && k.endsWith('-07-10')) return true;
    
    // Alojamientos, Hostelería y Restauración o Limpieza de Edificios y Locales: Santa Marta (29 de Julio)
    if ((sectorUsuario === 'alojamientos' || sectorUsuario === 'hosteleria' || sectorUsuario === 'limpieza') && k.endsWith('-07-29')) return true;
    }

    // --- FESTIVOS OFICIALES (BASE DE DATOS) ---
    if (festivosCargados.includes(k)) return true;
    
    return false;
}

document.addEventListener('touchstart', function(event) {
    const tooltip = document.querySelector('.info-tooltip');
    // Si el toque NO es en la "i", forzamos el cierre quitando el foco
    if (tooltip && !tooltip.contains(event.target)) {
        tooltip.blur(); 
    }
}, {passive: true});

window.seleccionarPlan = function(tipo) {
    if (typeof window.esContextoPlayTwa === 'function' && window.esContextoPlayTwa()) {
        if (typeof cerrarModalPricing === 'function') cerrarModalPricing();
        alert("La contratación y gestión de Premium no están disponibles en esta versión de Android. Si ya tienes Premium, puedes seguir utilizando sus funciones.");
        return;
    }

    // 1. Verificamos si hay usuario (lo que ya tenías)
    if (!usuarioActual) {
        alert("Debes iniciar sesión primero para elegir un plan.");
        if (typeof cerrarModalPricing === 'function') cerrarModalPricing();
        if (typeof mostrarLogin === 'function') mostrarLogin();
        return;
    }

    // 2. Definimos enlaces de Stripe 
    const links = {
        mensual: "https://buy.stripe.com/9B6dR9fyC4Vb8hY1lngbm01", 
        anual: "https://buy.stripe.com/00w9AT9aecnDeGm7JLgbm00"
    };

    const urlBase = links[tipo];

    if (!urlBase) {
        console.error("Tipo de plan no reconocido:", tipo);
        return;
    }

    // 3. Redirección inteligente: le pasamos el email para que no tenga que escribirlo en Stripe
    const urlFinal = `${urlBase}?prefilled_email=${encodeURIComponent(usuarioActual.email)}&client_reference_id=${usuarioActual.uid}`;

    console.log("Redirigiendo a Stripe:", urlFinal);
    window.location.href = urlFinal;
};
// Función para mostrar/ocultar el cuadro de texto
window.gestionarJornadaPersonalizada = function() {
    const selector = document.getElementById('tipoJornada');
    const inputCustom = document.getElementById('inputJornadaCustom');
    
    if (selector.value === 'custom') {
        inputCustom.style.display = 'block'; // Lo muestra
    } else {
        inputCustom.style.display = 'none';  // Lo oculta
        renderTodo(); 
        guardarTodoEnFirebase();
    }
};

// Función para leer el valor (ya sea del select o del input)
function obtenerValorJornada() {
    const selector = document.getElementById('tipoJornada');
    const inputCustom = document.getElementById('inputJornadaCustom');
    
    if (selector && selector.value === 'custom') {
        // Si el usuario escribió algo, usamos eso. Si no, 1 por defecto.
        return parseFloat(inputCustom.value) || 1; 
    }
    return parseFloat(selector.value) || 1;
}

// Funciones para ampliar el logo
window.mostrarLogoGrande = function() {
    document.getElementById('logo-overlay').style.display = 'flex';
};

window.cerrarLogoGrande = function() {
    document.getElementById('logo-overlay').style.display = 'none';
};
window.mostrarLegal = function(tipo) {
    const titulo = document.getElementById('legal-title');
    const cuerpo = document.getElementById('legal-body');
    
    const textos = {
        privacidad: `
            <h4>1. Responsable del Tratamiento</h4>
            <p>Balance Laboral informa que los datos personales facilitados (email y registros de jornada) son tratados para la prestación del servicio solicitado.</p>
            <h4>2. Finalidad y Almacenamiento</h4>
            <p>Sus datos se almacenan de forma segura en la infraestructura de Google Firebase con el fin exclusivo de sincronizar su cuenta entre dispositivos.</p>
            <h4>3. Derechos del Usuario</h4>
            <p>Puede ejercer sus derechos de acceso, rectificación o supresión de datos a través de nuestro email de soporte.</p>
        `,
        terminos: `
            <h4>1. Naturaleza del Servicio</h4>
            <p>Balance Laboral es una herramienta de registro de jornada basada en los datos introducidos por el usuario. El usuario es responsable de la veracidad de dicha información.</p>
            <h4>2. Suscripciones y Pagos</h4>
            <p>Los pagos se procesan de forma segura a través de Stripe. Al ser un servicio de contenido digital de acceso inmediato, no se admiten reembolsos una vez activado el acceso Premium.</p>
            <h4>3. Limitación de Responsabilidad</h4>
            <p>Esta aplicación es una ayuda al cálculo laboral y no sustituye el asesoramiento legal profesional.</p>
        `,
        cookies: `
            <h4>1. ¿Qué cookies utilizamos?</h4>
            <p>Utilizamos únicamente cookies técnicas y de personalización esenciales para el funcionamiento del servicio:</p>
            <p>• <b>Sesión:</b> Para mantener su acceso iniciado a través de Firebase Auth.</p>
            <p>• <b>Pagos:</b> Cookies de Stripe necesarias para prevenir el fraude y procesar transacciones seguras.</p>
            <p>• <b>Preferencias:</b> Almacenamiento local de su configuración básica de jornada.</p>
            <p>No utilizamos cookies de terceros con fines publicitarios o de rastreo.</p>
        `
    };
    
    titulo.innerText = tipo === 'privacidad' ? 'POLÍTICA DE PRIVACIDAD' : (tipo === 'terminos' ? 'TÉRMINOS DE USO' : 'POLÍTICA DE COOKIES');
    cuerpo.innerHTML = textos[tipo]; // Usamos innerHTML para renderizar los <h4> y negritas
    document.getElementById('modal-legal').style.display = 'flex';
};

window.cerrarLegal = function() {
    document.getElementById('modal-legal').style.display = 'none';
};

// Función para gestionar la suscripción a través de Stripe
window.redirigirPortalStripe = function() {
    if (typeof window.esContextoPlayTwa === 'function' && window.esContextoPlayTwa()) {
        alert("La contratación y gestión de Premium no están disponibles en esta versión de Android. Si ya tienes Premium, puedes seguir utilizando sus funciones.");
        return;
    }

    if (!usuarioActual) return;

    // Aquí pondrás tu URL de "Customer Portal" de Stripe configurada en tu Dashboard
    const portalUrl = "https://billing.stripe.com/p/login/00w9AT9aecnDeGm7JLgbm00"; 

    // Redirección con el email pre-rellenado para comodidad del usuario
    window.location.href = `${portalUrl}?prefilled_email=${encodeURIComponent(usuarioActual.email)}`;
};

function eliminarCuentaTotalmente() {
    const user = auth.currentUser;
    if (!user) return alert("Inicia sesión para eliminar tu cuenta.");
    if (!confirm("Vas a eliminar tu cuenta y los datos guardados. Si tienes una suscripción Premium activa, se cancelará inmediatamente. ¿Quieres continuar?")) return;

    user.getIdToken(true)
        .then((idToken) => fetch("/deleteAccount", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`
            },
            body: "{}"
        }))
        .then((response) => response.json().then((data) => ({ response, data })))
        .then(({ response, data }) => {
            if (!response.ok || !data.deleted) throw new Error(data.error || "No se pudo eliminar la cuenta.");
            localStorage.removeItem("esPremium");
            return auth.signOut().catch(() => {});
        })
        .then(() => {
            alert("La cuenta y los datos de la aplicación se han eliminado correctamente.");
            window.location.assign("/");
        })
        .catch((error) => alert(error.message || "No se pudo eliminar la cuenta. Inténtalo de nuevo o contacta con soporte."));
}



// ============================================
// 8.1 EXPORTAR INFORME PDF para legalidad
// ============================================
window.exportarMisDatos = function() {
    if (!usuarioActual) return alert("Inicia sesión para exportar tus datos.");

    const datos = {
        usuario: usuarioActual.email,
        exportado: new Date().toISOString(),
        registros: diasMarcados,
        horasExtra: horasExtraPorDia,
        configuracion: {
            ciudad: ciudadActual,
            sector: sectorUsuario,
            objetivos: objetivosAnuales
        }
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(datos, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "mis_datos_laborales.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
};

window.toggleDarkMode = function() {
    const body = document.body;
    body.classList.toggle('dark-mode');
    
    const isDark = body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark);
    
    // Cambiar el icono dinámicamente
    const icon = document.getElementById('dark-mode-icon');
    if (icon) {
        icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
        lucide.createIcons(); // Re-renderizar iconos de Lucide
    }
};

// Al cargar la página, comprobar si estaba en modo oscuro
(function() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        // Esperar un momento a que Lucide cargue para cambiar el icono
        setTimeout(() => {
            const icon = document.getElementById('dark-mode-icon');
            if(icon) {
                icon.setAttribute('data-lucide', 'sun');
                lucide.createIcons();
            }
        }, 100);
    }
})();
// ============================================
// 9. PDF (SOLO PRO)
// ============================================
async function generarInformePDF() {
    if (!esPremium || !usuarioActual) return;
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const colorApp = [36, 52, 77]; // Color corporativo azul oscuro

    // 1. Obtener el porcentaje de jornada real (Evita errores con "Otro")
    const selectorJ = document.getElementById('tipoJornada');
    const inputC = document.getElementById('inputJornadaCustom');
    const j = (selectorJ.value === 'custom') ? (parseFloat(inputC.value) || 1) : (parseFloat(selectorJ.value) || 1);
    
    const idUsuario = usuarioActual.displayName || usuarioActual.email;
    const nombreMes = (typeof nombresMeses !== 'undefined') ? nombresMeses[mesActual] : "Mes";

    // --- PÁGINA 1: REGISTRO DIARIO ---
    // Encabezado Azul
    doc.setFillColor(colorApp[0], colorApp[1], colorApp[2]);
    doc.rect(0, 0, 210, 40, 'F');
    
    // 2. LOGO EN EL PDF (Versión segura para que no desaparezca la tabla)
    try {
        const logoImg = "assets/images/logo.png";
        // Insertamos el logo (asegúrate de que el logo sea circular o con fondo transparente)
        doc.addImage(logoImg, 'PNG', 170, 8, 24, 24); 
    } catch (e) {
        console.warn("No se pudo cargar el logo:", e);
    }

    doc.setFontSize(18); doc.setTextColor(255);
    doc.text(`BALANCE LABORAL - REGISTRO DE JORNADA`, 20, 15);
    
    doc.setFontSize(10);
    doc.text(`TRABAJADOR: ${idUsuario.toUpperCase()}`, 20, 25);
    doc.text(`PERIODO: ${nombreMes.toUpperCase()} ${anioActual}`, 20, 32);

    // 3. Generar filas de la tabla
    const filas = [];
    let totalHorasMes = 0;
    let totalExtrasMes = 0;
    let festivosTrabajadosMes = 0;
    const diasMes = new Date(anioActual, mesActual + 1, 0).getDate();
    
    for (let d = 1; d <= diasMes; d++) {
        const f = new Date(anioActual, mesActual, d);
        const k = getFechaKey(f);
        const r = diasMarcados[k];
        const e = (horasExtraPorDia && horasExtraPorDia[k]) ? horasExtraPorDia[k] : 0;
        
        totalExtrasMes += e;
        if (r && (r.tipo === 'trabajado' || r.tipo === 'baja')) {
            totalHorasMes += (8 * j);
            if (esFestivo(f)) festivosTrabajadosMes++;
        }
        filas.push([`${d}/${mesActual+1}`, r ? r.tipo.toUpperCase() : "NO REGISTRADO", e > 0 ? e+"h" : "-"]);
    }

    // 4. Dibujar la tabla
    doc.autoTable({ 
            startY: 45, 
        head: [['FECHA', 'ESTADO DE JORNADA', 'HORAS EXTRA']], 
        body: filas, 
        headStyles: { fillColor: colorApp },
        theme: 'striped',
        styles: { fontSize: 9 },
         didDrawPage: function (data) {
        // Al final de la tabla, añadimos un resumen del total anual
        let totalExtrasInforme = 0;
        filas.forEach(f => {
            let h = parseFloat(f[2]);
            if(!isNaN(h)) totalExtrasInforme += h;
        });

        let finalY = data.cursor.y + 10;
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        
        // Si supera 80, lo ponemos en rojo en el PDF
        if (totalExtrasInforme > 80) {
            doc.setTextColor(200, 0, 0); // Rojo
            doc.text(`TOTAL HORAS EXTRA ANUAL: ${totalExtrasInforme}h (EXCEDE LÍMITE LEGAL 80h)`, 14, finalY);
        } else {
            doc.setTextColor(0, 0, 0);
            doc.text(`TOTAL HORAS EXTRA ANUAL: ${totalExtrasInforme}h / 80h`, 14, finalY);
        }
    }
});

    // --- PÁGINA 2: RESUMEN Y SELLO DIGITAL ---
    doc.addPage();
    doc.setFillColor(colorApp[0], colorApp[1], colorApp[2]);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255);
    doc.setFontSize(16);
    doc.text("RESUMEN MENSUAL Y VALIDACIÓN", 20, 20);
    
    doc.setTextColor(40); doc.setFontSize(12);
    let yPos = 50;
    doc.setFont(undefined, 'bold');
    doc.text("Estadísticas del Periodo:", 20, yPos);
    doc.setFont(undefined, 'normal');
    yPos += 12;
    doc.text(`• Total Horas Ordinarias: ${Math.round(totalHorasMes)}h`, 25, yPos);
    yPos += 8;
    doc.text(`• Total Horas Extraordinarias: ${totalExtrasMes}h`, 25, yPos);
    yPos += 8;
    doc.text(`• Días Festivos Trabajados: ${festivosTrabajadosMes}`, 25, yPos);
    
    // Sello Digital
    yPos += 30;
    doc.setDrawColor(200);
    doc.rect(15, yPos, 180, 45); 
    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text("CERTIFICACIÓN DIGITAL DE AUTENTICIDAD", 20, yPos + 10);
    doc.setFont(undefined, 'normal'); doc.setFontSize(8);
    const hashS = btoa(usuarioActual.uid + anioActual + mesActual).substring(0, 24).toUpperCase();
    doc.text(`ID de Verificación Cloud: RLC-${hashS}-${anioActual}`, 20, yPos + 20);
    doc.text(`Fecha de Certificación: ${new Date().toLocaleString()}`, 20, yPos + 25);
    
    // Firmas
    yPos += 80;
    doc.setFontSize(10);
    doc.text("Firma del Trabajador:", 20, yPos);
    doc.text("Sello y Firma de la Empresa:", 120, yPos);
    doc.line(20, yPos + 20, 80, yPos + 20); 
    doc.line(120, yPos + 20, 180, yPos + 20); 

    doc.save(`Registro_Oficial_${nombreMes}_${idUsuario.split('@')[0]}.pdf`);
}

