/** Client-side bullet validation (mirrors people-api qa_manual_summary_lib). */

const BULLET_PREFIX = /^(\s*)([-•*]|\d+[\.\)])\s+\S/;

export function countBulletLines(text: string): number {
  return text
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter(Boolean).length;
}

export function validateBulletSummary(text: string): string | null {
  const raw = text.trim();
  if (!raw) return 'Summary is required';
  const lines = raw.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean);
  if (!lines.length) return 'Summary is required';
  for (const ln of lines) {
    if (!BULLET_PREFIX.test(ln)) {
      return 'Each line must start with a bullet (-, •, *, or 1. / 1))';
    }
  }
  if (lines.length < 3) return 'Enter at least 3 bullet points';
  if (lines.length > 5) return 'At most 5 bullet points';
  return null;
}

export function parseBulletLines(text: string): string[] {
  const out: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    let s = ln.trim();
    if (!s) continue;
    s = s.replace(/^[-•*]\s*/, '');
    s = s.replace(/^\d+[\.\)]\s*/, '');
    s = s.trim();
    if (s) out.push(s);
  }
  return out;
}
