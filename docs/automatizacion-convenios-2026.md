# Automatización documental de convenios — 2026

## Estado

**Parcial; desplegado y programado en producción, con cobertura de fuentes incompleta.** `reviewConvenioSources` está activa en `europe-west1`; una tarea Cloud Scheduler mensual está habilitada. La primera ejecución autenticada escribió el estado de 28 fichas en Firestore. Seis consultas establecieron baseline; 19 se rechazaron por resultado paginado incompleto y tres siguen sin enlace REGCON acreditado. No se considera que esas 22 fichas tengan una revisión correcta. La ejecución repetida no reconsultó ni duplicó novedades y conservó un resumen separado por ejecución.

La automatización solo detecta cambios en la página pública de trámites de REGCON. Un asiento detectado es una señal para revisión, no acredita publicación íntegra en boletín, autenticidad del PDF, incorporación al RAG ni vigencia jurídica. No se descargan ni se activan documentos automáticamente en esta fase.

## Arquitectura implementada en código

- `docs/matriz-vigencia-convenios-2026.md` sigue siendo el inventario canónico. El hook `predeploy` genera `functions/convenio-monitor-inventory.generated.json` con sus 28 filas, código REGCON y URL cuando están documentados; no se mantiene una segunda lista manual.
- La Function programada `reviewConvenioSources` usa una sola ejecución mensual (`0 5 1 * *`, `Europe/Madrid`, `europe-west1`, una instancia y una ejecución concurrente). Reutiliza Firebase Admin y Cloud Scheduler, sin dependencias ni servicios nuevos.
- Los convenios con actualizaciones pendientes, estado incompleto o periodo pactado terminado se planifican cada dos meses naturales. Los demás se planifican cada seis meses. El final del periodo pactado solo cambia la frecuencia; nunca desactiva ni sustituye una fuente.
- El proceso consulta únicamente enlaces HTTPS cuyo host, ruta y código coinciden exactamente con REGCON. Rechaza redirecciones, exige HTML, impone timeout de 15 segundos y límite de respuesta de 2 MiB. No llama a Gemini ni genera embeddings.
- `convenio_monitor_state` guarda firmas conocidas, un extracto corto del asiento, fechas, estado y siguiente comprobación. `convenio_monitor_runs` guarda un documento por ejecución; `convenio_monitor_control/monthly_lock` usa un lease de dos horas y `monthly_cycle` evita duplicar un ciclo ya completo.
- La primera lectura establece baseline y guarda firmas conocidas sin convertir asientos históricos en novedades pendientes. Solo diferencias posteriores pasan a `pending_documentary_verification`. Fallos e incompletitud conservan `lastSuccessfulCheckAt` sin cambios y difieren el próximo intento dos meses. Una ejecución sin convenios vencidos se registra como `no_due_agreements`, nunca como revisión completa.
- La página REGCON observada pagina en bloques de 15. Si el HTML indica filas que no están en la respuesta, o no hay filas interpretables, la fuente falla como `REGCON_RESULT_INCOMPLETE`; no se avanza su revisión correcta. En las pruebas actuales no se pudo recorrer la segunda página con la interfaz pública normal, así que estas fuentes permanecen bloqueadas con seguridad.
- El runtime usa `convenio-monitor@calendario-laboral-252b1.iam.gserviceaccount.com`, sin clave descargada. Un rol personalizado `ConvenioMonitorState` concede solo `datastore.databases.get`, `datastore.entities.create`, `datastore.entities.get` y `datastore.entities.update`; el rol `run.invoker` se limita al servicio de esta Function. Esos permisos de Firestore se asignan al proyecto y no aíslan colecciones; el código usa exclusivamente las rutas del monitor. El servicio no permite `allUsers` ni `allAuthenticatedUsers`.
- Cloud Scheduler usa OIDC con la identidad dedicada y la URI privada del servicio Cloud Run como destino y audiencia. Tras crear la Function, la URI `cloudfunctions.net` generó HTTP 403 por audiencia incorrecta; se ajustó el único job al URI de servicio Gen2 y se confirmó una llamada correcta. No se alteró IAM de otras Functions.
- Los mensajes de Cloud Logging contienen el identificador `convenio-XX`, código público, conteos y códigos de error; no incluyen el HTML descargado, contenido completo ni datos personales.

## Inventario y primera pasada pública

El inventario tiene 28 registros derivados de `docs/matriz-vigencia-convenios-2026.md`. Veinticinco tienen enlace directo REGCON y tres quedan pendientes: **18 Limpieza Barcelona, 26 Transporte Gipuzkoa y 27 Transporte Navarra**. La consulta oficial directa confirmó para **20 Limpieza Sevilla** el código `41001705011982` (asientos identificados como limpieza de ámbito provincial, Sevilla), y para **23 Transporte Álava** el `01100085162024` (transporte de mercancías por carretera, Álava); se añadieron sus enlaces verificables a la matriz. No se asignaron códigos nuevos a las otras tres fichas.

El 13/10/2026 se realizó una pasada pública previa de solo lectura a los 23 enlaces que estaban disponibles entonces, en concurrencia máxima de tres peticiones:

| Resultado de la consulta pública | Valor |
|---|---:|
| Enlaces REGCON solicitados | 23 |
| Respuestas correctas | 23 |
| Fallos de acceso | 0 |
| Firmas únicas de filas de trámites visibles | 236 |
| Repeticiones exactas mostradas por REGCON | 82 |
| Filas visibles totales, incluidas repeticiones | 318 |
| PDFs descargados o verificados | 0 |
| Escrituras de Firestore | 0 |
| Consultas Gemini / embeddings | 0 / 0 |

La página muestra como máximo 15 filas por vista; la revisión no recorrió páginas antiguas ni los boletines competentes. Las 236 firmas únicas son el contenido visible tras colapsar repeticiones exactas, no la secuencia íntegra de cada convenio ni prueba de que no existan otros trámites.

Hallazgos de REGCON que requieren cotejo documental:

- **Alojamientos Gipuzkoa `20100035012014`:** asiento de revisión salarial fechado 16/02/2026, anterior a la revisión automática registrada el 25/06/2025 que constaba en la matriz previa. Falta el anexo/publicación BOG.
- **Hostelería Málaga `29000945011981`:** REGCON muestra tablas salariales el 19/08/2024, 14/05/2025 y 14/04/2026. Los PDF íntegros BOPMA siguen sin estar disponibles en el expediente verificado; no se ingirieron importes.
- **Transporte Barcelona `08004295011994`:** REGCON muestra texto nuevo con periodo 01/01/2026–31/12/2028, registrado el 29/09/2026, revisión salarial automática 25/09/2026 y revisión salarial de 2025–25 registrada el 16/03/2026. El portal muestra dos filas coincidentes para la revisión automática. No se encontró en esta ejecución el documento íntegro BOPB; los asientos no activan el texto nuevo.
- **Transporte Zaragoza `50001115011981`:** asiento de texto nuevo para 2026–2028 fechado 19/09/2026 y revisión salarial automática 07/09/2026. No se obtuvo el documento íntegro de la publicación BOPZ; el texto de 2022–24 y sus complementos se mantienen separados.
- **Limpieza Zaragoza `50000755011981`:** REGCON refleja texto nuevo 2026–2029 y revisión salarial automática de 2026; no se ejecutó ingesta porque ya constan indexados 191 chunks de la publicación verificada en la fase anterior.

La matriz también mantiene las novedades sobre Alojamientos Gipuzkoa, Hostelería Málaga y Transporte Barcelona; la consulta a REGCON no se presenta como verificación de boletines.

### Ejecuciones controladas en producción — 13/10/2026

| Ejecución | Convenios examinados | Consultas REGCON completas | Incompletas/fallidas | Sin referencia | Nuevas entradas | Resultado |
|---|---:|---:|---:|---:|---:|---|
| Primera ejecución autenticada | 28 | 6 | 19 | 3 | 0 | `partial` |
| Repetición en el mismo ciclo | 28 | 0 | 0 | 0 | 0 | `partial`, 22 diferidas |
| Smoke tras la última actualización | 28 | 0 | 0 | 0 | 0 | `partial`, 22 diferidas |

La primera llamada falló antes de entrar en la Function (403 por audiencia OIDC); tras corregir el destino, la ejecución real duró 39,0 s. Firestore confirmó 28 documentos de estado: 6 `source_checked`, 19 `source_check_failed` con `REGCON_RESULT_INCOMPLETE` y 3 `blocked_missing_official_regcon_reference`. El resumen registró `newEntries: 0`, `geminiCalls: 0` y `embeddingCalls: 0`. Una segunda llamada no volvió a consultar URLs porque no habían vencido los siguientes intentos y dejó las fuentes sin resolver como diferidas; tras la última actualización se confirmó además un nuevo documento de ejecución, separado del primero.

## Descarga, clasificación e ingesta

**No incorporado ningún documento, chunk ni embedding en esta fase.** No hubo nuevos PDF descargados, no se subieron originales al bucket, no hubo respaldo ni escritura de catálogo/vectores y no se hizo una consulta KNN. No se ejecutó el ingestor porque las nuevas fuentes no se han cotejado con el boletín íntegro y no existe identidad autorizada para Firestore/Storage.

El ingestor existente `functions/ingest-conventios.js` no publica de forma atómica: escribe grupos de vectores y después el catálogo. Por eso no es apto para una ejecución automatizada desde el monitor sin un flujo adicional de staging/activación. Este cambio deliberadamente no lo llama. Una tabla salarial complementaria solo podrá ingerirse cuando el código, ámbito, publicación, PDF completo y relación con el acuerdo estén probados y exista respaldo recuperable; un texto nuevo requiere revisión jurídica/documental antes de activar.

## Costes, identidad y permisos

- Gemini Developer API: **0 llamadas; coste estimado $0.00**.
- Embeddings: **0; coste estimado $0.00**.
- Cloud Storage, Firestore y Scheduler: **sin consumo atribuible a esta prueba**, porque no se ejecutó contra el proyecto. El costo de transferencia de las consultas públicas no está disponible en una fuente de medición.
- La identidad CLI autorizada se usó únicamente para desplegar e inspeccionar. La identidad de ejecución es la cuenta de servicio dedicada anterior; no tiene clave JSON. No se modificaron reglas de Firestore, facturación, secretos, App Check, Hosting ni `consultarConvenio`.
- Consumo medido: 25 solicitudes oficiales REGCON en la primera ejecución (6 completas, 19 incompletas); 0 solicitudes en las repeticiones; 0 llamadas Gemini y 0 embeddings. La ejecución de 39 s registró en la Function coste estimado de IA `$0.00`. El coste facturado de Scheduler, Cloud Run y Firestore no estuvo disponible durante esta validación.

## Reintento, recuperación y revisión manual

- Una fuente fallida conserva `lastErrorCode` y `lastSuccessfulCheckAt`; `nextReviewAt` se fija a dos meses para reintentar sin marcarla revisada. Los aciertos parciales se conservan.
- El lock vence a las dos horas si la ejecución termina abruptamente. Cada intento tiene un documento de ejecución único; repetirlo conserva la evidencia anterior y las firmas evitan duplicar novedades.
- Los cambios nuevos deben abrir una tarea de revisión documental; no existe un canal de notificación configurado reutilizable confirmado en el repositorio, por lo que no se ha añadido uno.
- Para validar un pendiente: abrir la ficha oficial REGCON → localizar la publicación en el boletín territorial → descargar PDF desde el dominio oficial → comprobar código, ámbito, CVE/número, páginas, anexos, texto extraído y SHA-256 → verificar respaldo en bucket → ejecutar preflight del ingestor → revisar duplicados/metadatos y KNN → activar únicamente mediante un mecanismo atómico revisado. Después de reconciliar una fila, marcar su estado individual como `resolved` y actualizar la matriz canónica; así el registro sale de la cola y vuelve a su frecuencia semestral si el periodo pactado sigue vigente. Un hash demuestra igualdad de bytes, no autenticidad ni aplicabilidad jurídica.
- Los tres registros sin enlace por código deben resolverse desde la matriz y sus boletines antes de declararlos revisados.
- Ejecución manual autorizada: `gcloud scheduler jobs run firebase-schedule-reviewConvenioSources-europe-west1 --location=europe-west1 --project=calendario-laboral-252b1`. Para detener la automatización, pausar únicamente ese job con `gcloud scheduler jobs pause firebase-schedule-reviewConvenioSources-europe-west1 --location=europe-west1 --project=calendario-laboral-252b1`; reanudar con `gcloud scheduler jobs resume ...`.

## Pruebas y despliegue

- `npm test`: pasó (la prueba existente de métricas registra el error esperado de `GA4_PROPERTY_ID` ausente).
- `npm run test:convenio-monitor --prefix functions`: 8 pruebas aprobadas (inventario, cadencias/fechas, parsing y duplicados, dominio/redirecciones/tamaño, baseline, resultados incompletos, idempotencia y concurrencia).
- `npm run test:holidays --prefix functions`: 46 pruebas aprobadas.
- `node --check` de los archivos JavaScript modificados y `git diff --check`: aprobado.
- `npm test`, los tests específicos, `node --check` de JavaScript modificado y `git diff --check` pasaron. No hay emulador Firestore configurado para este flujo.
- `reviewConvenioSources` se desplegó y está `ACTIVE` (Node.js 22, 2.ª gen., 512 MiB, timeout 540 s, máximo una instancia). No se desplegó Hosting ni otra Function y no se generaron embeddings.
- Hay exactamente un job de monitor activo: `firebase-schedule-reviewConvenioSources-europe-west1`, `0 5 1 * *`, zona `Europe/Madrid`; su próxima ejecución está confirmada para **01/11/2026 05:00 CET = 04:00 UTC**. El job usa OIDC como la cuenta de servicio dedicada, timeout de intento 540 s y no es público.
- Firestore real fue leído después de las ejecuciones y confirmó el resumen, 28 estados y el registro único por ejecución. No hubo migración de esquema del RAG ni escrituras en catálogo/vectores.
- Commits de implementación/documentación publicados: `6bb1b6b` (monitor), `a78509b` (informe y matriz), `fbb7305` (PR) y `f6f6fc7` (cadencia de pendientes). Rama `feat/automatic-convenio-updates` publicada en `origin`; este mismo informe se incluye en el PR #11.
- La rama se actualizó en [PR #11](https://github.com/Urtxe/Calendario-Laboral/pull/11); sigue en borrador y no se integró porque 19 fuentes no entregaron el resultado completo y tres referencias siguen pendientes. `main` y `origin/main` permanecen sincronizadas en `9e7b00e`; `.playwright-cli/` se conserva sin cambios.

## Limitaciones y estado requerido para completar

Esta fase solo monitoriza asientos REGCON. No descarga ni preserva PDFs, no verifica boletines de forma universal, no clasifica efectos jurídicos, no ingiere ni activa documentos, no llama a KNN ni notifica. La principal limitación operativa pendiente es recorrer los resultados paginados de REGCON; 19 fuentes quedan marcadas como fallidas y se reintentarán cada dos meses. Las fichas 18, 26 y 27 requieren resolver código/enlace oficial. BOPMA ha bloqueado PDFs de Málaga y BOPB devolvió 403 para documentos durante la validación anterior.

Al actualizar el código de la Function, comprobar que el job mantiene como destino y audiencia OIDC la URI Cloud Run `run.app`; Firebase creó inicialmente una audiencia `cloudfunctions.net` que devolvió 403. El PR #11 debe permanecer sin integrar si no pasan los checks y no se resuelve la revisión de GitHub.
