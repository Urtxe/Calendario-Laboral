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
    "Las compras con Google Play no están disponibles temporalmente. Inténtalo de nuevo más tarde.",
  );
}

const PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions";
let datosCuentaPremium = {};

function suscripcionGooglePlayConocida(datos = datosCuentaPremium) {
  const play = datos && datos.billing && datos.billing.googlePlay;
  return !!play && ["premium_monthly", "premium_yearly"].includes(play.productId);
}

function actualizarEnlaceGestionGooglePlay(datos = datosCuentaPremium) {
  const conocida = suscripcionGooglePlayConocida(datos);
  document.querySelectorAll("[data-account-delete-action]").forEach((action) => {
    let link = action.parentNode && action.parentNode.querySelector("[data-google-play-manage]");
    if (conocida && !link) {
      link = document.createElement("a");
      link.dataset.googlePlayManage = "true";
      link.href = PLAY_SUBSCRIPTIONS_URL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Gestionar suscripción en Google Play";
      action.parentNode.insertBefore(link, action.nextSibling);
    }
    if (link) link.style.display = conocida ? "inline" : "none";
  });
}

function ofrecerGestionGooglePlayAntesDeBorrar() {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const modal = document.createElement("div");
    modal.id = "account-delete-play-modal";
    modal.className = "modal-overlay play-billing-modal account-delete-play-modal";
    modal.style.display = "flex";
    modal.innerHTML = `<section class="modal-content account-delete-play-dialog" role="dialog" aria-modal="true" aria-labelledby="account-delete-play-title">
      <h2 id="account-delete-play-title">Antes de eliminar tu cuenta</h2>
      <p>Eliminar la cuenta no cancela tu suscripción de Google Play ni detiene sus renovaciones. Cancélala en Google Play para evitar futuros cobros; podrías perder el acceso Premium pagado y no se reembolsará el tiempo restante.</p>
      <a href="${PLAY_SUBSCRIPTIONS_URL}" target="_blank" rel="noopener noreferrer">Gestionar suscripción en Google Play</a>
      <div class="account-delete-play-actions">
        <button type="button" class="btn-secondary" data-play-delete-cancel>Cancelar</button>
        <button type="button" class="btn-primary" data-play-delete-continue>Continuar borrado</button>
      </div>
    </section>`;
    document.body.appendChild(modal);
    const finish = (continueDeletion) => {
      modal.remove();
      if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
      resolve(continueDeletion);
    };
    modal.querySelector("[data-play-delete-cancel]").addEventListener("click", () => finish(false));
    modal.querySelector("[data-play-delete-continue]").addEventListener("click", () => finish(true));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) finish(false);
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      if (event.key !== "Tab") return;
      const controls = Array.from(modal.querySelectorAll("a[href], button"));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    modal.querySelector("[data-play-delete-cancel]").focus();
  });
}

async function refrescarSnapshotPremiumAntesDeBorrar(uid) {
  try {
    const doc = await db.collection("usuarios").doc(uid).get();
    datosCuentaPremium = doc.exists ? doc.data() : {};
    window.datosCuentaPremium = datosCuentaPremium;
    actualizarEnlaceGestionGooglePlay(datosCuentaPremium);
  } catch (_) {
    // Best-effort only: deletion retries may be unable to read the document after its marker is set.
  }
}

function aplicarRestriccionComercioPremiumTwa() {
  if (!comercioPremiumBloqueadoEnTwa()) return;

  document.body.classList.add("is-play-twa");
  document
    .querySelectorAll(
      '[onclick*="seleccionarPlan"], [onclick*="redirigirPortalStripe"], .link-cancelar-sub',
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

  const btnUpgrade = document.getElementById("btn-upgrade");
  if (btnUpgrade) {
    btnUpgrade.style.display = "inline-flex";
    btnUpgrade.textContent = "Hazte Premium con Google Play";
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
      if (typeof abrirModalPremium === "function") {
        const trigger = targetId === "seccion-pdf" ? "pdf_export" : targetId === "seccion-historial" ? "annual_history" : "advanced_overtime";
        if (window.PremiumUpsell) window.PremiumUpsell.show(trigger);
        else abrirModalPremium(trigger);
      }
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

let horasCalendarioSaveTimer = null;
let ultimaPromesaGuardadoCalendario = Promise.resolve(false);

function trackCalendarConfigurationAfterSave(savePromise) {
  Promise.resolve(savePromise).then(function (saved) {
    if (saved && window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackCalendarConfigured();
  });
}

document.addEventListener("DOMContentLoaded", function () {
  inicializarViewportIOS();

  const setupListener = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  };

  setupListener("ciudadUsuario", "change", function () {
    ciudadActual = this.value;
    contextoLaboralSesion = null;
    cargarFestivosOficiales(ciudadActual, anioActual);
    trackCalendarConfigurationAfterSave(guardarTodoEnFirebase());
  });

  setupListener("inputAnio", "input", function () {
    anioActual = parseInt(this.value) || new Date().getFullYear();
    cargarFestivosOficiales(ciudadActual, anioActual);
  });

  setupListener("horasAnuales", "input", function () {
    objetivosAnuales[anioActual] = parseInt(this.value) || 0;
    renderTodo();
    ultimaPromesaGuardadoCalendario = guardarTodoEnFirebase();
    window.clearTimeout(horasCalendarioSaveTimer);
    horasCalendarioSaveTimer = window.setTimeout(function () {
      trackCalendarConfigurationAfterSave(ultimaPromesaGuardadoCalendario);
    }, 750);
  });

  setupListener("tipoJornada", "change", function () {
    tipoJornadaPorAnio[anioActual] = parseFloat(this.value);
    renderTodo();
    trackCalendarConfigurationAfterSave(guardarTodoEnFirebase());
  });

  setupListener("sectorUsuario", "change", function () {
    sectorUsuario = this.value;
    contextoLaboralSesion = null;
    renderTodo();
    trackCalendarConfigurationAfterSave(guardarTodoEnFirebase());
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

window.abrirModalPremium = function (trigger) {
  if (comercioPremiumBloqueadoEnTwa()) {
    if (window.PlayBillingService) {
      window.PlayBillingService.openPremiumModal();
      if (window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackPremiumPrompt(trigger || "other");
    } else {
      mostrarAvisoComercioPremiumNoDisponible();
    }
    return;
  }

  if (!usuarioTieneSesion()) {
    alert("Necesitas registrarte o iniciar sesión para activar Premium.");
    if (typeof mostrarLogin === "function") mostrarLogin();
    return;
  }

  if (usuarioPuedeUsarPremium()) {
    return;
  }

  if (window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackPremiumPrompt(trigger || "other");
  const modal = document.getElementById("modal-pricing");
  if (modal) {
    const trial = window.APP_CONFIG && window.APP_CONFIG.stripeTrialEnabled === true;
    const trialCopy = modal.querySelector("[data-premium-trial]");
    if (trialCopy) {
      trialCopy.hidden = !trial;
      trialCopy.textContent = "7 días de prueba para nuevas suscripciones elegibles. Después se cobrará el plan elegido salvo cancelación. Stripe confirma la oferta antes de contratar.";
    }
    modal.querySelectorAll(".btn-plan-yellow").forEach(button => { button.textContent = trial ? "Ver prueba de 7 días" : "Elegir plan"; });
    modal.style.display = "flex";
  }
};

window.cerrarModalPricing = function () {
  const modal = document.getElementById("modal-pricing");
  if (modal) modal.style.display = "none";
};

function verificarNivelPremium(uid) {
  return db.collection("usuarios")
    .doc(uid)
    .get()
    .then(function (doc) {
      if (!window.usuarioActual || window.usuarioActual.uid !== uid) return;
      datosCuentaPremium = doc.exists ? doc.data() : {};
      window.datosCuentaPremium = datosCuentaPremium;
      const premiumActivo = window.PremiumAccess
        ? window.PremiumAccess.isPremium(datosCuentaPremium)
        : datosCuentaPremium.tipoCuenta === "premium";
      sincronizarEstadoPremium(premiumActivo);
      actualizarInterfazPremium(premiumActivo, datosCuentaPremium);
      programarCaducidadPremium();
      window.BALANCE_LABORAL_PREMIUM_STATUS = { uid, premium: premiumActivo, ready: true };
      window.dispatchEvent(new CustomEvent("balance-premium-status", { detail: window.BALANCE_LABORAL_PREMIUM_STATUS }));
      if (window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackPremiumActivationConfirmed(premiumActivo, datosCuentaPremium);
    })
    .catch((e) => {
      if (!window.usuarioActual || window.usuarioActual.uid !== uid) return;
      console.error("Error verificando premium:", e);
      sincronizarEstadoPremium(false);
      actualizarInterfazPremium(false);
      window.BALANCE_LABORAL_PREMIUM_STATUS = { uid, premium: false, ready: false };
      window.dispatchEvent(new CustomEvent("balance-premium-status", { detail: window.BALANCE_LABORAL_PREMIUM_STATUS }));
    });
}

let premiumExpiryTimer;
function programarCaducidadPremium() {
  window.clearTimeout(premiumExpiryTimer);
  if (!window.PremiumAccess) return;
  const snapshotUid = window.usuarioActual && window.usuarioActual.uid;
  const billing = datosCuentaPremium.billing || {};
  const expirations = [billing.stripe && billing.stripe.expiresAt, billing.googlePlay && billing.googlePlay.expiresAt, datosCuentaPremium.stripeCurrentPeriodEnd]
    .map(window.PremiumAccess.expiryMillis).filter(value => Number.isFinite(value) && value > Date.now());
  if (!expirations.length) return;
  premiumExpiryTimer = window.setTimeout(() => {
    if (!window.usuarioActual || window.usuarioActual.uid !== snapshotUid) return;
    const active = window.PremiumAccess.isPremium(datosCuentaPremium);
    sincronizarEstadoPremium(active);
    actualizarInterfazPremium(active, datosCuentaPremium);
    programarCaducidadPremium();
    verificarNivelPremium(snapshotUid);
  }, Math.min(2147480000, Math.max(1, Math.min(...expirations) - Date.now() + 50)));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !window.usuarioActual) return;
  if (window.PremiumAccess) {
    const active = window.PremiumAccess.isPremium(datosCuentaPremium);
    sincronizarEstadoPremium(active);
    actualizarInterfazPremium(active, datosCuentaPremium);
  }
  verificarNivelPremium(window.usuarioActual.uid);
});

function actualizarInterfazPremium(activar, datos = datosCuentaPremium) {
  const sE = document.getElementById("seccion-horas-extra");
  const sH = document.getElementById("seccion-historial");
  const sP = document.getElementById("seccion-pdf");
  const btnP = document.getElementById("btnPDF");
  const emailContenedor = document.querySelector(".user-profile-info");
  const btnUpgrade = document.getElementById("btn-upgrade");
  const linksCancel = document.querySelectorAll(".link-cancelar-sub");
  const stripe = datos && datos.billing && datos.billing.stripe;
  const tieneStripe = !!(stripe && stripe.active === true) || !!(
    datos && datos.stripeSubscriptionId && ["active", "trialing"].includes(datos.subscriptionStatus)
  );
  actualizarEnlaceGestionGooglePlay(datos);
  const oldBadge = document.querySelector(".pro-badge-email");
  if (oldBadge) oldBadge.remove();

  if (activar) {
    document.body.classList.add("is-premium");
    if (btnUpgrade) btnUpgrade.style.display = "none";
    linksCancel.forEach((link) => {
      link.style.display = tieneStripe && !comercioPremiumBloqueadoEnTwa() ? "inline" : "none";
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
      btnUpgrade.style.display = comercioPremiumBloqueadoEnTwa() ? "inline-flex" : "block";
    }
    linksCancel.forEach((link) => {
      link.style.display = "none";
    });
    if (sE) sE.classList.add("premium-locked");
    if (sH) sH.classList.add("premium-locked");
    if (sP) sP.classList.add("premium-locked");
    [sE, sH, sP].forEach(section => { if (section) section.classList.remove("active"); });
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
        "Pregúntale a la IA sobre jornada, vacaciones, pluses o salario.";
    } else if (usuarioTieneSesion()) {
      paragraphs[0].textContent = "Tienes 5 consultas gratuitas al mes.";
    } else {
      paragraphs[0].textContent = "Preguntale a la IA sobre tu convenio.";
    }
    paragraphs[0].style.display = "";
  }

  if (paragraphs[1]) {
    if (isPremiumUser) {
      paragraphs[1].textContent = "Sin cuota mensual de consultas; uso personal, con protección antiabuso.";
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

const LIMITE_CONSULTAS_GRATIS = 5;
const LIMITE_CARACTERES_PREGUNTA_IA = 1200;
const ASESOR_LEGAL_STORAGE_PREFIX = "balance_laboral_asesor_legal_";
const ASESOR_LEGAL_QUOTA_PERIOD = "month";
const LIMITE_PREGUNTA_ANTERIOR_IA = 300;
let ultimaPreguntaLegal = "";
let contextoLaboralSesion = null;
let cuotaLegalMes = "";
let cuotaLegalUsadas = 0;
let cuotaLegalResetAt = null;
let cuotaLegalUid = "";
let cuotaLegalRevision = 0;

function getModoAsesorLegal() {
  const premiumActivo = typeof usuarioPuedeUsarPremium === "function"
    ? usuarioPuedeUsarPremium()
    : window.esPremium;
  if (premiumActivo) return "premium";
  if (usuarioTieneSesion()) return "free";
  return "anonimo";
}

function getMesCuotaLegal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}`;
}

function getAsesorLegalStorageKey(month = getMesCuotaLegal()) {
  const uid = window.usuarioActual && window.usuarioActual.uid;
  return uid ? `${ASESOR_LEGAL_STORAGE_PREFIX}${uid}_${month}` : null;
}

function getConsultasUsadas(month = getMesCuotaLegal()) {
  const uid = window.usuarioActual && window.usuarioActual.uid;
  if (uid && cuotaLegalUid === uid && cuotaLegalMes === month) return cuotaLegalUsadas;
  const key = getAsesorLegalStorageKey(month);
  if (!key) return 0;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    return cached && cached.month === month && Number.isFinite(cached.used)
      ? Math.max(0, Math.min(LIMITE_CONSULTAS_GRATIS, cached.used))
      : 0;
  } catch (_) {
    return 0;
  }
}

function setConsultasUsadas(valor, resetAt = null) {
  const month = getMesCuotaLegal();
  const used = Math.max(0, Math.min(LIMITE_CONSULTAS_GRATIS, Number(valor) || 0));
  cuotaLegalMes = month;
  cuotaLegalUsadas = used;
  cuotaLegalResetAt = resetAt || null;
  cuotaLegalUid = window.usuarioActual && window.usuarioActual.uid || "";
  cuotaLegalRevision += 1;
  const key = getAsesorLegalStorageKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ month, used })); } catch (_) { /* The backend remains the quota authority. */ }
}

function setCuotaLegalDesdeRespuesta(quota) {
  if (!quota || quota.plan !== "free" || quota.period !== ASESOR_LEGAL_QUOTA_PERIOD) return false;
  if (quota.resetAt && Date.parse(quota.resetAt) <= Date.now()) return false;
  const used = Number.isFinite(quota.used)
    ? quota.used
    : Number.isFinite(quota.limit) && Number.isFinite(quota.remaining)
      ? quota.limit - quota.remaining
      : null;
  if (used === null) return false;
  setConsultasUsadas(used, quota.resetAt);
  return true;
}

function obtenerResetCuotaLegal(month = getMesCuotaLegal()) {
  const [year, monthNumber] = month.split("-").map(Number);
  const utc = new Date(Date.UTC(year, monthNumber, 1));
  const offsetHours = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23",
  }).format(utc));
  return new Date(utc.getTime() - offsetHours * 3600000).toISOString();
}

function formatearResetCuotaLegal() {
  const resetAt = cuotaLegalMes === getMesCuotaLegal() && cuotaLegalResetAt
    ? new Date(cuotaLegalResetAt)
    : new Date(obtenerResetCuotaLegal());
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", day: "numeric", month: "long",
  }).format(resetAt);
}

async function sincronizarCuotaLegalDesdeFirestore(uid) {
  if (!uid || typeof db === "undefined") return;
  const month = getMesCuotaLegal();
  const revision = cuotaLegalRevision;
  try {
    const snapshot = await db.collection("usuarios").doc(uid).collection("usage").doc("ai").get();
    if (!window.usuarioActual || window.usuarioActual.uid !== uid || getMesCuotaLegal() !== month || cuotaLegalRevision !== revision) return;
    const usage = snapshot.exists ? snapshot.data() || {} : {};
    const used = usage.freeMonthlyKey === month ? usage.freeMonthlyCount : 0;
    setConsultasUsadas(used, obtenerResetCuotaLegal(month));
    actualizarTextoEstadoLegal();
  } catch (_) {
    // Quota enforcement stays on the server when the optional display read fails.
  }
}

function getConsultasRestantes() {
  if (getModoAsesorLegal() === "premium") return Infinity;
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
  const mensajeContexto = sectorUsuario && sectorUsuario !== "general"
    ? "Pregúntame por tu convenio."
    : ciudadActual
      ? "Indícame tu trabajo o sector y tu duda para localizar tu convenio."
      : "Indícame tu trabajo, tu ciudad y tu duda para localizar tu convenio.";

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
        mensajeContexto,
        "assistant",
      );
    } else {
      crearMensajeLegal(`Has usado tus ${LIMITE_CONSULTAS_GRATIS} consultas gratuitas de este mes. Se renuevan el ${formatearResetCuotaLegal()}.`, "assistant");
    }
    return;
  }

  crearMensajeLegal(
    mensajeContexto,
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
    estatuto: "Normativa laboral general consultada",
    general_ai: "Orientación general de IA",
    clarification: "Necesito concretar tu convenio",
    unconfirmed: "Información documental incompleta",
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
    status.style.display = "block";
    note.style.display = "block";
    status.textContent = "Sin cuota mensual de consultas.";
    note.textContent = "Uso personal, con protección antiabuso.";
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
    status.textContent = `Te quedan ${restantes} de ${LIMITE_CONSULTAS_GRATIS} consultas gratuitas este mes.`;
    note.textContent = `Se renuevan el ${formatearResetCuotaLegal()}.`;
    sendBtn.disabled = false;
    input.disabled = false;
  } else {
    status.style.display = "block";
    note.style.display = "block";
    status.textContent = `Has usado tus ${LIMITE_CONSULTAS_GRATIS} consultas gratuitas este mes.`;
    note.textContent = `Se renuevan el ${formatearResetCuotaLegal()}.`;
    // Cached counts only inform the display; the server decides whether to accept a request.
    sendBtn.disabled = false;
    input.disabled = false;
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

    const contextoLaboral = contextoLaboralSesion || {
      sector: sectorUsuario === "general" ? "" : sectorUsuario || "",
      ciudad: ciudadActual || "",
    };
    const response = await fetch(consultarConvenioUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pregunta,
        ...(ultimaPreguntaLegal ? { preguntaAnterior: ultimaPreguntaLegal } : {}),
        ciudad: contextoLaboral.ciudad,
        sector: contextoLaboral.sector,
        ...(contextoLaboral.convenioFileName ? { convenioFileName: contextoLaboral.convenioFileName } : {}),
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
        const code = data && data.code;
        if (code === "free_monthly_quota_exceeded") {
          setCuotaLegalDesdeRespuesta(data.quota);
          throw new Error(`Has usado tus ${LIMITE_CONSULTAS_GRATIS} consultas gratuitas este mes. Se renuevan el ${formatearResetCuotaLegal()}.`);
        }
        if (code === "request_in_progress") throw new Error("Ya tienes una consulta en curso. Espera a que termine antes de iniciar otra.");
        if (code === "rate_limited") throw new Error("Espera un momento antes de iniciar otra consulta IA.");
        if (data && data.quota && data.quota.plan === "premium") throw new Error("Has alcanzado temporalmente el límite de uso razonable. Inténtalo más tarde.");
        throw new Error(data && data.error ? data.error : "No se pudo iniciar la consulta. Inténtalo de nuevo.");
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
    setCuotaLegalDesdeRespuesta(data.quota);
    if (window.LegalAIReports) window.LegalAIReports.attach(mensajeRespuesta, respuesta);
    if (window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackAIConsultationSucceeded();
    anadirProcedenciaRespuestaLegal(mensajeRespuesta, data);
    ultimaPreguntaLegal = pregunta.length <= LIMITE_PREGUNTA_ANTERIOR_IA ? pregunta : "";
    if (data.convenioUsado && data.convenioDetectado?.province && data.convenioDetectado.sectorKeys?.length) {
      contextoLaboralSesion = {
        sector: data.convenioDetectado.sectorKeys[0],
        ciudad: data.convenioDetectado.province,
        convenioFileName: data.convenioUsado,
      };
    }

    const searchEntryPoint =
      data.searchSuggestions &&
      data.searchSuggestions.searchEntryPoint &&
      data.searchSuggestions.searchEntryPoint.renderedContent;

    if (searchEntryPoint) {
      crearHtmlLegal(searchEntryPoint, "assistant");
    }

    if (getModoAsesorLegal() !== "premium") {
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
  ultimaPreguntaLegal = "";
  contextoLaboralSesion = null;
  limpiarMensajesLegales();
  actualizarTextoEstadoLegal();
  crearMensajeBienvenidaLegal();
  if (window.usuarioActual && window.usuarioActual.uid) {
    sincronizarCuotaLegalDesdeFirestore(window.usuarioActual.uid);
  }

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
  ultimaPreguntaLegal = "";
  contextoLaboralSesion = null;
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
    const productId = tipo === "mensual" ? "premium_monthly" : tipo === "anual" ? "premium_yearly" : null;
    if (!productId || !window.PlayBillingService) {
      mostrarAvisoComercioPremiumNoDisponible();
      return;
    }
    window.PlayBillingService.purchase(productId)
      .then(() => window.verificarNivelPremium && window.verificarNivelPremium(window.usuarioActual.uid))
      .catch(() => mostrarAvisoComercioPremiumNoDisponible());
    return;
  }

  planSeleccionado = "premium";

  if (!usuarioActual) {
    alert("Debes iniciar sesión primero para elegir un plan.");
    if (typeof cerrarModalPricing === "function") cerrarModalPricing();
    if (typeof mostrarLogin === "function") mostrarLogin();
    return;
  }

  // Reusable Payment Links preserve this checkout. Enforcing one trial per
  // Firebase UID would require server-created Checkout sessions and a ledger.
  const links = {
    mensual: "https://buy.stripe.com/9B6dR9fyC4Vb8hY1lngbm01",
    anual: "https://buy.stripe.com/00w9AT9aecnDeGm7JLgbm00",
  };

  const urlBase = links[tipo];
  if (!urlBase) return;

  const urlFinal = `${urlBase}?prefilled_email=${encodeURIComponent(usuarioActual.email)}&client_reference_id=${usuarioActual.uid}`;
  if (window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackPremiumCheckoutStarted();
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
            <p>Utilizamos cookies y almacenamiento técnico necesarios para el funcionamiento del servicio:</p>
            <p>• <b>Sesión:</b> Para mantener su acceso iniciado a través de Firebase Auth.</p>
            <p>• <b>Pagos:</b> Cookies de Stripe necesarias para prevenir el fraude y procesar transacciones seguras.</p>
            <p>• <b>Preferencias:</b> Almacenamiento local de su configuración básica de jornada.</p>
            <h4>2. Analítica opcional</h4>
            <p>Solo tras tu aceptación expresa usamos Google Analytics mediante Firebase Analytics para medir visitas, clics desde convenios, uso, registro, Premium y regresos D1/D7/D30. Guardamos localmente el origen de la sesión y una fecha de activación con marcas de deduplicación; se eliminan al retirar el consentimiento. No enviamos email, UID de Firebase ni el contenido de jornadas o consultas. No usamos fingerprinting ni publicidad personalizada.</p>
            <p>Puedes aceptar, rechazar o retirar el consentimiento en cualquier momento.</p>
            <button type="button" onclick="abrirPreferenciasAnalitica()">Gestionar analítica</button>
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
    if (uid) {
      const prefix = ASESOR_LEGAL_STORAGE_PREFIX + uid;
      Object.keys(localStorage).filter(key => key === prefix || key.startsWith(prefix + "_")).forEach(key => localStorage.removeItem(key));
    }
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

  await refrescarSnapshotPremiumAntesDeBorrar(user.uid);
  if (suscripcionGooglePlayConocida() && !(await ofrecerGestionGooglePlayAntesDeBorrar())) return;

  const avisosSuscripcion = [];
  avisosSuscripcion.push("Si tienes una suscripción de Google Play, eliminar la cuenta no la cancela ni detiene sus renovaciones. Cancélala en Google Play para evitar futuros cobros; podrías perder el acceso Premium pagado y no se reembolsará el tiempo restante.");
  const stripe = datosCuentaPremium.billing && datosCuentaPremium.billing.stripe;
  if (stripe && stripe.active === true || (
    datosCuentaPremium.stripeSubscriptionId && ["active", "trialing"].includes(datosCuentaPremium.subscriptionStatus)
  )) {
    avisosSuscripcion.push("Tu suscripción de Stripe se cancelará y perderás el acceso Premium. Stripe puede conservar facturas o registros conforme a sus obligaciones.");
  }
  const confirmed = confirm(
    `Vas a eliminar tu cuenta y los datos de jornada guardados.${avisosSuscripcion.length ? ` ${avisosSuscripcion.join(" ")}` : ""} ¿Quieres continuar?`,
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
