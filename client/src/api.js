const BASE = '/api';

/** Structured API error thrown for any non-2xx response. */
export class ApiError extends Error {
  constructor(message, { status = 0, path = '', method = 'GET', body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.method = method;
    this.body = body;
  }
}

/** True when the server rejected the session (401). */
export function isUnauthorized(err) {
  return err instanceof ApiError && err.status === 401;
}

const errorListeners = new Set();

/** Subscribe to API failures (non-2xx or network errors). Returns unsubscribe fn. */
export function onApiError(listener) {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

function notifyApiError(error, silent) {
  if (silent) return;
  for (const listener of errorListeners) {
    try {
      listener(error);
    } catch (listenerErr) {
      console.error('[api] error listener failed', listenerErr);
    }
  }
}

function logApiFailure({ method, path, status, message, body }) {
  const payload = { method, path, status, message };
  if (body && Object.keys(body).length > 0) payload.body = body;
  if (status >= 500) console.error('[api] server error', payload);
  else if (status === 401) console.warn('[api] unauthorized', payload);
  else console.warn('[api] request failed', payload);
}

async function parseErrorBody(res) {
  try {
    return await res.json();
  } catch {
    try {
      const text = await res.text();
      return text ? { error: text } : {};
    } catch {
      return {};
    }
  }
}

async function handleResponse(res, { method, path, silent }) {
  if (res.ok) {
    if (res.status === 204) return null;
    return res.json().catch(() => ({}));
  }

  const body = await parseErrorBody(res);
  const message = body.error || body.message || `Request failed (${res.status})`;
  const error = new ApiError(message, { status: res.status, path, method, body });

  logApiFailure({ method, path, status: res.status, message, body });
  notifyApiError(error, silent);
  throw error;
}

/**
 * Central fetch wrapper — logs and intercepts all non-2xx responses.
 * Pass `{ silent: true }` to skip global error listeners (when handling locally).
 */
export async function request(path, options = {}) {
  const { silent, ...fetchOptions } = options;
  const method = fetchOptions.method || 'GET';
  const url = `${BASE}${path}`;

  let res;
  try {
    res = await fetch(url, fetchOptions);
  } catch (networkErr) {
    const message = networkErr.message || 'Network error — is the server running?';
    const error = new ApiError(message, { status: 0, path: url, method });
    console.error('[api] network error', { method, path: url, error: message });
    notifyApiError(error, silent);
    throw error;
  }

  return handleResponse(res, { method, path: url, silent });
}

function getAuthHeaders() {
  const token = localStorage.getItem('applymate_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authJsonHeaders() {
  return { 'Content-Type': 'application/json', ...getAuthHeaders() };
}

export const api = {
  health: () => request('/health'),

  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      silent: true,
    }),

  register: ({ name, email, password }) =>
    request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
      silent: true,
    }),

  getProfile: () => request('/profile', { headers: { ...getAuthHeaders() } }),

  updateProfile: (profile) =>
    request('/profile', {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify(profile),
    }),

  testSmtp: () =>
    request('/profile/test-smtp', {
      method: 'POST',
      headers: { ...getAuthHeaders() },
    }),

  getResume: () => request('/resume', { headers: { ...getAuthHeaders() } }),

  uploadResume: (file) => {
    const form = new FormData();
    form.append('resume', file);
    return request('/resume', {
      method: 'POST',
      headers: { ...getAuthHeaders() },
      body: form,
    });
  },

  deleteResume: () =>
    request('/resume', { method: 'DELETE', headers: { ...getAuthHeaders() } }),

  listApplications: () =>
    request('/applications', { headers: { ...getAuthHeaders() } }),

  createApplications: (companies) =>
    request('/applications', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ companies }),
    }),

  updateApplication: (id, patch) =>
    request(`/applications/${id}`, {
      method: 'PATCH',
      headers: authJsonHeaders(),
      body: JSON.stringify(patch),
    }),

  regenerate: (id) =>
    request(`/applications/${id}/regenerate`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
    }),

  markReviewed: (id) =>
    request(`/applications/${id}/review`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
    }),

  deleteApplication: (id) =>
    request(`/applications/${id}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() },
    }),

  deleteRecipient: (groupId, recipientId) =>
    request(`/applications/${groupId}/recipients/${recipientId}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() },
    }),

  deleteEmail: (groupId, recipientId, emailId) =>
    request(`/applications/${groupId}/recipients/${recipientId}/emails/${emailId}`, {
      method: 'DELETE',
      headers: { ...getAuthHeaders() },
    }),

  validateEmail: (groupId, recipientId, emailId) =>
    request(
      `/applications/${groupId}/recipients/${recipientId}/emails/${emailId}/validate-email`,
      { method: 'POST', headers: { ...getAuthHeaders() } },
    ),

  sendApplications: (ids) =>
    request('/applications/send', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ ids }),
    }),

  sendFollowUps: (ids) =>
    request('/applications/send-followups', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ ids }),
    }),

  getHistory: () =>
    request('/applications/history', { headers: { ...getAuthHeaders() } }),

  // --- Subscriptions ---
  getMySubscription: () =>
    request('/subscriptions/my', { headers: { ...getAuthHeaders() } }),

  requestSubscription: (message = '') =>
    request('/subscriptions/request', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ message }),
    }),

  listSubscriptions: () =>
    request('/subscriptions', { headers: { ...getAuthHeaders() } }),

  approveSubscription: (id, reviewNote = '') =>
    request(`/subscriptions/${id}/approve`, {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ reviewNote }),
    }),

  denySubscription: (id, reviewNote = '') =>
    request(`/subscriptions/${id}/deny`, {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ reviewNote }),
    }),

  revokeSubscription: (id) =>
    request(`/subscriptions/${id}/revoke`, {
      method: 'POST',
      headers: { ...getAuthHeaders() },
    }),
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

/**
 * An email is eligible for a follow-up once its initial send succeeded. Follow-ups
 * can be sent any number of times, so a prior follow-up no longer locks it out.
 */
export function isEmailFollowUpable(emailEntry) {
  return emailEntry.status === 'sent';
}

/** Number of follow-ups successfully sent for an email entry. */
export function followUpCount(emailEntry) {
  const list = emailEntry?.followUps;
  if (Array.isArray(list)) return list.filter((f) => f.status === 'sent').length;
  // Fallback for records without the followUps relation loaded.
  return emailEntry?.followUpStatus === 'sent' ? 1 : 0;
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
  return (
    group.status === 'pending' &&
    !group.coverLetter?.trim() &&
    !group.error
  );
}

export function isEmailChecking(applications) {
  return applications.some((g) =>
    (g.recipients || []).some((r) =>
      getRecipientEmails(r).some((e) => e.emailValidation === 'checking'),
    ),
  );
}
