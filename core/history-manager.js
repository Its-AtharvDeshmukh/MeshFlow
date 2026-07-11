const Execution = require('../models/Execution');

async function saveExecution(ctx) {
    try {
        const uniqueModels = [...new Set(ctx.nodes.map(n => n.apiModel).filter(Boolean))];

        const record = new Execution({
            executionId: ctx.workflowId,
            workflowName: ctx.workflowName,
            status: ctx.status,
            originalDocument: ctx.documentContext || "",
            
            // [WOW FEATURE]: Write intelligence replay tracking arrays to MongoDB
            intelligenceEvents: ctx.intelligenceEvents || [],
            counterfactuals: ctx.counterfactuals || {},

            totalLatency: ctx.metrics.totalLatency,
            totalCost: ctx.metrics.totalCost,
            totalTokens: ctx.metrics.totalTokens,
            modelsUsed: uniqueModels,
            finalOutput: ctx.finalOutput,
            logs: ctx.logs,
            nodes: ctx.nodes,
            executionGraph: ctx.executionGraph || [],
            advisorOutput: ctx.advisorOutput || null,
            optimizerOutput: ctx.optimizerOutput || null,
            startedAt: ctx.timestamps.startedAt,
            finishedAt: ctx.timestamps.finishedAt || new Date().toISOString()
        });

        await record.save();
    } catch (err) {
        console.error("[DATABASE ERROR] Failed to save execution history:", err.message);
    }
}

async function getAllExecutions() {
    return await Execution.find().sort({ startedAt: -1 }).lean();
}

module.exports = { saveExecution, getAllExecutions };