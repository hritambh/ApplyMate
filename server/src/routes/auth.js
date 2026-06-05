import { Router } from 'express';
import bcrypt from 'bcrypt';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma, logAudit } from '../db.js';
import { log } from '../utils/logger.js';
import { getOrCreateProfile } from '../services/userProfile.js';
import { getJwtSecret, signToken } from '../utils/jwt.js';

const router = Router();
const OAUTH = 'oauth';

const clientUrl = () => process.env.CLIENT_URL || 'http://localhost:5173';

function maskId(value) {
  if (!value) return '(missing)';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

const googleCallbackURL =
  process.env.GOOGLE_CALLBACK_URL ||
  `http://localhost:${process.env.PORT || 4000}/api/auth/google/callback`;

const googleClientId = process.env.GOOGLE_CLIENT_ID || 'dummy';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || 'dummy';

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  log.warn(OAUTH, 'Google OAuth env missing — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
} else if (googleClientId === 'dummy' || googleClientSecret === 'dummy') {
  log.warn(OAUTH, 'Google OAuth using placeholder credentials');
}

log.info(OAUTH, 'Google OAuth configured', {
  callbackURL: googleCallbackURL,
  clientId: maskId(googleClientId),
  hasClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
  clientUrl: clientUrl(),
  hasJwtSecret: Boolean(process.env.JWT_SECRET?.trim()),
});

function googleCallbackQuery(req) {
  const { code, error, error_description, state } = req.query;
  return {
    hasCode: Boolean(code),
    error: error || undefined,
    error_description: error_description || undefined,
    state: state || undefined,
  };
}

function redirectWithAuthError(res, message) {
  const url = `${clientUrl()}/?auth_error=${encodeURIComponent(message)}`;
  log.warn(OAUTH, 'Redirecting to client with auth_error', { message, url: url.split('?')[0] + '/?auth_error=...' });
  return res.redirect(url);
}

// Google OAuth Setup — callback must match "Authorized redirect URIs" in Google Cloud Console
passport.use(new GoogleStrategy({
    clientID: googleClientId,
    clientSecret: googleClientSecret,
    callbackURL: googleCallbackURL,
  },
  async (accessToken, refreshToken, profile, cb) => {
    const email = profile.emails?.[0]?.value;
    log.debug(OAUTH, 'Google profile received', {
      googleId: profile.id,
      email,
      displayName: profile.displayName,
    });

    try {
      let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
      if (!user) {
        log.info(OAUTH, 'Creating new user from Google profile', { googleId: profile.id, email });
        user = await prisma.user.create({
          data: {
            googleId: profile.id,
            email,
            name: profile.displayName,
          },
        });
        await logAudit(user.id, 'USER_REGISTERED', 'User', user.id, { provider: 'google' });
        log.info(OAUTH, 'User registered via Google', { userId: user.id, email: user.email });
        await getOrCreateProfile(user.id, {
          applicantName: profile.displayName || '',
          mailFromAddress: email || '',
          mailFromName: profile.displayName || '',
        });
      } else {
        log.info(OAUTH, 'Existing Google user signed in', { userId: user.id, email: user.email });
      }
      return cb(null, user);
    } catch (err) {
      log.error(OAUTH, 'Failed to find or create user after Google auth', {
        googleId: profile.id,
        email,
        error: err.message,
        stack: err.stack,
      });
      return cb(err, null);
    }
  }
));

// Email/Password Registration
router.post('/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password;
  const name = String(req.body.name || '').trim();

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  if (password.length < 5) {
    return res.status(400).json({ error: 'Password must be at least 5 characters' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, passwordHash, name } });
    
    await logAudit(user.id, 'USER_REGISTERED', 'User', user.id, { provider: 'local' });
    await getOrCreateProfile(user.id, {
      applicantName: name,
      mailFromAddress: email,
      mailFromName: name,
    });
    res.json({ token: signToken(user.id), user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Email/Password Login
router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await logAudit(user.id, 'USER_LOGGED_IN', 'User', user.id);
    res.json({ token: signToken(user.id), user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Log the exact redirect_uri Google receives (must match Console character-for-character). */
function logGoogleAuthorizeRedirect(res) {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = function patchedRedirect(statusOrUrl, maybeUrl) {
    const location = typeof statusOrUrl === 'number' ? maybeUrl : statusOrUrl;
    if (location && String(location).includes('accounts.google.com')) {
      try {
        const authorizeUrl = new URL(location);
        const redirectUri = authorizeUrl.searchParams.get('redirect_uri');
        const clientId = authorizeUrl.searchParams.get('client_id');
        log.info(OAUTH, 'Google authorize URL built — copy redirect_uri into Google Cloud Console', {
          redirect_uri: redirectUri,
          matchesEnvCallback: redirectUri === googleCallbackURL,
          client_id: maskId(clientId),
          consolePath: 'APIs & Services → Credentials → your OAuth 2.0 Client ID → Authorized redirect URIs',
        });
        if (redirectUri !== googleCallbackURL) {
          log.warn(OAUTH, 'redirect_uri differs from GOOGLE_CALLBACK_URL env', {
            env: googleCallbackURL,
            sent: redirectUri,
          });
        }
      } catch (parseErr) {
        log.warn(OAUTH, 'Could not parse Google authorize URL', { error: parseErr.message });
      }
    }
    return typeof statusOrUrl === 'number'
      ? originalRedirect(statusOrUrl, maybeUrl)
      : originalRedirect(statusOrUrl);
  };
}

/** Dev helper: open http://localhost:4000/api/auth/google/setup to verify Console config. */
router.get('/google/setup', (req, res) => {
  res.json({
    message: 'Add this EXACT value under Authorized redirect URIs (not JavaScript origins)',
    authorizedRedirectUri: googleCallbackURL,
    clientId: googleClientId,
    clientIdHint: maskId(googleClientId),
    wrongUriOftenUsed: `${clientUrl()}/auth/google/callback`,
    note: 'localhost and 127.0.0.1 are different — use localhost if that is what appears in redirect_uri above',
  });
});

// Google Login endpoints
router.get('/google', (req, res, next) => {
  log.info(OAUTH, 'GET /google — redirecting browser to Google', {
    callbackURL: googleCallbackURL,
    referer: req.get('referer'),
  });
  logGoogleAuthorizeRedirect(res);
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  log.info(OAUTH, 'GET /google/callback — Google returned to server', googleCallbackQuery(req));

  if (req.query.error) {
    const msg = req.query.error_description || req.query.error;
    log.error(OAUTH, 'Google returned an error on callback', {
      error: req.query.error,
      error_description: req.query.error_description,
      hint: req.query.error === 'redirect_uri_mismatch'
        ? `Add this exact URI in Google Cloud Console: ${googleCallbackURL}`
        : undefined,
    });
    return redirectWithAuthError(res, msg);
  }

  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) {
      log.error(OAUTH, 'Passport Google authenticate failed', {
        error: err.message,
        stack: err.stack,
        info,
      });
      return redirectWithAuthError(res, err.message);
    }

    if (!user) {
      log.warn(OAUTH, 'Google callback completed but no user (passport info)', { info });
      return redirectWithAuthError(res, 'Google sign-in did not return a user');
    }

    if (!process.env.JWT_SECRET?.trim()) {
      log.error(OAUTH, 'JWT_SECRET is not set — cannot issue token', { userId: user.id });
      return redirectWithAuthError(res, 'Server misconfiguration: JWT_SECRET missing');
    }

    try {
      getJwtSecret();
    } catch {
      return redirectWithAuthError(res, 'Server misconfiguration: JWT_SECRET missing');
    }

    try {
      const token = signToken(user.id);
      const redirectTo = `${clientUrl()}/?token=${token}`;
      log.info(OAUTH, 'Google login success — redirecting to client with token', {
        userId: user.id,
        email: user.email,
        clientUrl: clientUrl(),
      });
      res.redirect(redirectTo);
    } catch (tokenErr) {
      log.error(OAUTH, 'JWT sign failed after Google login', {
        userId: user.id,
        error: tokenErr.message,
      });
      return redirectWithAuthError(res, tokenErr.message);
    }
  })(req, res, next);
});

export default router;