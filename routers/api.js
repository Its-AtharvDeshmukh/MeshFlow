// routers/api.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const generator = require('../core/generator');
const executor = require('../core/executor');
const stateManager = require('../core/state-manager');
const historyManager = require('../core/history-manager');
const AdvisorService = require('../core/services/AdvisorService');
const MetricsService = require('../core/services/MetricsService');
const Execution = require('../models/Execution');

// [CRITICAL FIX]: Persistent server-side vault to prevent browser QuotaExceededError crashes
const CACHE_DIR = path.resolve(process.cwd(), 'uploads', 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const throw400 = (msg) => { const e = new Error(msg); e.status = 400; throw e; };

router.get('/health', (req, res) => res.json({ success: true, status: "operational" }));

router.post('/validate-document', upload.single('file'), async (req, res) => {
    const startTime = Date.now();
    try {
        console.log(`\n==================================================`);
        console.log(`[PIPELINE TRACE: STAGE 1 - UPLOAD & VALIDATION]`);
        console.log(`File Received: ${req.file ? req.file.originalname : 'None'}`);
        console.log(`MIME Type:     ${req.file ? req.file.mimetype : 'None'}`);
        console.log(`Size:          ${req.file ? req.file.size + ' bytes' : '0'}`);
        
        if (!req.file) return res.status(400).json({ success: false, message: "Please upload a document." });
        
        const { path: tempPath, mimetype, originalname, size } = req.file;
        let rawText = "";

        try {
            rawText = await generator.extractTextFromFile(tempPath, mimetype, originalname);
        } catch (extractErr) {
            console.error("[EXTRACTION FAULT]", extractErr);
            return res.status(400).json({ success: false, message: extractErr.message });
        }
        
        // Ensure strictly typed string to prevent [object Object] leaks downstream
        if (!rawText || typeof rawText !== 'string' || rawText.trim() === "") {
            console.log(`[PIPELINE TRACE] FATAL: Extracted text is empty or invalid.`);
            return res.status(400).json({ success: false, message: "File contains no readable text." });
        }
        if (rawText.trim().length < 10) {
            console.log(`[PIPELINE TRACE] FATAL: Text length (${rawText.length}) < 10 chars.`);
            return res.status(400).json({ success: false, message: `Document text too short. Extracted only ${rawText.length} characters.` });
        }
        
        const docId = uuidv4();
        const cachePath = path.join(CACHE_DIR, `${docId}.txt`);
        fs.writeFileSync(cachePath, rawText, 'utf8');
        
        console.log(`Extracted:     ${rawText.length} characters`);
        console.log(`Status:        Secured to Server Memory Cache [${docId}]`);
        console.log(`Exec Time:     ${Date.now() - startTime}ms`);
        console.log(`==================================================\n`);

        res.json({
            success: true, documentId: docId, fileName: originalname,
            fileSize: (size / (1024 * 1024)).toFixed(2) + " MB",
            metadata: {
                name: originalname,
                pages: Math.max(1, Math.ceil(rawText.length / 3000)),
                words: rawText.split(/\s+/).length, chars: rawText.length,
                language: "English",
                fileType: mimetype.split('/')[1]?.toUpperCase() || "UNKNOWN",
                ocr: rawText.length > 5000 ? "Direct Parse Layer" : "Vision Matrix Layer"
            },
            readyForWorkflow: true
        });
    } catch (err) {
        console.error("[SYSTEM ERROR]", err);
        res.status(500).json({ success: false, message: `System Error: ${err.message}` });
    } finally {
        if (req.file && req.file.path) fs.promises.unlink(req.file.path).catch(() => {});
    }
});

router.post('/generate-workflow', upload.single('file'), async (req, res) => {
    try {
        const { prompt, documentId } = req.body;
        if (!req.file && !documentId) return res.status(400).json({ success: false, error: "Please upload a document." });
        
        let cachedText = "";
        const cachePath = path.join(CACHE_DIR, `${documentId}.txt`);
        if (documentId && fs.existsSync(cachePath)) {
            cachedText = fs.readFileSync(cachePath, 'utf8');
        }
        
        const workflow = await generator.generateIntelligentWorkflow(prompt, req.file, cachedText);
        
        // [CRITICAL FIX]: Shift cache pointer to workflowId, and DELETE the heavy text from the frontend payload
        if (workflow.workflowId) {
            const workflowCachePath = path.join(CACHE_DIR, `${workflow.workflowId}.txt`);
            fs.writeFileSync(workflowCachePath, cachedText || workflow.originalDocument || "", 'utf8');
            workflow.originalDocument = undefined; // Protect UI LocalStorage
        }
        
        res.json({ success: true, workflow });
    } catch (error) {
        console.error("[API ERROR] Generation Failed:", error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        if (req.file && req.file.path) fs.promises.unlink(req.file.path).catch(() => {}); 
    }
});

router.post('/run', async (req, res, next) => {
    try {
        const payload = req.body || {};
        const workflowId = payload.workflowId || uuidv4();
        
        // [CRITICAL FIX]: Re-inject the massive payload exclusively on the backend prior to execution.
        const cachePath = path.join(CACHE_DIR, `${workflowId}.txt`);
        let originalDocument = "";
        if (fs.existsSync(cachePath)) originalDocument = fs.readFileSync(cachePath, 'utf8');
        
        if (!payload.steps || payload.steps.length === 0) throw400("Invalid workflow format.");
        if (!originalDocument) throw400("DOCUMENT_NOT_FOUND: Execution context missing from disk. Upload required.");
        
        // Boot state manager immediately so Mission Control connects to live telemetry instantly
        const ctx = stateManager.getContext(workflowId) || stateManager.initialize(workflowId, payload.workflowName || "Automated Workflow", payload.steps);
        ctx.addIntelligenceEvent("INFO", "Payload transferred securely. Booting MeshOS execution engine...");

        executor.runWorkflow({ 
            workflowId, 
            workflowName: payload.workflowName || "Automated Workflow", 
            steps: payload.steps, 
            edges: payload.edges || [], 
            originalDocument 
        }).catch(e => console.error(e));
        
        res.status(200).json({ success: true, status: "running", executionId: workflowId });
    } catch (err) { next(err); }
});

router.post('/advise', async (req, res, next) => {
    try {
        const payload = req.body || {};
        const nodes = Array.isArray(payload) ? payload : (payload.nodes || payload.steps);
        if (!nodes || !Array.isArray(nodes)) return res.status(400).json({ success: false, error: "Valid nodes array required." });
        res.json({ success: true, advisorStats: await AdvisorService.analyzeWorkflow(nodes) });
    } catch (err) { next(err); }
});

router.post('/optimize', async (req, res, next) => {
    try {
        const payload = req.body || {};
        const nodes = Array.isArray(payload) ? payload : (payload.nodes || payload.steps);
        if (!nodes || !Array.isArray(nodes)) return res.status(400).json({ success: false, error: "Valid nodes array required." });
        res.json({ success: true, optimization: await AdvisorService.optimizeWorkflow(nodes) });
    } catch (err) { next(err); }
});

router.get('/workflow-state/:id', async (req, res) => {
    try {
        let state = stateManager.getContext(req.params.id); 
        if (!state) {
            const pastExecution = await Execution.findOne({ executionId: req.params.id }); 
            if (pastExecution) return res.json({ ...pastExecution.toObject(), isHistorical: true });
            return res.status(404).json({ error: 'Execution not found or expired' });
        }
        res.json(state.toFrontendData ? state.toFrontendData() : state);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/cancel', (req, res, next) => {
    try {
        if (!stateManager.cancelExecution(req.body.executionId)) throw400("Cannot cancel execution.");
        res.json({ success: true, message: "Execution cancelled successfully." });
    } catch (err) { next(err); }
});

router.get('/history', async (req, res) => res.json(await historyManager.getAllExecutions()));
router.get('/metrics', async (req, res) => res.json({ success: true, metrics: await MetricsService.getGlobalMetrics() }));

module.exports = router;