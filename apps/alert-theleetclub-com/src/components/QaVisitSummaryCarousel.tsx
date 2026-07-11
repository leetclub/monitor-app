import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { formatKuwaitDateTime } from '@/lib/formatKuwait';

export type QaSummarySlide = {
  id: 'manual' | 'safetyculture' | 'ai';
  title: string;
  shortLabel: string;
  bullets: string[];
  note: string;
  meta?: string | null;
  empty?: boolean;
};

const ROTATE_MS = 6800;

const SLIDE_THEME: Record<
  QaSummarySlide['id'],
  { accent: string; subtitle: string; icon: 'pen' | 'scan' | 'report' }
> = {
  manual: { accent: '#f59e0b', subtitle: 'Operator entry · Admin QA visit', icon: 'pen' },
  safetyculture: { accent: '#38bdf8', subtitle: 'SafetyCulture · issue fields', icon: 'scan' },
  ai: { accent: '#a78bfa', subtitle: 'SafetyCulture · report digest', icon: 'report' },
};

const SLOT_ORDER: QaSummarySlide['id'][] = ['manual', 'safetyculture', 'ai'];

const TEASER_COPY: Record<
  QaSummarySlide['id'],
  { bullet: string; note: string }
> = {
  manual: {
    bullet: 'Manual bullets from Admin → QA visit will appear here.',
    note: 'Saved by operators in the QA visit admin tab.',
  },
  safetyculture: {
    bullet: 'No key findings on the latest SafetyCulture inspection.',
    note: 'Non-conformances and issues appear here when the audit includes scored findings.',
  },
  ai: {
    bullet: 'Condensed bullets from the full inspection report.',
    note: 'Available when a SafetyCulture audit PDF exists.',
  },
};

type CarouselSlot = {
  id: QaSummarySlide['id'];
  mode: 'ready' | 'teaser';
  slide: QaSummarySlide;
};

function SlideIcon({ kind, color }: { kind: 'pen' | 'scan' | 'report'; color: string }) {
  const stroke = color;
  if (kind === 'pen') {
    return (
      <svg className="qaVisitCarouselIcon" viewBox="0 0 24 24" aria-hidden fill="none" stroke={stroke}>
        <path strokeWidth="1.75" d="M12 20h9" />
        <path strokeWidth="1.75" d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    );
  }
  if (kind === 'scan') {
    return (
      <svg className="qaVisitCarouselIcon" viewBox="0 0 24 24" aria-hidden fill="none" stroke={stroke}>
        <path strokeWidth="1.75" d="M9 11l3 3L22 4" />
        <path strokeWidth="1.75" d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    );
  }
  return (
    <svg className="qaVisitCarouselIcon" viewBox="0 0 24 24" aria-hidden fill="none" stroke={stroke}>
      <path strokeWidth="1.75" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path strokeWidth="1.75" d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}

function buildCarouselSlots(slides: QaSummarySlide[]): CarouselSlot[] {
  return SLOT_ORDER.map((id) => {
    const real = slides.find((s) => s.id === id);
    if (real?.bullets.length) return { id, mode: 'ready' as const, slide: real };
    const teaser = TEASER_COPY[id];
    return {
      id,
      mode: 'teaser' as const,
      slide: {
        id,
        title: id === 'manual' ? 'Admin summary' : id === 'safetyculture' ? 'Key findings' : 'Report summary',
        shortLabel: id === 'manual' ? 'Admin' : id === 'safetyculture' ? 'Findings' : 'Report',
        bullets: [teaser.bullet],
        note: teaser.note,
      },
    };
  });
}

function SlidePanel({
  slot,
  variant,
}: {
  slot: CarouselSlot;
  variant: 'enter' | 'exit' | 'static';
}) {
  const theme = SLIDE_THEME[slot.id];
  const { slide } = slot;
  const isTeaser = slot.mode === 'teaser';

  return (
    <div
      className={[
        'qaVisitCarouselPanel',
        `qaVisitCarouselPanel--${variant}`,
        isTeaser ? 'qaVisitCarouselPanel--teaser' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--qa-carousel-accent': theme.accent } as CSSProperties}
    >
      <header className="qaVisitCarouselHead">
        <div className="qaVisitCarouselBrand">
          <span className="qaVisitCarouselIconWrap" aria-hidden="true">
            <SlideIcon kind={theme.icon} color={theme.accent} />
          </span>
          <div>
            <p className="qaVisitCarouselKicker">{theme.subtitle}</p>
            <h3 className="qaVisitCarouselTitle">{slide.title}</h3>
          </div>
        </div>
      </header>

      <ul className="qaVisitCarouselBullets">
        {(isTeaser ? slide.bullets.slice(0, 1) : slide.bullets.slice(0, 5)).map((b, i) => (
          <li key={`${slide.id}-${i}`} style={{ animationDelay: `${90 + i * 70}ms` }}>
            <span className="qaVisitCarouselBulletMark" aria-hidden="true" />
            <span className="qaVisitCarouselBulletText">{b}</span>
          </li>
        ))}
      </ul>

      <footer className="qaVisitCarouselFootnote">
        <p className="qaVisitCarouselNote">{slide.note}</p>
        {!isTeaser && slide.meta ? <p className="qaVisitCarouselMeta">{slide.meta}</p> : null}
      </footer>
    </div>
  );
}

export function QaVisitSummaryCarousel({
  slides,
  machineKey,
}: {
  slides: QaSummarySlide[];
  machineKey: string;
}) {
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const slotModesRef = useRef<string>('');

  const slots = useMemo(() => buildCarouselSlots(slides), [slides]);
  const count = slots.length;
  const safeActive = active % count;
  const current = slots[safeActive];
  const theme = SLIDE_THEME[current.id];
  const leavingSlot = leaving != null ? slots[leaving] : null;
  const readyCount = slots.filter((s) => s.mode === 'ready').length;
  const slotModes = slots.map((s) => `${s.id}:${s.mode}`).join('|');

  const goTo = useCallback(
    (next: number | ((i: number) => number)) => {
      setActive((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (resolved % count !== prev % count) {
          setLeaving(prev % count);
          if (leaveTimerRef.current != null) window.clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = window.setTimeout(() => setLeaving(null), 480);
        }
        return resolved;
      });
      setTick((t) => t + 1);
    },
    [count],
  );

  useEffect(() => {
    setActive(0);
    setLeaving(null);
    setTick((t) => t + 1);
    slotModesRef.current = '';
  }, [machineKey]);

  useEffect(() => {
    if (slotModesRef.current && slotModesRef.current !== slotModes) {
      const upgraded = slots.some(
        (s, i) => s.mode === 'ready' && slotModesRef.current.split('|')[i]?.endsWith(':teaser'),
      );
      if (upgraded && leaving == null) {
        setTick((t) => t + 1);
      }
    }
    slotModesRef.current = slotModes;
  }, [slotModes, slots, leaving]);

  useEffect(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (paused) return;
    timerRef.current = window.setInterval(() => {
      goTo((i) => (i + 1) % count);
    }, ROTATE_MS);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [count, paused, machineKey, goTo]);

  useEffect(
    () => () => {
      if (leaveTimerRef.current != null) window.clearTimeout(leaveTimerRef.current);
    },
    [],
  );

  return (
    <section
      className="qaVisitCarousel qaVisitCarousel--unified qaVisitCarousel--live"
      aria-label="QA visit summaries"
      aria-live="polite"
      style={{ '--qa-carousel-accent': theme.accent } as CSSProperties}
    >
      <div className="qaVisitCarouselSegments" aria-hidden="true">
        {slots.map((slot, index) => {
          const isActive = index === safeActive;
          const isDone = index < safeActive;
          return (
            <div
              key={slot.id}
              className={[
                'qaVisitCarouselSegment',
                slot.mode === 'teaser' ? 'qaVisitCarouselSegment--teaser' : '',
                isActive ? 'qaVisitCarouselSegment--active' : '',
                isDone ? 'qaVisitCarouselSegment--done' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {isActive ? (
                <span
                  key={tick}
                  className="qaVisitCarouselSegmentFill"
                  style={{ animationDuration: paused ? '0ms' : `${ROTATE_MS}ms` }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className={`qaVisitCarouselStage${leavingSlot ? ' qaVisitCarouselStage--crossfade' : ''}`}>
        {leavingSlot ? <SlidePanel slot={leavingSlot} variant="exit" /> : null}
        <SlidePanel
          key={`${current.id}-${current.mode}-${safeActive}`}
          slot={current}
          variant="enter"
        />
        <span
          className="qaVisitCarouselCounter qaVisitCarouselCounter--float"
          aria-label={`Slide ${safeActive + 1} of ${count}`}
        >
          {String(safeActive + 1).padStart(2, '0')}
          <span className="qaVisitCarouselCounterSep">/</span>
          {String(count).padStart(2, '0')}
        </span>
      </div>

      <div
        className="qaVisitCarouselRail"
        role="tablist"
        aria-label="Summary source"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
        }}
      >
        {slots.map((slot, index) => {
          const t = SLIDE_THEME[slot.id];
          const isActive = index === safeActive;
          return (
            <button
              key={slot.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={slot.slide.title}
              className={[
                'qaVisitCarouselTab',
                isActive ? 'qaVisitCarouselTab--active' : '',
                slot.mode === 'teaser' ? 'qaVisitCarouselTab--teaser' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ '--qa-tab-accent': t.accent } as CSSProperties}
              onClick={() => goTo(index)}
            >
              <SlideIcon kind={t.icon} color={isActive ? t.accent : '#64748b'} />
              <span className="qaVisitCarouselTabLabel">{slot.slide.shortLabel}</span>
            </button>
          );
        })}
      </div>

      <p className="qaVisitCarouselRotateCue">
        {readyCount > 0
          ? `${readyCount} source${readyCount === 1 ? '' : 's'} live · rotates every few seconds`
          : 'Three summary sources · rotates automatically'}
      </p>
    </section>
  );
}

export function buildQaSummarySlides(input: {
  manualBullets: string[];
  scKeyFindings: string[];
  aiBullets: string[];
  savedAt?: string | null;
  savedBy?: string | null;
  inspectionAt?: string | null;
}): QaSummarySlide[] {
  const slides: QaSummarySlide[] = [];
  const { manualBullets, scKeyFindings, aiBullets, savedAt, savedBy, inspectionAt } = input;

  if (manualBullets.length) {
    slides.push({
      id: 'manual',
      title: 'Admin summary',
      shortLabel: 'Admin',
      bullets: manualBullets,
      note: 'Latest manual entry for this machine.',
      meta: savedAt
        ? `Saved ${formatKuwaitDateTime(savedAt)}${savedBy ? ` · ${savedBy}` : ''}`
        : null,
    });
  }
  if (scKeyFindings.length) {
    slides.push({
      id: 'safetyculture',
      title: 'Key findings',
      shortLabel: 'Findings',
      bullets: scKeyFindings,
      note: 'Non-conformances and issues from the selected inspection.',
      meta: inspectionAt ? `Inspection ${formatKuwaitDateTime(inspectionAt)}` : null,
    });
  }
  if (aiBullets.length) {
    slides.push({
      id: 'ai',
      title: 'Report summary',
      shortLabel: 'Report',
      bullets: aiBullets,
      note: 'Condensed bullets from the full inspection report.',
    });
  }
  return slides;
}

export function qaSummarySlideKey(slides: QaSummarySlide[]): string {
  return slides.map((s) => `${s.id}:${s.bullets.length}`).join('|');
}
