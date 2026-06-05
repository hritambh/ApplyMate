import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db.js';
import { authenticate } from '../middleware/auth.js';
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
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const resume = await prisma.resume.findUnique({ where: { userId: req.user.id } });
    res.json({ resume });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', upload.single('resume'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // Remove old file from disk if one exists
    const existing = await prisma.resume.findUnique({ where: { userId: req.user.id } });
    if (existing) {
      const oldPath = path.join(UPLOADS_DIR, existing.filename);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) {
          log.warn(CTX, 'Could not remove old resume file', { error: e.message });
        }
      }
    }

    const resume = await prisma.resume.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
      update: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedAt: new Date(),
      },
    });

    log.info(CTX, 'Resume uploaded', {
      userId: req.user.id,
      filename: resume.filename,
      originalName: resume.originalName,
      size: resume.size,
    });
    res.json({ resume });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const existing = await prisma.resume.findUnique({ where: { userId: req.user.id } });
    if (existing) {
      const p = path.join(UPLOADS_DIR, existing.filename);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch (e) {
          log.warn(CTX, 'Could not remove resume file', { error: e.message });
        }
      }
      await prisma.resume.delete({ where: { userId: req.user.id } });
    }
    log.info(CTX, 'Resume removed', { userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export async function getResumeAttachment(userId) {
  const resume = await prisma.resume.findUnique({ where: { userId } });
  if (!resume) return null;
  const fullPath = path.join(UPLOADS_DIR, resume.filename);
  if (!fs.existsSync(fullPath)) return null;
  return { ...resume, path: fullPath };
}

export default router;
