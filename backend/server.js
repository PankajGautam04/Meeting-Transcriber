// === Meeting Transcriber - Server Entry Point ===

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const logger = require('./src/utils/logger');
const db = require('./src/services/database');
const transcriptRoutes = require('./src/routes/transcripts');
const { handleSession } = require('./src/websocket/sessionHandler');
const { applySecurityMiddleware, getCorsOptions } = require('./src/middleware/security');
const { notFoundHandler, errorHandler } = require('./src/middleware/errorHandler');

// === Config ===
const PORT = process.env.PORT || 3001;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

// === Initialize Database ===
db.initialize();

// === Express App ===
const app = express();

// Security middleware (Helmet, rate limiting, sanitization)
applySecurityMiddleware(app);

// CORS
app.use(cors(getCorsOptions()));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, _res, next) => {
    logger.debug('HTTP request', { method: req.method, url: req.originalUrl, ip: req.ip });
    next();
});

// Serve extension files for preview (development only)
if (process.env.NODE_ENV !== 'production') {
    app.use('/extension', express.static(path.join(__dirname, '..', 'extension')));
}

// === REST API Routes ===
app.use('/api/transcripts', transcriptRoutes);

// Health check (outside the transcript router for simplicity)
app.get('/api/health', (_req, res) => {
    const stats = db.getStats();
    res.json({
        success: true,
        data: {
            status: 'ok',
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            deepgram: !!(DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== 'your_deepgram_api_key_here'),
            ...stats
        }
    });
});

// 404 & Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// === HTTP Server ===
const server = http.createServer(app);

// === WebSocket Server ===
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
    logger.info('WebSocket connection', { ip: req.socket.remoteAddress });
    handleSession(clientWs, DEEPGRAM_API_KEY);
});

// === Graceful Shutdown ===
function gracefulShutdown(signal) {
    logger.info(`${signal} received, shutting down gracefully...`);

    server.close(() => {
        logger.info('HTTP server closed');
        db.close();
        process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
});

// === Start Server ===
server.listen(PORT, () => {
    const dgStatus = DEEPGRAM_API_KEY && DEEPGRAM_API_KEY !== 'your_deepgram_api_key_here'
        ? '✅ Configured'
        : '⚠️  Not configured (set DEEPGRAM_API_KEY in .env)';

    logger.info(`Server started on port ${PORT}`);
    console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║       Meeting Transcriber Backend Server             ║
  ╠══════════════════════════════════════════════════════╣
  ║  REST API:    http://localhost:${PORT}                  ║
  ║  WebSocket:   ws://localhost:${PORT}                    ║
  ║  Deepgram:    ${dgStatus.padEnd(39)}║
  ╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
