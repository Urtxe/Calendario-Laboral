# Migración Gemini Flash-Lite — noviembre de 2026

## Estado y alcance

El backend usa `gemini-3.5-flash-lite` por defecto y `thinkingLevel: medium` para respuestas laborales y fallback general. `GEMINI_CONSULTATION_MODEL` y `GEMINI_THINKING_LEVEL` permiten configurar modelo y esfuerzo. Las llamadas tienen timeout de 35 s y un reintento para 429/5xx; un 400 no se reintenta. Se conserva `generateContent`: está disponible para el modelo, la aplicación no utiliza function calling cliente y no guarda historial de objetos `Content` con `thoughtSignature`. La sesión cliente conserva la referencia, provincia y sector del convenio seleccionado.

Functions usa Node.js `24.22.1`; el runtime observado en la función desplegada `consultarConvenio` es Node.js 24. El SDK `@google/genai` se fija en `2.32.0`, que requiere Node.js 20 o posterior y es compatible con Node 24. La consola local usa Firebase CLI 15.4.0; las notas oficiales de Firebase CLI documentan soporte para `nodejs24` desde la versión 14.26.0. La guía general de Firebase Functions aún enumera Node 22/20, aunque Cloud Run functions publica Node 24. No se cambia el runtime existente. El adaptador conserva el contrato de salida usado por el asesor y desactiva la continuación automática para evitar llamadas adicionales fuera de los límites controlados por la aplicación.

La consulta y el ingestor usan `models.embedContent` con `gemini-embedding-001`, tareas de recuperación existentes y dimensión 768. La migración no modificó documentos ni vectores y no ejecutó ingestas. El código futuro de ingesta usa el SDK nuevo, pero no se ha desplegado ni ejecutado.

El Agente de Instagram usa `gemini-3.5-flash-lite`, `thinking_level=minimal` por defecto, salida JSON estructurada, sin `temperature`, `top_p` ni `thinking_budget`. Su validación real está descrita abajo; no se publicó contenido.

## Validación local

- `node gemini-client.test.js`: solicitud `GenerateContent`, salida estructurada, `thinkingLevel`, respuesta `MAX_TOKENS`, 429 y 503 con un solo reintento, 400 sin reintento, y embeddings de 768 dimensiones.
- `node --test convenio-ingestion.test.js convenio-document-processor.test.js conversation-context.test.js rag-evidence.test.js convenio-metadata.test.js`: 22 pruebas pasaron.
- `node ai-consultation.test.js`: 17 comprobaciones pasaron, incluidas cuotas Free/Premium y reservas/devoluciones.
- `npm run test:security`: 13 comprobaciones pasaron.
- `node --check` de `index.js`, ingestor, cliente y prueba en vivo: pasó.

## Prueba RAG real, solo lectura

`npm run test:gemini-live` lee el catálogo y chunks actuales de Firestore, genera embeddings de consulta temporales y realiza llamadas reales al modelo. No escribe Firestore. La prueba necesita `GEMINI_LIVE_TEST=1` y una clave `GEMINI_API_KEY` en el entorno; su salida no imprime secretos.

- **Limpieza Barcelona:** seleccionó únicamente las tablas verificadas 2026 de Barcelona. Las cuatro fechas fueron correctas: 01/01–31/08 y 01/09–31/12. La edición local 2025 quedó bloqueada como `source_unverified`; no se mezcló Tarragona. `minimal`, `low` y `medium` terminaron en `STOP`, citaron el PDF y concordaron. Latencias: 0,7–2,0 s.
- **Hostelería Málaga, salarios 2026:** `hasUnindexedSalaryEvidence` bloqueó la generación antes de recuperar/generar importes. El handler produce respuesta `unconfirmed`, sin fuentes, con `quotaConsumed=false`. No se llamó a Gemini para este caso.
- **Transporte Navarra:** el documento histórico resultó `source_unverified`; no se recuperaron sus chunks ni se llamó a Gemini.
- **Tres turnos de Hostelería Málaga:** se mantuvo el identificador seleccionado desde la primera consulta; se respondió 30 días naturales de vacaciones y 1.800 horas anuales, con citas a los chunks del convenio de Málaga.
- Las seis generaciones usaron 12.358 tokens de entrada y 2.845 tokens de salida/razonamiento. A precios públicos de pago, coste estimado de generación: USD 0,01082. Límite superior estimado para embeddings de consulta: USD 0,00015. Coste conjunto estimado: menos de USD 0,011; no se consultó la factura. No hubo respuestas `MAX_TOKENS` ni reintentos en las llamadas de esta pasada.

La prueba integra Firestore RAG real y Gemini real. No llama al endpoint HTTP autenticado, porque el handler reserva y liquida cuotas productivas. Por tanto, no se declara E2E de Auth/cuota; esas rutas se validan con pruebas locales. No se usaron usuarios temporales ni se alteraron cuotas.

## Agente Instagram

En un entorno Python temporal aislado con `google-genai 2.34.0`, `minimal` y `low` produjeron JSON/caption válidos (489/66 y 485/65 tokens; 2,1/1,2 s). `medium` terminó en `MAX_TOKENS` y el reparador devolvió un fallback válido (485 de entrada, 769 de razonamiento y 16 de salida; 2,8 s). Para captions se mantiene `minimal`; el test no publicó contenido ni modificó el repositorio.

## Publicación y rollback

### Fuente real de producción (lectura de Google Cloud, 4 de noviembre de 2026)

La revisión activa `us-central1/consultarConvenio` es `consultarconvenio-00054-wot`, estado `Ready`, 100 % de tráfico. Usa Node.js `24.22.1`, timeout 90 s, 512 MiB, concurrency 20, máximo de 10 instancias, cuenta `130172535764-compute@developer.gserviceaccount.com` y el secreto `GEMINI_API_KEY` versión 1. El código desplegado usa `@google/generative-ai` 0.24.1 y `gemini-2.5-flash`; no tiene overrides de modelo ni thinking level.

La fuente de Functions de Cloud Build `99bd31fd-c339-4572-a816-f6cfd6946c0e` es `gs://gcf-v2-sources-130172535764-us-central1/consultarConvenio/function-source.zip`, generación `1793554606052336` (24.466.747 bytes). La imagen activa es `us-central1-docker.pkg.dev/calendario-laboral-252b1/gcf-artifacts/calendario--laboral--252b1__us--central1__consultar_convenio@sha256:0582bb598e28dd702f71f98c61c658714baa99348587495e7b6c0a5e933f5fd5`.

El contenido de los 54 archivos versionados de `functions/` coincide con el commit `f4b745c0c2451eef5d01ad1eaaed6f5d3c96ade7` tras normalizar CRLF/LF. El commit está fechado cinco minutos antes del build. No afirmo identidad de todo el ZIP: también contiene archivos de entorno no versionados, inventario generado y PDFs de `convenios/processed`; el entrypoint de la Function no lee esos PDFs y el RAG lee Firestore. La configuración efectiva de entorno y el secreto se verificaron aparte en la revisión de Cloud Run.

### Recuperación compatible preparada y validada

Creé el worktree local `C:\Users\mikel\AppData\Local\Temp\balance-recovery-flashlite-00054`, rama `recovery/consultarconvenio-flashlite-prod-00054`, con base exacta `f4b745c` y solo el parche de migración `eb33e51` aplicado. El commit de código de recuperación es `925475f`; los commits de validación son `1a318db` y `9227362`. Mantiene el SDK heredado 0.24.1 que ya usa producción; añade el adaptador de timeout/reintento y configuración del modelo, selecciona `gemini-3.5-flash-lite` con thinking level `medium`, y actualiza tanto la llamada Gemini de asesoría como el fallback REST oficial. El uso de `gemini-embedding-001`, dimensión 768, índice y chunks permanece intacto.

El diff del candidato no cambia autenticación, validación de payload, cuotas Free/Premium, recuperación RAG, selección de documentos, turnos de contexto, exports de funciones ni dependencias npm. No incorpora los cambios posteriores de `e0c3076` en contexto conversacional ni los cambios de programación de tareas. La comparación contra `e0c3076` explica la antigua discrepancia de fuentes: las diferencias funcionales son `conversation-context.js`, partes de `index.js` (Gemini y programación), y `official-web-fallback.js`; `package.json` añade/cambia scripts de despliegue de tareas. El candidato no arrastra esos cambios. Los adaptadores/configuración Gemini y sus pruebas son los archivos nuevos estrictamente necesarios.

La prueba se ejecutó en Node `24.22.1`, con las dependencias fijadas por el lockfile de producción (`@google/generative-ai` 0.24.1, `firebase-functions` 7.2.5, `firebase-admin` 13.10.0). `require('./index')` cargó y exportó `consultarConvenio` correctamente.

Pruebas locales del worktree de recuperación:

- `node --test`: 140 pasaron, 0 fallaron, incluidos auth, seguridad, cuotas, contexto, RAG, facturación y el fallback REST.
- `node gemini-client.test.js` y `node gemini-config.test.js`: timeout/reintento limitado, 400 sin reintento, 429/5xx, configuración de modelo y thinking level.
- `node --test functions/official-web-fallback.test.js`: modelo, URL REST, thinking level, respuesta grounded y filtro de dominio oficial pasaron con fetch simulado.
- `npm run test:security`: 13 comprobaciones pasaron; Auth y App Check se validan antes de cuota/IA, y se mantienen las barreras de privacidad.
- `node --check` y carga real del entrypoint Node 24: pasaron.
- `node scripts/build-convenio-monitor-inventory.js`: predeploy local pasó y generó el inventario esperado (28 fichas); no ejecutó llamadas de escritura a Google Cloud.

Prueba real del candidato con el harness guardado en `scripts/gemini-recovery-live-check.js`: cuatro pasadas RAG (seis generaciones cada una) y dos consultas reales al fallback REST con Google Search. Total: 50.783 tokens de entrada y 11.827 de salida/razonamiento; coste estimado de generación USD 0,04480, embeddings como máximo USD 0,00060 y grounding como máximo USD 0,028; total estimado USD 0,07341, dentro del límite de USD 0,25. Las consultas a Firestore fueron de solo lectura; no se invocó el endpoint autenticado ni se reservaron cuotas de usuarios. Las generaciones y el fallback acabaron en `STOP`, sin `MAX_TOKENS` ni reintentos. Google Search devolvió título oficial `boe.es` y fuente grounding verificada por el allowlist:

- **Barcelona:** resolvió las tablas de Barcelona 2026, citó el PDF correcto y separó 01/01–31/08 y 01/09–31/12; no mezcló Tarragona. La edición 2025 quedó bloqueada como `source_unverified`. Se probó `minimal`, `low` y `medium`; los tres resultados fueron correctos.
- **Málaga salarios:** la barrera de evidencia incompleta bloqueó la generación de importes; no inventó salarios ni consumió cuota.
- **Navarra transporte:** la fuente histórica quedó `source_unverified`; no se recuperaron chunks.
- **Conversación Málaga:** mantuvo el mismo convenio durante tres turnos; respondió 30 días naturales y 1.800 horas anuales con citas a los PDF de Málaga.
- **Fallback web:** aceptó `thinkingLevel: medium`, devolvió respuesta y título oficial `boe.es`; el helper conservó su lista de dominios permitidos.

Esto valida Gemini real, recuperación RAG real y el candidato SDK heredado; no es una prueba HTTP E2E de Auth/cuotas. Esos controles se validaron con la suite local y seguridad.

**Decisión: GO para un despliegue controlado de `consultarConvenio`, pendiente de autorización del usuario.** Hay una reversión inmediata verificada mientras el modelo 2.5 siga operativo y una recuperación reconstruible, basada en la fuente real de producción y validada con Flash-Lite para después del aviso. No se hizo deploy ni se cambió tráfico.

Riesgo preexistente observado: el lockfile sin cambios produce `npm audit` con 17 vulnerabilidades en dependencias de producción (10 moderadas, 5 altas y 2 críticas; varias admiten solución con una actualización mayor de `firebase-admin`). No las introdujo el candidato ni se actualizaron dependencias en este trabajo; requieren seguimiento de seguridad separado y el GO anterior se refiere a la migración Gemini, no a una certificación global del proyecto.

### Mecanismo A: rollback inmediato a la revisión de producción

Cloud Run confirma que `consultarconvenio-00054-wot` existe, está `Ready` y recibe todo el tráfico. Antes del 1 de diciembre de 2026, el rollback de tráfico es:

```powershell
gcloud run services update-traffic consultarconvenio --to-revisions consultarconvenio-00054-wot=100 --region us-central1 --project calendario-laboral-252b1
gcloud run services describe consultarconvenio --region us-central1 --project calendario-laboral-252b1 --format='yaml(status.latestReadyRevisionName,status.traffic)'
```

No ejecuté el comando porque cambiar tráfico productivo está expresamente prohibido en esta etapa. La sintaxis se contrastó con la documentación de Cloud Run. Esta revisión vuelve al SDK y modelo de producción (2.5 Flash) y a la binding de secreto v1. **No usarla después de la fecha del aviso**; desde entonces usar el mecanismo B.

### Mecanismo B: reconstruir el comportamiento de producción con Flash-Lite

El worktree validado ya está creado localmente. Para reconstruirlo desde el repositorio si se elimina, y luego desplegar solo la Function tras recibir autorización:

```powershell
$repo = 'C:\APLICACIONES\Mikel\CalendarioLaboralFireBase'
$recovery = Join-Path $env:TEMP 'balance-recovery-flashlite-00054'
if (-not (Test-Path -LiteralPath $recovery)) {
  git -C $repo worktree add --detach $recovery recovery/consultarconvenio-flashlite-prod-00054
}
foreach ($name in @('.env', '.env.calendario-laboral-252b1')) {
  $source = Join-Path (Join-Path $repo 'functions') $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path (Join-Path $recovery 'functions') $name)
  }
}
Push-Location (Join-Path $recovery 'functions')
npm ci --ignore-scripts
node --test
node gemini-client.test.js
node gemini-config.test.js
npm run test:security
Pop-Location
Push-Location $recovery
$env:GEMINI_LIVE_TEST = '1'
$env:GEMINI_API_KEY = (gcloud secrets versions access 1 --secret GEMINI_API_KEY --project calendario-laboral-252b1)
if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer GEMINI_API_KEY versión 1.' }
try { node scripts/gemini-recovery-live-check.js; $liveExit = $LASTEXITCODE }
finally { Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue; Remove-Item Env:GEMINI_LIVE_TEST -ErrorAction SilentlyContinue }
if ($liveExit -ne 0) { throw 'La prueba real RAG/Flash-Lite falló.' }
Pop-Location
Push-Location $recovery
firebase deploy --only functions:consultarConvenio --project calendario-laboral-252b1
Pop-Location
```

Este deploy crea una nueva revisión con la lógica base de producción y Flash-Lite; no cambia documentos, vectores ni el secreto. Requiere reconstrucción, así que no es instantáneo. Si el despliegue principal falla después del 1 de diciembre, esta es la recuperación compatible; no enrutar tráfico a 00054. Tampoco resolverá una indisponibilidad o regresión propia del modelo Flash-Lite; no se ha añadido un segundo modelo generativo sin pruebas y autorización.

### Deploy selectivo y validación posterior

El deploy principal también debe usar exclusivamente:

```powershell
firebase deploy --only functions:consultarConvenio --project calendario-laboral-252b1
```

El proyecto predeterminado coincide con `.firebaserc`; Firebase CLI 15.4.0 y `firebase.json` seleccionan una única codebase con runtime Node 24. El `predeploy` genera un inventario local y no opera en Google Cloud. Con el selector `--only`, no se despliegan Hosting, reglas, índices, otras Functions, Auth, Android, ingesta ni Instagram. La CLI mantiene la binding declarada de `GEMINI_API_KEY`; no rota el secreto. Firebase documenta este selector para desplegar funciones individuales.

Guardar antes y después estas salidas (no imprimir valores secretos):

```powershell
$project = 'calendario-laboral-252b1'
gcloud functions describe consultarConvenio --gen2 --region us-central1 --project $project --format='yaml(name,state,updateTime,buildConfig.runtime,buildConfig.entryPoint,serviceConfig.uri,serviceConfig.timeoutSeconds,serviceConfig.availableMemory,serviceConfig.maxInstanceCount,serviceConfig.secretEnvironmentVariables)'
gcloud run services describe consultarconvenio --region us-central1 --project $project --format='yaml(status.latestReadyRevisionName,status.traffic)'
gcloud functions list --project $project --format='table(name,updateTime)'
gcloud secrets versions list GEMINI_API_KEY --project $project --format='table(name,state,createTime)'
```

Confirmar nueva revisión `Ready`, 100 % de tráfico, secreto versión 1 y que los `updateTime` de las demás Functions no cambiaron. Revisar logs de la revisión y disponibilidad del modelo. Para humo HTTP/cuota, usar únicamente una cuenta de prueba designada; no crear usuarios ni cargar consultas a usuarios reales. Verificar una cita y convenio correcto, una respuesta protegida por la barrera de evidencia y el saldo de cuota de esa cuenta de prueba. Si falla alguna comprobación, aplicar A antes del 1 de diciembre o B a partir de esa fecha.

Para localizar errores de runtime y respuestas HTTP fallidas de la nueva revisión (sustituir `NEW_REVISION` por el nombre devuelto por Cloud Run):

```powershell
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="consultarconvenio" AND resource.labels.revision_name="NEW_REVISION" AND severity>=ERROR' --project calendario-laboral-252b1 --limit 50 --format='table(timestamp,severity,logName)'
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="consultarconvenio" AND resource.labels.revision_name="NEW_REVISION" AND httpRequest.status>=400' --project calendario-laboral-252b1 --limit 50 --format='table(timestamp,httpRequest.status,severity)'
```

Referencias: [deploy selectivo de Functions](https://firebase.google.com/docs/functions/manage-functions), [rollback de tráfico Cloud Run](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration), [Gemini 3.5 Flash-Lite y capacidades](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [thinking levels de GenerateContent](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [precios Gemini API](https://ai.google.dev/gemini-api/docs/pricing).
