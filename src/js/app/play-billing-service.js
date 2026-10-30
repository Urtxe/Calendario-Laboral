(function (window, document) {
  "use strict";

  const STORE = "https://play.google.com/billing";
  const PRODUCTS = ["premium_monthly", "premium_yearly"];
  const VERIFY_ENDPOINT = "/playBilling/verify";
  let servicePromise = null;

  const USER_MESSAGES = Object.freeze({
    not_play_twa: "Las compras con Google Play solo están disponibles desde la aplicación instalada con Google Play.",
    play_billing_unavailable: "Google Play Billing no está disponible en este dispositivo. Actualiza la aplicación desde Google Play e inténtalo de nuevo.",
    products_unavailable: "No se han podido cargar los planes de Google Play. Inténtalo de nuevo en unos minutos.",
    authentication_required: "Necesitas iniciar sesión para activar Premium.",
    purchase_cancelled: "Compra cancelada.",
    purchase_already_linked: "Esta compra ya está vinculada a otra cuenta de Balance Laboral.",
    google_play_verification_failed: "Google Play no ha podido confirmar la compra todavía. No se realizará ningún cargo adicional; inténtalo de nuevo más tarde.",
    play_verification_failed: "No se ha podido verificar la compra con Google Play. Inténtalo de nuevo más tarde.",
  });

  function isPlayTwa() {
    return typeof window.esContextoPlayTwa === "function" && window.esContextoPlayTwa();
  }

  async function getService() {
    if (!isPlayTwa()) throw new Error("not_play_twa");
    if (typeof window.PaymentRequest !== "function" || typeof window.getDigitalGoodsService !== "function") {
      throw new Error("play_billing_unavailable");
    }
    if (!servicePromise) {
      servicePromise = window.getDigitalGoodsService(STORE);
    }
    try {
      return await servicePromise;
    } catch (error) {
      // Availability can change while Chrome reconnects to the TWA. Do not cache
      // a failed initialization for the rest of the session.
      servicePromise = null;
      throw error;
    }
  }

  function displayPrice(price) {
    if (!price || !price.currency) return "";
    return new Intl.NumberFormat(navigator.language, {
      style: "currency",
      currency: price.currency,
    }).format(price.value);
  }

  function displayPeriod(period, itemId) {
    const normalized = String(period || "").toUpperCase();
    const match = /^P(\d+)?([YMWD])$/.exec(normalized);
    const amount = match ? Number(match[1] || 1) : 0;
    const units = {
      Y: ["año", "años"],
      M: ["mes", "meses"],
      W: ["semana", "semanas"],
      D: ["día", "días"],
    };
    const unit = match && units[match[2]];
    if (unit && amount === 1) return `por ${unit[0]}`;
    if (unit) return `cada ${amount} ${unit[1]}`;
    return itemId === "premium_yearly" ? "por año" : "por mes";
  }

  function premiumStatusCopy() {
    const play = window.datosCuentaPremium && window.datosCuentaPremium.billing && window.datosCuentaPremium.billing.googlePlay;
    if (!play || play.active !== true) return "";
    const expiration = play.expiresAt ? new Date(play.expiresAt) : null;
    const date = expiration && !Number.isNaN(expiration.getTime())
      ? new Intl.DateTimeFormat(navigator.language, { dateStyle: "long" }).format(expiration)
      : "";
    if (play.autoRenewEnabled === false) {
      return `Tu Premium de Google Play está cancelado${date ? ` y seguirá activo hasta el ${date}` : ""}.`;
    }
    return `Tu Premium de Google Play está activo${date ? ` hasta el ${date}` : ""} y se renueva automáticamente.`;
  }

  async function getProducts() {
    const service = await getService();
    const details = await service.getDetails(PRODUCTS);
    const byId = new Map((details || []).map((item) => [item.itemId, item]));
    if (PRODUCTS.some((id) => !byId.has(id))) throw new Error("products_unavailable");
    return PRODUCTS.map((id) => byId.get(id));
  }

  async function authenticatedPost(body) {
    if (!window.usuarioActual) throw new Error("authentication_required");
    const idToken = await window.usuarioActual.getIdToken();
    const appCheckToken = typeof window.obtenerAppCheckToken === "function"
      ? await window.obtenerAppCheckToken()
      : null;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    };
    if (appCheckToken) headers["X-Firebase-AppCheck"] = appCheckToken;
    const response = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.code || "play_verification_failed");
    return payload;
  }

  async function verifyPurchase(purchaseToken, productId, source) {
    if (!purchaseToken || !productId) throw new Error("missing_purchase_data");
    return authenticatedPost({ purchaseToken, productId, source });
  }

  async function purchase(productId) {
    const service = await getService();
    if (!PRODUCTS.includes(productId)) throw new Error("unsupported_product");
    const request = new window.PaymentRequest([{
      supportedMethods: STORE,
      data: { sku: productId },
    }], {
      // Play ignores this mandatory Payment Request field and uses its catalog price.
      total: { label: "Total", amount: { currency: "EUR", value: "0" } },
    });
    try {
      if (window.BalanceLaboralConversion) window.BalanceLaboralConversion.trackPremiumCheckoutStarted("google_play");
      const response = await request.show();
      const result = await verifyPurchase(response.details && response.details.purchaseToken, productId, "purchase");
      await response.complete(result.premiumActive ? "success" : "fail");
      return result;
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("purchase_cancelled");
      throw error;
    }
  }

  async function restore() {
    const service = await getService();
    const purchases = await service.listPurchases();
    const results = await Promise.all((purchases || [])
      .filter((purchase) => PRODUCTS.includes(purchase.itemId) && purchase.purchaseToken)
      .map((purchase) => verifyPurchase(purchase.purchaseToken, purchase.itemId, "restore")));
    return results.find((result) => result.premiumActive) || { premiumActive: false };
  }

  function closeModal() {
    const modal = document.getElementById("play-billing-modal");
    if (modal) modal.remove();
  }

  function errorCode(error) {
    const code = error && typeof error.message === "string" ? error.message : "";
    return Object.prototype.hasOwnProperty.call(USER_MESSAGES, code) ? code : "play_billing_unavailable";
  }

  function userMessage(error) {
    return USER_MESSAGES[errorCode(error)];
  }

  function traceFailure(stage, error) {
    // This deliberately records only an allow-listed failure code: purchase
    // tokens, Firebase tokens and server responses must never reach the console.
    if (window.console && typeof window.console.warn === "function") {
      window.console.warn("[play-billing]", { stage, code: errorCode(error) });
    }
  }

  function showUnavailable(error) {
    window.alert(userMessage(error));
  }

  function createPremiumModal() {
    closeModal();
    const modal = document.createElement("div");
    modal.id = "play-billing-modal";
    // `modal` had no stylesheet in this app, so the selector was appended below
    // the page instead of being visible. Reuse the established fixed overlay.
    modal.className = "modal-overlay play-billing-modal";
    modal.style.display = "flex";
    modal.innerHTML = `<div class="modal-content play-billing-content" role="dialog" aria-modal="true" aria-labelledby="play-billing-title">
      <button type="button" class="close-btn play-billing-close" aria-label="Cerrar">
        <i data-lucide="x" aria-hidden="true"></i>
      </button>
      <header class="play-billing-header">
        <span class="play-billing-icon" aria-hidden="true"><i data-lucide="crown"></i></span>
        <h2 id="play-billing-title">Hazte Premium</h2>
        <p class="play-billing-subtitle">Elige tu suscripción</p>
        <p class="play-billing-price-note">Precios gestionados por Google Play</p>
      </header>
      <p class="play-billing-existing" role="status"></p>
      <ul class="play-billing-benefits"><li>Más consultas de IA</li><li>Historial anual</li><li>Exportación a PDF</li></ul>
      <div class="pricing-plans"></div>
      <p class="play-billing-terms">Puedes cancelar la renovación cuando quieras. Al cancelarla, mantienes Premium hasta que venza el período pagado, salvo los supuestos de reembolso o revocación aplicables.</p>
      <button type="button" class="btn-secondary play-restore">
        <i data-lucide="rotate-ccw" aria-hidden="true"></i><span>Restaurar compras</span>
      </button>
      <p class="play-billing-status" role="status" aria-live="polite">Cargando planes de Google Play…</p>
    </div>`;
    document.body.appendChild(modal);
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
    return modal;
  }

  async function openPremiumModal() {
    if (!window.usuarioActual) {
      window.alert("Necesitas iniciar sesión para activar Premium.");
      if (typeof window.mostrarLogin === "function") window.mostrarLogin();
      return;
    }
    const modal = createPremiumModal();
    const content = modal.querySelector(".pricing-plans");
    const status = modal.querySelector(".play-billing-status");
    const existing = modal.querySelector(".play-billing-existing");
    existing.textContent = premiumStatusCopy();
    modal.querySelector(".close-btn").addEventListener("click", closeModal);
    try {
      const products = await getProducts();
      status.textContent = "Elige un plan para continuar con Google Play.";
      products.forEach((product) => {
        const button = document.createElement("button");
        const isYearly = product.itemId === "premium_yearly";
        const planName = isYearly ? "Premium anual" : "Premium mensual";
        button.type = "button";
        button.className = `plan-card play-billing-plan${isYearly ? " play-billing-plan-recommended" : ""}`;
        const period = displayPeriod(product.subscriptionPeriod, product.itemId);
        const renewalCopy = `Se renueva automáticamente ${period}; cancela cuando quieras desde Google Play.`;
        button.setAttribute("aria-label", `Elegir ${planName}, ${displayPrice(product.price)} ${period}`);
        button.innerHTML = `${isYearly ? '<span class="play-billing-plan-badge">Recomendado</span>' : ""}<strong>${planName}</strong><span class="play-billing-plan-price">${displayPrice(product.price)} <small>${period}</small></span><span class="play-billing-plan-renewal">${renewalCopy}</span>`;
        button.addEventListener("click", async () => {
          button.disabled = true;
          status.textContent = "Abriendo Google Play…";
          try {
            const result = await purchase(product.itemId);
            status.textContent = result.premiumActive ? "Premium activado." : "La compra está pendiente de confirmación.";
            if (typeof window.verificarNivelPremium === "function") window.verificarNivelPremium(window.usuarioActual.uid);
          } catch (error) {
            traceFailure("purchase", error);
            status.textContent = userMessage(error);
          } finally {
            button.disabled = false;
          }
        });
        content.appendChild(button);
      });
      modal.querySelector(".play-restore").addEventListener("click", async () => {
        const restoreButton = modal.querySelector(".play-restore");
        restoreButton.disabled = true;
        restoreButton.querySelector("span").textContent = "Restaurando…";
        status.textContent = "Restaurando compras…";
        try {
          const result = await restore();
          status.textContent = result.premiumActive ? "Compra restaurada y Premium activado." : "No hay compras activas para restaurar.";
          if (typeof window.verificarNivelPremium === "function") window.verificarNivelPremium(window.usuarioActual.uid);
        } catch (error) {
          traceFailure("restore", error);
          status.textContent = userMessage(error);
        } finally {
          restoreButton.disabled = false;
          restoreButton.querySelector("span").textContent = "Restaurar compras";
        }
      });
    } catch (error) {
      traceFailure("load_products", error);
      status.textContent = userMessage(error);
    }
  }

  window.PlayBillingService = Object.freeze({
    isAvailable: async () => {
      try { await getService(); return true; } catch (_) { return false; }
    },
    getProducts,
    purchase,
    restore,
    openPremiumModal,
  });
})(window, document);
