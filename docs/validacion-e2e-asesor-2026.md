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

Para completar E2E hace falta que el responsable habilite una cuenta de prueba autorizada y su App Check válido de la forma habitual, sin compartir credenciales personales. Después deben ejecutarse las cinco consultas con límite de cinco llamadas, inspeccionarse las trazas nuevas por `requestId`, cotejarse las citas/chunks de cada respuesta y registrar coste real disponible. Las pruebas de 2026-10-24 solo pueden validar la selección documental prospectiva; no deben presentarse como prueba de vigencia actual antes del 23/10/2026.
