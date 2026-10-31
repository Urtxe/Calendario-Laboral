(function (root) {
  "use strict";

  const copy = {
    annual_history: {
      title: "Consulta tu histórico anual",
      text: "Compara tus horas trabajadas y el balance de cada año con los datos que ya has guardado.",
      cta: "Desbloquear histórico",
    },
    pdf_export: {
      title: "Tus registros, listos para exportar",
      text: "Genera informes PDF mensuales con tus jornadas y balances guardados.",
      cta: "Desbloquear informes PDF",
    },
    advanced_overtime: {
      title: "Lleva el control de tus horas extra",
      text: "Registra horas extra y su compensación junto al resto de tus jornadas.",
      cta: "Desbloquear horas extra",
    },
  };
  const nudges = new Set(["shifts_3", "active_days_2", "balance_views_2"]);
  const nudgeKey = "bl_premium_nudge_dismissed_at";
  const nudgeCooldown = 7 * 24 * 60 * 60 * 1000;
  const welcomeSeenKey = "bl_premium_welcome_seen_v1";
  const welcomePendingKey = "bl_premium_welcome_pending_v1";
  let dialog = null;
  let welcomeDialog = null;
  let previousFocus = null;
  let welcomeRequested = false;
  let welcomeShownThisSession = false;
  let domReady = false;
  let pendingObserver = null;
  let pendingState = null;
  let pendingPlans = false;
  let pendingRegistrationRequested = false;
  let authRevision = 0;
  let playTrialAvailability = null;
  let resolvingPlayTrial = false;
  const hasPremium = () => typeof root.usuarioPuedeUsarPremium === "function" ? root.usuarioPuedeUsarPremium() : root.esPremium;

  function storageGet(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(storage, key, value) {
    try { storage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function storageRemove(storage, key) {
    try { storage.removeItem(key); } catch (_) { /* Storage may be blocked. */ }
  }

  function isPlayTwa() {
    return typeof root.esContextoPlayTwa === "function" && root.esContextoPlayTwa();
  }

  function trialCopyEnabled() {
    if (isPlayTwa()) return playTrialAvailability === true;
    return !!(root.APP_CONFIG && root.APP_CONFIG.stripeTrialEnabled === true);
  }

  function visible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (element.style && element.style.display === "none") return false;
    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
    if (typeof root.getComputedStyle === "function") {
      const style = root.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    }
    return true;
  }

  function hasBlockingDialog() {
    if (!root.document || typeof root.document.querySelectorAll !== "function") return false;
    return Array.from(root.document.querySelectorAll('[role="dialog"], .modal-overlay, .analytics-consent:not([hidden])'))
      .some((element) => element !== welcomeDialog && visible(element));
  }

  function observeUntilAvailable() {
    if (pendingObserver || !root.document || !root.document.body || typeof root.MutationObserver !== "function") return;
    pendingObserver = new root.MutationObserver(() => {
      if (!hasBlockingDialog()) {
        if (pendingObserver) pendingObserver.disconnect();
        pendingObserver = null;
        tryPendingWork();
      }
    });
    pendingObserver.observe(root.document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["style", "hidden", "class", "aria-hidden"] });
  }

  function closeWelcome() {
    if (!welcomeDialog) return;
    welcomeDialog.remove();
    welcomeDialog = null;
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    previousFocus = null;
  }

  function setPendingRegistration() {
    pendingRegistrationRequested = true;
    storageSet(root.sessionStorage, welcomePendingKey, "1");
  }

  function clearPendingRegistration() {
    pendingRegistrationRequested = false;
    storageRemove(root.sessionStorage, welcomePendingKey);
  }

  function startRegistration() {
    closeWelcome();
    if ("planSeleccionado" in root) root.planSeleccionado = "gratis";
    setPendingRegistration();
    if (typeof root.mostrarRegistro === "function") root.mostrarRegistro("premium_offer");
  }

  function openWelcome(state) {
    if (!state || state.ready !== true || state.premium || !root.document || !root.document.body) return false;
    const trial = trialCopyEnabled();
    previousFocus = root.document.activeElement;
    welcomeDialog = root.document.createElement("div");
    welcomeDialog.className = "premium-upsell-overlay premium-welcome-overlay";
    welcomeDialog.setAttribute("role", "dialog");
    welcomeDialog.setAttribute("aria-modal", "true");
    welcomeDialog.setAttribute("aria-labelledby", "premium-welcome-title");
    welcomeDialog.innerHTML = `<section class="premium-upsell-dialog premium-welcome-dialog"><button type="button" class="premium-upsell-close" aria-label="Cerrar">×</button><div class="premium-welcome-hero"><span class="premium-welcome-crown" aria-hidden="true">✦</span><span class="premium-welcome-badge">${trial ? "7 DÍAS DE PRUEBA" : "BALANCE LABORAL PREMIUM"}</span><h2 id="premium-welcome-title">${trial ? "7 días gratis de Premium" : "Más control con Premium"}</h2><p class="premium-welcome-lead">${trial ? "Organiza tu año laboral con todas las herramientas Premium." : "Desbloquea las herramientas para llevar tu año laboral al día."}</p></div><div class="premium-welcome-comparison"><section><h3>Gratis</h3><ul><li>5 consultas IA al mes</li><li>Control laboral básico</li></ul></section><section class="premium-welcome-premium"><h3>Premium</h3><ul><li>Consultas IA sin cuota mensual</li><li>Histórico anual</li><li>Informes PDF</li><li>Control de horas extra</li></ul></section></div><p class="premium-welcome-terms">${trial ? "Prueba para cuentas elegibles. Si confirmas la suscripción, al terminar los 7 días se cobrará el plan elegido salvo cancelación previa. El precio del plan elegido se mostrará antes de confirmar; el proveedor confirmará tu elegibilidad." : "Elige un plan para ver el precio y las condiciones de contratación."}</p><div class="premium-upsell-actions"><button type="button" class="premium-upsell-cta premium-welcome-cta"></button><button type="button" class="premium-upsell-later">Ahora no</button></div></section>`;
    welcomeDialog.querySelector(".premium-welcome-cta").textContent = state.uid
      ? trial ? "Ver planes y probar Premium" : "Ver planes Premium"
      : trial ? "Crear cuenta y ver la prueba" : "Crear cuenta para ver Premium";
    welcomeDialog.querySelector(".premium-upsell-close").addEventListener("click", closeWelcome);
    welcomeDialog.querySelector(".premium-upsell-later").addEventListener("click", closeWelcome);
    welcomeDialog.querySelector(".premium-welcome-cta").addEventListener("click", () => {
      const currentState = pendingState || state;
      if (currentState.uid) {
        closeWelcome();
        if (typeof root.abrirModalPremium === "function") root.abrirModalPremium("other");
      } else {
        startRegistration();
      }
    });
    welcomeDialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWelcome();
      } else if (event.key === "Tab") {
        const controls = welcomeDialog.querySelectorAll("button");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && root.document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && root.document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    welcomeDialog.addEventListener("click", (event) => {
      if (event.target === welcomeDialog) closeWelcome();
    });
    root.document.body.appendChild(welcomeDialog);
    welcomeShownThisSession = true;
    storageSet(root.sessionStorage, welcomeSeenKey, "1");
    welcomeDialog.querySelector(".premium-upsell-close").focus();
    return true;
  }

  function tryPendingWork() {
    if (!domReady || !pendingState || pendingState.ready !== true || pendingState.premium) return;
    const activeUid = root.usuarioActual && root.usuarioActual.uid || null;
    if (activeUid !== pendingState.uid) return;
    if (!domReady || hasBlockingDialog()) {
      observeUntilAvailable();
      return;
    }
    if (pendingPlans) {
      if (pendingState.uid && typeof root.abrirModalPremium === "function") {
        pendingPlans = false;
        clearPendingRegistration();
        root.abrirModalPremium("other");
      }
      return;
    }
    if (!welcomeRequested || welcomeShownThisSession || storageGet(root.sessionStorage, welcomeSeenKey) === "1") return;
    if (isPlayTwa() && playTrialAvailability === null) {
      if (resolvingPlayTrial) return;
      resolvingPlayTrial = true;
      const revision = authRevision;
      const availability = root.PlayBillingService && root.PlayBillingService.getTrialAvailability;
      let trialTimeout;
      const timeout = new Promise((resolve) => {
        trialTimeout = root.setTimeout(() => resolve(false), 3000);
      });
      const catalog = Promise.resolve(typeof availability === "function" ? availability.call(root.PlayBillingService) : false)
        .catch(() => false);
      Promise.race([catalog, timeout])
        .then((available) => {
          if (revision === authRevision) playTrialAvailability = available === true;
        })
        .catch(() => { if (revision === authRevision) playTrialAvailability = false; })
        .finally(() => {
          root.clearTimeout(trialTimeout);
          resolvingPlayTrial = false;
          tryPendingWork();
        });
      return;
    }
    openWelcome(pendingState);
  }

  function handlePremiumStatus(event) {
    const state = event && event.detail;
    if (!state) return;
    authRevision += 1;
    pendingState = { uid: state.uid || null, premium: state.premium === true, ready: state.ready === true };
    if (state.ready !== true) {
      pendingPlans = false;
      closeWelcome();
      if (pendingObserver) {
        pendingObserver.disconnect();
        pendingObserver = null;
      }
      return;
    }
    if (pendingState.premium) {
      pendingPlans = false;
      clearPendingRegistration();
      closeWelcome();
      if (pendingObserver) {
        pendingObserver.disconnect();
        pendingObserver = null;
      }
      welcomeShownThisSession = true;
      storageSet(root.sessionStorage, welcomeSeenKey, "1");
      return;
    }
    if (welcomeDialog) {
      const cta = welcomeDialog.querySelector(".premium-welcome-cta");
      if (cta) cta.textContent = pendingState.uid
        ? trialCopyEnabled() ? "Ver planes y probar Premium" : "Ver planes Premium"
        : trialCopyEnabled() ? "Crear cuenta y ver la prueba" : "Crear cuenta para ver Premium";
    }
    if ((pendingRegistrationRequested || storageGet(root.sessionStorage, welcomePendingKey) === "1") && pendingState.uid) {
      pendingPlans = true;
      tryPendingWork();
      return;
    }
    welcomeRequested = true;
    tryPendingWork();
  }

  function initializeWelcome() {
    domReady = true;
    const status = root.BALANCE_LABORAL_PREMIUM_STATUS;
    if (status) handlePremiumStatus({ detail: status });
    else tryPendingWork();
  }

  if (root.addEventListener) root.addEventListener("balance-premium-status", handlePremiumStatus);
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => root.setTimeout(initializeWelcome, 0), { once: true });
    else initializeWelcome();
  }

  function close() {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    previousFocus = null;
  }

  function open(trigger, options = {}) {
    if (!copy[trigger] || hasPremium() || !root.document || !root.document.body) return false;
    if (dialog) return false;

    const content = copy[trigger];
    previousFocus = root.document.activeElement;
    dialog = root.document.createElement("div");
    dialog.className = "premium-upsell-overlay";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "premium-upsell-title");
    dialog.innerHTML = `<section class="premium-upsell-dialog"><button type="button" class="premium-upsell-close" aria-label="Cerrar">×</button><p class="premium-upsell-eyebrow">PREMIUM</p><h2 id="premium-upsell-title"></h2><p class="premium-upsell-copy"></p><div class="premium-upsell-actions"><button type="button" class="premium-upsell-cta"></button><button type="button" class="premium-upsell-later">Ahora no</button></div></section>`;
    dialog.querySelector("#premium-upsell-title").textContent = content.title;
    dialog.querySelector(".premium-upsell-copy").textContent = content.text;
    dialog.querySelector(".premium-upsell-cta").textContent = content.cta;
    dialog.querySelector(".premium-upsell-close").addEventListener("click", close);
    dialog.querySelector(".premium-upsell-later").addEventListener("click", close);
    dialog.querySelector(".premium-upsell-cta").addEventListener("click", () => {
      close();
      if (typeof root.abrirModalPremium === "function") root.abrirModalPremium(trigger);
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        const controls = dialog.querySelectorAll("button");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && root.document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && root.document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    root.document.body.appendChild(dialog);
    dialog.querySelector(".premium-upsell-close").focus();
    return true;
  }

  function maybeNudge(trigger) {
    if (!nudges.has(trigger) || hasPremium() || welcomeShownThisSession || storageGet(root.sessionStorage, welcomeSeenKey) === "1" || !root.document || !root.document.body) return false;
    if (!root.usuarioActual || !root.usuarioActual.uid) return false;
    try {
      const dismissedAt = Number(root.localStorage.getItem(nudgeKey) || 0);
      if (dismissedAt && Date.now() - dismissedAt < nudgeCooldown) return false;
    } catch (_) {
      return false;
    }
    if (root.document.getElementById("premium-upsell-nudge")) return false;

    const nudge = root.document.createElement("aside");
    nudge.id = "premium-upsell-nudge";
    nudge.className = "premium-upsell-nudge";
    nudge.setAttribute("aria-label", "Sugerencia de Premium");
    nudge.innerHTML = `<span>¿Quieres consultar tu histórico anual?</span><button type="button" class="premium-upsell-nudge-cta">Ver Premium</button><button type="button" class="premium-upsell-nudge-close" aria-label="Cerrar sugerencia">×</button>`;
    nudge.querySelector(".premium-upsell-nudge-cta").addEventListener("click", () => {
      nudge.remove();
      open("annual_history");
    });
    nudge.querySelector(".premium-upsell-nudge-close").addEventListener("click", () => {
      try { root.localStorage.setItem(nudgeKey, String(Date.now())); } catch (_) { /* Keep dismissible if storage is unavailable. */ }
      nudge.remove();
    });
    try { root.localStorage.setItem(nudgeKey, String(Date.now())); } catch (_) { /* Keep the nudge usable if storage is unavailable. */ }
    root.document.body.appendChild(nudge);
    return true;
  }

  root.PremiumUpsell = { show: open, maybeNudge, close, handlePremiumStatus };
})(window);
