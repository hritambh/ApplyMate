import nodemailer from 'nodemailer';
import { bodyToHtml, normalizeEmailBody } from '../utils/emailBody.js';
import { log, timed } from '../utils/logger.js';

const CTX = 'smtp';

function assertSmtpProfile(profile) {
  if (
    !profile?.smtpHost ||
    !profile?.smtpUser ||
    !profile?.smtpPass ||
    !profile?.mailFromAddress
  ) {
    throw new Error('Complete your profile SMTP settings before sending.');
  }
}

function createTransporter(profile) {
  assertSmtpProfile(profile);
  const port = Number(profile.smtpPort || 587);
  // Port 465 uses implicit SSL/TLS; all other ports (587, 25) use STARTTLS
  const secure = port === 465;
  return nodemailer.createTransport({
    host: profile.smtpHost,
    port,
    secure,
    auth: { user: profile.smtpUser, pass: profile.smtpPass },
  });
}

function getFromHeader(profile) {
  assertSmtpProfile(profile);
  const name = profile.mailFromName || profile.applicantName || '';
  const address = profile.mailFromAddress || profile.smtpUser;
  return name ? `"${name}" <${address}>` : address;
}

export async function sendApplicationEmail({ to, subject, body, attachment, profile, inReplyTo }) {
  const tx = createTransporter(profile);
  const text = normalizeEmailBody(body);
  const html = bodyToHtml(text);
  const from = getFromHeader(profile);

  return timed(
    CTX,
    'sendMail',
    async () => {
      const mailOptions = {
        from,
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
      };

      if (inReplyTo) {
        mailOptions.inReplyTo = inReplyTo;
        mailOptions.references = inReplyTo;
      }

      const info = await tx.sendMail(mailOptions);

      log.info(CTX, 'Email sent', {
        to,
        subject,
        from,
        messageId: info.messageId,
        attachment: attachment?.originalName || null,
      });

      return { messageId: info.messageId, response: info.response };
    },
    { to, subject, hasAttachment: Boolean(attachment) },
  );
}
