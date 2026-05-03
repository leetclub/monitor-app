import { useMemo } from 'react';

export type ComparePresetId =
  | 'today_vs_yesterday'
  | 'today_vs_same_day_last_week'
  | 'wtd_vs_last_week'
  | 'mtd_vs_mtd'
  | 'custom_vs_custom';

export type CompareRange = { start: string; end: string };
export type CompareSelection = {
  preset: ComparePresetId;
  a: CompareRange;
  b: CompareRange;
};

function yyyyMmDd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeekSunday(d: Date) {
  // Sunday = 0
  const out = new Date(d);
  const dow = out.getDay();
  out.setDate(out.getDate() - dow);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function todayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Default: Today vs Yesterday (calendar day, local) — used by Red Flags & Overall. */
export function createDefaultCompareSelection(): CompareSelection {
  const t0 = todayLocal();
  const t1 = addDays(t0, 1);
  const y0 = addDays(t0, -1);
  const y1 = t0;
  return {
    preset: 'today_vs_yesterday',
    a: { start: yyyyMmDd(t0), end: yyyyMmDd(t1) },
    b: { start: yyyyMmDd(y0), end: yyyyMmDd(y1) },
  };
}

export function ComparePresetPicker(props: {
  value: CompareSelection;
  onChange: (next: CompareSelection) => void;
}) {
  const labels: Record<ComparePresetId, string> = useMemo(
    () => ({
      today_vs_yesterday: 'Today VS Yesterday (default view)',
      today_vs_same_day_last_week: 'Today VS Same Day Last Week',
      wtd_vs_last_week: 'WTD VS Last Week',
      mtd_vs_mtd: 'Month to date VS Month to date',
      custom_vs_custom: 'Custom period VS Custom period',
    }),
    [],
  );

  function setPreset(preset: ComparePresetId) {
    const t0 = todayLocal();
    const t1 = addDays(t0, 1);
    const y0 = addDays(t0, -1);
    const y1 = t0;
    const lw0 = addDays(t0, -7);
    const lw1 = addDays(t1, -7);

    if (preset === 'today_vs_yesterday') {
      props.onChange({ preset, a: { start: yyyyMmDd(t0), end: yyyyMmDd(t1) }, b: { start: yyyyMmDd(y0), end: yyyyMmDd(y1) } });
      return;
    }
    if (preset === 'today_vs_same_day_last_week') {
      props.onChange({ preset, a: { start: yyyyMmDd(t0), end: yyyyMmDd(t1) }, b: { start: yyyyMmDd(lw0), end: yyyyMmDd(lw1) } });
      return;
    }
    if (preset === 'wtd_vs_last_week') {
      const ws0 = startOfWeekSunday(t0);
      const elapsedDays = Math.max(1, Math.round((t1.getTime() - ws0.getTime()) / 86400000));
      const lastWs0 = addDays(ws0, -7);
      const lastWs1 = addDays(lastWs0, 7);
      const lastSlice1 = addDays(lastWs0, elapsedDays);
      const sliceEnd = lastSlice1.getTime() <= lastWs1.getTime() ? lastSlice1 : lastWs1;
      props.onChange({
        preset,
        a: { start: yyyyMmDd(ws0), end: yyyyMmDd(t1) },
        b: { start: yyyyMmDd(lastWs0), end: yyyyMmDd(sliceEnd) },
      });
      return;
    }
    if (preset === 'mtd_vs_mtd') {
      const m0 = startOfMonth(t0);
      const prevM0 = new Date(m0.getFullYear(), m0.getMonth() - 1, 1);
      const dayOfMonth = t0.getDate();
      const prevSliceEnd = new Date(prevM0.getFullYear(), prevM0.getMonth(), dayOfMonth + 1);
      props.onChange({
        preset,
        a: { start: yyyyMmDd(m0), end: yyyyMmDd(t1) },
        b: { start: yyyyMmDd(prevM0), end: yyyyMmDd(prevSliceEnd) },
      });
      return;
    }
    props.onChange({ preset, a: props.value.a, b: props.value.b });
  }

  return (
    <div className="row comparePickerRow">
      <label>
        Preset
        <select
          value={props.value.preset}
          onChange={(e) => setPreset(e.target.value as ComparePresetId)}
        >
          {(
            Object.keys(labels) as ComparePresetId[]
          ).map((id) => (
            <option key={id} value={id}>
              {labels[id]}
            </option>
          ))}
        </select>
      </label>

      <label>
        A start
        <input
          type="date"
          value={props.value.a.start}
          disabled={props.value.preset !== 'custom_vs_custom'}
          onChange={(e) => props.onChange({ ...props.value, a: { ...props.value.a, start: e.target.value } })}
        />
      </label>
      <label>
        A end
        <input
          type="date"
          value={props.value.a.end}
          disabled={props.value.preset !== 'custom_vs_custom'}
          onChange={(e) => props.onChange({ ...props.value, a: { ...props.value.a, end: e.target.value } })}
        />
      </label>
      <label>
        B start
        <input
          type="date"
          value={props.value.b.start}
          disabled={props.value.preset !== 'custom_vs_custom'}
          onChange={(e) => props.onChange({ ...props.value, b: { ...props.value.b, start: e.target.value } })}
        />
      </label>
      <label>
        B end
        <input
          type="date"
          value={props.value.b.end}
          disabled={props.value.preset !== 'custom_vs_custom'}
          onChange={(e) => props.onChange({ ...props.value, b: { ...props.value.b, end: e.target.value } })}
        />
      </label>
    </div>
  );
}

