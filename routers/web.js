// routers/web.js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => res.render('home', { title: 'MeshFlow X - AI OS' }));
router.get('/builder', (req, res) => res.render('workflow-builder', { title: 'Workflow Builder' }));
router.get('/history', (req, res) => res.render('history', { title: 'Execution History' }));
router.get('/analytics', (req, res) => res.render('analytics', { title: 'OS Analytics' }));
router.get('/templates', (req, res) => res.render('templates', { title: 'Workflow Templates' }));

// FIX: Prioritize UUID routing to prevent UI lockup
router.get('/mission-control', (req, res) => {
    if (req.query.id) return res.render('mission-control', { title: 'Mission Control', executionId: req.query.id });
    res.render('mission-control', { title: 'Mission Control', executionId: null });
});

router.get('/mission-control/:id', (req, res) => {
    res.render('mission-control', { title: 'Mission Control', executionId: req.params.id });
});

module.exports = router;