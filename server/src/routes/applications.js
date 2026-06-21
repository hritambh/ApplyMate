// import { Router } from 'express';
import express from 'express';
import { readDB, updateDB } from '../store.js';
import { generateCoverLetter, buildEmailFromCoverLetter } from '../services/coverLetter.js';
import { checkEmailExists } from '../services/emailValidate.js';
import { sendApplicationEmail } from '../services/mailer.js';
import { getProfileForUser, isProfileComplete, resolveOpenAIKey, consumeFreeCredit } from '../services/userProfile.js';
import { getResumeAttachment } from './resume.js';
import { groupKey } from '../utils/groupKey.js';
import { migrateApplications } from '../utils/migrateApplications.js';
import { prisma, logAudit } from '../db.js'; 
import { authenticate } from '../middleware/auth.js';
import {
  collectEmailJobs,
  countEmails,
  countEmailsByStatus,
  createEmailEntry,
  expandEntriesForPost,
  findEmailEntry,
  findRecipient,
  findRecipientByHrName,
  groupHasEmail,
  normalizeGroupRecipients,
  normalizeRecipient,
} from '../utils/recipientModel.js';
import { log } from '../utils/logger.js';
import { appendSendHistory } from '../utils/sendHistory.js';

const router = express.Router();
router.use(authenticate);
const CTX = 'applications';

const STATUS = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  SENT: 'sent',
  FAILED: 'failed',
};

const COVER_LETTER_TIMEOUT_MS = Number(process.env.COVER_LETTER_TIMEOUT_MS || 90000);

/** Prevent duplicate concurrent jobs when the client polls GET every few seconds. */
const inFlight = {
  coverLetters: new Set(),
  emailValidations: new Set(),
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function collectPendingWork(applications) {
  const groupsToGenerate = applications.filter(
    (g) => g.status !== STATUS.SENT && !g.coverLetter?.trim() && !g.error,
  );
  const emailJobs = [];
  for (const g of applications) {
    for (const r of g.recipients || []) {
      for (const e of r.emails || []) {
        if (e.emailValidation === 'checking') {
          emailJobs.push({
            groupId: g.id,
            recipientId: r.id,
            emailId: e.id,
            address: e.address,
          });
        }
      }
    }
  }
  return { groupsToGenerate, emailJobs };
}

function ensureBackgroundWork(userId, applications) {
  const { groupsToGenerate, emailJobs } = collectPendingWork(applications);
  const gen = groupsToGenerate.filter((g) => !inFlight.coverLetters.has(g.id));
  const emails = emailJobs.filter((j) => !inFlight.emailValidations.has(j.emailId));
  if (gen.length === 0 && emails.length === 0) return;
  log.info(CTX, 'Queueing background work', {
    coverLetters: gen.length,
    emailValidations: emails.length,
  });
  runBackgroundJobs(gen, emails, userId);
}

async function findOwnedEmail(userId, groupId, recipientId, emailId) {
  return prisma.emailEntry.findFirst({
    where: {
      id: emailId,
      recipientId,
      recipient: { groupId, group: { userId } },
    },
    include: { recipient: true },
  });
}

async function findOwnedEmailById(userId, emailId) {
  const email = await prisma.emailEntry.findFirst({
    where: {
      id: emailId,
      recipient: { group: { userId } },
    },
    include: {
      recipient: {
        include: {
          group: {
            include: { recipients: { include: { emails: true } } },
          },
        },
      },
    },
  });
  if (!email) return null;
  return {
    group: email.recipient.group,
    recipient: email.recipient,
    email,
  };
}

async function syncGroupStatusPrisma(groupId) {
  const group = await prisma.applicationGroup.findUnique({
    where: { id: groupId },
    include: { recipients: { include: { emails: true } } },
  });
  if (!group) return;

  let total = 0;
  let sent = 0;
  let failed = 0;
  for (const r of group.recipients) {
    for (const e of r.emails) {
      total++;
      if (e.status === STATUS.SENT) sent++;
      if (e.status === STATUS.FAILED) failed++;
    }
  }
  if (total === 0) return;

  let status = group.status;
  if (sent === total) status = STATUS.SENT;
  else if (failed > 0 && sent === 0 && group.status !== STATUS.REVIEWED) status = STATUS.FAILED;
  else if (group.status === STATUS.SENT && sent < total) status = STATUS.REVIEWED;

  await prisma.applicationGroup.update({
    where: { id: groupId },
    data: { status, updatedAt: new Date() },
  });
}

function needsMigration(applications) {
  return Array.isArray(applications) && applications.length > 0 && !applications[0].recipients;
}

function normalizeApplications(applications) {
  return applications.map(normalizeGroupRecipients);
}

function getApplications() {
  const { applications: raw } = readDB();
  let apps = raw;
  if (needsMigration(raw)) {
    log.info(CTX, 'Migrating legacy application records to grouped format');
    apps = migrateApplications(raw);
    persistApplications(apps);
  }
  return normalizeApplications(apps);
}

function persistApplications(applications) {
  updateDB((state) => {
    state.applications = applications;
    return state;
  });
}

function findGroup(applications, groupId) {
  return applications.find((g) => g.id === groupId);
}

function syncGroupStatus(group) {
  const total = countEmails(group);
  if (total === 0) return;
  const sent = countEmailsByStatus(group, STATUS.SENT);
  const failed = countEmailsByStatus(group, STATUS.FAILED);

  if (sent === total) {
    group.status = STATUS.SENT;
    return;
  }
  if (failed > 0 && sent === 0 && group.status !== STATUS.REVIEWED) {
    group.status = STATUS.FAILED;
    return;
  }
  if (group.status === STATUS.SENT && sent < total) {
    group.status = STATUS.REVIEWED;
  }
}

function resolveEmailPayload(group, recipient, profile) {
  if (group.body?.trim()) {
    return { subject: group.subject, body: group.body };
  }
  return buildEmailFromCoverLetter({
    hrName: recipient.hrName,
    company: group.company,
    role: group.role,
    coverLetter: group.coverLetter,
    profile,
  });
}

router.get('/', async (req, res) => {
  try {
    const applications = await prisma.applicationGroup.findMany({
      where: { userId: req.user.id },
      include: {
        recipients: {
          include: {
            emails: {
              include: { followUps: { orderBy: { sequence: 'asc' } } },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    ensureBackgroundWork(req.user.id, applications);
    res.json({ applications });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chronological timeline of every initial send and follow-up for the current user.
router.get('/history', async (req, res) => {
  try {
    const groups = await prisma.applicationGroup.findMany({
      where: { userId: req.user.id },
      include: {
        recipients: {
          include: {
            emails: {
              include: { followUps: { orderBy: { sequence: 'asc' } } },
            },
          },
        },
      },
    });

    const events = [];
    for (const group of groups) {
      for (const recipient of group.recipients) {
        for (const email of recipient.emails) {
          const base = {
            groupId: group.id,
            emailId: email.id,
            company: group.company,
            role: group.role,
            hrName: recipient.hrName,
            address: email.address,
          };

          if (email.status === STATUS.SENT && email.sentAt) {
            events.push({
              ...base,
              id: `init-${email.id}`,
              type: 'initial',
              status: STATUS.SENT,
              subject: group.subject,
              sentAt: email.sentAt,
              sequence: 0,
            });
          }

          for (const fu of email.followUps) {
            events.push({
              ...base,
              id: `fu-${fu.id}`,
              type: 'followup',
              status: fu.status,
              subject: fu.subject,
              sentAt: fu.sentAt || fu.createdAt,
              sequence: fu.sequence,
              error: fu.error,
            });
          }
        }
      }
    }

    events.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    res.json({ history: events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : req.body?.companies;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res
      .status(400)
      .json({ error: 'Request body must be an array of { company, role, hrName, email | emails }' });
  }

  const flat = expandEntriesForPost(entries);
  const invalid = flat.find((e) => !e?.company || !e?.role || !e?.email);
  if (invalid) {
    return res
      .status(400)
      .json({ error: 'Every entry needs company, role, and at least one email (hrName optional)' });
  }

  const touchedGroupIds = new Set();
  const newEmailChecks = [];

  for (const e of flat) {
    const company = e.company.trim();
    const role = e.role.trim();
    const hrName = (e.hrName || '').trim();
    const address = e.email.trim();

    let group = await prisma.applicationGroup.findUnique({
      where: {
        userId_company_role: { userId: req.user.id, company, role },
      },
      include: { recipients: { include: { emails: true } } },
    });

    if (!group) {
      group = await prisma.applicationGroup.create({
        data: {
          userId: req.user.id,
          company,
          role,
          coverLetter: '',
          subject: '',
          body: '',
          status: STATUS.PENDING,
        },
        include: { recipients: { include: { emails: true } } },
      });
      await logAudit(req.user.id, 'GROUP_CREATED', 'ApplicationGroup', group.id);
    }

    const duplicate = group.recipients.some((r) =>
      r.emails.some((em) => em.address.toLowerCase() === address.toLowerCase()),
    );
    if (duplicate) continue;

    let recipient = group.recipients.find((r) => r.hrName === hrName);
    if (!recipient) {
      recipient = await prisma.recipient.create({
        data: { groupId: group.id, hrName },
        include: { emails: true },
      });
      group.recipients.push(recipient);
    }

    const emailEntry = await prisma.emailEntry.create({
      data: {
        recipientId: recipient.id,
        address,
        emailValidation: 'checking',
        emailValidationMessage: 'Checking…',
      },
    });
    recipient.emails.push(emailEntry);

    touchedGroupIds.add(group.id);
    newEmailChecks.push({
      groupId: group.id,
      recipientId: recipient.id,
      emailId: emailEntry.id,
      address,
    });
  }

  const responseGroups =
    touchedGroupIds.size === 0
      ? []
      : await prisma.applicationGroup.findMany({
          where: { id: { in: [...touchedGroupIds] }, userId: req.user.id },
          include: { recipients: { include: { emails: true } } },
          orderBy: { updatedAt: 'desc' },
        });

  log.info(CTX, 'Companies added', {
    entries: entries.length,
    groupsTouched: touchedGroupIds.size,
    emailsAdded: newEmailChecks.length,
  });

  ensureBackgroundWork(req.user.id, responseGroups);

  res.status(201).json({
    applications: responseGroups,
    message:
      entries.length > responseGroups.reduce((n, g) => n + countEmails(g), 0)
        ? 'Some rows were merged into existing company groups (one cover letter per company + role).'
        : undefined,
  });
});

router.post('/send', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Body must include { ids: [...] } (email entry ids)' });
  }

  log.info(CTX, 'Bulk send requested', { emailCount: ids.length, userId: req.user.id });

  const attachment = await getResumeAttachment(req.user.id);
  if (!attachment) {
    log.warn(CTX, 'Send aborted — no resume on file');
    return res
      .status(400)
      .json({ error: 'No resume on file. Upload a resume before sending applications.' });
  }

  const profile = await getProfileForUser(req.user.id);
  if (!profile || !isProfileComplete(profile)) {
    return res.status(400).json({ error: 'Complete your profile before sending emails.' });
  }

  const results = [];

  for (const emailId of ids) {
    const found = await findOwnedEmailById(req.user.id, emailId);
    if (!found) {
      log.warn(CTX, 'Send skipped — email not found', { emailId });
      results.push({ id: emailId, ok: false, error: 'Not found' });
      continue;
    }

    const { group, recipient, email: emailEntry } = found;

    if (emailEntry.status === STATUS.SENT) {
      log.info(CTX, 'Send skipped — already sent', {
        emailId,
        to: emailEntry.address,
        company: group.company,
      });
      results.push({ id: emailId, ok: true, skipped: true });
      continue;
    }

    if (!group.coverLetter?.trim() && !group.body?.trim()) {
      log.warn(CTX, 'Send skipped — cover letter not ready', {
        emailId,
        groupId: group.id,
        company: group.company,
      });
      results.push({ id: emailId, ok: false, error: 'Cover letter not generated yet' });
      continue;
    }

    const { subject, body } = resolveEmailPayload(group, recipient, profile);

    log.info(CTX, 'Sending application email', {
      emailId,
      to: emailEntry.address,
      company: group.company,
      role: group.role,
      subject,
    });

    const result = await sendWithRetry({
      to: emailEntry.address,
      subject: subject || group.subject,
      body,
      attachment,
      profile,
    });

    const sentAt = result.ok ? new Date() : null;
    await prisma.emailEntry.update({
      where: { id: emailId },
      data: {
        status: result.ok ? STATUS.SENT : STATUS.FAILED,
        error: result.ok ? null : result.error,
        sentAt,
        messageId: result.ok ? (result.messageId || null) : undefined,
      },
    });
    await syncGroupStatusPrisma(group.id);

    results.push({ id: emailId, groupId: group.id, recipientId: recipient.id, ...result });

    if (result.ok && !result.skipped) {
      log.info(CTX, 'Email marked sent', { emailId, messageId: result.messageId });
      appendSendHistory({
        sentAt: sentAt?.toISOString() || new Date().toISOString(),
        company: group.company,
        role: group.role,
        hrName: recipient.hrName,
        email: emailEntry.address,
        subject: subject || group.subject,
        messageId: result.messageId,
        groupId: group.id,
        recipientId: recipient.id,
        emailId,
      });
    } else if (!result.ok) {
      log.error(CTX, 'Email send failed', { emailId, error: result.error });
    }
  }

  const sent = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  log.info(CTX, 'Bulk send finished', { sent, failed, skipped: results.length - sent - failed });

  res.json({ results });
});

router.post('/:id/regenerate', async (req, res) => {
  log.info(CTX, 'Regenerate cover letter requested', { groupId: req.params.id });
  try {
    const updated = await generateForGroup(req.params.id, req.user.id);
    if (!updated) return res.status(404).json({ error: 'Application not found' });
    res.json({ application: updated });
  } catch (err) {
    log.error(CTX, 'Regenerate failed', { groupId: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  const { coverLetter, subject, body, company, role, status, recipients } = req.body || {};

  try {
    const group = await prisma.applicationGroup.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { recipients: { include: { emails: true } } },
    });
    if (!group) return res.status(404).json({ error: 'Application not found' });

    // Build scalar field updates
    const groupData = {};
    if (coverLetter !== undefined) groupData.coverLetter = coverLetter;
    if (subject !== undefined) groupData.subject = subject;
    if (req.body.clearBody === true) groupData.body = '';
    else if (body !== undefined) groupData.body = body.trim();
    if (company !== undefined) groupData.company = company;
    if (role !== undefined) groupData.role = role;
    if (status !== undefined && Object.values(STATUS).includes(status)) groupData.status = status;
    groupData.updatedAt = new Date();

    await prisma.applicationGroup.update({ where: { id: group.id }, data: groupData });

    const revalidate = [];

    if (Array.isArray(recipients)) {
      for (const patch of recipients) {
        const r = group.recipients.find((x) => x.id === patch.id);
        if (!r) continue;

        if (patch.hrName !== undefined) {
          await prisma.recipient.update({ where: { id: r.id }, data: { hrName: patch.hrName } });
        }

        if (Array.isArray(patch.emails)) {
          // Update existing email addresses
          for (const ep of patch.emails) {
            if (!ep.id) continue;
            const existing = r.emails.find((x) => x.id === ep.id);
            if (!existing) continue;
            if (ep.address !== undefined && ep.address.trim() !== existing.address) {
              const addr = ep.address.trim();
              await prisma.emailEntry.update({
                where: { id: ep.id },
                data: { address: addr, emailValidation: 'checking', emailValidationMessage: 'Checking…' },
              });
              revalidate.push({ groupId: group.id, recipientId: r.id, emailId: ep.id, address: addr });
            }
          }
          // Add new email addresses (no id)
          for (const ep of patch.emails) {
            if (ep.id || !ep.address?.trim()) continue;
            const addr = ep.address.trim();
            if (r.emails.some((x) => x.address.toLowerCase() === addr.toLowerCase())) continue;
            const created = await prisma.emailEntry.create({
              data: { recipientId: r.id, address: addr, emailValidation: 'checking', emailValidationMessage: 'Checking…' },
            });
            revalidate.push({ groupId: group.id, recipientId: r.id, emailId: created.id, address: addr });
          }
        }
      }
    }

    if (revalidate.length) {
      log.info(CTX, 'Email(s) changed — revalidating', { groupId: group.id, count: revalidate.length });
      for (const job of revalidate) {
        void validateEmailEntry(job.groupId, job.recipientId, job.emailId, job.address);
      }
    }

    const updated = await prisma.applicationGroup.findUnique({
      where: { id: group.id },
      include: { recipients: { include: { emails: true } } },
    });

    log.info(CTX, 'Application updated', { groupId: group.id, company: group.company });
    res.json({ application: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/review', async (req, res) => {
  try {
    const group = await prisma.applicationGroup.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!group) return res.status(404).json({ error: 'Application not found' });
    if (group.status === STATUS.SENT) {
      return res.status(400).json({ error: 'Application already fully sent' });
    }

    const updated = await prisma.applicationGroup.update({
      where: { id: req.params.id },
      data: { status: STATUS.REVIEWED, updatedAt: new Date() },
      include: { recipients: { include: { emails: true } } },
    });

    log.info(CTX, 'Application marked reviewed', {
      groupId: updated.id,
      company: updated.company,
      recipients: updated.recipients.length,
    });
    res.json({ application: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const group = await prisma.applicationGroup.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!group) return res.status(404).json({ error: 'Application not found' });
    await prisma.applicationGroup.delete({ where: { id: req.params.id } });
    log.info(CTX, 'Application deleted', { groupId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  '/:groupId/recipients/:recipientId/emails/:emailId/validate-email',
  async (req, res) => {
    const email = await findOwnedEmail(
      req.user.id,
      req.params.groupId,
      req.params.recipientId,
      req.params.emailId,
    );
    if (!email) return res.status(404).json({ error: 'Email not found' });

    log.info(CTX, 'Manual email revalidation requested', {
      groupId: req.params.groupId,
      emailId: req.params.emailId,
      address: email.address,
    });

    try {
      const result = await validateEmailEntry(
        req.params.groupId,
        req.params.recipientId,
        req.params.emailId,
        email.address,
      );
      res.json({ email: result, recipient: email.recipient });
    } catch (err) {
      log.error(CTX, 'Manual email revalidation failed', {
        emailId: req.params.emailId,
        error: err.message,
      });
      res.status(500).json({ error: err.message });
    }
  },
);

router.post('/:groupId/recipients/:recipientId/validate-email', async (req, res) => {
  const recipient = await prisma.recipient.findFirst({
    where: {
      id: req.params.recipientId,
      groupId: req.params.groupId,
      group: { userId: req.user.id },
    },
    include: { emails: true },
  });
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

  const first = recipient.emails?.[0];
  if (!first) return res.status(404).json({ error: 'No email on recipient' });

  try {
    const result = await validateEmailEntry(
      req.params.groupId,
      req.params.recipientId,
      first.id,
      first.address,
    );
    res.json({ email: result, recipient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:groupId/recipients/:recipientId/emails/:emailId', async (req, res) => {
  try {
    const email = await findOwnedEmail(
      req.user.id,
      req.params.groupId,
      req.params.recipientId,
      req.params.emailId,
    );
    if (!email) return res.status(404).json({ error: 'Email not found' });

    await prisma.emailEntry.delete({ where: { id: req.params.emailId } });

    // If recipient now has no emails, delete it; if group has no recipients, delete it
    const remaining = await prisma.emailEntry.count({ where: { recipientId: req.params.recipientId } });
    if (remaining === 0) {
      await prisma.recipient.delete({ where: { id: req.params.recipientId } });
      const recipientsLeft = await prisma.recipient.count({ where: { groupId: req.params.groupId } });
      if (recipientsLeft === 0) {
        await prisma.applicationGroup.delete({ where: { id: req.params.groupId } });
      }
    }

    await syncGroupStatusPrisma(req.params.groupId).catch(() => {});
    log.info(CTX, 'Email removed', { emailId: req.params.emailId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:groupId/recipients/:recipientId', async (req, res) => {
  try {
    const recipient = await prisma.recipient.findFirst({
      where: {
        id: req.params.recipientId,
        groupId: req.params.groupId,
        group: { userId: req.user.id },
      },
    });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    await prisma.recipient.delete({ where: { id: req.params.recipientId } });

    // If group now has no recipients, delete it
    const recipientsLeft = await prisma.recipient.count({ where: { groupId: req.params.groupId } });
    if (recipientsLeft === 0) {
      await prisma.applicationGroup.delete({ where: { id: req.params.groupId } });
    } else {
      await syncGroupStatusPrisma(req.params.groupId);
    }

    log.info(CTX, 'Recipient removed', {
      groupId: req.params.groupId,
      recipientId: req.params.recipientId,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildFollowUpBody({ hrName, company, role, applicantName, daysSinceSent, sequence = 1 }) {
  const greeting = hrName ? `Hi ${hrName},` : 'Hi,';
  const when = daysSinceSent <= 1 ? 'recently' : `${daysSinceSent} days ago`;
  const opener =
    sequence > 1
      ? `I wanted to gently follow up once more on my application for the ${role} position at ${company}, which I originally sent ${when}.`
      : `I wanted to follow up on my application for the ${role} position at ${company} that I sent ${when}.`;
  return [
    greeting,
    '',
    opener,
    '',
    `I remain genuinely excited about this opportunity and would love to learn more. Please let me know if you need any additional information from my end.`,
    '',
    `Thank you for your time!`,
    '',
    `Best regards,`,
    applicantName || 'Applicant',
  ].join('\n');
}

router.post('/send-followups', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Body must include { ids: [...] } (email entry ids)' });
  }

  log.info(CTX, 'Follow-up send requested', { emailCount: ids.length, userId: req.user.id });

  const profile = await getProfileForUser(req.user.id);
  if (!profile || !isProfileComplete(profile)) {
    return res.status(400).json({ error: 'Complete your profile before sending follow-ups.' });
  }

  const results = [];

  for (const emailId of ids) {
    const found = await findOwnedEmailById(req.user.id, emailId);
    if (!found) {
      results.push({ id: emailId, ok: false, error: 'Not found' });
      continue;
    }

    const { group, recipient, email: emailEntry } = found;

    if (emailEntry.status !== STATUS.SENT) {
      results.push({ id: emailId, ok: false, error: 'Initial email not yet sent' });
      continue;
    }

    const daysSinceSent = emailEntry.sentAt
      ? Math.floor((Date.now() - new Date(emailEntry.sentAt).getTime()) / 86_400_000)
      : 0;

    // Each email can be followed up an unlimited number of times. Determine which
    // number this follow-up is, and thread the reply onto the most recent message
    // in the chain (last successful follow-up, falling back to the initial send).
    const priorFollowUps = await prisma.followUp.count({ where: { emailEntryId: emailId } });
    const sequence = priorFollowUps + 1;
    const inReplyTo = emailEntry.followUpMessageId || emailEntry.messageId || undefined;

    const body = buildFollowUpBody({
      hrName: recipient.hrName,
      company: group.company,
      role: group.role,
      applicantName: profile.applicantName || profile.mailFromName,
      daysSinceSent,
      sequence,
    });

    const subject = `Re: ${group.subject || `Application for ${group.role} — ${profile.applicantName || profile.mailFromName}`}`;

    log.info(CTX, 'Sending follow-up email', {
      emailId,
      sequence,
      to: emailEntry.address,
      company: group.company,
      role: group.role,
      inReplyTo,
    });

    const result = await sendWithRetry({
      to: emailEntry.address,
      subject,
      body,
      attachment: null,
      profile,
      inReplyTo,
    });

    const followUpSentAt = result.ok ? new Date() : null;

    // Record this individual follow-up attempt in its own history row.
    await prisma.followUp.create({
      data: {
        emailEntryId: emailId,
        sequence,
        status: result.ok ? STATUS.SENT : STATUS.FAILED,
        subject,
        sentAt: followUpSentAt,
        messageId: result.ok ? (result.messageId || null) : null,
        inReplyTo: inReplyTo || null,
        error: result.ok ? null : result.error,
      },
    });

    // Keep the summary fields on the email pointed at the latest follow-up. On a
    // successful send we advance followUpMessageId so the next reply threads onto it.
    await prisma.emailEntry.update({
      where: { id: emailId },
      data: {
        followUpStatus: result.ok ? STATUS.SENT : STATUS.FAILED,
        followUpSentAt: result.ok ? followUpSentAt : emailEntry.followUpSentAt,
        followUpMessageId: result.ok ? (result.messageId || emailEntry.followUpMessageId) : emailEntry.followUpMessageId,
        followUpError: result.ok ? null : result.error,
      },
    });

    results.push({ id: emailId, groupId: group.id, recipientId: recipient.id, sequence, ...result });

    if (result.ok) {
      log.info(CTX, 'Follow-up email sent', { emailId, messageId: result.messageId });
      appendSendHistory({
        sentAt: followUpSentAt?.toISOString() || new Date().toISOString(),
        company: group.company,
        role: group.role,
        hrName: recipient.hrName,
        email: emailEntry.address,
        subject,
        messageId: result.messageId,
        groupId: group.id,
        recipientId: recipient.id,
        emailId,
        isFollowUp: true,
        sequence,
      });
    } else {
      log.error(CTX, 'Follow-up send failed', { emailId, error: result.error });
    }
  }

  const sent = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  log.info(CTX, 'Follow-up send finished', { sent, failed });

  res.json({ results });
});

async function sendWithRetry({ to, subject, body, attachment, profile, inReplyTo }, attempts = 3) {
  let lastError = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const info = await sendApplicationEmail({ to, subject, body, attachment, profile, inReplyTo });
      return { ok: true, messageId: info.messageId, attempts: i };
    } catch (err) {
      lastError = err;
      log.warn(CTX, `SMTP send attempt ${i}/${attempts} failed`, { to, error: err.message });
      if (i < attempts) await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  log.error(CTX, 'SMTP send exhausted retries', { to, attempts, error: lastError?.message });
  return { ok: false, error: lastError?.message || 'Unknown send error', attempts };
}

function runBackgroundJobs(groupsToGenerate, emailJobs, userId) {
  for (const g of groupsToGenerate) inFlight.coverLetters.add(g.id);
  for (const j of emailJobs) inFlight.emailValidations.add(j.emailId);

  log.info(CTX, 'Background jobs started', {
    coverLetterJobs: groupsToGenerate.length,
    emailValidationJobs: emailJobs.length,
  });

  void Promise.all([
    (async () => {
      for (const group of groupsToGenerate) {
        try {
          await generateForGroup(group.id, group.userId || userId);
        } catch (err) {
          log.error(CTX, 'Cover letter generation failed', {
            groupId: group.id,
            company: group.company,
            role: group.role,
            error: err.message,
          });
          await setGroupError(group.id, `Generation failed: ${err.message}`);
        } finally {
          inFlight.coverLetters.delete(group.id);
        }
      }
      log.info(CTX, 'Cover letter background jobs finished', {
        count: groupsToGenerate.length,
      });
    })(),
    (async () => {
      await Promise.all(
        emailJobs.map(async ({ groupId, recipientId, emailId, address }) => {
          try {
            await validateEmailEntry(groupId, recipientId, emailId, address);
          } catch (err) {
            log.error(CTX, 'Email validation job failed', {
              groupId,
              recipientId,
              emailId,
              address,
              error: err.message,
            });
            await setEmailValidation(
              groupId,
              recipientId,
              emailId,
              'unknown',
              err.message || 'Validation failed',
            );
          } finally {
            inFlight.emailValidations.delete(emailId);
          }
        }),
      );
      log.info(CTX, 'Email validation background jobs finished', { count: emailJobs.length });
    })(),
  ]).then(() => log.info(CTX, 'All background jobs completed'));
}

async function setEmailValidation(groupId, recipientId, emailId, status, message) {
  try {
    await prisma.emailEntry.update({
      where: { id: emailId },
      data: { emailValidation: status, emailValidationMessage: message },
    });
    await prisma.applicationGroup.update({
      where: { id: groupId },
      data: { updatedAt: new Date() },
    });
  } catch (err) {
    log.warn(CTX, 'setEmailValidation failed', {
      groupId,
      emailId,
      error: err.message,
    });
  }
}

async function validateEmailEntry(groupId, recipientId, emailId, address) {
  log.info(CTX, 'Validating email', { groupId, recipientId, emailId, address });
  await setEmailValidation(groupId, recipientId, emailId, 'checking', 'Checking…');
  const { status, message } = await checkEmailExists(address);
  await setEmailValidation(groupId, recipientId, emailId, status, message);
  log.info(CTX, 'Email validation done', { groupId, emailId, address, status, message });

  return prisma.emailEntry.findUnique({ where: { id: emailId } });
}

async function setGroupError(groupId, message) {
  try {
    await prisma.applicationGroup.update({
      where: { id: groupId },
      data: { error: message, updatedAt: new Date() },
    });
  } catch (err) {
    log.warn(CTX, 'setGroupError failed', { groupId, error: err.message });
  }
}

async function generateForGroup(groupId, userId) {
  const group = await prisma.applicationGroup.findFirst({
    where: userId ? { id: groupId, userId } : { id: groupId },
    include: { recipients: { include: { emails: true } } },
  });
  if (!group) {
    log.warn(CTX, 'generateForGroup — group not found', { groupId });
    return null;
  }

  const profile = await getProfileForUser(userId);
  if (!profile) {
    await setGroupError(groupId, 'Complete your profile before generating cover letters.');
    throw new Error('User profile not found');
  }

  const { company, role } = group;
  const hrName = group.recipients[0]?.hrName || '';

  log.info(CTX, 'Generating cover letter for group', {
    groupId,
    company,
    role,
    recipients: group.recipients.length,
  });

  const { key: openaiKey, source: openaiSource } = await resolveOpenAIKey(userId);

  const coverLetter = await withTimeout(
    generateCoverLetter({ company, role, profile, openaiKey }),
    COVER_LETTER_TIMEOUT_MS,
    'Cover letter generation',
  );

  // Freemium: a successful generation on the shared free tier costs one credit.
  if (openaiSource === 'free') {
    const remaining = await consumeFreeCredit(userId);
    log.info(CTX, 'Free credit consumed', { userId, groupId, remaining });
  }
  const { subject } = buildEmailFromCoverLetter({
    hrName,
    company,
    role,
    coverLetter,
    profile,
  });

  // Regenerating a cover letter means the user is reworking this application,
  // so clear stale send failures (e.g. SMTP login errors) on its emails and
  // return them to pending. Already-sent emails are left untouched.
  await prisma.emailEntry.updateMany({
    where: { recipient: { groupId }, status: STATUS.FAILED },
    data: { status: STATUS.PENDING, error: null },
  });

  const updated = await prisma.applicationGroup.update({
    where: { id: groupId },
    data: {
      coverLetter,
      subject,
      body: '',
      error: null,
      status: group.status === STATUS.FAILED ? STATUS.PENDING : group.status,
      updatedAt: new Date(),
    },
    include: { recipients: { include: { emails: true } } },
  });

  log.info(CTX, 'Cover letter saved for group', { groupId, company, role });
  return updated;
}

export default router;
