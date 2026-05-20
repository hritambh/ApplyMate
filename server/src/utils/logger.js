const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function write(level, context, message, meta) {
  if (LEVELS[level] < currentLevel) return;
  const prefix = `[${ts()}] [${level.toUpperCase()}]${context ? ` [${context}]` : ''}`;
  if (meta !== undefined) {
    console[level === 'debug' ? 'log' : level](prefix, message, meta);
  } else {
    console[level === 'debug' ? 'log' : level](prefix, message);
  }
}

export const log = {
  debug: (ctx, msg, meta) => write('debug', ctx, msg, meta),
  info: (ctx, msg, meta) => write('info', ctx, msg, meta),
  warn: (ctx, msg, meta) => write('warn', ctx, msg, meta),
  error: (ctx, msg, meta) => write('error', ctx, msg, meta),
};

/** Log duration of an async network/service call. */
export async function timed(ctx, label, fn, meta = {}) {
  const start = Date.now();
  log.info(ctx, `${label} started`, meta);
  try {
    const result = await fn();
    log.info(ctx, `${label} completed`, { ...meta, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    log.error(ctx, `${label} failed`, {
      ...meta,
      durationMs: Date.now() - start,
      error: err?.message || String(err),
    });
    throw err;
  }
}
