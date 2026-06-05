import { prisma } from '../db.js';
import { log } from '../utils/logger.js';
import { getJwtSecret, verifyToken } from '../utils/jwt.js';

export const authenticate = async (req, res, next) => {
  try {
    getJwtSecret();
  } catch (err) {
    log.error('auth', 'JWT_SECRET missing', { error: err.message });
    return res.status(500).json({ error: 'Server auth is not configured (JWT_SECRET missing)' });
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (jwtErr) {
    log.warn('auth', 'JWT verification failed', { error: jwtErr.message });
    const message =
      jwtErr.name === 'TokenExpiredError'
        ? 'Session expired — please sign in again'
        : 'Invalid or expired token';
    return res.status(401).json({ error: message });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(401).json({ error: 'User not found — please sign in again' });
    }
    req.user = user;
    next();
  } catch (err) {
    log.error('auth', 'User lookup failed during auth', { error: err.message });
    return res.status(500).json({ error: 'Authentication failed' });
  }
};
