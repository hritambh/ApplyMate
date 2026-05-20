import { Router } from 'express';
import { nanoid } from 'nanoid';
import { readDB, updateDB } from '../store.js';
import { generateCoverLetter, buildEmailFromCoverLetter } from '../services/coverLetter.js';
import { checkEmailExists } from '../services/emailValidate.js';
import { sendApplicationEmail } from '../services/mailer.js';
import { getResumeAttachment } from './resume.js';
import { groupKey } from '../utils/groupKey.js';
import { migrateApplications } from '../utils/migrateApplications.js';
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
  for (const g of applications) {
    for (const r of g.recipients || []) {
      if (!r.emailValidation) {
        r.emailValidation = 'unknown';
        r.emailValidationMessage = r.emailValidationMessage || '';
      }
    }
  }
  return applications;
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

function findRecipient(applications, recipientId) {
  for (const g of applications) {
    const r = g.recipients.find((x) => x.id === recipientId);
    if (r) return { group: g, recipient: r };
  }
  return null;
}

function syncGroupStatus(group) {
  const rs = group.recipients;
  if (rs.length === 0) return;
  const allSent = rs.every((r) => r.status === STATUS.SENT);
  const anyFailed = rs.some((r) => r.status === STATUS.FAILED);
  const anySent = rs.some((r) => r.status === STATUS.SENT);

  if (allSent) {
    group.status = STATUS.SENT;
    return;
  }
  if (anyFailed && !anySent && group.status !== STATUS.REVIEWED) {
    group.status = STATUS.FAILED;
    return;
  }
  if (group.status === STATUS.SENT && !allSent) {
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
      .json({ error: 'Request body must be an array of { company, role, hrName, email }' });
  }

  const invalid = entries.find(
    (e) => !e?.company || !e?.role || !e?.email || typeof e.email !== 'string',
  );
  if (invalid) {
    return res
      .status(400)
      .json({ error: 'Every entry needs company, role, and email (hrName optional)' });
  }

  let applications = getApplications();
  const touchedGroupIds = new Set();
  const createdGroups = [];
  const newRecipientChecks = [];

  for (const e of entries) {
    const company = String(e.company).trim();
    const role = String(e.role).trim();
    const key = groupKey(company, role);
    const hrName = e.hrName ? String(e.hrName).trim() : '';
    const email = String(e.email).trim();

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
      createdGroups.push(group);
      touchedGroupIds.add(group.id);
    }

    const duplicate = group.recipients.some(
      (r) => r.email.toLowerCase() === email.toLowerCase(),
    );
    if (!duplicate) {
      const recipientId = nanoid(8);
      group.recipients.push({
        id: recipientId,
        hrName,
        email,
        status: STATUS.PENDING,
        error: null,
        sentAt: null,
        emailValidation: 'checking',
        emailValidationMessage: 'Checking…',
      });
      group.updatedAt = new Date().toISOString();
      touchedGroupIds.add(group.id);
      newRecipientChecks.push({ groupId: group.id, recipientId, email });
    }
  }

  persistApplications(applications);

  const newGroupsNeedingGeneration = [...touchedGroupIds]
    .map((id) => applications.find((g) => g.id === id))
    .filter((g) => g && !g.coverLetter);

  log.info(CTX, 'Companies added — starting background jobs', {
    entries: entries.length,
    groupsTouched: touchedGroupIds.size,
    coverLettersToGenerate: newGroupsNeedingGeneration.length,
    emailsToValidate: newRecipientChecks.length,
  });

  runBackgroundJobs(newGroupsNeedingGeneration, newRecipientChecks);

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
    return res.status(400).json({ error: 'Body must include { ids: [...] } (recipient ids)' });
  }

  log.info(CTX, 'Bulk send requested', { recipientCount: ids.length });

  const attachment = getResumeAttachment();
  if (!attachment) {
    log.warn(CTX, 'Send aborted — no resume on file');
    return res
      .status(400)
      .json({ error: 'No resume on file. Upload a resume before sending applications.' });
  }

  const results = [];

  for (const recipientId of ids) {
    let applications = getApplications();
    const found = findRecipient(applications, recipientId);
    if (!found) {
      log.warn(CTX, 'Send skipped — recipient not found', { recipientId });
      results.push({ id: recipientId, ok: false, error: 'Not found' });
      continue;
    }

    const { group, recipient } = found;

    if (recipient.status === STATUS.SENT) {
      log.info(CTX, 'Send skipped — already sent', {
        recipientId,
        email: recipient.email,
        company: group.company,
      });
      results.push({ id: recipientId, ok: true, skipped: true });
      continue;
    }

    if (!group.coverLetter && !group.body) {
      log.warn(CTX, 'Send skipped — cover letter not ready', {
        recipientId,
        groupId: group.id,
        company: group.company,
      });
      results.push({ id: recipientId, ok: false, error: 'Cover letter not generated yet' });
      continue;
    }

    const { subject, body } = resolveEmailPayload(group, recipient);

    log.info(CTX, 'Sending application email', {
      recipientId,
      to: recipient.email,
      company: group.company,
      role: group.role,
      subject,
    });

    const result = await sendWithRetry({
      to: recipient.email,
      subject: subject || group.subject,
      body,
      attachment,
    });

    applications = getApplications();
    const fresh = findRecipient(applications, recipientId);
    if (fresh) {
      if (result.ok) {
        fresh.recipient.status = STATUS.SENT;
        fresh.recipient.error = null;
        fresh.recipient.sentAt = new Date().toISOString();
      } else {
        fresh.recipient.status = STATUS.FAILED;
        fresh.recipient.error = result.error;
      }
      fresh.group.updatedAt = new Date().toISOString();
      syncGroupStatus(fresh.group);
      persistApplications(applications);
    }

    results.push({ id: recipientId, groupId: group.id, ...result });

    if (result.ok && !result.skipped) {
      log.info(CTX, 'Recipient marked sent', { recipientId, messageId: result.messageId });
      appendSendHistory({
        sentAt: fresh?.recipient.sentAt || new Date().toISOString(),
        company: group.company,
        role: group.role,
        hrName: recipient.hrName,
        email: recipient.email,
        subject: subject || group.subject,
        messageId: result.messageId,
        groupId: group.id,
        recipientId,
      });
    } else if (!result.ok) {
      log.error(CTX, 'Recipient send failed', { recipientId, error: result.error });
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
      if (patch.hrName !== undefined) r.hrName = patch.hrName;
      if (patch.email !== undefined && patch.email !== r.email) {
        r.email = patch.email;
        r.emailValidation = 'checking';
        r.emailValidationMessage = 'Checking…';
        revalidate.push({ groupId: group.id, recipientId: r.id, email: r.email });
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
      void validateRecipientEmail(job.groupId, job.recipientId, job.email);
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

router.post('/:groupId/recipients/:recipientId/validate-email', async (req, res) => {
  const applications = getApplications();
  const group = findGroup(applications, req.params.groupId);
  if (!group) return res.status(404).json({ error: 'Application not found' });

  const recipient = group.recipients.find((r) => r.id === req.params.recipientId);
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

  log.info(CTX, 'Manual email revalidation requested', {
    groupId: req.params.groupId,
    recipientId: req.params.recipientId,
    email: recipient.email,
  });

  setRecipientEmailValidation(req.params.groupId, req.params.recipientId, 'checking', 'Checking…');

  try {
    const result = await validateRecipientEmail(
      req.params.groupId,
      req.params.recipientId,
      recipient.email,
    );
    res.json({ recipient: result });
  } catch (err) {
    log.error(CTX, 'Manual email revalidation failed', {
      recipientId: req.params.recipientId,
      error: err.message,
    });
    res.status(500).json({ error: err.message });
  }
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

function runBackgroundJobs(groupsToGenerate, recipientsToValidate) {
  log.info(CTX, 'Background jobs started', {
    coverLetterJobs: groupsToGenerate.length,
    emailValidationJobs: recipientsToValidate.length,
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
        recipientsToValidate.map(({ groupId, recipientId, email }) =>
          validateRecipientEmail(groupId, recipientId, email).catch((err) => {
            log.error(CTX, 'Email validation job failed', {
              groupId,
              recipientId,
              email,
              error: err.message,
            });
            setRecipientEmailValidation(
              groupId,
              recipientId,
              'unknown',
              err.message || 'Validation failed',
            );
          }),
        ),
      );
      log.info(CTX, 'Email validation background jobs finished', {
        count: recipientsToValidate.length,
      });
    })(),
  ]).then(() => log.info(CTX, 'All background jobs completed'));
}

function setRecipientEmailValidation(groupId, recipientId, status, message) {
  updateDB((state) => {
    const apps = needsMigration(state.applications)
      ? migrateApplications(state.applications)
      : state.applications;
    const g = apps.find((x) => x.id === groupId);
    const r = g?.recipients?.find((x) => x.id === recipientId);
    if (!r) return state;
    r.emailValidation = status;
    r.emailValidationMessage = message;
    g.updatedAt = new Date().toISOString();
    state.applications = normalizeApplications(apps);
    return state;
  });
}

async function validateRecipientEmail(groupId, recipientId, email) {
  log.info(CTX, 'Validating recipient email', { groupId, recipientId, email });
  setRecipientEmailValidation(groupId, recipientId, 'checking', 'Checking…');
  const { status, message } = await checkEmailExists(email);
  setRecipientEmailValidation(groupId, recipientId, status, message);
  log.info(CTX, 'Recipient email validation done', { groupId, recipientId, email, status, message });

  const apps = getApplications();
  const found = findRecipient(apps, recipientId);
  return found?.recipient ?? null;
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
