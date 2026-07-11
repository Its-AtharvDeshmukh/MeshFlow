window.escapeHTML = function(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
};

// [PRODUCTION FIX]: Fault-tolerant Markdown Regex Extractor (Extracts final report UI sections)
window.extractMarkdownSection = function(markdown, sectionTitle) {
    if (!markdown) return "No data available.";
    
    const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\n)(?:#{1,4}\\s*|\\*\\*\\s*)?${escapedTitle}(?:\\s*\\*\\*)?[\\s\\S]*?(?=\\n(?:#{1,4}\\s*|\\*\\*\\s*)[A-Z]|$)`, 'i');
    
    const match = markdown.match(regex);
    if (match) {
        let content = match[0].replace(new RegExp(`(?:^|\\n)(?:#{1,4}\\s*|\\*\\*\\s*)?${escapedTitle}(?:\\s*\\*\\*)?`, 'i'), '').trim();
        return content || "No content generated for this section.";
    }
    return "Section omitted by AI Synthesizer.";
}

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    // NOTE: Home form submission is managed exclusively by the inline script in home.ejs for visual mesh synchronization.
    // NOTE: Builder initialization is managed natively by builder-engine.js
    
    if (path.includes('/history')) initHistory();
});

function initHome() {
    const form = document.getElementById('master-generate-form');
    if (!form) return; // Silent return if not on the exact homepage form
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn ? btn.innerHTML : 'Generate AI Workflow';
        
        if (btn) btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline-block align-middle mr-2"></i> Processing...';
        
        try {
            const res = await fetch('/api/generate-workflow', { method: 'POST', body: new FormData(form) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Generation failed');
            
            // Isolate the actual workflow object, preventing nested amnesia
            const workflowToSave = data.workflow || data;
            localStorage.setItem('meshWorkflow', JSON.stringify(workflowToSave));
            
            window.location.href = '/builder';
        } catch (err) { 
            console.error(err);
            if (btn) btn.innerHTML = originalText;
            alert('Generation failed: ' + err.message);
        }
    });
}

function initBuilder() {
    const container = document.getElementById('wb-nodes');
    const deployBtn = document.getElementById('wb-deploy');
    
    // Note: If builder-engine.js is running the canvas, this container won't exist, which is expected.
    if (!container) return; 

    const workflow = JSON.parse(localStorage.getItem('meshWorkflow') || '{}');
    if (container && workflow.steps) {
        // [PRODUCTION FIX]: Applied escapeHTML to prevent XSS rendering
        container.innerHTML = workflow.steps.map((step, i) => `
            <div class="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-xl p-5 mb-4 relative z-10 shadow-lg">
                <div class="flex items-center gap-3 mb-4">
                    <span class="w-8 h-8 rounded-full bg-blue-900/50 text-blue-400 flex items-center justify-center font-bold border border-blue-500/30">${i + 1}</span>
                    <h3 class="text-white font-bold text-lg">${window.escapeHTML(step.taskName)}</h3>
                </div>
                <div class="grid grid-cols-3 gap-4">
                    <div>
                        <label class="text-xs text-gray-500 mb-1 block uppercase tracking-wider">Task Type</label>
                        <div class="bg-gray-800 text-gray-300 px-3 py-2 rounded text-sm border border-gray-700">${window.escapeHTML(step.taskType)}</div>
                    </div>
                    <div>
                        <label class="text-xs text-gray-500 mb-1 block uppercase tracking-wider">Provider</label>
                        <div class="bg-gray-800 text-gray-300 px-3 py-2 rounded text-sm border border-gray-700">${window.escapeHTML(step.provider)}</div>
                    </div>
                    <div>
                        <label class="text-xs text-gray-500 mb-1 block uppercase tracking-wider">Model</label>
                        <div class="bg-gray-800 text-blue-400 font-mono px-3 py-2 rounded text-sm border border-gray-700">${window.escapeHTML(step.model)}</div>
                    </div>
                </div>
            </div>
            ${i < workflow.steps.length - 1 ? '<div class="w-px h-8 bg-transparent mx-auto my-1 border-l-2 border-dashed border-blue-500/50 z-0"></div>' : ''}
        `).join('');
    }

    if (deployBtn) {
        deployBtn.addEventListener('click', (e) => {
            e.preventDefault(); 
            window.location.href = '/mission-control';
        });
    }
}

function initHistory() {
    const container = document.getElementById('history-container');
    if (!container) return;

    fetch('/api/history').then(r => r.json()).then(data => {
        if (!data || data.length === 0) {
            container.innerHTML = `<div class="text-zinc-500 text-center py-10">No execution history found.</div>`;
            return;
        }
        
        container.innerHTML = data.map(run => `
            <div class="p-5 bg-zinc-900 border border-zinc-800 rounded-xl mb-3 flex justify-between items-center hover:border-zinc-700 transition-colors">
                <div>
                    <div class="font-bold text-white text-lg flex items-center gap-2">
                        ${run.status === 'COMPLETED' || run.status === 'complete' ? '<span class="text-green-400">✓</span>' : '<span class="text-red-400">✖</span>'}
                        ${window.escapeHTML(run.workflowName || 'Automated Workflow')}
                    </div>
                    <div class="text-sm text-zinc-500 mt-1 font-mono">${new Date(run.executionTime || run.createdAt || Date.now()).toLocaleString()}</div>
                </div>
                <div class="text-right bg-black p-3 rounded-lg border border-zinc-800">
                    <div class="text-blue-400 font-mono font-bold">$${(run.cost || 0).toFixed(4)}</div>
                    <div class="text-zinc-500 text-xs mt-1 uppercase tracking-wider">${run.tokens || 0} TOKENS • ${run.latency || 0}MS</div>
                </div>
            </div>
        `).join('');
    }).catch(err => {
        console.error(err);
        container.innerHTML = `<div class="text-red-500 p-4 bg-red-900/20 rounded-lg border border-red-500/30">Failed to load history from database.</div>`;
    });
}