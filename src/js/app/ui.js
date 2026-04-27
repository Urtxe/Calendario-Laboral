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

    const datosUsuarioCard = document.getElementById('cargar-datos');
    if (datosUsuarioCard) {
        datosUsuarioCard.addEventListener('click', function(event) {
            if (event.target && event.target.closest && event.target.closest('.card-header')) return;
            if (typeof trackClickDatosUsuario === 'function') trackClickDatosUsuario();
        });
    }

    cargarFestivosOficiales(ciudadActual, anioActual);
    gestionarJornadaPersonalizada();
    renderTodo();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    montarAsesorLegal();
    actualizarTextoEstadoLegal();
    if (typeof window.actualizarAsesorLegalUI === 'function') window.actualizarAsesorLegalUI();

    document.addEventListener('touchstart', function(event) {
        const tooltip = document.querySelector('.info-tooltip');
        if (tooltip && !tooltip.contains(event.target)) {
            tooltip.blur();
        }
    }, { passive: true });
});

window.abrirModalPremium = function() {
    if (typeof trackAperturaPremium === 'function') trackAperturaPremium();

    if (!usuarioTieneSesion()) {
        alert('Necesitas registrarte o iniciar sesión para activar Premium.');
        if (typeof mostrarLogin === 'function') mostrarLogin();
        return;
    }

    if (usuarioPuedeUsarPremium()) {
        return;
    }

    alert('Esta función es Premium. Hazte Premium para utilizarla.');
    const modal = document.getElementById('modal-pricing');
    if (modal) modal.style.display = 'flex';
};

window.cerrarModalPricing = function() {
    const modal = document.getElementById('modal-pricing');
    if (modal) modal.style.display = 'none';
};

function verificarNivelPremium(uid) {
    db.collection('usuarios').doc(uid).get().then(function(doc) {
        const premiumActivo = (doc.exists && doc.data().tipoCuenta === 'premium');
        sincronizarEstadoPremium(premiumActivo);
        actualizarInterfazPremium(premiumActivo);
    }).catch(e => {
        console.error("Error verificando premium:", e);
        sincronizarEstadoPremium(false);
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
    if (info80) info80.style.display = activar ? 'inline' : 'none';

    actualizarTarjetaAsesorLegal(activar);

    if (typeof window.actualizarAsesorLegalUI === 'function') {
        window.actualizarAsesorLegalUI();
    }
}

function actualizarTarjetaAsesorLegal(activar) {
    const card = document.getElementById('ai-legal-card');
    if (!card) return;

    const kicker = card.querySelector('.ai-legal-kicker');
    const copy = card.querySelector('.ai-legal-copy');
    const paragraphs = copy ? copy.querySelectorAll('p') : [];
    const badge = document.getElementById('legal-ai-header-badge');
    const trigger = document.getElementById('btn-ai-legal');
    const isPremiumUser = !!activar;

    if (kicker) kicker.style.display = '';

    if (paragraphs[0]) {
        if (isPremiumUser) {
            paragraphs[0].textContent = 'Preguntale a la IA sobre jornada, vacaciones, pluses o salario.';
        } else if (usuarioTieneSesion()) {
            paragraphs[0].textContent = 'Preguntale a la IA sobre tu convenio. Tienes 3 consultas gratuitas.';
        } else {
            paragraphs[0].textContent = 'El asesor IA está visible para todos. Regístrate para empezar a consultar.';
        }
    }

    if (paragraphs[1]) {
        if (isPremiumUser) {
            paragraphs[1].textContent = 'Abre el modal y consulta sin límites.';
        } else if (usuarioTieneSesion()) {
            const restantes = getConsultasRestantes();
            paragraphs[1].textContent = restantes > 0
                ? `Te quedan ${restantes} consultas gratuitas antes de pasar a Premium.`
                : 'Has agotado las consultas gratuitas. Hazte Premium para seguir utilizándolo.';
        } else {
            paragraphs[1].textContent = 'Al clicar se abre el modal y te pedirá iniciar sesión para usar las consultas IA.';
        }
    }

    if (badge) {
        if (isPremiumUser) {
            badge.textContent = 'PREMIUM';
            badge.style.display = 'inline-flex';
        } else if (usuarioTieneSesion()) {
            const restantes = getConsultasRestantes();
            badge.textContent = restantes > 0 ? `${restantes} GRATIS` : 'HAZTE PREMIUM';
            badge.style.display = 'inline-flex';
        } else {
            badge.textContent = 'REGISTRATE';
            badge.style.display = 'inline-flex';
        }
    }

    if (trigger) {
        trigger.textContent = 'Abrir asesor';
        trigger.disabled = false;
    }
}

// ============================================
// 8.2 ASESOR LEGAL IA (RAG)
// ============================================

const LIMITE_CONSULTAS_GRATIS = 3;
const ASESOR_LEGAL_STORAGE_PREFIX = 'balance_laboral_asesor_legal_';

function getModoAsesorLegal() {
    if (window.esPremium) return 'premium';
    if (usuarioTieneSesion()) return 'free';
    return 'anonimo';
}

function getAsesorLegalStorageKey() {
    if (window.usuarioActual && window.usuarioActual.uid) {
        return ASESOR_LEGAL_STORAGE_PREFIX + window.usuarioActual.uid;
    }

    return ASESOR_LEGAL_STORAGE_PREFIX + 'anonimo';
}

function getConsultasUsadas() {
    const raw = localStorage.getItem(getAsesorLegalStorageKey());
    const value = parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function setConsultasUsadas(valor) {
    localStorage.setItem(getAsesorLegalStorageKey(), String(Math.max(0, valor)));
}

function getConsultasRestantes() {
    if (window.esPremium) return Infinity;
    return Math.max(0, LIMITE_CONSULTAS_GRATIS - getConsultasUsadas());
}

function limpiarMensajesLegales() {
    const messages = document.getElementById('legal-ai-messages');
    if (messages) messages.innerHTML = '';
}

function crearMensajeBienvenidaLegal() {
    const messages = document.getElementById('legal-ai-messages');
    if (!messages || messages.childElementCount > 0) return;

    const modo = getModoAsesorLegal();

    if (modo === 'anonimo') {
        crearMensajeLegal('Regístrate o inicia sesión para utilizar las consultas IA sobre convenios.', 'assistant');
        return;
    }

    if (modo === 'free') {
        const restantes = getConsultasRestantes();
        if (restantes > 0) {
            crearMensajeLegal(`Tienes ${restantes} consultas gratuitas disponibles. Pregúntame por jornada, vacaciones, pluses u horas extra.`, 'assistant');
        } else {
            crearMensajeLegal('Ya has agotado tus 3 consultas gratuitas. Hazte Premium para seguir consultando el convenio sin límite.', 'assistant');
        }
        return;
    }

    crearMensajeLegal('Pregúntame sobre tu convenio y te responderé comparando la norma base con el texto recuperado.', 'assistant');
}

function inyectarEstilosAsesorLegal() {
    if (document.getElementById('asesor-legal-styles')) return;

    const style = document.createElement('style');
    style.id = 'asesor-legal-styles';
    style.textContent = `
        .legal-ai-shell {
            position: fixed;
            inset: 0;
            z-index: 10000;
            display: none;
            align-items: flex-end;
            justify-content: flex-end;
            background: rgba(8, 15, 30, 0.38);
            backdrop-filter: blur(6px);
            padding: 18px;
        }
        .legal-ai-shell.is-open {
            display: flex;
        }
        .legal-ai-panel {
            width: min(420px, calc(100vw - 24px));
            height: min(78vh, 760px);
            background: #f7f5ef;
            border-radius: 22px;
            box-shadow: 0 26px 70px rgba(15, 23, 42, 0.32);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            border: 1px solid rgba(36, 52, 77, 0.08);
        }
        .legal-ai-header {
            padding: 16px 18px;
            background: linear-gradient(135deg, #24344d, #36597b);
            color: #fff;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }
        .legal-ai-title {
            margin: 0;
            font-size: 1rem;
            line-height: 1.2;
        }
        .legal-ai-subtitle {
            margin: 4px 0 0;
            font-size: 0.8rem;
            opacity: 0.82;
        }
        .legal-ai-close {
            border: 0;
            background: rgba(255, 255, 255, 0.14);
            color: #fff;
            width: 34px;
            height: 34px;
            border-radius: 999px;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
        }
        .legal-ai-status {
            padding: 10px 18px;
            font-size: 0.82rem;
            color: #4b5563;
            background: rgba(255, 255, 255, 0.72);
            border-bottom: 1px solid rgba(36, 52, 77, 0.08);
        }
        .legal-ai-intro {
            padding: 16px 18px 0;
            display: grid;
            gap: 12px;
        }
        .legal-ai-intro-card {
            border-radius: 18px;
            padding: 14px 16px;
            background: linear-gradient(135deg, rgba(36, 52, 77, 0.96), rgba(61, 123, 217, 0.92));
            color: #fff;
            box-shadow: 0 16px 34px rgba(15, 23, 42, 0.16);
        }
        .legal-ai-intro-label {
            display: inline-flex;
            align-items: center;
            padding: 5px 10px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.14);
            font-size: 0.72rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 8px;
        }
        .legal-ai-intro-card h4 {
            margin: 0;
            font-size: 1rem;
            line-height: 1.2;
        }
        .legal-ai-intro-card p {
            margin: 6px 0 0;
            font-size: 0.85rem;
            line-height: 1.45;
            color: rgba(255, 255, 255, 0.88);
        }
        .legal-ai-quick-prompts {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .legal-ai-prompt {
            border: 1px solid rgba(36, 52, 77, 0.12);
            background: #fff;
            color: #24344d;
            border-radius: 999px;
            padding: 9px 12px;
            font-size: 0.78rem;
            font-weight: 700;
            cursor: pointer;
            transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }
        .legal-ai-prompt:hover {
            transform: translateY(-1px);
            border-color: rgba(61, 123, 217, 0.3);
            box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
        }
        .legal-ai-messages {
            flex: 1;
            overflow-y: auto;
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .legal-ai-message {
            max-width: 92%;
            padding: 12px 14px;
            border-radius: 18px;
            white-space: pre-wrap;
            line-height: 1.45;
            font-size: 0.94rem;
            box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
        }
        .legal-ai-message.user {
            align-self: flex-end;
            background: #24344d;
            color: #fff;
            border-bottom-right-radius: 6px;
        }
        .legal-ai-message.assistant {
            align-self: flex-start;
            background: #fff;
            color: #1f2937;
            border-bottom-left-radius: 6px;
        }
        .legal-ai-message.error {
            background: #fee2e2;
            color: #991b1b;
        }
        .legal-ai-inputbar {
            padding: 14px;
            border-top: 1px solid rgba(36, 52, 77, 0.08);
            background: #fff;
            display: grid;
            gap: 10px;
        }
        .legal-ai-input {
            width: 100%;
            min-height: 88px;
            resize: vertical;
            border: 1px solid #d6dbe4;
            border-radius: 16px;
            padding: 12px 14px;
            font-family: inherit;
            font-size: 0.94rem;
            outline: none;
            background: #fbfbfd;
        }
        .legal-ai-input:focus {
            border-color: #3d7bd9;
            box-shadow: 0 0 0 4px rgba(61, 123, 217, 0.12);
        }
        .legal-ai-actions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .legal-ai-note {
            font-size: 0.78rem;
            color: #6b7280;
        }
        .legal-ai-send {
            border: 0;
            border-radius: 999px;
            padding: 12px 16px;
            color: #fff;
            background: linear-gradient(135deg, #3d7bd9, #2f64ba);
            font-weight: 700;
            cursor: pointer;
            min-width: 118px;
        }
        .legal-ai-send:disabled,
        .legal-ai-input:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }
        @media (max-width: 640px) {
            .legal-ai-shell {
                padding: 0;
                align-items: stretch;
                justify-content: stretch;
            }
            .legal-ai-panel {
                width: 100vw;
                height: 100vh;
                border-radius: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

function crearMensajeLegal(texto, tipo) {
    const messages = document.getElementById('legal-ai-messages');
    if (!messages) return null;

    const el = document.createElement('div');
    el.className = `legal-ai-message ${tipo}`;
    el.textContent = texto;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
}

function actualizarTextoEstadoLegal() {
    const status = document.getElementById('legal-ai-status');
    const note = document.getElementById('legal-ai-note');
    const sendBtn = document.getElementById('legal-ai-send');
    const input = document.getElementById('legal-ai-input');

    if (!status || !note || !sendBtn || !input) return;

    const modo = getModoAsesorLegal();
    const restantes = getConsultasRestantes();

    if (modo === 'premium') {
        status.style.display = 'none';
        note.style.display = 'none';
        sendBtn.disabled = false;
        input.disabled = false;
    } else if (modo === 'anonimo') {
        status.style.display = 'block';
        note.style.display = 'block';
        status.textContent = 'Regístrate para utilizar las consultas IA sobre convenios.';
        note.textContent = 'Crea una cuenta gratuita o inicia sesión para activar el asesor legal IA.';
        sendBtn.disabled = true;
        input.disabled = true;
    } else if (restantes > 0) {
        status.style.display = 'block';
        note.style.display = 'block';
        status.textContent = `Modo gratuito: te quedan ${restantes} de ${LIMITE_CONSULTAS_GRATIS} consultas.`;
        note.textContent = 'Cuando llegues a 0, tendrás que hacerte Premium para seguir consultando.';
        sendBtn.disabled = false;
        input.disabled = false;
    } else {
        status.style.display = 'block';
        note.style.display = 'block';
        status.textContent = 'Has agotado tus 3 consultas gratuitas.';
        note.textContent = 'Hazte Premium para seguir utilizando el asesor IA sin límite.';
        sendBtn.disabled = true;
        input.disabled = true;
    }
}

async function enviarConsultaLegal() {
    const input = document.getElementById('legal-ai-input');
    const sendBtn = document.getElementById('legal-ai-send');
    const pregunta = input ? input.value.trim() : '';

    if (!pregunta) {
        crearMensajeLegal('Escribe una pregunta para consultar el convenio.', 'error');
        return;
    }

    if (!usuarioTieneSesion()) {
        actualizarTextoEstadoLegal();
        crearMensajeLegal('Necesitas registrarte o iniciar sesión para utilizar las consultas IA.', 'assistant');
        return;
    }

    if (!window.esPremium && getConsultasRestantes() <= 0) {
        actualizarTextoEstadoLegal();
        crearMensajeLegal('Has agotado las 3 consultas gratuitas. Hazte Premium para seguir utilizando el asesor IA.', 'assistant');
        return;
    }

    crearMensajeLegal(pregunta, 'user');
    if (input) input.value = '';
    if (sendBtn) sendBtn.disabled = true;

    const typing = crearMensajeLegal('Consultando el convenio...', 'assistant');

    try {
        const consultarConvenioUrl = (window.APP_CONFIG && window.APP_CONFIG.consultarConvenioUrl)
            || localStorage.getItem('consultarConvenioUrl')
            || '/consultarConvenio';

        const response = await fetch(consultarConvenioUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                pregunta,
                convenioFileName: window.convenioFileName || localStorage.getItem('convenioFileName') || localStorage.getItem('file_name') || '',
            }),
        });

        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const data = isJson
            ? await response.json()
            : { error: await response.text() };

        if (!isJson) {
            throw new Error('La consulta no devolvió JSON. Revisa la URL del backend o el despliegue de la función.');
        }

        if (!response.ok) {
            throw new Error(data && data.error ? data.error : 'No se pudo consultar el convenio.');
        }

        if (typing) typing.remove();
        crearMensajeLegal(data.respuesta || 'No he podido generar una respuesta.', 'assistant');

        if (!window.esPremium) {
            setConsultasUsadas(getConsultasUsadas() + 1);
            actualizarTarjetaAsesorLegal(false);
        }
    } catch (error) {
        if (typing) typing.remove();
        const mensaje = error && error.message ? error.message : '';
        const esErrorDeConexion = /fetch|network|json|consultar el convenio|No se encontraron fragmentos/i.test(mensaje);

        if (esErrorDeConexion) {
            crearMensajeLegal('Ahora mismo el panel ya está listo para usar, pero el backend no me ha devuelto resultados aún. En cuanto ingresemos los convenios, responderé con la comparación real entre la norma base y el convenio. Mientras tanto, prueba con preguntas de jornada, vacaciones o pluses.', 'assistant');
        } else {
            crearMensajeLegal(mensaje || 'Ha ocurrido un error al consultar el convenio.', 'error');
        }
    } finally {
        actualizarTextoEstadoLegal();
        if (input && !input.disabled) input.focus();
        if (sendBtn && !sendBtn.disabled) sendBtn.disabled = false;
    }
}

function montarAsesorLegal() {
    if (document.getElementById('legal-ai-shell')) return;

    inyectarEstilosAsesorLegal();

    const shell = document.createElement('div');
    shell.id = 'legal-ai-shell';
    shell.className = 'legal-ai-shell';
    shell.innerHTML = `
        <div class="legal-ai-panel" role="dialog" aria-modal="true" aria-labelledby="legal-ai-title">
            <div class="legal-ai-header">
                <div>
                    <h3 class="legal-ai-title" id="legal-ai-title">Asesoría Legal sobre Convenios</h3>
                    <p class="legal-ai-subtitle">Comparación guiada entre Estatuto y tu convenio</p>
                </div>
                <button type="button" class="legal-ai-close" id="legal-ai-close" aria-label="Cerrar asesor legal">×</button>
            </div>
            <div class="legal-ai-status" id="legal-ai-status"></div>
            <div class="legal-ai-intro">
                <div class="legal-ai-intro-card">
                    <span class="legal-ai-intro-label">Vista de trabajo</span>
                    <h4>Pregunta directo y recibe una comparación clara</h4>
                    <p>Esta primera versión está pensada para probar el flujo real: escribes tu duda, el sistema busca contexto del convenio y te devuelve una respuesta corta, útil y sin rodeos.</p>
                </div>
                <div class="legal-ai-quick-prompts" id="legal-ai-quick-prompts">
                    <button type="button" class="legal-ai-prompt" data-legal-prompt="¿Cuántas horas semanales me corresponden según mi jornada?">Jornada</button>
                    <button type="button" class="legal-ai-prompt" data-legal-prompt="¿Qué vacaciones me corresponden y cómo se calculan?">Vacaciones</button>
                    <button type="button" class="legal-ai-prompt" data-legal-prompt="¿Tengo derecho a plus de nocturnidad o transporte?">Pluses</button>
                    <button type="button" class="legal-ai-prompt" data-legal-prompt="¿Cómo se compensan las horas extra en mi convenio?">Horas extra</button>
                </div>
            </div>
            <div class="legal-ai-messages" id="legal-ai-messages"></div>
            <div class="legal-ai-inputbar">
                <textarea id="legal-ai-input" class="legal-ai-input" placeholder="Escribe tu duda sobre el convenio colectivo..."></textarea>
                <div class="legal-ai-actions">
                    <div class="legal-ai-note" id="legal-ai-note"></div>
                    <button type="button" id="legal-ai-send" class="legal-ai-send">Preguntar</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(shell);

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    const trigger = document.getElementById('btn-ai-legal');
    const closeBtn = shell.querySelector('#legal-ai-close');
    const sendBtn = shell.querySelector('#legal-ai-send');
    const input = shell.querySelector('#legal-ai-input');
    const promptButtons = shell.querySelectorAll('[data-legal-prompt]');

    if (trigger && !trigger.dataset.bound) {
        trigger.dataset.bound = 'true';
        trigger.addEventListener('click', window.abrirAsesorLegal);
    }
    if (closeBtn) closeBtn.addEventListener('click', window.cerrarAsesorLegal);
    if (sendBtn) sendBtn.addEventListener('click', enviarConsultaLegal);
    if (input) {
        input.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                enviarConsultaLegal();
            }
        });
    }
    promptButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            if (!input) return;
            input.value = button.getAttribute('data-legal-prompt') || '';
            input.focus();
        });
    });

    window.actualizarAsesorLegalUI();
}

window.abrirAsesorLegal = function() {
    montarAsesorLegal();
    const shell = document.getElementById('legal-ai-shell');
    if (!shell) return;

    shell.classList.add('is-open');
    limpiarMensajesLegales();
    actualizarTextoEstadoLegal();
    crearMensajeBienvenidaLegal();

    if (!usuarioTieneSesion() && typeof mostrarLogin === 'function') {
        setTimeout(function() {
            mostrarLogin();
        }, 250);
    }

    const input = document.getElementById('legal-ai-input');
    if (input && !input.disabled) input.focus();
};

window.cerrarAsesorLegal = function() {
    const shell = document.getElementById('legal-ai-shell');
    if (shell) shell.classList.remove('is-open');
};

window.actualizarAsesorLegalUI = function() {
    const badge = document.getElementById('legal-ai-header-badge');
    const trigger = document.getElementById('btn-ai-legal');
    const esPremiumActivo = !!window.esPremium;
    const modo = getModoAsesorLegal();

    if (badge) {
        if (modo === 'premium') {
            badge.textContent = 'PREMIUM';
            badge.style.display = 'inline-flex';
        } else if (modo === 'free') {
            const restantes = getConsultasRestantes();
            badge.textContent = restantes > 0 ? `${restantes} GRATIS` : 'HAZTE PREMIUM';
            badge.style.display = 'inline-flex';
        } else {
            badge.textContent = 'REGISTRATE';
            badge.style.display = 'inline-flex';
        }
    }
    if (trigger) {
        trigger.disabled = false;
        trigger.textContent = 'Abrir asesor';
        trigger.style.display = 'inline-flex';
    }
    actualizarTarjetaAsesorLegal(esPremiumActivo);
    actualizarTextoEstadoLegal();
};

window.seleccionarPlan = function(tipo) {
    planSeleccionado = 'premium';

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
