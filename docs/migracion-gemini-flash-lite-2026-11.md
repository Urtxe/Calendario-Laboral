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

Tras autorización, desplegar solamente la Function modificada:

```powershell
firebase deploy --only functions:consultarConvenio --project calendario-laboral-252b1
```

No hace falta desplegar Hosting, reglas, índices, secretos, Firebase Auth ni Android. El código de ingesta se despliega por separado solo cuando haya una razón independiente para actualizar esa herramienta; no se ejecuta durante esta migración. Instagram es un repositorio separado y requiere integrar su cambio y desplegar su propio workflow tras autorización.

Para rollback, volver a `e0c3076` (la revisión local previa a este cambio de SDK) y desplegar de nuevo únicamente `functions:consultarConvenio`. Eso recupera el SDK heredado y mantiene modelo, configuración, documentos y vectores como estaban antes. No hacer rollback de Firebase, Hosting ni índices.
