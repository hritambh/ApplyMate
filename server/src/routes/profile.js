import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getOrCreateProfile,
  getProfileForUser,
  isProfileComplete,
  toPublicProfile,
  upsertProfile,
} from '../services/userProfile.js';
import { sendApplicationEmail } from '../services/mailer.js';
import { log } from '../utils/logger.js';

const router = Router();
router.use(authenticate);
const CTX = 'profile';

router.get('/', async (req, res) => {
  try {
    const record = await getOrCreateProfile(req.user.id, {
      applicantName: req.user.name || '',
      mailFromAddress: req.user.email || '',
      mailFromName: req.user.name || '',
    });
    res.json({
      profile: toPublicProfile(record),
      complete: isProfileComplete(record),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const record = await upsertProfile(req.user.id, req.body);
    log.info(CTX, 'Profile updated', { userId: req.user.id });
    res.json({
      profile: toPublicProfile(record),
      complete: isProfileComplete(record),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/test-smtp', async (req, res) => {
  try {
    const profile = await getProfileForUser(req.user.id);
    if (!profile || !isProfileComplete(profile)) {
      return res.status(400).json({ error: 'Complete your profile before testing SMTP' });
    }

    await sendApplicationEmail({
      to: req.user.email,
      subject: 'ApplyMate — SMTP test',
      body: [
        'This is a test email from ApplyMate.',
        '',
        'If you received this, your SMTP settings are working correctly.',
      ].join('\n'),
      attachment: null,
      profile,
    });

    log.info(CTX, 'SMTP test email sent', { userId: req.user.id, to: req.user.email });
    res.json({ ok: true, message: `Test email sent to ${req.user.email}` });
  } catch (err) {
    log.error(CTX, 'SMTP test failed', { userId: req.user.id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
