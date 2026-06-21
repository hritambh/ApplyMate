import { prisma } from '../db.js';
import { decryptSecret, encryptSecret, normalizeSmtpPass } from '../utils/profileCrypto.js';

export function isProfileComplete(record) {
  if (!record) return false;
  return Boolean(
    record.applicantName?.trim() &&
      record.applicantHeadline?.trim() &&
      record.applicantSkills?.trim() &&
      record.applicantPhone?.trim() &&
      record.smtpHost?.trim() &&
      record.smtpPort > 0 &&
      record.smtpUser?.trim() &&
      record.smtpPassEnc &&
      record.mailFromName?.trim() &&
      record.mailFromAddress?.trim(),
  );
}

/** Safe shape for API responses — never includes raw secrets. */
export function toPublicProfile(record, extras = {}) {
  if (!record) return null;
  return {
    applicantName: record.applicantName,
    applicantHeadline: record.applicantHeadline,
    applicantSkills: record.applicantSkills,
    applicantPhone: record.applicantPhone,
    smtpHost: record.smtpHost,
    smtpPort: record.smtpPort,
    smtpSecure: record.smtpSecure,
    smtpUser: record.smtpUser,
    smtpPassConfigured: Boolean(record.smtpPassEnc),
    mailFromName: record.mailFromName,
    mailFromAddress: record.mailFromAddress,
    openaiKeyConfigured: Boolean(record.openaiKeyEnc),
    linkedinUrl: record.linkedinUrl || '',
    theme: record.theme === 'dark' ? 'dark' : 'light',
    freeCredits: Math.max(0, record.freeCredits ?? 0),
    creditsUsed: Math.max(0, record.creditsUsed ?? 0),
    complete: isProfileComplete(record),
    ...extras,
  };
}

export async function getOrCreateProfile(userId, seeds = {}) {
  const existing = await prisma.userProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  return prisma.userProfile.create({
    data: {
      userId,
      applicantName: seeds.applicantName || '',
      mailFromAddress: seeds.mailFromAddress || '',
      mailFromName: seeds.mailFromName || seeds.applicantName || '',
    },
  });
}

/** Internal use — includes decrypted SMTP password. */
export async function getProfileForUser(userId) {
  const record = await prisma.userProfile.findUnique({ where: { userId } });
  if (!record) return null;

  let smtpPass = '';
  if (record.smtpPassEnc) {
    try { smtpPass = decryptSecret(record.smtpPassEnc); } catch { smtpPass = ''; }
  }

  return { ...record, smtpPass, complete: isProfileComplete(record) };
}

/**
 * Resolves the OpenAI API key for a user, in priority order:
 *   1. User's own key (stored encrypted in UserProfile) — never consumes credits.
 *   2. OPENAI_SHARED_KEY_FOR_ALL=true → shared server key for every user, source
 *      'shared' — bypasses the credit system entirely (no credit consumed).
 *   3. Credits remaining → shared server key, source 'free' (caller decrements one
 *      credit per successful generation via consumeFreeCredit).
 *   4. Otherwise → descriptive error (exhausted / pending request).
 *
 * Credits are bounded and granted by the admin (initial allowance + approvals);
 * there is no unlimited tier unless OPENAI_SHARED_KEY_FOR_ALL is enabled.
 *
 * Returns { key, source: 'own' | 'shared' | 'free' }.
 */
export async function resolveOpenAIKey(userId) {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (profile?.openaiKeyEnc) {
    try { return { key: decryptSecret(profile.openaiKeyEnc), source: 'own' }; } catch {}
  }

  const sharedKey = process.env.OPENAI_API_KEY;

  // Env-controlled override: when enabled, every user draws on the shared
  // server key without spending credits.
  if (process.env.OPENAI_SHARED_KEY_FOR_ALL === 'true') {
    if (!sharedKey) throw new Error('Shared OpenAI key is not configured on the server. Contact the administrator.');
    return { key: sharedKey, source: 'shared' };
  }

  const credits = Math.max(0, profile?.freeCredits ?? 0);
  if (credits > 0) {
    if (!sharedKey) throw new Error('Shared OpenAI key is not configured on the server. Contact the administrator.');
    return { key: sharedKey, source: 'free' };
  }

  // Credits exhausted — guide the user toward the two ways forward.
  const sub = await prisma.subscriptionRequest.findUnique({ where: { userId } });
  if (sub?.status === 'pending') {
    throw new Error('Your credits are used up and your request for more is pending admin approval. Add your own OpenAI key to keep generating in the meantime.');
  }
  throw new Error('You have used all your credits. Add your own OpenAI API key in Profile settings, or request more credits from the admin.');
}

/**
 * Atomically spend one credit: decrement the balance and bump lifetime usage.
 * Guarded so the balance never goes below zero, even under concurrent
 * generations. Returns the remaining credit count.
 */
export async function consumeFreeCredit(userId) {
  const res = await prisma.userProfile.updateMany({
    where: { userId, freeCredits: { gt: 0 } },
    data: { freeCredits: { decrement: 1 }, creditsUsed: { increment: 1 } },
  });
  if (res.count === 0) return 0;
  const updated = await prisma.userProfile.findUnique({
    where: { userId },
    select: { freeCredits: true },
  });
  return Math.max(0, updated?.freeCredits ?? 0);
}

/** Admin: set a user's remaining credit balance to an exact value. */
export async function setUserCredits(userId, credits) {
  const value = Math.max(0, Math.floor(Number(credits) || 0));
  await getOrCreateProfile(userId);
  await prisma.userProfile.update({ where: { userId }, data: { freeCredits: value } });
  return value;
}

/** Admin: add credits to a user's balance (e.g. on approving a request). */
export async function grantUserCredits(userId, amount) {
  const inc = Math.max(0, Math.floor(Number(amount) || 0));
  await getOrCreateProfile(userId);
  const updated = await prisma.userProfile.update({
    where: { userId },
    data: { freeCredits: { increment: inc } },
    select: { freeCredits: true },
  });
  return Math.max(0, updated.freeCredits);
}

export function validateProfileInput(body, { requirePassword = false, hasExistingPassword = false }) {
  const errors = [];
  const str = (v) => String(v ?? '').trim();

  if (!str(body.applicantName)) errors.push('Applicant name is required');
  if (!str(body.applicantHeadline)) errors.push('Applicant headline is required');
  if (!str(body.applicantSkills)) errors.push('Applicant skills are required');
  if (!str(body.applicantPhone)) errors.push('Applicant phone is required');
  if (!str(body.smtpHost)) errors.push('SMTP host is required');
  if (!body.smtpPort || Number(body.smtpPort) <= 0) errors.push('SMTP port is required');
  if (!str(body.smtpUser)) errors.push('SMTP user is required');
  if (!str(body.mailFromName)) errors.push('From name is required');
  if (!str(body.mailFromAddress)) errors.push('From address is required');

  const pass = normalizeSmtpPass(body.smtpPass);
  if (requirePassword && !pass && !hasExistingPassword) {
    errors.push('SMTP app password is required');
  }

  return errors;
}

export async function upsertProfile(userId, body) {
  const existing = await getOrCreateProfile(userId);
  const errors = validateProfileInput(body, {
    requirePassword: true,
    hasExistingPassword: Boolean(existing.smtpPassEnc),
  });
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }

  const pass = normalizeSmtpPass(body.smtpPass);
  let smtpPassEnc = existing.smtpPassEnc;
  if (pass) {
    smtpPassEnc = encryptSecret(pass);
  } else if (!existing.smtpPassEnc) {
    const err = new Error('SMTP app password is required');
    err.status = 400;
    throw err;
  }

  // Handle optional per-user OpenAI key
  let openaiKeyEnc = existing.openaiKeyEnc;
  if (body.clearOpenaiKey === true) {
    openaiKeyEnc = null;
  } else if (body.openaiKey?.trim()) {
    openaiKeyEnc = encryptSecret(body.openaiKey.trim());
  }

  const data = {
    applicantName: String(body.applicantName).trim(),
    applicantHeadline: String(body.applicantHeadline).trim(),
    applicantSkills: String(body.applicantSkills).trim(),
    applicantPhone: String(body.applicantPhone).trim(),
    smtpHost: String(body.smtpHost).trim(),
    smtpPort: Number(body.smtpPort),
    smtpSecure: Boolean(body.smtpSecure),
    smtpUser: String(body.smtpUser).trim(),
    smtpPassEnc,
    mailFromName: String(body.mailFromName).trim(),
    mailFromAddress: String(body.mailFromAddress).trim().toLowerCase(),
    openaiKeyEnc,
    linkedinUrl: String(body.linkedinUrl || '').trim(),
    theme:
      body.theme === 'dark'
        ? 'dark'
        : body.theme === 'light'
          ? 'light'
          : existing.theme || 'light',
  };

  return prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
