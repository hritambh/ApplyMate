import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readDB, updateDB } from '../store.js';
import { log } from '../utils/logger.js';

const CTX = 'resume';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ACCEPTED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `resume-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only PDF or DOCX files are accepted'));
  },
});

const router = Router();

router.get('/', (_req, res) => {
  const { resume } = readDB();
  res.json({ resume });
});

router.post('/', upload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const meta = {
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
  };

  updateDB((state) => {
    if (state.resume?.filename) {
      const oldPath = path.join(UPLOADS_DIR, state.resume.filename);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {
          log.warn(CTX, 'Could not remove old resume file', { error: e.message });
        }
      }
    }
    state.resume = meta;
    return state;
  });

  log.info(CTX, 'Resume uploaded', {
    filename: meta.filename,
    originalName: meta.originalName,
    size: meta.size,
  });
  res.json({ resume: meta });
});

router.delete('/', (_req, res) => {
  updateDB((state) => {
    if (state.resume?.filename) {
      const p = path.join(UPLOADS_DIR, state.resume.filename);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (e) {
          log.warn(CTX, 'Could not remove resume file', { error: e.message });
        }
      }
    }
    state.resume = null;
    return state;
  });
  log.info(CTX, 'Resume removed');
  res.json({ ok: true });
});

export function getResumeAttachment() {
  const { resume } = readDB();
  if (!resume) return null;
  const fullPath = path.join(UPLOADS_DIR, resume.filename);
  if (!fs.existsSync(fullPath)) return null;
  return { ...resume, path: fullPath };
}

export default router;
