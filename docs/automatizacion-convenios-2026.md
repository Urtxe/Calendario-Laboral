# Automatización documental de convenios — 2026

## Estado

**Parcial; estable y desplegado en producción, con cobertura pendiente.** A 14/10/2026, las 28 fichas tienen estado en Firestore: **7 `source_checked`, 19 `source_check_failed` pendientes de reintento y 2 sin referencia REGCON** (18 Limpieza Barcelona y 27 Transporte Navarra). Seis éxitos corresponden a la pasada anterior; una revisión completa por exportación oficial se realizó ahora para 26 Transporte Gipuzkoa. Las 19 respuestas incompletas no avanzaron su última revisión satisfactoria. El run controlado consultó una fuente, no encontró novedades y dejó 21 fichas diferidas.

La automatización solo detecta cambios en la página pública de trámites de REGCON. Un asiento detectado es una señal para revisión, no acredita publicación íntegra en boletín, autenticidad del PDF, incorporación al RAG ni vigencia jurídica. No se descargan ni se activan documentos automáticamente en esta fase.

## Arquitectura implementada en código

- `docs/matriz-vigencia-convenios-2026.md` sigue siendo el inventario canónico. El hook `predeploy` genera `functions/convenio-monitor-inventory.generated.json` con sus 28 filas, código REGCON y URL cuando están documentados; no se mantiene una segunda lista manual.
- La Function programada `reviewConvenioSources` usa una sola ejecución mensual (`0 5 1 * *`, `Europe/Madrid`, `europe-west1`, una instancia y una ejecución concurrente). Reutiliza Firebase Admin y Cloud Scheduler, sin dependencias ni servicios nuevos.
- Los convenios con actualizaciones pendientes, estado incompleto o periodo pactado terminado se planifican cada dos meses naturales. Los demás se planifican cada seis meses. El final del periodo pactado solo cambia la frecuencia; nunca desactiva ni sustituye una fuente.
- El proceso consulta únicamente enlaces HTTPS cuyo host, ruta y código coinciden exactamente con REGCON. Obtiene la página y usa el botón público `Exportar Excel` dentro de la misma sesión; valida el total anunciado contra todas las filas del XML Spreadsheet oficial antes de aceptar la revisión. Rechaza redirecciones, hosts ajenos, MIME inesperado, exportación malformada o código distinto; impone 15 s por consulta completa, 2 MiB total y 500 filas como máximo. No recorre enlaces de página: la interfaz enlaza la página 2 sin conservar `convenioMapa` y esa ruta responde “sin resultados”.
- `convenio_monitor_state` guarda firmas conocidas, un extracto corto del asiento, fechas, estado y siguiente comprobación. `convenio_monitor_runs` guarda un documento por ejecución; `convenio_monitor_control/monthly_lock` usa un lease de dos horas y `monthly_cycle` evita duplicar un ciclo ya completo.
- La primera exportación completa establece baseline sin convertir asientos históricos en novedades. Las firmas de una consulta anterior parcial se conservan, pero no implican `baselineEstablished`; solo diferencias de una cobertura completa pasan a `pending_documentary_verification`. Los IDs oficiales de fila se almacenan junto a la firma y las firmas/pendientes no se recortan, para no descartar historia ni duplicar novedades.
- `REGCON_RESULT_INCOMPLETE` se conserva ante total anunciado distinto del exportado, contenido inesperado, exportación vacía o límite superado. El fallo conserva `lastSuccessfulCheckAt`. Las fuentes fallidas son elegibles en la siguiente ejecución mensual; tras seis fallos técnicos consecutivos pasan a `source_check_retry_exhausted` y esperan seis meses antes de una nueva comprobación. El éxito reinicia el contador. No se cambian fechas manualmente.
- El runtime usa `convenio-monitor@calendario-laboral-252b1.iam.gserviceaccount.com`, sin clave descargada. Un rol personalizado `ConvenioMonitorState` concede solo `datastore.databases.get`, `datastore.entities.create`, `datastore.entities.get` y `datastore.entities.update`; el rol `run.invoker` se limita al servicio de esta Function. Esos permisos de Firestore se asignan al proyecto y no aíslan colecciones; el código usa exclusivamente las rutas del monitor. El servicio no permite `allUsers` ni `allAuthenticatedUsers`.
- Cloud Scheduler usa OIDC con la identidad dedicada y la URI privada del servicio Cloud Run como destino y audiencia. Tras crear la Function, la URI `cloudfunctions.net` generó HTTP 403 por audiencia incorrecta; se ajustó el único job al URI de servicio Gen2 y se confirmó una llamada correcta. No se alteró IAM de otras Functions.
- Los mensajes de Cloud Logging contienen el identificador `convenio-XX`, código público, conteos y códigos de error; no incluyen el HTML descargado, contenido completo ni datos personales.

## Inventario y primera pasada pública

El inventario deriva las 28 fichas de la matriz. **26** tiene ahora el enlace REGCON oficial `20001175011981`, cuya ficha confirma la denominación “TRANSPORTES DE MERCANCIAS POR CARRETERA”, Guipúzcoa y vigencia registrada hasta 31/12/2009. Las dos promociones de negociación (14/11/2013 y 16/01/2024) pertenecen a ese asiento; no acreditan un texto sucesor ni el periodo 2010–14 atribuido al nombre del PDF local. El monitor consulta el código histórico y la ficha permanece `INCOMPLETO` para cotejo documental.

**27** tiene referencia histórica confirmada en BON: Resolución 625/2008, código antiguo `3107405`, sector Transporte de mercancías por carretera de Navarra, BON 111 de 10/09/2008 y corrección en núm. 123. El código antiguo no abre una ficha individual REGCON por `consultaCodigoMapas`, por lo que no se habilita como fuente automática. **18** sigue sin referencia inequívoca: el código relacionado `79002415012005` es de ámbito Cataluña y no se asigna al documento local presentado como Barcelona.

Las fichas 20 Limpieza Sevilla (`41001705011982`) y 23 Transporte Álava (`01100085162024`) conservan sus referencias oficiales verificadas previamente. REGCON sirve para monitorizar asientos; no valida jurídicamente un convenio ni sustituye el cotejo del boletín y el documento íntegro.

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

### Ejecuciones controladas en producción

| Ejecución | Convenios examinados | Consultas REGCON completas | Incompletas/fallidas | Sin referencia | Nuevas entradas | Resultado |
|---|---:|---:|---:|---:|---:|---|
| Primera ejecución autenticada | 28 | 6 | 19 | 3 | 0 | `partial` |
| Repetición en el mismo ciclo | 28 | 0 | 0 | 0 | 0 | `partial`, 22 diferidas |
| Smoke tras la última actualización | 28 | 0 | 0 | 0 | 0 | `partial`, 22 diferidas |
| Exportación completa por Scheduler, 14/10/2026 | 28 | 1 | 0 | 2 | 0 | `partial`, 21 diferidas |

El run del 14/10/2026 usó el Scheduler existente y la revisión `00003-hac`. Cloud Logging registra HTTP 200, 6,55 s de latencia de petición y 5.236 ms de ejecución interna. REGCON devolvió dos asientos para 26; el primer resultado completo dejó `baselineEstablished=true`, `knownSignatures=2`, `newEntries=0`, `pendingEntries=0` y `lastSuccessfulCheckAt=2026-10-14T19:44:49Z`. La ejecución examinó 28 fichas: `checked=1`, `failed=0`, `deferred=21`, `newEntries=0`. Los otros estados no fueron adelantados: permanecen 19 fallidos y 2 sin referencia. La revisión final `00004-xut` volvió a desplegar la misma lógica junto con el periodo pactado corregido a 2009; no se volvió a ejecutar REGCON porque la fuente 26 no vence hasta diciembre. No se reescribieron documentos RAG ni se crearon ejecuciones duplicadas.

## Descarga, clasificación e ingesta

**No incorporado ningún documento, chunk ni embedding en esta fase.** No hubo nuevos PDF descargados, no se subieron originales al bucket, no hubo respaldo ni escritura de catálogo/vectores y no se hizo una consulta KNN. No se ejecutó el ingestor porque las nuevas fuentes no se han cotejado con el boletín íntegro y no existe identidad autorizada para Firestore/Storage.

El ingestor existente `functions/ingest-conventios.js` no publica de forma atómica: escribe grupos de vectores y después el catálogo. Por eso no es apto para una ejecución automatizada desde el monitor sin un flujo adicional de staging/activación. Este cambio deliberadamente no lo llama. Una tabla salarial complementaria solo podrá ingerirse cuando el código, ámbito, publicación, PDF completo y relación con el acuerdo estén probados y exista respaldo recuperable; un texto nuevo requiere revisión jurídica/documental antes de activar.

## Costes, identidad y permisos

- Gemini Developer API: **0 llamadas; coste estimado $0.00**.
- Embeddings: **0; coste estimado $0.00**.
- Ejecución real controlada: una fuente, 5,236 s y dos solicitudes a REGCON; el consumo de Firestore del run fue 28 lecturas de estado más el lock/ciclo y escrituras del estado 26, run y lock. La estimación de cálculo y operaciones de Firestore para un ciclo completo de 28 fuentes es **menos de $0.01 por ejecución** usando las tarifas públicas de [Cloud Run](https://cloud.google.com/run/pricing) y [Firestore](https://cloud.google.com/firestore/pricing); no incluye posibles cargos de red ni es una lectura de factura. Se conserva el único job Scheduler ya existente.
- La identidad CLI autorizada se usó únicamente para desplegar e inspeccionar. La identidad de ejecución es la cuenta de servicio dedicada anterior; no tiene clave JSON. No se modificaron reglas de Firestore, facturación, secretos, App Check, Hosting ni `consultarConvenio`.
- Consumo registrado: 25 solicitudes oficiales REGCON en la ejecución inicial (6 completas, 19 incompletas); 0 en sus repeticiones; y 2 en la ejecución controlada del 14/10. Gemini y embeddings permanecen en 0 llamadas y $0.00. El costo facturado exacto no se consultó.

## Reintento, recuperación y revisión manual

- La revisión documental sigue siendo semestral para periodos vigentes y bimestral para periodos terminados o con novedades pendientes. El estado `source_check_failed` permite una reejecución en cada siguiente ciclo mensual, sin volver a intentar dos veces en el mismo mes. Se detiene el reintento mensual tras seis fallos consecutivos y queda `source_check_retry_exhausted`, con causa técnica y revisión a seis meses; el éxito reinicia el contador.
- Una fuente fallida conserva `lastErrorCode`, `lastSuccessfulCheckAt`, firmas y pendientes; no se marca como éxito. La primera cobertura completa posterior a una parcial establece baseline sin novedades históricas. Los estados heredados no necesitaron migración ni respaldo adicional: las firmas antiguas no tenían `baselineEstablished` y se conservaron.
- El lock vence a las dos horas si la ejecución termina abruptamente. Cada intento tiene un documento de ejecución único; repetirlo conserva la evidencia anterior y las firmas evitan duplicar novedades.
- Los cambios nuevos deben abrir una tarea de revisión documental; no existe un canal de notificación configurado reutilizable confirmado en el repositorio, por lo que no se ha añadido uno.
- Para validar un pendiente: abrir la ficha oficial REGCON → localizar la publicación en el boletín territorial → descargar PDF desde el dominio oficial → comprobar código, ámbito, CVE/número, páginas, anexos, texto extraído y SHA-256 → verificar respaldo en bucket → ejecutar preflight del ingestor → revisar duplicados/metadatos y KNN → activar únicamente mediante un mecanismo atómico revisado. Después de reconciliar una fila, marcar su estado individual como `resolved` y actualizar la matriz canónica; así el registro sale de la cola y vuelve a su frecuencia semestral si el periodo pactado sigue vigente. Un hash demuestra igualdad de bytes, no autenticidad ni aplicabilidad jurídica.
- Las fuentes incompletas por una causa externa siguen en cola y se reintentarán mensualmente. Las dos fichas sin fuente automática son 18 y 27. La ficha 26 ya tiene código REGCON histórico, pero su PDF/periodo local sigue pendiente de cotejo.
- Ejecución manual autorizada: `gcloud scheduler jobs run firebase-schedule-reviewConvenioSources-europe-west1 --location=europe-west1 --project=calendario-laboral-252b1`. Para detener la automatización, pausar únicamente ese job con `gcloud scheduler jobs pause firebase-schedule-reviewConvenioSources-europe-west1 --location=europe-west1 --project=calendario-laboral-252b1`; reanudar con `gcloud scheduler jobs resume ...`.

## Pruebas y despliegue

- `npm test`: aprobado; la salida 503 de Analytics es la comprobación esperada de `GA4_PROPERTY_ID` ausente.
- `node --test functions/*.test.js`: 72 pruebas aprobadas; `npm run test:convenio-monitor --prefix functions`: 11 pruebas aprobadas, incluidas exportación multi-página, totales y duplicados, redirecciones, timeout, baseline tras parcial, reintento mensual, idempotencia y concurrencia.
- `node --check` de los JavaScript afectados y `git diff --check`: aprobados. No hay emulador Firestore configurado; estos tests usan mocks, mientras que el smoke del 14/10 sí ejecutó Function, REGCON y Firestore reales.
- Se desplegó únicamente `reviewConvenioSources`, revisión final `reviewconveniosources-00004-xut`, `ACTIVE` (Node.js 22, Gen2, 512 MiB, timeout 540 s, máximo una instancia). `consultarConvenio`, Hosting, catálogo RAG, embeddings y permisos de otras Functions no se modificaron.
- Existe exactamente un Scheduler del monitor, `firebase-schedule-reviewConvenioSources-europe-west1`, `0 5 1 * *`, `Europe/Madrid`, habilitado. La próxima ejecución confirmada es **01/11/2026 05:00 CET (04:00 UTC)**. Usa OIDC con audiencia `https://reviewconveniosources-sbp2cbr34q-ew.a.run.app/` y la cuenta dedicada. El servicio solo concede `roles/run.invoker` a esa cuenta; no hay `allUsers` ni `allAuthenticatedUsers`.
- Firestore real conserva 28 documentos: 7 `source_checked`, 19 `source_check_failed` con `REGCON_RESULT_INCOMPLETE` y 2 `blocked_missing_official_regcon_reference`; no hay falsos baselines, el run dejó `newEntries=0` y no duplicó documentos de ejecución. No hubo migración de RAG.
- Commits previos del PR: `6bb1b6b` (monitor), `a78509b` (informe y matriz), `fbb7305` (PR) y `f6f6fc7` (cadencia de pendientes). Commit de fase 7: `9d72882` (`fix: complete REGCON source review and retries`). GitHub creó el merge commit `36088a2` el 14/10/2026.
- PR #11 está **fusionado** en `main`. `main` y `origin/main` están sincronizadas en `36088a2`. GitHub informó el PR `MERGEABLE/CLEAN`; no había checks configurados ni revisiones solicitadas. `.playwright-cli/` se conserva intacto.

## Limitaciones y estado requerido para completar

Esta fase solo monitoriza asientos REGCON; no descarga ni preserva PDFs, no comprueba todos los boletines, no clasifica efectos jurídicos, no ingiere ni activa documentos y no llama a KNN. La cobertura ya usa la exportación oficial íntegra en vez de depender de enlaces de paginación que no conservan la búsqueda. Quedan 19 fuentes con resultado incompleto que el próximo ciclo mensual podrá reintentar, y dos fichas sin referencia automática inequívoca (18 y 27). El asiento REGCON no equivale a validar un convenio ni a verificar su publicación íntegra.

La integración de esta fase está cerrada. Permanecen 19 fuentes pendientes de reintento mensual y dos sin referencia REGCON inequívoca; esas limitaciones no bloquean el PR integrado. La futura ingesta seguirá fuera de alcance.

## Actualización de ingesta (14/10/2026)

Los contadores anteriores son el cierre histórico de la fase 7. En una comprobación posterior de solo lectura, las 19 exportaciones que constaban fallidas devolvieron cobertura completa; los documentos Firestore aún conservan el estado fallido porque no se ejecutó el ciclo mensual ni se adelantaron fechas. Los dos estados sin referencia siguen pendientes. Consulte el detalle y la primera ingesta en [ingesta-automatica-convenios-2026.md](ingesta-automatica-convenios-2026.md).

Se incorporó en producción únicamente una publicación complementaria BOPB de tablas salariales 2025 de Transporte Barcelona: cinco páginas, CVE `202610047645`, SHA-256 `65ba6993bcbaa71e98ea257969f5ea0b66d401f01e33ed5811031c77d3267571`, 16 chunks y 16 embeddings. No es el texto 2026–2028 de REGCON ni lo activa. La nueva entrada se limita a evidencia salarial 2025; se verificó KNN real y se actualizó `consultarConvenio` para que las tablas salariales no respalden respuestas sobre otros temas. El Scheduler del monitor sigue siendo único y mensual; no se añadió un trabajo de ingesta ni se conectó el monitor a una descarga automática.

El cambio está en `feat/convenio-document-ingestion`, commit `a578260`, PR #12 abierto en borrador. No se fusiona mientras la conexión automática al monitor y su validación documental sigan pendientes. `main` y `origin/main` permanecen en `77a1452`.

El estado `REGCON_RESULT_INCOMPLETE` no se ha debilitado. La comprobación de solo lectura de la fase 8 no modificó estados; la reconciliación explícita posterior se registra a continuación.

## Reconciliación explícita de estados heredados (14/10/2026)

Se ejecutó `functions/reconcile-convenio-monitor.js --apply` una sola vez, tras vista previa y respaldo de los 28 estados y dos documentos de control. El modo especial seleccionó únicamente los 19 `source_check_failed` con `REGCON_RESULT_INCOMPLETE` y sin baseline. Cada fuente requirió la página oficial REGCON y su exportación Excel íntegra; las 19 fueron completas. El run `2026-10-1792009478011-ab53cbdd` registra `examined=28`, `checked=19`, `failed=0`, `deferred=2`, `newEntries=0`. Firestore quedó con **26 estados `source_checked` y 2 `blocked_missing_official_regcon_reference`** (fichas 18 y 27), sin duplicados ni novedades ficticias. Las siete fuentes ya completas no se adelantaron.

Respaldo local recuperable: `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\regcon-reconciliation-2026-10-14T20-24-37-975Z-b757bb79.json`; SHA-256 `e585f0fbe5ce377d217289b9bddb0f1a75d0103c4d6541f44947fba1c95827c6`. Las firmas y fechas antiguas permanecieron en el respaldo. No se restaurará en bloque si aparecen revisiones posteriores: cualquier recuperación debe comparar `updateTime` y reparar solo el documento afectado.

La política de reintentos conserva una ejecución mensual por fuente fallida durante los primeros cinco errores. A partir del sexto, timeout, HTTP 429 o 5xx pasan a `source_check_degraded` con revisión bimestral; respuestas estructuralmente incompletas u otros bloqueos persistentes pasan a `source_check_retry_exhausted` con revisión semestral y causa explícita. Un resultado completo restablece el contador. El Scheduler mensual único no cambia.
