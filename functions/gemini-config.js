"use strict";

const DEFAULT_GENERATION_MODEL = "gemini-3.5-flash-lite";

function getGenerationModel(env = process.env) {
    return String(env.GEMINI_CONSULTATION_MODEL || DEFAULT_GENERATION_MODEL).trim();
}

function getThinkingLevel(env = process.env) {
    const level = String(env.GEMINI_THINKING_LEVEL || "medium").trim().toLowerCase();
    return ["minimal", "low", "medium", "high"].includes(level) ? level : "medium";
}

module.exports = { DEFAULT_GENERATION_MODEL, getGenerationModel, getThinkingLevel };
