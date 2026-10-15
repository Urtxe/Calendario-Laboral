# Descarga oficial e ingesta documental de convenios — 2026

Fecha de comprobación: 15/10/2026. Proyecto Firebase: `calendario-laboral-252b1`.

## Resultado

Se incorporaron publicaciones complementarias y, el 15/10/2026, los textos íntegros nuevos 2026–2028 de Transporte Barcelona y Zaragoza. Los dos textos nuevos quedaron verificados por fuente, identificador, hash, ámbito, fechas y anexos; se conservaron las entradas históricas. El resolutor mantiene separados periodo pactado, vigencia general y efectos económicos.

La exportación Excel oficial de REGCON trae URL por asiento. El monitor conserva esa URL únicamente para novedades posteriores al baseline. Un procesador Eventarc separado, probado y activo tras un cotejo histórico idempotente, admite únicamente complementos salariales del BOG con enlace PDF directo, código, sector, provincia, año, identificador y anexo verificables. Otros boletines, textos nuevos y modificaciones ambiguas quedan en revisión manual. La identidad del monitor no recibió permisos adicionales; no se añadió otro Scheduler.

## Comprobación del monitor y fuentes

Antes de la reconciliación, Firestore conservaba 28 estados: 7 `source_checked`, 19 `source_check_failed` con `REGCON_RESULT_INCOMPLETE` y 2 `blocked_missing_official_regcon_reference`. La reconciliación explícita del 14/10 consultó la exportación oficial completa de las 19 fuentes fallidas, estableció su primer baseline sin novedades históricas y conservó los otros nueve estados y la cadencia. Resultado real: **26 `source_checked`, 2 sin referencia, 0 fallos y 0 novedades**. El run `2026-10-1792009478011-ab53cbdd` registra 19 comprobaciones satisfactorias, 2 diferidas y ninguna llamada Gemini. El respaldo previo de 30 documentos de estado/control está fuera del repositorio, en `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\regcon-reconciliation-2026-10-14T20-24-37-975Z-b757bb79.json`, SHA-256 `e585f0fbe5ce377d217289b9bddb0f1a75d0103c4d6541f44947fba1c95827c6`.

Se comprobó el sumario oficial BOPB de 16/03/2026, CVE `202610047645`, y se descargó la copia pública de la publicación desde el detalle REGCON. Sus 151.894 bytes y SHA-256 coinciden exactamente con el PDF del bucket. El acceso HTTP directo al BOPB respondió 403; la procedencia se apoya en el enlace de publicación del propio REGCON y en los datos BOPB, además de la igualdad de bytes.

Otras comprobaciones documentales:

- **Transporte Barcelona:** texto íntegro BOPB CVE `202610145528`, publicado 29/09/2026, activado desde 01/01/2026 por el artículo 4. Se incorporaron 488 chunks; las tablas salariales oficiales 2025 permanecen como catálogo separado de 16 chunks.
- **Transporte Zaragoza:** texto íntegro BOPZ núm. 216, anuncio 6101, publicado 19/09/2026. Vigencia general desde 20/09/2026; efectos económicos generales desde 01/01/2026 y dietas desde 01/07/2026. Se incorporaron 198 chunks.
- **Hostelería Málaga:** el sumario BOPMA identifica el edicto 1187/2026, 14/04/2026; el endpoint del edicto devolvió 403. No se importaron tablas ni importes. Los documentos de 19/08/2024 y 14/05/2025 quedan por cotejar en sus PDF oficiales íntegros.
- **Alojamientos Gipuzkoa:** se descargó del BOG el PDF íntegro de 16/02/2026, identificador `GAO-I-2026-00553`, código `20100035012014`, tres páginas y anexos II–VII. Se incorporó como complemento salarial 2026 separado.
- **Resto de las 28 fichas:** no se realizó una descarga/publicación oficial íntegra para cada una; los asientos del monitor no equivalen a publicación documental. No se presenta un barrido documental de 28 como completado.

## Documentos incorporados

| Campo | Valor comprobado |
|---|---|
| Catálogo | `transporte_barcelona_tablas_2025` |
| Tipo | `salary_tables` |
| Código oficial | `08004295011994` |
| Publicación | BOPB, 16/03/2026, CVE `202610047645` |
| URL oficial | https://bop.diba.cat/anuncio/ver-pdf/3910056 |
| Ámbito de datos | Tablas salariales 2025; cinco páginas |
| SHA-256 | `65ba6993bcbaa71e98ea257969f5ea0b66d401f01e33ed5811031c77d3267571` |
| Original privado | `gs://calendario-laboral-252b1.firebasestorage.app/official-sources/convenios/transporte_barcelona_tablas_2025/65ba6993bcbaa71e98ea257969f5ea0b66d401f01e33ed5811031c77d3267571.pdf` |
| Vectores | 16 chunks, IDs deterministas, 768 dimensiones, `gemini-embedding-001` |

| Campo Gipuzkoa | Valor comprobado |
|---|---|
| Catálogo adicional | `alojamientos_gipuzkoa_revision_salarial_2026` |
| Tipo y ámbito | `salary_revision`; Alojamientos Gipuzkoa, salarios 2026 |
| Publicación | BOG núm. 30, 16/02/2026, `GAO-I-2026-00553`; [PDF oficial](https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/16/c2600553.pdf) |
| Integridad | 3 páginas; anexos II–VII; SHA-256 `a77d5fd34e2f1e54551ebea2eb0b51b18bbd6d0623f24ed50b89594e224c79a9` |
| Ingesta | 15 chunks y 15 embeddings nuevos de 768 dimensiones; KNN real 5/5 de la fuente esperada |
| Original privado | `gs://calendario-laboral-252b1.firebasestorage.app/official-sources/convenios/alojamientos_gipuzkoa_revision_salarial_2026/a77d5fd34e2f1e54551ebea2eb0b51b18bbd6d0623f24ed50b89594e224c79a9.pdf` |

El objeto de Storage se creó sin sobrescritura (`ifGenerationMatch=0`). La descarga de verificación desde el bucket conservó los mismos bytes y hash. El hash acredita igualdad de bytes, no autenticidad jurídica ni aplicabilidad individual. El PDF completo del convenio no se reemplazó ni modificó.

## Preparación, activación y recuperación

`functions/official-convenio-document.js` limita descargas a HTTPS y hosts oficiales permitidos, rechaza redirecciones, aplica timeout y máximo de 25 MiB, valida tipo y firma PDF, y calcula SHA-256. Los originales se conservan con escritura inmutable en el bucket privado existente.

El ingestor acepta únicamente fuentes con metadatos explícitos de verificación, código, publicación y elegibilidad determinista. Valida PDF, páginas, texto, hashes y dimensiones. Los chunks nuevos se escriben con `doc_type=staged_especifico`; las rutas existentes de recuperación solo consultan `especifico` o `base`, por lo que el conjunto incompleto no aparece en RAG. Tras comprobar el conjunto íntegro (índices, checksum, metadatos y vectores) y la recuperación KNN de los chunks staged, cambia todos los chunks a activos en una transacción Firestore (límite de 499 chunks). El catálogo se actualiza antes del punto de activación. Se conservan IDs y versiones anteriores.

Existe operación de rollback para volver a staged el conjunto identificado y retirar solo la fuente correspondiente del catálogo. No se borra el PDF ni versiones previas. Los documentos mayores que el límite atómico se detienen antes de generar embeddings y requieren un mecanismo transaccional por manifiesto antes de aceptarse.

La tabla salarial se filtra en el resolver y solo puede participar en consultas salariales. La recuperación fue comprobada en producción: una búsqueda KNN real devolvió 5/5 chunks del archivo y SHA esperados; una pregunta de jornada no resolvió ese documento, una consulta salarial de 2025 sí, y una consulta salarial de 2026 no. Se activó un aviso para consultas de salario actual sin año porque la evidencia solo alcanza 2025. No se ejecutó una consulta autenticada completa al asesor; no había cuenta de prueba autorizada disponible.

## Presupuesto, permisos y seguridad

La ingesta de Barcelona generó 16 embeddings y reservó 2.787 tokens estimados; Gipuzkoa generó 15 embeddings y reservó 2.696 más. El documento `ingestion_budget_2026-10` registra **5.483 tokens estimados**, bajo límites de 50.000 por documento y 250.000 por mes. La duplicación controlada del procesador consumió 0 embeddings. Coste Gemini **estimado** inferior a USD 0,01 para ambas publicaciones según [tarifas públicas](https://ai.google.dev/gemini-api/docs/pricing?hl=es); la factura real no se consultó. Functions, Firestore, Storage y Eventarc tienen costes variables adicionales no medidos aquí.

`reviewConvenioSources` conserva su identidad limitada. `processConvenioDocument` usa la cuenta `convenio-ingestor@calendario-laboral-252b1.iam.gserviceaccount.com` con `roles/datastore.user` y `roles/eventarc.eventReceiver`, `roles/run.invoker` solo en su Cloud Run privado, `roles/storage.objectCreator` y `roles/storage.objectViewer` solo en el bucket existente, y `roles/secretmanager.secretAccessor` solo en `GEMINI_API_KEY`. No hay claves JSON, invocación pública, cambios en App Check, reglas de usuarios, Hosting ni facturación. La función admite como origen de descarga solo HTTPS exacto en `egoitza.gipuzkoa.eus`, prohíbe redirecciones y limita PDF a 25 MiB y 20 segundos. El contenido se trata como datos, no como instrucciones.

## Procesador desatendido y comprobación real

El monitor mantiene una única tarea mensual y guarda la URL de publicación de los asientos nuevos. La Function Eventarc escucha los cambios de `convenio_monitor_state`, reclama un pendiente por transacción con lease, máximo tres intentos, y no repite un SHA ya catalogado. La ausencia de URL, un HTML o una clasificación distinta de complemento salarial BOG queda en `pending_manual_verification`; errores temporales y presupuesto agotado se difieren un mes. El control `convenio_monitor_control/document_ingestion.paused` permite detener solo la ingesta.

El despliegue inicial del trigger requirió habilitar `roles/eventarc.eventReceiver` y el permiso privado `roles/run.invoker` para su propia identidad. Tras corregir IAM, se añadió explícitamente a la ficha 02 un pendiente de **cotejo documental histórico** con firma ya conocida, sin alterar fechas ni contarlo como novedad REGCON. El respaldo previo está en `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\document-processor-smoke-2026-10-14T20-51-25-653Z.json`, SHA-256 `55086cbbff13120fd0a0088c8a8d0993f08410b842f1ba3bb5f27db2163d9b21`. Eventarc invocó el servicio privado, la Function validó de nuevo el PDF BOG y cerró la firma como `resolved` con `newChunks=0`, un intento y el catálogo esperado. El control quedó `paused=false`.

Firestore real: 28 estados, **26 `source_checked`, 2 sin referencia**, 0 pendientes abiertos tras el cotejo. El catálogo Gipuzkoa y su objeto privado conservan el mismo SHA-256; 15/15 vectores tienen `doc_type=especifico` y dimensión 768. KNN real devolvió 5/5 chunks del PDF esperado. El preflight dinámico posterior encontró 15 embeddings reutilizables y 0 chunks nuevos. Los caminos del asesor siguen filtrando `doc_type=especifico` o `base`; no se hizo E2E autenticado por ausencia de cuenta de prueba autorizada. Ninguna publicación nueva entró automáticamente en esta prueba; esa rama de Eventarc sigue sin validación productiva con un documento inédito.

## Pruebas, despliegue y rollback

- `npm test`: aprobado. `node --test functions/*.test.js`: 88 pruebas aprobadas, incluidas validación de fuente BOG, URL/fecha/código/ámbito/anexo, reclamación idempotente, límites, staging, activación, rollback y recuperación. `node --check` y `git diff --check`: aprobados.
- Firestore Emulator no estaba configurado; las pruebas de transacciones son mocks. La descarga/ingesta de dos PDFs, Storage, Firestore, KNN y evento duplicado se comprobaron realmente en producción.
- Desplegadas únicamente `consultarConvenio` (`us-central1`), `reviewConvenioSources` y `processConvenioDocument` (`europe-west1`). El monitor conserva su Scheduler `0 5 1 * *` Europe/Madrid, audiencia OIDC privada y próxima ejecución `2026-11-01T04:00:00Z`. Eventarc no crea un segundo Scheduler.
- Para pausar el procesador: poner `convenio_monitor_control/document_ingestion.paused=true`; el monitor continúa. Para desactivar una fuente concreta, ejecutar `rollbackChunkSet` sobre sus IDs y catálogo con SHA verificado; la transacción devuelve todos sus chunks a `staged_especifico` y retira solo su referencia del catálogo. Conservar el PDF inmutable y las versiones anteriores. No restaurar el respaldo de estado en bloque: comparar `updateTime` y reparar únicamente el pendiente afectado.

## Limitaciones

El adaptador automático actual cubre PDFs directos de complementos salariales del BOG con evidencia determinista. Los portales BOPB, BOPZ y BOPMA requieren mecanismos distintos; sus URLs se conservan como pendientes. Los textos nuevos 2026–28 de Barcelona y Zaragoza no se activan sin cotejo de texto, anexos y relación normativa. El BOPMA de Málaga no entregó el PDF íntegro por el acceso probado. Las fichas 18 y 27 siguen sin referencia automática acreditada. Un asiento REGCON, el hash o una coincidencia vectorial no confieren vigencia jurídica ni aplicabilidad individual.

## Comprobación productiva del 15/10/2026

Se verificó de nuevo el proyecto `calendario-laboral-252b1`: 28 estados, 26 `source_checked`, dos referencias bloqueadas y ningún pendiente abierto antes de la prueba. El único Scheduler REGCON seguía habilitado para `0 5 1 * *` en `Europe/Madrid`; las tres Functions de convenio estaban `ACTIVE`. El repositorio partió de `af5b590` en `main`, alineado con `origin/main`, con `.playwright-cli/` sin seguimiento.

REGCON devolvió ahora URL oficial en un asiento histórico que en el baseline se había exportado sin enlace. La firma se estabilizó sobre los siete campos de identidad y se conserva compatibilidad con las firmas previas que incluían URL. El monitor también despierta reintentos documentales vencidos en su ejecución mensual aunque la revisión REGCON de esa ficha no venza. El procesador ya no resuelve PDFs sin texto y reintenta códigos transitorios de Gemini/Firestore además de HTTP temporal y presupuesto mensual; agota tres intentos y conserva el bloqueo manual. La política de Cloud Monitoring `Balance Laboral - incidencias automatizacion convenios` estaba habilitada con el canal de correo existente y cubría `convenio_document_pending`, fallos REGCON y HTTP 5xx del procesador.

Se eligió como prueba inédita una revisión salarial **histórica**, no una novedad REGCON: Restauración Gipuzkoa, código `20104585012023`, [BOG de 13/02/2026, `GAO-I-2026-00525`](https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/13/c2600525.pdf). La fila ya estaba en `knownSignatures`. El PDF oficial de dos páginas y 131.811 bytes pasó la clasificación existente; el preflight produjo 14 chunks nuevos y constató ausencia de catálogo y vectores. Se respaldó el estado previo fuera del repositorio en `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\document-processor-restauracion-1792050036324.json` y se añadió solo el pendiente de cotejo histórico. Eventarc lo reclamó y creó 14 embeddings; un segundo procesamiento posterior detectó el mismo SHA y creó 0 chunks. El pendiente quedó `resolved` con dos intentos registrados y el catálogo `hosteleria_gipuzkoa_revision_salarial_2026` con SHA-256 `ddfff0b8ffa83356ba36509f8060b493f9a548b4fc6770b09e13de9a76df3529`. Los 14 chunks quedaron activos, la descarga del objeto privado reprodujo el hash, y KNN filtrado devolvió 5/5 chunks de esa fuente. El E2E autenticado posterior seleccionó el PDF BOG y citó sus chunks; el 5,9 % mencionado en la respuesta consta en el propio anexo. Esta prueba acredita la rama de ingesta inédita para el adaptador BOG, no la automatización de otros boletines ni la vigencia/aplicabilidad individual.

Las pruebas de Functions sumaron 89 casos aprobados. Se actualizaron solo `reviewConvenioSources`, `processConvenioDocument` y `consultarConvenio`; no se cambiaron reglas, índices, Scheduler ni permisos IAM. El E2E del asesor y sus límites constan en `validacion-e2e-asesor-2026.md`.

## Comprobaciones adicionales del 15/10/2026

- **Ingesta inédita por Eventarc:** la revisión salarial de Restauración de Gipuzkoa 2026, código `20104585012023`, se descargó desde el [PDF oficial BOG](https://egoitza.gipuzkoa.eus/gao-bog/castell/bog/2026/02/13/c2600525.pdf). La fila REGCON enlaza exactamente ese PDF. Tiene 2 páginas, SHA-256 `ddfff0b8ffa83356ba36509f8060b493f9a548b4fc6770b09e13de9a76df3529` y anexos III–VII. El catálogo `hosteleria_gipuzkoa_revision_salarial_2026` no existía antes de la prueba. Cloud Logging registró `convenio_document_ingested` a las 07:40:44 UTC con 14 chunks; Firestore dejó el pendiente de `convenio-01` en `resolved`, un intento y `newChunks=14`. Se comprobaron 14/14 vectores activos con el mismo hash, KNN real 5/5 de esa fuente (primer resultado: el propio chunk consultado) y el hash del original privado descargado de Storage. El presupuesto mensual estimado pasó de 5.483 a 8.270 tokens. A las 07:56:52 UTC se repitió el pendiente mediante una nueva actualización Firestore: Eventarc lo resolvió de nuevo con `newChunks=0`, dos intentos acumulados, los mismos 14 vectores y presupuesto inalterado en 8.270 tokens. La primera fecha de resolución se conserva en `firstResolvedAt`; el respaldo previo a la repetición está en `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\eventarc-repeat-2026-10-15T07-56-52-514Z.json`.
- **Transporte Barcelona 2026–2028:** el [PDF oficial BOPB](https://bop.diba.cat/anuncio/ver-pdf/3994991) tiene 93 páginas, CVE `202610145528`, código `08004295011994`, SHA-256 `e81893786bf944d2e42479ab78ad5a0ccc13c305aeb68e880962d10d17f1949b`. El artículo 4 fija efectos a todos los efectos desde 01/01/2026 y periodo pactado hasta 31/12/2028; incluye tablas y anexos. El original privado está en `gs://calendario-laboral-252b1.firebasestorage.app/official-sources/convenios/transporte_barcelona_2026_2028/e81893786bf944d2e42479ab78ad5a0ccc13c305aeb68e880962d10d17f1949b.pdf` (generación `1792050605127458`, 856.930 bytes). Eventarc lo dejó `resolved`; Firestore contiene 488/488 chunks activos y cero `staged`.
- **Transporte Zaragoza 2026–2028:** el [PDF oficial BOPZ individual](https://bop.dpz.es/BOPZ/UploadServlet?ruta=Boletines%5C2026%5C216%5CEdictos%5Cbop_6101_2026.pdf), núm. 216/anuncio 6101, tiene 31 páginas, código `50001115011981`, SHA-256 `2c463c832e87ec1b9f596bb523910899549af8ac63692b2e4ab121c6122b565a`. El artículo 4 separa entrada en vigor general (20/09/2026), efectos económicos generales (01/01/2026) y dietas (01/07/2026). El original privado está en `gs://calendario-laboral-252b1.firebasestorage.app/official-sources/convenios/transporte_zaragoza_2026_2028/2c463c832e87ec1b9f596bb523910899549af8ac63692b2e4ab121c6122b565a.pdf` (generación `1792050685050314`, 542.398 bytes). Eventarc lo dejó `resolved`; Firestore contiene 198/198 chunks activos y cero `staged`.

## Ingesta y verificación de Transporte Barcelona y Zaragoza (15/10/2026)

El código de versionado temporal y el procesador quedaron integrados en los PR #15 y #16. `main` y `origin/main` están en `57eecdb5b264543bb0e7b7144df9d69a128f47ea`. El PR #16 corrigió un fallo reproducible al escribir metadatos opcionales `undefined` en Firestore. La primera ejecución de Barcelona dejó los 488 chunks en `staged`, sin publicarlos; el reintento con el fix reutilizó esos vectores, completó el catálogo y activó el conjunto. No se generaron embeddings repetidos.

| Documento | Chunks/embeddings nuevos | Tokens estimados reservados | KNN real | Estado |
|---|---:|---:|---|---|
| Barcelona 2026–2028 | 488 / 488 | 88.200 | 5/5 resultados del archivo correcto | `resolved`, 488 activos, 0 staged |
| Zaragoza 2026–2028 | 198 / 198 | 37.547 | 5/5 resultados del archivo correcto | `resolved`, 198 activos, 0 staged |

Ambos conjuntos usan `gemini-embedding-001`, 768 dimensiones, índices de chunks completos y el SHA del PDF como `sourceSha256`. Las repeticiones Eventarc devolvieron `newChunks=0`; el conteo de índices y el saldo reservado no cambiaron. En octubre, el presupuesto pasó de 8.270 a **134.017 tokens estimados**, frente al límite mensual de 250.000 (115.983 restantes). El consumo estimado de estos dos documentos es 125.747 tokens. Con el precio estándar publicado de USD 0,15 por millón para `gemini-embedding-001`, el equivalente aproximado es **USD 0,0189**; no es una factura ni incluye Storage/Firestore y el nivel gratuito efectivo depende de la cuenta/API.

Las pruebas del resolutor con el catálogo de producción seleccionan las tablas Barcelona solo para salarios de 2025; el texto nuevo Barcelona para consultas generales/salariales de 2026 y 2027; el texto anterior Zaragoza para 2024; y el texto nuevo Zaragoza para 2026/2027. Una pregunta fechada sobre dietas Zaragoza antes del 01/07/2026 queda sin fuente seleccionable; una pregunta de vigencia general al 19/09/2026 tampoco selecciona prematuramente el texto nuevo. Los documentos históricos no se borraron.

La entrada histórica agregada de Barcelona `transporte_barcelona_2011_2023` conserva 363 vectores pero permanece `unverified`; por eso el resolutor devuelve `source_unverified` para una consulta histórica que solo encuentre esa entrada y `not_found` para convenio general 2025. La publicación salarial 2025 sí está verificada y seleccionable como fuente salarial. No se elevó el PDF agregado a verificado porque no hay una correspondencia inequívoca entre sus páginas/chunks y cada publicación BOPB. Zaragoza conserva 191 vectores históricos 2022–2025 y KNN real; el catálogo histórico no contiene un SHA/procedencia verificados en esta comprobación.

El rollback por fuente es reversible: pausar `convenio_monitor_control/document_ingestion` y aplicar `rollbackChunkSet` solo al `fileName`, SHA y conjunto completo de esa publicación; el helper cambia esos chunks a `staged` y retira únicamente esa fuente del catálogo en una transacción. La prueba unitaria de rollback pasa; no se ejecutó una reversión en producción para conservar ambos textos activos. La copia previa de cuatro documentos de control/estado y ausencia de catálogos quedó fuera del repositorio, con ACL privada, en `C:\Users\mikel\AppData\Local\BalanceLaboral\paso3-firestore-backups\pre-ingest-20261015-114232` (SHA-256 del snapshot `6c623915f043c785a5a9856bb591ccee00e4175cc1bc19aa714f87830209d8f7`).

Las Functions `consultarConvenio` (`consultarconvenio-00044-qot`), `processConvenioDocument` (`processconveniodocument-00007-xiq`) y `reviewConvenioSources` (`reviewconveniosources-00010-yag`) están `ACTIVE`. El Scheduler mensual sigue `ENABLED` con `0 5 1 * *` en `Europe/Madrid`; el trigger Eventarc `processconveniodocument-942300` sigue asociado a `convenio_monitor_state/{agreementId}` y a la identidad `convenio-ingestor`. No hubo cambios de IAM, reglas Firestore, Hosting ni otros proyectos. El SHA interno `firebase-functions-hash` no es un SHA de Git.
- **Avisos:** se creó la política activa de Cloud Monitoring `13741873351838438326`, ligada al canal de correo preexistente. Detecta `convenio_document_pending`, `convenio_monitor_source_failed` y HTTP 5xx del procesador, con límite de un aviso cada seis horas. La configuración se leyó de vuelta; no se generó una incidencia artificial para probar la entrega del correo.
- **Málaga:** las tres URL de tablas de REGCON apuntan a edictos BOPMA de 2024, 2025 y 2026. El sumario oficial de 14/04/2026 identifica el edicto 1187 y su PDF de fascículo, pero la descarga oficial del PDF respondió HTTP 403. No se ingirieron importes.

## Saneamiento de fuentes y seguimiento manual (15/10/2026)

### Hostelería Málaga

La consulta y exportación oficial REGCON del código `29000945011981` confirman publicaciones de tablas salariales con fechas de registro 19/08/2024, 14/05/2025 y 14/04/2026, y enlazan los edictos BOPMA `20240820-02957-2024-00`, `20250514-01559-2025-00` y `20260414-01187-2026-00`. Los sumarios oficiales identifican los anuncios y ofrecen el PDF del fascículo; el enlace individual de 1187/2026 ya había respondido HTTP 403 y la descarga del fascículo de abril no entregó un PDF verificable en esta revisión. No se extrajeron ni incorporaron tablas, no se generaron embeddings y se mantiene el aviso que bloquea salarios exactos no acreditados.

### Limpieza Barcelona / instrumento catalán

REGCON identifica el instrumento `Neteja d'Edificis i Locals de Catalunya`, código `79002415012005`, autoridad Cataluña. Registra el texto nuevo de 23/05/2023, modificación de 02/06/2025, denuncia de 07/07/2025 y acuerdo parcial de 26/02/2026. El código se vincula a la ficha de Barcelona para seguimiento; no se convierte la fuente en un convenio provincial ni se atribuye al resumen local validez oficial.

El DOGC 9613 publicó la Resolució EMT/427/2026, CVE `CVE-DOGC-A-26050075-2026`: acuerdo parcial aplicable desde 01/01/2026, duración pactada hasta 31/12/2030, incremento de 3,25% sobre salarios a 31/12/2025 con efectos retroactivos desde 01/01/2026 y tablas definitivas para 2026. El acuerdo modifica además la estructura salarial, crea un complemento con importes/tablas territoriales y prevé integración progresiva en el salario base. El documento firmado refleja desacuerdo de CCOO con el acuerdo parcial. La verificación digital del DOGC informa que el texto es auténtico e íntegro.

El PDF oficial descargado desde el enlace publicado por el propio portal DOGC tiene 15 páginas, 965.858 bytes y SHA-256 `f091278fd24c989bd3f2ecccf2a0a79c1cd8daedd593508ebebc96e88fa32300`. Se conservó sin modificación en el bucket privado: `gs://calendario-laboral-252b1.firebasestorage.app/official-sources/convenios/limpieza_catalunya_2022_2030/2026-02-26-CVE-DOGC-A-26050075-2026.pdf`, generación `1792087625018247`; sus metadatos registran CVE, URL DOGC, SHA, páginas y tipo `partial_agreement`.

La fuente oficial contiene tablas compartidas Barcelona/Girona/Lleida, tablas diferentes de Tarragona y cambios de texto aplicables al instrumento catalán. Como la búsqueda actual etiqueta el documento por archivo y no segmenta cada disposición/anexo por provincia, no se generaron chunks ni embeddings para activarlo como fuente exclusivamente Barcelona. La publicación está identificada, guardada y seguida por REGCON, pero su indexación queda pendiente de segmentación territorial verificable. El resumen UGT local de 108 chunks queda marcado `unverified` por el código y se excluye del catálogo resoluble; no se borran sus vectores.

### Transporte Navarra e históricos

El instrumento histórico BON de Transporte Navarra se identifica por la Resolución 625/2008, código antiguo `3107405`, BON núm. 111 de 10/09/2008 y corrección núm. 123. La copia local de 98 chunks carece de cotejo de integridad/procedencia con el BON y no acredita sucesor ni vigencia actual; el catálogo se marca `unverified` y el resolver deja de usarla como evidencia. La ficha permanece en revisión manual periódica BON.

El agregado Transporte Barcelona 2011–2023 (363 vectores) y Transporte Zaragoza 2022–2025 (191 vectores) se mantienen excluidos como evidencia no acreditada según los overrides ya existentes. No se borraron vectores ni se generó ninguno nuevo durante este saneamiento.

### Resultado técnico y avisos

El inventario sigue siendo de 28 filas. La ficha 18 tiene seguimiento REGCON mediante el código catalán verificable; la ficha 27 conserva fuente manual BON mensual, bloqueada hasta su próxima revisión. Cuando venza, el monitor registrará `convenio_manual_review_required`; la política existente ya incluye ese evento sin crear un canal ni una política paralela. La política tiene límite de aviso de seis horas.

El canal de correo de Monitoring está habilitado; el estado de verificación no está expuesto por la CLI/API consultada y no se generó un incidente artificial. La política existente se actualizó tras integrar el PR #24 y su filtro incluye `convenio_manual_review_required`. La comprobación productiva del 15/10 ejecutó el Scheduler existente: consultó REGCON para la ficha 18, estableció `source_checked` para `79002415012005`, encontró 0 novedades y dejó la ficha 27 diferida hasta su revisión mensual de noviembre. El run `2026-10-1792088532224-782e4a1b` cerró `partial`: 28 examinados, 1 comprobado, 1 diferido, 0 bloqueados, 0 fallos, 0 entradas nuevas y 0 llamadas/embeddings Gemini. El aviso de entrega al buzón requiere confirmación humana; no se fabricó una incidencia para probarlo.

Tras integrar `dfba30ae01eb839d9f1331da880c113dcb5a855e` quedaron activas `reviewConvenioSources` (`reviewconveniosources-00011-mux`), `processConvenioDocument` (`processconveniodocument-00008-jot`) y `consultarConvenio` (`consultarconvenio-00048-giv`). Scheduler sigue `ENABLED` con `0 5 1 * *` en `Europe/Madrid`; el trigger `processconveniodocument-942300` sigue apuntando a `processConvenioDocument` con la cuenta dedicada `convenio-ingestor`. La revisión productiva no creó pendientes documentales ni ingestas.

**Consumo de esta fase:** 0 llamadas Gemini y 0 embeddings; coste de IA estimado USD 0. El objeto PDF privado se conserva para una futura segmentación, no está activo en el RAG. No se ejecutaron KNN ni E2E porque no se añadieron documentos a recuperación.


### Cierre documental focal — 15/10/2026

**Limpieza Barcelona / acuerdo catalán.** El DOGC 9613 publicó la Resolució EMT/427/2026 (CVE `CVE-DOGC-A-26050075-2026`); la corrección DOGC 9635 de 30/03/2026 (CVE `CVE-DOGC-A-26082046-2026`) rectifica la denominación del acuerdo a 2026–2030. No se infiere que el código REGCON sea provincial: `79002415012005` corresponde a Limpieza de edificios y locales de Cataluña. El PDF oficial de 15 páginas conservado en el bucket privado mantiene SHA-256 `f091278fd24c989bd3f2ecccf2a0a79c1cd8daedd593508ebebc96e88fa32300`.

Se segmentaron únicamente las páginas 10–12, cuyo encabezado asigna expresamente las tablas a Barcelona, Girona y Lleida. La tabla con efectos 01/01–31/08/2026 y la tabla 01/09–31/12/2026 se separaron; las páginas 13–15 de Tarragona y el texto general no se ingirieron. El resultado son **6 chunks activos y 6 embeddings válidos de 768 dimensiones**, con el mismo SHA, publicación DOGC y páginas de origen; no había chunks previos del extracto. Un KNN real en Firestore devolvió 6 resultados. La validación del resolver permite Barcelona (`resolved`) y rechaza Tarragona (`missing_location`); el filtro temporal devolvió solo enero–agosto para 01/03/2026 y solo septiembre–diciembre para 01/10/2026. Ningún fragmento contiene Tarragona ni estado `staged`.

El procesamiento reservó **2 × 1.017 tokens estimados**: la primera generación de 6 vectores se descartó porque Firestore rechazó el campo opcional ausente; tras corregirlo, una segunda generación escribió y activó los 6 chunks completos. No quedó ningún chunk parcial de la primera ejecución. El contador operativo mensual pasó de 134.017 a 136.051 tokens reservados. El importe monetario real no puede deducirse de ese contador ni se consultó una factura. No se hizo E2E del asesor: no había navegador autenticado controlable disponible. La revisión del texto general y su partición por materia/ámbito sigue pendiente; no debe responderse desde las tablas a preguntas no salariales.

**Hostelería Málaga `29000945011981`.** REGCON identifica revisiones salariales del 19/08/2024, 14/05/2025 y 14/04/2026; BOPMA 14/04/2026 enlaza el edicto 1187/2026. En esta pasada, las tres URL individuales oficiales y los fascículos oficiales correspondientes devolvieron HTTP 403 en GET/HEAD ordinarios; el endpoint público del edicto 1187 devolvió 404. El sumario no incluye tablas ni anexos. No se obtuvieron PDFs íntegros, no se calculó SHA y **no se ingresaron importes ni embeddings**. Solicitud manual preparada para BOPMA: “Solicito copia electrónica íntegra y auténtica del edicto BOPMA 1187/2026, publicado el 14/04/2026, incluido el texto de la resolución, todas sus páginas y anexos con las tablas salariales, y confirmación de su CVE/enlace de descarga pública. Solicito asimismo indicar los enlaces de acceso íntegro a los edictos REGCON/BOPMA 2024 `20240820-02957-2024-00`, 2025 `20250514-01559-2025-00` y 2026 `20260414-01187-2026-00`.” Presentar mediante el canal oficial de atención/registro de la Diputación de Málaga; no enviar desde esta sesión. Mantener salarios exactos bloqueados hasta cotejar esos documentos.

**Transporte Navarra.** La búsqueda normal del BON por denominación exacta y por código histórico `3107405` devuelve seis publicaciones entre 2005 y 2008, incluida la Resolución 625/2008 en BON 111 (10/09/2008) y su corrección en BON 123. No se obtuvo una ficha REGCON individual mediante las búsquedas de ese código; el código candidato de 14 dígitos hallado fuera del registro oficial no se adopta. No se encontró publicación sucesora en estas búsquedas; esto no demuestra que no exista, ni acredita ultraactividad o vigencia actual. Se conservan los 98 vectores históricos excluidos como evidencia no verificada. La revisión BON mensual manual de la ficha 27 permanece activa; el asesor no debe afirmar salarios actuales sin fuente completa acreditada.

**Alertas.** La política de incidentes de convenios está habilitada y usa el canal de correo existente; el canal figura habilitado, pero no se verificó recepción en el buzón. No se generó una incidencia artificial en producción. Paso manual pendiente: el destinatario autorizado debe confirmar la recepción de la siguiente notificación legítima en su buzón. Scheduler y Eventarc no se cambiaron.


**Producción tras PR #27 (15/10/2026):** commit integrado `7e6a58ca5ed0a28bd7d01a40142378b6ba359d33`; `consultarConvenio` está Ready en `consultarconvenio-00049-fuv`. No hubo errores `severity>=ERROR` registrados para esa revisión en la comprobación posterior al despliegue. `reviewConvenioSources` sigue en `reviewconveniosources-00011-mux`, `processConvenioDocument` en `processconveniodocument-00008-jot`; Scheduler conserva `0 5 1 * *` (`Europe/Madrid`) y Eventarc sigue apuntando a la Function procesadora con su cuenta dedicada. No se desplegaron monitor ni procesador.
