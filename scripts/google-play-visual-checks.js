// Run with playwright-cli run-code --filename scripts/google-play-visual-checks.js.
// Serve the repo on 127.0.0.1:8765 first. All other network requests are blocked.
async (page) => {
  const origin = "http://127.0.0.1:8765";
  const reports = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/__play_audit") return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/main.css"></head><body><main style="padding:24px"><h1>Prueba local Premium</h1><div id="answer">Respuesta de prueba, sin generación IA.</div><footer><a data-account-delete-action>Eliminar cuenta</a></footer></main></body></html>',
    });
    if (url.pathname === "/aiReports") {
      reports.push(route.request().postDataJSON());
      return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    }
    return route.continue();
  });
  await page.goto(`${origin}/__play_audit`);
  await page.addScriptTag({ content: `
    window.esContextoPlayTwa = () => true;
    window.usuarioActual = { getIdToken: async () => 'mock-token' };
    window.getDigitalGoodsService = async () => ({getDetails: async () => [
      {itemId:'premium_monthly',price:{currency:'EUR',value:'4.23'},subscriptionPeriod:'P1M'},
      {itemId:'premium_yearly',price:{currency:'EUR',value:'42.30'},subscriptionPeriod:'P1Y'}
    ]});
    window.PaymentRequest = function () { throw Error('Purchases are forbidden in this check'); };
  ` });
  const ui = await (await page.request.get(`${origin}/src/js/app/ui.js`)).text();
  await page.addScriptTag({ content: ui.slice(ui.indexOf("const PLAY_SUBSCRIPTIONS_URL"), ui.indexOf("function aplicarRestriccionComercioPremiumTwa")) });
  await page.evaluate(() => actualizarEnlaceGestionGooglePlay({ billing: { googlePlay: { productId: "premium_monthly" } } }));
  const management = page.getByRole("link", { name: "Gestionar suscripción en Google Play" });
  if (await management.getAttribute("href") !== "https://play.google.com/store/account/subscriptions") throw Error("Wrong management link");
  if (await management.getAttribute("target") !== "_blank") throw Error("Management must leave the trusted origin safely");
  await page.addScriptTag({ url: `${origin}/src/js/app/play-billing-service.js` });
  for (const [name, width, height, dark] of [["desktop",1280,900,false],["mobile",390,844,false],["mobile-dark",390,844,true]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((dark) => { document.body.classList.toggle("dark-mode",dark); return window.PlayBillingService.openPremiumModal(); }, dark);
    const modal = page.getByRole("dialog", { name: "Hazte Premium" });
    await modal.waitFor();
    if (!/renueva/i.test(await modal.innerText())) throw Error("Missing renewal disclosure");
    const overflowing = await page.evaluate(() => {
      const modal = document.querySelector('.play-billing-content');
      return document.documentElement.scrollWidth > innerWidth + 1 || modal.scrollWidth > modal.clientWidth + 1;
    });
    if (overflowing) throw Error(`Horizontal overflow: ${name}`);
    const contrast = await page.evaluate(() => {
      const luminance = (css) => {
        const rgb = css.match(/[\d.]+/g).slice(0, 3).map((n) => Number(n) / 255)
          .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const text = luminance(getComputedStyle(document.querySelector('.play-billing-plan-price')).color);
      const bg = luminance(getComputedStyle(document.querySelector('.play-billing-plan')).backgroundColor);
      return (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
    });
    if (contrast < 4.5) throw Error(`Insufficient price contrast: ${name}: ${contrast}`);
    await page.screenshot({ path: `output/playwright/premium-${name}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.evaluate(() => { window.deletionChoice = ofrecerGestionGooglePlayAntesDeBorrar(); });
  await page.getByRole("dialog", { name: "Antes de eliminar tu cuenta" }).waitFor();
  await page.screenshot({ path: "output/playwright/play-before-deletion.png", fullPage: true });
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  if (await page.evaluate(() => window.deletionChoice) !== false) throw Error("Deletion cancel must not continue");
  await page.addScriptTag({ url: `${origin}/src/js/app/ai-report-service.js` });
  await page.evaluate(() => window.LegalAIReports.attach(document.getElementById("answer"), "Respuesta de prueba, sin generación IA."));
  await page.evaluate(() => { window.confirm = () => true; });
  await page.getByRole("button", { name: "Informar de un problema en esta respuesta" }).click();
  await page.getByRole("status").filter({ hasText: "Hemos recibido el aviso" }).waitFor();
  if (reports.length !== 1 || reports[0].response !== "Respuesta de prueba, sin generación IA." || "question" in reports[0]) throw Error("Wrong report payload");
  await page.screenshot({ path: "output/playwright/ai-report-confirmed.png", fullPage: true });
  console.log("PASS: local desktop/mobile/dark Premium, Play management target and in-app AI report. No external network or purchases.");
}
