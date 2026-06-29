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
const {
    consultarFallbackWebOficial,
} = require("./official-web-fallback");
require("dotenv").config({ path: __dirname + "/.env" });

function obtenerProjectIdDesdeFirebaseConfig() {
    try {
        const firebaseConfig = process.env.FIREBASE_CONFIG
            ? JSON.parse(process.env.FIREBASE_CONFIG)
            : null;
        return firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : "";
    } catch {
        return "";
    }
}

const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    obtenerProjectIdDesdeFirebaseConfig() ||
    "calendario-laboral-252b1";

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || projectId;
process.env.GCP_PROJECT = process.env.GCP_PROJECT || projectId;

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const premiumStripePriceIds = parseEnvList(process.env.STRIPE_PREMIUM_PRICE_IDS || process.env.STRIPE_PREMIUM_PRICE_ID || "");
const premiumStripeProductIds = parseEnvList(process.env.STRIPE_PREMIUM_PRODUCT_IDS || process.env.STRIPE_PREMIUM_PRODUCT_ID || "");
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

if (stripeSecretKey && webhookSecret && !hasPremiumStripeConfig()) {
    console.warn(JSON.stringify({
        event: "stripe_premium_config_missing_at_startup",
        message: "Define STRIPE_PREMIUM_PRICE_IDS or STRIPE_PREMIUM_PRODUCT_IDS before deploying the hardened Stripe webhook.",
    }));
}

const COLLECTION_VECTORES = "vectores_convenios";
const EMBEDDING_DIMENSIONS = 768;
const FREE_AI_TOTAL_LIMIT = 3;
const PREMIUM_AI_DAILY_LIMIT = 100;
const AI_USAGE_COLLECTION = "usage";
const AI_USAGE_DOC = "ai";
const AI_QUESTION_MAX_LENGTH = 1200;
const CONSULTAR_CONVENIO_FUNCTION_OPTIONS = {
    timeoutSeconds: 90,
    memory: "512MiB",
    maxInstances: 10,
    concurrency: 20,
};
const CONSULTAR_CONVENIO_ALLOWED_ORIGINS = new Set([
    "https://balancelaboral.es",
    "https://www.balancelaboral.es",
    "https://calendario-laboral-252b1.web.app",
    "https://calendario-laboral-252b1.firebaseapp.com",
]);
const CONSULTAR_CONVENIO_DEV_ORIGIN_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const CONSULTAR_CONVENIO_ALLOWED_FIELDS = [
    "pregunta",
    "ciudad",
    "ciudadActual",
    "location",
    "sector",
    "sectorUsuario",
    "profesion",
    "convenioFileName",
    "file_name",
    "fileName",
    "convenioNombre",
    "convenioId",
];
const CONSULTAR_CONVENIO_OPTIONAL_STRING_FIELDS = CONSULTAR_CONVENIO_ALLOWED_FIELDS
    .filter((field) => field !== "pregunta");

function esOrigenPermitidoConsulta(origin) {
    return CONSULTAR_CONVENIO_ALLOWED_ORIGINS.has(origin) ||
        CONSULTAR_CONVENIO_DEV_ORIGIN_PATTERN.test(origin);
}

function setCorsHeaders(req, res) {
    const origin = req.get("origin") || "";

    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Firebase-AppCheck");
    res.set("Vary", "Origin");

    if (!origin) {
        return {
            ok: true,
            origin: "",
            reason: "missing_origin",
        };
    }

    if (!esOrigenPermitidoConsulta(origin)) {
        return {
            ok: false,
            origin,
            reason: "origin_not_allowed",
        };
    }

    res.set("Access-Control-Allow-Origin", origin);

    return {
        ok: true,
        origin,
        reason: "origin_allowed",
    };
}

function extraerTextoRespuesta(result) {
    if (!result) return "";
    if (typeof result.text === "function") return result.text();
    if (result.response && typeof result.response.text === "function") return result.response.text();
    return "";
}

function tieneContentTypeJson(req) {
    const contentType = req.get("content-type") || "";
    return contentType.toLowerCase().includes("application/json");
}

function validarPayloadBasicoConsulta(req) {
    if (!tieneContentTypeJson(req)) {
        return {
            ok: false,
            status: 400,
            error: "La solicitud debe enviarse como application/json.",
        };
    }

    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return {
            ok: false,
            status: 400,
            error: "El cuerpo de la solicitud debe ser un objeto JSON.",
        };
    }

    const keys = Object.keys(body);
    const unexpectedFields = keys.filter((key) => !CONSULTAR_CONVENIO_ALLOWED_FIELDS.includes(key));

    if (unexpectedFields.length) {
        return {
            ok: false,
            status: 400,
            error: "La solicitud contiene campos no permitidos.",
        };
    }

    const invalidOptionalField = CONSULTAR_CONVENIO_OPTIONAL_STRING_FIELDS
        .find((field) => body[field] !== undefined && typeof body[field] !== "string");

    if (invalidOptionalField) {
        return {
            ok: false,
            status: 400,
            error: "Los datos de contexto deben ser texto.",
        };
    }

    return {
        ok: true,
        body,
    };
}

function validarPreguntaConsulta(body) {
    if (typeof body.pregunta !== "string") {
        return {
            ok: false,
            status: 400,
            error: "La pregunta debe ser texto.",
        };
    }

    const pregunta = body.pregunta.trim();

    if (!pregunta) {
        return {
            ok: false,
            status: 400,
            error: "La pregunta es obligatoria.",
        };
    }

    if (pregunta.length > AI_QUESTION_MAX_LENGTH) {
        return {
            ok: false,
            status: 400,
            error: `La pregunta no puede superar ${AI_QUESTION_MAX_LENGTH} caracteres.`,
        };
    }

    return {
        ok: true,
        pregunta,
    };
}

function extraerFinishReason(result) {
    return result && result.response && Array.isArray(result.response.candidates)
        ? result.response.candidates[0] && result.response.candidates[0].finishReason
        : null;
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

function escribirLogConsulta(event, data = {}) {
    console.log(JSON.stringify({
        event,
        ...data,
    }));
}

function extraerBearerToken(req) {
    const authHeader = req.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : "";
}

async function verificarUsuarioConsulta(req) {
    const idToken = extraerBearerToken(req);

    if (!idToken) {
        return {
            ok: false,
            reason: "missing_or_malformed_authorization",
        };
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        return {
            ok: true,
            uid: decodedToken.uid,
        };
    } catch (error) {
        return {
            ok: false,
            reason: "invalid_id_token",
            errorName: error && error.code ? error.code : (error && error.name ? error.name : "Error"),
        };
    }
}

class QuotaError extends Error {
    constructor({ status, code, message, quota = null }) {
        super(message);
        this.name = "QuotaError";
        this.status = status;
        this.code = code;
        this.quota = quota;
    }
}

function obtenerDiaCuota(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function normalizarContador(value) {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function construirQuotaPublica(quotaInfo) {
    if (!quotaInfo) return null;

    return {
        plan: quotaInfo.plan,
        limit: quotaInfo.limit,
        used: quotaInfo.used,
        remaining: Math.max(0, quotaInfo.limit - quotaInfo.used),
        period: quotaInfo.period,
    };
}

function responderConCuota(payload, quotaInfo) {
    const quota = construirQuotaPublica(quotaInfo);
    return quota ? { ...payload, quota } : payload;
}

async function consumirCuotaConsultaIA(uid) {
    const userRef = db.collection("usuarios").doc(uid);
    const usageRef = userRef.collection(AI_USAGE_COLLECTION).doc(AI_USAGE_DOC);
    const today = obtenerDiaCuota();

    return db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);

        if (!userSnap.exists) {
            throw new QuotaError({
                status: 403,
                code: "user_profile_not_found",
                message: "No se ha encontrado tu perfil de usuario.",
            });
        }

        const userData = userSnap.data() || {};
        const isPremium = userData.tipoCuenta === "premium";
        const usageSnap = await transaction.get(usageRef);
        const usageData = usageSnap.exists ? usageSnap.data() || {} : {};
        const now = admin.firestore.FieldValue.serverTimestamp();

        if (isPremium) {
            const currentDailyCount = usageData.premiumDailyKey === today
                ? normalizarContador(usageData.premiumDailyCount)
                : 0;

            if (currentDailyCount >= PREMIUM_AI_DAILY_LIMIT) {
                throw new QuotaError({
                    status: 429,
                    code: "premium_daily_quota_exceeded",
                    message: "Has alcanzado temporalmente el límite de uso razonable. Inténtalo más tarde.",
                    quota: {
                        plan: "premium",
                        limit: PREMIUM_AI_DAILY_LIMIT,
                        used: currentDailyCount,
                        period: "day",
                    },
                });
            }

            const nextDailyCount = currentDailyCount + 1;
            transaction.set(usageRef, {
                plan: "premium",
                premiumDailyKey: today,
                premiumDailyCount: nextDailyCount,
                premiumDailyLimit: PREMIUM_AI_DAILY_LIMIT,
                totalAccepted: admin.firestore.FieldValue.increment(1),
                updatedAt: now,
            }, { merge: true });

            return {
                plan: "premium",
                limit: PREMIUM_AI_DAILY_LIMIT,
                used: nextDailyCount,
                period: "day",
            };
        }

        const currentFreeTotal = normalizarContador(usageData.freeTotalCount);

        if (currentFreeTotal >= FREE_AI_TOTAL_LIMIT) {
            throw new QuotaError({
                status: 429,
                code: "free_total_quota_exceeded",
                message: "Has alcanzado el límite gratuito de consultas IA.",
                quota: {
                    plan: "free",
                    limit: FREE_AI_TOTAL_LIMIT,
                    used: currentFreeTotal,
                    period: "total",
                },
            });
        }

        const nextFreeTotal = currentFreeTotal + 1;
        transaction.set(usageRef, {
            plan: "free",
            freeTotalCount: nextFreeTotal,
            freeTotalLimit: FREE_AI_TOTAL_LIMIT,
            totalAccepted: admin.firestore.FieldValue.increment(1),
            updatedAt: now,
        }, { merge: true });

        return {
            plan: "free",
            limit: FREE_AI_TOTAL_LIMIT,
            used: nextFreeTotal,
            period: "total",
        };
    });
}

function nombreEventoRespuesta(responseSource) {
    return {
        convenio: "convenio_response",
        estatuto: "statute_response",
        web_official: "web_official_response",
        unconfirmed: "unconfirmed_response",
        error: "consultarConvenio_error",
    }[responseSource] || "consultarConvenio_response";
}

function logResultadoConsulta({
    responseSource,
    status = 200,
    uid = null,
    quotaPlan = null,
    quotaRemaining = null,
    pregunta = "",
    convenioUsado = null,
    requiresClarification = false,
    webFallbackUsed = false,
    webFallbackReason = null,
    finishReason = null,
    chunksUsed = 0,
}) {
    const payload = {
        response_source: responseSource,
        status,
        uid: uid || null,
        quotaPlan: quotaPlan || null,
        quotaRemaining: typeof quotaRemaining === "number" ? quotaRemaining : null,
        convenioUsado: convenioUsado || null,
        requiresClarification: Boolean(requiresClarification),
        webFallbackUsed: Boolean(webFallbackUsed),
        webFallbackReason: webFallbackReason || null,
        finishReason: finishReason || null,
        chunksUsed,
        questionLength: String(pregunta || "").length,
    };

    escribirLogConsulta(nombreEventoRespuesta(responseSource), payload);
    escribirLogConsulta("consultarConvenio_result", payload);
}

function construirConvenioDetectado(convenioResuelto) {
    return convenioResuelto ? {
        province: convenioResuelto.province || null,
        autonomousCommunity: convenioResuelto.autonomousCommunity || null,
        sectorKeys: convenioResuelto.sectorKeys || [],
        title: convenioResuelto.title || null,
    } : null;
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

const DISCIPLINARIO_QUERY_TERMS = [
    "falta grave",
    "faltas graves",
    "falta muy grave",
    "faltas muy graves",
    "despido",
    "despedir",
    "despedirme",
    "echar",
    "echarme",
    "sancion",
    "sanciones",
    "regimen disciplinario",
];

const DISCIPLINARIO_EXACT_TERMS = [
    "faltas graves",
    "faltas muy graves",
    "falta grave",
    "falta muy grave",
    "clases de sanciones",
    "seccion tercera sanciones",
    "despido con perdida",
];

const DISCIPLINARIO_HEADER_TERMS = [
    "capitulo xii premios faltas sanciones",
    "premios faltas sanciones",
    "seccion segunda faltas",
    "seccion tercera sanciones",
    "articulo 53",
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

function esPreguntaDisciplinaria(pregunta) {
    const normalized = normalizeText(pregunta);
    return DISCIPLINARIO_QUERY_TERMS.some((term) => normalized.includes(normalizeText(term)));
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

function ordenarPorIndice(a, b) {
    const indexA = typeof a.chunkIndex === "number" ? a.chunkIndex : Number.MAX_SAFE_INTEGER;
    const indexB = typeof b.chunkIndex === "number" ? b.chunkIndex : Number.MAX_SAFE_INTEGER;
    return indexA - indexB;
}

function puntuarChunkDisciplinario(chunk) {
    const texto = normalizeText(chunk.texto || "");
    let score = 0;

    if (texto.includes("despido con perdida")) score += 10;
    if (texto.includes("clases de sanciones")) score += 9;
    if (texto.includes("seccion tercera sanciones")) score += 8;
    if (texto.includes("faltas muy graves")) score += 7;
    if (texto.includes("faltas graves")) score += 6;
    if (texto.includes("seccion segunda faltas")) score += 5;
    if (texto.includes("articulo 53")) score += 4;
    if (texto.includes("despido disciplinario")) score += 3;
    if (texto.includes("sanciones")) score += 2;
    if (texto.includes("representantes de las personas trabajadoras")) score -= 4;
    if (texto.includes("delegados as sindicales")) score -= 4;

    return score;
}

function ordenarPorRelevanciaDisciplinaria(a, b) {
    const scoreDiff = puntuarChunkDisciplinario(b) - puntuarChunkDisciplinario(a);
    return scoreDiff || ordenarPorIndice(a, b);
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

    return combinarChunksEspecificos(
        exactos.sort(ordenarPorIndice),
        encabezados.sort(ordenarPorIndice),
        5,
    );
}

async function buscarChunksKeywordDisciplinario(pregunta, convenioReferencia) {
    if (!esPreguntaDisciplinaria(pregunta)) {
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

            if (contieneAlguno(texto, DISCIPLINARIO_EXACT_TERMS)) {
                exactos.push(chunk);
                return;
            }

            if (contieneAlguno(texto, DISCIPLINARIO_HEADER_TERMS)) {
                encabezados.push(chunk);
            }
        });
    }

    const seleccionados = combinarChunksEspecificos(
        exactos.sort(ordenarPorRelevanciaDisciplinaria),
        encabezados.sort(ordenarPorRelevanciaDisciplinaria),
        8,
    );

    return seleccionados.sort(ordenarPorIndice);
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

async function generarRespuestaConvenio({ promptSistema, idiomaRespuesta, pregunta, contexto }) {
    const buildRequest = (systemInstruction, maxOutputTokens) => ({
        systemInstruction,
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
            maxOutputTokens,
        },
    });

    const firstResult = await chatModel.generateContent(buildRequest(promptSistema, 1200));
    const firstFinishReason = extraerFinishReason(firstResult);
    const firstText = extraerTextoRespuesta(firstResult).trim();

    if (firstFinishReason !== "MAX_TOKENS") {
        return {
            respuesta: firstText,
            finishReason: firstFinishReason,
            reintentado: false,
            respuestaCompleta: true,
        };
    }

    escribirLogConsulta("max_tokens_retry", {
        stage: "convenio_generation",
        finishReason: firstFinishReason,
    });

    const promptBreve = [
        promptSistema,
        "La respuesta anterior se cortó. Reintenta una sola vez con una respuesta completa pero breve.",
        "Máximo 8 líneas. Usa frases cortas. Si hay varias preguntas, responde cada una sin enumeraciones largas.",
        "No copies listados completos: resume categorías y cita la fuente.",
    ].join(" ");

    const retryResult = await chatModel.generateContent(buildRequest(promptBreve, 1600));
    const retryFinishReason = extraerFinishReason(retryResult);
    const retryText = extraerTextoRespuesta(retryResult).trim();

    if (retryFinishReason !== "MAX_TOKENS") {
        return {
            respuesta: retryText,
            finishReason: retryFinishReason,
            reintentado: true,
            respuestaCompleta: true,
        };
    }

    escribirLogConsulta("max_tokens_retry", {
        stage: "convenio_generation_retry",
        finishReason: retryFinishReason,
        finalAttempt: true,
    });

    return {
        respuesta: "No he podido generar una respuesta completa sin que se corte. Reformula la pregunta en una parte más concreta o pregunta primero por faltas y después por sanciones.",
        finishReason: retryFinishReason,
        reintentado: true,
        respuestaCompleta: false,
    };
}

async function intentarFallbackWebOficial({ pregunta, convenioFileName, conveniosFileName, convenioResuelto }) {
    escribirLogConsulta("web_fallback_attempt", {
        convenioUsado: convenioFileName || null,
        questionLength: String(pregunta || "").length,
    });

    const webFallback = await consultarFallbackWebOficial({
        question: pregunta,
        apiKey: geminiApiKey,
    });

    if (!webFallback.used) {
        escribirLogConsulta(
            webFallback.reason === "no_allowed_official_sources"
                ? "web_fallback_no_official_source"
                : "web_fallback_skipped",
            {
                webFallbackReason: webFallback.reason || "unknown",
                convenioUsado: convenioFileName || null,
                questionLength: String(pregunta || "").length,
            },
        );
    }

    return {
        respuesta: webFallback.respuesta,
        convenioUsado: convenioFileName || null,
        conveniosUsados: conveniosFileName || [],
        convenioDetectado: construirConvenioDetectado(convenioResuelto),
        fuentes: webFallback.fuentes || [],
        webFallbackUsed: Boolean(webFallback.used),
        webFallbackReason: webFallback.reason || null,
        searchSuggestions: webFallback.searchSuggestions || null,
    };
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

function parseEnvList(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function stripeLog(eventName, payload = {}) {
    console.log(JSON.stringify({
        event: eventName,
        ...payload,
    }));
}

function stripeWarn(eventName, payload = {}) {
    console.warn(JSON.stringify({
        event: eventName,
        ...payload,
    }));
}

function getStripeId(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return value.id || "";
}

function getStripeProductId(price) {
    if (!price) return "";
    return getStripeId(price.product);
}

function getUidFromCheckoutSession(session) {
    return session && (
        session.client_reference_id ||
        (session.metadata && (session.metadata.uid || session.metadata.userId)) ||
        ""
    );
}

function getUidFromSubscription(subscription) {
    return subscription && subscription.metadata && (
        subscription.metadata.uid ||
        subscription.metadata.userId ||
        ""
    );
}

function hasPremiumStripeConfig() {
    return premiumStripePriceIds.length > 0 || premiumStripeProductIds.length > 0;
}

function isAllowedPremiumPrice(priceId, productId) {
    if (!hasPremiumStripeConfig()) return false;

    const priceMatches = priceId && premiumStripePriceIds.includes(priceId);
    const productMatches = productId && premiumStripeProductIds.includes(productId);

    return Boolean(priceMatches || productMatches);
}

function getSubscriptionItems(subscription) {
    return subscription &&
        subscription.items &&
        Array.isArray(subscription.items.data)
        ? subscription.items.data
        : [];
}

function getSubscriptionPremiumMatch(subscription) {
    const items = getSubscriptionItems(subscription);

    for (const item of items) {
        const price = item.price || {};
        const priceId = getStripeId(price);
        const productId = getStripeProductId(price);

        if (isAllowedPremiumPrice(priceId, productId)) {
            return { priceId, productId };
        }
    }

    return null;
}

function getLineItemPremiumMatch(lineItems) {
    const items = lineItems && Array.isArray(lineItems.data) ? lineItems.data : [];

    for (const item of items) {
        const price = item.price || {};
        const priceId = getStripeId(price);
        const productId = getStripeProductId(price);

        if (isAllowedPremiumPrice(priceId, productId)) {
            return { priceId, productId };
        }
    }

    return null;
}

async function findUserRefForStripe({ uid, customerId, subscriptionId }) {
    if (uid) {
        const userRef = db.collection("usuarios").doc(uid);
        const userSnap = await userRef.get();

        if (userSnap.exists) {
            return {
                userRef,
                uid,
            };
        }

        stripeWarn("stripe_user_not_found_by_uid", {
            uid,
        });
    }

    if (subscriptionId) {
        const subscriptionQuery = await db.collection("usuarios")
            .where("stripeSubscriptionId", "==", subscriptionId)
            .limit(1)
            .get();

        if (!subscriptionQuery.empty) {
            return {
                userRef: subscriptionQuery.docs[0].ref,
                uid: subscriptionQuery.docs[0].id,
            };
        }
    }

    if (customerId) {
        const customerQuery = await db.collection("usuarios")
            .where("stripeCustomerId", "==", customerId)
            .limit(1)
            .get();

        if (!customerQuery.empty) {
            return {
                userRef: customerQuery.docs[0].ref,
                uid: customerQuery.docs[0].id,
            };
        }
    }

    return null;
}

async function activatePremiumFromStripe({ uid, customerId, subscriptionId, priceId, productId, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd }) {
    const userMatch = await findUserRefForStripe({ uid, customerId, subscriptionId });

    if (!userMatch) {
        stripeWarn("stripe_activation_user_not_found", {
            hasUid: Boolean(uid),
            hasCustomerId: Boolean(customerId),
            hasSubscriptionId: Boolean(subscriptionId),
        });
        return false;
    }

    await userMatch.userRef.set({
        tipoCuenta: "premium",
        stripeCustomerId: customerId || null,
        stripeSubscriptionId: subscriptionId || null,
        stripePriceId: priceId || null,
        stripeProductId: productId || null,
        subscriptionStatus: subscriptionStatus || "active",
        updatedBillingAt: admin.firestore.FieldValue.serverTimestamp(),
        stripeCurrentPeriodEnd: currentPeriodEnd || null,
        stripeCancelAtPeriodEnd: Boolean(cancelAtPeriodEnd),
    }, { merge: true });

    stripeLog("stripe_premium_activated", {
        uid: userMatch.uid,
        subscriptionStatus: subscriptionStatus || "active",
        hasCustomerId: Boolean(customerId),
        hasSubscriptionId: Boolean(subscriptionId),
        priceId: priceId || null,
        productId: productId || null,
    });

    return true;
}

async function deactivatePremiumFromStripe({ uid, customerId, subscriptionId, subscriptionStatus, reason }) {
    const userMatch = await findUserRefForStripe({ uid, customerId, subscriptionId });

    if (!userMatch) {
        stripeWarn("stripe_deactivation_user_not_found", {
            reason,
            hasUid: Boolean(uid),
            hasCustomerId: Boolean(customerId),
            hasSubscriptionId: Boolean(subscriptionId),
        });
        return false;
    }

    await userMatch.userRef.set({
        tipoCuenta: "free",
        subscriptionStatus: subscriptionStatus || reason || "inactive",
        updatedBillingAt: admin.firestore.FieldValue.serverTimestamp(),
        stripeCancelAtPeriodEnd: null,
    }, { merge: true });

    stripeLog("stripe_premium_deactivated", {
        uid: userMatch.uid,
        subscriptionStatus: subscriptionStatus || null,
        reason,
        hasCustomerId: Boolean(customerId),
        hasSubscriptionId: Boolean(subscriptionId),
    });

    return true;
}

async function getExpandedSubscription(subscriptionId) {
    if (!subscriptionId) return null;

    return stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data.price.product"],
    });
}

async function handleCheckoutSessionCompleted(session) {
    if (!hasPremiumStripeConfig()) {
        stripeWarn("stripe_premium_config_missing", {
            eventType: "checkout.session.completed",
        });
        return;
    }

    if (session.status !== "complete") {
        stripeWarn("stripe_checkout_ignored_incomplete_status", {
            status: session.status || null,
        });
        return;
    }

    const uid = getUidFromCheckoutSession(session);
    const customerId = getStripeId(session.customer);
    const subscriptionId = getStripeId(session.subscription);
    const mode = session.mode || "";

    if (!uid) {
        stripeWarn("stripe_checkout_missing_uid", {
            mode,
            hasCustomerId: Boolean(customerId),
            hasSubscriptionId: Boolean(subscriptionId),
        });
        return;
    }

    if (mode === "subscription") {
        const subscription = await getExpandedSubscription(subscriptionId);

        if (!subscription || subscription.status !== "active") {
            stripeWarn("stripe_checkout_subscription_not_active", {
                uid,
                status: subscription ? subscription.status : null,
                hasSubscriptionId: Boolean(subscriptionId),
            });
            return;
        }

        const premiumMatch = getSubscriptionPremiumMatch(subscription);

        if (!premiumMatch) {
            stripeWarn("stripe_checkout_price_not_allowed", {
                uid,
                mode,
                hasSubscriptionId: Boolean(subscriptionId),
            });
            return;
        }

        await activatePremiumFromStripe({
            uid,
            customerId,
            subscriptionId,
            priceId: premiumMatch.priceId,
            productId: premiumMatch.productId,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: subscription.current_period_end || null,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
        return;
    }

    if (mode === "payment") {
        if (session.payment_status !== "paid") {
            stripeWarn("stripe_checkout_payment_not_paid", {
                uid,
                paymentStatus: session.payment_status || null,
            });
            return;
        }

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
            limit: 100,
            expand: ["data.price.product"],
        });
        const premiumMatch = getLineItemPremiumMatch(lineItems);

        if (!premiumMatch) {
            stripeWarn("stripe_checkout_price_not_allowed", {
                uid,
                mode,
            });
            return;
        }

        await activatePremiumFromStripe({
            uid,
            customerId,
            subscriptionId: "",
            priceId: premiumMatch.priceId,
            productId: premiumMatch.productId,
            subscriptionStatus: "paid",
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
        });
        return;
    }

    stripeWarn("stripe_checkout_mode_not_supported", {
        uid,
        mode,
    });
}

async function handleSubscriptionUpdated(subscription) {
    const uid = getUidFromSubscription(subscription);
    const customerId = getStripeId(subscription.customer);
    const subscriptionId = getStripeId(subscription);
    const premiumMatch = getSubscriptionPremiumMatch(subscription);

    if (!premiumMatch) {
        await deactivatePremiumFromStripe({
            uid,
            customerId,
            subscriptionId,
            subscriptionStatus: subscription.status,
            reason: "subscription_price_not_allowed",
        });
        return;
    }

    if (subscription.status === "active") {
        await activatePremiumFromStripe({
            uid,
            customerId,
            subscriptionId,
            priceId: premiumMatch.priceId,
            productId: premiumMatch.productId,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: subscription.current_period_end || null,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
        return;
    }

    await deactivatePremiumFromStripe({
        uid,
        customerId,
        subscriptionId,
        subscriptionStatus: subscription.status,
        reason: "subscription_not_active",
    });
}

async function handleSubscriptionDeleted(subscription) {
    await deactivatePremiumFromStripe({
        uid: getUidFromSubscription(subscription),
        customerId: getStripeId(subscription.customer),
        subscriptionId: getStripeId(subscription),
        subscriptionStatus: subscription.status || "canceled",
        reason: "subscription_deleted",
    });
}

async function handleInvoicePaymentFailed(invoice) {
    await deactivatePremiumFromStripe({
        customerId: getStripeId(invoice.customer),
        subscriptionId: getStripeId(invoice.subscription),
        subscriptionStatus: "past_due",
        reason: "invoice_payment_failed",
    });
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

    try {
        switch (event.type) {
            case "checkout.session.completed":
                await handleCheckoutSessionCompleted(event.data.object);
                break;
            case "customer.subscription.updated":
                await handleSubscriptionUpdated(event.data.object);
                break;
            case "customer.subscription.deleted":
                await handleSubscriptionDeleted(event.data.object);
                break;
            case "invoice.payment_failed":
                await handleInvoicePaymentFailed(event.data.object);
                break;
            default:
                stripeLog("stripe_webhook_ignored_event", {
                    eventType: event.type,
                });
        }
    } catch (error) {
        console.error("Error procesando webhook de Stripe:", {
            eventType: event.type,
            errorName: error.name,
            errorMessage: error.message,
        });
        return res.status(500).json({ error: "Stripe webhook processing failed" });
    }

    res.json({ received: true });
});

// 1.1 CONSULTA LEGAL SOBRE CONVENIOS (V2)
exports.consultarConvenio = onRequest(CONSULTAR_CONVENIO_FUNCTION_OPTIONS, async (req, res) => {
    const corsResult = setCorsHeaders(req, res);

    if (!corsResult.ok) {
        escribirLogConsulta("consultarConvenio_cors_rejected", {
            status: 403,
            origin: corsResult.origin,
            reason: corsResult.reason,
        });
        logResultadoConsulta({
            responseSource: "error",
            status: 403,
        });
        return res.status(403).json({ error: "Origen no permitido" });
    }

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    if (req.method !== "POST") {
        logResultadoConsulta({
            responseSource: "error",
            status: 405,
        });
        return res.status(405).json({ error: "Método no permitido" });
    }

    let pregunta = "";
    const payloadValidation = validarPayloadBasicoConsulta(req);

    if (!payloadValidation.ok) {
        escribirLogConsulta("consultarConvenio_bad_request", {
            status: payloadValidation.status,
            reason: payloadValidation.error,
        });
        logResultadoConsulta({
            responseSource: "error",
            status: payloadValidation.status,
        });
        return res.status(payloadValidation.status).json({ error: payloadValidation.error });
    }

    const authResult = await verificarUsuarioConsulta(req);

    if (!authResult.ok) {
        escribirLogConsulta("consultarConvenio_auth_failed", {
            status: 401,
            reason: authResult.reason,
            errorName: authResult.errorName || null,
        });
        logResultadoConsulta({
            responseSource: "error",
            status: 401,
        });
        return res.status(401).json({ error: "Debes iniciar sesión para usar la consulta IA" });
    }

    const preguntaValidation = validarPreguntaConsulta(payloadValidation.body);

    if (!preguntaValidation.ok) {
        escribirLogConsulta("consultarConvenio_bad_request", {
            status: preguntaValidation.status,
            reason: preguntaValidation.error,
            uid: authResult.uid,
        });
        logResultadoConsulta({
            responseSource: "error",
            status: preguntaValidation.status,
        });
        return res.status(preguntaValidation.status).json({ error: preguntaValidation.error });
    }

    pregunta = preguntaValidation.pregunta;
    const uid = authResult.uid;
    let quotaInfo = null;

    try {
        try {
            quotaInfo = await consumirCuotaConsultaIA(uid);
        } catch (error) {
            if (error instanceof QuotaError) {
                const quota = construirQuotaPublica(error.quota);

                escribirLogConsulta("consultarConvenio_quota_rejected", {
                    status: error.status,
                    uid,
                    code: error.code,
                    quotaPlan: quota ? quota.plan : null,
                    quotaRemaining: quota ? quota.remaining : null,
                    questionLength: String(pregunta || "").length,
                });
                logResultadoConsulta({
                    responseSource: "error",
                    status: error.status,
                    uid,
                    quotaPlan: quota ? quota.plan : null,
                    quotaRemaining: quota ? quota.remaining : null,
                    pregunta,
                });

                return res.status(error.status).json({
                    error: error.message,
                    code: error.code,
                    quota,
                });
            }

            throw error;
        }

        const quotaPublica = construirQuotaPublica(quotaInfo);

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
                    logResultadoConsulta({
                        responseSource: "estatuto",
                        status: 200,
                        uid,
                        quotaPlan: quotaPublica ? quotaPublica.plan : null,
                        quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                        pregunta,
                        chunksUsed: 1,
                    });
                    return res.json(responderConCuota({
                        respuesta: buildWorkersStatuteFallbackResponse(estatutoFallback),
                        convenioUsado: null,
                        conveniosUsados: [],
                        convenioDetectado: null,
                        fuentes: [buildWorkersStatuteSource(estatutoFallback)],
                    }, quotaInfo));
                }

                const webFallbackResponse = await intentarFallbackWebOficial({
                    pregunta,
                    convenioFileName: null,
                    conveniosFileName: [],
                    convenioResuelto: null,
                });

                if (webFallbackResponse.webFallbackUsed) {
                    logResultadoConsulta({
                        responseSource: "web_official",
                        status: 200,
                        uid,
                        quotaPlan: quotaPublica ? quotaPublica.plan : null,
                        quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                        pregunta,
                        webFallbackUsed: true,
                        webFallbackReason: webFallbackResponse.webFallbackReason,
                    });
                    return res.json(responderConCuota(webFallbackResponse, quotaInfo));
                }

                if (resolucionCatalogo.status === "missing_all" && preguntaPideDiasLibres(pregunta)) {
                    logResultadoConsulta({
                        responseSource: "unconfirmed",
                        status: 200,
                        uid,
                        quotaPlan: quotaPublica ? quotaPublica.plan : null,
                        quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                        pregunta,
                        webFallbackReason: webFallbackResponse.webFallbackReason,
                    });
                    return res.json(responderConCuota({
                        respuesta: "No tengo información suficiente en las fuentes disponibles para confirmar un permiso retribuido por ese motivo.",
                        convenioUsado: null,
                        conveniosUsados: [],
                        convenioDetectado: null,
                        fuentes: [],
                    }, quotaInfo));
                }

                if (resolucionCatalogo.status === "missing_all" && esPreguntaDisciplinaria(pregunta)) {
                    logResultadoConsulta({
                        responseSource: "unconfirmed",
                        status: 200,
                        uid,
                        quotaPlan: quotaPublica ? quotaPublica.plan : null,
                        quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                        pregunta,
                        requiresClarification: true,
                        webFallbackReason: webFallbackResponse.webFallbackReason,
                    });
                    return res.json(responderConCuota({
                        respuesta: "No necesariamente: una falta grave no implica automáticamente despido. Para confirmarte la sanción concreta necesito saber tu sector y provincia, porque cada convenio puede distinguir entre faltas graves, faltas muy graves y sus sanciones.",
                        requiereAclaracion: true,
                        opcionesConvenio: [],
                        convenioUsado: null,
                        conveniosUsados: [],
                        fuentes: [],
                    }, quotaInfo));
                }

                if (webFallbackResponse.webFallbackReason && webFallbackResponse.webFallbackReason !== "web_fallback_disabled") {
                    logResultadoConsulta({
                        responseSource: "unconfirmed",
                        status: 200,
                        uid,
                        quotaPlan: quotaPublica ? quotaPublica.plan : null,
                        quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                        pregunta,
                        webFallbackUsed: webFallbackResponse.webFallbackUsed,
                        webFallbackReason: webFallbackResponse.webFallbackReason,
                    });
                    return res.json(responderConCuota(webFallbackResponse, quotaInfo));
                }

                logResultadoConsulta({
                    responseSource: "unconfirmed",
                    status: 200,
                    uid,
                    quotaPlan: quotaPublica ? quotaPublica.plan : null,
                    quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                    pregunta,
                    requiresClarification: true,
                    webFallbackReason: webFallbackResponse.webFallbackReason,
                });
                return res.json(responderConCuota({
                    respuesta: resolucionCatalogo.message,
                    requiereAclaracion: true,
                    opcionesConvenio: resolucionCatalogo.options || [],
                    convenioUsado: null,
                    conveniosUsados: [],
                    fuentes: [],
                }, quotaInfo));
            }
        }

        if (!convenioFileName) {
            const topConvenio = await buscarTopConvenioEspecifico(vectorPregunta);
            convenioFileName = topConvenio ? (topConvenio.file_name || topConvenio.fileName || "") : "";
            conveniosFileName = convenioFileName ? [convenioFileName] : [];
        }

        const chunksKeywordPermisos = await buscarChunksKeywordPermisos(pregunta, conveniosFileName);
        const chunksKeywordDisciplinarios = await buscarChunksKeywordDisciplinario(pregunta, conveniosFileName);
        const chunksVectorialesEspecificos = await buscarChunksEspecificos(vectorPregunta, conveniosFileName);
        const chunksEspecificos = combinarChunksEspecificos(
            [
                ...chunksKeywordPermisos,
                ...chunksKeywordDisciplinarios,
            ],
            chunksVectorialesEspecificos,
            10,
        );

        if (!chunksBase.length && !chunksEspecificos.length) {
            if (estatutoFallback) {
                logResultadoConsulta({
                    responseSource: "estatuto",
                    status: 200,
                    uid,
                    quotaPlan: quotaPublica ? quotaPublica.plan : null,
                    quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                    pregunta,
                    convenioUsado: convenioFileName,
                    chunksUsed: 1,
                });
                return res.json(responderConCuota({
                    respuesta: buildWorkersStatuteFallbackResponse(estatutoFallback, { convenioFileName }),
                    convenioUsado: convenioFileName || null,
                    conveniosUsados: conveniosFileName,
                    convenioDetectado: construirConvenioDetectado(convenioResuelto),
                    fuentes: [buildWorkersStatuteSource(estatutoFallback)],
                }, quotaInfo));
            }

            const webFallbackResponse = await intentarFallbackWebOficial({
                pregunta,
                convenioFileName,
                conveniosFileName,
                convenioResuelto,
            });

            if (webFallbackResponse.webFallbackReason && webFallbackResponse.webFallbackReason !== "web_fallback_disabled") {
                logResultadoConsulta({
                    responseSource: webFallbackResponse.webFallbackUsed ? "web_official" : "unconfirmed",
                    status: 200,
                    uid,
                    quotaPlan: quotaPublica ? quotaPublica.plan : null,
                    quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                    pregunta,
                    convenioUsado: convenioFileName,
                    webFallbackUsed: webFallbackResponse.webFallbackUsed,
                    webFallbackReason: webFallbackResponse.webFallbackReason,
                });
                return res.json(responderConCuota(webFallbackResponse, quotaInfo));
            }

            logResultadoConsulta({
                responseSource: "unconfirmed",
                status: 404,
                uid,
                quotaPlan: quotaPublica ? quotaPublica.plan : null,
                quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                pregunta,
                convenioUsado: convenioFileName,
            });
            return res.status(404).json(responderConCuota({
                error: "No se encontraron fragmentos relevantes del convenio para responder.",
            }, quotaInfo));
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
            "Si la pregunta tiene varias partes, responde todas las partes de forma ordenada.",
            "No empieces con fórmulas como 'Como abogado laboralista', 'Como asistente' ni con explicaciones generales.",
            "Usa lenguaje claro y directo para una persona trabajadora.",
            "No expliques el razonamiento salvo que sea imprescindible para evitar una duda.",
            "Si la consulta trata de permisos o licencias, indica si el permiso es retribuido y si consume vacaciones cuando el contexto permita confirmarlo.",
            "Si la consulta trata de faltas, sanciones o despido, diferencia falta grave y falta muy grave, no digas que una falta grave implica despido automático, y explica cuándo puede aparecer el despido según las sanciones del convenio.",
            "Si el convenio no especifica el despido para esa conducta, dilo claramente.",
            "Cita al final la fuente con convenio, artículo y apartado cuando aparezcan en el contexto.",
            "Formato preferente: respuesta directa, una línea en blanco y una línea que empiece por 'Fuente:'.",
            idiomaRespuesta === "euskera"
                ? "Responde siempre en euskera."
                : "Responde siempre en castellano.",
            "No inventes artículos, no completes con conocimiento externo y no des consejos jurídicos genéricos fuera del contexto facilitado.",
            "Si el contexto no contiene el dato exacto, di claramente: 'No he encontrado el dato exacto en los fragmentos disponibles.'",
        ].join(" ");

        const generacion = await generarRespuestaConvenio({
            promptSistema,
            idiomaRespuesta,
            pregunta,
            contexto,
        });

        const respuesta = generacion.respuesta;
        const respuestaFinal = estatutoFallback && respuestaIndicaDatoNoEncontrado(respuesta)
            ? buildWorkersStatuteFallbackResponse(estatutoFallback, { convenioFileName })
            : respuesta;
        const usaEstatutoFallback = estatutoFallback && respuestaIndicaDatoNoEncontrado(respuesta);

        if (respuestaIndicaDatoNoEncontrado(respuesta) && !usaEstatutoFallback) {
            const webFallbackResponse = await intentarFallbackWebOficial({
                pregunta,
                convenioFileName,
                conveniosFileName,
                convenioResuelto,
            });

            if (webFallbackResponse.webFallbackReason && webFallbackResponse.webFallbackReason !== "web_fallback_disabled") {
                logResultadoConsulta({
                    responseSource: webFallbackResponse.webFallbackUsed ? "web_official" : "unconfirmed",
                    status: 200,
                    uid,
                    quotaPlan: quotaPublica ? quotaPublica.plan : null,
                    quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
                    pregunta,
                    convenioUsado: convenioFileName,
                    webFallbackUsed: webFallbackResponse.webFallbackUsed,
                    webFallbackReason: webFallbackResponse.webFallbackReason,
                    finishReason: generacion.finishReason,
                    chunksUsed: chunksBase.length + chunksEspecificos.length,
                });
                return res.json(responderConCuota(webFallbackResponse, quotaInfo));
            }
        }

        logResultadoConsulta({
            responseSource: !generacion.respuestaCompleta
                ? "unconfirmed"
                : usaEstatutoFallback
                    ? "estatuto"
                    : "convenio",
            status: 200,
            uid,
            quotaPlan: quotaPublica ? quotaPublica.plan : null,
            quotaRemaining: quotaPublica ? quotaPublica.remaining : null,
            pregunta,
            convenioUsado: convenioFileName,
            finishReason: generacion.finishReason,
            chunksUsed: chunksBase.length + chunksEspecificos.length + (usaEstatutoFallback ? 1 : 0),
        });

        return res.json(responderConCuota({
            respuesta: respuestaFinal || "No he podido generar una respuesta basada en el convenio.",
            convenioUsado: convenioFileName || null,
            conveniosUsados: conveniosFileName,
            convenioDetectado: construirConvenioDetectado(convenioResuelto),
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
        }, quotaInfo));
    } catch (error) {
        escribirLogConsulta("consultarConvenio_error", {
            response_source: "error",
            status: 500,
            errorName: error && error.name ? error.name : "Error",
            errorMessage: error && error.message ? String(error.message).slice(0, 240) : "",
        });
        logResultadoConsulta({
            responseSource: "error",
            status: 500,
            uid,
            pregunta,
        });
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
