const { normalizeText } = require("./convenio-metadata");

const GEMINI_SEARCH_ENDPOINT =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const DEFAULT_ALLOWED_DOMAINS = [
    "boe.es",
    "mites.gob.es",
    "expinterweb.mites.gob.es",
    "euskadi.eus",
    "gipuzkoa.eus",
    "bizkaia.eus",
    "araba.eus",
    "navarra.es",
];

const LABOR_TERMS = [
    "convenio",
    "trabajo",
    "trabajador",
    "trabajadora",
    "laboral",
    "salario",
    "sueldo",
    "jornada",
    "descanso",
    "vacaciones",
    "permiso",
    "licencia",
    "despido",
    "sancion",
    "falta",
    "contrato",
    "hosteleria",
    "alojamientos",
    "limpieza",
    "transporte",
];

const NON_LABOR_TERMS = [
    "comprar un coche",
    "comprar coche",
    "comprar un auto",
    "comprar auto",
];

function isEnabled(env = process.env) {
    return String(env.ENABLE_WEB_FALLBACK || "false").toLowerCase() === "true";
}

function maxCallsPerRequest(env = process.env) {
    const value = Number.parseInt(env.WEB_FALLBACK_MAX_CALLS_PER_REQUEST || "1", 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
}

function officialOnly(env = process.env) {
    return String(env.WEB_FALLBACK_OFFICIAL_ONLY || "true").toLowerCase() !== "false";
}

function allowedDomains(env = process.env) {
    const configured = String(env.WEB_FALLBACK_ALLOWED_DOMAINS || "")
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);

    return configured.length ? configured : DEFAULT_ALLOWED_DOMAINS;
}

function isLaborQuestion(question) {
    const normalized = normalizeText(question);
    if (!normalized) return false;
    if (NON_LABOR_TERMS.some((term) => normalized.includes(normalizeText(term)))) return false;
    return LABOR_TERMS.some((term) => normalized.includes(normalizeText(term)));
}

function hostnameFromUrl(uri) {
    try {
        return new URL(uri).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return "";
    }
}

function isAllowedOfficialValue(value, domains) {
    const normalized = String(value || "").toLowerCase();
    if (!normalized) return false;

    return domains.some((domain) => {
        const cleanDomain = domain.toLowerCase();
        return normalized === cleanDomain ||
            normalized.endsWith(`.${cleanDomain}`) ||
            normalized.includes(`//${cleanDomain}`) ||
            normalized.includes(`.${cleanDomain}`) ||
            normalized.includes(cleanDomain);
    });
}

function isAllowedOfficialUrl(uri, domains) {
    const hostname = hostnameFromUrl(uri);
    return hostname ? isAllowedOfficialValue(hostname, domains) : false;
}

function extractText(responseJson) {
    const parts = responseJson &&
        responseJson.candidates &&
        responseJson.candidates[0] &&
        responseJson.candidates[0].content &&
        Array.isArray(responseJson.candidates[0].content.parts)
        ? responseJson.candidates[0].content.parts
        : [];

    return parts.map((part) => part.text || "").join("").trim();
}

function extractFinishReason(responseJson) {
    return responseJson &&
        responseJson.candidates &&
        responseJson.candidates[0] &&
        responseJson.candidates[0].finishReason
        ? responseJson.candidates[0].finishReason
        : null;
}

function extractGroundingMetadata(responseJson) {
    return responseJson &&
        responseJson.candidates &&
        responseJson.candidates[0] &&
        responseJson.candidates[0].groundingMetadata
        ? responseJson.candidates[0].groundingMetadata
        : {};
}

function extractSources(groundingMetadata, domains) {
    const chunks = Array.isArray(groundingMetadata.groundingChunks)
        ? groundingMetadata.groundingChunks
        : [];

    return chunks
        .map((chunk) => ({
            uri: chunk && chunk.web ? chunk.web.uri || "" : "",
            title: chunk && chunk.web ? chunk.web.title || "" : "",
        }))
        .filter((source) => source.uri && (
            isAllowedOfficialUrl(source.uri, domains) ||
            isAllowedOfficialValue(source.title, domains)
        ));
}

function buildSearchSuggestions(groundingMetadata) {
    const searchEntryPoint = groundingMetadata.searchEntryPoint || null;
    const webSearchQueries = Array.isArray(groundingMetadata.webSearchQueries)
        ? groundingMetadata.webSearchQueries
        : [];

    if (!searchEntryPoint && !webSearchQueries.length) return null;

    return {
        webSearchQueries,
        searchEntryPoint,
    };
}

function buildUnavailableResponse(reason) {
    return {
        used: false,
        respuesta: "No he encontrado respuesta suficiente en el convenio ni en el Estatuto local. Tampoco he encontrado una fuente oficial externa suficiente para confirmarlo.",
        fuentes: [],
        searchSuggestions: null,
        reason,
    };
}

async function consultarFallbackWebOficial({ question, apiKey, env = process.env }) {
    if (!isEnabled(env)) {
        return buildUnavailableResponse("web_fallback_disabled");
    }

    if (maxCallsPerRequest(env) < 1) {
        return buildUnavailableResponse("web_fallback_call_limit_zero");
    }

    if (!isLaborQuestion(question)) {
        return buildUnavailableResponse("not_labor_question");
    }

    if (!apiKey) {
        return buildUnavailableResponse("missing_api_key");
    }

    const domains = allowedDomains(env);
    const currentDate = new Date().toISOString().slice(0, 10);
    const officialInstruction = officialOnly(env)
        ? `Usa solo fuentes oficiales de estos dominios: ${domains.join(", ")}. Si no encuentras fuente oficial clara, di que no puedes confirmarlo.`
        : "Prioriza fuentes oficiales. Si la fuente no es fiable, no confirmes la respuesta.";

    const body = {
        systemInstruction: {
            parts: [
                {
                    text: [
                        "Eres un asistente laboral para trabajadores en España.",
                        `Fecha actual para comprobar vigencia: ${currentDate}.`,
                        "Estás actuando como último recurso porque no hubo respuesta suficiente en el convenio propio ni en el Estatuto local.",
                        officialInstruction,
                        "Si la pregunta pide información vigente, actual o actualizada, busca la norma o dato vigente a la fecha actual y no confirmes datos de años anteriores como vigentes salvo que la fuente oficial indique que siguen aplicando.",
                        "No uses blogs, foros, gestorías privadas ni sindicatos como fuente principal.",
                        "Responde en castellano claro.",
                        "Empieza exactamente con: No he encontrado respuesta suficiente en el convenio ni en el Estatuto local. He consultado fuentes oficiales externas.",
                        "Cita fuente oficial y fecha si aparece.",
                        "Añade al final: Conviene verificar vigencia si se trata de una decisión importante.",
                    ].join(" "),
                },
            ],
        },
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `Pregunta laboral/legal: ${question}`,
                    },
                ],
            },
        ],
        tools: [
            {
                google_search: {},
            },
        ],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1200,
        },
    };

    const response = await fetch(GEMINI_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
    });

    const responseJson = await response.json().catch(() => ({}));

    if (!response.ok) {
        return {
            ...buildUnavailableResponse(`gemini_search_http_${response.status}`),
            status: response.status,
            error: responseJson && responseJson.error ? responseJson.error.message : "",
        };
    }

    const groundingMetadata = extractGroundingMetadata(responseJson);
    const fuentes = extractSources(groundingMetadata, domains);
    const searchSuggestions = buildSearchSuggestions(groundingMetadata);
    const finishReason = extractFinishReason(responseJson);
    const text = extractText(responseJson);

    if (finishReason === "MAX_TOKENS") {
        return buildUnavailableResponse("gemini_search_max_tokens");
    }

    if (officialOnly(env) && !fuentes.length) {
        return {
            ...buildUnavailableResponse("no_allowed_official_sources"),
            searchSuggestions,
        };
    }

    if (!text) {
        return {
            ...buildUnavailableResponse("empty_response"),
            searchSuggestions,
        };
    }

    return {
        used: true,
        respuesta: text,
        fuentes: fuentes.map((source, index) => ({
            id: `web_official_${index + 1}`,
            fileName: source.title,
            file_name: source.uri,
            convenioId: "web_oficial",
            chunkIndex: null,
            doc_type: "web_official",
            fuente: "web_oficial",
            distancia: null,
            url: source.uri,
            title: source.title,
        })),
        searchSuggestions,
        reason: "web_grounded",
    };
}

module.exports = {
    allowedDomains,
    consultarFallbackWebOficial,
    isEnabled,
    isLaborQuestion,
};
