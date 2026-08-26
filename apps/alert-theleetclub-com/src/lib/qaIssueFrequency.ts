import type { QaMachineAuditRow } from '@/lib/leetWorkflowApi';

export type QaIssueOccurrence = {
  auditId: string;
  at: string;
  dateLabel: string;
  score: number | null;
};

export type QaIssueFrequencyRow = {
  /** Stable key for grouping (normalized). */
  key: string;
  /** Best display label (longest / first non-empty). */
  label: string;
  count: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  occurrences: QaIssueOccurrence[];
};

/** Normalize finding text so near-identical SC lines group together. */
export function normalizeQaIssueKey(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9\s'%./+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function occurrenceSortKey(at: string): number {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Aggregate SafetyCulture keyFindings across inspections for one machine.
 * Same (normalized) finding text → one row with count + occurrence dates.
 */
export function buildQaIssueFrequency(audits: QaMachineAuditRow[]): QaIssueFrequencyRow[] {
  const map = new Map<
    string,
    {
      label: string;
      occurrences: QaIssueOccurrence[];
      seenAudit: Set<string>;
    }
  >();

  for (const audit of audits) {
    const findings = audit.keyFindings;
    if (!Array.isArray(findings) || !findings.length) continue;
    const auditId = String(audit.auditId || '').trim();
    const at = String(audit.lastVisitAt || audit.lastVisitDate || '').trim();
    if (!at && !auditId) continue;
    const dateLabel = String(audit.lastVisitDate || at.slice(0, 10) || '—');
    const score =
      typeof audit.score === 'number' && Number.isFinite(audit.score) ? audit.score : null;

    // Dedupe identical findings within one audit
    const inAudit = new Set<string>();
    for (const raw of findings) {
      const label = String(raw || '').trim();
      if (label.length < 6) continue;
      const key = normalizeQaIssueKey(label);
      if (!key || key.length < 6) continue;
      if (inAudit.has(key)) continue;
      inAudit.add(key);

      let bucket = map.get(key);
      if (!bucket) {
        bucket = { label, occurrences: [], seenAudit: new Set() };
        map.set(key, bucket);
      } else if (label.length > bucket.label.length) {
        bucket.label = label;
      }

      const dedupeId = auditId || `${at}|${key}`;
      if (bucket.seenAudit.has(dedupeId)) continue;
      bucket.seenAudit.add(dedupeId);
      bucket.occurrences.push({
        auditId,
        at: at || dateLabel,
        dateLabel,
        score,
      });
    }
  }

  const rows: QaIssueFrequencyRow[] = [];
  for (const [key, bucket] of map) {
    const occurrences = [...bucket.occurrences].sort(
      (a, b) => occurrenceSortKey(b.at) - occurrenceSortKey(a.at),
    );
    if (!occurrences.length) continue;
    rows.push({
      key,
      label: bucket.label,
      count: occurrences.length,
      firstSeenAt: occurrences[occurrences.length - 1]?.at ?? null,
      lastSeenAt: occurrences[0]?.at ?? null,
      occurrences,
    });
  }

  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return occurrenceSortKey(b.lastSeenAt || '') - occurrenceSortKey(a.lastSeenAt || '');
  });

  return rows;
}

/** Rows that appear on more than one inspection (true repeats). */
export function repeatedQaIssues(rows: QaIssueFrequencyRow[]): QaIssueFrequencyRow[] {
  return rows.filter((r) => r.count >= 2);
}
