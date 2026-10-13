# Cierre del saneamiento del asesor laboral — 13/10/2026

## Estado ejecutivo

**Estado: PARCIALMENTE COMPLETADO.** Las correcciones técnicas demostrables de resolución, recuperación y clasificación se implementaron, probaron, migraron con copia de seguridad y desplegaron. No se da por terminada la revisión jurídica oficial de los 28 convenios: faltan publicaciones primarias y cotejos completos en varios territorios, por lo que sus datos/SEO no se actualizaron.

## Correcciones implementadas

- El parser normaliza nombres sin espacio entre provincia y año; `Valencia2022` resuelve provincia VALENCIA, hostelería/alojamientos y años 2022–2025. Se conserva el ID de catálogo existente.
- Álava refleja en catálogo el código `01100085162024`, periodo pactado 2020–2026, BOTHA 16 de 07/02/2024 y la advertencia específica de eficacia extraestatutaria limitada. La aplicación no se generaliza a todo el sector.
- Málaga agrupa las publicaciones locales original y revisión como una edición lógica, reutilizando 360 + 77 chunks. Las fuentes oficiales posteriores se identifican, pero no se indexaron sus textos. Preguntas salariales posteriores a 2022 o sin año se bloquean con aviso antes de reserva de cuota/IA; otras respuestas advierten que hay publicaciones sin indexar. No se afirman importes ni que las tablas estén completas.
- Transporte Gipuzkoa conserva los registros/chunks y se clasifica como no verificado para evitar presentar nombres/periodos dudosos como confirmados. Las entradas de partes antiguas se marcan `superseded` sin borrar archivos ni vectores.
- El PDF local completo del Estatuto coincide por SHA-256 con la edición oficial `PUB-DT-2025-139`, actualizada a 04/12/2025. Las 232 páginas extraídas de las partes (116 + 116) coinciden página a página con el PDF completo. Los 807 chunks de las partes se clasificaron como `base` y tienen referencia BOE y fecha límite documental 22/10/2026. El BOE señala que la siguiente redacción, publicada 03/10/2026, entra en vigor el 23/10/2026; desde entonces la edición local se excluye hasta actualizarla.
- La función activa consulta los chunks base junto a los específicos cuando hay pregunta legal pertinente, separa ambos bloques, distingue sus citas y no afirma que la norma general desplace una condición convencional más favorable sin comparación. Las fuentes de respuesta incluyen código, URL y fecha cuando el catálogo o chunk los aporta.
- El PDF local de transporte de Barcelona 2011–2023 queda marcado como no verificado ante evidencia oficial BOPB del convenio 2023–2025 (código `08004295011994`) y tablas definitivas de 2025 publicadas en 2026. No se incorporó ni reindexó el texto nuevo hasta cotejar su PDF completo y ámbito funcional.
- El service worker incrementó la revisión de assets para invalidar correctamente la caché de PWA.

## Firestore y respaldo

Proyecto: `calendario-laboral-252b1`; colecciones `vectores_convenios` y `catalogo_convenios`.

Antes de escribir se exportaron y validaron fuera del repositorio **807 documentos vectoriales y 9 entradas de catálogo**. Ubicación: `%LOCALAPPDATA%\BalanceLaboral\backups\convenio-rag-integrity-20261013.json` (9.067.357 bytes). El respaldo verifica IDs, número de chunks, dimensiones 768, serialización del vector y hashes contra el snapshot. No se guardó en Git.

La migración actualizó solo metadatos: `doc_type`/proveniencia de los 807 chunks del Estatuto y nueve entradas de catálogo. No escribió `texto` ni `vector`; verificación posterior contra el backup confirma igualdad de ambos en los 807 registros. Málaga mantiene sus 360 y 77 chunks; no se reindexaron PDFs ni generaron embeddings. Las escrituras de metadatos no generaron coste de embeddings. Hubo una consulta vectorial nativa de Firestore con un vector existente, sin Gemini.

Restauración manual de respaldo disponible mediante `node functions/reconcile-convenio-data.js --restore --backup <ruta-del-backup>`. La operación restaura 816 documentos completos; antes de usarla debe comprobarse que no haya cambios legítimos posteriores sobre esos mismos documentos.

Validación de producción posterior: nueve fichas existentes, metadatos Valencia/Álava, agrupación Málaga, estados no verificados de Gipuzkoa/Barcelona y clasificación del Estatuto correctos. Una recuperación vectorial real devolvió cinco chunks `base`, todos con código BOE. No se leyeron datos personales.

## Verificación documental por prioridad

| Caso | Evidencia confirmada | Pendiente / bloqueado |
|---|---|---|
| Valencia | La extracción desde el nombre local corrige provincia y periodo documental; las pruebas del resolver pasan. | No se verificó exhaustivamente el anuncio oficial/registros posteriores; la corrección es metadato documental derivado del nombre, no pronunciamiento jurídico. |
| Álava | BOTHA 2024-00290 confirma código, publicación, periodo 2020–2026 y eficacia limitada; BOTHA 2025-00709, 2025-01461 y 2026-00518 fueron localizados como publicaciones posteriores. | Verificar el contenido íntegro de cada publicación y circunstancias de cobertura/adhesión de cualquier caso individual. |
| Málaga | BOPMA confirma original 2018, modificación 2024 y anuncios posteriores 2024, 2025 y 2026; CVE de los tres anuncios posteriores aceptados por el verificador oficial. | No se obtuvo el cuerpo íntegro de edictos 2957/2024, 1559/2025 y 1187/2026. No dar cifras ni declarar completas las tablas; no reindexar hasta descargar y comparar esos documentos. |
| Estatuto | PDF completo igual al PDF oficial de edición 2025; ambas partes coinciden página a página con el completo y sus fragmentos ya se recuperan en Firestore. | La redacción BOE de entrada en vigor 23/10/2026 no está local ni vectorizada. Queda bloqueada la recuperación de la edición 2025 a partir de esa fecha hasta descargar, verificar e indexar la edición apropiada. |
| Gipuzkoa | PDFs locales indican texto de mercancías por carretera 2007–2009 y código impreso `2001175`, mientras el fichero 2010–2014 no respalda ese nombre. | El fascículo BOG oficial individual, código actual, ámbito completo y eventual sucesor 2010–2014 no se localizaron de forma verificable. No cambiar periodo, código ni fuente activa. |
| Transporte Barcelona | BOPB prueba un convenio 2023–2025, código `08004295011994`, y publicación de tablas definitivas 2025 en 2026 (CVE `202610047645`). | Descargar y cotejar texto completo/ámbito; incorporación al RAG y actualización SEO bloqueadas hasta entonces. |
| Transporte Navarra | La ficha local apunta a un texto 2007–2008; se localizaron referencias oficiales/regulatorias iniciales, pero no se completó la búsqueda primaria al corte. | Determinar publicaciones posteriores en BON/REGCON. No interpretar el periodo por sí solo como pérdida de aplicabilidad. |
| Transporte Bizkaia | Consultado el buscador oficial BOB. | La sesión no identificó anuncio sectorial vigente coincidente; búsqueda en BOB/REGCON pendiente. |
| Otros convenios del inventario | Se conserva el inventario de los 28 publicados en `auditoria-convenios-2026.md`. | Revisión uno por uno en REGCON/boletines (códigos, ámbito, revisiones, prórrogas y sustitución) pendiente. No se afirma verificación integral. |

## Pruebas y coste

- `npm test`: passed; incluye seguridad, intención, parser/resolver, consulta IA, UI, service worker, Play/TWA, borrado de cuenta, conversión y Analytics. Las comprobaciones de Analytics imprimen el caso simulado esperado de configuración ausente; la suite pasó.
- `node --check` para `convenio-metadata.js`, `index.js`, `ingest-conventios.js`, `workers-statute-fallback.js` y `reconcile-convenio-data.js`: passed.
- Comparación página a página del Estatuto: 232/232 páginas coinciden en texto extraído.
- Firestore: respaldo, dry-run, migración, auditoría posterior y búsqueda vectorial nativa pasaron.
- Smoke tests: Hosting y service worker 200; endpoint HTTPS sin sesión respondió 401 como exige autenticación, sin invocar Gemini.
- Gemini/embeddings: cero llamadas. No se puede afirmar coste monetario total exacto de Firebase; hubo lecturas, escrituras de metadatos y una consulta vectorial de Firestore.

## Git, despliegue y limitaciones

- Base comprobada: `main` en `c033304`, sincronizada con `origin/main` al inicio. Rama: `fix/convenios-rag-integrity-2026`.
- Commit de código: `3363018` (`fix: improve convenio rag source integrity`).
- Firebase desplegado: función `consultarConvenio` (Gen 2, nodejs22, `us-central1`) y Hosting de `calendario-laboral-252b1`; no se desplegaron reglas, índices ni otras funciones. La función informa estado ACTIVE y `updateTime` 13/10/2026 09:11 UTC.
- Verificación de Hosting: `https://calendario-laboral-252b1.web.app/` y `/service-worker.js` respondieron 200 con nueva revisión de caché.
- No se actualizaron PDFs, páginas SEO, catálogo fuera de los nueve registros, reglas ni índices. No hubo consultas generativas de Gemini.
- La revisión exhaustiva de los 28 convenios, el cotejo de publicaciones posteriores no descargadas y la incorporación de fuentes oficiales posteriores siguen pendientes. La corrección técnica no acredita vigencia ni aplicabilidad jurídica.
- A la fecha de este informe, el push/PR/merge de la rama y la sincronización final con `origin/main` aún no constan; se actualizarán cuando se complete el flujo Git.
