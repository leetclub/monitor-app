const KEY_TERMS = [
  'footfall',
  'sales target',
  'missed potential',
  'miss potential',
] as const;

/** Bold product terms in labels; leave numbers plain elsewhere. */
export function TermLabel({ text }: { text: string }) {
  const lower = text.toLowerCase();
  let match: (typeof KEY_TERMS)[number] | null = null;
  for (const t of KEY_TERMS) {
    if (lower.includes(t)) {
      match = t;
      break;
    }
  }
  if (!match) return <>{text}</>;
  const idx = lower.indexOf(match);
  const before = text.slice(0, idx);
  const term = text.slice(idx, idx + match.length);
  const after = text.slice(idx + match.length);
  return (
    <>
      {before}
      <span className="termKey">{term}</span>
      {after}
    </>
  );
}
