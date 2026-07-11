const mongoose = require('mongoose');

const executionSchema = new mongoose.Schema({
    executionId: { type: String, required: true, unique: true, index: true },
    originalExecutionId: { type: String, default: null }, 
    workflowName: { type: String, required: true },
    status: { type: String, required: true },
    originalDocument: { type: String, default: "" },
    
    // Feature 5: Intelligence Events Ledger
    intelligenceEvents: [
        {
            timestamp: { type: String, required: true },
            type: { type: String, required: true },
            message: { type: String, required: true },
            nodeId: { type: String, default: null },
            provider: { type: String, default: null },
            model: { type: String, default: null },
            durationMs: { type: Number, default: null },
            reason: { type: String, default: null },
            details: { type: mongoose.Schema.Types.Mixed, default: {} }
        }
    ],
    
    // Feature 4: Counterfactual Universe Engine
    counterfactuals: {
        onlyGPT: { cost: Number, latency: Number, tokens: Number },
        onlyGemini: { cost: Number, latency: Number, tokens: Number },
        onlyClaude: { cost: Number, latency: Number, tokens: Number },
        onlyCheapest: { cost: Number, latency: Number, tokens: Number },
        onlyFastest: { cost: Number, latency: Number, tokens: Number },
        meshOS: { cost: Number, latency: Number, tokens: Number },
        savingsPercentage: Number,
        speedMultiplier: Number
    },

    totalLatency: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    modelsUsed: { type: [String], default: [] },
    finalOutput: { type: mongoose.Schema.Types.Mixed, default: null },
    logs: { type: Array, default: [] },
    nodes: { type: Array, default: [] }, // Nodes will now contain routingAudit and attemptHistory
    executionGraph: { type: Array, default: [] }, 
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date, default: null }
});

module.exports = mongoose.model('Execution', executionSchema);