import {
  applyComparePreset,
  type ComparePresetId,
  type CompareSelection,
} from '@/components/ComparePresetPicker';

const PRO_PRESETS: { id: ComparePresetId; label: string; short: string }[] = [
  { id: 'today_vs_yesterday', label: 'Today vs Yesterday', short: 'Today' },
  { id: 'yesterday_vs_day_before', label: 'Yesterday vs Day Before', short: 'Yest.' },
  { id: 'wtd_vs_last_week', label: 'Week to date vs last week', short: 'WTD' },
  { id: 'mtd_vs_mtd', label: 'Month to date', short: 'MTD' },
  { id: 'today_vs_same_day_last_week', label: 'Same day last week', short: 'Same day' },
];

/** Large touch chips for iPad — replaces cramped Classic select. */
export function ProCompareChips({
  value,
  onChange,
}: {
  value: CompareSelection;
  onChange: (next: CompareSelection) => void;
}) {
  return (
    <div className="proCompare" role="group" aria-label="Compare period">
      <p className="proCompareLabel">Compare</p>
      <div className="proCompareChips">
        {PRO_PRESETS.map((p) => {
          const active = value.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`proCompareChip${active ? ' proCompareChipActive' : ''}`}
              aria-pressed={active}
              title={p.label}
              onClick={() => onChange(applyComparePreset(p.id, value))}
            >
              <span className="proCompareChipShort">{p.short}</span>
              <span className="proCompareChipLong">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
