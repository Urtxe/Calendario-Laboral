const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const contextSource = fs.readFileSync(
  path.join(repoRoot, "src/js/app/play-twa-context.js"),
  "utf8",
);

function loadContext(href, previousSession = new Map()) {
  const location = {
    href,
    origin: "https://balancelaboral.es",
  };
  const historyCalls = [];
  const window = {
    location,
    history: {
      state: null,
      replaceState: (_state, _title, relativeUrl) => {
        historyCalls.push(relativeUrl);
        location.href = new URL(relativeUrl, location.origin).href;
      },
    },
    sessionStorage: {
      getItem: (key) => previousSession.get(key) || null,
      setItem: (key, value) => previousSession.set(key, value),
    },
  };

  vm.runInNewContext(contextSource, { window, URL });
  return { window, previousSession, historyCalls };
}

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`OK  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${error.message}`);
  }
}

check("el marcador nativo activa el contexto y se retira de la URL", () => {
  const result = loadContext(
    "https://balancelaboral.es/calendario?play_twa=1&origen=enlace#resumen",
  );

  assert.strictEqual(result.window.esContextoPlayTwa(), true);
  assert.strictEqual(
    result.previousSession.get("balance_laboral_play_twa_session_v1"),
    "1",
  );
  assert.deepStrictEqual(result.historyCalls, ["/calendario?origen=enlace#resumen"]);
});

check("la navegación interna conserva el contexto solo en la sesión", () => {
  const session = new Map([["balance_laboral_play_twa_session_v1", "1"]]);
  const result = loadContext("https://balancelaboral.es/calendario", session);

  assert.strictEqual(result.window.esContextoPlayTwa(), true);
  assert.deepStrictEqual(result.historyCalls, []);
});

check("la web normal no activa el contexto sin marcador", () => {
  const result = loadContext("https://balancelaboral.es/?origen=web");

  assert.strictEqual(result.window.esContextoPlayTwa(), false);
  assert.strictEqual(result.previousSession.size, 0);
});

check("los puntos directos de comercio consultan el contexto central", () => {
  const ui = fs.readFileSync(path.join(repoRoot, "src/js/app/ui.js"), "utf8");
  const legacyUi = fs.readFileSync(path.join(repoRoot, "src/js/script.js"), "utf8");
  const launcher = fs.readFileSync(
    path.join(
      repoRoot,
      "android/twa/app/src/main/java/es/balancelaboral/app/LauncherActivity.java",
    ),
    "utf8",
  );

  assert.match(ui, /window\.abrirModalPremium[\s\S]*comercioPremiumBloqueadoEnTwa/);
  assert.match(ui, /window\.seleccionarPlan[\s\S]*comercioPremiumBloqueadoEnTwa/);
  assert.match(ui, /window\.redirigirPortalStripe[\s\S]*comercioPremiumBloqueadoEnTwa/);
  assert.match(legacyUi, /window\.seleccionarPlan[\s\S]*window\.esContextoPlayTwa/);
  assert.match(launcher, /PLAY_TWA_CONTEXT_PARAM/);
  assert.match(launcher, /appendQueryParameter\(PLAY_TWA_CONTEXT_PARAM/);
  assert.match(launcher, /TRUSTED_HOST\.equals\(uri\.getHost\(\)\)/);
});

if (failures > 0) {
  process.exit(1);
}

console.log(`\n${4 - failures} comprobaciones de contexto Play TWA pasaron.`);
