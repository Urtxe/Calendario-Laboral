const { onRequest } = require("firebase-functions/v2/https");
// Forzamos la carga de la versión 1 específicamente para el disparador de usuario
const functionsV1 = require("firebase-functions/v1"); 
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
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
const chatModel = genAI ? genAI.getGenerativeModel({ model: "gemini-2.5-pro" }) : null;
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

async function buscarChunksEspecificos(vectorPregunta, convenioReferencia) {
    const baseQuery = db.collection(COLLECTION_VECTORES).where("doc_type", "==", "especifico");
    const referencias = [];

    if (convenioReferencia) {
        referencias.push(convenioReferencia);
        if (!convenioReferencia.toLowerCase().endsWith(".pdf")) {
            referencias.push(`${convenioReferencia}.pdf`);
        }
    }

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
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
        }
    }

    return [];
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

        const vectorPregunta = await generarEmbeddingPregunta(pregunta);
        const idiomaRespuesta = detectarIdiomaPregunta(pregunta);
        const convenioReferencia = obtenerReferenciaConvenio(req.body);
        const chunksBase = await buscarChunksBase(vectorPregunta);

        let convenioFileName = convenioReferencia;
        if (!convenioFileName) {
            const topConvenio = await buscarTopConvenioEspecifico(vectorPregunta);
            convenioFileName = topConvenio ? (topConvenio.file_name || topConvenio.fileName || "") : "";
        }

        const chunksEspecificos = await buscarChunksEspecificos(vectorPregunta, convenioFileName);

        if (!chunksBase.length && !chunksEspecificos.length) {
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
            "Eres un abogado laboralista experto en España. Tu misión es comparar la Norma Base y la Norma Específica enviada.",
            "REGLA DE ORO: El Estatuto de los Trabajadores es el mínimo legal. Si el Convenio mejora al Estatuto, aplica el Convenio. Si el Convenio no dice nada o es peor, aplica el Estatuto.",
            "Responde siempre citando la fuente: 'Según el Estatuto tienes derecho a X, pero tu convenio lo mejora a Y, por lo tanto te corresponde Y'.",
            idiomaRespuesta === "euskera"
                ? "Responde siempre en euskera. Si hay una comparación entre norma base y convenio, mantén el mismo idioma."
                : "Responde siempre en castellano. Si hay una comparación entre norma base y convenio, mantén el mismo idioma.",
            "No inventes artículos, no completes con conocimiento externo y no des consejos jurídicos genéricos fuera del contexto facilitado.",
            "Si el contexto no contiene la respuesta, indica claramente que no puedes confirmarlo con la norma aportada.",
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

        return res.json({
            respuesta: respuesta || "No he podido generar una respuesta basada en el convenio.",
            convenioUsado: convenioFileName || null,
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
