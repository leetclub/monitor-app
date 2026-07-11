import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

function useFinePointerHover(): boolean {
  const [fine, setFine] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  });
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setFine(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return fine;
}

/**
 * Column help: hover popover on mouse (PC), tap toggle on touch (iPad).
 * Popover is portaled so table overflow does not clip it.
 * Pass `children` to use the label (or any inline target) instead of a visible ? icon.
 */
export function InfoTip({
  text,
  label = 'Column help',
  children,
}: {
  text: string;
  label?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const hoverOffRef = useRef<number | null>(null);
  const finePointer = useFinePointerHover();
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});

  const positionPopover = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(280, Math.max(220, window.innerWidth * 0.7));
    let left = rect.left + rect.width / 2;
    const margin = 8;
    const half = width / 2;
    left = Math.max(margin + half, Math.min(window.innerWidth - margin - half, left));
    setPopoverStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      transform: 'translateX(-50%)',
      width,
      zIndex: 10050,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    positionPopover();
    const onReflow = () => positionPopover();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const pop = document.getElementById(id);
      if (pop?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('touchstart', onDoc);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, id]);

  useEffect(
    () => () => {
      if (hoverOffRef.current != null) window.clearTimeout(hoverOffRef.current);
    },
    [],
  );

  if (!text.trim()) return children ? <>{children}</> : null;

  const showHover = () => {
    if (!finePointer) return;
    if (hoverOffRef.current != null) {
      window.clearTimeout(hoverOffRef.current);
      hoverOffRef.current = null;
    }
    setOpen(true);
  };

  const hideHover = () => {
    if (!finePointer) return;
    hoverOffRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  const popover =
    open && typeof document !== 'undefined'
      ? createPortal(
          <span
            id={id}
            className="infoTipPopover infoTipPopoverPortal"
            role="tooltip"
            style={popoverStyle}
            onMouseEnter={showHover}
            onMouseLeave={hideHover}
          >
            {text}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span className={`infoTipWrap${children ? ' infoTipWrapInline' : ''}`.trim()}>
        <button
          ref={btnRef}
          type="button"
          className={children ? 'infoTipTrigger infoTipTriggerText' : 'infoTipBtn'}
          aria-label={label}
          aria-expanded={open}
          aria-describedby={open ? id : undefined}
          title={finePointer ? undefined : text}
          onMouseEnter={showHover}
          onMouseLeave={hideHover}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {children ?? '?'}
        </button>
      </span>
      {popover}
    </>
  );
}
