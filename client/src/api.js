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
  validateRecipientEmail: (groupId, recipientId) =>
    fetch(`${BASE}/applications/${groupId}/recipients/${recipientId}/validate-email`, {
      method: 'POST',
    }).then(handle),
  sendApplications: (ids) =>
    fetch(`${BASE}/applications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).then(handle),
};

/** Recipient is sendable when its group has content and it hasn't been sent yet. */
export function isRecipientSendable(group, recipient) {
  return (
    recipient.status !== 'sent' &&
    recipient.emailValidation !== 'invalid' &&
    Boolean(group.coverLetter || group.body) &&
    Boolean(group.subject || group.coverLetter)
  );
}

export function isGroupGenerating(group) {
  return group.status === 'pending' && !group.coverLetter && !group.error;
}

export function isEmailChecking(applications) {
  return applications.some((g) =>
    (g.recipients || []).some((r) => r.emailValidation === 'checking'),
  );
}
