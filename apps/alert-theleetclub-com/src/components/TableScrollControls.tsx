import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const DRAG_THRESHOLD_PX = 8;

/**
 * Wraps a wide fleet table with left/right scroll buttons and drag-to-pan,
 * so sideways browsing does not require the thin scrollbar alone.
 * Clicks on rows/cells still work — pan only starts after a small drag.
 */
export function TableScrollControls({
  children,
  className = '',
  scrollerClassName = '',
  hint = true,
}: {
  children: ReactNode;
  className?: string;
  scrollerClassName?: string;
  hint?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const drag = useRef<{
    tracking: boolean;
    panning: boolean;
    pointerId: number | null;
    startX: number;
    startScroll: number;
  }>({
    tracking: false,
    panning: false,
    pointerId: null,
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
  }, [refresh]);

  function scrollByDir(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.55), behavior: 'smooth' });
  }

  function endDrag(pointerId?: number) {
    const el = scrollerRef.current;
    const wasPanning = drag.current.panning;
    const pid = pointerId ?? drag.current.pointerId;
    drag.current.tracking = false;
    drag.current.panning = false;
    drag.current.pointerId = null;
    el?.classList.remove('stitchTableScroll--dragging');
    if (wasPanning && el && pid != null) {
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className={`stitchTableScrollWrap ${className}`.trim()}>
      {hint ? (
        <p className="stitchTableScrollHint stitchTableScrollHint--tight">
          Swipe / drag sideways · use ◀ ▶
        </p>
      ) : null}
      <div className="stitchTableScrollNav">
        <button
          type="button"
          className="stitchTableScrollBtn"
          aria-label="Scroll table left"
          disabled={!canLeft}
          onClick={() => scrollByDir(-1)}
        >
          ◀
        </button>
        <button
          type="button"
          className="stitchTableScrollBtn"
          aria-label="Scroll table right"
          disabled={!canRight}
          onClick={() => scrollByDir(1)}
        >
          ▶
        </button>
      </div>
      <div
        ref={scrollerRef}
        className={`stitchTableScroll stitchTableScroll--pan ${scrollerClassName}`.trim()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const t = e.target as HTMLElement | null;
          if (t?.closest('button, a, input, select, textarea, label')) return;
          const el = scrollerRef.current;
          if (!el) return;
          // Track only — do not capture yet, so row/cell clicks still fire.
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
            el.classList.add('stitchTableScroll--dragging');
          }
          el.scrollLeft = drag.current.startScroll - dx;
        }}
        onPointerUp={(e) => endDrag(e.pointerId)}
        onPointerCancel={() => endDrag()}
      >
        {children}
      </div>
    </div>
  );
}
