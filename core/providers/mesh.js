// core/providers/mesh.js
require('dotenv').config();
const { OpenAI } = require('openai');

// Strictly enforce the Hackathon Requirement
const MESH_GATEWAY_URL = "https://api.meshapi.ai/v1";
const DEFAULT_MODEL = "openai/gpt-4o";

function getClient() {
    const key = process.env.MESH_API_KEY;
    if (!key) throw new Error("[CRITICAL ERROR] MESH_API_KEY is missing from the environment configuration.");
    return new OpenAI({ apiKey: key, baseURL: MESH_GATEWAY_URL });
}

async function verifyModels() {
    try {
        const response = await getClient().models.list();
        return Array.isArray(response) ? response : (response.data || []);
    } catch (err) {
        console.warn(`[MESH GATEWAY WARNING] Sync bypassed: ${err.message}.`);
        return [];
    }
}

async function executeAI(prompt, model = DEFAULT_MODEL, provider = "Mesh API") {
    const startTime = Date.now();
    const safeModel = model || DEFAULT_MODEL;
    
    try {
        const response = await getClient().chat.completions.create({
            model: safeModel,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.15
        });

        return {
            success: true,
            output: response?.choices?.[0]?.message?.content || "",
            promptTokens: response?.usage?.prompt_tokens || 0,
            completionTokens: response?.usage?.completion_tokens || 0,
            tokens: response?.usage?.total_tokens || 0,
            latency: Date.now() - startTime,
            provider: provider,
            model: safeModel
        };
    } catch (err) {
        return {
            success: false,
            error: `Gateway Error (${err.status || 500}): ${err.message}`,
            statusCode: err.status || 500,
            provider: provider,
            model: safeModel,
            latency: Date.now() - startTime,
            output: null
        };
    }
}
module.exports = { executeAI, verifyModels, DEFAULT_MODEL };