import { log } from '../utils/logger.js';

/** Log response details for failed requests. */
export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const meta = {
      durationMs,
      userId: req.user?.id,
    };

    if (res.statusCode >= 500) {
      log.error('http', `${method} ${originalUrl} ${res.statusCode}`, meta);
    } else if (res.statusCode >= 400) {
      log.warn('http', `${method} ${originalUrl} ${res.statusCode}`, meta);
    } else {
      log.info('http', `${method} ${originalUrl} ${res.statusCode}`, meta);
    }
  });

  next();
}

/** Catch errors passed to next(err) from route handlers. */
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  log.error('http', 'Request error', {
    method: req.method,
    path: req.originalUrl,
    status,
    error: message,
    userId: req.user?.id,
    stack: status >= 500 ? err.stack : undefined,
  });

  if (res.headersSent) return;

  res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : message,
  });
}

/** 404 for unmatched API routes. */
export function notFoundHandler(req, res) {
  log.warn('http', 'Route not found', {
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
  });
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

/** Wrap async route handlers so rejections reach errorHandler. */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
