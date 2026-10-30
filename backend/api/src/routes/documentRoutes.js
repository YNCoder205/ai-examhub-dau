const express = require('express');
const { uploadDocument, analyzeDocument } = require('../controllers/documentController');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/upload', authenticate, requireRole('teacher', 'admin'), uploadDocument);
router.post('/analyze', authenticate, requireRole('teacher', 'admin'), analyzeDocument);

module.exports = router;
