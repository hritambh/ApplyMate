import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const defaultState = {
  resume: null, // { filename, originalName, mimeType, size, uploadedAt }
  applications: [],
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultState, null, 2));
  }
}

export function readDB() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultState, ...parsed };
  } catch (err) {
    console.error('Failed to read DB, resetting:', err.message);
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultState, null, 2));
    return { ...defaultState };
  }
}

export function writeDB(state) {
  ensureFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
}

export function updateDB(mutator) {
  const state = readDB();
  const next = mutator(state) ?? state;
  writeDB(next);
  return next;
}
