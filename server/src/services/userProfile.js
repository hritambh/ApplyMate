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
 * Resolves the OpenAI API key for a user:
 *   1. User's own key (stored encrypted in UserProfile)
 *   2. Server shared key — only if SU has approved the user's subscription request
 * Throws a descriptive error if neither is available.
 */
export async function resolveOpenAIKey(userId) {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (profile?.openaiKeyEnc) {
    try { return { key: decryptSecret(profile.openaiKeyEnc), source: 'own' }; } catch {}
  }

  const sub = await prisma.subscriptionRequest.findUnique({ where: { userId } });
  if (sub?.status === 'approved') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('Shared OpenAI key is not configured on the server. Contact the administrator.');
    return { key, source: 'shared' };
  }

  if (sub?.status === 'pending') {
    throw new Error('Your request for shared OpenAI access is pending approval. Add your own key or wait for the admin to approve.');
  }
  if (sub?.status === 'denied') {
    throw new Error('Your request for shared OpenAI access was denied. Please add your own OpenAI API key in Profile settings.');
  }

  throw new Error('No OpenAI key available. Add your own key in Profile settings or request shared access from the admin.');
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
  };

  return prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
