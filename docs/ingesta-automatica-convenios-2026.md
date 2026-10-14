# Descarga oficial e ingesta documental de convenios — 2026

Fecha de comprobación: 14/10/2026. Proyecto Firebase: `calendario-laboral-252b1`.

## Resultado

La primera incorporación real fue una publicación complementaria de tablas salariales 2025 para Transporte de mercancías de Barcelona. No es el convenio 2026–2028 que aparece como asiento REGCON: ese texto sigue pendiente de publicación íntegra verificada. El sistema conserva versiones anteriores y el documento incorporado tiene catálogo propio, limitado al año y tipo documental acreditados.

La ingestión automática desde nuevas revisiones mensuales todavía **no está activada**. El monitor registra novedades REGCON; no existe una fuente oficial uniforme para resolver cada asiento a un PDF, cotejar su ámbito y obtener anexos. No se concedieron permisos de almacenamiento, vectores o Gemini a la identidad limitada del monitor. La CLI del ingestor permite procesar fuentes acreditadas, pero no se conectó al monitor ni se añadió un segundo Scheduler.

## Comprobación del monitor y fuentes

Antes de la reconciliación, Firestore conservaba 28 estados: 7 `source_checked`, 19 `source_check_failed` con `REGCON_RESULT_INCOMPLETE` y 2 `blocked_missing_official_regcon_reference`. La reconciliación explícita del 14/10 consultó la exportación oficial completa de las 19 fuentes fallidas, estableció su primer baseline sin novedades históricas y conservó los otros nueve estados y la cadencia. Resultado real: **26 `source_checked`, 2 sin referencia, 0 fallos y 0 novedades**. El run `2026-10-1792009478011-ab53cbdd` registra 19 comprobaciones satisfactorias, 2 diferidas y ninguna llamada Gemini. El respaldo previo de 30 documentos de estado/control está fuera del repositorio, en `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\regcon-reconciliation-2026-10-14T20-24-37-975Z-b757bb79.json`, SHA-256 `e585f0fbe5ce377d217289b9bddb0f1a75d0103c4d6541f44947fba1c95827c6`.

Se comprobó el sumario oficial BOPB del 16/03/2026 y el PDF de cinco páginas indexado en su dominio para el código `08004295011994`, CVE `202610047645`. El PDF conservado en el bucket contiene ese código, CVE y tablas, y su SHA-256 coincide con la copia local que ya constaba en la matriz. La descarga HTTP directa del BOPB respondió 403 durante esta ejecución; el hash acredita los bytes del expediente, mientras que la identidad y publicación se apoyan en el propio BOPB.

Otras comprobaciones documentales:

- **Transporte Barcelona:** el asiento REGCON 2026–2028 no sustituye al documento publicado. Solo se incorporaron las tablas 2025; texto nuevo y tablas 2026 están pendientes.
- **Transporte Zaragoza:** se encontró referencia oficial a prórroga/modificación del instrumento 2022–2024, no publicación íntegra verificada de un nuevo texto 2026–2028. Pendiente.
- **Hostelería Málaga:** el sumario BOPMA identifica el edicto 1187/2026, 14/04/2026; el endpoint del edicto devolvió 403. No se importaron tablas ni importes. Los documentos de 19/08/2024 y 14/05/2025 quedan por cotejar en sus PDF oficiales íntegros.
- **Alojamientos Gipuzkoa:** REGCON registra revisión el 16/02/2026; no se obtuvo el anexo BOG íntegro durante esta comprobación. Pendiente.
- **Resto de las 28 fichas:** no se realizó una descarga/publicación oficial íntegra para cada una; los asientos del monitor no equivalen a publicación documental. No se presenta un barrido documental de 28 como completado.

## Documento incorporado

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

El objeto de Storage se creó sin sobrescritura (`ifGenerationMatch=0`). La descarga de verificación desde el bucket conservó los mismos bytes y hash. El hash acredita igualdad de bytes, no autenticidad jurídica ni aplicabilidad individual. El PDF completo del convenio no se reemplazó ni modificó.

## Preparación, activación y recuperación

`functions/official-convenio-document.js` limita descargas a HTTPS y hosts oficiales permitidos, rechaza redirecciones, aplica timeout y máximo de 25 MiB, valida tipo y firma PDF, y calcula SHA-256. Los originales se conservan con escritura inmutable en el bucket privado existente.

El ingestor acepta únicamente fuentes con metadatos explícitos de verificación, código, publicación y elegibilidad determinista. Valida PDF, páginas, texto, hashes y dimensiones. Los chunks nuevos se escriben con `doc_type=staged_especifico`; las rutas existentes de recuperación solo consultan `especifico` o `base`, por lo que el conjunto incompleto no aparece en RAG. Tras comprobar el conjunto íntegro (índices, checksum, metadatos y vectores), cambia todos los chunks a activos en una transacción Firestore (límite de 499 chunks). El catálogo se actualiza antes del punto de activación. Se conservan IDs y versiones anteriores.

Existe operación de rollback para volver a staged el conjunto identificado y retirar solo la fuente correspondiente del catálogo. No se borra el PDF ni versiones previas. Los documentos mayores que el límite atómico se detienen antes de generar embeddings y requieren un mecanismo transaccional por manifiesto antes de aceptarse.

La tabla salarial se filtra en el resolver y solo puede participar en consultas salariales. La recuperación fue comprobada en producción: una búsqueda KNN real devolvió 5/5 chunks del archivo y SHA esperados; una pregunta de jornada no resolvió ese documento, una consulta salarial de 2025 sí, y una consulta salarial de 2026 no. Se activó un aviso para consultas de salario actual sin año porque la evidencia solo alcanza 2025. No se ejecutó una consulta autenticada completa al asesor; no había cuenta de prueba autorizada disponible.

## Presupuesto y seguridad

El documento incorporó 16 embeddings en una sola operación por lotes. El presupuesto Firestore registró aproximadamente **2.787 tokens estimados** en `convenio_monitor_control/ingestion_budget_2026-10`. Con el precio público de Gemini Embedding 001 en lotes, la estimación del embedding del documento es aproximadamente **USD 0,00021**; más una consulta KNN de verificación, el coste variable de esta prueba sigue siendo inferior a un céntimo. Es una estimación basada en caracteres, no una medición de factura; consulta de precios: [Google AI pricing](https://ai.google.dev/gemini-api/docs/pricing?hl=es). El límite está configurado a 250.000 tokens estimados por mes y 50.000 por documento.

No se descargaron claves JSON ni se imprimió el secreto Gemini. Se usó el secreto existente solo en el proceso local de ingesta y se retiró de su entorno al terminar. No se modificó IAM del monitor, reglas Firestore, App Check, facturación, Hosting ni catálogo de usuarios. El bucket sigue sin acceso público. No se creó una nueva identidad o servicio.

## Pruebas y producción

- `npm test`: aprobado.
- `node --test functions/*.test.js`: 83 pruebas aprobadas; incluye mocks de descarga, validación, presupuesto, staging, activación, idempotencia, concurrencia y rollback.
- `npm --prefix functions run test:convenio-monitor`: 11 pruebas aprobadas.
- `node --check` en los archivos JavaScript modificados y `git diff --check`: aprobados.
- No hay emulador Firestore configurado. Las pruebas unitarias de transacciones son mocks; la ingesta real, la verificación del objeto y el KNN sí usaron Firestore/Storage/embeddings de producción. No se declara E2E autenticado del asesor.
- En producción se incorporó un documento, 16 chunks y 16 embeddings; se verificaron el catálogo, sus metadatos, los vectores y KNN. No se ejecutó el monitor ni se modificaron sus 28 estados.
- Se desplegó solo `consultarConvenio` en `us-central1`; está `ACTIVE` desde 14/10/2026 20:16 UTC. Una petición HTTP sin Firebase Auth devolvió 401 (`Debes iniciar sesión para usar la consulta IA`). El servicio conserva el invocador de Cloud Run existente, pero el código exige sesión Firebase antes de cuotas o IA. No se desplegó monitor ni ingestor como función.
- Scheduler del monitor: único job, `ENABLED`, `0 5 1 * *`, `Europe/Madrid`; próxima ejecución reportada por Cloud Scheduler: `2026-11-01T04:00:00Z` (05:00 CET). URI y audiencia OIDC coinciden: `https://reviewconveniosources-sbp2cbr34q-ew.a.run.app/`; SA `convenio-monitor@calendario-laboral-252b1.iam.gserviceaccount.com`.
- Rama `feat/convenio-document-ingestion` y PR #12: https://github.com/Urtxe/Calendario-Laboral/pull/12. Este PR cubre la ingesta acreditada, el filtrado salarial y la reconciliación REGCON. La conexión automática monitor→descubrimiento→ingesta requiere una entrega separada con sus propios controles.

## Pendientes y rollback

La búsqueda de publicaciones oficiales de los 28, la resolución automática de URL/boletín, los anexos, la clasificación general y el acoplamiento seguro al monitor siguen pendientes. Los nuevos convenios y modificaciones ambiguas requieren revisión. No se activa automáticamente vigencia jurídica.

Para retirar la publicación ingesta, primero desactivar/retirar en el catálogo la fuente con el mismo SHA y después ejecutar el rollback de sus 16 IDs de chunk. Mantener el objeto inmutable como respaldo hasta confirmar que las consultas no recuperan esos vectores. No eliminar ni modificar documentos históricos. La próxima iteración debe integrar un descubridor oficial verificable y una identidad separada de ingesta antes de habilitar procesamiento automático desde Scheduler.
