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
| 1. Barcelona, salarios 2025 | **FAIL** | BOPB, `transporte_barcelona_tablas_2025` | Citó la publicación correcta, pero asignó a «Oficial 1.ª» €27.454,20; la tabla oficial indica €29.442,65. El «Jefe de Servicio» €42.249,20 sí coincide. |
| 2. Barcelona, convenio 2027 | **PASS** | `Convenio Transporte Barcelona 2026-2028.pdf` | Identificó el convenio nuevo y su periodo; cita visible correcta. |
| 3. Barcelona, salarios 2026 | **PASS** | `Convenio Transporte Barcelona 2026-2028.pdf` | Seleccionó el ejercicio y documento correctos y no usó la tabla 2025. Los importes individuales no se cotejaron externamente en esta ejecución. |
| 4. Barcelona, consulta histórica 2022 | **PASS** | Sin fuente histórica acreditada | Indicó que no podía confirmar el convenio histórico; no presentó el agregado 2011–2023 como fuente verificada. |
| 5. Zaragoza, convenio 2024 | **FAIL** | `Convenio Transporte Zaragoza 2022-2025.pdf` | Afirmó el histórico como aplicable pese a que su procedencia e integridad no estaban verificadas en el catálogo. |
| 6. Zaragoza, convenio 2027 | **PASS** | BOPZ, anuncio 6101/2026 | Identificó la publicación oficial y el periodo 2026–2028; cita correcta. |
| 7. Zaragoza, salarios y dietas 2026 | **FAIL** | BOPZ, anuncio 6101/2026 | Dio efectos salariales generales desde 01/01/2026, pero situó dietas en octubre; el metadato verificado establece 01/07/2026. |
| 8. Alojamientos Gipuzkoa 2026 | **PASS** | `BOG-2026-02-16-20100035012014-revision-salarial-2026.pdf` | Recuperó y citó la revisión oficial BOG 2026. Los importes no se cotejaron independientemente en esta pasada. |
| 9. Restauración Gipuzkoa 2026 | **PASS** | `BOG-2026-02-13-20104585012023-revision-salarial-2026.pdf` | Recuperó la revisión BOG y contestó el incremento publicado de 5,9%; cita correcta. |
| 10. Alojamientos Gipuzkoa, vacaciones | **PASS** | `Convenio Alojamientos GIPUZKOA 2025-2028.pdf` y Estatuto | Usó el texto principal para la cuestión no salarial, no la revisión salarial como sustituto. |
| 11. Limpieza Zaragoza 2027 | **PASS** | `Convenio Limpieza edificios Zaragoza 2026-2029.pdf` | Identificó el convenio nuevo y el periodo aplicable; cita correcta. |
| 12. Limpieza Zaragoza 2024 | **PASS** | `Convenio Limpieza edificios Zaragoza 2022-2025.pdf` | No mezcló el documento 2026–2029. La procedencia histórica no se revalidó independientemente en esta pasada. |
| 13. Estatuto, 15/10/2026 | **FAIL** | `estatuto_trabajadores_parte1.pdf` más chunks de convenio ajenos | El resumen estatutario era temporalmente pertinente, pero la interfaz atribuyó la fuente a «tu convenio» y añadió advertencias de otro convenio. La traza confirmó recuperación de chunks ajenos. |
| 14. Estatuto desde 23/10/2026 | **FAIL** | `estatuto_trabajadores_2026-10-03.pdf` más chunks de convenio ajenos | No aclaró que la fecha consultada aún era futura al 15/10 y mostró etiqueta/advertencia ajenas al Estatuto. |
| 15. Hostelería Málaga, salarios 2026 | **PASS** | Fuentes del catálogo con aviso de documento completo pendiente | Rehusó dar cifras exactas no acreditadas. |
| 16. Transporte Gipuzkoa, salarios 2012 | **PASS** | Sin fuente histórica acreditada para el ejercicio | Reconoció falta de evidencia y no inventó un importe. |

**Primera pasada:** 11 PASS, 5 FAIL, 0 BLOCKED, 0 NOT RUN; 16 consultas reales. La comprobación del caso 1 se cotejó con la [tabla oficial BOPB de 2025](https://bop.diba.cat/anuncio/ver-pdf/3910056), donde Oficial 1.ª figura con €29.442,65 y Jefe de Servicio con €42.249,20.

### Correcciones y revalidación pendiente

Se corrigieron cinco causas reproducibles: (1) el asesor escogía importes de ejemplo sin que se indicara categoría; (2) el histórico de Transporte Zaragoza se trataba como verificado; (3) el modelo infería fechas de dietas de una cláusula general, ignorando la fecha estructurada; (4–5) las consultas solo sobre el Estatuto heredaban el convenio del perfil y no advertían que el 23/10 todavía era futuro. La corrección bloquea el histórico no verificado, aplica metadatos locales también a entradas del catálogo Firestore, separa consultas normativas base del convenio del perfil y refuerza las instrucciones de generación.

Las cinco consultas de regresión (casos 1, 5, 7, 13 y 14) se ejecutarán una vez cada una después de desplegar la corrección; tope total autorizado: 21 consultas reales, sin reintentos adicionales. El estado definitivo de esas cinco filas se anotará aquí tras observar respuestas y trazas de la revisión desplegada. No se presenta su corrección local como una revalidación E2E.

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
