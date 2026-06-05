import { Router } from 'express';
import { prisma, logAudit } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { requireSU } from '../middleware/requireSU.js';
import { log } from '../utils/logger.js';

const router = Router();
router.use(authenticate);
const CTX = 'subscriptions';

// --- User routes ---

// Get own subscription request status
router.get('/my', async (req, res) => {
  try {
    const sub = await prisma.subscriptionRequest.findUnique({
      where: { userId: req.user.id },
    });
    res.json({ subscription: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit or re-submit a request for shared OpenAI access
router.post('/request', async (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 500);

  try {
    const existing = await prisma.subscriptionRequest.findUnique({
      where: { userId: req.user.id },
    });

    if (existing?.status === 'approved') {
      return res.status(400).json({ error: 'Your subscription is already approved.' });
    }

    const sub = await prisma.subscriptionRequest.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, status: 'pending', message },
      update: { status: 'pending', message, reviewNote: null, reviewedById: null, reviewedAt: null },
    });

    log.info(CTX, 'Subscription request submitted', { userId: req.user.id });
    await logAudit(req.user.id, 'SUBSCRIPTION_REQUESTED', 'SubscriptionRequest', sub.id);
    res.json({ subscription: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SU routes ---

// List all subscription requests
router.get('/', requireSU, async (req, res) => {
  try {
    const subscriptions = await prisma.subscriptionRequest.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, role: true, createdAt: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ subscriptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve a subscription request
router.post('/:id/approve', requireSU, async (req, res) => {
  const reviewNote = String(req.body.reviewNote || '').trim().slice(0, 500);
  try {
    const sub = await prisma.subscriptionRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'approved',
        reviewNote: reviewNote || null,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    log.info(CTX, 'Subscription approved', { subId: sub.id, userId: sub.userId, by: req.user.id });
    await logAudit(req.user.id, 'SUBSCRIPTION_APPROVED', 'SubscriptionRequest', sub.id, { targetUserId: sub.userId });
    res.json({ subscription: sub });
  } catch (err) {
    res.status(err.code === 'P2025' ? 404 : 500).json({ error: err.code === 'P2025' ? 'Request not found' : err.message });
  }
});

// Deny a subscription request
router.post('/:id/deny', requireSU, async (req, res) => {
  const reviewNote = String(req.body.reviewNote || '').trim().slice(0, 500);
  try {
    const sub = await prisma.subscriptionRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'denied',
        reviewNote: reviewNote || null,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    log.info(CTX, 'Subscription denied', { subId: sub.id, userId: sub.userId, by: req.user.id });
    await logAudit(req.user.id, 'SUBSCRIPTION_DENIED', 'SubscriptionRequest', sub.id, { targetUserId: sub.userId });
    res.json({ subscription: sub });
  } catch (err) {
    res.status(err.code === 'P2025' ? 404 : 500).json({ error: err.code === 'P2025' ? 'Request not found' : err.message });
  }
});

// Revoke an approved subscription
router.post('/:id/revoke', requireSU, async (req, res) => {
  try {
    const sub = await prisma.subscriptionRequest.update({
      where: { id: req.params.id },
      data: { status: 'denied', reviewedById: req.user.id, reviewedAt: new Date(), reviewNote: 'Revoked by admin' },
    });
    log.info(CTX, 'Subscription revoked', { subId: sub.id, by: req.user.id });
    await logAudit(req.user.id, 'SUBSCRIPTION_REVOKED', 'SubscriptionRequest', sub.id);
    res.json({ subscription: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
