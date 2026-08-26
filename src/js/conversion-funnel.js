// Product conversion analytics and anonymous registration prompts.
// The installation identifier deliberately stays in localStorage: it is never
// sent to Analytics or Firestore and is never associated with a Firebase user.
(function (root) {
  "use strict";

  const INSTALLATION_KEY = "bl_anonymous_installation_id";
  const VISIT_KEY = "bl_anonymous_visit_state_v1";
  const FUNNEL_KEY = "bl_conversion_funnel_state_v1";
  const SESSION_KEY = "bl_conversion_session_v1";
  const PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  function readJson(storage, key, fallback) {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) { return fallback; }
  }
  function writeJson(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (_) { /* Storage is optional. */ }
  }
  function getInstallationId() {
    try {
      const current = root.localStorage.getItem(INSTALLATION_KEY);
      if (current) return current;
      const cryptoApi = root.crypto;
      if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        const id = cryptoApi.randomUUID();
        root.localStorage.setItem(INSTALLATION_KEY, id);
        return id;
      }
      if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") return null;
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      root.localStorage.setItem(INSTALLATION_KEY, id);
      return id;
    } catch (_) { return null; }
  }
  function sessionState() { return readJson(root.sessionStorage, SESSION_KEY, {}); }
  function updateSession(update) {
    const next = Object.assign(sessionState(), update);
    writeJson(root.sessionStorage, SESSION_KEY, next);
    return next;
  }
  function funnelState() {
    return Object.assign({ active_days: [], balance_views: 0, signup_source: "other" }, readJson(root.localStorage, FUNNEL_KEY, {}));
  }
  function updateFunnel(update) {
    const next = Object.assign(funnelState(), update);
    writeJson(root.localStorage, FUNNEL_KEY, next);
    return next;
  }
  function analyticsAllowed() { return !root.APP_CONFIG || root.APP_CONFIG.analyticsEnabled !== false; }
  function logEvent(name, params) {
    if (!analyticsAllowed()) return;
    try {
      if (root.analytics && typeof root.analytics.logEvent === "function") root.analytics.logEvent(name, params);
    } catch (_) { /* Analytics must not affect the calendar. */ }
  }
  function accessMode() { return root.usuarioActual && root.usuarioActual.uid ? "authenticated" : "anonymous"; }
  function visitBucket(visits) { return visits <= 3 ? "2_3" : visits <= 7 ? "4_7" : "8_plus"; }
  function recordAppOpen(user) {
    if (sessionState().app_open_recorded) return;
    let existingInstallation = false;
    try { existingInstallation = Boolean(root.localStorage.getItem(INSTALLATION_KEY)); } catch (_) { /* ignored */ }
    getInstallationId();
    const visit = readJson(root.localStorage, VISIT_KEY, { visits: 0 });
    const visits = Math.max(0, Number(visit.visits) || 0) + 1;
    const isReturning = existingInstallation && visits > 1;
    writeJson(root.localStorage, VISIT_KEY, { visits: visits });
    updateSession({ app_open_recorded: true });
    const mode = user && user.uid ? "authenticated" : "anonymous";
    logEvent("app_open", { access_mode: mode, is_returning: isReturning });
    if (mode === "anonymous" && isReturning) logEvent("anonymous_return_visit", { visit_number_bucket: visitBucket(visits) });
  }
  function markActiveDay() {
    const state = funnelState();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const days = Array.from(new Set([...(state.active_days || []), today])).slice(-2);
    updateFunnel({ active_days: days });
    return days.length;
  }
  function shiftBucket(count) { return count <= 1 ? "1" : count <= 3 ? "2_3" : count <= 10 ? "4_10" : "11_plus"; }
  function getShiftCount() {
    return Object.keys(root.diasMarcados || {}).filter((key) => {
      const day = root.diasMarcados[key];
      return day && (day.tipo === "trabajado" || day.tipo === "baja");
    }).length;
  }
  const promptCopy = {
    shifts_3: { title: "Tus turnos ya están guardados en este dispositivo", text: "Crea una cuenta gratuita para no perder tu calendario ni tu balance al cambiar de móvil u ordenador.", secondary: "Ahora no" },
    active_days_2: { title: "Guarda tu calendario de forma segura", text: "Sincroniza tus turnos entre móvil y ordenador con una cuenta gratuita.", secondary: "Seguir sin cuenta" },
    balance_views_2: { title: "Conserva tu evolución", text: "Crea una cuenta gratuita y consulta tu balance mes a mes sin depender de un solo dispositivo.", secondary: "Ahora no" },
  };
  function canShowRegistrationPrompt() {
    const state = funnelState();
    const session = sessionState();
    return accessMode() === "anonymous" && !session.registration_prompt_handled &&
      (!state.registration_prompt_last_shown || Date.now() - state.registration_prompt_last_shown >= PROMPT_COOLDOWN_MS);
  }
  function showRegistrationPrompt(trigger) {
    if (!promptCopy[trigger] || !canShowRegistrationPrompt()) return false;
    const modal = root.document && root.document.getElementById("registration-prompt-modal");
    if (!modal) return false;
    const copy = promptCopy[trigger];
    root.document.getElementById("registration-prompt-title").textContent = copy.title;
    root.document.getElementById("registration-prompt-text").textContent = copy.text;
    root.document.getElementById("registration-prompt-dismiss").textContent = copy.secondary;
    modal.dataset.trigger = trigger;
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    root.setTimeout(function () {
      const title = root.document.getElementById("registration-prompt-title");
      if (title && typeof title.focus === "function") title.focus();
    }, 0);
    updateFunnel({ registration_prompt_last_shown: Date.now() });
    logEvent("registration_prompt_shown", { trigger: trigger, access_mode: "anonymous" });
    return true;
  }
  function maybeShowRegistrationPrompt(preferredTrigger) {
    if (!canShowRegistrationPrompt()) return false;
    const state = funnelState();
    const triggers = [preferredTrigger, getShiftCount() >= 3 ? "shifts_3" : null, (state.active_days || []).length >= 2 ? "active_days_2" : null, Number(state.balance_views) >= 2 ? "balance_views_2" : null];
    const trigger = triggers.find((value) => value && promptCopy[value]);
    return trigger ? showRegistrationPrompt(trigger) : false;
  }
  function closeRegistrationPrompt(action) {
    const modal = root.document && root.document.getElementById("registration-prompt-modal");
    const trigger = modal && modal.dataset.trigger;
    if (modal) { modal.style.display = "none"; modal.setAttribute("aria-hidden", "true"); }
    updateSession({ registration_prompt_handled: true });
    if (trigger && action === "dismiss") logEvent("registration_prompt_dismissed", { trigger: trigger });
    if (trigger && action === "click") logEvent("registration_prompt_clicked", { trigger: trigger });
    return trigger;
  }
  function trackCalendarConfigured() {
    markActiveDay();
    const workday = root.document && root.document.getElementById("tipoJornada");
    logEvent("calendar_configured", { sector: root.sectorUsuario || "general", province_or_city: root.ciudadActual || "unknown", workday_type: workday && workday.value === "1" ? "full_time" : "part_time" });
    maybeShowRegistrationPrompt();
  }
  function trackShiftAdded() {
    markActiveDay();
    logEvent("shift_added", { access_mode: accessMode(), shift_count_bucket: shiftBucket(getShiftCount()) });
    maybeShowRegistrationPrompt(getShiftCount() >= 3 ? "shifts_3" : null);
  }
  function trackBalanceViewed(balanceState) {
    markActiveDay();
    const state = funnelState();
    const balanceViews = Math.min(2, (Number(state.balance_views) || 0) + 1);
    updateFunnel({ balance_views: balanceViews });
    logEvent("balance_viewed", { access_mode: accessMode(), balance_state: balanceState || "neutral" });
    maybeShowRegistrationPrompt(balanceViews >= 2 ? "balance_views_2" : null);
  }
  function setSignupSource(source) {
    const valid = ["registration_prompt", "header", "settings", "other"];
    updateFunnel({ signup_source: valid.includes(source) ? source : "other" });
  }
  function trackSignupStarted(source) {
    setSignupSource(source);
    updateSession({ registration_prompt_handled: true });
    logEvent("signup_started", { source: funnelState().signup_source });
  }
  function trackSignupCompleted() { logEvent("signup_completed", { source: funnelState().signup_source || "other" }); updateSession({ registration_prompt_handled: true }); }
  function trackPremiumPrompt(trigger) {
    const valid = ["annual_history", "pdf_export", "advanced_overtime", "other"];
    const safeTrigger = valid.includes(trigger) ? trigger : "other";
    if (accessMode() !== "authenticated" || root.esPremium) return;
    updateSession({ premium_trigger: safeTrigger });
    logEvent("premium_prompt_shown", { trigger: safeTrigger });
  }
  function trackPremiumCheckoutStarted() { const trigger = sessionState().premium_trigger || "other"; updateSession({ premium_checkout_started: true }); logEvent("premium_checkout_started", { trigger: trigger }); }
  function trackPremiumActivationConfirmed(isPremium) {
    const session = sessionState();
    if (!isPremium || !session.premium_checkout_started || session.premium_activated_recorded) return;
    updateSession({ premium_activated_recorded: true, premium_checkout_started: false });
    logEvent("premium_activated", {});
  }
  function initialise() {
    getInstallationId();
    if (root.auth && typeof root.auth.onAuthStateChanged === "function") root.auth.onAuthStateChanged(recordAppOpen);
    root.setTimeout(function () { recordAppOpen(root.auth && root.auth.currentUser); }, 2500);
  }
  root.BalanceLaboralConversion = { getInstallationId, recordAppOpen, trackCalendarConfigured, trackShiftAdded, trackBalanceViewed, showRegistrationPrompt, closeRegistrationPrompt, trackSignupStarted, trackSignupCompleted, trackPremiumPrompt, trackPremiumCheckoutStarted, trackPremiumActivationConfirmed, canShowRegistrationPrompt };
  root.cerrarAvisoRegistro = function () { closeRegistrationPrompt("dismiss"); };
  root.aceptarAvisoRegistro = function () { closeRegistrationPrompt("click"); if (typeof root.mostrarRegistro === "function") root.mostrarRegistro("registration_prompt"); };
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", initialise);
    else initialise();
  }
})(window);
