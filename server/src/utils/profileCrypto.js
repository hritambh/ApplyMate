import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const hex = process.env.PROFILE_ENCRYPTION_KEY?.trim().replace(/^["']|["']$/g, '');
  if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      'PROFILE_ENCRYPTION_KEY must be a 32-byte hex string (64 chars) in server/.env. Generate: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

/** Encrypt plaintext for storage. Returns `iv:tag:ciphertext` (hex). */
export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Decrypt a value produced by encryptSecret. */
export function decryptSecret(stored) {
  if (!stored) return '';
  const key = getKey();
  const [ivHex, tagHex, dataHex] = stored.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Invalid encrypted secret format');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

/** Normalize Gmail app passwords (remove spaces). */
export function normalizeSmtpPass(pass) {
  return String(pass || '').replace(/\s+/g, '');
}
