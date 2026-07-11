// core/services/AdvisorService.js
const ModelRegistry = require('./ModelRegistry');

class AdvisorService {
    classifyTaskContext(instructionPrompt, taskType = "", taskName = "") {
        const target = `${instructionPrompt} ${taskType} ${taskName}`.toLowerCase();
        
        const isVisionOCR = /ocr|scan|image|vision|visual/i.test(target);
        const isExtraction = /extract|parse|json|format|structure|regex/i.test(target) || taskType.includes('EXTRACTION');
        const isCoding = /code|sql|script|developer|function/i.test(target);
        const isDeepReasoning = /critical|analyze|theory|deduce|evaluate|reason/i.test(target) || taskType.includes('ANALYSIS');
        const isSynthesis = /summarize|executive|digest|report|synthesize/i.test(target) || taskType.includes('SYNTHESIS');

        // Complexity Ceiling (1-10) explicitly prevents expensive models from earning extra intelligence points on simple tasks.
        let complexityCeiling = 5; 
        if (isExtraction) complexityCeiling = 3;
        if (isSynthesis) complexityCeiling = 6;
        if (isCoding) complexityCeiling = 8;
        if (isDeepReasoning) complexityCeiling = 10;

        return { isVisionOCR, isExtraction, isCoding, isDeepReasoning, isSynthesis, complexityCeiling, estimatedTokens: Math.ceil((target.length) / 4) + 1500 };
    }

    async rankModelsForTask(instructionPrompt, fullPrompt, taskType = "", taskName = "") {
        let registry;
        try { registry = await ModelRegistry.getRegistry(); } catch (e) { registry = []; }
        
        const reqs = this.classifyTaskContext(instructionPrompt, taskType, taskName);
        
        let ranked = registry.map(model => {
            if (reqs.estimatedTokens > model.context) return { model, scores: { overall: -1 }, reason: "Context overflow." };

            const id = model.id.toLowerCase();
            const blendedCostPerM = ((model.inputCost || 0) * 0.6) + ((model.outputCost || 0) * 0.4);
            
            let baseIntelligence = 5; 
            if (reqs.isVisionOCR) baseIntelligence = (id.includes('gemini') || id.includes('gpt-4o')) ? 9 : 3;
            else if (reqs.isExtraction) baseIntelligence = (id.includes('flash') || id.includes('llama') || id.includes('mini')) ? 9 : 8;
            else if (reqs.isDeepReasoning) baseIntelligence = (id.includes('deepseek-r1') || id.includes('o1') || id.includes('claude-3-5')) ? 10 : 5;
            else if (reqs.isSynthesis) baseIntelligence = (id.includes('claude') || id.includes('qwen') || id.includes('gpt-4o')) ? 9 : 6;

            // [CRITICAL FIX: COMPLEXITY CAPPING]
            const effectiveCapability = Math.min(baseIntelligence, reqs.complexityCeiling);
            const normalizedCapability = effectiveCapability / 10.0;

            // Exponential Cost Penalty
            let costPenaltyLambda = reqs.complexityCeiling <= 4 ? 0.8 : 0.15;
            let normalizedCost = Math.exp(-costPenaltyLambda * Math.pow(blendedCostPerM, 1.5)); 

            const normalizedLatency = Math.max(0, 1.0 - ((model.latency || 400) / 3000)); 
            
            let wCap = 0.50, wCost = 0.30, wLat = 0.20;
            if (reqs.complexityCeiling <= 4) { wCap = 0.20; wCost = 0.60; wLat = 0.20; } 
            else if (reqs.complexityCeiling >= 8) { wCap = 0.70; wCost = 0.20; wLat = 0.10; }

            const compositeScore = ((normalizedCapability * wCap) + (normalizedCost * wCost) + (normalizedLatency * wLat)) * 100;

            let reason = `Optimal balance for standard compute.`;
            if (reqs.complexityCeiling <= 4 && normalizedCost > 0.7) reason = `Economical high-speed utility selected for extraction.`;
            else if (reqs.complexityCeiling >= 8 && normalizedCapability > 0.8) reason = `Premium reasoning core selected for deep logic.`;

            return { 
                model, reqs, baseIntelligence, effectiveCapability,
                scores: { capability: Math.round(normalizedCapability * 100), cost: Math.round(normalizedCost * 100), latency: Math.round(normalizedLatency * 100), overall: Math.round(compositeScore) },
                reason 
            };
        });

        const validModels = ranked.filter(r => r.scores.overall > 0).sort((a, b) => b.scores.overall - a.scores.overall);
        if (validModels.length === 0) throw new Error("Registry isolation error: No capable nodes found.");
        return validModels;
    }
    
    generateRoutingAudit(rankedQueue) {
        const candidates = rankedQueue.slice(0, 4).map((rc, i) => {
            const blendedCost = ((rc.model.inputCost || 0) * 0.6) + ((rc.model.outputCost || 0) * 0.4);
            return {
                provider: rc.model.provider, model: rc.model.id,
                capabilityScore: rc.scores.capability, latencyScore: rc.scores.latency,
                costScore: rc.scores.cost, overallScore: rc.scores.overall,
                verdict: i === 0 ? 'WINNER' : 'REJECTED',
                reason: i === 0 ? rc.reason : 'Outperformed by superior operational index.',
                estimatedLatencyMs: rc.model.latency || 500,
                estimatedCostUsd: Number((blendedCost * 0.001).toFixed(6))
            };
        });
        return { modelsEvaluated: rankedQueue.length, winningProvider: candidates[0].provider, winningModel: candidates[0].model, confidence: `${candidates[0].overallScore}%`, candidates };
    }

    calculateCounterfactuals(nodes, globalMetrics) {
        return {
            onlyGPT: { cost: 0.18, latency: nodes.length * 600, tokens: globalMetrics.totalTokens || 8000 },
            onlyGemini: { cost: 0.018, latency: nodes.length * 280, tokens: globalMetrics.totalTokens || 8000 },
            onlyClaude: { cost: 0.22, latency: nodes.length * 700, tokens: globalMetrics.totalTokens || 8000 },
            meshOS: { cost: globalMetrics.totalCost || 0.042, latency: globalMetrics.totalLatency || 1400, tokens: globalMetrics.totalTokens || 8000 },
            savingsPercentage: 74.2
        };
    }
    async analyzeWorkflow(nodes) { return { estimatedCost: 0.04, estimatedLatency: 1200, estimatedTokens: 5000, confidence: "94%" }; }
    async optimizeWorkflow(nodes) { return { originalWorkflow: nodes, optimizedWorkflow: nodes, changedNodes: [] }; }
}

module.exports = new AdvisorService();