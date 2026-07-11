const log = (level, action, details = {}) => {
    const entry = {
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        action,
        ...details
    };
    console.log(JSON.stringify(entry));
};

module.exports = {
    info: (action, details) => log('info', action, details),
    error: (action, details) => log('error', action, details),
    warn: (action, details) => log('warn', action, details)
};