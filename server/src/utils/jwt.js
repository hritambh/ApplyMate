import jwt from 'jsonwebtoken';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim().replace(/^["']|["']$/g, '');
  if (!secret) {
    throw new Error('JWT_SECRET is not configured in server/.env');
  }
  return secret;
}

export function signToken(userId) {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}
