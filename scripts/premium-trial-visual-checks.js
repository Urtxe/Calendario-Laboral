// Run with playwright-cli run-code --filename scripts/premium-trial-visual-checks.js.
// Serve the repository on 127.0.0.1:8765. All external requests are blocked.
async (page) => {
  const origin = "http://127.0.0.1:8765";
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/__premium_trial_check") return route.fulfill({
      contentType: "text/html", body: '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/main.css"><body><main id="app-container" style="padding:20px"><h1>Vista previa Premium</h1></main></body></html>',
    });
    return route.continue();
  });
  await page.goto(origin + "/__premium_trial_check");
  const index = await (await page.request.get(origin + "/index.html")).text();
  await page.evaluate(index => {
    const source = new DOMParser().parseFromString(index, "text/html");
    for (const id of ["seccion-historial", "modal-pricing"]) document.getElementById("app-container").appendChild(document.importNode(source.getElementById(id), true));
    window.APP_CONFIG = { stripeTrialEnabled: false };
    window.usuarioActual = { uid: "local-only", getIdToken: async () => "mock-only" };
    window.esPremium = false;
    window.usuarioTieneSesion = () => true;
    window.usuarioPuedeUsarPremium = () => false;
    window.comercioPremiumBloqueadoEnTwa = () => false;
    window.mostrarAvisoComercioPremiumNoDisponible = () => { throw new Error("Unexpected unavailable flow"); };
    window.getDigitalGoodsService = async () => ({ getDetails: async () => [
      { itemId: "premium_monthly", price: { currency: "EUR", value: "0.99" }, subscriptionPeriod: "P1M", freeTrialPeriod: "P7D" },
      { itemId: "premium_yearly", price: { currency: "EUR", value: "9.99" }, subscriptionPeriod: "P1Y" },
    ] });
    window.esContextoPlayTwa = () => true;
    window.PaymentRequest = function () { throw new Error("Purchases forbidden in this test"); };
  }, index);
  for (const file of ["premium-access.js", "premium-upsell.js", "play-billing-service.js"]) await page.addScriptTag({ url: origin + "/src/js/app/" + file });
  const ui = await (await page.request.get(origin + "/src/js/app/ui.js")).text();
  await page.addScriptTag({ content: ui.slice(ui.indexOf("window.abrirModalPremium ="), ui.indexOf("window.cerrarModalPricing =")) });
  for (const [name, width, height, dark] of [["desktop", 1280, 900, false], ["mobile", 390, 844, false], ["dark", 390, 844, true]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(dark => { document.body.classList.toggle("dark-mode", dark); window.PremiumUpsell.show("annual_history"); }, dark);
    await page.getByRole("dialog", { name: "Consulta tu histórico anual" }).waitFor();
    if (await page.locator(".premium-history-preview").count()) throw new Error("Illustrative history example must be removed");
    const overflow = await page.evaluate(() => {
      const dialog = document.querySelector(".premium-upsell-dialog");
      return dialog.scrollWidth > dialog.clientWidth + 1 || dialog.getBoundingClientRect().right > innerWidth + 1;
    });
    if (overflow) throw new Error("Upsell overflows: " + name);
    await page.screenshot({ path: `output/playwright/premium-trial-${name}.png` });
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => window.abrirModalPremium("pdf_export"));
  if (await page.locator("[data-premium-trial]").isVisible()) throw new Error("Unconfigured Stripe trial advertised");
  await page.evaluate(() => { window.APP_CONFIG.stripeTrialEnabled = true; window.abrirModalPremium("pdf_export"); });
  if (!await page.locator("[data-premium-trial]").isVisible()) throw new Error("Configured Stripe trial missing");
  await page.evaluate(() => { document.getElementById("modal-pricing").style.display = "none"; window.comercioPremiumBloqueadoEnTwa = () => true; window.abrirModalPremium("annual_history"); });
  await page.getByRole("dialog", { name: "Hazte Premium" }).waitFor();
  await page.getByText(/7 días gratis para cuentas elegibles/).waitFor();
  const yearly = page.locator(".play-billing-plan").nth(1);
  if ((await yearly.innerText()).includes("7 días gratis")) throw new Error("Trial advertised on plan without catalog offer");
  await page.screenshot({ path: "output/playwright/premium-trial-play.png" });
  return { preview: true, mobile: true, dark: true, stripePromotionGate: true, playCatalogTrial: true, purchases: false };
}
