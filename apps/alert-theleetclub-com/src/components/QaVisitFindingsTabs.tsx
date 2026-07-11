import { useMemo, useState } from 'react';
import type { QaSummarySlide } from '@/components/QaVisitSummaryCarousel';

const TAB_ORDER: QaSummarySlide['id'][] = ['manual', 'safetyculture', 'ai'];

/** Static findings tabs for the QA Visit page (no carousel). */
export function QaVisitFindingsTabs({ slides }: { slides: QaSummarySlide[] }) {
  const slots = useMemo(() => {
    return TAB_ORDER.map((id) => {
      const hit = slides.find((s) => s.id === id);
      return (
        hit ?? {
          id,
          title: id === 'manual' ? 'Admin summary' : id === 'safetyculture' ? 'Key findings' : 'Report digest',
          shortLabel: id === 'manual' ? 'Admin' : id === 'safetyculture' ? 'Findings' : 'Report',
          bullets: [],
          note: 'No data for this source in the selected range.',
          empty: true,
        }
      );
    });
  }, [slides]);

  const [active, setActive] = useState<QaSummarySlide['id']>('safetyculture');
  const panel = slots.find((s) => s.id === active) ?? slots[0]!;

  return (
    <div className="qaVisitFindings">
      <div className="qaVisitFindingsTabs" role="tablist" aria-label="Finding sources">
        {slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            role="tab"
            aria-selected={active === slot.id}
            className={`qaVisitFindingsTab${active === slot.id ? ' qaVisitFindingsTab--active' : ''}`}
            onClick={() => setActive(slot.id)}
          >
            {slot.shortLabel}
            {slot.bullets.length ? (
              <span className="qaVisitFindingsTabCount">{slot.bullets.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="qaVisitFindingsPanel" role="tabpanel">
        <p className="qaVisitFindingsPanelTitle">{panel.title}</p>
        {panel.meta ? <p className="qaVisitFindingsMeta">{panel.meta}</p> : null}
        {panel.bullets.length ? (
          <ul className="qaVisitFindingsList">
            {panel.bullets.map((b, i) => (
              <li key={`${panel.id}-${i}`}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="qaVisitFindingsEmpty">{panel.note || 'Nothing to show.'}</p>
        )}
      </div>
    </div>
  );
}
