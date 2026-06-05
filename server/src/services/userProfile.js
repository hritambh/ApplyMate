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

/** Safe shape for API responses — never includes password. */
export function toPublicProfile(record) {
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
    complete: isProfileComplete(record),
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
    try {
      smtpPass = decryptSecret(record.smtpPassEnc);
    } catch {
      smtpPass = '';
    }
  }

  return {
    ...record,
    smtpPass,
    complete: isProfileComplete(record),
  };
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
  };

  return prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
