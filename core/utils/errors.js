// core/utils/errors.js
class SystemError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
}

class ProviderError extends SystemError {
    constructor(message, details) { super('PROVIDER_ERROR', message, details); }
}

class WorkflowExecutionError extends SystemError {
    constructor(code, message, details = {}) { 
        super(code, message, details); 
    }
}

module.exports = { SystemError, ProviderError, WorkflowExecutionError };