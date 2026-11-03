"use strict";

const assert = require("assert");
const { GoogleGenAI } = require("@google/genai");
const { GEMINI_REQUEST_TIMEOUT_MS, embedContent, generateContentWithRetry } = require("./gemini-client");

function responseJson(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

async function run() {
    assert.strictEqual(GEMINI_REQUEST_TIMEOUT_MS, 35_000);

    let calls = 0;
    let serializedRequest;
    const ai = new GoogleGenAI({
        apiKey: "test-key",
        httpOptions: {
            fetch: async (url, options) => {
                calls += 1;
                assert.match(String(url), /models\/gemini-3\.5-flash-lite:generateContent/);
                serializedRequest = JSON.parse(options.body);
                if (calls === 1) return responseJson({ error: { code: 429, message: "rate limited" } }, 429);
                return responseJson({
                    candidates: [{ content: { role: "model", parts: [{ text: "respuesta" }] }, finishReason: "CONTINUATION" }],
                    usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 1, totalTokenCount: 10 },
                });
            },
            retryOptions: { attempts: 1 },
        },
    });

    const result = await generateContentWithRetry(ai, "gemini-3.5-flash-lite", {
        systemInstruction: "Usa solo la evidencia suministrada.",
        contents: [{ role: "user", parts: [{ text: "pregunta de prueba" }] }],
        generationConfig: {
            maxOutputTokens: 800,
            thinkingConfig: { thinkingLevel: "medium" },
            responseMimeType: "application/json",
            responseSchema: { type: "OBJECT", properties: { respuesta: { type: "STRING" } }, required: ["respuesta"] },
        },
    }, { sleep: async () => {} });

    assert.strictEqual(calls, 2, "429 solo debe producir un reintento controlado");
    assert.strictEqual(result.text, "respuesta");
    assert.strictEqual(result.candidates[0].finishReason, "CONTINUATION");
    assert.strictEqual(result.usageMetadata.totalTokenCount, 10);
    assert.strictEqual(serializedRequest.generationConfig.thinkingConfig.thinkingLevel, "medium");
    assert.strictEqual(serializedRequest.generationConfig.responseMimeType, "application/json");
    assert.strictEqual(serializedRequest.systemInstruction.parts[0].text, "Usa solo la evidencia suministrada.");
    assert.strictEqual("httpOptions" in serializedRequest.generationConfig, false);
    assert.strictEqual("candidateCount" in serializedRequest.generationConfig, false);

    let serverCalls = 0;
    const serverClient = new GoogleGenAI({
        apiKey: "test-key",
        httpOptions: {
            fetch: async () => {
                serverCalls += 1;
                if (serverCalls === 1) return responseJson({ error: { code: 503, message: "unavailable" } }, 503);
                return responseJson({ candidates: [{ finishReason: "MAX_TOKENS" }] });
            },
            retryOptions: { attempts: 1 },
        },
    });
    const capped = await generateContentWithRetry(serverClient, "gemini-3.5-flash-lite", {
        contents: [{ role: "user", parts: [{ text: "respuesta larga" }] }],
    }, { sleep: async () => {} });
    assert.strictEqual(serverCalls, 2, "503 solo debe producir un reintento controlado");
    assert.strictEqual(capped.candidates[0].finishReason, "MAX_TOKENS", "el SDK debe conservar MAX_TOKENS para la abstención/reintento de nivel superior");

    let invalidCalls = 0;
    const invalidClient = new GoogleGenAI({
        apiKey: "test-key",
        httpOptions: {
            fetch: async () => {
                invalidCalls += 1;
                return responseJson({ error: { code: 400, message: "invalid request" } }, 400);
            },
            retryOptions: { attempts: 1 },
        },
    });
    await assert.rejects(
        generateContentWithRetry(invalidClient, "gemini-3.5-flash-lite", { contents: "bad request" }, { sleep: async () => {} }),
        /invalid request/,
    );
    assert.strictEqual(invalidCalls, 1, "400 no debe reintentarse");

    const expectedValues = Array.from({ length: 768 }, (_, index) => index / 768);
    let embeddingRequest;
    const embeddingClient = new GoogleGenAI({
        apiKey: "test-key",
        httpOptions: {
            fetch: async (url, options) => {
                assert.match(String(url), /models\/gemini-embedding-001:batchEmbedContents/);
                embeddingRequest = JSON.parse(options.body);
                return responseJson({
                    embeddings: [{ values: expectedValues }, { values: expectedValues }],
                });
            },
            retryOptions: { attempts: 1 },
        },
    });
    const vectors = await embedContent(
        embeddingClient,
        "gemini-embedding-001",
        ["consulta", "consulta de prueba"],
        { taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 },
    );
    assert.strictEqual(vectors.length, 2);
    assert.strictEqual(vectors[0].length, 768);
    assert.strictEqual(embeddingRequest.requests.length, 2);
    assert.strictEqual(embeddingRequest.requests[0].model, "models/gemini-embedding-001");
    assert.strictEqual(embeddingRequest.requests[0].outputDimensionality, 768);

    console.log("SDK @google/genai: GenerateContent, timeout/retry, MAX_TOKENS metadata y embeddings 768 comprobados.");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
