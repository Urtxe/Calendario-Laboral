"use strict";

const GEMINI_REQUEST_TIMEOUT_MS = 35_000;
const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function getHttpStatus(error) {
    return Number(error?.status || error?.statusCode || error?.response?.status || 0);
}

async function generateContentWithRetry(model, request, options = {}) {
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
        try {
            return await model.generateContent(request, { signal: controller.signal });
        } catch (error) {
            if (attempt >= 1 || !TRANSIENT_HTTP_STATUSES.has(getHttpStatus(error))) throw error;
            await sleep(250);
        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = { GEMINI_REQUEST_TIMEOUT_MS, generateContentWithRetry };
