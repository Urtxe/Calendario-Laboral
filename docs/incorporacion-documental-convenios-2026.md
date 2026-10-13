# Incorporación documental de convenios — corte 13/10/2026

**Fecha de comprobación:** 13/10/2026.
**Alcance de esta entrega:** recuperación y cotejo local de publicaciones oficiales descargables, más el estado de las fuentes prioritarias bloqueadas. No se modificaron Firestore, embeddings, datos SEO, funciones ni los PDFs históricos. No se llamó a Gemini ni se desplegó.

## Resultado

Se recuperaron y verificaron cuatro PDFs oficiales: la consolidación BOE del Estatuto, una modificación del convenio de transporte de Barcelona, sus tablas 2025 y el texto completo 2026–2029 de limpieza de Zaragoza. Los cuatro se encuentran localmente bajo `functions/convenios/processed/`, que el `.gitignore` del repositorio excluye expresamente. Se preserva esa convención: no se forzaron esos archivos al Git. Los hashes, páginas, rutas y fuentes quedan en este manifiesto para su custodia y revisión.

La identidad documental se cotejó con encabezados, códigos/CVE o número de anuncio, extracción de texto y recuento de páginas. Para el BOPZ se descargó el fascículo oficial completo (108 páginas) y se extrajeron únicamente las páginas 74–106 del anuncio pertinente; el documento separado resultante tiene 33 páginas. No se incorporaron anuncios adyacentes.

## Documentos oficiales recuperados

| Documento local | Fuente oficial e identificador | Fecha / periodo documental | Páginas e integridad | SHA-256 | Relación y estado RAG | Preparación incremental |
|---|---|---|---:|---|---|---|
| `BOPZ-2026-09-19-6181-Limpieza-Zaragoza-2026-2029.pdf` | [Fascículo BOPZ 216](https://bop.dpz.es/BOPZ/UploadServlet?ruta=Boletines%5C2026%5C216%5Cbop.pdf), anuncio 6181; código `50000755011981`; [REGCON](https://expinterweb.mites.gob.es/regcon/pub/consultaCodigoMapas?convenioMapa=50000755011981) | BOPZ 19/09/2026; periodo pactado 2026–2029 | 33 páginas extraídas de las pp. 74–106 del fascículo de 108 páginas. Texto extraído completo; encabezado, ámbito, código y anexos de tablas 2026–2029 presentes. | `004745dd7a5e0afd7df584a8c83a22afd1bb7d7b8a1641cd5f0cada05325a070` (fascículo: `01fd6da739ae8b716e54a150356a0c2c0eb799d483ff4984e00be948b5763ff8`) | Texto nuevo que sucede documentalmente al convenio anterior; RAG conserva el documento anterior (estimación local: 183 chunks). No se detectó rectificación posterior al corte en REGCON/BOPZ consultados. | 191 chunks estimados con splitter existente; 0 coincidencias exactas de chunk con el texto previo. Potencial de 191 embeddings nuevos si se aprueba futura incorporación. Ninguno generado ahora. Mantener el anterior como histórico. |
| `BOPB-2023-11-06-08004295011994-modificacion-2023-2025.pdf` | [PDF individual BOPB](https://bop.diba.cat/anuncio/ver-pdf/3554970), CVE `202310152487`; código `08004295011994` | Publicado 22/11/2023; modificación del instrumento 2023–2025 | 12 páginas; PDF legible y extracción de texto completa. Resolución identifica el convenio y modifica contenido/periodo, no es un nuevo convenio autónomo. | `36d3912a10d18fe124f21c115c4cd282763787564aea8ec7dded670f7fe1c151` | El RAG tenía el texto local 2011–2023 (363 chunks), sin esta modificación. El PDF contiene segmentos iguales a texto ya disponible. | 54 chunks estimados: 42 tienen texto exacto coincidente con chunks existentes; 12 son textos no coincidentes. La reutilización vectorial solo es segura si se conserva procedencia múltiple; no se altera Firestore ahora. |
| `BOPB-2026-03-16-08004295011994-tablas-2025.pdf` | [PDF individual BOPB](https://bop.diba.cat/anuncio/ver-pdf/3910056), CVE `202610047645`; [sumario oficial del día](https://bop.diba.cat/sumario-del-dia/2026-03-16); código `08004295011994` | Publicado 16/03/2026; tablas definitivas del año 2025, acuerdo de 22/01/2026 | 5 páginas; extracción de texto completa. | `65ba6993bcbaa71e98ea257969f5ea0b66d401f01e33ed5811031c77d3267571` | Complemento al convenio de transporte de Barcelona; no es convenio 2026–2028 ni texto consolidado. RAG previo no incluía estas tablas. | 16 chunks estimados: 12 con texto exacto coincidente y 4 nuevos por texto. Reusar vectores existentes requiere mantener cita/CVE de la tabla; ninguno generado ni escrito ahora. |
| `ET-BOE-A-2015-11430-consolidado-2026-10-03.pdf` | [PDF consolidado BOE](https://www.boe.es/buscar/pdf/2015/BOE-A-2015-11430-consolidado.pdf); [ficha BOE fechada](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430&lang=es&p=20261003&tn=2); norma `BOE-A-2015-11430` | Consolidación con actualización 03/10/2026. La modificación de Ley 4/2026 se publicó en BOE 03/10/2026 y entra en vigor 23/10/2026. | 97 páginas; encabezado oficial y texto extraído completos. Es texto consolidado informativo; la norma modificativa publicada es la fuente jurídica de la modificación. | `459825db621a952edf65e843715c25fe586a6d1e4b3facb0bb8fdcbedf16adab` | El RAG conserva 807 chunks de la edición local consolidada a 04/12/2025. La nueva consolidación presenta cambios en el artículo 37.6 por [Ley 4/2026](https://www.boe.es/buscar/act.php?id=BOE-A-2026-20528), aún futuros al 13/10. | 622 chunks con el splitter existente; 0 coincidencias exactas con las partes locales de 2025. Potencial de 622 embeddings nuevos si se incorpora esta edición. No generar ni activar antes del 23/10; la recuperación actual no tiene `sourceValidFrom`, por lo que no puede filtrar de forma segura una versión futura cargada hoy. |

Los conteos de chunks son estimaciones obtenidas con el splitter ya instalado (`chunkSize: 1000`, `chunkOverlap: 200`) y comparación exacta de texto frente a las fuentes locales relevantes. No prueban identidad semántica ni que exista un vector reutilizable con procedencia/cita adecuada. La ingestión debe recalcular el conteo con la versión vigente del script y deduplicar por texto exacto conservando el origen oficial como evidencia.

## Fuentes prioritarias no recuperadas

| Documento/publicación | Evidencia oficial alcanzada | Lo que falta | Decisión segura |
|---|---|---|---|
| Hostelería Málaga, edicto 2957/2024 (20/08/2024) | El sumario [BOPMA del día](https://www.bopmalaga.es/sumario.php?fecha=20-08-2024), REGCON `29000945011981` y el validador oficial [CVE BOPMA](https://www.bopmalaga.es/cve.php) identifican `20240820-02957-2024`. | El endpoint oficial deniega descarga directa y su página de verificación exige un control antiabuso que no quedó validado. Sin PDF no hay páginas, anexos, categorías, artículos ni importes comprobables. | Mantener en RAG los 437 chunks actuales; no responder importes actuales a partir de ellos. No se crearon PDFs sustitutos ni se usaron espejos de terceros. Pendiente obtener el PDF por el flujo oficial BOPMA. |
| Hostelería Málaga, edicto 1559/2025 (14/05/2025) | [Sumario BOPMA](https://www.bopmalaga.es/sumario.php?fecha=14-05-2025), REGCON y CVE `20250514-01559-2025`. | Mismo bloqueo de descarga; contenido íntegro y posibles anexos no verificados. | No añadir tablas ni importes al RAG hasta cotejar el original oficial. |
| Hostelería Málaga, edicto 1187/2026 (14/04/2026) | [Sumario BOPMA](https://www.bopmalaga.es/sumario.php?fecha=14-04-2026), REGCON y CVE `20260414-01187-2026`. | Mismo bloqueo de descarga; relación exacta con tablas anteriores y anexos no verificada. | Mantener bloqueo salarial y solicitar una copia obtenida por el mecanismo oficial. |
| Transporte Barcelona 2026–2028, código `08004295011994` | [REGCON por código](https://expinterweb.mites.gob.es/regcon/pub/consultaCodigoMapas?convenioMapa=08004295011994) muestra registro/presentación 29/09/2026 y revisión salarial registrada 25/09/2026. | No se localizó anuncio ni texto íntegro en BOPB hasta el 13/10/2026. Un asiento REGCON no prueba publicación oficial, contenido, efectos ni anexos completos. | No sustituir el texto anterior, no exponer condiciones del nuevo periodo y no estimar chunks hasta localizar la publicación oficial. |
| Estatuto, vigencia desde 23/10/2026 | BOE consolidado descargado el 03/10; Ley 4/2026 y fecha de entrada en vigor identificadas. | No hay manejo `sourceValidFrom` en el filtro actual. No se hizo una comparación artículo por artículo completa entre cada edición histórica y consolidada; sí se comprobó el cambio material del art. 37.6. | No cargar ahora la versión futura al índice activo. Antes de la fecha, implementar/validar selección temporal o esperar hasta la entrada en vigor; atribuir la redacción modificada a Ley 4/2026 y respetar su fecha efectiva. |

### Málaga: trazabilidad de CVE

Los CVE se verificaron en el servicio oficial BOPMA, pero el servicio no permitió recuperar el archivo en esta sesión. La identificación del CVE no equivale a verificar el contenido del documento. No se calcularon hashes ni páginas para esos tres edictos, porque no se obtuvo su PDF. No se intentó eludir el control antiabuso.

## Diferencias RAG y SEO observadas

- **Zaragoza limpieza:** SEO/RAG todavía apuntan al PDF 2022–2025; se recuperó un texto oficial nuevo 2026–2029 con tablas 2026–2029. Corregir catálogo/SEO requiere una operación posterior revisable. Conservar el texto anterior como histórico.
- **Transporte Barcelona:** RAG conserva 2011–2023, mientras se localizaron la modificación oficial 2023–2025 y tablas 2025. El texto 2026–2028 solo consta como asiento REGCON al corte. Las dos publicaciones descargadas son complementarias y no deben formar una ficha de convenio separada.
- **Hostelería Málaga:** los 437 chunks existentes no contienen las publicaciones salariales identificadas de 2024–2026. No hay base para importar tablas porque los PDFs no se recuperaron.
- **Estatuto:** los 807 chunks existentes son la edición local 04/12/2025. La consolidación descargada incorpora una modificación futura del artículo 37.6. Sin `sourceValidFrom`, mezclarla hoy con la edición existente puede anticipar una norma.
- **Otras fichas de los 28 convenios:** se conservan las discrepancias y estados ya documentados en la [matriz](matriz-vigencia-convenios-2026.md). Esta entrega no declara verificada una fila por el mero hecho de que REGCON tenga un asiento ni de que haya fallado una búsqueda. Las 24 fichas no modificadas requieren completar su secuencia de publicaciones, anexos y cotejo individual antes de etiquetarlas como cubiertas por esta incorporación.

## Plan de incorporación incremental

1. Copiar los cuatro PDFs recuperados a la custodia de documentos del proyecto con aceptación explícita de la política que actualmente los excluye del repositorio. Mantener los nombres/hashes de este manifiesto y conservar el fascículo BOPZ de origen para auditoría fuera del índice.
2. Antes de cualquier escritura, exportar los documentos Firestore afectados con IDs/campos completos, validar restaurabilidad y preparar rollback. No se ha realizado esta fase.
3. **Zaragoza limpieza:** añadir una nueva edición documental 2026–2029 y relacionarla con el registro anterior; no sobrescribir ni borrar los chunks históricos. Estimación 191 chunks, sin coincidencia exacta local; máximo 191 embeddings nuevos.
4. **Barcelona transporte:** añadir cada publicación como evidencia complementaria asociada al mismo código, con CVE/fecha/tipo por chunk. Omitir 42+12 textos repetidos solo si se puede añadir su procedencia sin perder cita; estimación inicial 16 nuevos chunks únicos (12 de modificación y 4 de tablas) y 54 textos coincidentes potencialmente reutilizables.
5. **Estatuto:** resolver primero el límite temporal (`sourceValidFrom`/`sourceValidThrough`) y probar consultas el 22 y 23 de octubre con hora `Europe/Madrid`. Atribuir los cambios futuros a la Ley 4/2026, incluir la nueva fuente con fecha inicial 23/10/2026 y evitar que la consolidación futura se recupere antes. Conteo estimado: 622 nuevos chunks; 0 coincidencias textuales exactas. No indexar mientras no exista filtro seguro y una copia controlada del estado anterior.
6. **Málaga:** obtener desde el flujo oficial los tres PDFs completos, comprobar páginas/anexos y código/expediente, calcular hashes y separar tablas/documentos; medir chunks recién entonces. Vincularlos a la unidad 2018–2027 como modificaciones/tablas, manteniendo cita individual por publicación.
7. Recalcular chunking/deduplicación con la versión exacta del ingestor; revisar resultados de recuperación local sin Gemini; solo después preparar migración idempotente, respaldo y verificación posterior. No ejecutar ingestión ni generar embeddings en esta fase.
8. Actualizar SEO solo con metadatos documentales verificados y sin afirmar aplicabilidad jurídica a partir de los periodos.

### Estimación de embeddings y coste

| Fuente | Chunks calculados | Texto exacto reutilizable candidato | Chunks potencialmente nuevos | Embeddings/coste realizados |
|---|---:|---:|---:|---|
| BOPZ Zaragoza limpieza 2026–2029 | 191 | 0 | 191 | 0; coste $0 |
| BOPB Barcelona modificación 2023–2025 | 54 | 42 | 12 | 0; coste $0 |
| BOPB Barcelona tablas 2025 | 16 | 12 | 4 | 0; coste $0 |
| Estatuto BOE consolidado 03/10/2026 | 622 | 0 | 622 | 0; coste $0 |
| Málaga tablas 2024/2025/2026 | No calculable, PDFs no obtenidos | No calculable | No calculable | 0; coste $0 |
| Barcelona texto 2026–2028 | No publicado/localizado al corte | No calculable | No calculable | 0; coste $0 |
| **Total conocido** | **883** | **54** | **829** | **0; coste real $0** |

El costo futuro de embeddings no se cuantifica en moneda: depende del modelo/precio activo y del número final tras deduplicación; no se hicieron llamadas de embeddings ni a Gemini.

## Alcance de revisión del resto de convenios

Se conservan las 28 filas de la matriz previa y se actualizan los casos para los que hay evidencia adicional comprobada en esta fase. No se afirma que las otras 24 fichas tengan todos sus boletines posteriores y anexos descargados: sus códigos, referencias conocidas, discrepancias y bloqueos siguen detallados por fila. Las prioridades para continuar son los registros de transporte con secuencia incompleta (Gipuzkoa, Navarra, Bizkaia y Barcelona), las filas **INCOMPLETO**, convenios con tablas 2025/2026 y anuncios REGCON posteriores todavía no cotejados en el boletín. Una búsqueda sin publicación no constituye prueba de inexistencia.

## Límites de esta entrega

- PDFs oficiales originales de Málaga inaccesibles por control de descarga del BOPMA; sus CVE sí están identificados.
- No localizado texto BOPB 2026–2028 para transporte Barcelona hasta el corte.
- Las cuatro copias recuperadas permanecen en la carpeta local ignorada por Git según política del repositorio; el informe y sus hashes son la única parte versionable de esta entrega mientras esa regla siga vigente.
- No se hicieron escrituras, respaldos productivos, migraciones, llamadas a Gemini, generación de embeddings ni despliegues.
- La extracción y conteo PDF son verificaciones técnicas de integridad textual/páginas; no son dictamen de aplicabilidad o vigencia jurídica individual.
