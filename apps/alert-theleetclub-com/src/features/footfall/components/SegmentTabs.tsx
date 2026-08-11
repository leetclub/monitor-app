import { SEGMENTS, type SegmentId } from '@/features/footfall/lib/segments';

type Props = {
  value: SegmentId;
  onChange: (id: SegmentId) => void;
  counts?: Partial<Record<SegmentId, number>>;
};

export function SegmentTabs({ value, onChange, counts }: Props) {
  return (
    <div className="segmentTabs" role="tablist" aria-label="Location segment">
      {SEGMENTS.map((s) => {
        const isActive = s.id === value;
        const count = counts?.[s.id];
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`segmentTab ${isActive ? 'segmentTabActive' : ''}`}
            onClick={() => onChange(s.id)}
          >
            <span className="segmentTabLabel">
              {s.label}
              {typeof count === 'number' ? <span className="segmentTabCount">{count}</span> : null}
            </span>
            <span className="segmentTabHint">{s.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
