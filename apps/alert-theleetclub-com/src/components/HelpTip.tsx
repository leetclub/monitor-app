import { useEffect, useId, useRef, useState } from 'react';

/**
 * Visible tooltip on hover/focus; tap toggles “pinned” open (mobile). Native `title` is unreliable in embedded views / touch.
 */
export function HelpTip(props: { text: string; id?: string }) {
  const { text, id } = props;
  const rid = useId();
  const tooltipId = id ?? rid;
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!pinned) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setPinned(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pinned]);

  return (
    <span className="helpTipWrap" ref={wrapRef}>
      <button
        type="button"
        className="helpTip"
        aria-label={text}
        aria-describedby={tooltipId}
        aria-expanded={pinned}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
      >
        <span aria-hidden className="helpTipGlyph">
          ⓘ
        </span>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={pinned ? 'helpTipBubble helpTipPinned' : 'helpTipBubble'}
        onClick={(e) => e.stopPropagation()}
      >
        {text}
      </span>
    </span>
  );
}
