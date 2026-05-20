import { Router } from 'express';
import { nanoid } from 'nanoid';
import { readDB, updateDB } from '../store.js';
import { generateCoverLetter, buildEmailFromCoverLetter } from '../services/coverLetter.js';
import { checkEmailExists } from '../services/emailValidate.js';
import { sendApplicationEmail } from '../services/mailer.js';
import { getResumeAttachment } from './resume.js';
import { groupKey } from '../utils/groupKey.js';
import { migrateApplications } from '../utils/migrateApplications.js';
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

const router = Router();
const CTX = 'applications';

const STATUS = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  SENT: 'sent',
  FAILED: 'failed',
};

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

function resolveEmailPayload(group, recipient) {
  if (group.body?.trim()) {
    return { subject: group.subject, body: group.body };
  }
  return buildEmailFromCoverLetter({
    hrName: recipient.hrName,
    company: group.company,
    role: group.role,
    coverLetter: group.coverLetter,
  });
}

router.get('/', (_req, res) => {
  res.json({ applications: getApplications() });
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

  let applications = getApplications();
  const touchedGroupIds = new Set();
  const newEmailChecks = [];

  for (const e of flat) {
    const company = e.company;
    const role = e.role;
    const key = groupKey(company, role);
    const hrName = e.hrName;
    const address = e.email;

    let group = applications.find((g) => groupKey(g.company, g.role) === key);

    if (!group) {
      group = {
        id: nanoid(10),
        company,
        role,
        coverLetter: '',
        subject: '',
        body: '',
        status: STATUS.PENDING,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recipients: [],
      };
      applications.unshift(group);
      touchedGroupIds.add(group.id);
    }

    if (groupHasEmail(group, address)) continue;

    let recipient = findRecipientByHrName(group, hrName);
    if (!recipient) {
      recipient = { id: nanoid(8), hrName, emails: [] };
      group.recipients.push(recipient);
    }

    const emailEntry = createEmailEntry(address);
    recipient.emails.push(emailEntry);
    group.updatedAt = new Date().toISOString();
    touchedGroupIds.add(group.id);
    newEmailChecks.push({
      groupId: group.id,
      recipientId: recipient.id,
      emailId: emailEntry.id,
      address,
    });
  }

  persistApplications(applications);

  const newGroupsNeedingGeneration = [...touchedGroupIds]
    .map((id) => applications.find((g) => g.id === id))
    .filter((g) => g && !g.coverLetter);

  log.info(CTX, 'Companies added — starting background jobs', {
    entries: entries.length,
    groupsTouched: touchedGroupIds.size,
    coverLettersToGenerate: newGroupsNeedingGeneration.length,
    emailsToValidate: newEmailChecks.length,
  });

  runBackgroundJobs(newGroupsNeedingGeneration, newEmailChecks);

  const responseGroups = [...touchedGroupIds]
    .map((id) => getApplications().find((g) => g.id === id))
    .filter(Boolean);

  res.status(201).json({
    applications: responseGroups,
    message:
      entries.length > responseGroups.reduce((n, g) => n + g.recipients.length, 0)
        ? 'Some rows were merged into existing company groups (one cover letter per company + role).'
        : undefined,
  });
});

router.post('/send', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Body must include { ids: [...] } (email entry ids)' });
  }

  log.info(CTX, 'Bulk send requested', { emailCount: ids.length });

  const attachment = getResumeAttachment();
  if (!attachment) {
    log.warn(CTX, 'Send aborted — no resume on file');
    return res
      .status(400)
      .json({ error: 'No resume on file. Upload a resume before sending applications.' });
  }

  const results = [];

  for (const emailId of ids) {
    let applications = getApplications();
    const found = findEmailEntry(applications, emailId);
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

    if (!group.coverLetter && !group.body) {
      log.warn(CTX, 'Send skipped — cover letter not ready', {
        emailId,
        groupId: group.id,
        company: group.company,
      });
      results.push({ id: emailId, ok: false, error: 'Cover letter not generated yet' });
      continue;
    }

    const { subject, body } = resolveEmailPayload(group, recipient);

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
    });

    applications = getApplications();
    const fresh = findEmailEntry(applications, emailId);
    if (fresh) {
      if (result.ok) {
        fresh.email.status = STATUS.SENT;
        fresh.email.error = null;
        fresh.email.sentAt = new Date().toISOString();
      } else {
        fresh.email.status = STATUS.FAILED;
        fresh.email.error = result.error;
      }
      fresh.group.updatedAt = new Date().toISOString();
      syncGroupStatus(fresh.group);
      persistApplications(applications);
    }

    results.push({ id: emailId, groupId: group.id, recipientId: recipient.id, ...result });

    if (result.ok && !result.skipped) {
      log.info(CTX, 'Email marked sent', { emailId, messageId: result.messageId });
      appendSendHistory({
        sentAt: fresh?.email.sentAt || new Date().toISOString(),
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
    const updated = await generateForGroup(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Application not found' });
    res.json({ application: updated });
  } catch (err) {
    log.error(CTX, 'Regenerate failed', { groupId: req.params.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  const { coverLetter, subject, body, company, role, status } = req.body || {};
  const { recipients } = req.body || {};

  let updated = null;
  const applications = getApplications();
  const group = findGroup(applications, req.params.id);
  if (!group) return res.status(404).json({ error: 'Application not found' });

  if (coverLetter !== undefined) group.coverLetter = coverLetter;
  if (subject !== undefined) group.subject = subject;
  if (req.body.clearBody === true) {
    group.body = '';
  } else if (body !== undefined) {
    group.body = body.trim();
  }
  if (company !== undefined) group.company = company;
  if (role !== undefined) group.role = role;
  if (status !== undefined && Object.values(STATUS).includes(status)) group.status = status;

  const revalidate = [];

  if (Array.isArray(recipients)) {
    for (const patch of recipients) {
      const r = group.recipients.find((x) => x.id === patch.id);
      if (!r) continue;
      normalizeRecipient(r);
      if (patch.hrName !== undefined) r.hrName = patch.hrName;

      if (Array.isArray(patch.emails)) {
        for (const ep of patch.emails) {
          const existing = (r.emails || []).find((x) => x.id === ep.id);
          if (!existing) continue;
          if (ep.address !== undefined && ep.address !== existing.address) {
            existing.address = ep.address.trim();
            existing.emailValidation = 'checking';
            existing.emailValidationMessage = 'Checking…';
            revalidate.push({
              groupId: group.id,
              recipientId: r.id,
              emailId: existing.id,
              address: existing.address,
            });
          }
        }
        for (const ep of patch.emails) {
          if (ep.id || !ep.address?.trim()) continue;
          const addr = ep.address.trim();
          if ((r.emails || []).some((x) => x.address.toLowerCase() === addr.toLowerCase())) continue;
          const created = createEmailEntry(addr);
          r.emails.push(created);
          revalidate.push({
            groupId: group.id,
            recipientId: r.id,
            emailId: created.id,
            address: addr,
          });
        }
      }
    }
  }

  group.updatedAt = new Date().toISOString();
  updated = group;
  persistApplications(applications);

  if (revalidate.length) {
    log.info(CTX, 'Recipient email changed — revalidating', {
      groupId: group.id,
      count: revalidate.length,
    });
    for (const job of revalidate) {
      void validateEmailEntry(job.groupId, job.recipientId, job.emailId, job.address);
    }
  }

  log.info(CTX, 'Application updated', { groupId: group.id, company: group.company });
  res.json({ application: updated });
});

router.post('/:id/review', (req, res) => {
  const applications = getApplications();
  const group = findGroup(applications, req.params.id);
  if (!group) return res.status(404).json({ error: 'Application not found' });
  if (group.status === STATUS.SENT) {
    return res.status(404).json({ error: 'Application already fully sent' });
  }

  group.status = STATUS.REVIEWED;
  group.updatedAt = new Date().toISOString();
  persistApplications(applications);
  log.info(CTX, 'Application marked reviewed', {
    groupId: group.id,
    company: group.company,
    recipients: group.recipients.length,
  });
  res.json({ application: group });
});

router.delete('/:id', (req, res) => {
  let applications = getApplications();
  const before = applications.length;
  applications = applications.filter((g) => g.id !== req.params.id);
  if (applications.length === before) {
    return res.status(404).json({ error: 'Application not found' });
  }
  persistApplications(applications);
  log.info(CTX, 'Application deleted', { groupId: req.params.id });
  res.json({ ok: true });
});

router.post(
  '/:groupId/recipients/:recipientId/emails/:emailId/validate-email',
  async (req, res) => {
    const applications = getApplications();
    const found = findEmailEntry(applications, req.params.emailId);
    if (!found || found.group.id !== req.params.groupId) {
      return res.status(404).json({ error: 'Email not found' });
    }

    log.info(CTX, 'Manual email revalidation requested', {
      groupId: req.params.groupId,
      emailId: req.params.emailId,
      address: found.email.address,
    });

    try {
      const result = await validateEmailEntry(
        req.params.groupId,
        req.params.recipientId,
        req.params.emailId,
        found.email.address,
      );
      res.json({ email: result, recipient: found.recipient });
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
  const applications = getApplications();
  const found = findRecipient(applications, req.params.recipientId);
  if (!found || found.group.id !== req.params.groupId) {
    return res.status(404).json({ error: 'Recipient not found' });
  }
  normalizeRecipient(found.recipient);
  const first = found.recipient.emails?.[0];
  if (!first) return res.status(404).json({ error: 'No email on recipient' });

  try {
    const result = await validateEmailEntry(
      req.params.groupId,
      req.params.recipientId,
      first.id,
      first.address,
    );
    res.json({ email: result, recipient: found.recipient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:groupId/recipients/:recipientId/emails/:emailId', (req, res) => {
  const applications = getApplications();
  const group = findGroup(applications, req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Application not found' });

  const recipient = group.recipients.find((r) => r.id === req.params.recipientId);
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

  const before = recipient.emails?.length || 0;
  recipient.emails = (recipient.emails || []).filter((e) => e.id !== req.params.emailId);
  if (recipient.emails.length === before) {
    return res.status(404).json({ error: 'Email not found' });
  }

  if (recipient.emails.length === 0) {
    group.recipients = group.recipients.filter((r) => r.id !== recipient.id);
  }

  if (group.recipients.length === 0) {
    persistApplications(applications.filter((g) => g.id !== group.id));
  } else {
    syncGroupStatus(group);
    group.updatedAt = new Date().toISOString();
    persistApplications(applications);
  }
  log.info(CTX, 'Email removed', { emailId: req.params.emailId });
  res.json({ ok: true });
});

router.delete('/:groupId/recipients/:recipientId', (req, res) => {
  const applications = getApplications();
  const group = findGroup(applications, req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Application not found' });

  const before = group.recipients.length;
  group.recipients = group.recipients.filter((r) => r.id !== req.params.recipientId);
  if (group.recipients.length === before) {
    return res.status(404).json({ error: 'Recipient not found' });
  }

  if (group.recipients.length === 0) {
    const filtered = applications.filter((g) => g.id !== group.id);
    persistApplications(filtered);
  } else {
    syncGroupStatus(group);
    group.updatedAt = new Date().toISOString();
    persistApplications(applications);
  }
  log.info(CTX, 'Recipient removed', {
    groupId: req.params.groupId,
    recipientId: req.params.recipientId,
  });
  res.json({ ok: true });
});

async function sendWithRetry({ to, subject, body, attachment }, attempts = 3) {
  let lastError = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const info = await sendApplicationEmail({ to, subject, body, attachment });
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

function runBackgroundJobs(groupsToGenerate, emailJobs) {
  log.info(CTX, 'Background jobs started', {
    coverLetterJobs: groupsToGenerate.length,
    emailValidationJobs: emailJobs.length,
  });

  void Promise.all([
    (async () => {
      for (const group of groupsToGenerate) {
        try {
          await generateForGroup(group.id);
        } catch (err) {
          log.error(CTX, 'Cover letter generation failed', {
            groupId: group.id,
            company: group.company,
            role: group.role,
            error: err.message,
          });
          setGroupError(group.id, `Generation failed: ${err.message}`);
        }
      }
      log.info(CTX, 'Cover letter background jobs finished', {
        count: groupsToGenerate.length,
      });
    })(),
    (async () => {
      await Promise.all(
        emailJobs.map(({ groupId, recipientId, emailId, address }) =>
          validateEmailEntry(groupId, recipientId, emailId, address).catch((err) => {
            log.error(CTX, 'Email validation job failed', {
              groupId,
              recipientId,
              emailId,
              address,
              error: err.message,
            });
            setEmailValidation(groupId, recipientId, emailId, 'unknown', err.message || 'Validation failed');
          }),
        ),
      );
      log.info(CTX, 'Email validation background jobs finished', { count: emailJobs.length });
    })(),
  ]).then(() => log.info(CTX, 'All background jobs completed'));
}

function setEmailValidation(groupId, recipientId, emailId, status, message) {
  updateDB((state) => {
    const apps = normalizeApplications(
      needsMigration(state.applications)
        ? migrateApplications(state.applications)
        : state.applications,
    );
    const g = apps.find((x) => x.id === groupId);
    const r = g?.recipients?.find((x) => x.id === recipientId);
    const e = r?.emails?.find((x) => x.id === emailId);
    if (!e) return state;
    e.emailValidation = status;
    e.emailValidationMessage = message;
    g.updatedAt = new Date().toISOString();
    state.applications = apps;
    return state;
  });
}

async function validateEmailEntry(groupId, recipientId, emailId, address) {
  log.info(CTX, 'Validating email', { groupId, recipientId, emailId, address });
  setEmailValidation(groupId, recipientId, emailId, 'checking', 'Checking…');
  const { status, message } = await checkEmailExists(address);
  setEmailValidation(groupId, recipientId, emailId, status, message);
  log.info(CTX, 'Email validation done', { groupId, emailId, address, status, message });

  const apps = getApplications();
  const found = findEmailEntry(apps, emailId);
  return found?.email ?? null;
}

function setGroupError(groupId, message) {
  updateDB((state) => {
    const apps = needsMigration(state.applications)
      ? migrateApplications(state.applications)
      : state.applications;
    const g = apps.find((x) => x.id === groupId);
    if (!g) return state;
    g.error = message;
    g.updatedAt = new Date().toISOString();
    state.applications = apps;
    return state;
  });
}

async function generateForGroup(groupId) {
  const applications = getApplications();
  const group = findGroup(applications, groupId);
  if (!group) {
    log.warn(CTX, 'generateForGroup — group not found', { groupId });
    return null;
  }

  const { company, role } = group;
  const hrName = group.recipients[0]?.hrName || '';

  log.info(CTX, 'Generating cover letter for group', {
    groupId,
    company,
    role,
    recipients: group.recipients.length,
  });

  const coverLetter = await generateCoverLetter({ company, role });
  const { subject } = buildEmailFromCoverLetter({
    hrName,
    company,
    role,
    coverLetter,
  });

  let updated = null;
  updateDB((state) => {
    const apps = needsMigration(state.applications)
      ? migrateApplications(state.applications)
      : state.applications;
    const g = apps.find((x) => x.id === groupId);
    if (!g) return state;
    g.coverLetter = coverLetter;
    g.subject = subject;
    g.body = '';
    g.error = null;
    if (g.status === STATUS.FAILED) g.status = STATUS.PENDING;
    g.updatedAt = new Date().toISOString();
    state.applications = apps;
    updated = g;
    return state;
  });

  log.info(CTX, 'Cover letter saved for group', { groupId, company, role });
  return updated;
}

export default router;
