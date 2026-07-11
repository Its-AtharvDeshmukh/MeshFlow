const logger = require('./logger');

const errorHandler = (err, req, res, next) => {
    logger.error(`[API ERROR] ${req.method} ${req.originalUrl}`, { error: err.message, stack: err.stack });
    
    const statusCode = err.status || 500;
    const message = err.message || "Internal Server Error";
    
    res.status(statusCode).json({
        success: false,
        error: { code: statusCode, message, details: err.details || null }
    });
};

const requestLogger = (req, res, next) => {
    logger.info(`[API REQUEST] ${req.method} ${req.url}`);
    next();
};

module.exports = { errorHandler, requestLogger };