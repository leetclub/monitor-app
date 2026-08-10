import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatKwd } from '@/lib/salesDisplay';
import {
  compareNumbers,
  compareStrings,
  cycleColumnSort,
  sortDirForColumn,
  type ColumnSortState,
} from '@/lib/tableColumnSort';
import {
  getAlertModalPortal,
  modalBackdropHandlers,
  modalPanelHandlers,
  useAlertModal,
} from '@/lib/useAlertModal';
import type { GrowthGroupSlice, GrowthGroupKey, GrowthMachineRow } from '@/features/performance/perfTypes';

const GROUP_LABEL: Record<GrowthGroupKey, string> = {
  all: 'All machines',
  top5: 'Top 5 (by sales)',
  lowest5: 'Lowest 5 (by sales)',
};

type SortKey = 'machineName' | 'periodKd' | 'compareKd' | 'growth' | 'index';

function rateTone(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '';
  if (rate >= 100) return 'alertSalesUp';
  return 'alertSalesDown';
}

/** Growth change % from index (current ÷ compare × 100). */
function growthDeltaPct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const d = Math.round((rate - 100) * 10) / 10;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}%`;
}

function growthDeltaNum(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return rate - 100;
}

function SortTh({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: SortKey;
  sort: ColumnSortState<SortKey>;
  onSort: (k: SortKey) => void;
}) {
  const dir = sortDirForColumn(sort, col);
  const glyph = dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '⇅';
  return (
    <th>
      <button type="button" className="perfSortThBtn" onClick={() => onSort(col)}>
        {label} {glyph}
      </button>
    </th>
  );
}

function sortMachines(
  rows: GrowthMachineRow[],
  sort: ColumnSortState<SortKey>,
): GrowthMachineRow[] {
  const out = [...rows];
  const col = sort.column;
  const dir = sort.dir;
  if (!col || !dir) return out;
  out.sort((a, b) => {
    switch (col) {
      case 'machineName':
        return compareStrings(a.machineName, b.machineName, dir);
      case 'periodKd':
        return compareNumbers(a.periodKd, b.periodKd, dir);
      case 'compareKd':
        return compareNumbers(a.compareKd, b.compareKd, dir);
      case 'growth':
        return compareNumbers(growthDeltaNum(a.ratePct), growthDeltaNum(b.ratePct), dir);
      case 'index':
        return compareNumbers(a.ratePct, b.ratePct, dir);
      default:
        return 0;
    }
  });
  return out;
}

export function GrowthCompareModal({
  title,
  subtitle,
  explain,
  compareLabel,
  indexLabel = 'Index',
  groups,
  onOpenMachineProducts,
  onClose,
}: {
  title: string;
  subtitle?: string;
  /** Longer explanations shown under the title (card stays short). */
  explain?: string[];
  compareLabel: string;
  /** Column / summary for period ÷ compare × 100. */
  indexLabel?: string;
  groups: Partial<Record<GrowthGroupKey, GrowthGroupSlice | null | undefined>>;
  /** Tap a machine row → product mix popup (name + cups + trends). */
  onOpenMachineProducts?: (machineId: string, machineName: string) => void;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();
  const keys: GrowthGroupKey[] = ['all', 'top5', 'lowest5'];
  const [sortByGroup, setSortByGroup] = useState<Partial<Record<GrowthGroupKey, ColumnSortState<SortKey>>>>({});

  const sortedGroups = useMemo(() => {
    const out: Partial<Record<GrowthGroupKey, GrowthMachineRow[]>> = {};
    for (const key of keys) {
      const g = groups[key];
      const sort = sortByGroup[key] || { column: 'periodKd', dir: 'desc' };
      out[key] = sortMachines(g?.machines || [], sort);
    }
    return out;
  }, [groups, sortByGroup]);

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="perf-growth-modal-title"
      {...backdrop}
    >
      <div className="salesHistoryModal perfGrowthModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Performance · period compare</p>
            <h2 id="perf-growth-modal-title" className="salesHistoryTitle">
              {title}
            </h2>
            {subtitle ? <p className="salesHistorySub">{subtitle}</p> : null}
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="salesHistoryBody">

        <div className="perfGrowthModalBody">
          {explain?.length ? (
            <ul className="perfGrowthExplain">
              {explain.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {onOpenMachineProducts ? (
            <p className="perfMuted" style={{ marginTop: 0 }}>
              This list is the growth group only (All / Top 5 / Lowest 5). Tap a row for a shortcut — or use{' '}
              <strong>Product mix</strong> on the Performance page to search any machine.
            </p>
          ) : null}
          {keys.map((key) => {
            const g = groups[key];
            if (!g) return null;
            const sort = sortByGroup[key] || { column: 'periodKd' as SortKey, dir: 'desc' as const };
            const rows = sortedGroups[key] || [];
            const setSort = (col: SortKey) =>
              setSortByGroup((prev) => ({
                ...prev,
                [key]: cycleColumnSort(prev[key] || { column: 'periodKd', dir: 'desc' }, col),
              }));
            return (
              <section key={key} className="perfGrowthGroup">
                <header className="perfGrowthGroupHead">
                  <h3>{GROUP_LABEL[key]}</h3>
                  <div className="perfGrowthGroupSummary">
                    <span className={rateTone(g.ratePct)}>
                      Growth <strong>{growthDeltaPct(g.ratePct)}</strong>
                    </span>
                    <span>
                      Period <strong>{formatKwd(g.periodKd)}</strong>
                    </span>
                    <span>
                      {compareLabel} <strong>{formatKwd(g.compareKd)}</strong>
                    </span>
                    <span className={rateTone(g.ratePct)}>
                      {indexLabel} <strong>{g.ratePct != null ? `${g.ratePct}%` : '—'}</strong>
                    </span>
                  </div>
                </header>
                {rows.length ? (
                  <div className="perfGrowthTableWrap">
                    <table className="perfGrowthTable">
                      <thead>
                        <tr>
                          <SortTh label="Machine" col="machineName" sort={sort} onSort={setSort} />
                          <SortTh label="Period KD" col="periodKd" sort={sort} onSort={setSort} />
                          <SortTh label={compareLabel} col="compareKd" sort={sort} onSort={setSort} />
                          <SortTh label="Growth" col="growth" sort={sort} onSort={setSort} />
                          <SortTh label={indexLabel} col="index" sort={sort} onSort={setSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const clickable = Boolean(onOpenMachineProducts);
                          return (
                            <tr
                              key={row.machineId}
                              className={clickable ? 'perfGrowthRowClick' : undefined}
                              onClick={
                                clickable
                                  ? () => onOpenMachineProducts?.(row.machineId, row.machineName)
                                  : undefined
                              }
                              title={clickable ? 'Open product mix' : undefined}
                            >
                              <td>{row.machineName}</td>
                              <td>{formatKwd(row.periodKd)}</td>
                              <td>{formatKwd(row.compareKd)}</td>
                              <td className={rateTone(row.ratePct)}>{growthDeltaPct(row.ratePct)}</td>
                              <td className={rateTone(row.ratePct)}>
                                {row.ratePct != null ? `${row.ratePct}%` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="perfMuted">No machines in this group.</p>
                )}
              </section>
            );
          })}
        </div>
      
        </div></div>
    </div>,
    getAlertModalPortal(),
  );
}
