"use strict";

const GEMINI_REQUEST_TIMEOUT_MS = 35_000;
const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function getHttpStatus(error) {
    return Number(error?.status || error?.statusCode || error?.response?.status || 0);
}

async function generateContentWithRetry(client, model, request, options = {}) {
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await client.models.generateContent({
                model,
                contents: request.contents,
                config: {
                    ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
                    ...(request.generationConfig || {}),
                    automaticContinuation: false,
                    httpOptions: {
                        timeout: GEMINI_REQUEST_TIMEOUT_MS,
                        retryOptions: { attempts: 1 },
                    },
                },
            });
        } catch (error) {
            if (attempt >= 1 || !TRANSIENT_HTTP_STATUSES.has(getHttpStatus(error))) throw error;
            await sleep(250);
        }
    }
}

async function embedContent(client, model, contents, config = {}) {
    const { httpOptions, ...embedConfig } = config;
    const response = await client.models.embedContent({
        model,
        contents,
        config: {
            ...embedConfig,
            httpOptions: {
                timeout: GEMINI_REQUEST_TIMEOUT_MS,
                retryOptions: { attempts: 1 },
                ...httpOptions,
            },
        },
    });
    return response.embeddings?.map((embedding) => embedding.values || []) || [];
}

module.exports = { GEMINI_REQUEST_TIMEOUT_MS, embedContent, generateContentWithRetry };
