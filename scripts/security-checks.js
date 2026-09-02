const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const checks = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function normalize(source) {
  return source.replace(/\r\n/g, "\n");
}

function addCheck(name, fn) {
  checks.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, expected, message) {
  assert(source.includes(expected), message || `No se encontro: ${expected}`);
}

function assertOrder(source, orderedTokens, message) {
  let previousIndex = -1;

  for (const token of orderedTokens) {
    const index = source.indexOf(token, previousIndex + 1);
    assert(index !== -1, `${message}: no se encontro "${token}"`);
    assert(index > previousIndex, `${message}: "${token}" esta fuera de orden`);
    previousIndex = index;
  }
}

function extractConsultarConvenioHandler(source) {
  const startToken = "exports.consultarConvenio = onRequest";
  const start = source.indexOf(startToken);
  assert(start !== -1, "No se encontro el handler consultarConvenio");

  const nextHandler = source.indexOf("\nasync function consultarConvenioLegacy", start + startToken.length);
  return nextHandler === -1 ? source.slice(start) : source.slice(start, nextHandler);
}

function extractExportHandler(source, exportName) {
  const startToken = `exports.${exportName} = onRequest`;
  const start = source.indexOf(startToken);
  assert(start !== -1, `No se encontro el handler ${exportName}`);

  const nextExport = source.indexOf("\nexports.", start + startToken.length);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

function assertReservedFieldsListed(rules, fields) {
  for (const field of fields) {
    assertIncludes(
      rules,
      `"${field}"`,
      `firestore.rules debe declarar "${field}" como campo reservado o permitido de forma controlada`,
    );
  }
}

function assertFrontendDoesNotWriteReservedFields(relativePath, fields) {
  const source = read(relativePath);
  const writeCallPattern = /\.(set|update|add)\s*\(/g;
  let match;

  while ((match = writeCallPattern.exec(source)) !== null) {
    const snippet = source.slice(match.index, match.index + 1200);

    for (const field of fields) {
      const writePattern = new RegExp(`(["']?${field}["']?)\\s*:`);
      assert(
        !writePattern.test(snippet),
        `${relativePath} no debe escribir el campo reservado "${field}" en llamadas Firestore`,
      );
    }
  }
}

const reservedUserFields = [
  "tipoCuenta",
  "stripeCustomerId",
  "subscriptionId",
  "subscriptionStatus",
  "billing",
  "billingStatus",
  "role",
  "admin",
  "isPremium",
  "premium",
  "createdAt",
  "updatedBillingAt",
  "stripeSubscriptionId",
  "stripePriceId",
  "stripeProductId",
  "stripeCurrentPeriodEnd",
  "stripeCancelAtPeriodEnd",
];

addCheck("Firestore bloquea campos premium/billing/admin en usuarios/{uid}", () => {
  const rules = normalize(read("firestore.rules"));

  assertIncludes(rules, "function camposReservadosUsuario()");
  assertReservedFieldsListed(rules, reservedUserFields);
  assertIncludes(
    rules,
    "request.resource.data.keys().hasOnly(camposEditablesUsuario())",
    "La creacion del documento usuario debe limitarse a campos editables",
  );
  assertIncludes(
    rules,
    "request.resource.data.keys().hasOnly(camposPermitidosDocumentoUsuario())",
    "La actualizacion del documento usuario debe rechazar campos arbitrarios",
  );
  assertIncludes(
    rules,
    "&& camposReservadosSinCambios()",
    "La actualizacion del documento usuario debe impedir cambios en campos reservados",
  );
});

addCheck("Firestore impide escritura cliente en usuarios/{uid}/usage/ai", () => {
  const rules = normalize(read("firestore.rules"));

  assertIncludes(rules, "match /usage/{usageDoc}");
  assertIncludes(
    rules,
    "allow write: if false;",
    "La subcoleccion usage no debe ser escribible desde cliente",
  );
});

addCheck("Frontend no escribe tipoCuenta ni campos billing/admin", () => {
  const frontendFiles = [
    "src/js/app/sync.js",
    "src/js/firebase-config.js",
    "src/js/script.js",
  ];

  for (const file of frontendFiles) {
    assertFrontendDoesNotWriteReservedFields(file, reservedUserFields);
  }
});

addCheck("/consultarConvenio exige Firebase Auth antes de cuota o IA", () => {
  const functionsSource = normalize(read("functions/index.js"));
  const handler = extractConsultarConvenioHandler(functionsSource);

  assertIncludes(functionsSource, "admin.auth().verifyIdToken(idToken)");
  assertIncludes(handler, "return res.status(401).json({ error: \"Debes iniciar sesión para usar la consulta IA\" });");
  assertOrder(
    handler,
    [
      "const authResult = await verificarUsuarioConsulta(req);",
      "if (!await reservarCuota()) return;",
      "const vectorPregunta = await generarEmbeddingPregunta(pregunta);",
    ],
    "Auth debe ocurrir antes de cuota y embeddings",
  );
});

addCheck("/consultarConvenio valida payload antes de Auth, cuota e IA", () => {
  const handler = extractConsultarConvenioHandler(normalize(read("functions/index.js")));

  assertIncludes(handler, "const payloadValidation = validarPayloadBasicoConsulta(req);");
  assertIncludes(handler, "return res.status(payloadValidation.status).json({ error: payloadValidation.error });");
  assertOrder(
    handler,
    [
      "const payloadValidation = validarPayloadBasicoConsulta(req);",
      "const authResult = await verificarUsuarioConsulta(req);",
      "if (!await reservarCuota()) return;",
    ],
    "La validacion basica de payload debe cortar antes de Auth, cuota e IA",
  );
  assertOrder(
    handler,
    [
      "const preguntaValidation = validarPreguntaConsulta(payloadValidation.body);",
      "if (!await reservarCuota()) return;",
    ],
    "La validacion de pregunta debe cortar antes de cuota e IA",
  );
});

addCheck("Cuota IA se reserva antes de embeddings/Gemini y se liquida después", () => {
  const handler = extractConsultarConvenioHandler(normalize(read("functions/index.js")));

  assertOrder(
    handler,
    [
      "if (!await reservarCuota()) return;",
      "const vectorPregunta = await generarEmbeddingPregunta(pregunta);",
    ],
    "La cuota debe reservarse antes de iniciar RAG/embeddings",
  );
  assertIncludes(handler, "liquidarReservaCuotaIA(quotaInfo, { consume: false })");
  assertIncludes(handler, "liquidarReservaCuotaIA(quotaInfo, { consume: true })");
});

addCheck("Las aclaraciones no reservan cuota y toda respuesta útil declara procedencia", () => {
  const handler = extractConsultarConvenioHandler(normalize(read("functions/index.js")));
  assertOrder(
    handler,
    [
      "if (CLARIFICATION_STATUSES.has(resolucionCatalogo.status) && requiereContextoConvenio)",
      "return res.status(200).json(payload);",
      "if (!await reservarCuota()) return;",
    ],
    "Una aclaracion debe salir antes de reservar cuota",
  );
  assertIncludes(handler, "sourceType: \"convenio\"");
  assertIncludes(handler, "sourceType: \"official_web\"");
  assertIncludes(handler, "sourceType: \"general_ai\"");
  assertIncludes(handler, "sourceType: \"clarification\"");
  assertIncludes(handler, "if (!esLaboral)");
  assertOrder(
    handler,
    ["if (!esLaboral)", "generarRespuestaGeneral({ pregunta, idiomaRespuesta, esLaboral: false })", "const vectorPregunta = await generarEmbeddingPregunta(pregunta);"],
    "Las preguntas no laborales deben ir a IA general sin RAG",
  );
});

addCheck("La ruta laboral prioriza convenio, fuente oficial y después IA general", () => {
  const handler = extractConsultarConvenioHandler(normalize(read("functions/index.js")));
  assertOrder(
    handler,
    [
      "if (evidencia.suficiente)",
      "webFallbackResponse = await intentarFallbackWebOficial({",
      "generarRespuestaGeneral({ pregunta, idiomaRespuesta, esLaboral: true })",
    ],
    "La jerarquia debe ser convenio -> web oficial -> IA general",
  );
  assertIncludes(handler, "generarRespuestaGeneral({ pregunta, idiomaRespuesta, esLaboral: false })");
});

addCheck("El fallback web se activa por defecto y mantiene apagado explícito", () => {
  const fallbackSource = normalize(read("functions/official-web-fallback.js"));
  assertIncludes(fallbackSource, "env.ENABLE_WEB_FALLBACK ?? \"true\"");
  assertIncludes(fallbackSource, '!== "false"');
});

addCheck("CORS allowlist corta origenes no permitidos antes de cuota o IA", () => {
  const functionsSource = normalize(read("functions/index.js"));
  const handler = extractConsultarConvenioHandler(functionsSource);

  assertIncludes(functionsSource, "CONSULTAR_CONVENIO_ALLOWED_ORIGINS");
  assertIncludes(functionsSource, "\"https://balancelaboral.es\"");
  assertIncludes(functionsSource, "\"https://www.balancelaboral.es\"");
  assertIncludes(functionsSource, "\"https://calendario-laboral-252b1.web.app\"");
  assertIncludes(functionsSource, "\"https://calendario-laboral-252b1.firebaseapp.com\"");
  assertIncludes(functionsSource, "CONSULTAR_CONVENIO_DEV_ORIGIN_PATTERN");
  assertIncludes(functionsSource, "Access-Control-Allow-Headers\", \"Content-Type, Authorization, X-Firebase-AppCheck\"");
  assertIncludes(functionsSource, "res.set(\"Vary\", \"Origin\")");
  assertIncludes(functionsSource, "res.set(\"Access-Control-Allow-Origin\", origin)");
  assertIncludes(handler, "return res.status(403).json({ error: \"Origen no permitido\" });");
  assertOrder(
    handler,
    [
      "const corsResult = setCorsHeaders(req, res);",
      "return res.status(403).json({ error: \"Origen no permitido\" });",
      "const payloadValidation = validarPayloadBasicoConsulta(req);",
      "if (!await reservarCuota()) return;",
    ],
    "CORS debe evaluarse antes de payload, cuota e IA",
  );
});

addCheck("/deleteAccount exige sesion reciente y solo borra el UID autenticado", () => {
  const functionsSource = normalize(read("functions/index.js"));
  const handler = extractExportHandler(functionsSource, "deleteAccount");

  assertIncludes(handler, "verifyRecentAuthenticatedUser({");
  assertIncludes(handler, "idToken: extraerBearerToken(req)");
  assertIncludes(handler, "uid: authResult.uid");
  assertIncludes(handler, "deleteAccountSafely({");
  assertOrder(
    handler,
    [
      "const authResult = await verifyRecentAuthenticatedUser({",
      "if (!authResult.ok)",
      "const billing = await deleteAccountSafely({",
      "uid: authResult.uid",
    ],
    "El borrado debe validar una sesion reciente antes de operar sobre el UID autenticado",
  );
});

addCheck("/admin/metricas exige claim admin y no consulta Firestore", () => {
  const functionsSource = normalize(read("functions/index.js"));
  const metricsSource = normalize(read("functions/metrics-ga4.js"));
  const analyticsSource = normalize(read("src/js/analytics.js"));

  assertIncludes(functionsSource, "exports.metricasGa4 = onRequest");
  assertIncludes(functionsSource, "secrets: [ga4PropertyId]");
  assertIncludes(metricsSource, "decoded.admin !== true");
  assertIncludes(metricsSource, "return res.status(403)");
  assert(!metricsSource.includes("firestore") && !metricsSource.includes("visitasAnonimas"), "El endpoint de métricas no debe leer Firestore");
  assert(!analyticsSource.includes("visitasAnonimas") && !analyticsSource.includes(".collection("), "La analítica cliente no debe registrar visitas en Firestore");
  assertIncludes(normalize(read("firestore.rules")), "match /visitasAnonimas/{docId} {\n      allow read, write: if false;", "La colección heredada no debe aceptar nuevas visitas");
});

let failures = 0;

for (const check of checks) {
  try {
    check.fn();
    console.log(`OK  ${check.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.name}`);
    console.error(`     ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} comprobacion(es) de seguridad fallaron.`);
  process.exit(1);
}

console.log(`\n${checks.length} comprobaciones de seguridad pasaron.`);
