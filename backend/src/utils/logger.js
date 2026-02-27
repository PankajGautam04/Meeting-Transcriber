// === Winston Logger Configuration ===

const { createLogger, format, transports } = require('winston');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { service: 'meeting-transcriber' },
    transports: [
        // Console output with colors
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(({ timestamp, level, message, service, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
                })
            )
        }),
        // File transport for errors
        new transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // File transport for all logs
        new transports.File({
            filename: path.join(LOG_DIR, 'combined.log'),
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

module.exports = logger;
