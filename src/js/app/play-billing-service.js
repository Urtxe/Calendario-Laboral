(function (window, document) {
  "use strict";

  const STORE = "https://play.google.com/billing";
  const PRODUCTS = ["premium_monthly", "premium_yearly"];
  const VERIFY_ENDPOINT = "/playBilling/verify";
  let servicePromise = null;

  function isPlayTwa() {
    return typeof window.esContextoPlayTwa === "function" && window.esContextoPlayTwa();
  }

  async function getService() {
    if (!isPlayTwa()) throw new Error("not_play_twa");
    if (typeof window.PaymentRequest !== "function" || typeof window.getDigitalGoodsService !== "function") {
      throw new Error("play_billing_unavailable");
    }
    if (!servicePromise) servicePromise = window.getDigitalGoodsService(STORE);
    return servicePromise;
  }

  function displayPrice(price) {
    if (!price || !price.currency) return "";
    return new Intl.NumberFormat(navigator.language, {
      style: "currency",
      currency: price.currency,
    }).format(price.value);
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

  function showUnavailable(message) {
    window.alert(message || "Las compras con Google Play no están disponibles temporalmente. Inténtalo de nuevo más tarde.");
  }

  async function openPremiumModal() {
    if (!window.usuarioActual) {
      window.alert("Necesitas iniciar sesión para activar Premium.");
      if (typeof window.mostrarLogin === "function") window.mostrarLogin();
      return;
    }
    try {
      const products = await getProducts();
      closeModal();
      const modal = document.createElement("div");
      modal.id = "play-billing-modal";
      modal.className = "modal";
      modal.style.display = "flex";
      modal.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="play-billing-title">
        <button type="button" class="close-btn" aria-label="Cerrar">×</button>
        <h2 id="play-billing-title">Hazte Premium</h2>
        <p>Elige tu suscripción. El precio mostrado lo proporciona Google Play.</p>
        <div class="pricing-plans"></div>
        <button type="button" class="btn-secondary play-restore">Restaurar compras</button>
        <p class="play-billing-status" role="status"></p>
      </div>`;
      const content = modal.querySelector(".pricing-plans");
      const status = modal.querySelector(".play-billing-status");
      products.forEach((product) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "plan-card";
        button.innerHTML = `<strong>${product.title}</strong><span>${displayPrice(product.price)}</span>`;
        button.addEventListener("click", async () => {
          button.disabled = true;
          status.textContent = "Abriendo Google Play…";
          try {
            const result = await purchase(product.itemId);
            status.textContent = result.premiumActive ? "Premium activado." : "La compra está pendiente de confirmación.";
            if (typeof window.verificarNivelPremium === "function") window.verificarNivelPremium(window.usuarioActual.uid);
          } catch (error) {
            status.textContent = error.message === "purchase_cancelled" ? "Compra cancelada." : "No se pudo completar la compra.";
          } finally {
            button.disabled = false;
          }
        });
        content.appendChild(button);
      });
      modal.querySelector(".close-btn").addEventListener("click", closeModal);
      modal.querySelector(".play-restore").addEventListener("click", async () => {
        status.textContent = "Comprobando compras…";
        try {
          const result = await restore();
          status.textContent = result.premiumActive ? "Compra restaurada y Premium activado." : "No hay compras activas para restaurar.";
          if (typeof window.verificarNivelPremium === "function") window.verificarNivelPremium(window.usuarioActual.uid);
        } catch (_) {
          status.textContent = "No se pudieron restaurar las compras ahora.";
        }
      });
      document.body.appendChild(modal);
    } catch (_) {
      showUnavailable();
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
