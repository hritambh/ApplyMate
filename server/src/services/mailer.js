import nodemailer from 'nodemailer';
import { bodyToHtml, normalizeEmailBody } from '../utils/emailBody.js';
import { log, timed } from '../utils/logger.js';

const CTX = 'smtp';

let transporter = null;

export function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  log.info(CTX, 'SMTP transporter created', { host, port, secure, user });
  return transporter;
}

export function getFromHeader() {
  const name = process.env.MAIL_FROM_NAME || process.env.APPLICANT_NAME || '';
  const address = process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER;
  if (!address) throw new Error('MAIL_FROM_ADDRESS or SMTP_USER must be set');
  return name ? `"${name}" <${address}>` : address;
}

export async function sendApplicationEmail({ to, subject, body, attachment }) {
  const tx = getTransporter();
  const text = normalizeEmailBody(body);
  const html = bodyToHtml(text);

  return timed(
    CTX,
    'sendMail',
    async () => {
      const info = await tx.sendMail({
        from: getFromHeader(),
        to,
        subject,
        text,
        html,
        attachments: attachment
          ? [
              {
                filename: attachment.originalName,
                path: attachment.path,
                contentType: attachment.mimeType,
              },
            ]
          : [],
      });

      log.info(CTX, 'Email sent', {
        to,
        subject,
        messageId: info.messageId,
        attachment: attachment?.originalName || null,
      });

      return { messageId: info.messageId, response: info.response };
    },
    { to, subject, hasAttachment: Boolean(attachment) },
  );
}

