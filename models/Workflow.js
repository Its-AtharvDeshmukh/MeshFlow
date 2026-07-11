// models/Workflow.js
const mongoose = require('mongoose');

const WorkflowSchema = new mongoose.Schema({
  workflowName: { type: String, required: true },
  description: String,
  steps: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Workflow', WorkflowSchema);