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

### Evidencia de producción (consulta de solo lectura, 4 de noviembre de 2026)

En el proyecto `calendario-laboral-252b1`, la función activa es `us-central1/consultarConvenio`, generación 2, runtime `nodejs24`, entrada `consultarConvenio`. Su revisión lista para recibir tráfico era `consultarconvenio-00054-wot`, con 100 % del tráfico, actualizada el 1 de noviembre de 2026. La imagen terminaba en el digest `sha256:0582bb598e28dd702f71f98c61c658714baa99348587495e7b6c0a5e933f5fd5`; usa timeout de 90 s, 512 MiB, máximo de 10 instancias y la cuenta de servicio predeterminada de Functions.

Se inspeccionó el archivo de fuente asociado a la revisión activa y también el de `consultarconvenio-00053-fim`. Ambas fuentes usan `@google/generative-ai` 0.24.1 y `gemini-2.5-flash`. La revisión 54 enlaza `GEMINI_API_KEY` a la versión 1 de Secret Manager. No tiene overrides de `GEMINI_CONSULTATION_MODEL` ni `GEMINI_THINKING_LEVEL`; aplica los valores predeterminados de su código.

**No hacer rollback de tráfico a 00054 o 00053 después de la fecha de retirada indicada en el aviso recibido.** Esas imágenes restauran Gemini 2.5 Flash y no son una recuperación compatible con Flash-Lite. Aunque la página pública de obsolescencias de Gemini no anuncia actualmente una fecha global de cierre para Gemini 2.5 Flash, este procedimiento trata el aviso específico del proyecto como vinculante. Un cambio de tráfico de Cloud Run solo enruta a la imagen antigua; no valida dependencias ni comportamiento externo.

`e0c3076` es una recuperación de código probada para conservar `gemini-3.5-flash-lite` con el SDK heredado, **no** es una copia equivalente de la fuente desplegada en 00054. La comparación encontró cambios de código y datos de recursos entre ambos árboles. Sí pasó las pruebas locales de cliente, RAG y seguridad, y una consulta real de solo lectura con embeddings actuales, índice Firestore productivo y Flash-Lite. Es, por tanto, una opción de recuperación compatible con el aviso, pero requiere una nueva compilación y despliegue y no es una reversión instantánea de revisión. No recuperará un fallo causado por el propio modelo o por sus respuestas.

### Alcance y precondiciones

Antes y después del despliegue, guardar las salidas de estos comandos en el expediente del cambio. No mostrar ni copiar el valor del secreto:

```powershell
$project = 'calendario-laboral-252b1'
gcloud functions describe consultarConvenio --gen2 --region us-central1 --project $project --format='yaml(name,state,updateTime,buildConfig.runtime,buildConfig.entryPoint,serviceConfig.uri,serviceConfig.timeoutSeconds,serviceConfig.availableMemory,serviceConfig.maxInstanceCount,serviceConfig.secretEnvironmentVariables)'
gcloud run services describe consultarconvenio --region us-central1 --project $project --format='yaml(status.latestReadyRevisionName,status.traffic)'
gcloud functions list --project $project --format='table(name,updateTime)'
gcloud secrets versions list GEMINI_API_KEY --project $project --format='table(name,state,createTime)'
```

El destino es una sola función:

```powershell
firebase deploy --only functions:consultarConvenio --project calendario-laboral-252b1
```

En la configuración comparada, el CLI es Firebase Tools 15.4.0, el proyecto predeterminado coincide, `firebase.json` tiene una sola codebase Functions con runtime Node 24 y el selector anterior limita el deploy a `consultarConvenio`. Las opciones locales de la función coinciden con la producción (90 s, 512 MiB y 10 instancias); las variables de entorno comunes comparadas coinciden. La única binding de secreto de producción es `GEMINI_API_KEY` versión 1 y el código nuevo conserva ese nombre. El predeploy ejecuta un generador local de inventario de monitores; no llama a Google Cloud. La ruta de deploy de Firebase CLI no elimina ni rota secretos.

Por ello, este comando no despliega Hosting, otras Functions, reglas, índices, Auth, Android ni el agente de Instagram; tampoco escribe documentos/chunks/embeddings ni cambia el valor o la versión del secreto. El deploy genera una nueva imagen/revisión para la función objetivo. Guardar el listado de funciones anterior y posterior: los `updateTime` de todas las demás Functions deben permanecer iguales. Verificar también que la revisión nueva esté `Ready`, sea la activa y reciba 100 % de tráfico; no asumirlo sin leer el estado de Cloud Run.

Después del deploy, repetir los cuatro comandos de evidencia. Confirmar además en logs que se está ejecutando el código nuevo y realizar una consulta de humo autorizada que compruebe una cita y la selección del convenio. No crear usuarios ni consumir cuotas productivas sin identidad de prueba y autorización. Si la revisión no está lista, el tráfico no está en el destino esperado, falla la consulta de humo, cambia la binding del secreto o se actualiza otra función, detener la validación y aplicar la recuperación correspondiente. Firebase Hosting y el código de ingesta no forman parte de este deploy; el agente de Instagram se valida y publica desde su propio repositorio/workflow, con aprobación separada.

### Recuperación ante errores

**Opción rápida de tráfico — solo mientras Gemini 2.5 siga disponible para el proyecto.** Úsese únicamente si el incidente es del artefacto nuevo y se está antes de la fecha efectiva del aviso. Cambia el tráfico, no reconstruye el código:

```powershell
gcloud run services update-traffic consultarconvenio --to-revisions consultarconvenio-00054-wot=100 --region us-central1 --project calendario-laboral-252b1
gcloud run services describe consultarconvenio --region us-central1 --project calendario-laboral-252b1 --format='yaml(status.latestReadyRevisionName,status.traffic)'
```

No ejecutar esto como rollback posterior al 1 de diciembre de 2026: la revisión 00054 usa `gemini-2.5-flash`.

**Recuperación compatible con Flash-Lite — después del aviso o si se requiere mantener Flash-Lite.** Desplegar el código de `e0c3076` en la misma función. Esto compila una revisión nueva con el cliente heredado y Flash-Lite; no dirigir tráfico a la revisión vieja 00054. Mantener el trabajo principal intacto y copiar únicamente los archivos `.env` ignorados que ya usa el deploy principal (no imprimirlos):

```powershell
$repo = 'C:\APLICACIONES\Mikel\CalendarioLaboralFireBase'
$rollback = Join-Path $env:TEMP ('balance-gemini-rollback-e0c3076-' + (Get-Date -Format 'yyyyMMddHHmmss'))
git -C $repo worktree add --detach $rollback e0c3076
foreach ($name in @('.env', '.env.calendario-laboral-252b1')) {
  $source = Join-Path (Join-Path $repo 'functions') $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path (Join-Path $rollback 'functions') $name)
  }
}
Push-Location $rollback
firebase deploy --only functions:consultarConvenio --project calendario-laboral-252b1
Pop-Location
```

Tras esa recuperación, repetir las comprobaciones previas/posteriores y confirmar explícitamente la revisión y el 100 % de tráfico. Si la función no recupera servicio, mantener Flash-Lite, guardar logs/IDs de revisión y escalar; no regresar a Gemini 2.5 después de la fecha del aviso. Cuando termine el incidente, eliminar solo el worktree temporal creado para esta recuperación (`git worktree remove --force $rollback`).

La recuperación `e0c3076` cubre problemas del SDK/adaptador desplegado, no fallos de calidad/servicio del propio Flash-Lite. No existe una revisión antigua de producción preconstruida que sea a la vez idéntica a 00054 y compatible con Flash-Lite; por tanto, no se promete un rollback instantáneo equivalente.

Referencias operativas: [despliegue selectivo de Firebase CLI](https://firebase.google.com/docs/cli), [administrar funciones y despliegues](https://firebase.google.com/docs/functions/manage-functions), [configurar secretos de Functions](https://firebase.google.com/docs/functions/config-env), [mover tráfico y rollback de Cloud Run](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic), [obsolescencias Gemini](https://ai.google.dev/gemini-api/docs/deprecations).
