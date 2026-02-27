// === Security Middleware ===

const helmet = require('helmet');

/**
 * Rate limiter using a sliding window in-memory store
 */
function createRateLimiter({ windowMs = 60000, maxRequests = 100 } = {}) {
    const requests = new Map();

    // Cleanup old entries every minute
    setInterval(() => {
        const now = Date.now();
        for (const [key, data] of requests) {
            if (now - data.windowStart > windowMs) {
                requests.delete(key);
            }
        }
    }, windowMs);

    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();

        if (!requests.has(key) || now - requests.get(key).windowStart > windowMs) {
            requests.set(key, { windowStart: now, count: 1 });
            return next();
        }

        const data = requests.get(key);
        data.count++;

        if (data.count > maxRequests) {
            res.set('Retry-After', Math.ceil(windowMs / 1000));
            return res.status(429).json({
                success: false,
                error: { message: 'Too many requests. Please try again later.' }
            });
        }

        next();
    };
}

/**
 * Input sanitization middleware
 */
function sanitizeInput(req, _res, next) {
    if (req.params) {
        for (const key of Object.keys(req.params)) {
            if (typeof req.params[key] === 'string') {
                req.params[key] = req.params[key].replace(/[<>]/g, '');
            }
        }
    }
    next();
}

/**
 * CORS configuration
 */
function getCorsOptions() {
    return {
        origin: (origin, callback) => {
            // Allow Chrome extension origins and localhost
            const allowed = [
                /^chrome-extension:\/\//,
                /^http:\/\/localhost/,
                /^http:\/\/127\.0\.0\.1/
            ];
            if (!origin || allowed.some((pattern) => pattern.test(origin))) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true
    };
}

/**
 * Apply all security middleware
 */
function applySecurityMiddleware(app) {
    // Helmet for HTTP headers security
    app.use(helmet({
        contentSecurityPolicy: false // Disable CSP for API server
    }));

    // Rate limiting
    app.use('/api/', createRateLimiter({ windowMs: 60000, maxRequests: 100 }));

    // Input sanitization
    app.use(sanitizeInput);
}

module.exports = { applySecurityMiddleware, createRateLimiter, sanitizeInput, getCorsOptions };
