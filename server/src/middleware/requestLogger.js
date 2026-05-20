import { log } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level]('http', `${method} ${originalUrl} ${res.statusCode}`, {
      durationMs: Date.now() - start,
    });
  });

  next();
}
