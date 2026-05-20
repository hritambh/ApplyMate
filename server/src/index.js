import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import resumeRouter from './routes/resume.js';
import applicationsRouter from './routes/applications.js';
import { requestLogger } from './middleware/requestLogger.js';
import { log } from './utils/logger.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api', requestLogger);

app.get('/api/health', (_req, res) => {
  const payload = {
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    applicant: {
      name: process.env.APPLICANT_NAME || '',
      phone: process.env.APPLICANT_PHONE || '',
    },
  };
  log.debug('health', 'Health check', {
    openaiConfigured: payload.openaiConfigured,
    smtpConfigured: payload.smtpConfigured,
  });
  res.json(payload);
});

app.use('/api/resume', resumeRouter);
app.use('/api/applications', applicationsRouter);

app.use((err, req, res, _next) => {
  log.error('http', 'Unhandled request error', {
    method: req.method,
    path: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  log.info('server', `ApplyMate listening on http://localhost:${PORT}`, {
    logLevel: process.env.LOG_LEVEL || 'info',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    skipEmailValidation: process.env.SKIP_EMAIL_VALIDATION === 'true',
  });
});
