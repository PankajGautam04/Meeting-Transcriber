// === Error Handling Middleware ===

const logger = require('../utils/logger');

/**
 * Custom application error class
 */
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Not Found (404) handler
 */
function notFoundHandler(req, res, next) {
    const err = new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404);
    next(err);
}

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, _next) {
    const statusCode = err.statusCode || 500;
    const isOperational = err.isOperational || false;

    // Log the error
    if (statusCode >= 500) {
        logger.error('Server error', {
            error: err.message,
            stack: err.stack,
            method: req.method,
            url: req.originalUrl,
            ip: req.ip
        });
    } else {
        logger.warn('Client error', {
            error: err.message,
            statusCode,
            method: req.method,
            url: req.originalUrl
        });
    }

    // Send response
    res.status(statusCode).json({
        success: false,
        error: {
            message: isOperational ? err.message : 'Internal server error',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        }
    });
}

module.exports = { AppError, notFoundHandler, errorHandler };
