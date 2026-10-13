# Incorporación RAG de Zaragoza y versionado del Estatuto (2026)

Fecha de comprobación: 13/10/2026. Proyecto Firebase: `calendario-laboral-252b1`.

## Fuentes oficiales persistidas

Los PDF de ingesta se conservaron en el bucket existente y privado `calendario-laboral-252b1.firebasestorage.app`. Los objetos se crearon de forma condicional, con ACL limitadas al proyecto y sin acceso público. Su descarga de comprobación produjo los mismos SHA-256 que los archivos locales.

| Documento preparado | Fuente e identificador | Alcance comprobado | SHA-256 | Almacenamiento |
| --- | --- | --- | --- | --- |
| BOPZ: convenio de limpieza de Zaragoza 2026–2029 | [BOPZ 216/2026, anuncio 6181](https://bop.dpz.es/BOPZ/UploadServlet?ruta=Boletines%5C2026%5C216%5Cbop.pdf), código `50000755011981` | Extracción exclusiva del anuncio 6181; 33 páginas del convenio, texto legible, ámbitos y tablas anuales 2026–2029 comprobados. | `004745dd7a5e0afd7df584a8c83a22afd1bb7d7b8a1641cd5f0cada05325a070` | `gs://calendario-laboral-252b1.firebasestorage.app/official-sources/convenios/zaragoza-limpieza/2026/BOPZ-216-6181.pdf` |
| Estatuto de los Trabajadores, consolidación 03/10/2026 | [Texto consolidado BOE-A-2015-11430](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430&lang=es&p=20261003&tn=2); [Ley 4/2026, BOE-A-2026-20528](https://www.boe.es/boe/dias/2026/10/03/pdfs/BOE-A-2026-20528.pdf) | PDF consolidado de 97 páginas. El historial BOE identifica la nueva redacción del art. 37.6 por la disposición final décima de la Ley 4/2026, publicada el 03/10/2026 y vigente desde el 23/10/2026. Hasta entonces, la BOE marca esa redacción como todavía no vigente. | `459825db621a952edf65e843715c25fe586a6d1e4b3facb0bb8fdcbedf16adab` | `gs://calendario-laboral-252b1.firebasestorage.app/official-sources/normativa/BOE-A-2015-11430/2026-10-03/consolidado.pdf` |

El texto consolidado del BOE es informativo y no sustituye a la publicación oficial de cada modificación. La fuente original de la reforma es la Ley 4/2026. El PDF consolidado se conserva para recuperación textual, con fecha de consulta y redacción visibles en el contexto y en las citas.

## Cambios RAG preparados

- Zaragoza se registra como edición independiente `limpieza_zaragoza_2026_2029`; se conserva `limpieza_zaragoza_2022_2025` y sus 183 chunks históricos. La nueva edición no determina por sí sola su aplicabilidad jurídica.
- El ingestor calcula SHA-256, valida páginas y texto, detecta chunks ya guardados por archivo/checksum/índice, reanuda solo los índices ausentes y crea documentos con IDs deterministas mediante precondición `create`. Un checksum, contenido o ID incompatible detiene el proceso sin borrar registros.
- `--file` permite seleccionar exclusivamente el PDF solicitado y `--dry-run` extrae, divide y comprueba Firestore sin escribir ni llamar a Gemini.
- El Estatuto se filtra por `file_name` antes de `findNearest`; la edición no se escoge aplicando un filtro después del top-K. La ficha normativa verificada hace de puerta de disponibilidad y solo se publica después de completar todos sus chunks.
- El 22/10/2026 se selecciona `PUB-DT-2025-139`; desde el 23/10/2026 se selecciona la consolidación del 03/10/2026. Preguntas con un año que abarca dos redacciones (por ejemplo, “2026”) piden el día y mes. Fechas sin edición disponible y fallos de recuperación responden sin usar el fallback web vigente ni generar respuesta normativa no fundamentada.
- Las consultas históricas realizadas después de octubre también seleccionan por la fecha preguntada. La fecha de redacción seleccionada se expone en la evidencia y cita.

## Preflight, copia de seguridad y migración

Preflight real ejecutado con el ingestor y Firestore de producción en modo `--dry-run`: Zaragoza produjo **191 chunks**; el Estatuto, **622 chunks**. Los fragmentos nuevos no tienen coincidencias textuales exactas con los chunks de las fuentes históricas comparadas; se estimaron **813 embeddings nuevos** y **0 reutilizados**. El preflight no escribió en Firestore ni llamó a Gemini.

Antes de la ingesta se exportaron los 990 chunks históricos pertinentes (183 de Zaragoza y 807 del Estatuto), los dos registros de catálogo originales y el estado de ausencia de los 813 IDs y dos claves de catálogo nuevos. Respaldo fuera del repositorio:

- Archivo: `C:\Users\mikel\AppData\Local\BalanceLaboral\firestore-backups\phase4-20261013-153546-d0fa86e1bae64fa0833b8c540b74f330.json`
- SHA-256: `00d67a1cee7c4f2cf64904996f7a812c0098797b08ca9e50fbf777419779d2b4`
- Validación: 990 vectores reconstruibles de 768 dimensiones, IDs conservados; simulación de lectura/restauración en memoria; 813 IDs nuevos ausentes al inicio. No se escribió sobre registros históricos.

La migración es aditiva. Para revertirla, se eliminan únicamente los IDs deterministas listados para esos dos nombres de archivo y las dos fichas nuevas cuyo `sourceSha256` coincida con los hashes documentados. No se toca la edición histórica.

Estimación de coste para `gemini-embedding-001`: aproximadamente **USD 0,02–0,03** usando el [precio de entrada publicado por Google](https://ai.google.dev/gemini-api/docs/pricing) de USD 0,15 por millón de tokens y el volumen de texto con solapamiento del splitter existente. No se dispone de una factura de consumo por petición; el importe real puede variar por tokenización y tarifa/free tier. No se envió contenido a Gemini fuera de la generación de estos embeddings.

## Validación y estado operativo

Pruebas previas a la migración: `node --check` de los archivos de Functions modificados, tests de metadatos/temporalidad y consulta IA, `npm test`, comprobación del índice vectorial con un vector real existente y preflight productivo de ambos PDF.

### Resultado productivo

- Se incorporaron **191 chunks** de Zaragoza y **622 chunks** de la edición BOE del Estatuto. Se generaron **813 embeddings nuevos** y se reutilizaron **0** embeddings entre las fuentes históricas y las dos fuentes incorporadas. Coste estimado: **USD 0,02–0,03**; no se registró el consumo monetario facturado por llamada.
- El recuento de `vectores_convenios` pasó de **8.639 a 9.452**. Permanecen disponibles los **183** chunks de Zaragoza 2022–2025 y los **807** chunks previos del Estatuto (444 + 363). Los cinco grupos inspeccionados tienen secuencias completas, `chunkTotal` coherente y vectores de **768 dimensiones**.
- La ingesta incremental se ejecutó otra vez para ambos PDF: Zaragoza detectó **191/191** existentes y el Estatuto **622/622**; en ambos casos **0** chunks nuevos y **0** embeddings generados. Las consultas KNN reales filtradas devolvieron exclusivamente el archivo esperado para Zaragoza, para la edición nueva del Estatuto y para una parte de la edición anterior.
- El catálogo conserva Zaragoza 2022–2025 y añade Zaragoza 2026–2029 con código, BOPZ 216/anuncio 6181, hash, URL, URI persistente y advertencia de aplicabilidad. Para el Estatuto, la ficha anterior conserva su fecha de fin de selección en 22/10/2026 y la nueva está fechada desde 23/10/2026; el catálogo nuevo se publicó una vez completados sus 622 chunks.
- Se desplegó únicamente `consultarConvenio` en `calendario-laboral-252b1` (`us-central1`); Cloud Run reportó `ACTIVE`, revisión `consultarconvenio-00029-tas`. No hubo despliegue de Hosting, reglas, índices ni otras Functions.
- Smoke test HTTP sin autenticación respondió **401**, como se esperaba. La recuperación vectorial se comprobó directamente en Firestore con KNN real. No se realizó una consulta autenticada completa al asesor, no se creó usuario de prueba y no se generó respuesta de Gemini; por tanto, la generación final de texto no se declara validada en producción.
- `node --check` en los archivos de Functions modificados, tests específicos de metadatos/temporalidad y consulta IA, `npm test`, comprobación del índice vectorial, preflight y comprobación de idempotencia finalizaron correctamente. `npm test` emitió un aviso esperado por la ausencia de `GA4_PROPERTY_ID` en entorno local; las pruebas finalizaron con éxito.

### Git e integración

- Rama de implementación: `feat/rag-zaragoza-statute-versioning`.
- Commits: `952bc73 fix: select statute sources by consultation date`; `5692f28 fix: make official source ingestion incremental`.
- PR #6 integrada: [https://github.com/Urtxe/Calendario-Laboral/pull/6](https://github.com/Urtxe/Calendario-Laboral/pull/6), merge `e8f87355db11ed8f771f890f2b7aa5e390e3b8d1`.
- Al iniciar la documentación de cierre, `main` y `origin/main` coincidían en `e8f8735`. El único cambio propio pendiente de registro es este informe; `.playwright-cli/` ya estaba sin seguimiento y se conserva intacto.

## Rollback

1. Mantener la edición histórica y el respaldo externos intactos.
2. Revertir el despliegue de `consultarConvenio` al commit previo si la consulta temporal o Zaragoza falla.
3. Borrar únicamente documentos vectoriales nuevos que coincidan por ID y por `fileName` + `sourceSha256` esperados.
4. Borrar únicamente `limpieza_zaragoza_2026_2029` y la ficha normativa de `BOE-A-2015-11430` edición `2026-10-03`, tras comprobar sus hashes.
5. Confirmar los recuentos históricos antes y después; no eliminar ni reescribir ningún chunk de 2022–2025 ni los 807 chunks anteriores del Estatuto.
