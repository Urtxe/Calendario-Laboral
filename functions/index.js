const { onRequest } = require("firebase-functions/v2/https");
// Forzamos la carga de la versión 1 específicamente para el disparador de usuario
const functionsV1 = require("firebase-functions/v1"); 
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
    CATALOGO_CONVENIOS,
    detectConvenioCriteria,
    normalizeText,
    resolveCatalogEntry,
} = require("./convenio-metadata");
const {
    buildWorkersStatuteFallbackResponse,
    buildWorkersStatuteSource,
    findWorkersStatuteFallback,
} = require("./workers-statute-fallback");
require("dotenv").config({ path: __dirname + "/.env" });

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const geminiApiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_STUDIO_API_KEY ||
    process.env.API_KEY ||
    "";
const stripe = require("stripe")(stripeSecretKey);

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
const embeddingModel = genAI ? genAI.getGenerativeModel({ model: "gemini-embedding-001" }) : null;
const chatModel = genAI ? genAI.getGenerativeModel({ model: "gemini-2.5-flash" }) : null;
const COLLECTION_VECTORES = "vectores_convenios";
const EMBEDDING_DIMENSIONS = 768;

function setCorsHeaders(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function extraerTextoRespuesta(result) {
    if (!result) return "";
    if (typeof result.text === "function") return result.text();
    if (result.response && typeof result.response.text === "function") return result.response.text();
    return "";
}

function detectarIdiomaPregunta(pregunta) {
    const texto = String(pregunta || "").toLowerCase();
    const pistasEuskera = [
        /\beta\b/,
        /\bzein\b/,
        /\bzer\b/,
        /\bnola\b/,
        /\bnire\b/,
        /\bzuen\b/,
        /\bdu\b/,
        /\bdago\b/,
        /\blan\b/,
        /\bopor\b/,
        /\bsoldata\b/,
        /\bordaindu\b/,
        /\banitz\b/,
    ];

    return pistasEuskera.some((regex) => regex.test(texto)) ? "euskera" : "castellano";
}

function obtenerReferenciaConvenio(reqBody) {
    const valor =
        (reqBody && (
            reqBody.convenioFileName ||
            reqBody.file_name ||
            reqBody.fileName ||
            reqBody.convenioNombre ||
            reqBody.convenioId
        )) || "";

    return String(valor).trim();
}

function construirBloqueContexto(chunks, etiqueta) {
    return chunks.map((chunk, index) => {
        const fuente = chunk.file_name || chunk.fileName || chunk.convenioId || `Fragmento ${index + 1}`;
        return `[${etiqueta}]\nFuente: ${fuente}\n${chunk.texto}`;
    }).join("\n\n---\n\n");
}

async function generarEmbeddingPregunta(pregunta) {
    if (!embeddingModel) {
        throw new Error("Gemini no está configurado. Falta la API key.");
    }

    const response = await embeddingModel.embedContent({
        content: {
            parts: [{ text: pregunta }],
        },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBEDDING_DIMENSIONS,
    });

    return response.embedding.values;
}

async function buscarChunksBase(vectorPregunta) {
    const vectorQuery = db.collection(COLLECTION_VECTORES)
        .where("doc_type", "==", "base")
        .findNearest({
        vectorField: "vector",
        queryVector: vectorPregunta,
        distanceMeasure: "COSINE",
        limit: 2,
        distanceResultField: "distancia",
    });

    const snapshot = await vectorQuery.get();

    return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
    }));
}

async function buscarTopConvenioEspecifico(vectorPregunta) {
    const vectorQuery = db.collection(COLLECTION_VECTORES)
        .where("doc_type", "==", "especifico")
        .findNearest({
            vectorField: "vector",
            queryVector: vectorPregunta,
            distanceMeasure: "COSINE",
            limit: 1,
            distanceResultField: "distancia",
        });

    const snapshot = await vectorQuery.get();
    const doc = snapshot.docs[0];

    if (!doc) {
        return null;
    }

    return {
        id: doc.id,
        ...doc.data(),
    };
}

function respuestaIndicaDatoNoEncontrado(respuesta) {
    return normalizeText(respuesta).includes("no he encontrado el dato exacto");
}

function preguntaPideDiasLibres(pregunta) {
    const normalized = normalizeText(pregunta);
    return [
        "dias libres",
        "dia libre",
        "permiso",
        "permisos",
        "licencia",
        "licencias",
    ].some((term) => normalized.includes(normalizeText(term)));
}

const PERMISOS_QUERY_TERMS = [
    "mudanza",
    "traslado",
    "domicilio",
    "permiso",
    "permisos",
    "licencia",
    "licencias",
];

const PERMISOS_EXACT_TERMS = [
    "traslado de domicilio",
    "domicilio habitual",
    "mudanza",
];

const PERMISOS_HEADER_TERMS = [
    "permisos y licencias",
    "articulo 16",
    "remunerados",
];

function crearReferenciasConvenio(convenioReferencia) {
    const referencias = [];
    const referenciasEntrada = Array.isArray(convenioReferencia) ? convenioReferencia : [convenioReferencia];

    referenciasEntrada.filter(Boolean).forEach((referencia) => {
        referencias.push(referencia);
        if (!referencia.toLowerCase().endsWith(".pdf")) {
            referencias.push(`${referencia}.pdf`);
        }
    });

    return [...new Set(referencias)];
}

function esPreguntaDePermisos(pregunta) {
    const normalized = normalizeText(pregunta);
    return PERMISOS_QUERY_TERMS.some((term) => normalized.includes(normalizeText(term)));
}

function contieneAlguno(texto, terminos) {
    return terminos.some((termino) => texto.includes(normalizeText(termino)));
}

function claveChunk(chunk) {
    return chunk.id || `${chunk.convenioId || chunk.file_name || chunk.fileName || "chunk"}:${chunk.chunkIndex ?? ""}`;
}

function combinarChunksEspecificos(chunksKeyword, chunksVectoriales, maxChunks = 8) {
    const combinados = [];
    const vistos = new Set();

    [...chunksKeyword, ...chunksVectoriales].forEach((chunk) => {
        const clave = claveChunk(chunk);
        if (vistos.has(clave) || combinados.length >= maxChunks) return;
        vistos.add(clave);
        combinados.push(chunk);
    });

    return combinados;
}

async function buscarChunksKeywordPermisos(pregunta, convenioReferencia) {
    if (!esPreguntaDePermisos(pregunta)) {
        return [];
    }

    const referencias = crearReferenciasConvenio(convenioReferencia);
    const exactos = [];
    const encabezados = [];

    for (const referencia of referencias) {
        const snapshot = await db.collection(COLLECTION_VECTORES)
            .where("doc_type", "==", "especifico")
            .where("file_name", "==", referencia)
            .get();

        snapshot.docs.forEach((doc) => {
            const chunk = {
                id: doc.id,
                ...doc.data(),
            };
            const texto = normalizeText(chunk.texto || "");

            if (contieneAlguno(texto, PERMISOS_EXACT_TERMS)) {
                exactos.push(chunk);
                return;
            }

            if (contieneAlguno(texto, PERMISOS_HEADER_TERMS)) {
                encabezados.push(chunk);
            }
        });
    }

    const ordenarPorIndice = (a, b) => {
        const indexA = typeof a.chunkIndex === "number" ? a.chunkIndex : Number.MAX_SAFE_INTEGER;
        const indexB = typeof b.chunkIndex === "number" ? b.chunkIndex : Number.MAX_SAFE_INTEGER;
        return indexA - indexB;
    };

    return combinarChunksEspecificos(
        exactos.sort(ordenarPorIndice),
        encabezados.sort(ordenarPorIndice),
        5,
    );
}

async function buscarChunksEspecificos(vectorPregunta, convenioReferencia) {
    const baseQuery = db.collection(COLLECTION_VECTORES).where("doc_type", "==", "especifico");
    const referencias = crearReferenciasConvenio(convenioReferencia);
    const resultados = [];

    for (const referencia of referencias) {
        const snapshot = await baseQuery
            .where("file_name", "==", referencia)
            .findNearest({
                vectorField: "vector",
                queryVector: vectorPregunta,
                distanceMeasure: "COSINE",
                limit: 3,
                distanceResultField: "distancia",
            })
            .get();

        if (!snapshot.empty) {
            snapshot.docs.forEach((doc) => {
                resultados.push({
                    id: doc.id,
                    ...doc.data(),
                });
            });
        }
    }

    if (resultados.length) {
        return resultados
            .sort((a, b) => {
                const distA = typeof a.distancia === "number" ? a.distancia : Number.MAX_SAFE_INTEGER;
                const distB = typeof b.distancia === "number" ? b.distancia : Number.MAX_SAFE_INTEGER;
                return distA - distB;
            })
            .slice(0, 4);
    }

    return [];
}

let catalogoCache = null;
let catalogoCacheTs = 0;
const CATALOGO_CACHE_TTL_MS = 5 * 60 * 1000;

async function cargarCatalogoConvenios() {
    const now = Date.now();
    if (catalogoCache && (now - catalogoCacheTs) < CATALOGO_CACHE_TTL_MS) {
        return catalogoCache;
    }

    const snapshot = await db.collection(CATALOGO_CONVENIOS).get();
    catalogoCache = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
    }));
    catalogoCacheTs = now;
    return catalogoCache;
}

async function resolverConvenioDesdeEntrada(reqBody, pregunta) {
    const catalogo = await cargarCatalogoConvenios();
    if (!catalogo.length) {
        return { status: "catalog_empty" };
    }

    const criteria = detectConvenioCriteria({
        pregunta,
        ciudad: reqBody && (reqBody.ciudad || reqBody.ciudadActual || reqBody.location || ""),
        sector: reqBody && (reqBody.sector || reqBody.sectorUsuario || reqBody.profesion || ""),
    });

    return resolveCatalogEntry(catalogo, criteria);
}

// 1. WEBHOOK DE STRIPE (V2)
exports.stripeWebhook = onRequest({ cors: true }, async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        if (!stripeSecretKey || !webhookSecret) {
            console.error("Stripe no está configurado: faltan STRIPE_SECRET_KEY o STRIPE_WEBHOOK_SECRET");
            return res.status(500).send("Stripe not configured");
        }
        event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
        console.error("❌ Error de firma:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.client_reference_id; 
        const customerId = session.customer;

        if (userId) {
            await db.collection("usuarios").doc(userId).set({
                tipoCuenta: "premium",
                stripeCustomerId: customerId
            }, { merge: true });
            console.log(`✅ Usuario ${userId} activado como PREMIUM`);
        }
    }

    if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const userQuery = await db.collection("usuarios")
            .where("stripeCustomerId", "==", customerId)
            .limit(1).get();

        if (!userQuery.empty) {
            await userQuery.docs[0].ref.set({ tipoCuenta: "free" }, { merge: true });
            console.log(`ℹ️ Suscripción cancelada para el cliente ${customerId}`);
        }
    }

    res.json({ received: true });
});

// 1.1 CONSULTA LEGAL SOBRE CONVENIOS (V2)
exports.consultarConvenio = onRequest({ cors: true }, async (req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método no permitido" });
    }

    try {
        const pregunta = String(req.body && req.body.pregunta ? req.body.pregunta : "").trim();

        if (!pregunta) {
            return res.status(400).json({ error: "La pregunta es obligatoria" });
        }

        const estatutoFallback = findWorkersStatuteFallback(pregunta);
        const vectorPregunta = await generarEmbeddingPregunta(pregunta);
        const idiomaRespuesta = detectarIdiomaPregunta(pregunta);
        const convenioReferencia = obtenerReferenciaConvenio(req.body);
        const chunksBase = await buscarChunksBase(vectorPregunta);

        let convenioFileName = convenioReferencia;
        let conveniosFileName = convenioReferencia ? [convenioReferencia] : [];
        let convenioResuelto = null;

        if (!convenioFileName) {
            const resolucionCatalogo = await resolverConvenioDesdeEntrada(req.body, pregunta);

            if (resolucionCatalogo.status === "resolved" && resolucionCatalogo.entry) {
                convenioResuelto = resolucionCatalogo.entry;
                conveniosFileName = Array.isArray(resolucionCatalogo.entry.fileNames) ? resolucionCatalogo.entry.fileNames : [];
                convenioFileName = conveniosFileName[0] || "";
            } else if (resolucionCatalogo.status && resolucionCatalogo.status !== "catalog_empty") {
                if (estatutoFallback) {
                    return res.json({
                        respuesta: buildWorkersStatuteFallbackResponse(estatutoFallback),
                        convenioUsado: null,
                        conveniosUsados: [],
                        convenioDetectado: null,
                        fuentes: [buildWorkersStatuteSource(estatutoFallback)],
                    });
                }

                if (resolucionCatalogo.status === "missing_all" && preguntaPideDiasLibres(pregunta)) {
                    return res.json({
                        respuesta: "No tengo información suficiente en las fuentes disponibles para confirmar un permiso retribuido por ese motivo.",
                        convenioUsado: null,
                        conveniosUsados: [],
                        convenioDetectado: null,
                        fuentes: [],
                    });
                }

                return res.json({
                    respuesta: resolucionCatalogo.message,
                    requiereAclaracion: true,
                    opcionesConvenio: resolucionCatalogo.options || [],
                    convenioUsado: null,
                    conveniosUsados: [],
                    fuentes: [],
                });
            }
        }

        if (!convenioFileName) {
            const topConvenio = await buscarTopConvenioEspecifico(vectorPregunta);
            convenioFileName = topConvenio ? (topConvenio.file_name || topConvenio.fileName || "") : "";
            conveniosFileName = convenioFileName ? [convenioFileName] : [];
        }

        const chunksKeywordPermisos = await buscarChunksKeywordPermisos(pregunta, conveniosFileName);
        const chunksVectorialesEspecificos = await buscarChunksEspecificos(vectorPregunta, conveniosFileName);
        const chunksEspecificos = combinarChunksEspecificos(
            chunksKeywordPermisos,
            chunksVectorialesEspecificos,
            8,
        );

        if (!chunksBase.length && !chunksEspecificos.length) {
            if (estatutoFallback) {
                return res.json({
                    respuesta: buildWorkersStatuteFallbackResponse(estatutoFallback, { convenioFileName }),
                    convenioUsado: convenioFileName || null,
                    conveniosUsados: conveniosFileName,
                    convenioDetectado: convenioResuelto ? {
                        province: convenioResuelto.province || null,
                        autonomousCommunity: convenioResuelto.autonomousCommunity || null,
                        sectorKeys: convenioResuelto.sectorKeys || [],
                        title: convenioResuelto.title || null,
                    } : null,
                    fuentes: [buildWorkersStatuteSource(estatutoFallback)],
                });
            }

            return res.status(404).json({
                error: "No se encontraron fragmentos relevantes del convenio para responder.",
            });
        }

        const bloquesContexto = [];
        if (chunksBase.length) {
            bloquesContexto.push(construirBloqueContexto(chunksBase, "NORMA BASE - ESTATUTO"));
        }
        if (chunksEspecificos.length) {
            bloquesContexto.push(construirBloqueContexto(chunksEspecificos, "NORMA ESPECÍFICA - CONVENIO"));
        }

        const contexto = bloquesContexto.join("\n\n===\n\n");

        const promptSistema = [
            "Eres un asistente laboral para trabajadores en España.",
            "Aplica siempre esta regla jurídica: el Estatuto de los Trabajadores es el mínimo legal.",
            "Si el convenio mejora al Estatuto, prevalece el convenio en ese punto.",
            "Si el convenio no regula ese punto o lo regula peor, prevalece el Estatuto.",
            "Responde primero con el dato concreto en una frase breve.",
            "No empieces con fórmulas como 'Como abogado laboralista', 'Como asistente' ni con explicaciones generales.",
            "Usa lenguaje claro y directo para una persona trabajadora.",
            "No expliques el razonamiento salvo que sea imprescindible para evitar una duda.",
            "Si la consulta trata de permisos o licencias, indica si el permiso es retribuido y si consume vacaciones cuando el contexto permita confirmarlo.",
            "Cita al final la fuente con convenio, artículo y apartado cuando aparezcan en el contexto.",
            "Formato preferente: respuesta directa, una línea en blanco y una línea que empiece por 'Fuente:'.",
            idiomaRespuesta === "euskera"
                ? "Responde siempre en euskera."
                : "Responde siempre en castellano.",
            "No inventes artículos, no completes con conocimiento externo y no des consejos jurídicos genéricos fuera del contexto facilitado.",
            "Si el contexto no contiene el dato exacto, di claramente: 'No he encontrado el dato exacto en los fragmentos disponibles.'",
        ].join(" ");

        const result = await chatModel.generateContent({
            systemInstruction: promptSistema,
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: `Idioma de respuesta: ${idiomaRespuesta}\nPregunta: ${pregunta}\n\nContexto para comparar:\n${contexto}`,
                        },
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 800,
            },
        });

        const respuesta = extraerTextoRespuesta(result).trim();
        const respuestaFinal = estatutoFallback && respuestaIndicaDatoNoEncontrado(respuesta)
            ? buildWorkersStatuteFallbackResponse(estatutoFallback, { convenioFileName })
            : respuesta;

        return res.json({
            respuesta: respuestaFinal || "No he podido generar una respuesta basada en el convenio.",
            convenioUsado: convenioFileName || null,
            conveniosUsados: conveniosFileName,
            convenioDetectado: convenioResuelto ? {
                province: convenioResuelto.province || null,
                autonomousCommunity: convenioResuelto.autonomousCommunity || null,
                sectorKeys: convenioResuelto.sectorKeys || [],
                title: convenioResuelto.title || null,
            } : null,
            fuentes: [
                ...chunksBase.map((chunk) => ({
                    id: chunk.id,
                    fileName: chunk.fileName,
                    file_name: chunk.file_name,
                    convenioId: chunk.convenioId,
                    chunkIndex: chunk.chunkIndex,
                    doc_type: chunk.doc_type,
                    fuente: "base",
                    distancia: chunk.distancia ?? null,
                })),
                ...chunksEspecificos.map((chunk) => ({
                    id: chunk.id,
                    fileName: chunk.fileName,
                    file_name: chunk.file_name,
                    convenioId: chunk.convenioId,
                    chunkIndex: chunk.chunkIndex,
                    doc_type: chunk.doc_type,
                    fuente: "especifica",
                    distancia: chunk.distancia ?? null,
                })),
                ...(estatutoFallback && respuestaIndicaDatoNoEncontrado(respuesta)
                    ? [buildWorkersStatuteSource(estatutoFallback)]
                    : []),
            ],
        });
    } catch (error) {
        console.error("❌ Error en consultarConvenio:", error);
        return res.status(500).json({
            error: "No se pudo consultar el convenio.",
        });
    }
});

// 2. LIMPIEZA AL BORRAR USUARIO (Usando la ruta V1 explícita)
exports.limpiarDatosAlBorrarUsuario = functionsV1.auth.user().onDelete(async (user) => {
    const uid = user.uid;
    console.log(`🗑️ Borrando datos de Firestore para el UID: ${uid}`);

    const userRef = db.collection('usuarios').doc(uid);
    const yearsSnap = await userRef.collection('years').get();
    const visitasSnap = await userRef.collection('visitas').get();
    const deletes = [];

    yearsSnap.forEach((doc) => deletes.push(doc.ref.delete()));
    visitasSnap.forEach((doc) => deletes.push(doc.ref.delete()));

    await Promise.all(deletes);

    await userRef.delete();
    console.log(`✅ Datos del usuario ${uid} borrados correctamente.`);
});
