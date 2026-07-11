// core/context/WorkflowExecutionContext.js
class WorkflowExecutionContext {
    constructor(workflowId, workflowName, rawNodes = []) {
        this.workflowId = workflowId;
        this.executionId = workflowId; 
        this.workflowName = workflowName;
        this.status = 'CREATED'; 
        this.currentNode = null;
        this.activeModel = null;
        this.visitedNodes = [];
        this.outputs = {};
        
        // FIX: Pre-initialized correctly mapped counters for Mission Control Network Cost UI
        this.metrics = { 
            totalCost: 0, 
            totalLatency: 0, 
            totalTokens: 0, 
            promptTokens: 0, 
            completionTokens: 0, 
            retries: 0 
        };
        
        this.errors = [];
        this.logs = [];
        this.nodes = rawNodes;
        this.timestamps = { startedAt: new Date().toISOString(), finishedAt: null };
        this.finalOutput = null;
        this.progress = 0;
        
        this.intelligenceEvents = [];
        this.counterfactuals = {};
        
        this.emitIntelligenceEvent('UPLOAD_RECEIVED', 'Document and user instructions intercepted by Mesh OS.', null, null, null, null, 'Initialization sequence started.');
    }

    transition(newStatus) {
        this.status = newStatus;
        this.addLog(`[SYSTEM] Transitioned to state: ${newStatus}`, "info");
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(newStatus)) {
            this.timestamps.finishedAt = new Date().toISOString();
        }
    }

    emitIntelligenceEvent(type, message, nodeId = null, provider = null, model = null, durationMs = null, reason = null, details = {}) {
        this.intelligenceEvents.push({
            timestamp: new Date().toISOString(), type, message, nodeId, provider, model, durationMs, reason, details
        });
    }

    // FIX: Accurate arithmetic assignments
    addMetric(latency, cost, promptTokens, completionTokens, totalTokens) {
        this.metrics.totalLatency += (latency || 0);
        this.metrics.totalCost += (cost || 0);
        this.metrics.promptTokens += (promptTokens || 0);
        this.metrics.completionTokens += (completionTokens || 0);
        this.metrics.totalTokens += (totalTokens || 0);
    }

    addLog(message, type = "info") {
        this.logs.push({ timestamp: new Date().toISOString(), type, message });
        this.lastEvent = message;
    }

    toFrontendData() {
        const statusMap = { 
            'CREATED': 'pending', 'VALIDATING': 'pending', 'PARSING': 'pending', 
            'GENERATING_WORKFLOW': 'pending', 'READY': 'pending',
            'RUNNING': 'running', 'WAITING_FOR_MODEL': 'running', 'EXECUTING_NODE': 'running',
            'RETRYING': 'running', 'SYNTHESIZING': 'running',
            'NODE_COMPLETED': 'running', 'NODE_FAILED': 'running',
            'COMPLETED': 'completed', 'FAILED': 'failed', 'CANCELLED': 'failed' 
        };
        
        return {
            id: this.executionId,
            workflowName: this.workflowName,
            status: statusMap[this.status] || 'pending',
            detailedState: this.status,
            progress: this.progress,
            currentNode: this.currentNode?.taskName || null,
            activeModel: this.activeModel,
            metrics: this.metrics,
            logs: this.logs,
            intelligenceEvents: this.intelligenceEvents,
            counterfactuals: this.counterfactuals,
            lastEvent: this.lastEvent,
            nodes: this.nodes.map(n => ({
                ...n, status: statusMap[n.status] || n.status
            })),
            finalOutput: this.finalOutput,
            startedAt: this.timestamps.startedAt
        };
    }
}
module.exports = WorkflowExecutionContext;