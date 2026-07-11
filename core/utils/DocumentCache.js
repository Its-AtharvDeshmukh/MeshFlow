// core/utils/DocumentCache.js
// Temporary backend storage to prevent browser LocalStorage QuotaExceeded errors
const cache = new Map();

module.exports = {
    set: (id, text) => {
        cache.set(id, text);
        // TTL: Clear after 1 hour to prevent memory leaks
        setTimeout(() => cache.delete(id), 60 * 60 * 1000);
    },
    get: (id) => cache.get(id),
    has: (id) => cache.has(id),
    delete: (id) => cache.delete(id)
};