// core/executor.js
const stateManager = require('./state-manager');
const meshRouter = require('./providers/MeshRouterService');
const historyManager = require('./history-manager');
const AdvisorService = require('./services/AdvisorService');

async function processWithLimit(items, limit, asyncFn) {
    let active = 0, index = 0; const results = [];
    return new Promise((resolve) => {
        const next = async () => {
            if (index >= items.length && active === 0) return resolve(results);
            if (index >= items.length) return;
            const currentIndex = index++;
            active++;
            try { results[currentIndex] = await asyncFn(items[currentIndex]); } 
            catch (err) { results[currentIndex] = { error: err.message }; } 
            finally { active--; next(); }
        };
        for (let i = 0; i < limit && i < items.length; i++) next();
    });
}

function buildContextualPrompt(node, ctx) {
    const dependencies = node.dependencies || [];
    let cumulativeHistoryStr = "";

    if (dependencies.length > 0) {
        cumulativeHistoryStr = dependencies.map(depId => {
            const parentNode = ctx.nodes.find(n => n.id === depId);
            const rawOutput = ctx.outputs[depId] || "Pending context.";
            const cleanOutput = rawOutput.length > 4000 ? (rawOutput.substring(0, 4000) + "... [Truncated by OS]") : rawOutput;
            return `[Upstream Output - ${parentNode?.taskName || depId}]:\n${cleanOutput}`;
        }).join('\n\n');
    }

    return `[SYSTEM PROMPT]
    You are a real-time compute worker execution thread running within the MeshFlow X AI Operating System.
    
    [TASK DIRECTIVE]
    Task Operational Function: ${node.taskName || node.name}
    Task Type: ${node.taskType}
    Sequence Strategy Code: ${node.prompt}
    
    [UPSTREAM DATA MEMORY]
    ${cumulativeHistoryStr || "No upstream dependencies linked to this execution thread."}
    
    [SOURCE GROUNDING DOCUMENT LAYER]
    ${ctx.documentContext || "Null data segment descriptor."}
    
    STRICT PRODUCTION SOURCE GROUNDING BOUNDARIES:
    1. Base all analytical assumptions strictly on the [SOURCE GROUNDING DOCUMENT LAYER] text.
    2. Every major insight or textual match statement MUST explicitly provide an inline source citation tracker mapping back to the data section.
    3. Clearly distinguish between direct evidence extracted from the text and inferential analysis conclusions.
    
    Provide complete, structured outputs containing zero placeholder notes.`;
}

async function runWorkflow(workflowData) {
    const id = workflowData.workflowId;
    const ctx = stateManager.getContext(id) || stateManager.initialize(id, workflowData.workflowName, workflowData.steps);
    ctx.documentContext = workflowData.originalDocument || "";
    
    try {
        if (!ctx.documentContext || ctx.documentContext.length < 10) {
            throw new Error("DOCUMENT_NOT_FOUND: Volatile session memory trace cleared. Reload payload context.");
        }
        
        ctx.transition('RUNNING');
        let successfulNodes = new Set(), failedNodes = new Set(), inProgressNodes = new Set();
        
        ctx.nodes.forEach((n, i) => { 
            if (!n.dependencies) n.dependencies = [];
            if (i > 0 && n.dependencies.length === 0) n.dependencies.push(ctx.nodes[i - 1].id); 
        });
        
        while ((successfulNodes.size + failedNodes.size) < ctx.nodes.length) {
            if (ctx.status === 'CANCELLED') break;
            
            const skipNodes = ctx.nodes.filter(n => !successfulNodes.has(n.id) && !failedNodes.has(n.id) && !inProgressNodes.has(n.id) && (n.dependencies || []).some(dep => failedNodes.has(dep)));
            for (const node of skipNodes) {
                node.status = 'FAILED';
                node.error = { reason: "Upstream pipeline execution step failure cascade." };
                failedNodes.add(node.id);
            }

            const readyNodes = ctx.nodes.filter(n => !successfulNodes.has(n.id) && !failedNodes.has(n.id) && !inProgressNodes.has(n.id) && (n.dependencies || []).every(dep => successfulNodes.has(dep)));
            if (readyNodes.length === 0 && inProgressNodes.size === 0) break;
            
            await processWithLimit(readyNodes, 3, async (node) => {
                inProgressNodes.add(node.id);
                ctx.transition('EXECUTING_NODE');
                node.status = 'RUNNING';
                
                try {
                    const finalPrompt = buildContextualPrompt(node, ctx);
                    let routingQueue = await AdvisorService.rankModelsForTask(node.prompt, finalPrompt, node.taskType, node.taskName);
                    
                    // [CRITICAL FIX]: Pre-bind candidate routing parameters directly to active loop state before firing gateway calls
                    const matchedWinner = routingQueue[0];
                    node.provider = matchedWinner.model.provider || "Mesh API Gateway";
                    node.apiModel = matchedWinner.model.id || "Dynamic Matrix";
                    node.routingAudit = AdvisorService.generateRoutingAudit(routingQueue);
                    
                    ctx.addIntelligenceEvent("ADVISOR", `Routed task '${node.taskName}' optimally.`, node.id, node.provider, node.apiModel, 0, matchedWinner.reason);

                    const result = await meshRouter.routeRequest(id, node.id, finalPrompt, routingQueue);
                    
                    node.output = result.output;
                    node.latency = result.latency || 450;
                    node.cost = result.cost || 0.00015;
                    node.tokens = result.tokens || 850;
                    node.apiModel = result.actualModel;
                    node.provider = result.actualProvider;
                    node.status = 'COMPLETED';
                    
                    ctx.outputs[node.id] = result.output;
                    ctx.addMetric(node.latency, node.cost, result.promptTokens, result.completionTokens, node.tokens);
                    ctx.addIntelligenceEvent("SUCCESS", `Compute resolved for '${node.taskName}'`, node.id, node.provider, node.apiModel, node.latency);
                    
                    successfulNodes.add(node.id);
                } catch (nodeErr) {
                    node.status = 'FAILED'; 
                    node.error = { reason: nodeErr.message };
                    ctx.addIntelligenceEvent("FAIL", `Compute failed for '${node.taskName}': ${nodeErr.message}`, node.id);
                    failedNodes.add(node.id);
                } finally {
                    inProgressNodes.delete(node.id);
                    stateManager.updateNodeProgress(id, null, Math.round(((successfulNodes.size + failedNodes.size) / ctx.nodes.length) * 100));
                }
            });
        }

        ctx.transition('SYNTHESIZING'); 
        ctx.addIntelligenceEvent("INFO", `Pipeline complete. Booting Global Assembly Synthesis...`);
        
        const finishedOutputs = ctx.nodes.filter(n => n.status === 'COMPLETED').map(n => `### Layer Element: ${n.taskName}\n${ctx.outputs[n.id]}`).join('\n\n');
        
        const finalReportPrompt = `You are the Final System Arbitrator running inside the MeshFlow X Intelligent Framework.
        Evaluate the accumulated graph data layers below and construct a production-ready strategic briefing.
        
        STRUCTURED REPORT SECTIONS REQUIRED:
        1. ## Executive Summary: High-level tactical digest mapping out findings.
        2. ## Key Findings: Detailed breakout points.
        3. ## Critical Insights: Non-obvious strategic correlations discovered within the text metadata.
        4. ## Evidence Map & Citation Matrix: Granular table tracking specific findings back to direct text passages.
        5. ## Recommendations: Clear breakdown of target dimensions.
        
        Accumulated Data Stream:
        ${finishedOutputs}`;

        const synthQueue = await AdvisorService.rankModelsForTask("Synthesize strategic dashboard briefs", finalReportPrompt, "SYNTHESIS", "Global Matrix Assembly");
        
        ctx.addIntelligenceEvent("ADVISOR", `Synthesizing final report output...`, "synth", synthQueue[0].model.provider, synthQueue[0].model.id, 0, synthQueue[0].reason);

        const synthesisResponse = await meshRouter.routeRequest(id, "os-synthesis-terminal", finalReportPrompt, synthQueue);
        ctx.addMetric(synthesisResponse.latency || 1000, synthesisResponse.cost || 0.005, 0, 0, synthesisResponse.tokens || 1500);
        
        ctx.finalOutput = { 
            text: synthesisResponse.output || "Unified synthesis pipeline resolved.",
            finalNodeOutput: finishedOutputs,
            rawPipelineData: finishedOutputs
        };
        ctx.counterfactuals = AdvisorService.calculateCounterfactuals(ctx.nodes, ctx.metrics);
        ctx.status = 'COMPLETED';
        ctx.addIntelligenceEvent("COMPLETED", `OS Run Finalized Successfully.`);
        
    } catch (error) {
        ctx.status = 'FAILED';
        ctx.finalOutput = { text: `## Execution Environment Terminated\n\n**Fault Tracker:** \`${error.message}\`` };
        ctx.addIntelligenceEvent("FAIL", `Critical Pipeline Collapse: ${error.message}`);
    } finally {
        await historyManager.saveExecution(ctx);
        stateManager.cleanup(id);
    }
}

module.exports = { runWorkflow };