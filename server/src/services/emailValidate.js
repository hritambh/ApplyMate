import { promisify } from 'node:util';
import emailExistence from 'email-existence';
import { log, timed } from '../utils/logger.js';

const CTX = 'email-validate';

const checkExistence = promisify(emailExistence.check.bind(emailExistence));

const FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_MS = Number(process.env.EMAIL_CHECK_TIMEOUT_MS || 15000);

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Email check timed out')), ms);
    }),
  ]);
}

/**
 * SMTP/MX existence check (no email is sent).
 * @returns {{ status: 'valid'|'invalid'|'unknown', message: string }}
 */
export async function checkEmailExists(email) {
  const normalized = String(email || '').trim().toLowerCase();

  if (!FORMAT_RE.test(normalized)) {
    log.warn(CTX, 'Invalid email format', { email: normalized });
    return { status: 'invalid', message: 'Invalid email format' };
  }

  if (process.env.SKIP_EMAIL_VALIDATION === 'true') {
    log.info(CTX, 'Validation skipped (SKIP_EMAIL_VALIDATION)', { email: normalized });
    return { status: 'unknown', message: 'Validation skipped (SKIP_EMAIL_VALIDATION)' };
  }

  try {
    const exists = await timed(
      CTX,
      'email-existence.check',
      () => withTimeout(checkExistence(normalized), TIMEOUT_MS),
      { email: normalized, timeoutMs: TIMEOUT_MS },
    );

    const result = exists
      ? { status: 'valid', message: 'Email appears reachable' }
      : { status: 'invalid', message: 'Mailbox not found or rejected' };

    log.info(CTX, 'Email check result', { email: normalized, ...result });
    return result;
  } catch (err) {
    log.warn(CTX, 'Email check inconclusive', {
      email: normalized,
      error: err?.message || String(err),
    });
    return {
      status: 'unknown',
      message: err?.message || 'Could not verify (network or server blocked check)',
    };
  }
}
