// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const connectDB = require('./config/database');
const webRouter = require('./routers/web');
const apiRouter = require('./routers/api');
const { verifyModels } = require('./core/providers/mesh');
const { errorHandler, requestLogger } = require('./core/utils/middleware');

// Wire up EventBus globally
const eventBus = require('./core/events/EventBus');
eventBus.on('workflow.started', (data) => console.log(`[OS LIFECYCLE] Pipeline Executing: ${data.workflowId}`));
eventBus.on('workflow.cancelled', (data) => console.log(`[OS LIFECYCLE] Pipeline Halted: ${data.workflowId}`));

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

// [FIX]: INCREASED LIMIT TO 500MB FOR UNLIMITED PROMPTS & MASSIVE RESEARCH PAPERS
app.use(express.json({ limit: '500mb' })); 
app.use(express.urlencoded({ limit: '500mb', extended: true, parameterLimit: 1000000 }));

app.use(requestLogger);
app.use('/', webRouter);
app.use('/api', apiRouter);
app.use(errorHandler);

let server;

const startServer = async () => {
    try {
        await verifyModels(); 
        await connectDB();
        server = app.listen(PORT, () => console.log(`🚀 MeshFlow X OS running on http://localhost:${PORT}`));
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
};

const shutdown = () => {
    console.log("\n[SYSTEM] Graceful shutdown initiated...");
    if (server) {
        server.close(async () => {
            console.log("[SYSTEM] HTTP Server closed.");
            await mongoose.connection.close();
            console.log("[SYSTEM] Database connection closed.");
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10000);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer();