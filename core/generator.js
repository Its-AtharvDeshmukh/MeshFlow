// core/generator.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mammoth = require('mammoth');
const AdmZip = require('adm-zip');
const AdvisorService = require('./services/AdvisorService');
const meshRouter = require('./providers/MeshRouterService');

function cleanExtractedText(text) {
    if (!text || typeof text !== 'string') {
        if (typeof text === 'object') return JSON.stringify(text).substring(0, 500);
        return "";
    }
    let cleanText = String(text).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    // [CRITICAL GUARD]: Prevent the LLM from hallucinating OCR instructions
    if (cleanText.includes("[SYSTEM EVENT:")) return ""; 
    return cleanText;
}

async function runOCRFallback(fileBuffer) {
    try {
        console.log("[PIPELINE TRACE] Routing bytes to Cloud OCR Engine...");
        const formData = new URLSearchParams();
        formData.append('base64Image', `data:application/pdf;base64,${fileBuffer.toString('base64')}`);
        formData.append('apikey', 'helloworld'); // Free public tier
        formData.append('OCREngine', '2');
        
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (data && data.ParsedResults && data.ParsedResults.length > 0) {
            console.log("[PIPELINE TRACE] OCR extraction successful.");
            return data.ParsedResults.map(p => p.ParsedText).join('\n');
        }
    } catch (e) {
        console.error("[OCR ERROR]", e.message);
    }
    return null;
}

// [CRITICAL FIX]: An indestructible wrapper that catches pdf-parse ES6 Class crashes
async function extractPDFTextSafe(fileBuffer) {
    try {
        let pdfParseObj;
        try { pdfParseObj = require('pdf-parse'); } catch (err) { pdfParseObj = await import('pdf-parse'); }

        let result = null;
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
        throw new Error("No recognizable pdf-parse execution path found.");
    } catch (err) {
        console.warn(`[PDF NATIVE PARSE WARNING] Native engine failed (${err.message}). Safely delegating to OCR...`);
        return null; // Returning null securely triggers the OCR failover
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
            
            // 1. Attempt Native PDF parsing safely
            rawDocumentText = await extractPDFTextSafe(fileBuffer);
            
            if (rawDocumentText) {
                rawDocumentText = cleanExtractedText(rawDocumentText);
            }

            // 2. If native parsing failed (null) OR returned an image string (< 10000 chars), trigger OCR
            if (!rawDocumentText || rawDocumentText.length < 10000) {
                const ocrText = await runOCRFallback(fileBuffer);
                if (ocrText && ocrText.trim().length > 50) {
                    return cleanExtractedText(ocrText);
                }
            }

            if (!rawDocumentText || rawDocumentText.trim().length === 0) {
                throw new Error("Both Native Parser and OCR Fallback failed to extract text. The document may be empty, encrypted, or severely corrupted.");
            }

            return rawDocumentText;
        } 
        
        if (lowerName.endsWith('.docx')) {
            const mammoth = require('mammoth');
            const data = await mammoth.extractRawText({ path: filePath });
            return cleanExtractedText(data.value);
        } 
        
        rawDocumentText = fs.readFileSync(filePath, 'utf8');
        return cleanExtractedText(rawDocumentText);

    } catch (error) {
        console.error(`[EXTRACTION FAULT] Failed to process ${originalName}:`, error);
        throw new Error(`Extraction failed: ${error.message}`);
    }
}

function validateAndEnrichWorkflow(data) {
    data.workflowId = data.workflowId || uuidv4();
    data.steps = data.steps.map((step, index) => ({
        ...step,
        id: step.id || `step_${index + 1}`,
        provider: "Mesh API OS", model: "Auto-Routed",
        status: "pending",
        routing: { provider: "Mesh API", model: "Pending", confidence: 0 },
        execution: { parallel: false, dependsOn: [] }
    }));
    return data;
}

async function generateIntelligentWorkflow(prompt, file = null, cachedText = "") {
    let rawDocumentText = cachedText;

    if (!rawDocumentText && file && file.path) {
        rawDocumentText = await extractTextFromFile(file.path, file.mimetype, file.originalname);
    }
    const docTextStr = cleanExtractedText(rawDocumentText);

    if (docTextStr.length === 0) throw new Error("EMPTY_DOCUMENT: Extracted payload evaluates to zero readable characters.");
    if (docTextStr.length < 10) throw new Error("INCOMPLETE_DOCUMENT: Document is too short to generate a valid workflow graph.");

    const safePrompt = prompt ? String(prompt).trim() : "Extract exact requirements and build optimal processing workflow.";
    const fileContext = `\n\n[Document Content]:\n${docTextStr}`;
    
    // [DYNAMIC SCALE ALGORITHM]: Forces LLM to map extensive pipelines for massive documents
    let nodeCountRequirement = "3 to 5";
    if (docTextStr.length > 30000) nodeCountRequirement = "8 to 12";
    else if (docTextStr.length > 10000) nodeCountRequirement = "5 to 8";

    // [CRITICAL FIX]: Forcing the planner to distinctively categorize taskTypes to feed the Advisor Router
    const systemPrompt = `You are the Chief AI Systems Architect inside the MeshFlow X AI Operating System.
    Compile a Directed Acyclic Graph (DAG) workflow payload matching the ACTUAL domain structure of the user document.
    
    CRITICAL MULTI-MODEL ROUTING RULES:
    1. Every node MUST have a strictly categorized "taskType" from this list ONLY:
       - "DATA_EXTRACTION" (For parsing dates, entities, JSON, simple formatting)
       - "THEORY_MAPPING" (For identifying concepts and structures)
       - "CRITICAL_ANALYSIS" (For heavy logic, deduction, and mathematical auditing)
       - "SYNTHESIS" (For executive summaries and report generation)
       - "VISION_OCR" (For analyzing structural layout or images)
    2. NEVER generate generic "file processing" nodes like "OCR" or "PDF Ingestion". Assume ingestion is complete.
    3. You MUST generate ${nodeCountRequirement} distinct, highly analytical nodes. 
    4. Each node's prompt MUST be completely unique and specifically tackle one piece of the document.
    
    SCHEMA: { "workflowName": "string", "steps": [ { "id": "step_1", "taskName": "Specific domain task", "taskType": "DATA_EXTRACTION", "prompt": "Detailed AI instruction specifically addressing the document's domain data." } ], "edges": [{"source":"step_1", "target":"step_2"}] }
    Return ONLY valid JSON.`;

    const fullPrompt = systemPrompt + "\n\nUser Request: " + safePrompt + fileContext;
    const routingQueue = await AdvisorService.rankModelsForTask(safePrompt, fullPrompt, "Workflow Generation", "DAG Builder");

    console.log(`\n==================================================`);
    console.log(`[PIPELINE TRACE: STAGE 2 - PROMPT BUILDER]`);
    console.log(`Target Graph Space: ${nodeCountRequirement} Nodes`);
    console.log(`Total Payload Size: ${fullPrompt.length} chars`);
    console.log(`==================================================\n`);

    const result = await meshRouter.routeRequest("os-system-boot", "os-generator-node", fullPrompt, routingQueue);
    
    let parsedData;
    try {
        const cleanJson = result.output.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedData = JSON.parse(cleanJson);
    } catch (e) { throw new Error("Failed to parse Generator output as JSON."); }

    if (parsedData.steps && parsedData.steps.length > 0) {
        parsedData.steps[0].prompt += `\n\n--- Source Document ---\n${fileContext.replace('\n\n[Document Content]:\n', '')}`;
    }

    return { ...validateAndEnrichWorkflow(parsedData), originalDocument: docTextStr };
}

module.exports = { generateIntelligentWorkflow, validateAndEnrichWorkflow, extractTextFromFile };