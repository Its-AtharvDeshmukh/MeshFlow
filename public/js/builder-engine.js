// public/js/builder-engine.js

const escapeHTML = (str) => {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
};

const setText = (el, value) => { 
    if (el && el.textContent !== value) el.textContent = value; 
};

const BuilderEngine = {
    state: { 
        nodes: [], 
        edges: [], 
        selectedNodeIds: new Set(), 
        scale: 1, 
        panX: 0, 
        panY: 0, 
        isPanning: false, 
        isSpaceDown: false, 
        startX: 0, 
        startY: 0, 
        isDrawingEdge: false, 
        edgeStartNode: null,
        draggedNode: null
    },
    advisorTimeout: null, 
    nodeEls: null,

    init() {
        this.wrapper = document.getElementById('canvas-wrapper');
        this.canvas = document.getElementById('nodes-canvas');
        this.inspector = document.getElementById('inspector-content');
        
        if (!document.getElementById('edges-layer')) {
            this.canvas.insertAdjacentHTML('afterbegin', `<svg id="edges-layer" class="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-visible"></svg>`);
        }
        this.edgesLayer = document.getElementById('edges-layer');

        const savedWorkflow = localStorage.getItem('meshWorkflow');
        if (savedWorkflow) {
            try { 
                this.loadGeneratedWorkflow(JSON.parse(savedWorkflow)); 
            } catch (e) { 
                console.error("Corrupted local payload. Purging cache.");
                localStorage.removeItem('meshWorkflow'); 
            }
        }
        this.bindEvents();
        this.render();
    },

    loadGeneratedWorkflow(generated) {
        const workflowObj = generated.workflow || generated;
        const steps = workflowObj.steps || workflowObj.nodes || [];
        const nameInput = document.getElementById('workflow-name');
        
        if (nameInput) nameInput.value = escapeHTML(workflowObj.workflowName || 'Intelligent OS Pipeline');
        
        this.state.nodes = steps.map((n, i) => ({
            ...n, 
            id: n.id || 'node_' + Date.now() + i,
            name: escapeHTML(n.taskName || n.name || 'Compute Node'),
            type: escapeHTML(n.taskType || n.type || 'Processing'),
            prompt: n.prompt || '',
            reason: escapeHTML(n.reason || 'Pending dynamic capability routing.'),
            confidence: Number(n.confidence) || 0.95,
            x: i * 350 + 100, 
            y: 150, 
            isValid: true, 
            validationMsg: ''
        }));

        this.state.edges = generated.edges || [];
        
        // Auto-wire linear DAG if edges are missing
        if (this.state.edges.length === 0 && this.state.nodes.length > 1) {
            for (let i = 0; i < this.state.nodes.length - 1; i++) {
                this.state.edges.push({ source: this.state.nodes[i].id, target: this.state.nodes[i + 1].id });
            }
        }
        
        this.validateWorkflow(); 
        this.render();
    },

    bindEvents() {
        // Canvas Navigation & Interaction Bindings
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
                this.state.isSpaceDown = true; this.wrapper.style.cursor = 'grab';
            }
            if ((e.code === 'Backspace' || e.code === 'Delete') && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
                this.deleteSelected();
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') { this.state.isSpaceDown = false; this.wrapper.style.cursor = 'default'; }
        });

        this.wrapper.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) e.preventDefault();
            const zoomSpeed = 0.002;
            const newScale = Math.min(Math.max(0.2, this.state.scale - e.deltaY * zoomSpeed), 3);
            const rect = this.wrapper.getBoundingClientRect();
            const mouseX = e.clientX - rect.left; 
            const mouseY = e.clientY - rect.top;
            
            this.state.panX = mouseX - (mouseX - this.state.panX) * (newScale / this.state.scale);
            this.state.panY = mouseY - (mouseY - this.state.panY) * (newScale / this.state.scale);
            this.state.scale = newScale; 
            this.updateTransform();
        });

        this.wrapper.addEventListener('mousedown', (e) => {
            if (this.state.isSpaceDown || e.button === 1 || e.target === this.wrapper || e.target === this.canvas || e.target === this.edgesLayer) {
                this.state.isPanning = true; 
                this.wrapper.style.cursor = 'grabbing';
                this.state.startX = e.clientX - this.state.panX; 
                this.state.startY = e.clientY - this.state.panY;
                if (!e.shiftKey) this.deselectAll();
            }
        });

        window.addEventListener('mouseup', () => {
            this.state.isPanning = false; 
            this.wrapper.style.cursor = this.state.isSpaceDown ? 'grab' : 'default';
            this.state.isDrawingEdge = false; 
            this.state.edgeStartNode = null; 
            this.state.draggedNode = null;
            this.renderEdges();
        });

        window.addEventListener('mousemove', (e) => {
            if (this.state.isPanning) {
                this.state.panX = e.clientX - this.state.startX; 
                this.state.panY = e.clientY - this.state.startY; 
                this.updateTransform();
            } else if (this.state.draggedNode) {
                const node = this.state.nodes.find(n => n.id === this.state.draggedNode);
                if (node) {
                    node.x = (e.clientX - this.state.startX - this.state.panX) / this.state.scale;
                    node.y = (e.clientY - this.state.startY - this.state.panY) / this.state.scale;
                    this.render();
                }
            } else if (this.state.isDrawingEdge) {
                this.drawTempEdge(e.clientX, e.clientY);
            }
        });

        // Generation Trigger
        const btnGen = document.getElementById('btn-generate');
        const promptInput = document.getElementById('ai-prompt-input');
        
        if (btnGen) {
            btnGen.addEventListener('click', async (e) => { 
                e.preventDefault(); 
                const promptVal = promptInput?.value;
                if (!promptVal) return alert('Enter a prompt to modify the DAG.');
                
                btnGen.disabled = true;
                btnGen.innerHTML = `<i data-lucide="loader" class="w-3 h-3 animate-spin"></i>`;
                if (window.lucide) lucide.createIcons();
                
                try {
                    const generated = await MeshFlowAPI.generateWorkflow(promptVal, null);
                    localStorage.setItem('meshWorkflow', JSON.stringify(generated));
                    this.loadGeneratedWorkflow(generated);
                    this.updateConsole('OS Graph restructured successfully.', 'text-green-400');
                } catch (err) {
                    this.updateConsole(`Generation failed: ${err.message}`, 'text-red-400');
                } finally {
                    btnGen.innerHTML = 'Generate'; 
                    btnGen.disabled = false; 
                }
            });
        }
    },

    // Exposed execution method triggered by toolbar.ejs
    async executeWorkflow() {
        const runBtn = document.getElementById('btn-run-workflow');
        if (runBtn && runBtn.disabled) return;
        
        if (runBtn) runBtn.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i> Initializing OS...`;
        if (window.lucide) lucide.createIcons();
        this.updateConsole('Initiating pipeline execution to Mesh API routing engine...', 'text-blue-400');
        
        try {
            const savedWorkflow = JSON.parse(localStorage.getItem('meshWorkflow') || '{}');
            const workflowObj = savedWorkflow.workflow || savedWorkflow;
            
            // FATAL FLAW FIX: originalDocument must be extracted and preserved for the Backend Executor
            const payload = {
                workflowId: workflowObj.workflowId,
                workflowName: document.getElementById('workflow-name')?.value || 'Automated Pipeline',
                steps: this.state.nodes, 
                edges: this.state.edges,
                originalDocument: workflowObj.originalDocument || ""
            };
            
            const res = await MeshFlowAPI.run(payload);
            this.updateConsole(`Execution ID [${res.executionId}] secured. Transferring view...`, 'text-green-400');
            setTimeout(() => window.location.href = `/mission-control?id=${res.executionId}`, 500);
            
        } catch (err) {
            this.updateConsole(`Execution Fault: ${err.message}`, 'text-red-400');
            alert(`Execution Fault: ${err.message}`);
            if (runBtn) {
                runBtn.disabled = false; 
                runBtn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Deploy OS`;
            }
            if (window.lucide) lucide.createIcons();
        }
    },

    updateTransform() {
        this.canvas.style.transform = `translate(${this.state.panX}px, ${this.state.panY}px) scale(${this.state.scale})`;
        this.wrapper.style.backgroundPosition = `${this.state.panX}px ${this.state.panY}px`;
        this.wrapper.style.backgroundSize = `${32 * this.state.scale}px ${32 * this.state.scale}px`;
    },
    
    selectNode(id, multi = false) {
        if (!multi) this.state.selectedNodeIds.clear();
        this.state.selectedNodeIds.add(id);
        this.render(); 
        this.updateInspector();
    },
    
    deselectAll() { 
        this.state.selectedNodeIds.clear(); 
        this.render(); 
        this.updateInspector(); 
    },
    
    deleteSelected() {
        const toDelete = Array.from(this.state.selectedNodeIds);
        this.state.nodes = this.state.nodes.filter(n => !toDelete.includes(n.id));
        this.state.edges = this.state.edges.filter(e => !toDelete.includes(e.source || e.from) && !toDelete.includes(e.target || e.to));
        this.deselectAll(); 
        this.validateWorkflow();
    },

    startEdge(nodeId, e) { 
        e.stopPropagation(); 
        this.state.isDrawingEdge = true; 
        this.state.edgeStartNode = nodeId; 
    },
    
    endEdge(nodeId, e) {
        e.stopPropagation();
        if (this.state.edgeStartNode && this.state.edgeStartNode !== nodeId) {
            const startId = this.state.edgeStartNode;
            const edgeExists = this.state.edges.find(edge => (edge.source || edge.from) === startId && (edge.target || edge.to) === nodeId);
            
            // DAG Cycle Protection
            let createsCycle = false;
            const visited = new Set();
            const stack = [nodeId];
            while (stack.length > 0) {
                const current = stack.pop();
                if (current === startId) { createsCycle = true; break; }
                if (!visited.has(current)) {
                    visited.add(current);
                    const children = this.state.edges.filter(edge => (edge.source || edge.from) === current).map(edge => edge.target || edge.to);
                    stack.push(...children);
                }
            }
            if (!edgeExists && !createsCycle) { 
                this.state.edges.push({ source: startId, target: nodeId }); 
            } else if (createsCycle) { 
                this.updateConsole('Cannot create circular dependency. MeshFlow requires a Directed Acyclic Graph (DAG).', 'text-yellow-500'); 
            }
        }
        this.state.isDrawingEdge = false; 
        this.state.edgeStartNode = null; 
        this.validateWorkflow(); 
        this.renderEdges();
    },
    
    drawTempEdge(mouseX, mouseY) {
        if (!this.state.edgeStartNode) return;
        const rect = this.wrapper.getBoundingClientRect();
        const startNodeEl = document.getElementById(this.state.edgeStartNode);
        if (!startNodeEl) return;
        
        const startX = startNodeEl.offsetLeft + startNodeEl.offsetWidth;
        const startY = startNodeEl.offsetTop + (startNodeEl.offsetHeight / 2);
        const endX = (mouseX - rect.left - this.state.panX) / this.state.scale;
        const endY = (mouseY - rect.top - this.state.panY) / this.state.scale;
        
        this.renderEdges([{ fromTemp: { x: startX, y: startY }, toTemp: { x: endX, y: endY } }]);
    },

    renderEdges(tempEdge = null) {
        let svg = '';
        this.state.edges.forEach(e => {
            const sourceNode = document.getElementById(e.source || e.from);
            const targetNode = document.getElementById(e.target || e.to);
            if (sourceNode && targetNode) {
                const x1 = sourceNode.offsetLeft + sourceNode.offsetWidth;
                const y1 = sourceNode.offsetTop + (sourceNode.offsetHeight / 2);
                const x2 = targetNode.offsetLeft;
                const y2 = targetNode.offsetTop + (targetNode.offsetHeight / 2);
                const cp1x = x1 + 80, cp1y = y1;
                const cp2x = x2 - 80, cp2y = y2;
                svg += `<path d="M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}" class="builder-edge" stroke="#3b82f6" stroke-width="2" fill="none" />`;
            }
        });
        if (tempEdge && tempEdge[0]) {
            const { fromTemp, toTemp } = tempEdge[0];
            const cp1x = fromTemp.x + 80, cp1y = fromTemp.y;
            const cp2x = toTemp.x - 80, cp2y = toTemp.y;
            svg += `<path d="M ${fromTemp.x} ${fromTemp.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toTemp.x} ${toTemp.y}" class="builder-edge temp-edge" stroke="#9ca3af" stroke-width="2" stroke-dasharray="4" fill="none" />`;
        }
        this.edgesLayer.innerHTML = svg;
    },

    updateNodeData(id, key, value) {
        const node = this.state.nodes.find(n => n.id === id);
        if (node) { node[key] = value; this.validateWorkflow(); this.render(); }
    },

    validateWorkflow() {
        let allValid = true;
        this.state.nodes.forEach(node => { 
            node.isValid = !!(node.prompt && node.prompt.trim() !== ''); 
            if (!node.isValid) allValid = false; 
        });
        const runBtn = document.getElementById('btn-run-workflow');
        if (runBtn) {
            runBtn.disabled = !allValid || this.state.nodes.length === 0;
        }
        this.render();
    },

    updateConsole(msg, colorClass = "text-zinc-400") {
        const consoleEl = document.getElementById('console-output');
        if (!consoleEl) return;
        let icon = 'info';
        if (colorClass.includes('red')) icon = 'alert-circle';
        if (colorClass.includes('green')) icon = 'check-circle-2';
        if (colorClass.includes('blue')) icon = 'cpu';
        
        const entry = document.createElement('div');
        entry.className = `flex gap-2 items-start p-2 rounded-lg bg-white/[0.02] border border-white/5 mb-2 animate-in fade-in slide-in-from-left-2`;
        entry.innerHTML = `
            <i data-lucide="${icon}" class="w-3.5 h-3.5 mt-0.5 ${colorClass}"></i>
            <div>
                <p class="text-[10px] font-mono text-zinc-500 mb-0.5">${new Date().toLocaleTimeString()}</p>
                <p class="text-xs text-zinc-300 leading-relaxed">${msg}</p>
            </div>
        `;
        consoleEl.appendChild(entry);
        if (window.lucide) lucide.createIcons();
        consoleEl.scrollTop = consoleEl.scrollHeight;
    },

    updateInspector() {
        if (this.state.selectedNodeIds.size !== 1) {
            this.inspector.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-zinc-600 text-center p-6"><i data-lucide="mouse-pointer-2" class="w-8 h-8 mb-4 opacity-50"></i><p class="text-xs">Select a single node to view routing intelligence.</p></div>`;
            if (window.lucide) lucide.createIcons(); 
            return;
        }
        const nodeId = Array.from(this.state.selectedNodeIds)[0];
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (!node) return;
        
        this.inspector.innerHTML = `
            <div class="space-y-6 animate-in fade-in duration-200 p-6 pb-20 h-full overflow-y-auto">
                <div>
                    <label class="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Task Definition</label>
                    <input type="text" class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none mb-3" value="${escapeHTML(node.name)}" onchange="BuilderEngine.updateNodeData('${escapeHTML(node.id)}', 'name', this.value)">
                    <textarea rows="6" class="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-zinc-300 focus:border-blue-500 outline-none resize-none font-mono" placeholder="Custom LLM Prompt..." onchange="BuilderEngine.updateNodeData('${escapeHTML(node.id)}', 'prompt', this.value)">${escapeHTML(node.prompt || '')}</textarea>
                </div>
                <div class="border-t border-zinc-800 pt-6">
                    <h3 class="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-4 flex items-center gap-2"><i data-lucide="cpu" class="w-4 h-4 text-blue-400"></i> Execution Target</h3>
                    <div class="bg-blue-900/10 p-4 rounded-lg border border-blue-500/20 mb-4">
                        <span class="block text-[10px] text-blue-400 font-mono uppercase tracking-widest mb-1">Archetype Assigned</span>
                        <p class="text-xs font-bold text-blue-200 leading-relaxed">${escapeHTML(node.type)}</p>
                    </div>
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    render() {
        if (!this.nodeEls) this.nodeEls = new Map();
        const existingIds = new Set(this.nodeEls.keys());
        const seenIds = new Set();
        
        this.state.nodes.forEach(node => {
            seenIds.add(node.id);
            let el = this.nodeEls.get(node.id);
            if (!el) {
                el = document.createElement('div');
                el.className = 'absolute w-72 bg-zinc-900/80 backdrop-blur-md border rounded-xl z-10 cursor-pointer shadow-lg transition-shadow';
                // FATAL FLAW FIX: Node connection handles explicitly re-injected
                el.innerHTML = `
                    <div class="node-handle left"></div>
                    <div class="node-handle right"></div>
                    <div class="p-3 border-b border-zinc-800/80 bg-zinc-950/50 rounded-t-xl"><span class="node-name text-[13px] font-semibold text-zinc-100"></span></div>
                    <div class="p-4"><p class="node-prompt text-[10px] text-zinc-500 line-clamp-3 leading-relaxed"></p></div>`;
                
                // Mousedown logic specifically for node dragging vs node selecting
                el.addEventListener('mousedown', (e) => {
                    if (e.target.closest('.node-handle')) return;
                    e.stopPropagation();
                    this.selectNode(node.id, e.shiftKey);
                    this.state.draggedNode = node.id;
                    this.state.startX = e.clientX - (node.x * this.state.scale) - this.state.panX;
                    this.state.startY = e.clientY - (node.y * this.state.scale) - this.state.panY;
                });
                
                // Connection Wire Logic
                el.querySelectorAll('.node-handle').forEach(handle => {
                    handle.addEventListener('mousedown', (e) => { this.startEdge(node.id, e); });
                    handle.addEventListener('mouseup', (e) => { this.endEdge(node.id, e); });
                });
                
                this.canvas.appendChild(el); 
                this.nodeEls.set(node.id, el);
            }
            
            el.id = node.id; 
            el.style.left = `${node.x}px`; 
            el.style.top = `${node.y}px`;
            
            const isSelected = this.state.selectedNodeIds.has(node.id);
            el.classList.toggle('border-blue-500', isSelected);
            el.classList.toggle('shadow-[0_0_20px_rgba(59,130,246,0.3)]', isSelected);
            el.classList.toggle('border-red-500', !isSelected && !node.isValid);
            el.classList.toggle('border-zinc-800', !isSelected && node.isValid);
            
            setText(el.querySelector('.node-name'), node.name);
            setText(el.querySelector('.node-prompt'), node.prompt || 'No instruction provided.');
        });
        
        existingIds.forEach(id => { 
            if (!seenIds.has(id)) { 
                this.nodeEls.get(id)?.remove(); 
                this.nodeEls.delete(id); 
            } 
        });
        
        if (!this.edgesLayer.isConnected) this.canvas.appendChild(this.edgesLayer);
        requestAnimationFrame(() => this.renderEdges());
    }
};

window.BuilderEngine = BuilderEngine;
document.addEventListener('DOMContentLoaded', () => BuilderEngine.init());