import type { ReactNode } from 'react';

export type V2Col = { key: string; label: string; sub?: string; sticky?: boolean };

export function V2DataTable({
  columns,
  rows,
  empty,
  footer,
}: {
  columns: V2Col[];
  rows: Array<{ id: string; cells: Record<string, ReactNode>; tone?: 'crit' | 'warn' | '' }>;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="v2DataTableWrap">
      <table className="v2DataTable">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.sticky ? 'isSticky' : undefined}>
                <span>{c.label}</span>
                {c.sub ? <small>{c.sub}</small> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.tone === 'crit' ? 'isCrit' : r.tone === 'warn' ? 'isWarn' : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.sticky ? 'isSticky' : undefined}>
                  {r.cells[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer ? <div className="v2DataTableFoot">{footer}</div> : null}
    </div>
  );
}
