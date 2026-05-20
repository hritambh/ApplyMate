import { nanoid } from 'nanoid';
import { groupKey } from './groupKey.js';

/** Convert legacy flat applications (one row per HR) into grouped applications. */
export function migrateApplications(applications) {
  if (!Array.isArray(applications) || applications.length === 0) return [];
  if (applications[0].recipients) return applications;

  const map = new Map();

  for (const row of applications) {
    const key = groupKey(row.company, row.role);
    let group = map.get(key);
    if (!group) {
      group = {
        id: row.id || nanoid(10),
        company: row.company,
        role: row.role,
        coverLetter: row.coverLetter || '',
        subject: row.subject || '',
        body: row.body || '',
        status: row.status || 'pending',
        error: row.error || null,
        createdAt: row.createdAt || new Date().toISOString(),
        updatedAt: row.updatedAt || new Date().toISOString(),
        recipients: [],
      };
      map.set(key, group);
    } else {
      if (!group.coverLetter && row.coverLetter) group.coverLetter = row.coverLetter;
      if (!group.subject && row.subject) group.subject = row.subject;
      if (!group.body && row.body) group.body = row.body;
      if (row.updatedAt && row.updatedAt > group.updatedAt) group.updatedAt = row.updatedAt;
    }

    group.recipients.push({
      id: nanoid(8),
      hrName: row.hrName || '',
      email: row.email,
      status: row.status === 'sent' ? 'sent' : row.status === 'failed' ? 'failed' : 'pending',
      error: row.status === 'failed' ? row.error : null,
      sentAt: row.sentAt || null,
      emailValidation: 'unknown',
      emailValidationMessage: '',
    });
  }

  return [...map.values()];
}
