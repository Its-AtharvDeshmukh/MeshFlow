// core/providers/index.js
const { executeMeshRequest, meshClient, verifyModels } = require('./mesh');

// [CRITICAL FIX]: Ensure adapters requesting executeAI receive the unified handler
module.exports = { 
    executeAI: executeMeshRequest, 
    executeMeshRequest,
    meshClient,
    verifyModels
};