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

/**
 * Translate raw SMTP/nodemailer errors into an actionable message for the user.
 * Returns null when we don't recognize the error (caller keeps the original).
 */
function friendlySmtpError(err) {
  const code = err?.responseCode;
  const msg = err?.message || '';

  if (code === 535 || /Username and Password not accepted|BadCredentials|5\.7\.8|Invalid login/i.test(msg)) {
    return 'Mail server rejected your login. For Gmail you must use a 16-character App Password (not your normal password) with 2-Step Verification enabled — set it in Settings → Email (SMTP).';
  }
  if (err?.code === 'EAUTH') {
    return 'SMTP authentication failed. Double-check your SMTP user (email) and app password in Settings → Email (SMTP).';
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND'].includes(err?.code)) {
    return `Could not reach the SMTP server (${profileHostHint(err)}). Check the SMTP host and port in Settings → Email (SMTP).`;
  }
  return null;
}

function profileHostHint(err) {
  return err?.address ? `${err.address}:${err.port ?? ''}` : 'connection failed';
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

      let info;
      try {
        info = await tx.sendMail(mailOptions);
      } catch (err) {
        const friendly = friendlySmtpError(err);
        // Always surface the raw cause in the pod logs for debugging…
        log.error(CTX, 'SMTP send rejected', {
          to,
          subject,
          code: err?.code,
          responseCode: err?.responseCode,
          rawError: err?.message,
          friendly: friendly || undefined,
        });
        // …but throw the user-facing message so the UI shows something actionable.
        if (friendly) {
          const e = new Error(friendly);
          e.code = err?.code;
          e.responseCode = err?.responseCode;
          e.cause = err;
          throw e;
        }
        throw err;
      }

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
