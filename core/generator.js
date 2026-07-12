// core/generator.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const AdvisorService = require('./services/AdvisorService');
const meshRouter = require('./providers/MeshRouterService');

// [CRITICAL FIX]: Absolutely ensures no object escapes as "[object Object]" into the pipeline
function cleanExtractedText(text) {
    if (!text) return "";
    let str = typeof text === 'object' ? JSON.stringify(text, null, 2) : String(text);
    // Purge null bytes and non-printable characters that can silently break JSON compilation
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    // Destroy legacy OCR hallucination markers
    if (str.includes("[SYSTEM EVENT:")) return ""; 
    return str;
}

// Resilient fallback for scanned documents or image-based PDFs
async function runOCRFallback(fileBuffer) {
    try {
        console.log("[PIPELINE TRACE] Native parse insufficient. Utilizing Cloud Vision OCR...");
        const formData = new URLSearchParams();
        formData.append('base64Image', `data:application/pdf;base64,${fileBuffer.toString('base64')}`);
        formData.append('apikey', 'helloworld'); 
        formData.append('OCREngine', '2');
        
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (data && data.ParsedResults && data.ParsedResults.length > 0) {
            console.log("[PIPELINE TRACE] Cloud Vision OCR extraction successful.");
            return data.ParsedResults.map(p => p.ParsedText).join('\n');
        }
    } catch (e) { 
        console.error("[OCR ERROR] Fallback engine failed:", e.message); 
    }
    return null;
}

// [CRITICAL FIX]: Safely handles pdf-parse@2.4.5 ES6 class export issues without crashing the Node process
async function extractPDFTextSafe(fileBuffer) {
    try {
        let pdfParseObj;
        try { 
            pdfParseObj = require('pdf-parse'); 
        } catch (err) { 
            pdfParseObj = await import('pdf-parse'); 
        }

        let result = null;
        // Test multiple instantiation pathways depending on the environment resolution
        if (typeof pdfParseObj === 'function') {
            result = await pdfParseObj(fileBuffer);
        } else if (pdfParseObj && typeof pdfParseObj.default === 'function') {
            result = await pdfParseObj.default(fileBuffer);
        } else if (pdfParseObj && pdfParseObj.PDFParse) {
            const instance = new pdfParseObj.PDFParse({ data: fileBuffer });
            result = await instance.getText();
        }

        if (result) {
            if (typeof result.text === 'string') return result.text;
            if (typeof result === 'string') return result;
        }
        return null;
    } catch (err) { 
        console.warn(`[PDF PARSE WARNING] Native engine failed (${err.message}). Safely delegating to OCR...`);
        return null; 
    }
}

async function extractTextFromFile(filePath, mimeType, originalName) {
    let rawDocumentText = "";
    const lowerName = originalName.toLowerCase();

    try {
        if (mimeType === 'application/zip' || lowerName.endsWith('.zip')) {
            const zip = new AdmZip(filePath);
            zip.getEntries().forEach(entry => {
                if (!entry.isDirectory && !entry.entryName.includes('node_modules/') && !entry.entryName.includes('.DS_Store')) {
                    rawDocumentText += `\n\n--- FILE: ${entry.entryName} ---\n${entry.getData().toString('utf8')}`;
                }
            });
            return cleanExtractedText(rawDocumentText);
        }

        if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
            const fileBuffer = fs.readFileSync(filePath);
            rawDocumentText = await extractPDFTextSafe(fileBuffer);
            
            if (rawDocumentText) {
                rawDocumentText = cleanExtractedText(rawDocumentText);
            }

            // Fallback to OCR if the native parser failed or returned very little text
            if (!rawDocumentText || rawDocumentText.length < 5000) {
                const ocrText = await runOCRFallback(fileBuffer);
                if (ocrText && ocrText.trim().length > 50) {
                    return cleanExtractedText(ocrText);
                }
            }

            if (!rawDocumentText || rawDocumentText.trim().length === 0) {
                throw new Error("Document may be an unscannable image, encrypted, or severely corrupted.");
            }
            return rawDocumentText;
        } 
        
        if (lowerName.endsWith('.docx')) {
            const mammoth = require('mammoth');
            const data = await mammoth.extractRawText({ path: filePath });
            return cleanExtractedText(data.value);
        } 
        
        // Standard text fallback
        rawDocumentText = fs.readFileSync(filePath, 'utf8');
        return cleanExtractedText(rawDocumentText);

    } catch (error) {
        throw new Error(`Extraction failed for ${originalName}: ${error.message}`);
    }
}

function validateAndEnrichWorkflow(data) {
    data.workflowId = data.workflowId || uuidv4();
    data.steps = data.steps.map((step, index) => ({
        ...step,
        id: step.id || `step_${index + 1}`,
        provider: "Mesh API OS", 
        model: "Auto-Routed", 
        status: "pending",
        routing: { provider: "Mesh API", model: "Pending", confidence: 0 },
        execution: { parallel: false, dependsOn: [] }
    }));
    return data;
}

async function generateIntelligentWorkflow(prompt, file = null, cachedText = "") {
    const docTextStr = cleanExtractedText(cachedText);
    if (docTextStr.length < 10) {
        throw new Error("Document context is too short to generate a valid workflow graph.");
    }

    const safePrompt = prompt ? String(prompt).trim() : "Extract exact requirements and build a comprehensive processing workflow.";
    
    // Dynamic node scale sizing based on document payload length
    let nodeCountRequirement = docTextStr.length > 25000 ? "8 to 12" : "4 to 7";

    // [PRODUCTION FIX]: Added specific enforcement for SRP, Symbol Preservation, and JSON boundary logic.
    const systemPrompt = `You are the Principal Systems Architect inside the MeshFlow X AI Operating System.
    Compile a Directed Acyclic Graph (DAG) workflow payload matching the ACTUAL domain structure of the user document.
    
    CRITICAL MULTI-MODEL ROUTING RULES:
    1. STRICT SINGLE RESPONSIBILITY: Every node MUST have a strictly categorized "taskType" from this list ONLY:
       - "DATA_EXTRACTION" (For parsing dates, entities, JSON, tables)
       - "THEORY_MAPPING" (For identifying concepts, structures, and semantic outlines)
       - "CRITICAL_ANALYSIS" (For heavy logic, deduction, and mathematical auditing)
       - "RESEARCH_INSIGHTS" (For generating broader external connections)
       - "SYNTHESIS" (For executive summaries, compilations, and report generation)
    2. PRESERVE SYMBOLS: Explicitly instruct extraction nodes to PRESERVE ALL OCR ARTIFACTS AND CURRENCY SYMBOLS exactly as written. 
    3. NEVER generate generic "OCR" or "Ingestion" nodes. Assume ingestion is complete.
    4. You MUST generate ${nodeCountRequirement} distinct, highly analytical nodes. 
    5. Each node's prompt MUST be completely unique and specifically tackle one distinct section or concept of the document.
    
    SCHEMA: { "workflowName": "string", "steps": [ { "id": "step_1", "taskName": "Specific domain task", "taskType": "DATA_EXTRACTION", "prompt": "Detailed AI instruction specifically addressing the document's domain data." } ], "edges": [{"source":"step_1", "target":"step_2"}] }
    Return ONLY valid JSON without any conversational filler or Markdown codeblock wrappers.`;

    const fullPrompt = systemPrompt + "\n\nUser Request: " + safePrompt + `\n\n[Document Preview]:\n${docTextStr.substring(0, 15000)}`;
    
    console.log(`\n==================================================`);
    console.log(`[PIPELINE TRACE: STAGE 2 - DAG ARCHITECT]`);
    console.log(`Target Graph Space: ${nodeCountRequirement} Nodes`);
    console.log(`==================================================\n`);

    const routingQueue = await AdvisorService.rankModelsForTask(safePrompt, fullPrompt, "Workflow Generation", "DAG Builder");
    const result = await meshRouter.routeRequest("os-system-boot", "os-generator-node", fullPrompt, routingQueue);
    
    if (!result || !result.output) {
        throw new Error("Mesh API Gateway returned empty payload during structural generation.");
    }

    let parsedData;
    try {
        let cleanJson = result.output;
        
        // [PRODUCTION FIX]: Object Boundary Extractor.
        // Mathematically isolate the JSON payload to prevent conversational filler from crashing JSON.parse.
        const firstBrace = cleanJson.indexOf('{');
        const lastBrace = cleanJson.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1) {
            cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
        } else {
            throw new Error("No JSON boundaries detected in response payload.");
        }

        parsedData = JSON.parse(cleanJson);
    } catch (e) { 
        console.error("[JSON PARSE FAULT] Raw LLM Output:", result.output);
        throw new Error(`Failed to parse OS Generator output as valid structural JSON. Reason: ${e.message}`); 
    }

    return validateAndEnrichWorkflow(parsedData);
}

module.exports = { generateIntelligentWorkflow, validateAndEnrichWorkflow, extractTextFromFile };