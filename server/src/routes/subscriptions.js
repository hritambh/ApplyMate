import { Router } from 'express';
import { prisma, logAudit } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { requireSU } from '../middleware/requireSU.js';
import { grantUserCredits, setUserCredits } from '../services/userProfile.js';
import { log } from '../utils/logger.js';

const router = Router();
router.use(authenticate);
const CTX = 'subscriptions';

// Default credits granted when an admin approves a request without specifying an amount.
const DEFAULT_GRANT = 50;

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

    if (existing?.status === 'pending') {
      return res.status(400).json({ error: 'You already have a pending request awaiting review.' });
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

// Admin: full credit overview of every user (balance, lifetime used, request state).
router.get('/users', requireSU, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        profile: { select: { freeCredits: true, creditsUsed: true, openaiKeyEnc: true } },
        subscriptionRequest: {
          select: { id: true, status: true, message: true, reviewNote: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      creditsRemaining: Math.max(0, u.profile?.freeCredits ?? 0),
      creditsUsed: Math.max(0, u.profile?.creditsUsed ?? 0),
      hasOwnKey: Boolean(u.profile?.openaiKeyEnc),
      request: u.subscriptionRequest || null,
    }));

    res.json({ users: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: set a user's remaining credit balance to an exact value.
router.put('/users/:userId/credits', requireSU, async (req, res) => {
  const { credits } = req.body || {};
  if (credits === undefined || Number.isNaN(Number(credits)) || Number(credits) < 0) {
    return res.status(400).json({ error: 'Body must include a non-negative number: { credits }' });
  }
  try {
    const value = await setUserCredits(req.params.userId, credits);
    log.info(CTX, 'Credits set by admin', { userId: req.params.userId, credits: value, by: req.user.id });
    await logAudit(req.user.id, 'CREDITS_SET', 'UserProfile', req.params.userId, { credits: value });
    res.json({ ok: true, userId: req.params.userId, creditsRemaining: value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve a subscription request — grants a bounded number of credits.
router.post('/:id/approve', requireSU, async (req, res) => {
  const reviewNote = String(req.body.reviewNote || '').trim().slice(0, 500);
  const grant = req.body.grantCredits === undefined ? DEFAULT_GRANT : Math.max(0, Math.floor(Number(req.body.grantCredits) || 0));
  try {
    const sub = await prisma.subscriptionRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'approved',
        reviewNote: reviewNote || `Granted ${grant} credits`,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    const creditsRemaining = await grantUserCredits(sub.userId, grant);
    log.info(CTX, 'Subscription approved', { subId: sub.id, userId: sub.userId, grant, creditsRemaining, by: req.user.id });
    await logAudit(req.user.id, 'SUBSCRIPTION_APPROVED', 'SubscriptionRequest', sub.id, { targetUserId: sub.userId, grant });
    res.json({ subscription: sub, creditsRemaining });
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
