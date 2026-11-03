"use strict";

const assert = require("assert");
const { GEMINI_REQUEST_TIMEOUT_MS, generateContentWithRetry } = require("./gemini-client");
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
    assert.strictEqual(GEMINI_REQUEST_TIMEOUT_MS, 35_000);

    let calls = 0;
    const result = await generateContentWithRetry({
        async generateContent(_request, options) {
            calls += 1;
            assert.ok(options.signal instanceof AbortSignal);
            if (calls === 1) throw Object.assign(new Error("rate limited"), { status: 429 });
            return "ok";
        },
    }, {}, { sleep: async () => {} });
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 2);

    const originalFetch = global.fetch;
    let serializedRequest;
    global.fetch = async (url, options) => {
        assert.match(String(url), /models\/gemini-3\.5-flash-lite:generateContent/);
        assert.ok(options.signal instanceof AbortSignal);
        serializedRequest = JSON.parse(options.body);
        return new Response(JSON.stringify({
            candidates: [{ content: { role: "model", parts: [{ text: "respuesta" }] }, finishReason: "STOP" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
        const model = new GoogleGenerativeAI("test-key").getGenerativeModel({ model: "gemini-3.5-flash-lite" });
        await generateContentWithRetry(model, {
            contents: [{ role: "user", parts: [{ text: "pregunta de prueba" }] }],
            generationConfig: {
                maxOutputTokens: 100,
                thinkingConfig: { thinkingLevel: "medium" },
            },
        }, { sleep: async () => {} });
    } finally {
        global.fetch = originalFetch;
    }
    assert.deepStrictEqual(serializedRequest.generationConfig, {
        maxOutputTokens: 100,
        thinkingConfig: { thinkingLevel: "medium" },
    });
    assert.strictEqual("temperature" in serializedRequest.generationConfig, false);

    calls = 0;
    await assert.rejects(generateContentWithRetry({
        async generateContent() {
            calls += 1;
            throw Object.assign(new Error("invalid request"), { status: 400 });
        },
    }, {}, { sleep: async () => {} }), /invalid request/);
    assert.strictEqual(calls, 1);

    calls = 0;
    await assert.rejects(generateContentWithRetry({
        async generateContent() {
            calls += 1;
            throw Object.assign(new Error("unavailable"), { status: 503 });
        },
    }, {}, { sleep: async () => {} }), /unavailable/);
    assert.strictEqual(calls, 2);

    console.log("Cliente Gemini: timeout, retry transitorio y errores 400/5xx comprobados.");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
