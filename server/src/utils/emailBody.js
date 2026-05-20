/** Collapse extra blank lines and trim lines (fixes signature spacing). */
export function normalizeEmailBody(body) {
  return String(body || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function bodyToHtml(body) {
  const normalized = normalizeEmailBody(body);
  const parts = [];
  let lastWasBreak = false;

  for (const line of normalized.split('\n')) {
    if (line.trim() === '') {
      if (!lastWasBreak) {
        parts.push('<br/>');
        lastWasBreak = true;
      }
      continue;
    }
    lastWasBreak = false;
    parts.push(
      `<p style="margin:0 0 6px 0;line-height:1.5;">${escapeHtml(line)}</p>`,
    );
  }

  return parts.join('\n');
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
