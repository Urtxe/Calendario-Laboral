function actualizarViewportVisible() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const height =
    viewport && viewport.height ? viewport.height : window.innerHeight;
  const top = viewport && viewport.offsetTop ? viewport.offsetTop : 0;

  if (height) root.style.setProperty("--app-visible-height", `${height}px`);
  root.style.setProperty(
    "--app-modal-height",
    height ? `${height}px` : "100dvh",
  );
  root.style.setProperty("--app-modal-top", `${top}px`);
}

function inicializarViewportIOS() {
  actualizarViewportVisible();

  if (!window.visualViewport) {
    window.addEventListener("resize", actualizarViewportVisible, {
      passive: true,
    });
    window.addEventListener("orientationchange", actualizarViewportVisible, {
      passive: true,
    });
    return;
  }

  window.visualViewport.addEventListener("resize", actualizarViewportVisible, {
    passive: true,
  });
  window.visualViewport.addEventListener("scroll", actualizarViewportVisible, {
    passive: true,
  });
  window.addEventListener("orientationchange", actualizarViewportVisible, {
    passive: true,
  });
}

function puedeAutoenfocarCampo() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function comercioPremiumBloqueadoEnTwa() {
  return (
    typeof window.esContextoPlayTwa === "function" &&
    window.esContextoPlayTwa()
  );
}

function mostrarAvisoComercioPremiumNoDisponible() {
  alert(
    "La contratación y gestión de Premium no están disponibles en esta versión de Android. Si ya tienes Premium, puedes seguir utilizando sus funciones.",
  );
}

function aplicarRestriccionComercioPremiumTwa() {
  if (!comercioPremiumBloqueadoEnTwa()) return;

  document.body.classList.add("is-play-twa");
  document
    .querySelectorAll(
      '[onclick*="abrirModalPremium"], [onclick*="seleccionarPlan"], [onclick*="redirigirPortalStripe"]',
    )
    .forEach((element) => {
      element.style.display = "none";
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("tabindex", "-1");
    });

  const pricingModal = document.getElementById("modal-pricing");
  if (pricingModal) {
    pricingModal.style.display = "none";
    pricingModal.setAttribute("aria-hidden", "true");
  }

  const headerCopy = document.getElementById("legal-ai-header-copy");
  if (headerCopy) {
    headerCopy.textContent =
      "Incluye consultas gratuitas y acceso completo para cuentas Premium ya activas.";
  }
}

aplicarRestriccionComercioPremiumTwa();

function legalAiDebugEnabled() {
  return Boolean(
    window.APP_CONFIG &&
      (window.APP_CONFIG.legalAiDebug === true ||
        window.APP_CONFIG.debugLegalAiAuth === true),
  );
}

function logLegalAiAuthDebug(data) {
  if (!legalAiDebugEnabled()) return;
  console.log("[LegalAI auth]", {
    hasUser: Boolean(data && data.hasUser),
    uid: data && data.uid ? data.uid : null,
    tokenLength:
      data && typeof data.tokenLength === "number" ? data.tokenLength : 0,
    hasAuthorizationHeader: Boolean(data && data.hasAuthorizationHeader),
  });
}

function esperarUsuarioAuth(timeoutMs = 3000) {
  if (typeof auth === "undefined" || !auth) {
    return Promise.resolve(null);
  }

  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = function () {};
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(auth.currentUser || null);
    }, timeoutMs);

    unsubscribe = auth.onAuthStateChanged((user) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(user || null);
    });
  });
}

function inicializarNavegacionDashboard() {
  const navItems = Array.from(document.querySelectorAll(".sidebar-nav-item"));
  const sections = Array.from(
    document.querySelectorAll("#app-container > .collapsible-card"),
  );
  const desktopQuery = window.matchMedia("(min-width: 1024px)");

  if (!navItems.length || !sections.length) return;

  const activarSeccion = (targetId, options = {}) => {
    const target = document.getElementById(targetId);
    if (!target) return;

    if (
      desktopQuery.matches &&
      target.classList.contains("premium-locked") &&
      typeof usuarioPuedeUsarPremium === "function" &&
      !usuarioPuedeUsarPremium()
    ) {
      if (typeof abrirModalPremium === "function") abrirModalPremium();
      return;
    }

    sections.forEach((section) => {
      section.classList.toggle(
        "dashboard-section-active",
        section.id === targetId,
      );
    });

    navItems.forEach((item) => {
      item.classList.toggle(
        "active",
        item.dataset.dashboardTarget === targetId,
      );
    });

    if (desktopQuery.matches) {
      target.classList.add("active");
      if (!options.skipScroll) {
        document
          .querySelector(".app-main")
          ?.scrollTo({ top: 0, behavior: "smooth" });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      if (typeof renderTodo === "function") renderTodo();
    }
  };

  navItems.forEach((item) => {
    item.addEventListener("click", function () {
      activarSeccion(this.dataset.dashboardTarget);
    });
  });

  const sincronizarModo = () => {
    if (desktopQuery.matches) {
      const activeItem = document.querySelector(".sidebar-nav-item.active");
      activarSeccion(activeItem?.dataset.dashboardTarget || "cargar-datos", {
        skipScroll: true,
      });
    } else {
      sections.forEach((section) =>
        section.classList.remove("dashboard-section-active"),
      );
    }
  };

  if (desktopQuery.addEventListener) {
    desktopQuery.addEventListener("change", sincronizarModo);
  } else {
    desktopQuery.addListener(sincronizarModo);
  }

  sincronizarModo();
}

document.addEventListener("DOMContentLoaded", function () {
  inicializarViewportIOS();

  const setupListener = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  };

  setupListener("ciudadUsuario", "change", function () {
    ciudadActual = this.value;
    cargarFestivosOficiales(ciudadActual, anioActual);
    guardarTodoEnFirebase();
  });

  setupListener("inputAnio", "input", function () {
    anioActual = parseInt(this.value) || new Date().getFullYear();
    cargarFestivosOficiales(ciudadActual, anioActual);
  });

  setupListener("horasAnuales", "input", function () {
    objetivosAnuales[anioActual] = parseInt(this.value) || 0;
    renderTodo();
    guardarTodoEnFirebase();
  });

  setupListener("tipoJornada", "change", function () {
    tipoJornadaPorAnio[anioActual] = parseFloat(this.value);
    renderTodo();
    guardarTodoEnFirebase();
  });

  setupListener("sectorUsuario", "change", function () {
    sectorUsuario = this.value;
    renderTodo();
    guardarTodoEnFirebase();
  });

  const datosUsuarioCard = document.getElementById("cargar-datos");
  if (datosUsuarioCard) {
    datosUsuarioCard.addEventListener("click", function (event) {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest(".card-header")
      )
        return;
      if (typeof trackClickDatosUsuario === "function")
        trackClickDatosUsuario();
    });
  }

  cargarFestivosOficiales(ciudadActual, anioActual);
  gestionarJornadaPersonalizada();
  renderTodo();
  inicializarNavegacionDashboard();
  if (typeof lucide !== "undefined") lucide.createIcons();
  montarAsesorLegal();
  actualizarTextoEstadoLegal();
  if (typeof window.actualizarAsesorLegalUI === "function")
    window.actualizarAsesorLegalUI();

  document.addEventListener(
    "touchstart",
    function (event) {
      const tooltip = document.querySelector(".info-tooltip");
      if (tooltip && !tooltip.contains(event.target)) {
        tooltip.blur();
      }
    },
    { passive: true },
  );
});

window.abrirModalPremium = function () {
  if (comercioPremiumBloqueadoEnTwa()) {
    mostrarAvisoComercioPremiumNoDisponible();
    return;
  }

  if (typeof trackAperturaPremium === "function") trackAperturaPremium();

  if (!usuarioTieneSesion()) {
    alert("Necesitas registrarte o iniciar sesión para activar Premium.");
    if (typeof mostrarLogin === "function") mostrarLogin();
    return;
  }

  if (usuarioPuedeUsarPremium()) {
    return;
  }

  alert("Esta función es Premium. Hazte Premium para utilizarla.");
  const modal = document.getElementById("modal-pricing");
  if (modal) modal.style.display = "flex";
};

window.cerrarModalPricing = function () {
  const modal = document.getElementById("modal-pricing");
  if (modal) modal.style.display = "none";
};

function verificarNivelPremium(uid) {
  db.collection("usuarios")
    .doc(uid)
    .get()
    .then(function (doc) {
      const premiumActivo = doc.exists && doc.data().tipoCuenta === "premium";
      sincronizarEstadoPremium(premiumActivo);
      actualizarInterfazPremium(premiumActivo);
    })
    .catch((e) => {
      console.error("Error verificando premium:", e);
      sincronizarEstadoPremium(false);
      actualizarInterfazPremium(false);
    });
}

function actualizarInterfazPremium(activar) {
  const sE = document.getElementById("seccion-horas-extra");
  const sH = document.getElementById("seccion-historial");
  const sP = document.getElementById("seccion-pdf");
  const btnP = document.getElementById("btnPDF");
  const emailContenedor = document.querySelector(".user-profile-info");
  const btnUpgrade = document.getElementById("btn-upgrade");
  const linksCancel = document.querySelectorAll(".link-cancelar-sub");
  const oldBadge = document.querySelector(".pro-badge-email");
  if (oldBadge) oldBadge.remove();

  if (activar) {
    document.body.classList.add("is-premium");
    if (btnUpgrade) btnUpgrade.style.display = "none";
    linksCancel.forEach((link) => {
      link.style.display = comercioPremiumBloqueadoEnTwa() ? "none" : "inline";
    });
    if (sE) sE.classList.remove("premium-locked");
    if (sH) sH.classList.remove("premium-locked");
    if (sP) sP.classList.remove("premium-locked");
    if (emailContenedor && !document.querySelector(".pro-badge-email")) {
      const badge = document.createElement("span");
      badge.className = "pro-badge-email";
      badge.innerText = "PREMIUM";
      emailContenedor.appendChild(badge);
    }
    if (btnP) {
      btnP.classList.remove("bloqueado");
      btnP.innerText = "📄 Exportar Informe Mensual (PDF)";
    }
  } else {
    document.body.classList.remove("is-premium");
    if (btnUpgrade) {
      btnUpgrade.style.display = comercioPremiumBloqueadoEnTwa() ? "none" : "block";
    }
    linksCancel.forEach((link) => {
      link.style.display = "none";
    });
    if (sE) sE.classList.add("premium-locked");
    if (sH) sH.classList.add("premium-locked");
    if (sP) sP.classList.add("premium-locked");
    if (btnP) {
      btnP.classList.add("bloqueado");
      btnP.innerText = "📄 Exportar Informe Mensual (Premium 🔒)";
    }
  }
  const info80 = document.getElementById("info-limite-80");
  if (info80) info80.style.display = activar ? "inline" : "none";

  actualizarTarjetaAsesorLegal(activar);

  if (typeof window.actualizarAsesorLegalUI === "function") {
    window.actualizarAsesorLegalUI();
  }

  aplicarRestriccionComercioPremiumTwa();
}

function actualizarTarjetaAsesorLegal(activar) {
  const card = document.getElementById("ai-legal-card");
  if (!card) return;

  const kicker = card.querySelector(".ai-legal-kicker");
  const copy = card.querySelector(".ai-legal-copy");
  const paragraphs = copy ? copy.querySelectorAll("p") : [];
  const badge = document.getElementById("legal-ai-header-badge");
  const trigger = document.getElementById("btn-ai-legal");
  const isPremiumUser = !!activar;

  if (kicker) kicker.style.display = "";

  if (paragraphs[0]) {
    if (isPremiumUser) {
      paragraphs[0].textContent =
        "Preguntale a la IA sobre jornada, vacaciones, pluses o salario.";
    } else if (usuarioTieneSesion()) {
      paragraphs[0].textContent = "Tienes 50 consultas gratuitas al día.";
    } else {
      paragraphs[0].textContent = "Preguntale a la IA sobre tu convenio.";
    }
    paragraphs[0].style.display = "";
  }

  if (paragraphs[1]) {
    if (isPremiumUser) {
      paragraphs[1].textContent = "Hasta 200 consultas IA al día.";
      paragraphs[1].style.display = "";
    } else if (usuarioTieneSesion()) {
      paragraphs[1].textContent = "";
      paragraphs[1].style.display = "none";
    } else {
      paragraphs[1].textContent = "";
      paragraphs[1].style.display = "none";
    }
  }

  if (badge) {
    if (isPremiumUser) {
      badge.textContent = "PREMIUM";
      badge.style.display = "inline-flex";
    } else if (usuarioTieneSesion()) {
      badge.textContent = "";
      badge.style.display = "none";
    } else {
      badge.textContent = "";
      badge.style.display = "none";
    }
  }

  if (trigger) {
    trigger.textContent = "Abrir asesor";
    trigger.disabled = false;
  }
}

// ============================================
// 8.2 ASESOR LEGAL IA (RAG)
// ============================================

const LIMITE_CONSULTAS_GRATIS = 50;
const LIMITE_CARACTERES_PREGUNTA_IA = 1200;
const ASESOR_LEGAL_STORAGE_PREFIX = "balance_laboral_asesor_legal_";

function getModoAsesorLegal() {
  if (window.esPremium) return "premium";
  if (usuarioTieneSesion()) return "free";
  return "anonimo";
}

function getAsesorLegalStorageKey() {
  const dayKey = new Date().toISOString().slice(0, 10);
  if (window.usuarioActual && window.usuarioActual.uid) {
    return ASESOR_LEGAL_STORAGE_PREFIX + window.usuarioActual.uid + "_" + dayKey;
  }

  return ASESOR_LEGAL_STORAGE_PREFIX + "anonimo_" + dayKey;
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
  const messages = document.getElementById("legal-ai-messages");
  if (messages) messages.innerHTML = "";
}

function crearMensajeBienvenidaLegal() {
  const messages = document.getElementById("legal-ai-messages");
  if (!messages || messages.childElementCount > 0) return;

  const modo = getModoAsesorLegal();

  if (modo === "anonimo") {
    crearMensajeLegal(
      "Regístrate o inicia sesión para utilizar las consultas IA sobre convenios.",
      "assistant",
    );
    return;
  }

  if (modo === "free") {
    const restantes = getConsultasRestantes();
    if (restantes > 0) {
      crearMensajeLegal(
        `Indícame tu trabajo, tu ciudad y tu duda para revisar el convenio que te corresponde.`,
        "assistant",
      );
    } else {
      crearMensajeLegal(
        comercioPremiumBloqueadoEnTwa()
          ? "Has agotado tus 50 consultas gratuitas de hoy en esta versión de Android."
          : "Ya has agotado tus 50 consultas gratuitas de hoy. Vuelve mañana o hazte Premium para disponer de 200 consultas diarias.",
        "assistant",
      );
    }
    return;
  }

  crearMensajeLegal(
    "Dime tu trabajo, tu ciudad y tu duda para revisar el convenio que te corresponde.",
    "assistant",
  );
}

function inyectarEstilosAsesorLegal() {
  if (document.getElementById("asesor-legal-styles")) return;

  const style = document.createElement("style");
  style.id = "asesor-legal-styles";
  style.textContent = `
        .legal-ai-shell {
            position: fixed;
            inset: 0;
            top: var(--app-modal-top, 0px);
            bottom: auto;
            z-index: 10000;
            display: none;
            align-items: flex-end;
            justify-content: flex-end;
            background: rgba(8, 15, 30, 0.38);
            backdrop-filter: blur(6px);
            height: var(--app-modal-height);
            padding:
                calc(18px + var(--safe-area-top))
                calc(18px + var(--safe-area-right))
                calc(18px + var(--safe-area-bottom))
                calc(18px + var(--safe-area-left));
            overflow: hidden;
        }
        .legal-ai-shell.is-open {
            display: flex;
        }
        .legal-ai-panel {
            width: min(420px, calc(100vw - 24px));
            height: min(calc(var(--app-modal-height) - var(--safe-area-top) - var(--safe-area-bottom) - 36px), 760px);
            background: #f7f5ef;
            border-radius: 22px;
            box-shadow: 0 26px 70px rgba(15, 23, 42, 0.32);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            min-height: 0;
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
            flex-shrink: 0;
        }
        .legal-ai-title {
            margin: 0;
            font-size: 1rem;
            line-height: 1.2;
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
            flex-shrink: 0;
        }
        .legal-ai-messages {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
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
            flex-shrink: 0;
        }
        .legal-ai-input {
            width: 100%;
            min-height: 88px;
            max-height: 34svh;
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
                height: var(--app-modal-height);
                border-radius: 0;
                border: 0;
            }
            .legal-ai-header {
                padding-top: calc(14px + var(--safe-area-top));
                padding-left: calc(16px + var(--safe-area-left));
                padding-right: calc(16px + var(--safe-area-right));
            }
            .legal-ai-messages {
                padding-left: calc(16px + var(--safe-area-left));
                padding-right: calc(16px + var(--safe-area-right));
            }
            .legal-ai-inputbar {
                padding:
                    12px
                    calc(14px + var(--safe-area-right))
                    calc(12px + var(--safe-area-bottom))
                    calc(14px + var(--safe-area-left));
            }
            .legal-ai-input {
                min-height: 72px;
                max-height: 28svh;
            }
        }
    `;
  document.head.appendChild(style);
}

function crearMensajeLegal(texto, tipo) {
  const messages = document.getElementById("legal-ai-messages");
  if (!messages) return null;

  const el = document.createElement("div");
  el.className = `legal-ai-message ${tipo}`;
  el.textContent = texto;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function anadirProcedenciaRespuestaLegal(mensaje, data) {
  if (!mensaje || !data || !data.sourceType) return;

  const etiquetas = {
    convenio: "Según tu convenio",
    official_web: "Información oficial actualizada",
    general_ai: "Orientación general de IA",
    clarification: "Necesito concretar tu convenio",
  };
  const etiqueta = etiquetas[data.sourceType];
  if (!etiqueta) return;

  const source = document.createElement("div");
  source.className = "legal-ai-source";
  source.textContent = etiqueta;
  source.style.cssText = "margin-top:8px;font-size:.78rem;font-weight:700;color:#334155;";
  mensaje.appendChild(source);

  if (data.warning) {
    const warning = document.createElement("div");
    warning.className = "legal-ai-warning";
    warning.textContent = data.warning;
    warning.style.cssText = "margin-top:6px;font-size:.78rem;line-height:1.35;color:#64748b;";
    mensaje.appendChild(warning);
  }
}

function crearHtmlLegal(html, tipo) {
  const messages = document.getElementById("legal-ai-messages");
  if (!messages || !html) return null;

  const el = document.createElement("div");
  el.className = `legal-ai-message ${tipo}`;
  el.innerHTML = html;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function actualizarTextoEstadoLegal() {
  const status = document.getElementById("legal-ai-status");
  const note = document.getElementById("legal-ai-note");
  const sendBtn = document.getElementById("legal-ai-send");
  const input = document.getElementById("legal-ai-input");

  if (!status || !note || !sendBtn || !input) return;

  const modo = getModoAsesorLegal();
  const restantes = getConsultasRestantes();

  if (modo === "premium") {
    status.style.display = "none";
    note.style.display = "none";
    sendBtn.disabled = false;
    input.disabled = false;
  } else if (modo === "anonimo") {
    status.style.display = "block";
    note.style.display = "block";
    status.textContent =
      "Regístrate para utilizar las consultas IA sobre convenios.";
    note.textContent =
      "Crea una cuenta gratuita o inicia sesión para activar el asesor legal IA.";
    sendBtn.disabled = true;
    input.disabled = true;
  } else if (restantes > 0) {
    status.style.display = "block";
    note.style.display = "block";
    status.textContent = `Modo gratuito: te quedan ${restantes} de ${LIMITE_CONSULTAS_GRATIS} consultas.`;
    note.textContent = comercioPremiumBloqueadoEnTwa()
      ? "El límite gratuito se aplica a esta versión de Android."
      : "Cuando llegues a 0, tendrás que hacerte Premium para seguir consultando.";
    sendBtn.disabled = false;
    input.disabled = false;
  } else {
    status.style.display = "block";
    note.style.display = "block";
    status.textContent = `Has agotado tus ${LIMITE_CONSULTAS_GRATIS} consultas gratuitas de hoy.`;
    note.textContent = comercioPremiumBloqueadoEnTwa()
      ? "La cuota gratuita diaria se ha agotado en esta versión de Android."
      : "Vuelve mañana o hazte Premium para disponer de 200 consultas IA al día.";
    sendBtn.disabled = true;
    input.disabled = true;
  }
}

async function enviarConsultaLegal() {
  const input = document.getElementById("legal-ai-input");
  const sendBtn = document.getElementById("legal-ai-send");
  const pregunta = input ? input.value.trim() : "";

  if (!pregunta) {
    crearMensajeLegal(
      "Escribe una pregunta para consultar el convenio.",
      "error",
    );
    return;
  }

  if (pregunta.length > LIMITE_CARACTERES_PREGUNTA_IA) {
    crearMensajeLegal(
      `La pregunta no puede superar ${LIMITE_CARACTERES_PREGUNTA_IA} caracteres.`,
      "error",
    );
    return;
  }

  if (!usuarioTieneSesion()) {
    actualizarTextoEstadoLegal();
    crearMensajeLegal(
      "Necesitas registrarte o iniciar sesión para utilizar las consultas IA.",
      "assistant",
    );
    return;
  }

  if (!window.esPremium && getConsultasRestantes() <= 0) {
    actualizarTextoEstadoLegal();
    crearMensajeLegal(
      comercioPremiumBloqueadoEnTwa()
        ? "Has agotado las 50 consultas gratuitas de hoy en esta versión de Android."
        : "Has agotado las 50 consultas gratuitas de hoy. Vuelve mañana o hazte Premium para disponer de 200 consultas IA al día.",
      "assistant",
    );
    return;
  }

  crearMensajeLegal(pregunta, "user");
  if (input) input.value = "";
  if (sendBtn) sendBtn.disabled = true;

  const typing = crearMensajeLegal("Consultando el convenio...", "assistant");

  try {
    const currentUser = await esperarUsuarioAuth();

    if (!currentUser) {
      logLegalAiAuthDebug({
        hasUser: false,
        uid: null,
        tokenLength: 0,
        hasAuthorizationHeader: false,
      });
      throw new Error("Debes iniciar sesión para usar la consulta IA");
    }

    const idToken = await currentUser.getIdToken();
    const authorizationHeader = `Bearer ${idToken}`;
    const appCheckToken =
      typeof window.obtenerAppCheckToken === "function"
        ? await window.obtenerAppCheckToken()
        : null;
    const headers = {
      "Content-Type": "application/json",
      Authorization: authorizationHeader,
    };

    if (appCheckToken) {
      headers["X-Firebase-AppCheck"] = appCheckToken;
    }

    if (typeof window.logAppCheckDebug === "function") {
      window.logAppCheckDebug({
        siteKeyPresent: Boolean(
          window.APP_CONFIG && window.APP_CONFIG.appCheckSiteKey,
        ),
        initialized: typeof window.obtenerAppCheckToken === "function",
        getTokenCalled: typeof window.obtenerAppCheckToken === "function",
        getTokenResolved: true,
        tokenObtained: Boolean(appCheckToken),
        tokenLength: appCheckToken ? appCheckToken.length : 0,
        headerAdded: Boolean(headers["X-Firebase-AppCheck"]),
      });
    }

    logLegalAiAuthDebug({
      hasUser: true,
      uid: currentUser.uid,
      tokenLength: idToken ? idToken.length : 0,
      hasAuthorizationHeader: Boolean(authorizationHeader),
    });

    const consultarConvenioUrl =
      (window.APP_CONFIG && window.APP_CONFIG.consultarConvenioUrl) ||
      localStorage.getItem("consultarConvenioUrl") ||
      "/consultarConvenio";

    const response = await fetch(consultarConvenioUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pregunta,
        ciudad: ciudadActual || "",
        sector: sectorUsuario || "",
        convenioFileName:
          window.convenioFileName ||
          localStorage.getItem("convenioFileName") ||
          localStorage.getItem("file_name") ||
          "",
      }),
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const data = isJson
      ? await response.json()
      : { error: await response.text() };

    if (!isJson) {
      throw new Error(
        "La consulta no devolvió JSON. Revisa la URL del backend o el despliegue de la función.",
      );
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Debes iniciar sesión para usar la consulta IA");
      }

      if (response.status === 429) {
        const quotaPlan = data && data.quota ? data.quota.plan : "";
        throw new Error(
          quotaPlan === "premium"
            ? "Has alcanzado temporalmente el límite de uso razonable. Inténtalo más tarde."
            : "Has alcanzado el límite diario gratuito de consultas IA. Inténtalo mañana.",
        );
      }

      if (response.status === 400) {
        throw new Error(
          data && data.error
            ? data.error
            : "Revisa la pregunta antes de enviarla.",
        );
      }

      throw new Error(
        data && data.error ? data.error : "No se pudo consultar el convenio.",
      );
    }

    if (typing) typing.remove();
    let respuesta = data.respuesta || "No he podido generar una respuesta.";
    if (
      data.requiereAclaracion &&
      Array.isArray(data.opcionesConvenio) &&
      data.opcionesConvenio.length
    ) {
      const sugerencias = data.opcionesConvenio
        .slice(0, 3)
        .map((opcion) => (opcion && opcion.title ? `- ${opcion.title}` : ""))
        .filter(Boolean)
        .join("\n");

      if (sugerencias) {
        respuesta = `${respuesta}\n\nPosibles convenios:\n${sugerencias}`;
      }
    }

    const mensajeRespuesta = crearMensajeLegal(respuesta, "assistant");
    anadirProcedenciaRespuestaLegal(mensajeRespuesta, data);

    const searchEntryPoint =
      data.searchSuggestions &&
      data.searchSuggestions.searchEntryPoint &&
      data.searchSuggestions.searchEntryPoint.renderedContent;

    if (searchEntryPoint) {
      crearHtmlLegal(searchEntryPoint, "assistant");
    }

    if (!window.esPremium) {
      if (
        data.quota &&
        data.quota.plan === "free" &&
        typeof data.quota.limit === "number" &&
        typeof data.quota.remaining === "number"
      ) {
        setConsultasUsadas(data.quota.limit - data.quota.remaining);
      } else if (!data.requiereAclaracion) {
        setConsultasUsadas(getConsultasUsadas() + 1);
      }
      actualizarTarjetaAsesorLegal(false);
    }
  } catch (error) {
    if (typing) typing.remove();
    const mensaje = error && error.message ? error.message : "";
    const esErrorDeConexion =
      /fetch|network|json|consultar el convenio|No se encontraron fragmentos/i.test(
        mensaje,
      );

    if (esErrorDeConexion) {
      crearMensajeLegal(
        "No he podido obtener una respuesta en este momento. Inténtalo de nuevo.",
        "error",
      );
    } else {
      crearMensajeLegal(
        mensaje || "Ha ocurrido un error al consultar el convenio.",
        "error",
      );
    }
  } finally {
    actualizarTextoEstadoLegal();
    if (input && !input.disabled && puedeAutoenfocarCampo()) input.focus();
    if (sendBtn && !sendBtn.disabled) sendBtn.disabled = false;
  }
}

function montarAsesorLegal() {
  if (document.getElementById("legal-ai-shell")) return;

  inyectarEstilosAsesorLegal();

  const shell = document.createElement("div");
  shell.id = "legal-ai-shell";
  shell.className = "legal-ai-shell";
  shell.innerHTML = `
        <div class="legal-ai-panel" role="dialog" aria-modal="true" aria-labelledby="legal-ai-title">
            <div class="legal-ai-header">
                <div>
                    <h3 class="legal-ai-title" id="legal-ai-title">Asesoría Legal sobre Convenios</h3>
                </div>
                <button type="button" class="legal-ai-close" id="legal-ai-close" aria-label="Cerrar asesor legal">×</button>
            </div>
            <div class="legal-ai-status" id="legal-ai-status"></div>
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

  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  const trigger = document.getElementById("btn-ai-legal");
  const closeBtn = shell.querySelector("#legal-ai-close");
  const sendBtn = shell.querySelector("#legal-ai-send");
  const input = shell.querySelector("#legal-ai-input");

  if (trigger && !trigger.dataset.bound) {
    trigger.dataset.bound = "true";
    trigger.addEventListener("click", window.abrirAsesorLegal);
  }
  if (closeBtn) closeBtn.addEventListener("click", window.cerrarAsesorLegal);
  if (sendBtn) sendBtn.addEventListener("click", enviarConsultaLegal);
  if (input) {
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        enviarConsultaLegal();
      }
    });
  }

  window.actualizarAsesorLegalUI();
}

window.abrirAsesorLegal = function () {
  montarAsesorLegal();
  const shell = document.getElementById("legal-ai-shell");
  if (!shell) return;

  shell.classList.add("is-open");
  limpiarMensajesLegales();
  actualizarTextoEstadoLegal();
  crearMensajeBienvenidaLegal();

  if (!usuarioTieneSesion() && typeof mostrarLogin === "function") {
    setTimeout(function () {
      mostrarLogin();
    }, 250);
  }

  const input = document.getElementById("legal-ai-input");
  if (input && !input.disabled && puedeAutoenfocarCampo()) input.focus();
};

window.cerrarAsesorLegal = function () {
  const shell = document.getElementById("legal-ai-shell");
  if (shell) shell.classList.remove("is-open");
};

window.actualizarAsesorLegalUI = function () {
  const badge = document.getElementById("legal-ai-header-badge");
  const trigger = document.getElementById("btn-ai-legal");
  const esPremiumActivo = !!window.esPremium;
  const modo = getModoAsesorLegal();

  if (badge) {
    if (modo === "premium") {
      badge.textContent = "PREMIUM";
      badge.style.display = "inline-flex";
    } else if (modo === "free") {
      badge.textContent = "";
      badge.style.display = "none";
    } else {
      badge.textContent = "";
      badge.style.display = "none";
    }
  }
  if (trigger) {
    trigger.disabled = false;
    trigger.textContent = "Abrir asesor";
    trigger.style.display = "inline-flex";
  }
  actualizarTarjetaAsesorLegal(esPremiumActivo);
  actualizarTextoEstadoLegal();
  aplicarRestriccionComercioPremiumTwa();
};

window.seleccionarPlan = function (tipo) {
  if (comercioPremiumBloqueadoEnTwa()) {
    if (typeof cerrarModalPricing === "function") cerrarModalPricing();
    mostrarAvisoComercioPremiumNoDisponible();
    return;
  }

  planSeleccionado = "premium";

  if (!usuarioActual) {
    alert("Debes iniciar sesión primero para elegir un plan.");
    if (typeof cerrarModalPricing === "function") cerrarModalPricing();
    if (typeof mostrarLogin === "function") mostrarLogin();
    return;
  }

  const links = {
    mensual: "https://buy.stripe.com/9B6dR9fyC4Vb8hY1lngbm01",
    anual: "https://buy.stripe.com/00w9AT9aecnDeGm7JLgbm00",
  };

  const urlBase = links[tipo];
  if (!urlBase) return;

  const urlFinal = `${urlBase}?prefilled_email=${encodeURIComponent(usuarioActual.email)}&client_reference_id=${usuarioActual.uid}`;
  window.location.href = urlFinal;
};

window.mostrarLogoGrande = function () {
  document.getElementById("logo-overlay").style.display = "flex";
};

window.cerrarLogoGrande = function () {
  document.getElementById("logo-overlay").style.display = "none";
};

window.mostrarLegal = function (tipo) {
  const titulo = document.getElementById("legal-title");
  const cuerpo = document.getElementById("legal-body");

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
        `,
  };

  titulo.innerText =
    tipo === "privacidad"
      ? "POLÍTICA DE PRIVACIDAD"
      : tipo === "terminos"
        ? "TÉRMINOS DE USO"
        : "POLÍTICA DE COOKIES";
  cuerpo.innerHTML = textos[tipo];
  document.getElementById("modal-legal").style.display = "flex";
};

window.cerrarLegal = function () {
  document.getElementById("modal-legal").style.display = "none";
};

window.redirigirPortalStripe = function () {
  if (comercioPremiumBloqueadoEnTwa()) {
    mostrarAvisoComercioPremiumNoDisponible();
    return;
  }

  if (!usuarioActual) return;
  const portalUrl =
    "https://billing.stripe.com/p/login/00w9AT9aecnDeGm7JLgbm00";
  window.location.href = `${portalUrl}?prefilled_email=${encodeURIComponent(usuarioActual.email)}`;
};

function actualizarEstadoBorradoCuenta(mensaje, esError = false) {
  const status = document.getElementById("account-delete-status");
  if (!status) return;

  status.textContent = mensaje;
  status.style.color = esError ? "#b91c1c" : "";
}

function marcarBorradoCuentaEnCurso(enCurso) {
  document
    .querySelectorAll("[data-account-delete-action]")
    .forEach((link) => {
      if (!link.dataset.defaultLabel) link.dataset.defaultLabel = link.textContent.trim();
      link.setAttribute("aria-disabled", enCurso ? "true" : "false");
      link.style.pointerEvents = enCurso ? "none" : "";
      link.style.opacity = enCurso ? "0.65" : "";
      link.textContent = enCurso ? "Eliminando cuenta…" : link.dataset.defaultLabel;
    });
}

async function reautenticarParaBorrarCuenta(user) {
  const providerIds = (user.providerData || []).map((provider) => provider.providerId);

  if (providerIds.includes("google.com")) {
    alert("Por seguridad, confirma tu identidad con Google para continuar.");
    await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    return;
  }

  if (providerIds.includes("password")) {
    const password = window.prompt(
      "Por seguridad, escribe tu contraseña para confirmar el borrado. Solo se enviará a Firebase para reautenticarte y no se guardará.",
    );

    if (password === null) {
      const error = new Error("Has cancelado la reautenticación.");
      error.code = "auth/reauthentication-cancelled";
      throw error;
    }

    if (!password) {
      const error = new Error("Debes introducir tu contraseña para continuar.");
      error.code = "auth/reauthentication-required";
      throw error;
    }

    const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
    await user.reauthenticateWithCredential(credential);
    return;
  }

  const error = new Error("Vuelve a iniciar sesión con tu proveedor antes de eliminar la cuenta.");
  error.code = "auth/reauthentication-unsupported-provider";
  throw error;
}

async function solicitarBorradoCuentaBackend(user, permitirReautenticacion = true) {
  const idToken = await user.getIdToken(true);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  };
  const appCheckToken =
    typeof window.obtenerAppCheckToken === "function"
      ? await window.obtenerAppCheckToken()
      : null;

  if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;

  const response = await fetch("/deleteAccount", {
    method: "POST",
    headers,
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));

  if (
    response.status === 401 &&
    data.code === "requires_recent_login" &&
    permitirReautenticacion
  ) {
    actualizarEstadoBorradoCuenta("Confirma tu identidad para continuar…");
    await reautenticarParaBorrarCuenta(user);
    return solicitarBorradoCuentaBackend(user, false);
  }

  if (!response.ok || !data.deleted) {
    const error = new Error(
      data.error || "No se pudo eliminar la cuenta. Inténtalo de nuevo o contacta con soporte.",
    );
    error.code = data.code || "account_deletion_failed";
    throw error;
  }

  return data;
}

function limpiarDatosLocalesTrasBorrado(uid) {
  try {
    if (uid) localStorage.removeItem(ASESOR_LEGAL_STORAGE_PREFIX + uid);
    localStorage.removeItem("esPremium");
  } catch (error) {
    console.warn("No se pudieron limpiar todas las preferencias locales de la cuenta:", error);
  }

  window.usuarioActual = null;
  if (typeof sincronizarEstadoPremium === "function") sincronizarEstadoPremium(false);
}

window.eliminarCuentaTotalmente = async function () {
  const user = auth.currentUser;

  if (!user) {
    alert("Inicia sesión para eliminar tu cuenta.");
    return;
  }

  const confirmed = confirm(
    "Vas a eliminar tu cuenta y los datos de jornada guardados. Si tienes una suscripción Premium activa, se cancelará inmediatamente y perderás el acceso Premium. Las facturas o registros que Stripe deba conservar pueden mantenerse conforme a sus obligaciones. ¿Quieres continuar?",
  );
  if (!confirmed) return;

  marcarBorradoCuentaEnCurso(true);
  actualizarEstadoBorradoCuenta("Comprobando la cuenta y eliminando tus datos…");

  try {
    const result = await solicitarBorradoCuentaBackend(user);
    limpiarDatosLocalesTrasBorrado(user.uid);
    await auth.signOut().catch(() => {});

    actualizarEstadoBorradoCuenta("Cuenta eliminada correctamente.");
    alert(
      result.billingCustomerStatus === "retained"
        ? "La cuenta y los datos de la aplicación se han eliminado. Stripe puede conservar registros de facturación cuando sea necesario."
        : "La cuenta y los datos de la aplicación se han eliminado correctamente.",
    );
    window.location.assign("/");
  } catch (error) {
    const message =
      error && error.code === "auth/reauthentication-cancelled"
        ? "El borrado se ha cancelado antes de confirmar tu identidad."
        : error && error.message
          ? error.message
          : "No se pudo eliminar la cuenta. Inténtalo de nuevo o contacta con soporte.";
    actualizarEstadoBorradoCuenta(message, true);
    alert(message);
  } finally {
    marcarBorradoCuentaEnCurso(false);
  }
};

window.exportarMisDatos = function () {
  if (!usuarioActual) return alert("Inicia sesión para exportar tus datos.");

  const datos = {
    usuario: usuarioActual.email,
    exportado: new Date().toISOString(),
    registros: diasMarcados,
    horasExtra: horasExtraPorDia,
    configuracion: {
      ciudad: ciudadActual,
      sector: sectorUsuario,
      objetivos: objetivosAnuales,
    },
  };

  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(datos, null, 2));
  const downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "mis_datos_laborales.json");
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
};

window.toggleDarkMode = function () {
  const body = document.body;
  body.classList.toggle("dark-mode");

  const isDark = body.classList.contains("dark-mode");
  localStorage.setItem("darkMode", isDark);

  const icon = document.getElementById("dark-mode-icon");
  if (icon) {
    icon.setAttribute("data-lucide", isDark ? "sun" : "moon");
    lucide.createIcons();
  }
};

(function () {
  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
    setTimeout(() => {
      const icon = document.getElementById("dark-mode-icon");
      if (icon) {
        icon.setAttribute("data-lucide", "sun");
        lucide.createIcons();
      }
    }, 100);
  }
})();
