const BASE = '/api';

async function handle(res) {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(handle),

  getResume: () => fetch(`${BASE}/resume`).then(handle),
  uploadResume: (file) => {
    const form = new FormData();
    form.append('resume', file);
    return fetch(`${BASE}/resume`, { method: 'POST', body: form }).then(handle);
  },
  deleteResume: () => fetch(`${BASE}/resume`, { method: 'DELETE' }).then(handle),

  listApplications: () => fetch(`${BASE}/applications`).then(handle),
  createApplications: (companies) =>
    fetch(`${BASE}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies }),
    }).then(handle),
  updateApplication: (id, patch) =>
    fetch(`${BASE}/applications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(handle),
  regenerate: (id) =>
    fetch(`${BASE}/applications/${id}/regenerate`, { method: 'POST' }).then(handle),
  markReviewed: (id) =>
    fetch(`${BASE}/applications/${id}/review`, { method: 'POST' }).then(handle),
  deleteApplication: (id) =>
    fetch(`${BASE}/applications/${id}`, { method: 'DELETE' }).then(handle),
  deleteRecipient: (groupId, recipientId) =>
    fetch(`${BASE}/applications/${groupId}/recipients/${recipientId}`, {
      method: 'DELETE',
    }).then(handle),
  deleteEmail: (groupId, recipientId, emailId) =>
    fetch(`${BASE}/applications/${groupId}/recipients/${recipientId}/emails/${emailId}`, {
      method: 'DELETE',
    }).then(handle),
  validateEmail: (groupId, recipientId, emailId) =>
    fetch(
      `${BASE}/applications/${groupId}/recipients/${recipientId}/emails/${emailId}/validate-email`,
      { method: 'POST' },
    ).then(handle),
  sendApplications: (ids) =>
    fetch(`${BASE}/applications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).then(handle),
};

/** Ensure legacy recipient.email is available as emails[]. */
export function getRecipientEmails(recipient) {
  if (Array.isArray(recipient?.emails) && recipient.emails.length > 0) {
    return recipient.emails;
  }
  if (recipient?.email) {
    return [
      {
        id: recipient.id,
        address: recipient.email,
        emailValidation: recipient.emailValidation,
        emailValidationMessage: recipient.emailValidationMessage,
        status: recipient.status,
        error: recipient.error,
        sentAt: recipient.sentAt,
      },
    ];
  }
  return [];
}

export function countGroupEmails(group) {
  return (group.recipients || []).reduce((n, r) => n + getRecipientEmails(r).length, 0);
}

export function countGroupEmailsByStatus(group, status) {
  let n = 0;
  for (const r of group.recipients || []) {
    for (const e of getRecipientEmails(r)) {
      if (e.status === status) n++;
    }
  }
  return n;
}

/** One email entry is sendable when its group has content and it hasn't been sent yet. */
export function isEmailSendable(group, emailEntry) {
  return (
    emailEntry.status !== 'sent' &&
    emailEntry.emailValidation !== 'invalid' &&
    Boolean(group.coverLetter || group.body) &&
    Boolean(group.subject || group.coverLetter)
  );
}

export function isGroupGenerating(group) {
  return group.status === 'pending' && !group.coverLetter && !group.error;
}

export function isEmailChecking(applications) {
  return applications.some((g) =>
    (g.recipients || []).some((r) =>
      getRecipientEmails(r).some((e) => e.emailValidation === 'checking'),
    ),
  );
}
