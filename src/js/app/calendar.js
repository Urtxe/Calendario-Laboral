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
        if (esFestivo(fecha)) celda.innerHTML += '<span class="emoji-festivo">🎉</span>';
        if (horasExtraPorDia[key]) celda.innerHTML += `<span class="extra-badge">+${horasExtraPorDia[key]}h</span>`;

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
    const mesFormateado = (mesActual + 1).toString().padStart(2, '0');
    const prefijoMes = anioActual + '-' + mesFormateado + '-';

    if (confirm("¿Estás seguro de que quieres borrar todos los datos de " + nombresMeses[mesActual] + "?")) {
        Object.keys(diasMarcados).forEach(key => {
            if (key.startsWith(prefijoMes)) delete diasMarcados[key];
        });
        Object.keys(horasExtraPorDia).forEach(key => {
            if (key.startsWith(prefijoMes)) delete horasExtraPorDia[key];
        });
        renderTodo();
        guardarTodoEnFirebase();
    }
};

function abrirModalHorasExtra(key) {
    fechaSeleccionadaParaExtras = key;
    var partes = key.split('-');
    document.getElementById('fecha-extra-display').textContent = partes[2] + '/' + partes[1] + '/' + partes[0];
    document.getElementById('input-horas-extra').value = horasExtraPorDia[key] || '';
    document.getElementById('modal-horas-extra').style.display = 'flex';
}

window.guardarHorasExtra = function() {
    var v = parseFloat(document.getElementById('input-horas-extra').value) || 0;
    let anioCorte = fechaSeleccionadaParaExtras.split('-')[0];
    let totalAnualCalculado = 0;

    for (let fecha in horasExtraPorDia) {
        if (fecha.startsWith(anioCorte) && fecha !== fechaSeleccionadaParaExtras) {
            totalAnualCalculado += horasExtraPorDia[fecha];
        }
    }

    if (totalAnualCalculado + v > 80) {
        const exceso = (totalAnualCalculado + v) - 80;
        alert("⚠️ ATENCIÓN: Con estas horas sumas un total de " + (totalAnualCalculado + v) + "h extras en el año. Has superado el límite legal de 80h por " + exceso + "h.");
    }

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

    if (document.getElementById('diasTrabajados')) document.getElementById('diasTrabajados').textContent = diasT;
    if (document.getElementById('festivosTrabajados')) document.getElementById('festivosTrabajados').textContent = festT;
    if (document.getElementById('horasTrabajadas')) document.getElementById('horasTrabajadas').textContent = Math.round(hTrab) + 'h';
    if (document.getElementById('horasRequeridas')) document.getElementById('horasRequeridas').textContent = Math.round(hReq) + 'h';

    document.getElementById('balanceHoras').textContent = (bal >= 0 ? '+' : '') + bal;
    document.getElementById('balanceDias').textContent = (bal >= 0 ? '+' : '') + balDias;

    if (elMsg) {
        if (bal > 0) elMsg.textContent = "¡Horas de más!";
        else if (bal < 0) elMsg.textContent = "Debes recuperar";
        else elMsg.textContent = "Balance al día";
    }

    elBalanceResult.className = 'balance-grid ' + (bal >= 0 ? 'positive' : 'negative');
}

window.toggleCard = function(headerElement) {
    const card = headerElement.parentElement;

    if (card.classList.contains('premium-locked') && !esPremium) {
        abrirModalPremium();
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

    var sumaAnual = 0;
    var hM = {};

    for (var k in horasExtraPorDia) {
        if (k.startsWith(anioActual)) {
            let m = parseInt(k.split('-')[1]);
            hM[m] = (hM[m] || 0) + horasExtraPorDia[k];
            sumaAnual += horasExtraPorDia[k];
        }
    }

    for (var i = 1; i <= 12; i++) {
        if (hM[i]) {
            var chk = horasExtraCompensadas[anioActual + '-' + i] ? 'checked' : '';
            cuerpo.innerHTML += `<tr><td><strong>${nombresMeses[i-1]}</strong></td><td style="color:#ff9800;font-weight:bold;">${hM[i]}h</td><td><input type="checkbox" onchange="toggleCompensado(${i})" ${chk}></td></tr>`;
        }
    }

    const alertaElemento = document.getElementById('alerta-80h');
    const valorTotalElemento = document.getElementById('valor-total-anual');

    if (valorTotalElemento) {
        valorTotalElemento.innerText = sumaAnual + "h";
    }

    if (sumaAnual > 80) {
        if (alertaElemento) alertaElemento.style.display = 'block';
        if (valorTotalElemento) valorTotalElemento.style.color = '#ef4444';
    } else {
        if (alertaElemento) alertaElemento.style.display = 'none';
        if (valorTotalElemento) valorTotalElemento.style.color = '';
    }
}

function getFechaKey(f) {
    return f.getFullYear() + '-' + (f.getMonth() + 1).toString().padStart(2, '0') + '-' + f.getDate().toString().padStart(2, '0');
}

window.cambiarMes = function(dir) {
    mesActual += dir;
    if (mesActual > 11) { mesActual = 0; anioActual++; }
    else if (mesActual < 0) { mesActual = 11; anioActual--; }

    const anioInput = document.getElementById('inputAnio');
    if (anioInput) anioInput.value = anioActual;

    cargarFestivosOficiales(ciudadActual, anioActual);
};

window.ajustarValor = function(id, cambio) {
    var input = document.getElementById(id);
    if (!input) return;
    input.value = (parseInt(input.value) || 0) + cambio;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

function cargarFestivosOficiales(ciudad, anio) {
    if (!db) return;
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

    if (ciudadActual === 'Donostia') {
        if (sectorUsuario === 'transporte' && k.endsWith('-07-10')) return true;
        if ((sectorUsuario === 'hosteleria' || sectorUsuario === 'limpieza') && k.endsWith('-07-29')) return true;
    }

    if (festivosCargados.includes(k)) return true;
    return false;
}

window.gestionarJornadaPersonalizada = function() {
    const selector = document.getElementById('tipoJornada');
    const inputCustom = document.getElementById('inputJornadaCustom');

    if (selector.value === 'custom') {
        inputCustom.style.display = 'block';
    } else {
        inputCustom.style.display = 'none';
        renderTodo();
        guardarTodoEnFirebase();
    }
};

function obtenerValorJornada() {
    const selector = document.getElementById('tipoJornada');
    const inputCustom = document.getElementById('inputJornadaCustom');

    if (selector && selector.value === 'custom') {
        return parseFloat(inputCustom.value) || 1;
    }
    return parseFloat(selector.value) || 1;
}
