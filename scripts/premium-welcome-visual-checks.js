// Serve the repo at 127.0.0.1:8765 and run via playwright-cli run-code --filename.
// Auth, provider catalogs and navigation are mocked; all external traffic is blocked.
async (page) => {
  const origin = "http://127.0.0.1:8765";
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/__welcome_check") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/css/main.css"><link rel="stylesheet" href="/src/css/components/_analytics-consent.css"><body><main id="app-container" style="padding:24px"><h1>Balance Laboral</h1></main><div style="display:none"><section role="dialog">Asesor cerrado</section></div></body></html>' });
    return route.continue();
  });
  const index = await (await page.request.get(origin + "/index.html")).text();
  if (/premium-history-preview|EJEMPLO ILUSTRATIVO|Cifras ficticias/.test(index)) throw new Error("History example remains in the app");
  async function setup(options = {}) {
    await page.goto(origin + "/__welcome_check");
    await page.evaluate(({ index, options }) => {
      sessionStorage.clear();
      const source = new DOMParser().parseFromString(index, "text/html");
      for (const id of ["auth-modal", "modal-pricing", "analytics-consent"]) {
        const node = source.getElementById(id);
        if (!node) throw new Error("Missing app fixture: " + id);
        document.body.appendChild(document.importNode(node, true));
      }
      document.getElementById("analytics-consent").hidden = !options.consent;
      window.APP_CONFIG = { stripeTrialEnabled: true };
      window.usuarioActual = options.uid ? { uid: options.uid } : null;
      window.esPremium = options.premium === true;
      window.BALANCE_LABORAL_PREMIUM_STATUS = { uid: options.uid || null, premium: options.premium === true, ready: options.ready !== false };
      window.usuarioTieneSesion = () => Boolean(window.usuarioActual);
      window.usuarioPuedeUsarPremium = () => window.esPremium;
      window.comercioPremiumBloqueadoEnTwa = () => options.twa === true;
      window.esContextoPlayTwa = () => options.twa === true;
      window.testCalls = { register: [], plans: [] };
      window.mostrarRegistro = source => { window.testCalls.register.push(source); document.getElementById("auth-modal").style.display = "flex"; };
      window.abrirModalPremium = trigger => { window.testCalls.plans.push(trigger); document.getElementById("modal-pricing").style.display = "flex"; };
      window.PlayBillingService = { getTrialAvailability: async () => options.playTrial === true };
      window.testStatus = state => {
        window.usuarioActual = state.uid ? { uid: state.uid } : null;
        window.esPremium = state.premium;
        window.BALANCE_LABORAL_PREMIUM_STATUS = state;
        window.dispatchEvent(new CustomEvent("balance-premium-status", { detail: state }));
      };
    }, { index, options });
    await page.addScriptTag({ url: origin + "/src/js/app/premium-upsell.js" });
  }
  const offer = () => page.getByRole("dialog", { name: "7 días gratis de Premium" });
  await setup({ consent: true });
  if (await offer().count()) throw new Error("Welcome overlaid the consent choice");
  await page.locator('#analytics-consent [data-analytics-consent="denied"]').click();
  await page.evaluate(() => { document.getElementById("analytics-consent").hidden = true; });
  await offer().waitFor();
  await page.getByRole("button", { name: "Crear cuenta y ver la prueba" }).click();
  if (await page.evaluate(() => window.testCalls.register[0]) !== "premium_offer") throw new Error("Anonymous CTA bypassed registration");
  await page.evaluate(() => window.testStatus({ uid: "new-local-user", premium: false, ready: false }));
  await page.evaluate(() => window.testStatus({ uid: "new-local-user", premium: false, ready: true }));
  if (await page.evaluate(() => window.testCalls.plans.length)) throw new Error("Plans overlaid registration");
  await page.evaluate(() => { document.getElementById("auth-modal").style.display = "none"; });
  await page.waitForFunction(() => window.testCalls.plans.length === 1);
  await page.evaluate(() => { document.getElementById("modal-pricing").style.display = "none"; window.testStatus({ uid: "new-local-user", premium: false, ready: true }); });
  if (await offer().count()) throw new Error("Welcome repeated in the same session");

  for (const [name, width, height, dark] of [["desktop",1280,900,false],["mobile",390,844,false],["dark",390,844,true]]) {
    await page.setViewportSize({ width, height });
    await setup({ uid: "free-local-user" });
    await page.evaluate(dark => document.body.classList.toggle("dark-mode", dark), dark);
    await offer().waitFor();
    if (!await offer().getByText("5 consultas IA al mes", { exact: true }).isVisible()) throw new Error("Free monthly limit missing");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overflow = await page.evaluate(() => {
      const node = document.querySelector(".premium-welcome-dialog");
      return node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > innerWidth + 1;
    });
    if (overflow) throw new Error("Welcome overflow: " + name);
    await page.screenshot({ path: `output/playwright/premium-welcome-${name}.png` });
    await page.keyboard.press("Escape");
  }
  await setup({ uid: "premium-local-user", ready: false });
  if (await offer().count()) throw new Error("Unverified account was targeted");
  await page.evaluate(() => window.testStatus({ uid: "premium-local-user", premium: true, ready: true }));
  if (await offer().count()) throw new Error("Premium user was targeted");
  await setup({ twa: true, playTrial: true });
  await offer().waitFor();
  await setup({ twa: true, playTrial: false });
  await page.getByRole("dialog", { name: "Más control con Premium" }).waitFor();
  if (await offer().count()) throw new Error("Non-offered Play trial was advertised");
  return { anonymous: true, free: true, premiumExcluded: true, consentDeferred: true, signupHandoff: true, oncePerSession: true, mobileDark: true, playCatalog: true, purchases: false };
}
