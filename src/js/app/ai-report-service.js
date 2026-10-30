(function (window) {
  "use strict";

  const REPORT_ENDPOINT = "/aiReports";
  const MAX_RESPONSE_LENGTH = 8_000;
  const attached = new WeakSet();

  async function sendReport(responseText) {
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
    const result = await window.fetch(REPORT_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "other", response: responseText }),
    });
    if (!result.ok) {
      const payload = await result.json().catch(() => ({}));
      throw new Error(payload.code || "report_unavailable");
    }
  }

  function attach(responseElement, answerText) {
    if (!responseElement || attached.has(responseElement)) return null;
    const fullResponse = typeof answerText === "string" ? answerText.trim() : "";
    if (!fullResponse) return null;
    const response = fullResponse.slice(0, MAX_RESPONSE_LENGTH);
    const truncated = fullResponse.length > MAX_RESPONSE_LENGTH;
    attached.add(responseElement);

    const button = window.document.createElement("button");
    button.type = "button";
    button.className = "ai-report-button";
    button.textContent = "Informar de un problema";
    button.setAttribute("aria-label", "Informar de un problema en esta respuesta");
    const status = window.document.createElement("span");
    status.className = "ai-report-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    responseElement.append(button, status);

    button.addEventListener("click", async () => {
      const disclosure = truncated ? " (solo los primeros 8.000 caracteres)" : "";
      if (!window.confirm(`Se enviará esta respuesta${disclosure} para revisarla. No se enviará tu pregunta. ¿Continuar?`)) return;
      button.disabled = true;
      status.textContent = "Enviando…";
      try {
        await sendReport(response);
        status.textContent = "Gracias. Hemos recibido el aviso.";
        button.remove();
      } catch (error) {
        status.textContent = error && error.message === "authentication_required"
          ? "Inicia sesión para enviar el aviso."
          : error && error.message === "rate_limited"
            ? "Has enviado varios avisos recientemente. Inténtalo más tarde."
            : "No se ha podido enviar el aviso. Inténtalo de nuevo.";
        button.disabled = false;
      }
    });
    return button;
  }

  window.LegalAIReports = Object.freeze({ attach });
})(window);
