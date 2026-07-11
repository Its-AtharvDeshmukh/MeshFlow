// core/state-manager.js
const eventBus = require('./events/EventBus');

class WorkflowExecutionContext {
    constructor(workflowId, workflowName, nodes) {
        this.workflowId = workflowId;
        this.workflowName = workflowName;
        this.status = 'QUEUED';
        this.progress = 0;
        this.nodes = nodes || [];
        this.outputs = {};
        this.timestamps = { startedAt: new Date().toISOString() };
        
        this.intelligenceEvents = [];
        this.metrics = {
            totalLatency: 0,
            totalCost: 0,
            totalTokens: 0
        };
    }

    transition(newStatus) { this.status = newStatus; }

    addMetric(latency, cost, promptTokens, completionTokens, totalTokens) {
        this.metrics.totalLatency += (latency || 0);
        this.metrics.totalCost += (cost || 0);
        this.metrics.totalTokens += (totalTokens || 0);
    }

    addIntelligenceEvent(type, message, nodeId = null, provider = null, model = null, durationMs = null, reason = null) {
        this.intelligenceEvents.push({
            timestamp: new Date().toISOString(),
            type, message, nodeId, provider, model, durationMs, reason
        });
    }

    toFrontendData() {
        return {
            workflowId: this.workflowId, workflowName: this.workflowName,
            status: this.status, progress: this.progress,
            nodes: this.nodes, intelligenceEvents: this.intelligenceEvents,
            metrics: this.metrics, finalOutput: this.finalOutput, counterfactuals: this.counterfactuals
        };
    }
}

class WorkflowStateManager {
    constructor() { this.store = new Map(); setInterval(() => this.garbageCollect(), 15 * 60 * 1000); }
    initialize(workflowId, workflowName, nodes) {
        if (this.store.size > 500) this.garbageCollect(true);
        const ctx = new WorkflowExecutionContext(workflowId, workflowName, nodes);
        this.store.set(workflowId, ctx);
        eventBus.emit('workflow.started', { workflowId });
        return ctx;
    }
    getContext(workflowId) { return this.store.get(workflowId); }
    updateNodeProgress(workflowId, nodeIndex, percentComplete) {
        const ctx = this.getContext(workflowId);
        if (ctx) ctx.progress = percentComplete;
    }
    cleanup(workflowId) { this.store.delete(workflowId); }
    garbageCollect(force = false) {
        const now = Date.now();
        for (const [id, ctx] of this.store.entries()) {
            const age = now - new Date(ctx.timestamps.startedAt).getTime();
            if (force || age > 30 * 60 * 1000 || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(ctx.status)) {
                this.store.delete(id);
            }
        }
    }
    cancelExecution(workflowId) {
        const ctx = this.getContext(workflowId);
        if (ctx && ['QUEUED', 'RUNNING', 'WAITING_FOR_MODEL'].includes(ctx.status)) {
            ctx.transition('CANCELLED');
            ctx.addIntelligenceEvent("CANCELLED", "Execution cancelled by user.");
            eventBus.emit('workflow.cancelled', { workflowId });
            return true;
        }
        return false;
    }
}
module.exports = new WorkflowStateManager();