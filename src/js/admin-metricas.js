(function () {
  const status = document.getElementById("status");
  const dashboard = document.getElementById("dashboard");
  const number = new Intl.NumberFormat("es-ES");
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>\'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const date = (value) => `${value.slice(6, 8)}/${value.slice(4, 6)}`;
  const duration = (value) => {
    const seconds = Math.round(value || 0);
    return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
  };

  function error(message) {
    status.textContent = message;
    status.className = "status error";
    status.hidden = false;
    dashboard.hidden = true;
  }

  function cards(element, values) {
    element.innerHTML = values.map((item) => `<article class="card"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join("");
  }

  function breakdown(title, values, unavailable) {
    return `<article class="breakdown"><h3>${esc(title)}</h3>${unavailable ? `<p class="muted">${esc(unavailable)}</p>` : `<ul>${values.map((value) => `<li>${esc(value.label)}: <b>${number.format(value.value)}</b></li>`).join("") || "<li>Sin datos</li>"}</ul>`}</article>`;
  }

  function render(data) {
    cards(document.getElementById("overview"), [
      { label: "Usuarios activos", value: number.format(data.overview.activeUsers) },
      { label: "Sesiones", value: number.format(data.overview.sessions) },
      { label: "Usuarios nuevos", value: number.format(data.overview.newUsers) },
      { label: "Usuarios recurrentes", value: data.overview.returningUsers == null ? "No disponible" : number.format(data.overview.returningUsers) },
      { label: "Tasa de recurrencia", value: data.overview.returningRate == null ? "No disponible" : `${data.overview.returningRate}%` },
      { label: "Sesiones con interacción", value: number.format(data.overview.engagedSessions) },
      { label: "Tasa de interacción", value: `${data.overview.engagementRate}%` },
      { label: "Duración media", value: duration(data.overview.averageSessionDuration) },
    ]);

    const max = Math.max(1, ...data.daily.map((item) => item.sessions));
    document.getElementById("daily").innerHTML = `<div class="daily-head"><span>Sesiones</span><span>Fecha</span><span>Evolución</span><span>Activos</span></div>${data.daily.map((item) => `<div class="daily-row" title="${esc(date(item.date))}: ${number.format(item.sessions)} sesiones y ${number.format(item.activeUsers)} usuarios activos"><b>${number.format(item.sessions)}</b><time datetime="${esc(item.date)}">${esc(date(item.date))}</time><span class="daily-track"><i style="width:${Math.max(1, Math.round(item.sessions / max * 100))}%"></i></span><small>${number.format(item.activeUsers)}</small></div>`).join("") || "<p class=\"muted\">Sin datos para este periodo.</p>"}`;

    const productValue = (value) => data.product.available ? number.format(value) : "No disponible";
    cards(document.getElementById("product"), [
      { label: "Calendarios configurados (eventos)", value: productValue(data.product.calendarConfigured) },
      { label: "Jornadas guardadas (eventos)", value: productValue(data.product.shiftsAdded) },
      { label: "Balances consultados (eventos)", value: productValue(data.product.balancesViewed) },
      { label: "Consultas IA satisfactorias (eventos)", value: productValue(data.product.aiConsultations) },
      { label: "Checkout Premium iniciado (eventos)", value: productValue(data.product.premiumCheckoutStarted) },
      { label: "Activaciones Premium confirmadas (eventos)", value: productValue(data.product.premiumActivationConfirmed) },
    ]);

    const mode = data.product.accessMode;
    const auth = data.product.authState;
    document.getElementById("breakdowns").innerHTML = breakdown("Ubicaciones (ciudad · región · país)", data.product.locations) +
      breakdown("Canales de adquisición (sesiones)", data.product.acquisition) +
      breakdown("Páginas más vistas", data.product.pages) +
      breakdown("Plataforma (aperturas consentidas)", mode.values || [], mode.available ? "" : mode.reason) +
      breakdown("Estado de cuenta (aperturas consentidas)", auth.values || [], auth.available ? "" : auth.reason) +
      breakdown("Uso por plataforma (eventos)", data.product.platformEvents || [], mode.available ? "" : mode.reason) +
      breakdown("Dispositivos", data.product.devices) + breakdown("Navegadores", data.product.browsers) + breakdown("Idiomas", data.product.languages);

    document.getElementById("funnel").innerHTML = data.funnelAvailable === false
      ? `<p class="muted">${esc(data.funnelUnavailableReason || "Revisa las dimensiones personalizadas de GA4.")}</p>`
      : data.funnel.map((step) => `<div class="funnel-row"><span>${esc(step.label)}</span><b>${number.format(step.value)}</b></div>`).join("");
    const measurement = data.measurement;
    const last = measurement.lastEvent ? `${measurement.lastEvent.dateHourMinute} · ${measurement.lastEvent.name}` : "Sin eventos en las últimas 24 horas";
    document.getElementById("measurement").innerHTML = `<p><b>Estado:</b> ${esc(measurement.message)}</p><p><b>Último evento:</b> ${esc(last)}</p><p><b>Eventos últimas 24 h:</b> ${number.format(Object.values(measurement.eventsLast24h || {}).reduce((sum, value) => sum + value, 0))}</p>`;
    document.getElementById("updated").textContent = `Actualizado: ${new Date(data.updatedAt).toLocaleString("es-ES")}${data.cached ? " (caché de hasta 5 min)" : ""}`;
    status.hidden = true;
    dashboard.hidden = false;
  }

  async function load() {
    status.hidden = false;
    status.className = "status";
    status.textContent = "Consultando GA4…";
    const response = await fetch("/admin/metricas/datos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: document.getElementById("period").value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      error(data.measurement?.message || "No se pudieron consultar las métricas.");
      return;
    }
    render(data);
  }

  load();
  document.getElementById("period").addEventListener("change", load);
})();
