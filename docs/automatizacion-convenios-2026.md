# Automatización documental de convenios — 2026

## Estado

**Parcial; no desplegado en producción.** Se implementó en esta rama una revisión mensual de asientos públicos de REGCON, con inventario derivado de la matriz de 28 fichas y almacenamiento idempotente de huellas en Firestore. La identidad de servicio de producción y los permisos IAM no están disponibles en este entorno. Por la regla de no usar credenciales personales no se consultó ni modificó Firestore, no se desplegó la Function y no se creó un Cloud Scheduler Job. La primera ejecución de producción y la activación quedan pendientes.

La automatización solo detecta cambios en la página pública de trámites de REGCON. Un asiento detectado es una señal para revisión, no acredita publicación íntegra en boletín, autenticidad del PDF, incorporación al RAG ni vigencia jurídica. No se descargan ni se activan documentos automáticamente en esta fase.

## Arquitectura implementada en código

- `docs/matriz-vigencia-convenios-2026.md` sigue siendo el inventario canónico. El hook `predeploy` genera `functions/convenio-monitor-inventory.generated.json` con sus 28 filas, código REGCON y URL cuando están documentados; no se mantiene una segunda lista manual.
- La Function programada `reviewConvenioSources` usa una sola ejecución mensual (`0 5 1 * *`, `Europe/Madrid`, `europe-west1`, una instancia y una ejecución concurrente). Reutiliza Firebase Admin y Cloud Scheduler, sin dependencias ni servicios nuevos.
- Los convenios con actualizaciones pendientes, estado incompleto o periodo pactado terminado se planifican cada dos meses naturales. Los demás se planifican cada seis meses. El final del periodo pactado solo cambia la frecuencia; nunca desactiva ni sustituye una fuente.
- El proceso consulta únicamente enlaces HTTPS cuyo host, ruta y código coinciden exactamente con REGCON. Rechaza redirecciones, exige HTML, impone timeout de 15 segundos y límite de respuesta de 2 MiB. No llama a Gemini ni genera embeddings.
- `convenio_monitor_state` conserva la huella de cada fila visible, el resumen corto del asiento, fecha, tipo, siguiente revisión y pendientes de cotejo. `convenio_monitor_runs` conserva el resumen mensual (conteos, errores, duración y llamadas/coste de IA). `convenio_monitor_control/monthly_lock` protege ejecuciones simultáneas mediante transacción y lease de dos horas.
- Una lectura correcta establece la línea base en el primer ciclo y guarda las filas visibles como `pending_baseline_reconciliation` para compararlas con el catálogo y los vectores antes de cualquier alta. Las filas posteriores nuevas se guardan como `pending_documentary_verification`; fallos de fuente no actualizan `lastSuccessfulCheckAt`. El estado mensual queda parcial mientras existan pendientes, fuentes inaccesibles o referencias ausentes. Reejecutar un mes terminado es idempotente.
- Los mensajes de Cloud Logging contienen el identificador `convenio-XX`, código público, conteos y códigos de error; no incluyen el HTML descargado, contenido completo ni datos personales.

## Inventario y primera pasada pública

El inventario tiene 28 registros. Veintitrés contienen enlace directo de consulta por código REGCON; cinco requieren resolver código o enlace individual antes de automatizar su revisión: **18 Limpieza Barcelona, 20 Limpieza Sevilla, 23 Transporte Álava, 26 Transporte Gipuzkoa y 27 Transporte Navarra**. Las filas conservan el estado jurídico/documental de la matriz y no se rellenan datos ausentes por inferencia.

El 13/10/2026 se realizó una pasada pública de solo lectura a los 23 enlaces disponibles, en concurrencia máxima de tres peticiones:

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

La matriz se actualizó para Alojamientos Gipuzkoa, Hostelería Málaga y Transporte Barcelona. Otros resultados de la consulta están trazados en la salida de ejecución de esta tarea; la lectura de REGCON no se ha presentado como verificación de boletines.

## Descarga, clasificación e ingesta

**No incorporado ningún documento, chunk ni embedding en esta fase.** No hubo nuevos PDF descargados, no se subieron originales al bucket, no hubo respaldo ni escritura de catálogo/vectores y no se hizo una consulta KNN. No se ejecutó el ingestor porque las nuevas fuentes no se han cotejado con el boletín íntegro y no existe identidad autorizada para Firestore/Storage.

El ingestor existente `functions/ingest-conventios.js` no publica de forma atómica: escribe grupos de vectores y después el catálogo. Por eso no es apto para una ejecución automatizada desde el monitor sin un flujo adicional de staging/activación. Este cambio deliberadamente no lo llama. Una tabla salarial complementaria solo podrá ingerirse cuando el código, ámbito, publicación, PDF completo y relación con el acuerdo estén probados y exista respaldo recuperable; un texto nuevo requiere revisión jurídica/documental antes de activar.

## Costes, identidad y permisos

- Gemini Developer API: **0 llamadas; coste estimado $0.00**.
- Embeddings: **0; coste estimado $0.00**.
- Cloud Storage, Firestore y Scheduler: **sin consumo atribuible a esta prueba**, porque no se ejecutó contra el proyecto. El costo de transferencia de las consultas públicas no está disponible en una fuente de medición.
- En el entorno no está configurada una identidad de servicio explícita para Google Cloud. No se utilizó ninguna sesión personal almacenada de Firebase/gcloud. Se requiere ejecutar la Function con una cuenta de servicio dedicada y conceder solo lectura/escritura en las tres rutas de estado y lectura del resto imprescindible; los permisos actuales de producción no han sido verificados y no se han cambiado.
- No se cambió facturación, reglas de Firestore, secretos, App Check, Hosting ni Functions existentes.

## Reintento, recuperación y revisión manual

- Una fuente fallida queda con `lastErrorCode` y sin fecha de revisión completada; el siguiente ciclo vuelve a intentar la consulta. Los aciertos de otros convenios se conservan.
- El lock vence a las dos horas si la ejecución termina abruptamente. El estado se escribe por convenio y por mes para no duplicar hallazgos al reintentar.
- Los cambios nuevos deben abrir una tarea de revisión documental; no existe un canal de notificación configurado reutilizable confirmado en el repositorio, por lo que no se ha añadido uno.
- Para validar un pendiente: abrir la ficha oficial REGCON → localizar la publicación en el boletín territorial → descargar PDF desde el dominio oficial → comprobar código, ámbito, CVE/número, páginas, anexos, texto extraído y SHA-256 → verificar respaldo en bucket → ejecutar preflight del ingestor → revisar duplicados/metadatos y KNN → activar únicamente mediante un mecanismo atómico revisado. Un hash demuestra igualdad de bytes, no autenticidad ni aplicabilidad jurídica.
- Los cinco registros sin enlace por código deben resolverse desde la matriz y sus boletines antes de declararlos revisados.

## Pruebas y despliegue

- `npm test`: pasó (la prueba existente de métricas registra el error esperado de `GA4_PROPERTY_ID` ausente).
- `npm run test:convenio-monitor --prefix functions`: 6 pruebas aprobadas (inventario, frecuencias, fechas calendario, parsing de categorías, filas duplicadas, restricciones HTTP, baseline y fuentes sin referencia).
- `npm run test:holidays --prefix functions`: 46 pruebas aprobadas.
- `node --check` de los archivos JavaScript modificados y `git diff --check`: aprobado.
- La primera pasada pública no fue una integración autenticada ni una escritura real de producción. No se declara validada la persistencia Firestore, IAM, Scheduler, ingesta, KNN o recuperación RAG.
- No se desplegó `reviewConvenioSources`, no existe tarea Cloud Scheduler creada ni próxima ejecución confirmada, y no se hicieron migraciones de Firestore.
- Commits: `6bb1b6b` (monitor REGCON y Scheduler propuesto) y `a78509b` (informe y matriz). Rama `feat/automatic-convenio-updates` publicada en `origin`.
- PR en borrador: [#11](https://github.com/Urtxe/Calendario-Laboral/pull/11). Se mantiene sin fusionar porque falta la validación de producción y el acceso de identidad de servicio. GitHub CLI no está instalado; se abrió mediante la API autenticada con credencial Git ya configurada, sin imprimir ni guardar el token.
- `main` y `origin/main` permanecen en `9e7b00e`; `.playwright-cli/` continúa ajeno y sin modificaciones.

## Limitaciones y estado requerido para completar

Esta fase implementa detección de metadatos para REGCON, pero no la verificación universal de boletines provinciales, descarga, preservación de PDF, OCR/extracción, clasificación documental, presupuesto de embeddings, activación atómica, KNN posterior ni notificación. Esos componentes requieren accesos/sources específicos y pruebas de recuperación/autorización antes de automatizar ingestas. En particular, BOPMA ha bloqueado la descarga de Málaga y BOPB devolvió 403 al intentar leer los PDF durante esta validación.

Para habilitar producción se necesita una identidad de despliegue/ejecución autorizada no personal, revisar IAM del runtime, conceder permisos mínimos, desplegar solo `reviewConvenioSources`, confirmar el Scheduler y ejecutar una primera lectura Firestore real. La Function al activarse establecerá una línea base con los trámites visibles de las 23 fichas enlazadas, los dejará pendientes de reconciliación y bloqueará cinco fichas; no habrá publicaciones retroactivas etiquetadas como “nuevas” sin comparar primero la fuente contra el catálogo y los documentos ya indexados. El PR #11 está en borrador y no debe fusionarse hasta superar estos pasos.
