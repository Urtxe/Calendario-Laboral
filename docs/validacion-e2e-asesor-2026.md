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

## Revalidación de los 16 casos solicitados (15/10/2026)

**Entorno:** producción `calendario-laboral-252b1`, revisión `consultarconvenio-00044-qot`. **Identidad de pruebas disponible para esta revalidación: no.** No se halló un procedimiento vigente ni una identidad autorizada reutilizable en el repositorio. No se crearon usuarios, no se usaron cuentas personales y no se llamó al endpoint del asesor. `firebase.json` no configura emuladores y el proyecto no declara Playwright como dependencia o script. Auth Emulator más Firestore Emulator no sustituiría una comprobación del índice KNN y de las respuestas generadas desde los datos de producción; por eso no se presenta una prueba local simulada como E2E real. No se modificó Auth, App Check, Firestore ni producción.

Todos los casos quedan **BLOCKED** como E2E autenticado actual. La evidencia parcial de selección temporal/KNN de producción procedente de la validación documental del 15/10 se indica expresamente; no equivale a invocar el asesor, generar respuesta, probar citas en pantalla ni validar la sesión. Los resultados de la sección “Nueva ejecución autenticada” son una ejecución anterior ya documentada; no se extrapolan a la revisión `00044-qot`.

| Caso | Estado | Entorno / identidad | Fuente esperada y evidencia de selección disponible | Resultado de esta revalidación |
|---|---|---|---|---|
| 1. Barcelona, salarios 2025 | **BLOCKED** | Producción; sin identidad | El resolutor seleccionó `transporte_barcelona_tablas_2025`; KNN real previo: 5/5 del documento filtrado. | Sin respuesta generada ni validación de importes/citas del asesor actual. |
| 2. Barcelona, convenio 2027 | **BLOCKED** | Producción; sin identidad | `transporte_barcelona_2026_2028`; resolver temporal y KNN real previo: 5/5. | No se validó texto ni cita en respuesta actual. |
| 3. Barcelona, salarios 2026 | **BLOCKED** | Producción; sin identidad | Resolver selecciona el texto nuevo desde 2026; tablas 2025 permanecen separadas. KNN real previo: 5/5 del texto nuevo. | No se validó que Gemini evitase mezclar importes. |
| 4. Barcelona, consulta histórica | **BLOCKED** | Producción; sin identidad | La entrada agregada `transporte_barcelona_2011_2023` sigue sin procedencia verificada; el resolver la bloquea (`source_unverified`/`not_found`). | No se comprobó la respuesta final prudente. |
| 5. Zaragoza, convenio 2024 | **BLOCKED** | Producción; sin identidad | El resolver seleccionó la fuente histórica 2022–2025 y KNN real previo devolvió 5/5 de ella; su catálogo no tiene SHA/procedencia verificados en esta revisión. | No se comprobó prudencia ni ausencia de citas del texto nuevo. |
| 6. Zaragoza, convenio 2027 | **BLOCKED** | Producción; sin identidad | `transporte_zaragoza_2026_2028`; resolver temporal y KNN real previo: 5/5. | No se validaron respuesta ni cita actuales. |
| 7. Zaragoza, salarios/dietas 2026 | **BLOCKED** | Producción; sin identidad | El resolver separa efectos económicos generales desde 01/01/2026 y dietas desde 01/07/2026; una consulta de dietas anterior al 01/07 queda sin fuente nueva. | Sin respuesta salarial generada ni comprobación de importes. |
| 8. Alojamientos Gipuzkoa 2026 | **BLOCKED** | Producción; sin identidad | Revisión oficial separada `alojamientos_gipuzkoa_revision_salarial_2026`; KNN real previo: 5/5. | No se validaron cita y respuesta del asesor actual. |
| 9. Restauración Gipuzkoa 2026 | **BLOCKED** | Producción; sin identidad | `GAO-I-2026-00525`, catálogo `hosteleria_gipuzkoa_revision_salarial_2026`, 14 chunks activos; Eventarc la resolvió y KNN real previo: 5/5. | Sin nueva invocación autenticada. |
| 10. Gipuzkoa, consulta no salarial | **BLOCKED** | Producción; sin identidad | Debe utilizar el texto principal, no la revisión salarial como sustituto; no hay resultado de recuperación específico de esta consulta en esta revalidación. | No ejecutado; no se infiere el resultado desde el caso salarial. |
| 11. Limpieza Zaragoza 2027 | **BLOCKED** | Producción; sin identidad | La matriz y catálogo identifican el convenio BOPZ 216/2026, anuncio 6181, para 2026–2029; no se obtuvo selección nueva en esta revalidación. | Sin respuesta, chunks ni citas observadas. |
| 12. Limpieza Zaragoza histórica | **BLOCKED** | Producción; sin identidad | La sección histórica anterior registra una prueba de 2024 en la revisión `00031-jus`; eso no valida el código actual `00044-qot`. | No repetido en la revisión actual. |
| 13. Estatuto anterior al 23/10/2026 | **BLOCKED** | Producción; sin identidad | La ejecución anterior documentó selección de `PUB-DT-2025-139`; no se repitió con la revisión actual. | Sin respuesta actual ni citas comprobadas. |
| 14. Estatuto desde el 23/10/2026 | **BLOCKED** | Producción; sin identidad | La ejecución anterior documentó selección prospectiva de la consolidación BOE 03/10/2026; es una fecha futura al corte de 15/10. | No repetido; no prueba vigencia actual antes de la fecha de efectos. |
| 15. Hostelería Málaga, salarios 2026 | **BLOCKED** | Producción; sin identidad | El PDF íntegro de tablas sigue sin cotejar; el caso anterior documentó respuesta `unconfirmed`, sin importe. | No se repitió la comprobación generativa. |
| 16. Convenio histórico no acreditado | **BLOCKED** | Producción; sin identidad | Debe bloquearse una afirmación de vigencia/aplicabilidad mientras falte procedencia acreditada; no se definió una ficha concreta para esta nueva consulta. | Sin consulta de asesor; no hay salida que evaluar. |

**Balance de esta revalidación:** 0 PASS, 0 FAIL, 16 BLOCKED, 0 NOT RUN. “BLOCKED” significa que el escenario no se pudo ejecutar como E2E autenticado; la evidencia parcial citada no altera el estado. Llamadas a Gemini, consultas KNN y coste atribuibles a esta revalidación: **0**. Para desbloquear se necesita una identidad de pruebas autorizada por el responsable, con su flujo normal de Auth y App Check; no hace falta cambiar producción ni compartir secretos.

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
