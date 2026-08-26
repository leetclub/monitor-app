import { useState } from 'react';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';
import {
  repeatedQaIssues,
  type QaIssueFrequencyRow,
} from '@/lib/qaIssueFrequency';

function shortWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const full = formatKuwaitDateTime(iso);
  if (full && full !== '—') {
    // Drop year when crowded: "26 Aug 2026, 14:02" → keep as-is for clarity
    return full;
  }
  return iso.slice(0, 10);
}

/**
 * Fourth QA popup section: how often the same SafetyCulture finding repeats
 * across inspections in the selected date range.
 */
export function QaIssueFrequencySection({
  rows,
  loading,
  dateFrom,
  dateTo,
  inspectionCount,
  onSelectAudit,
  selectedAuditId,
}: {
  rows: QaIssueFrequencyRow[];
  loading?: boolean;
  dateFrom?: string;
  dateTo?: string;
  inspectionCount: number;
  onSelectAudit?: (auditId: string) => void;
  selectedAuditId?: string;
}) {
  const repeated = repeatedQaIssues(rows);
  const onceOnly = rows.filter((r) => r.count === 1);
  const [expanded, setExpanded] = useState<string | null>(repeated[0]?.key ?? null);
  const rangeLabel =
    dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : dateFrom || dateTo || 'selected range';

  return (
    <section className="qaIssueFreq" aria-label="Issue frequency">
      <header className="qaIssueFreqHead">
        <div>
          <p className="qaIssueFreqKicker">SafetyCulture · across visits</p>
          <h3 className="qaIssueFreqTitle">Issue frequency</h3>
        </div>
        {repeated.length > 0 ? (
          <span className="qaIssueFreqBadge" title="Findings that appear on more than one inspection">
            {repeated.length} repeated
          </span>
        ) : null}
      </header>

      <p className="qaIssueFreqLead">
        Counts how often the <strong>same finding text</strong> shows up across QC inspections for this
        machine in <strong>{rangeLabel}</strong>
        {inspectionCount > 0 ? ` (${inspectionCount} inspection${inspectionCount === 1 ? '' : 's'})` : ''}.
        Tap a date to open that inspection above.
      </p>

      {loading ? <p className="qaIssueFreqEmpty">Scanning inspection findings…</p> : null}

      {!loading && !rows.length ? (
        <p className="qaIssueFreqEmpty">
          No SafetyCulture key findings in this date range. Widen From/To or select another machine.
        </p>
      ) : null}

      {!loading && rows.length > 0 && !repeated.length ? (
        <p className="qaIssueFreqEmpty">
          {rows.length} finding{rows.length === 1 ? '' : 's'} appeared once — nothing repeated across
          visits yet. Widen the date range to catch older repeats.
        </p>
      ) : null}

      {repeated.length > 0 ? (
        <ul className="qaIssueFreqList">
          {repeated.map((row) => (
            <FrequencyRow
              key={row.key}
              row={row}
              expanded={expanded === row.key}
              onToggle={() => setExpanded((k) => (k === row.key ? null : row.key))}
              onSelectAudit={onSelectAudit}
              selectedAuditId={selectedAuditId}
            />
          ))}
        </ul>
      ) : null}

      {!loading && onceOnly.length > 0 ? (
        <details className="qaIssueFreqOnce">
          <summary>
            Seen once ({onceOnly.length}) — not repeated in this range
          </summary>
          <ul className="qaIssueFreqOnceList">
            {onceOnly.slice(0, 12).map((row) => {
              const occ = row.occurrences[0];
              return (
                <li key={row.key}>
                  <span className="qaIssueFreqOnceLabel">{row.label}</span>
                  {occ?.auditId && onSelectAudit ? (
                    <button
                      type="button"
                      className="qaIssueFreqDateBtn"
                      onClick={() => onSelectAudit(occ.auditId)}
                    >
                      {shortWhen(occ.at)}
                    </button>
                  ) : (
                    <span className="qaIssueFreqOnceWhen">{shortWhen(row.lastSeenAt)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function FrequencyRow({
  row,
  expanded,
  onToggle,
  onSelectAudit,
  selectedAuditId,
}: {
  row: QaIssueFrequencyRow;
  expanded: boolean;
  onToggle: () => void;
  onSelectAudit?: (auditId: string) => void;
  selectedAuditId?: string;
}) {
  return (
    <li className={`qaIssueFreqRow${expanded ? ' qaIssueFreqRow--open' : ''}`}>
      <button type="button" className="qaIssueFreqRowBtn" onClick={onToggle} aria-expanded={expanded}>
        <span className="qaIssueFreqCount" title="Times this finding appeared">
          ×{row.count}
        </span>
        <span className="qaIssueFreqLabel">{row.label}</span>
        <span className="qaIssueFreqLast" title="Most recent inspection with this finding">
          Last {shortWhen(row.lastSeenAt)}
        </span>
        <span className="qaIssueFreqChevron" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <div className="qaIssueFreqDetail">
          <p className="qaIssueFreqDetailMeta">
            Seen on <strong>{row.count}</strong> inspection{row.count === 1 ? '' : 's'} · first{' '}
            {shortWhen(row.firstSeenAt)} · last {shortWhen(row.lastSeenAt)}
          </p>
          <ul className="qaIssueFreqOcc">
            {row.occurrences.map((occ) => {
              const active = occ.auditId && occ.auditId === selectedAuditId;
              return (
                <li key={`${occ.auditId}-${occ.at}`}>
                  {occ.auditId && onSelectAudit ? (
                    <button
                      type="button"
                      className={`qaIssueFreqDateBtn${active ? ' qaIssueFreqDateBtn--active' : ''}`}
                      onClick={() => onSelectAudit(occ.auditId)}
                      title="Show this inspection in the history table"
                    >
                      {shortWhen(occ.at)}
                      {occ.score != null ? ` · ${Math.round(occ.score)}%` : ''}
                    </button>
                  ) : (
                    <span>
                      {shortWhen(occ.at)}
                      {occ.score != null ? ` · ${Math.round(occ.score)}%` : ''}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
