"use strict";

const assert = require("assert");
const { DEFAULT_GENERATION_MODEL, getGenerationModel, getThinkingLevel } = require("./gemini-config");

assert.strictEqual(DEFAULT_GENERATION_MODEL, "gemini-3.5-flash-lite");
assert.strictEqual(getGenerationModel({}), DEFAULT_GENERATION_MODEL);
assert.strictEqual(getGenerationModel({ GEMINI_CONSULTATION_MODEL: "gemini-test-model" }), "gemini-test-model");
assert.strictEqual(getThinkingLevel({}), "medium");
assert.strictEqual(getThinkingLevel({ GEMINI_THINKING_LEVEL: "low" }), "low");
assert.strictEqual(getThinkingLevel({ GEMINI_THINKING_LEVEL: "invalid" }), "medium");

console.log("Configuración Gemini: modelo y thinking_level comprobados.");
