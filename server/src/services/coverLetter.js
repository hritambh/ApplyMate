import OpenAI from 'openai';
import { normalizeEmailBody } from '../utils/emailBody.js';

function getClient(apiKey) {
  if (!apiKey) throw new Error('OpenAI API key is required');
  return new OpenAI({ apiKey });
}

const SYSTEM_PROMPT =
  'You are a writing assistant that drafts short, clean, professional cover letters for job applications. ' +
  'Your tone is professional but natural — never robotic. ' +
  'You avoid buzzwords, exaggerated claims, and filler content. ' +
  'Return ONLY the body of the cover letter as plain text — no subject line, no greeting like "Dear Hiring Manager" ' +
  '(the calling code adds a personalized greeting), and no signature block.';

function buildUserPrompt({ company, role, applicantName, applicantHeadline, applicantSkills }) {
  return [
    `Write a short, clean, and professional cover letter for a job application.`,
    ``,
    `Company Name: ${company}`,
    `Role: ${role}`,
    ``,
    applicantName ? `Applicant Name: ${applicantName}` : null,
    applicantHeadline ? `Applicant Background: ${applicantHeadline}` : null,
    applicantSkills ? `Relevant Skills: ${applicantSkills}` : null,
    ``,
    `Requirements:`,
    `- Keep it concise (150–250 words max)`,
    `- Tone should be professional but natural and also humanly and not AI at all`,
    `- Mention i came across this job opening for x role and it seems like a great fit for me and i would love to discuss it further`,
    `- Also mention in my last role at Neutrinos I was the founding engineer of the company and i was the one who built the entire product line from scratch`,
    `- Also mention that I wanted to reach out because I firmly believe that I would be a valuable asset to your team.`,
    `- Mention enthusiasm for the role and company but not too much`,
    `- Briefly highlight relevant skills and experience`,
    `- Avoid overly formal or generic corporate language`,
    `- End with a polite closing and willingness to discuss further and hearing from them soon`,
    ``,
    `Do not use buzzwords, exaggerated claims, or filler content.`,
    `Do not include a greeting line or a signature — just the body paragraphs.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateCoverLetter({ company, role, profile, openaiKey }) {
  const applicantName = profile?.applicantName || '';
  const applicantHeadline = profile?.applicantHeadline || '';
  const applicantSkills = profile?.applicantSkills || '';

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const openai = getClient(openaiKey);

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildUserPrompt({
          company,
          role,
          applicantName,
          applicantHeadline,
          applicantSkills,
        }),
      },
    ],
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Cover letter generation returned empty content');
  return text;
}

export function buildEmailFromCoverLetter({ hrName, company, role, coverLetter, profile }) {
  const applicantName = (profile?.applicantName || '').trim() || 'Your Name';
  const applicantPhone = (profile?.applicantPhone || '').trim() || '';
  const greetingName = hrName?.trim() ? hrName.trim() : 'Team';
  const letter = String(coverLetter || '').trim();

  const subject = `Application for ${role} — ${applicantName}`.trim();

  const signatureLines = ['Best regards,', applicantName];
  if (applicantPhone) signatureLines.push(`Phone: +91 ${applicantPhone}`);

  const body = normalizeEmailBody(
    [
      `Hi ${greetingName},`,
      '',
      letter,
      '',
      `I've attached my resume for your review and would welcome the chance to discuss how I can contribute to ${company}.`,
      '',
      ...signatureLines,
    ].join('\n'),
  );

  return { subject, body };
}
