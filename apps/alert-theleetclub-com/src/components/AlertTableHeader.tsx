import { InfoTip } from '@/components/InfoTip';

/** Compact two-line table header — readable on tablet/laptop (Stitch-inspired). */
export type HeaderDisplay = { main: string; sub?: string };

function SortArrow({ dir }: { dir: 'asc' | 'desc' | null }) {
  const glyph = dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '⇅';
  return (
    <span
      className={`alertThSortIcon${dir ? ` alertThSortIconActive alertThSortIcon${dir}` : ''}`}
      aria-hidden
    >
      {glyph}
    </span>
  );
}

export function AlertTableHeader({
  label,
  title,
  className = '',
  sortable = false,
  sortDir = null,
  onSortClick,
}: {
  label: HeaderDisplay;
  title?: string;
  className?: string;
  sortable?: boolean;
  sortDir?: 'asc' | 'desc' | null;
  onSortClick?: () => void;
}) {
  const subText = label.sub?.trim() || '\u00a0';
  const helpText = title?.trim() || '';

  return (
    <th
      className={`alertTh ${sortable ? 'alertThSortable' : ''} ${className}`.trim()}
      title={sortable ? undefined : helpText || undefined}
    >
      <div className="alertThInner">
        <span className="alertThMain">
          {sortable && onSortClick ? (
            <button
              type="button"
              className="alertThSortBtn"
              onClick={onSortClick}
              aria-label={`Sort by ${label.main}${sortDir === 'desc' ? ', highest first' : sortDir === 'asc' ? ', lowest first' : ''}`}
            >
              <span className="alertThLabel">{label.main}</span>
              <SortArrow dir={sortDir} />
            </button>
          ) : (
            <span className="alertThLabel">{label.main}</span>
          )}
          {helpText ? <InfoTip text={helpText} label={`${label.main} — help`} /> : null}
        </span>
        <span
          className={`alertThSub${label.sub ? '' : ' alertThSubSpacer'}`}
          aria-hidden={!label.sub}
        >
          {subText}
        </span>
      </div>
    </th>
  );
}
