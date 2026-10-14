# Descarga oficial e ingesta documental de convenios — 2026

Fecha de comprobación: 14/10/2026. Proyecto Firebase: `calendario-laboral-252b1`.

## Resultado

Se incorporaron dos publicaciones complementarias: tablas salariales 2025 de Transporte de mercancías de Barcelona y revisión salarial 2026 de Alojamientos de Gipuzkoa. REGCON enlaza también textos nuevos 2026–2028 para Transporte Barcelona y Zaragoza, publicados en BOPB y BOPZ; ambos quedan pendientes de cotejo de alcance jurídico e ingesta. El sistema conserva versiones anteriores y cada complemento tiene catálogo propio, limitado al año y tipo documental acreditados.

La exportación Excel oficial de REGCON trae URL por asiento. El monitor conserva esa URL únicamente para novedades posteriores al baseline. Un procesador Eventarc separado, probado y activo tras un cotejo histórico idempotente, admite únicamente complementos salariales del BOG con enlace PDF directo, código, sector, provincia, año, identificador y anexo verificables. Otros boletines, textos nuevos y modificaciones ambiguas quedan en revisión manual. La identidad del monitor no recibió permisos adicionales; no se añadió otro Scheduler.

## Comprobación del monitor y fuentes

Antes de la reconciliación, Firestore conservaba 28 estados: 7 `source_checked`, 19 `source_check_failed` con `REGCON_RESULT_INCOMPLETE` y 2 `blocked_missing_official_regcon_reference`. La reconciliación explícita del 14/10 consultó la exportación oficial completa de las 19 fuentes fallidas, estableció su primer baseline sin novedades históricas y conservó los otros nueve estados y la cadencia. Resultado real: **26 `source_checked`, 2 sin referencia, 0 fallos y 0 novedades**. El run `2026-10-1792009478011-ab53cbdd` registra 19 comprobaciones satisfactorias, 2 diferidas y ninguna llamada Gemini. El respaldo previo de 30 documentos de estado/control está fuera del repositorio, en `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\regcon-reconciliation-2026-10-14T20-24-37-975Z-b757bb79.json`, SHA-256 `e585f0fbe5ce377d217289b9bddb0f1a75d0103c4d6541f44947fba1c95827c6`.

Se comprobó el sumario oficial BOPB de 16/03/2026, CVE `202610047645`, y se descargó la copia pública de la publicación desde el detalle REGCON. Sus 151.894 bytes y SHA-256 coinciden exactamente con el PDF del bucket. El acceso HTTP directo al BOPB respondió 403; la procedencia se apoya en el enlace de publicación del propio REGCON y en los datos BOPB, además de la igualdad de bytes.

Otras comprobaciones documentales:

- **Transporte Barcelona:** el detalle REGCON enlaza la publicación BOPB del texto nuevo 2026–28 de 29/09/2026 y ofrece su PDF público. No se activó el texto ni tablas 2026; solo se incorporaron tablas 2025.
- **Transporte Zaragoza:** REGCON enlaza el PDF individual BOPZ del nuevo texto 2026–28 publicado el 19/09/2026. El dominio BOPZ falló la validación TLS directa; REGCON ofrece copia pública. Pendiente de descargar/cotejar texto y anexos y evaluar alcance; no se ingirió.
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
