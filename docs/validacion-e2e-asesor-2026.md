# Validación end-to-end del asesor laboral — 13/10/2026

## Resultado

**Estado general: BLOCKED para las cinco consultas Gemini autenticadas.** La función de producción exige Firebase Auth antes de reservar cuota, leer el RAG o invocar Gemini. No se encontró ni se proporcionó una identidad de prueba autorizada o sus credenciales. El registro público crea un usuario de Firebase Auth y un documento `usuarios/{uid}` en producción, por lo que no se usó para fabricar una cuenta de prueba. No se usaron credenciales personales para iniciar sesión, no se crearon usuarios y no se enviaron consultas con datos reales.

Se verificó de forma segura el rechazo sin autenticación: el endpoint activo respondió HTTP 401 y Cloud Logging registró `consultarConvenio_result`, latencia 2 ms, `requestId` presente y `quotaConsumed=false`. Esto confirma el control de acceso; no prueba el recorrido RAG ni Gemini.

## Casos solicitados

| Caso | Autenticación real / HTTP | Convenio o norma y versión | Chunks | Gemini / citas | Resultado | Corrección |
|---|---|---|---:|---|---|---|
| Zaragoza limpieza 2027 | Ninguna cuenta autorizada disponible. No enviado; HTTP N/A. | Esperado por el resolver: `50000755011981`, `limpieza_zaragoza_2026_2029`, fuente BOPZ 216/2026, anuncio 6181. | N/A; no hubo recuperación en esta ejecución. | Sin llamada ni respuesta o citas que validar. | **BLOCKED** | Añadida traza segura para registrar convenio, archivo y chunks en futuras consultas autorizadas. |
| Zaragoza limpieza 2024 | Ninguna cuenta autorizada disponible. No enviado; HTTP N/A. | El resolver debería seleccionar la ficha 2022–2025. La documentación de origen no determina por sí sola la aplicabilidad jurídica de 2024. | N/A. | Sin llamada; no se puede validar mezcla de ediciones ni citas. | **BLOCKED** | Igual que arriba. |
| Estatuto, 15/10/2026 | Ninguna cuenta autorizada disponible. No enviado; HTTP N/A. | Según el selector local: `PUB-DT-2025-139`, partes 1 y 2; la edición del 03/10/2026 aún no entra en vigor. | N/A. | Sin llamada; no se validó la respuesta de Gemini. | **BLOCKED** | Igual que arriba. |
| Estatuto, 24/10/2026 | Ninguna cuenta autorizada disponible. No enviado; HTTP N/A. | Según el selector: consolidación BOE del 03/10/2026, con fecha objetivo 24/10/2026. La fecha es futura al momento de esta ejecución (13/10/2026); no se cambió el reloj. | N/A. | Sin llamada; no se validó respuesta, cita ni tratamiento prospectivo. | **BLOCKED** | Igual que arriba. |
| Hostelería Málaga, salario 2026 | Ninguna cuenta autorizada disponible. No enviado; HTTP N/A. | El catálogo agrupa el convenio de hostelería de Málaga; consta aviso por las tablas de 2026, edicto BOPMA 1187/2026, cuyo contenido completo no está cotejado/indexado en el proyecto. | N/A. | Sin llamada. La protección local existente bloquea este caso antes de cuota/Gemini; su test unitario pasó, pero no es prueba E2E. | **BLOCKED** | Igual que arriba. No se inventó ni contrastó importe alguno. |

**Consultas completas a Gemini: 0/5.** Ningún caso se declara PASS por pruebas unitarias, KNN previo o respuesta HTTP sin autenticación.

## Evidencia técnica y límites

- Proyecto Firebase configurado: `calendario-laboral-252b1`. `consultarConvenio` es Gen 2, Node.js 22, `us-central1`. Tras el despliegue de esta validación, Cloud Run mostró `Ready=True`, revisión `consultarconvenio-00031-jus`.
- Smoke no autenticado a `https://us-central1-calendario-laboral-252b1.cloudfunctions.net/consultarConvenio`: HTTP 401. El evento de App Check indicó `missing`; `APP_CHECK_ENFORCEMENT=false`. Cloud Run no define la variable y el código aplica ese valor por defecto. App Check no se debilitó durante esta tarea. Auth sí detuvo la petición antes de cuota, recuperación o generación.
- Los informes previos (`incorporacion-rag-zaragoza-estatuto-2026.md` y `cierre-saneamiento-convenios-2026.md`) registran 9.452 vectores, la incorporación de Zaragoza y Estatuto, KNN filtrado real e idempotencia. Es evidencia previa, no una nueva lectura del estado de Firestore en esta ejecución; aquí no se consultó Firestore con credenciales administrativas.
- El evento nuevo `consultarConvenio_retrieval` registra `requestId`, ID/código de catálogo, nombres de archivo, edición y fecha del Estatuto, modelo configurado e IDs/índices/tipo/método de recuperación. El evento no guarda pregunta, texto del chunk, UID, ID token ni token App Check. El resultado mantiene duración, estado, ruta del modelo y número de chunks.
- Estado del repositorio antes del trabajo: `main` en `6f94a51`, alineada con `origin/main`; `.playwright-cli/` ya estaba sin seguimiento y se preservó. La rama de esta tarea es `test/asesor-rag-production-e2e-2026`.

## Contraste con fuentes oficiales

- El PDF local validado en la incorporación anterior se identificó como BOPZ 216/2026, anuncio 6181, código `50000755011981`; allí se anotaron 33 páginas, ámbitos y tablas 2026–2029. El documento de la incorporación enlaza la [publicación del BOPZ](https://bop.dpz.es/BOPZ/UploadServlet?ruta=Boletines%5C2026%5C216%5Cbop.pdf). No se recuperaron chunks ni se cotejaron importes en esta ejecución.
- El [BOE identifica la consolidación del Estatuto publicada el 03/10/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430&lang=es&p=20261003&tn=2) como informativa. La [Ley 4/2026 publicada en el BOE](https://www.boe.es/eli/es/l/2026/10/01/4/dof/spa/pdf) modifica el artículo 37.6 y establece entrada en vigor el 23/10/2026; el [historial del Estatuto](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430&tn=1) marca esa redacción como no vigente antes de esa fecha. Estas fuentes confirman el límite temporal, no que Gemini lo respete en una respuesta real.
- El [sumario oficial BOPMA de 14/04/2026](https://www.bopmalaga.es/sumario.php?fecha=14-04-2026) registra el edicto 1187/2026 sobre tablas salariales de hostelería. No se comprobó el texto íntegro del edicto ni ningún salario.

## Cambio, pruebas, despliegue y coste

- Cambio: se añadió UUID de solicitud a los logs de resultado y App Check y un evento mínimo con selección documental y chunks recuperados, sin prompts ni datos de usuario. No cambian las reglas, cuotas, filtros ni datos de Firestore.
- Tests: `node --check functions/index.js`, `node functions/ai-consultation.test.js` (14 comprobaciones), `node functions/convenio-metadata.test.js`, `npm test` y `git diff --check` pasaron. Analytics imprime el caso esperado de configuración ausente `GA4_PROPERTY_ID`; su suite finalizó correctamente.
- Despliegue: únicamente `consultarConvenio` a `calendario-laboral-252b1`; revisión activa `consultarconvenio-00031-jus`, `Ready=True`. No se desplegaron Hosting, reglas, índices ni otras funciones. Smoke posterior: HTTP 401.
- Coste: 0 llamadas a Gemini, 0 embeddings y 0 consultas vectoriales atribuibles a esta ejecución; coste de Gemini atribuible: USD 0. No se obtuvo una factura por Cloud Build, Cloud Run o Cloud Logging.
- Git/PR: rama `test/asesor-rag-production-e2e-2026`; commits `fb9797d` (instrumentación y regresión) y `4c1b9ab` (informe). PR [#8](https://github.com/Urtxe/Calendario-Laboral/pull/8) integrada en `main` mediante merge `0f3a3be701447823885603d2a37895f6e5df6675`. Tras el merge, `main` y `origin/main` se comprobaron alineadas en `0f3a3be`. La corrección del metadato de integración del informe quedó incluida después mediante el PR docs-only [#9](https://github.com/Urtxe/Calendario-Laboral/pull/9).

## Pendiente

La ejecución autenticada descrita más abajo es histórica y corresponde a `consultarConvenio` `00031-jus`. Para validar la revisión actual `00044-qot` hace falta una identidad de prueba autorizada y App Check conforme a la configuración vigente, sin compartir credenciales personales. Las pruebas fechadas 24/10 solo validan selección prospectiva, no vigencia actual antes del 23/10/2026.

## Revalidación E2E autenticada en producción (15/10/2026)

**Entorno:** `https://balancelaboral.es`, producción `calendario-laboral-252b1`, revisión inicial `consultarconvenio-00044-qot`; interfaz visible controlada con Playwright CLI en una sesión Edge autenticada por el propietario. No se leyeron ni registraron identificadores, credenciales, cookies o tokens. Auth y App Check siguieron el flujo normal. Se enviaron 16 consultas reales a Gemini y se relacionaron con eventos `consultarConvenio_retrieval` por `requestId`, fuente y chunks; el navegador mostró respuestas y citas. No se cambiaron datos de Firestore ni se generaron embeddings de documentos.

### Primera pasada

| Caso | Estado | Fuente seleccionada | Resultado observado |
|---|---|---|---|
| 1. Barcelona, salarios 2025 | **FAIL → PASS** | BOPB, `transporte_barcelona_tablas_2025` | Primera respuesta asignó a «Oficial 1.ª» €27.454,20. Tras el cambio, la respuesta identifica la tabla BOPB definitiva de 2025 y las categorías, sin inventar un importe de categoría no solicitada. La tabla oficial indica Oficial 1.ª €29.442,65 y Jefe de Servicio €42.249,20. |
| 2. Barcelona, convenio 2027 | **PASS** | `Convenio Transporte Barcelona 2026-2028.pdf` | Identificó el convenio nuevo y su periodo; cita visible correcta. |
| 3. Barcelona, salarios 2026 | **PASS** | `Convenio Transporte Barcelona 2026-2028.pdf` | Seleccionó el ejercicio y documento correctos y no usó la tabla 2025. Los importes individuales no se cotejaron externamente en esta ejecución. |
| 4. Barcelona, consulta histórica 2022 | **PASS** | Sin fuente histórica acreditada | Indicó que no podía confirmar el convenio histórico; no presentó el agregado 2011–2023 como fuente verificada. |
| 5. Zaragoza, convenio 2024 | **FAIL → PASS** | No se recuperó fuente histórica verificada | Tras el cambio, informó que no podía confirmar la edición; no presentó el documento agregado como fuente verificada. |
| 6. Zaragoza, convenio 2027 | **PASS** | BOPZ, anuncio 6101/2026 | Identificó la publicación oficial y el periodo 2026–2028; cita correcta. |
| 7. Zaragoza, salarios y dietas 2026 | **FAIL → PASS** | BOPZ, anuncio 6101/2026; `Convenio Transporte Zaragoza 2026-2028.pdf` | Tras el cambio, citó salarios desde 01/01/2026 y dietas desde 01/07/2026; también mostró que la entrada en vigor general es 20/09/2026. La traza confirmó solo chunks del convenio oficial. |
| 8. Alojamientos Gipuzkoa 2026 | **PASS** | `BOG-2026-02-16-20100035012014-revision-salarial-2026.pdf` | Recuperó y citó la revisión oficial BOG 2026. Los importes no se cotejaron independientemente en esta pasada. |
| 9. Restauración Gipuzkoa 2026 | **PASS** | `BOG-2026-02-13-20104585012023-revision-salarial-2026.pdf` | Recuperó la revisión BOG y contestó el incremento publicado de 5,9%; cita correcta. |
| 10. Alojamientos Gipuzkoa, vacaciones | **PASS** | `Convenio Alojamientos GIPUZKOA 2025-2028.pdf` y Estatuto | Usó el texto principal para la cuestión no salarial, no la revisión salarial como sustituto. |
| 11. Limpieza Zaragoza 2027 | **PASS** | `Convenio Limpieza edificios Zaragoza 2026-2029.pdf` | Identificó el convenio nuevo y el periodo aplicable; cita correcta. |
| 12. Limpieza Zaragoza 2024 | **PASS** | `Convenio Limpieza edificios Zaragoza 2022-2025.pdf` | No mezcló el documento 2026–2029. La procedencia histórica no se revalidó independientemente en esta pasada. |
| 13. Estatuto, 15/10/2026 | **FAIL → PASS** | `estatuto_trabajadores_parte1.pdf`, edición `PUB-DT-2025-139` | Tras el cambio, respondió con la edición anterior y etiqueta de normativa general; la traza contiene únicamente chunks de Estatuto y no advierte sobre otro convenio. |
| 14. Estatuto desde 23/10/2026 | **FAIL en `00046-puw`** | `estatuto_trabajadores_2026-10-03.pdf`, edición BOE-A-2015-11430 consolidada al 03/10; fecha objetivo 23/10/2026 | Una consulta autenticada real citó este archivo y describió la redacción prevista, pero no dijo que el 23/10 era futuro respecto del 15/10 ni distinguió la redacción vigente hasta el 22/10. La traza (`requestId` `fa53e9fa-4d85-41e6-bc28-f69377e43551`) confirma 5 chunks `base`, únicamente del Estatuto, edición correcta y `targetDate=2026-10-23`. Se encontró que la corrección de `00046-puw` solo cubría el fallback de evidencia insuficiente, no respuestas Gemini utilizables. |
| 15. Hostelería Málaga, salarios 2026 | **PASS** | Fuentes del catálogo con aviso de documento completo pendiente | Rehusó dar cifras exactas no acreditadas. |
| 16. Transporte Gipuzkoa, salarios 2012 | **PASS** | Sin fuente histórica acreditada para el ejercicio | Reconoció falta de evidencia y no inventó un importe. |

**Primera pasada:** 11 PASS, 5 FAIL, 0 BLOCKED, 0 NOT RUN; 16 consultas reales. La comprobación del caso 1 se cotejó con la [tabla oficial BOPB de 2025](https://bop.diba.cat/anuncio/ver-pdf/3910056), donde Oficial 1.ª figura con €29.442,65 y Jefe de Servicio con €42.249,20.

### Correcciones y revalidación

Las cinco consultas de regresión (casos 1, 5, 7, 13 y 14) se ejecutaron una vez cada una contra `consultarconvenio-00045-ves`, después de desplegar el commit `cdbe861`. Los cuatro primeros casos se corrigieron y pasaron en la interfaz. El caso 14 se abstuvo correctamente de afirmar el contenido futuro, y la traza confirmó la selección temporal correcta, pero no explicó que la fecha era futura. Se añadió una respuesta determinista para el fallback, se cubrió con test local y se desplegó desde `main` (`a8a4dd7`) en `00046-puw`.

**Resultado E2E observado antes de la revalidación final:** 15 PASS, 1 FAIL, 0 BLOCKED, 0 NOT RUN considerando los 16 escenarios y los reintentos; 22 consultas reales. En esa verificación, la consulta autorizada del caso 14 contra `00046-puw` falló en el aviso temporal. La causa fue que el prefijo determinista solo se aplicaba al fallback; las respuestas Gemini utilizables omitían la fecha. El PR [#21](https://github.com/Urtxe/Calendario-Laboral/pull/21) añadió un prefijo temporal obligatorio a toda respuesta generada del Estatuto cuya fecha seleccionada sea futura, con test de regresión, y se desplegó en `consultarconvenio-00047-ruz` desde el merge `64683bd`. La revalidación final de `00047-ruz` se registra abajo.

## Historial: ejecución autenticada, 15/10/2026 (`00031-jus`)

La solicitud actual autorizó la comprobación E2E. Se creó una identidad temporal de Firebase Auth y un perfil gratuito solo para las consultas, se obtuvo su ID token mediante Firebase Authentication y se eliminaron el usuario y sus datos al terminar. App Check seguía sin exigencia en la Function; no se alteró esa configuración. Cada petición fue HTTP 200. Los resultados observados fueron:

| Caso | Selección y resultado |
|---|---|
| Restauración Gipuzkoa, revisión salarial 2026 | `convenio`; seleccionó el BOG `GAO-I-2026-00525`, citó sus chunks y respondió el incremento del 5,9 %, presente en el anexo. |
| Limpieza Zaragoza 2024 | `convenio`; seleccionó solo el PDF 2022–2025 y respondió la jornada anual de 1.774 horas. |
| Limpieza Zaragoza 2027 | Tras corregir la exportación ausente de `hasSemanticEvidence` y ampliar la generación, `convenio`; seleccionó el PDF 2026–2029, citó también el Estatuto como base y respondió 1.758 horas de jornada anual. La primera ejecución había terminado en una respuesta general errónea; esa salida se cerró para consultas con convenio identificado. |
| Estatuto, artículo 37.6, 15/10/2026 | Tras ampliar la búsqueda por la materia del apartado, seleccionó `PUB-DT-2025-139`, recuperó el texto correspondiente y respondió con cita a `estatuto_trabajadores_parte1.pdf`: sujetos protegidos, reducción entre un octavo y la mitad, disminución salarial y supuesto de enfermedad grave. La primera respuesta con cita fue incompleta; se repitió tras precisar la instrucción de resumir límites y supuestos. |
| Estatuto, artículo 37.6, 24/10/2026 | Seleccionó prospectivamente la consolidación BOE del 03/10/2026, recuperó los chunks del apartado y respondió con cita a esa edición. Es una prueba de selección prospectiva; no acredita vigencia actual a fecha 15/10/2026. |
| Hostelería Málaga, salario 2026 | `unconfirmed`; la protección contra tablas no indexadas actuó antes de dar un importe. |

Se corrigió el detector de “revisión salarial”, la recuperación RAG de la norma base y el tratamiento de respuestas truncadas. Una salida `MAX_TOKENS` ya no se marca como fundamentada; si se ha identificado un convenio, se pide uno que no tiene fuente verificada o se pide el Estatuto y no hay respuesta fundada, se devuelve `unconfirmed` en lugar de generar una afirmación general sin citas. La consulta del artículo 37.6 necesitó enriquecer la búsqueda con la materia del apartado y pedir una explicación que incluya límites y supuestos; las dos ediciones dieron después respuestas finales con sus fuentes respectivas. Las identidades temporales se eliminaron tras cada pasada.

## Cierre final del caso 14 (15/10/2026)

**Resultado: PASS.** Se realizó una única consulta autenticada real en `https://balancelaboral.es`, el 15/10/2026 a las 17:35 (hora de Madrid), contra `consultarconvenio-00047-ruz`. No se repitieron los otros escenarios.

Pregunta: «¿Qué establece el artículo 37.6 del Estatuto de los Trabajadores a partir del 23 de octubre de 2026?» La respuesta visible indicó que al 15/10/2026 seguía vigente la redacción anterior, que el 23/10/2026 era una fecha futura y que el texto descrito era el previsto para esa fecha, no el vigente entonces. Resumió la reducción por cuidado y los supuestos reforzados de gran discapacidad/dependencia y corresponsabilidad parental; no mezcló convenios sectoriales. La cita visible identificó `BOE-A-2015-11430` y la edición consolidada de 03/10/2026.

Cloud Logging relaciona la consulta con `requestId=0941790f-de65-4c73-827e-180662c836ea`: revisión `consultarconvenio-00047-ruz`, estado 200, ruta `statute_rag`, `targetDate=2026-10-23`, edición `BOE-A-2015-11430-consolidated-2026-10-03`, cinco chunks `base` de `estatuto_trabajadores_2026-10-03.pdf` y ningún archivo de convenio seleccionado. App Check registró estado `valid`; la cuota confirmó una única llamada consumida. No se consultó ni modificó Firestore documental y no se generaron embeddings.

El contenido y el marco temporal se cotejaron con la [Ley 4/2026 publicada en el BOE](https://www.boe.es/eli/es/l/2026/10/01/4/dof/spa/pdf) y el [texto consolidado oficial del Estatuto](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430&lang=es&p=20261003&tn=1). La Ley 4/2026 modifica el apartado 6 y entra en vigor veinte días después de su publicación en el BOE de 03/10/2026; el texto consolidado identifica el 23/10/2026 como entrada en vigor y lo marca como todavía no vigente. El resumen del asesor concuerda con la modificación oficial y no la presenta como vigente anticipadamente.

### Resultado final acumulado

| Casos | Última revisión con resultado PASS |
|---|---|
| 1, 5, 7 y 13 (regresiones corregidas) | `consultarconvenio-00045-ves` |
| 2–4, 6, 8–12, 15–16 | `consultarconvenio-00044-qot` |
| 14 (revalidación final) | `consultarconvenio-00047-ruz` |

**Total final: 16 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN en los 16 escenarios.** Se acumulan 23 consultas reales a Gemini: 22 previas y una única consulta para este cierre. Coste incremental estimado de esta consulta: inferior a USD 0,01; coste acumulado estimado: inferior a USD 0,12. Es una estimación operativa, no una medición de factura.

## Revalidación focal tras saneamiento de fuentes (15/10/2026)

El PR #24 desplegó overrides que excluyen del resolver la copia no cotejada de Limpieza Barcelona y la copia histórica de Transporte Navarra. Se intentó preparar una comprobación autenticada focal en producción para estas dos rutas, contra `consultarconvenio-00048-giv`:

| Escenario | Estado | Entorno / motivo |
|---|---|---|
| Limpieza Barcelona, consulta sobre el convenio identificado en la ficha | BLOCKED | Producción. La superficie de navegador controlable devolvió `apps=[]`, `browsers=[]`; el navegador IAB no estaba disponible y el proceso Edge no exponía un puerto de depuración. No se pudo enviar la pregunta ni observar la respuesta autenticada. |
| Transporte Navarra, consulta histórica 2007–2008 | BLOCKED | Producción. Mismo bloqueo de navegador; no se envió la pregunta ni se consumió Gemini. |

La resolución unitaria de `source_unverified` y los overrides pasan en `convenio-metadata.test.js`; esto no sustituye la validación de las respuestas visibles del asesor. Los 16 escenarios de la tabla anterior conservan sus resultados históricos; esta revalidación adicional no se cuenta como PASS ni altera su denominador. Consultas Gemini adicionales: 0; coste incremental: USD 0 estimado. Para repetirla se necesita una sesión de navegador autenticada expuesta a la herramienta de control aprobada, sin exportar cookies ni tokens.

## Cierre focal de fuentes Barcelona, Málaga y Navarra — 15/10/2026

No se pudo controlar una sesión de navegador autenticada en este entorno (`apps=[]`, `browsers=[]`); no se enviaron preguntas al asesor ni se consumió Gemini. Las comprobaciones de resolver/KNN indicadas abajo son pruebas locales y de Firestore, no E2E de respuesta generativa.

| Escenario focal | Estado | Evidencia disponible | Pendiente |
|---|---|---|---|
| Limpieza Barcelona 2026, selección territorial y tablas | BLOCKED (E2E) | Resolver local: Barcelona `resolved`, Tarragona `missing_location`; KNN Firestore: 6/6; fechas 01/03 y 01/10 seleccionaron rangos separados. | Ejecutar con sesión de prueba autenticada y revisar respuesta/citas visibles después del despliegue del código integrado. |
| Hostelería Málaga 2026, importes o abstención | BLOCKED (E2E) | No se obtuvo el PDF oficial íntegro; el sistema no recibió consulta en esta pasada. | Obtener texto/anexos oficiales del BOPMA y probar respuesta auténtica; no aceptar cifras no cotejadas. |
| Transporte Navarra, fuente actual o abstención | BLOCKED (E2E) | BON acredita publicaciones históricas 2005–2008; no se halló sucesor en las búsquedas realizadas. No se atribuye vigencia ni salario actual. | Revisión BON mensual y prueba autenticada de abstención cuando el navegador de pruebas esté disponible. |

Consultas Gemini generativas de estos tres escenarios: 0. El presupuesto de la ingesta de tablas Barcelona se registra por separado en `ingesta-automatica-convenios-2026.md`.
