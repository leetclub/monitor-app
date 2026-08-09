import type { ReactNode } from 'react';

/**
 * Compact search + risk-sort controls for StitchOpsPanel toolbar.
 * Keeps styling local so shared stitch CSS stays untouched.
 */
export function FleetOpsToolbarExtras({
  search,
  onSearchChange,
  riskSort,
  onRiskSortChange,
  searchPlaceholder = 'Search machine…',
}: {
  search: string;
  onSearchChange: (v: string) => void;
  riskSort: boolean;
  onRiskSortChange: (v: boolean) => void;
  searchPlaceholder?: string;
}): ReactNode {
  return (
    <>
      <label className="fleetOpsSearch" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="sr-only">Search machines</span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search machines by name or id"
          style={{
            minHeight: 36,
            minWidth: 140,
            maxWidth: 220,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid var(--outline-variant, #5c5654)',
            background: 'var(--bg-elevated, #252a32)',
            color: '#dee2ec',
            fontSize: 13,
            fontWeight: 500,
          }}
        />
      </label>
      <button
        type="button"
        className="stitchOpsRefresh stitchOpsRefreshCompact"
        aria-pressed={riskSort}
        title="Sort by highest operational risk (downtime, stale sales, cleaning overdue, alert reasons)"
        onClick={() => onRiskSortChange(!riskSort)}
        style={
          riskSort
            ? { borderColor: '#c45c26', background: 'rgba(196, 92, 38, 0.22)', color: '#ffd4c2' }
            : undefined
        }
      >
        {riskSort ? 'Risk ↓' : 'Risk sort'}
      </button>
    </>
  );
}
