/** Client-side preview matching server buildEmailFromCoverLetter. */
export function buildPreviewBody({
  hrName,
  company,
  coverLetter,
  applicantName = '',
  applicantPhone = '',
}) {
  const greetingName = hrName?.trim() ? hrName.trim() : 'Team';
  const name = applicantName?.trim() || 'Your Name';
  const phone = applicantPhone?.trim() || '8757518503';
  const letter = String(coverLetter || '').trim();

  return normalizeEmailBody(
    [
      `Hi ${greetingName},`,
      '',
      letter || '(cover letter will appear here)',
      '',
      `I've attached my resume for your review and would welcome the chance to discuss how I can contribute to ${company || 'the company'}.`,
      '',
      'Best regards,',
      name,
      `Phone: +91 ${phone}`,
    ].join('\n'),
  );
}

function normalizeEmailBody(body) {
  return String(body || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
