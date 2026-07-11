// core/services/ModelRegistry.js
const { verifyModels } = require('../providers/mesh');

class ModelRegistry {
    constructor() {
        this.liveRegistry = null;
        this.lastFetch = 0;
        this.cacheTTL = 1000 * 60 * 60; // 1 hour cache TTL

        // Augmented fallback matrix containing exact capability mappings for top-tier Mesh API models
        this.fallbackRegistry = [
            { id: "deepseek/deepseek-r1", provider: "DeepSeek", capabilities: { reasoning: 1.0, coding: 0.98, json: 0.85, math: 1.0, creative: 0.70, vision: 0, translation: 0.70 }, context: 128000, inputCost: 0.55, outputCost: 2.19, latency: 900, stats: { successRate: 0.99 } },
            { id: "openai/o3-mini", provider: "OpenAI", capabilities: { reasoning: 0.98, coding: 0.95, json: 0.90, math: 0.95, creative: 0.70, vision: 0, translation: 0.80 }, context: 200000, inputCost: 1.10, outputCost: 4.40, latency: 800, stats: { successRate: 0.99 } },
            { id: "openai/gpt-4o", provider: "OpenAI", capabilities: { reasoning: 0.90, coding: 0.90, json: 0.95, math: 0.85, creative: 0.90, vision: 0.98, translation: 0.90 }, context: 128000, inputCost: 2.50, outputCost: 10.00, latency: 600, stats: { successRate: 0.99 } },
            { id: "anthropic/claude-3-5-sonnet", provider: "Anthropic", capabilities: { reasoning: 1.0, coding: 1.0, json: 0.95, math: 0.85, creative: 0.98, vision: 0.90, translation: 0.80 }, context: 200000, inputCost: 3.00, outputCost: 15.00, latency: 700, stats: { successRate: 0.99 } },
            { id: "anthropic/claude-3-haiku", provider: "Anthropic", capabilities: { reasoning: 0.75, coding: 0.70, json: 0.95, math: 0.60, creative: 0.85, vision: 0.80, translation: 0.75 }, context: 200000, inputCost: 0.25, outputCost: 1.25, latency: 350, stats: { successRate: 0.99 } },
            { id: "google/gemini-2.5-flash", provider: "Google", capabilities: { reasoning: 0.80, coding: 0.80, json: 0.95, math: 0.75, creative: 0.85, vision: 1.0, translation: 0.90 }, context: 1000000, inputCost: 0.075, outputCost: 0.30, latency: 250, stats: { successRate: 0.99 } },
            { id: "google/gemini-2.5-pro", provider: "Google", capabilities: { reasoning: 0.94, coding: 0.90, json: 0.90, math: 0.90, creative: 0.92, vision: 1.0, translation: 0.95 }, context: 2000000, inputCost: 3.50, outputCost: 10.50, latency: 800, stats: { successRate: 0.99 } },
            { id: "meta/llama-3.3-70b-instruct", provider: "Meta", capabilities: { reasoning: 0.88, coding: 0.85, json: 0.90, math: 0.70, creative: 0.85, vision: 0, translation: 0.80 }, context: 128000, inputCost: 0.40, outputCost: 0.40, latency: 400, stats: { successRate: 0.99 } },
            { id: "mistral/mistral-large", provider: "Mistral", capabilities: { reasoning: 0.90, coding: 0.85, json: 0.92, math: 0.75, creative: 0.88, vision: 0, translation: 0.85 }, context: 128000, inputCost: 2.00, outputCost: 6.00, latency: 600, stats: { successRate: 0.99 } },
            { id: "qwen/qwen-2.5-72b", provider: "Qwen", capabilities: { reasoning: 0.85, coding: 0.85, json: 0.80, math: 0.75, creative: 0.90, vision: 0.80, translation: 0.90 }, context: 32000, inputCost: 0.35, outputCost: 0.40, latency: 380, stats: { successRate: 0.99 } },
            { id: "cohere/command-r-plus", provider: "Cohere", capabilities: { reasoning: 0.85, coding: 0.80, json: 0.88, math: 0.60, creative: 0.95, vision: 0, translation: 0.80 }, context: 128000, inputCost: 2.50, outputCost: 10.00, latency: 900, stats: { successRate: 0.99 } }
        ];
    }

    async getRegistry() {
        if (this.liveRegistry && (Date.now() - this.lastFetch < this.cacheTTL)) return this.liveRegistry;
        
        try {
            const liveData = await verifyModels();
            if (liveData && Array.isArray(liveData) && liveData.length > 0) {
                this.liveRegistry = liveData.map(apiModel => {
                    const idStr = typeof apiModel === 'string' ? apiModel : (apiModel.id || "unknown");
                    const idLower = idStr.toLowerCase();
                    
                    let provider = "Unknown";
                    if (idStr.includes('/')) provider = idStr.split('/')[0];
                    else if (idLower.includes('gpt') || idLower.includes('o1') || idLower.includes('o3')) provider = "OpenAI";
                    else if (idLower.includes('claude')) provider = "Anthropic";
                    else if (idLower.includes('gemini')) provider = "Google";
                    else if (idLower.includes('llama')) provider = "Meta";
                    else if (idLower.includes('deepseek')) provider = "DeepSeek";
                    else if (idLower.includes('glm')) provider = "Zhipu";
                    else if (idLower.includes('qwen')) provider = "Qwen";
                    else if (idLower.includes('mistral')) provider = "Mistral";
                    else if (idLower.includes('cohere')) provider = "Cohere";
                    
                    provider = provider.charAt(0).toUpperCase() + provider.slice(1);

                    const existing = this.fallbackRegistry.find(f => f.id === idStr);
                    
                    // Base capabilities for unmatched models
                    let caps = { reasoning: 0.6, coding: 0.6, json: 0.7, math: 0.5, creative: 0.6, vision: 0, translation: 0.5 };
                    
                    if (idLower.includes('deepseek')) caps = { reasoning: 1.0, coding: 0.98, json: 0.85, math: 1.0, creative: 0.7, vision: 0, translation: 0.7 };
                    else if (idLower.includes('claude')) caps = { reasoning: 1.0, coding: 0.95, json: 0.95, math: 0.9, creative: 0.98, vision: 0.9, translation: 0.8 };
                    else if (idLower.includes('gemini')) caps = { reasoning: 0.9, coding: 0.85, json: 0.95, math: 0.85, creative: 0.85, vision: 1.0, translation: 0.9 };
                    else if (idLower.includes('gpt') || idLower.includes('o1') || idLower.includes('o3')) caps = { reasoning: 0.95, coding: 0.95, json: 1.0, math: 0.95, creative: 0.9, vision: 0.95, translation: 0.9 };
                    else if (idLower.includes('glm')) caps = { reasoning: 0.8, coding: 0.8, json: 0.8, math: 0.8, creative: 0.9, vision: 0, translation: 1.0 };
                    else if (idLower.includes('llama')) caps = { reasoning: 0.85, coding: 0.85, json: 0.90, math: 0.70, creative: 0.85, vision: 0, translation: 0.8 };
                    else if (idLower.includes('mistral')) caps = { reasoning: 0.90, coding: 0.85, json: 0.92, math: 0.75, creative: 0.88, vision: 0, translation: 0.85 };
                    else if (idLower.includes('qwen')) caps = { reasoning: 0.85, coding: 0.85, json: 0.80, math: 0.75, creative: 0.90, vision: 0.8, translation: 0.90 };
                    else if (idLower.includes('cohere')) caps = { reasoning: 0.85, coding: 0.80, json: 0.88, math: 0.60, creative: 0.95, vision: 0, translation: 0.80 };
                    
                    let inputCost = 0.5; let outputCost = 1.5; let context = 64000;
                    if (apiModel.pricing) {
                        const inRaw = apiModel.pricing.prompt_usd_per_1k || apiModel.pricing.prompt;
                        const outRaw = apiModel.pricing.completion_usd_per_1k || apiModel.pricing.completion;
                        if (inRaw && inRaw !== "None") inputCost = parseFloat(String(inRaw).replace(/[^0-9.]/g, '')) * 1000;
                        if (outRaw && outRaw !== "None") outputCost = parseFloat(String(outRaw).replace(/[^0-9.]/g, '')) * 1000;
                    }
                    if (apiModel.context_length) context = apiModel.context_length;
                    
                    return existing || { id: idStr, provider, context, inputCost, outputCost, latency: 500, stats: { successRate: 0.99 }, capabilities: caps };
                });
                
                this.lastFetch = Date.now();
                return this.liveRegistry;
            }
        } catch (err) { 
            console.warn("[REGISTRY EXCEPTION] Gateway sync check failed. Engaging fallback matrix."); 
        }
        return this.fallbackRegistry;
    }

    updateTelemetry(modelId, success) {
        const targetCollection = this.liveRegistry || this.fallbackRegistry;
        let model = targetCollection.find(m => m.id === modelId);
        if (model && model.stats) {
            const currentRate = model.stats.successRate || 0.99;
            model.stats.successRate = success ? Math.min(0.99, currentRate + 0.01) : Math.max(0.10, currentRate - 0.15); 
        }
    }
}
module.exports = new ModelRegistry();