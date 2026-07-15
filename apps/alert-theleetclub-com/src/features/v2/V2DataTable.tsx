import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type V2Col = {
  key: string;
  label: string;
  sub?: string;
  sticky?: boolean;
  /** Wider columns for metric stacks */
  wide?: boolean;
};

const DRAG_THRESHOLD_PX = 8;

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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const drag = useRef({
    tracking: false,
    panning: false,
    pointerId: null as number | null,
    startX: 0,
    startScroll: 0,
  });

  const refresh = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(max > 4 && el.scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    refresh();
    const onScroll = () => refresh();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => refresh()) : null;
    ro?.observe(el);
    window.addEventListener('resize', refresh);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
      window.removeEventListener('resize', refresh);
    };
  }, [refresh, rows.length, columns.length]);

  function scrollByDir(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(280, el.clientWidth * 0.6), behavior: 'smooth' });
  }

  function endDrag(pointerId?: number) {
    const el = scrollerRef.current;
    const wasPanning = drag.current.panning;
    const pid = pointerId ?? drag.current.pointerId;
    drag.current.tracking = false;
    drag.current.panning = false;
    drag.current.pointerId = null;
    el?.classList.remove('v2TableScrollDragging');
    if (wasPanning && el && pid != null) {
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
    }
  }

  if (!rows.length) return <>{empty}</>;

  return (
    <div className="v2TableShell">
      <div className="v2TableToolbar">
        <p className="v2TableHint">Drag sideways or use arrows · scroll for all fields</p>
        <div className="v2TableNav" role="group" aria-label="Scroll workbook">
          <button type="button" className="v2TableNavBtn" aria-label="Scroll left" disabled={!canLeft} onClick={() => scrollByDir(-1)}>
            ←
          </button>
          <button type="button" className="v2TableNavBtn" aria-label="Scroll right" disabled={!canRight} onClick={() => scrollByDir(1)}>
            →
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="v2DataTableWrap"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const t = e.target as HTMLElement | null;
          if (t?.closest('button, a, input, select, textarea, label')) return;
          const el = scrollerRef.current;
          if (!el) return;
          drag.current = {
            tracking: true,
            panning: false,
            pointerId: e.pointerId,
            startX: e.clientX,
            startScroll: el.scrollLeft,
          };
        }}
        onPointerMove={(e) => {
          if (!drag.current.tracking) return;
          const el = scrollerRef.current;
          if (!el) return;
          const dx = e.clientX - drag.current.startX;
          if (!drag.current.panning) {
            if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
            drag.current.panning = true;
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
            el.classList.add('v2TableScrollDragging');
          }
          el.scrollLeft = drag.current.startScroll - dx;
        }}
        onPointerUp={(e) => endDrag(e.pointerId)}
        onPointerCancel={() => endDrag()}
      >
        <table className="v2DataTable">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={[c.sticky ? 'isSticky' : '', c.wide ? 'isWide' : ''].filter(Boolean).join(' ') || undefined}
                >
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
                  <td
                    key={c.key}
                    className={[c.sticky ? 'isSticky' : '', c.wide ? 'isWide' : ''].filter(Boolean).join(' ') || undefined}
                  >
                    {r.cells[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer ? <div className="v2DataTableFoot">{footer}</div> : null}
    </div>
  );
}
