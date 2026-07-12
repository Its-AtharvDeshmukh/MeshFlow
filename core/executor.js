// core/executor.js
const stateManager = require('./state-manager');
const meshRouter = require('./providers/MeshRouterService');
const historyManager = require('./history-manager');
const AdvisorService = require('./services/AdvisorService');

/**
 * Robust concurrency controller to manage API rate limits and execution flow.
 * Maintains the exact execution integrity required by the DAG structure.
 */
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

/**
 * Deterministic Financial Math Pre-Validation
 */
function evaluateDeterministicMath(textContext) {
    if (!textContext) return "";
    let validationLogs = [];
    
    const mathRegex = /(\d+(?:\.\d+)?)\s*(?:\*|x)\s*\$?(\d+(?:\.\d+)?)\s*=\s*\$?(\d+(?:\.\d+)?)/gi;
    let match;
    while ((match = mathRegex.exec(textContext)) !== null) {
        const qty = parseFloat(match[1]);
        const price = parseFloat(match[2]);
        const statedTotal = parseFloat(match[3]);
        const actualTotal = qty * price;
        
        if (Math.abs(actualTotal - statedTotal) > 0.05) {
            validationLogs.push(`[JS MATH AUDIT FAILED]: Document states ${qty} * ${price} = ${statedTotal}. Correct mathematical total is ${actualTotal}. YOU MUST flag this discrepancy.`);
        } else {
            validationLogs.push(`[JS MATH AUDIT PASSED]: Verified ${qty} * ${price} = ${actualTotal}.`);
        }
    }
    return validationLogs.length > 0 ? `\n[SYSTEM DETERMINISTIC MATH VALIDATION]:\n${validationLogs.join('\n')}\n` : "";
}

function buildContextualPrompt(node, ctx) {
    const dependencies = node.dependencies || [];
    let cumulativeHistoryStr = "";

    if (dependencies.length > 0) {
        cumulativeHistoryStr = dependencies.map(depId => {
            const parentNode = ctx.nodes.find(n => n.id === depId);
            const rawOutput = ctx.outputs[depId] || "Pending context.";
            const cleanOutput = rawOutput.length > 12000 ? (rawOutput.substring(0, 12000) + "... [Truncated by OS]") : rawOutput;
            return `[Upstream Output - ${parentNode?.taskName || depId}]:\n${cleanOutput}`;
        }).join('\n\n');
    }

    let safeContext = "";
    if (typeof ctx.documentContext === 'object') {
        try { safeContext = JSON.stringify(ctx.documentContext); } catch(e) { safeContext = String(ctx.documentContext); }
    } else {
        safeContext = String(ctx.documentContext || "");
    }

    let mathValidationBlock = "";
    if (node.taskType === 'CRITICAL_ANALYSIS' || node.taskType === 'DATA_EXTRACTION') {
        mathValidationBlock = evaluateDeterministicMath(safeContext);
    }

    return `[SYSTEM PROMPT]
    You are a specialized compute worker operating within the MeshFlow X AI Operating System.
    
    [TASK DIRECTIVE]
    Task Operational Function: ${node.taskName || node.name}
    Task Type Category: ${node.taskType}
    Execution Instructions: ${node.prompt}
    
    [UPSTREAM DATA MEMORY]
    ${cumulativeHistoryStr || "No upstream dependencies linked to this thread."}
    
    [SOURCE GROUNDING DOCUMENT LAYER]
    ${safeContext || "Null data segment descriptor."}
    ${mathValidationBlock}
    
    STRICT PRODUCTION GROUNDING RULES:
    1. SINGLE RESPONSIBILITY PRINCIPLE: Perform ONLY your assigned Task Directive.
    2. PRESERVE SYMBOLS: Do NOT hallucinate currency or mathematical symbols. Keep OCR artifacts exactly as written.
    3. CITE EVIDENCE: Every major insight MUST explicitly provide an inline source citation tracker (e.g., "[Evidence: Page X]").
    4. Do NOT output raw JSON unless your specific task directive requires it.`;
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
                node.status = 'FAILED'; node.error = { reason: "Upstream failure cascade." }; failedNodes.add(node.id);
                ctx.addIntelligenceEvent("FAIL", `Node ${node.taskName} aborted due to cascade.`, node.id);
            }

            const readyNodes = ctx.nodes.filter(n => !successfulNodes.has(n.id) && !failedNodes.has(n.id) && !inProgressNodes.has(n.id) && (n.dependencies || []).every(dep => successfulNodes.has(dep)));
            if (readyNodes.length === 0 && inProgressNodes.size === 0) break;
            
            await processWithLimit(readyNodes, 3, async (node) => {
                inProgressNodes.add(node.id);
                node.status = 'RUNNING';
                
                try {
                    const finalPrompt = buildContextualPrompt(node, ctx);
                    let routingQueue = await AdvisorService.rankModelsForTask(node.prompt, finalPrompt, node.taskType, node.taskName);
                    
                    const matchedWinner = routingQueue[0];
                    node.provider = matchedWinner.model.provider || "Mesh API";
                    node.apiModel = matchedWinner.model.id;
                    node.routingAudit = AdvisorService.generateRoutingAudit(routingQueue);
                    
                    let result;
                    let retries = 0;
                    const maxRetries = 2;
                    
                    while (retries <= maxRetries) {
                        result = await meshRouter.routeRequest(id, node.id, finalPrompt, routingQueue);
                        if (result.success || retries === maxRetries) break;
                        retries++;
                    }
                    
                    if (!result.success) throw new Error(result.error || "Model execution failed.");

                    node.output = result.output;
                    
                    // [PRODUCTION FIX]: Strict numeric sanitization for latency string results
                    node.latency = parseInt(String(result.latency).replace(/\D/g, '')) || 0;
                    
                    // [PRODUCTION FIX]: Dynamic Token-Based Cost Calculation (Variables corrected)
                    const promptTokens = Number(result.promptTokens) || 0;
                    const completionTokens = Number(result.completionTokens) || 0;
                    
                    // Sourcing pricing directly from the matchedWinner model definition
                    const inputCost = Number(matchedWinner.model.inputCost) || 0;
                    const outputCost = Number(matchedWinner.model.outputCost) || 0;
                    
                    // Dynamic math calculation
                    node.cost = Number(result.cost) > 0 ? Number(result.cost) : ((promptTokens * (inputCost / 1000000)) + (completionTokens * (outputCost / 1000000)));
                    node.tokens = Number(result.tokens) || (promptTokens + completionTokens);
                    
                    node.status = 'COMPLETED';
                    
                    ctx.outputs[node.id] = result.output;
                    ctx.addMetric(node.latency, node.cost, promptTokens, completionTokens, node.tokens);
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
        ctx.addIntelligenceEvent("INFO", `Pipeline processing complete. Booting Global Assembly Synthesis...`);
        
        const finishedOutputs = ctx.nodes.filter(n => n.status === 'COMPLETED').map(n => `### Layer: ${n.taskName}\n${ctx.outputs[n.id]}`).join('\n\n');
        
        let reportScaleInstruction = "a well-structured executive summary (approximately 500-800 words).";
        const docLength = ctx.documentContext.length;
        if (docLength < 1500) reportScaleInstruction = "a highly concise, half-page summary (max 250 words).";
        else if (docLength > 20000) reportScaleInstruction = "a highly detailed, comprehensive multi-page executive report covering all extracted data vectors.";

        const finalReportPrompt = `You are the Lead Executive Arbitrator for the MeshFlow X Intelligent Framework.
        Your sole directive is to transform the raw technical outputs below into ${reportScaleInstruction}
        
        CRITICAL RULES:
        1. NO RAW JSON: You must write a polished, human-readable report in Markdown format.
        2. CONSISTENCY CHECK: Verify all numerical and factual claims across the upstream data.
        
        [RAW NODE OUTPUTS TO SYNTHESIZE]:
        ${finishedOutputs}
        
        Generate the Markdown report now.`;

        const synthQueue = await AdvisorService.rankModelsForTask("Synthesize executive report", finalReportPrompt, "SYNTHESIS", "Global Assembly");
        
        const synthesisResponse = await meshRouter.routeRequest(id, "os-synthesis-terminal", finalReportPrompt, synthQueue);
        
        // [FIX]: Aggregate synthesis metrics correctly with explicit parsing
        ctx.addMetric(parseInt(synthesisResponse.latency) || 0, Number(synthesisResponse.cost) || 0, 0, 0, Number(synthesisResponse.tokens) || 0);
        
        ctx.finalOutput = { 
            text: synthesisResponse.output || "Unified synthesis pipeline resolved.",
            finalNodeOutput: finishedOutputs,
            rawPipelineData: finishedOutputs
        };
        
        ctx.counterfactuals = AdvisorService.calculateCounterfactuals(ctx.nodes, ctx.metrics);
        ctx.metrics.successRate = (ctx.nodes.length > 0) ? Math.round((successfulNodes.size / ctx.nodes.length) * 100) : 0;
        
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