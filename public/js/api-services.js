const MeshFlowAPI = {
    async request(endpoint, options = {}) {
        try {
            const response = await fetch(endpoint, options);
            const contentType = response.headers.get("content-type");
            let data = null;
            if (contentType && contentType.indexOf("application/json") !== -1) {
                data = await response.json();
            } else {
                throw new Error(`OS Gateway Error: Unexpected format. Status: ${response.status}`);
            }
            if (!response.ok) throw new Error(data?.error || data?.message || `API Error: ${response.status}`);
            return data;
        } catch (error) {
            console.error(`[MeshFlowAPI Error] -> ${endpoint}:`, error);
            throw error; 
        }
    },
    async generateWorkflow(prompt, file = null) {
        const formData = new FormData();
        if (prompt) formData.append('prompt', prompt);
        // [FIX]: Align fieldname to match backend Multer expectation ('file')
        if (file) formData.append('file', file);
        return this.request('/api/generate-workflow', { method: 'POST', body: formData });
    },
    async run(payload) {
        return this.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    },
    async getState(executionId) {
        return this.request(`/api/workflow-state/${executionId}`);
    },
    async getHistory() {
        return this.request('/api/history');
    },
    async deleteHistory(executionId) {
        return this.request(`/api/history/${executionId}`, { method: 'DELETE' });
    },
    async replay(executionId) {
        // [FIX]: Backend expects POST to /api/replay with executionId in body
        return this.request(`/api/replay`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ executionId }) 
        });
    },
    async getMetrics() {
        return this.request('/api/metrics');
    },
    async advise(payload) {
        return this.request('/api/advise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    },
    async optimize(payload) {
        return this.request('/api/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
};
window.MeshFlowAPI = MeshFlowAPI;