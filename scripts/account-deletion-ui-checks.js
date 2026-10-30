const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const ui = fs.readFileSync(path.join(repoRoot, "src/js/app/ui.js"), "utf8");
const legacy = fs.readFileSync(path.join(repoRoot, "src/js/script.js"), "utf8");
const index = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const firebaseJson = fs.readFileSync(path.join(repoRoot, "firebase.json"), "utf8");

assert.match(ui, /fetch\("\/deleteAccount"/);
assert.match(ui, /reauthenticateWithPopup/);
assert.match(ui, /reauthenticateWithCredential/);
assert.match(ui, /account-delete-status/);
assert.match(ui, /Eliminar la cuenta no cancela tu suscripción de Google Play/);
assert.match(ui, /Si tienes una suscripción de Google Play, eliminar la cuenta no la cancela ni detiene sus renovaciones/);
assert.match(ui, /podrías perder el acceso Premium pagado/);
assert.match(ui, /no se reembolsará el tiempo restante/);
assert.match(ui, /https:\/\/play\.google\.com\/store\/account\/subscriptions/);
assert.match(ui, /Gestionar suscripción en Google Play/);
assert.match(ui, /Continuar borrado/);
assert.match(ui, /await refrescarSnapshotPremiumAntesDeBorrar\(user\.uid\)/);
assert.match(ui, /catch \(_\) \{[\s\S]*deletion retries may be unable to read the document/);
assert.match(ui, /suscripcionGooglePlayConocida/);
assert.match(ui, /\["premium_monthly", "premium_yearly"\]\.includes\(play\.productId\)/);
assert.match(ui, /stripe\.active === true/);
assert.match(ui, /window\.datosCuentaPremium = datosCuentaPremium/);
assert.doesNotMatch(ui, /user\s*\.\s*delete\s*\(/);
assert.doesNotMatch(legacy, /user\s*\.\s*delete\s*\(/);
assert.match(index, /data-account-delete-action/);
assert.match(firebaseJson, /"source": "\/deleteAccount"/);

const helperSource = ui.slice(
  ui.indexOf("const PLAY_SUBSCRIPTIONS_URL"),
  ui.indexOf("function aplicarRestriccionComercioPremiumTwa"),
);
function managementLink(snapshot) {
  const links = [];
  const parent = {
    querySelector: () => links[0] || null,
    insertBefore(link) { links.push(link); },
  };
  const action = { parentNode: parent, nextSibling: null };
  const document = {
    querySelectorAll: () => [action],
    createElement: () => ({ dataset: {}, style: {} }),
  };
  const context = { document };
  const helpers = vm.runInNewContext(`${helperSource}\n;({ suscripcionGooglePlayConocida, actualizarEnlaceGestionGooglePlay });`, context);
  helpers.actualizarEnlaceGestionGooglePlay(snapshot);
  return links[0] || null;
}
assert.strictEqual(managementLink({ billing: { stripe: { active: true } } }), null);
const playLink = managementLink({ billing: { googlePlay: { productId: "premium_monthly" } } });
assert.strictEqual(playLink.href, "https://play.google.com/store/account/subscriptions");
assert.strictEqual(playLink.textContent, "Gestionar suscripción en Google Play");
assert.strictEqual(playLink.rel, "noopener noreferrer");

async function checkDeletePlayDialog() {
  const refreshContext = {
    db: { collection: () => ({ doc: () => ({ get: async () => { throw new Error("marker blocks read"); } }) }) },
    document: { querySelectorAll: () => [] },
    window: {},
  };
  const refreshHelpers = vm.runInNewContext(
    `${helperSource}\n;({ refrescarSnapshotPremiumAntesDeBorrar, currentSnapshot: () => datosCuentaPremium });`,
    refreshContext,
  );
  await refreshHelpers.refrescarSnapshotPremiumAntesDeBorrar("user-1");
  assert.strictEqual(Object.keys(refreshHelpers.currentSnapshot()).length, 0);

  function makeDialog() {
    const buttons = {
      "[data-play-delete-cancel]": { addEventListener(_event, handler) { this.click = handler; }, focus() {} },
      "[data-play-delete-continue]": { addEventListener(_event, handler) { this.click = handler; } },
    };
    const modal = {
      style: {},
      listeners: {},
      querySelector(selector) { return buttons[selector]; },
      addEventListener(event, handler) { this.listeners[event] = handler; },
      remove() { this.removed = true; },
    };
    const document = { createElement: () => modal, body: { appendChild() {} } };
    const helperContext = { document };
    const showDialog = vm.runInNewContext(
      `${helperSource}\n;ofrecerGestionGooglePlayAntesDeBorrar;`,
      helperContext,
    );
    return { buttons, modal, showDialog };
  }

  const continueFlow = makeDialog();
  const continueResult = continueFlow.showDialog();
  assert.match(continueFlow.modal.innerHTML, /Gestionar suscripción en Google Play/);
  assert.match(continueFlow.modal.innerHTML, /Continuar borrado/);
  continueFlow.buttons["[data-play-delete-continue]"].click();
  assert.strictEqual(await continueResult, true);
  assert.strictEqual(continueFlow.modal.removed, true);

  const cancelFlow = makeDialog();
  const cancelResult = cancelFlow.showDialog();
  cancelFlow.buttons["[data-play-delete-cancel]"].click();
  assert.strictEqual(await cancelResult, false);
}

checkDeletePlayDialog()
  .then(() => console.log("OK  El cliente reautentica y advierte sobre suscripciones antes del borrado."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
