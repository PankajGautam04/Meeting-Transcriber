// === Transcript REST API Routes ===

const express = require('express');
const router = express.Router();
const db = require('../services/database');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

/**
 * GET /api/transcripts
 * List all transcripts (most recent first)
 */
router.get('/', (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const transcripts = db.getTranscripts(limit);
        res.json({
            success: true,
            data: transcripts,
            count: transcripts.length
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/transcripts/:id
 * Get a single transcript with all segments
 */
router.get('/:id', (req, res, next) => {
    try {
        const { id } = req.params;

        if (!id || id.length < 1) {
            throw new AppError('Invalid transcript ID', 400);
        }

        const transcript = db.getTranscriptById(id);
        if (!transcript) {
            throw new AppError('Transcript not found', 404);
        }

        res.json({
            success: true,
            data: transcript
        });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/transcripts/:id
 * Delete a transcript and its segments
 */
router.delete('/:id', (req, res, next) => {
    try {
        const { id } = req.params;

        if (!id || id.length < 1) {
            throw new AppError('Invalid transcript ID', 400);
        }

        const deleted = db.deleteTranscript(id);
        if (!deleted) {
            throw new AppError('Transcript not found', 404);
        }

        logger.info('Transcript deleted via API', { id });
        res.json({ success: true, message: 'Transcript deleted' });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health/check', (_req, res) => {
    const stats = db.getStats();
    res.json({
        success: true,
        data: {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            ...stats
        }
    });
});

module.exports = router;
