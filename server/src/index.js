import express from 'express';
import cors from 'cors';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';

// Import your routes
import authRouter from './routes/auth.js';
import resumeRouter from './routes/resume.js';
import applicationsRouter from './routes/applications.js';
import profileRouter from './routes/profile.js';
import subscriptionsRouter from './routes/subscriptions.js';
import { requestLogger, errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// 1. Initialize Express
const app = express();

// 2. Add Standard Middleware
app.use(cors());
app.use(requestLogger);
app.use(express.json()); // Parses incoming JSON payloads

// 3. Initialize Passport for Auth
app.use(passport.initialize());

// 4. Register all your API routes
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/resume', resumeRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/subscriptions', subscriptionsRouter);

// 5. Start the server
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});

// 404 handler for unknown API routes (must be before the SPA fallback)
app.use('/api', notFoundHandler);

// Serve the built React app (production). Any non-/api route falls through
// to index.html so client-side routing works.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Global error handler (must be after all routes)
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  const keyOk =
    Boolean(process.env.PROFILE_ENCRYPTION_KEY?.trim()) &&
    process.env.PROFILE_ENCRYPTION_KEY.trim().length === 64;
  console.log(`Server is running on http://localhost:${PORT}`);
  if (!keyOk) {
    console.warn(
      '[startup] PROFILE_ENCRYPTION_KEY missing or invalid in server/.env — profile save will fail. Run: openssl rand -hex 32',
    );
  }
});