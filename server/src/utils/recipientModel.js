import { nanoid } from 'nanoid';

export function hrKey(hrName) {
  return String(hrName || '')
    .trim()
    .toLowerCase() || '__noname__';
}

export function createEmailEntry(address, overrides = {}) {
  return {
    id: nanoid(8),
    address: String(address || '').trim(),
    emailValidation: overrides.emailValidation ?? 'checking',
    emailValidationMessage: overrides.emailValidationMessage ?? 'Checking…',
    status: overrides.status ?? 'pending',
    error: overrides.error ?? null,
    sentAt: overrides.sentAt ?? null,
  };
}

/** Migrate legacy recipient.email → recipient.emails[] (mutates in place). */
export function normalizeRecipient(recipient) {
  if (!recipient) return recipient;
  if (Array.isArray(recipient.emails) && recipient.emails.length > 0) {
    delete recipient.email;
    delete recipient.emailValidation;
    delete recipient.emailValidationMessage;
    delete recipient.status;
    delete recipient.error;
    delete recipient.sentAt;
    return recipient;
  }
  if (recipient.email) {
    recipient.emails = [
      createEmailEntry(recipient.email, {
        emailValidation: recipient.emailValidation || 'unknown',
        emailValidationMessage: recipient.emailValidationMessage || '',
        status: recipient.status || 'pending',
        error: recipient.error || null,
        sentAt: recipient.sentAt || null,
      }),
    ];
    delete recipient.email;
    delete recipient.emailValidation;
    delete recipient.emailValidationMessage;
    delete recipient.status;
    delete recipient.error;
    delete recipient.sentAt;
    return recipient;
  }
  recipient.emails = recipient.emails || [];
  return recipient;
}

export function normalizeGroupRecipients(group) {
  group.recipients = (group.recipients || []).map(normalizeRecipient);
  return group;
}

export function findEmailEntry(applications, emailId) {
  for (const group of applications) {
    for (const recipient of group.recipients || []) {
      const email = (recipient.emails || []).find((e) => e.id === emailId);
      if (email) return { group, recipient, email };
    }
  }
  return null;
}

export function findRecipient(applications, recipientId) {
  for (const group of applications) {
    const recipient = group.recipients.find((r) => r.id === recipientId);
    if (recipient) return { group, recipient };
  }
  return null;
}

export function findRecipientByHrName(group, hrName) {
  const key = hrKey(hrName);
  return group.recipients.find((r) => hrKey(r.hrName) === key);
}

export function groupHasEmail(group, address) {
  const lower = address.toLowerCase();
  return group.recipients.some((r) =>
    (r.emails || []).some((e) => e.address.toLowerCase() === lower),
  );
}

export function collectEmailJobs(group) {
  const jobs = [];
  for (const recipient of group.recipients || []) {
    for (const email of recipient.emails || []) {
      jobs.push({
        groupId: group.id,
        recipientId: recipient.id,
        emailId: email.id,
        address: email.address,
      });
    }
  }
  return jobs;
}

export function countEmails(group) {
  return (group.recipients || []).reduce((n, r) => n + (r.emails?.length || 0), 0);
}

export function countEmailsByStatus(group, status) {
  let n = 0;
  for (const r of group.recipients || []) {
    for (const e of r.emails || []) {
      if (e.status === status) n++;
    }
  }
  return n;
}

export function expandEntriesForPost(entries) {
  const flat = [];
  for (const e of entries) {
    const company = String(e.company || '').trim();
    const role = String(e.role || '').trim();
    const hrName = e.hrName ? String(e.hrName).trim() : '';
    const addresses = Array.isArray(e.emails)
      ? e.emails.map((x) => String(x).trim()).filter(Boolean)
      : e.email
        ? [String(e.email).trim()]
        : [];
    for (const address of addresses) {
      flat.push({ company, role, hrName, email: address });
    }
  }
  return flat;
}
