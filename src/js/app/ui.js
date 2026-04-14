document.addEventListener('DOMContentLoaded', function() {
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

    cargarFestivosOficiales(ciudadActual, anioActual);
    gestionarJornadaPersonalizada();
    renderTodo();
    if (typeof lucide !== 'undefined') lucide.createIcons();

    document.addEventListener('touchstart', function(event) {
        const tooltip = document.querySelector('.info-tooltip');
        if (tooltip && !tooltip.contains(event.target)) {
            tooltip.blur();
        }
    }, { passive: true });
});

window.abrirModalPremium = function() {
    const modal = document.getElementById('modal-pricing');
    if (modal) modal.style.display = 'flex';
};

window.cerrarModalPricing = function() {
    const modal = document.getElementById('modal-pricing');
    if (modal) modal.style.display = 'none';
};

function verificarNivelPremium(uid) {
    db.collection('usuarios').doc(uid).get().then(function(doc) {
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
    const oldBadge = document.querySelector('.pro-badge-email');
    if (oldBadge) oldBadge.remove();

    if (activar) {
        document.body.classList.add('is-premium');
        if (btnUpgrade) btnUpgrade.style.display = 'none';
        if (linkCancel) linkCancel.style.display = 'inline';
        if (sE) sE.classList.remove('premium-locked');
        if (sH) sH.classList.remove('premium-locked');
        if (sP) sP.classList.remove('premium-locked');
        if (emailContenedor && !document.querySelector('.pro-badge-email')) {
            const badge = document.createElement('span');
            badge.className = 'pro-badge-email';
            badge.innerText = 'PREMIUM';
            emailContenedor.appendChild(badge);
        }
        if (btnP) {
            btnP.classList.remove('bloqueado');
            btnP.innerText = "📄 Exportar Informe Mensual (PDF)";
        }
    } else {
        document.body.classList.remove('is-premium');
        if (btnUpgrade) btnUpgrade.style.display = 'block';
        if (linkCancel) linkCancel.style.display = 'none';
        if (sE) sE.classList.add('premium-locked');
        if (sH) sH.classList.add('premium-locked');
        if (sP) sP.classList.add('premium-locked');
        if (btnP) {
            btnP.classList.add('bloqueado');
            btnP.innerText = "📄 Exportar Informe Mensual (Premium 🔒)";
        }
    }
    const info80 = document.getElementById('info-limite-80');
    if (info80) info80.style.display = esPremium ? 'inline' : 'none';
}

window.seleccionarPlan = function(tipo) {
    if (!usuarioActual) {
        alert("Debes iniciar sesión primero para elegir un plan.");
        if (typeof cerrarModalPricing === 'function') cerrarModalPricing();
        if (typeof mostrarLogin === 'function') mostrarLogin();
        return;
    }

    const links = {
        mensual: "https://buy.stripe.com/9B6dR9fyC4Vb8hY1lngbm01",
        anual: "https://buy.stripe.com/00w9AT9aecnDeGm7JLgbm00"
    };

    const urlBase = links[tipo];
    if (!urlBase) return;

    const urlFinal = `${urlBase}?prefilled_email=${encodeURIComponent(usuarioActual.email)}&client_reference_id=${usuarioActual.uid}`;
    window.location.href = urlFinal;
};

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
    cuerpo.innerHTML = textos[tipo];
    document.getElementById('modal-legal').style.display = 'flex';
};

window.cerrarLegal = function() {
    document.getElementById('modal-legal').style.display = 'none';
};

window.redirigirPortalStripe = function() {
    if (!usuarioActual) return;
    const portalUrl = "https://billing.stripe.com/p/login/00w9AT9aecnDeGm7JLgbm00";
    window.location.href = `${portalUrl}?prefilled_email=${encodeURIComponent(usuarioActual.email)}`;
};

function eliminarCuentaTotalmente() {
    const user = auth.currentUser;

    if (confirm("¿Estás seguro? Esta acción es irreversible y perderás todos tus registros.")) {
        user.delete().then(() => {
            alert("Cuenta eliminada correctamente.");
            window.location.reload();
        }).catch((error) => {
            if (error.code === 'auth/requires-recent-login') {
                alert("Por seguridad, debes haber iniciado sesión hace poco para borrar tu cuenta. Por favor, sal y vuelve a entrar.");
            }
        });
    }
}

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

    const icon = document.getElementById('dark-mode-icon');
    if (icon) {
        icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
        lucide.createIcons();
    }
};

(function() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        setTimeout(() => {
            const icon = document.getElementById('dark-mode-icon');
            if (icon) {
                icon.setAttribute('data-lucide', 'sun');
                lucide.createIcons();
            }
        }, 100);
    }
})();
