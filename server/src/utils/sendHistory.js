import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './logger.js';

const CTX = 'send-history';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.resolve(__dirname, '..', '..', 'history.json');

function readHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    log.warn(CTX, 'Could not read history.json, starting fresh', { error: err.message });
    return [];
  }
}

/**
 * Append a successful send record to server/history.json.
 */
export function appendSendHistory(entry) {
  try {
    const history = readHistory();
    history.push({
      sentAt: entry.sentAt || new Date().toISOString(),
      company: entry.company || '',
      role: entry.role || '',
      hrName: entry.hrName || '',
      email: entry.email || '',
      subject: entry.subject || '',
      messageId: entry.messageId || null,
      groupId: entry.groupId || null,
      recipientId: entry.recipientId || null,
    });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    log.info(CTX, 'Send recorded in history.json', {
      email: entry.email,
      company: entry.company,
      total: history.length,
    });
  } catch (err) {
    log.error(CTX, 'Failed to append send history', { error: err.message });
  }
}
