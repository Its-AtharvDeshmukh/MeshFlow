// core/providers/MeshRouterService.js
const { executeAI } = require('./mesh');
const ModelRegistry = require('../services/ModelRegistry');

class MeshRouterService {
    async routeRequest(workflowId, nodeId, prompt, routingQueue) {
        let lastError = null;

        for (let i = 0; i < routingQueue.length; i++) {
            const candidate = routingQueue[i].model;
            console.log(`[MESH ROUTER] Dispatching Node [${nodeId}] -> Provider: ${candidate.provider} | Model: ${candidate.id}`);
            
            const result = await executeAI(prompt, candidate.id, candidate.provider);
            
            if (result.success) {
                return { ...result, actualModel: candidate.id, actualProvider: candidate.provider };
            }
            
            console.warn(`[MESH FALLBACK] Model ${candidate.id} failed. Escalating to next active node in matrix...`);
            lastError = result.error;
            ModelRegistry.updateTelemetry(candidate.id, false);
        }

        throw new Error(`All routed models in the matrix failed. Last Error: ${lastError}`);
    }
}

module.exports = new MeshRouterService();