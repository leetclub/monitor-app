import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';
import { Fragment, type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react';
import { HelpTip } from '@/components/HelpTip';
import { fleetTagSourceDescription } from '@/lib/fleetTagSourceHint';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type TimeWindow = { start: string; end: string };

export type OperatorBlock = { name: string; windows: TimeWindow[] };

export type OperatingDays =
  | { preset: 'all_week' }
  | { preset: 'weekends_off' }
  | { preset: 'custom'; days: number[] };

type MachineRow = {
  id: string;
  name: string;
  /** Machine / fleet tag from Vendon (API field name kept for compatibility) */
  vendon_location_owner?: string | null;
  /** How `vendon_location_owner` was derived (server slug; see `fleetTagSourceDescription`) */
  vendon_tag_source?: string | null;
};

/** One technician or QA officer; multiple rows allowed. `name` is one string: name + what they are responsible for. */
export type StaffVisitRow = {
  name: string;
  /** Weekday indices 0–6 (Sun–Sat) */
  days: number[];
  windows: TimeWindow[];
};

type MachinesApiResponse = {
  machines: MachineRow[];
  location_owner_options?: string[];
  error?: string;
};

type ProfileRow = {
  machine_id: string;
  machine_name: string | null;
  location_owner: string | null;
  location_hours: string | null;
  operating_days: OperatingDays | Record<string, unknown>;
  cleaning_windows: TimeWindow[];
  operator_hours: OperatorBlock[];
  technician_schedule: unknown[];
  qa_schedule: unknown[];
  timezone: string;
  /** From linked Red Alert cleaning schedule row (higher = wins on overlap) */
  priority?: number;
  updated_at?: string | null;
};

function fmtTimeWindow(w: TimeWindow): string {
  const s = String(w?.start ?? '').trim();
  const e = String(w?.end ?? '').trim();
  if (!s && !e) return '';
  if (s && e) return `${s}–${e}`;
  return s || e;
}

function operatingDaysLabel(raw: unknown): string {
  const od = normalizeOperatingDays(raw);
  if (od.preset === 'all_week') return 'All week';
  if (od.preset === 'weekends_off') return 'Weekends off';
  const days = (od.days || []).map((d) => DAY_LABELS[d] ?? String(d));
  return days.length ? `Custom: ${days.join(', ')}` : 'Custom';
}

function nonEmptyString(x: unknown): string {
  const s = String(x ?? '').trim();
  return s;
}

function parseDaysArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => Number(n)).filter((x) => Number.isFinite(x) && x >= 0 && x <= 6);
}

function parseWindowsFromObject(o: Record<string, unknown>): TimeWindow[] {
  if (Array.isArray(o.windows)) {
    const wins: TimeWindow[] = [];
    for (const w of o.windows) {
      if (w && typeof w === 'object' && !Array.isArray(w)) {
        const ww = w as Record<string, unknown>;
        wins.push({
          start: String(ww.start ?? '').trim(),
          end: String(ww.end ?? '').trim(),
        });
      }
    }
    return wins.filter((w) => w.start || w.end);
  }
  const s = String(o.start ?? '').trim();
  const e = String(o.end ?? '').trim();
  if (s || e) return [{ start: s, end: e }];
  return [];
}

/** Legacy split fields → single display line (same as current form). */
function combinedStaffNameFromSaved(o: Record<string, unknown>): string {
  const a = nonEmptyString(o.name ?? o.person ?? o.technician ?? o.officer ?? '');
  const b = nonEmptyString(o.responsible ?? o.account ?? '');
  const c = nonEmptyString(o.note ?? o.visits ?? o.schedule ?? o.details ?? '');
  const parts: string[] = [];
  for (const p of [a, b, c]) {
    if (p && !parts.includes(p)) parts.push(p);
  }
  return parts.join(' — ');
}

/** Parse saved JSON (new shape or legacy name / responsible / note) into staff rows for display. */
function staffScheduleFromSavedUnknown(raw: unknown): StaffVisitRow[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: StaffVisitRow[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const name = combinedStaffNameFromSaved(o);
      const days = parseDaysArray(o.days ?? o.visit_days ?? o.weekdays);
      let windows = parseWindowsFromObject(o);
      if (!windows.length) windows = [{ start: '', end: '' }];
      if (name || days.length || windows.some((w) => w.start && w.end)) {
        out.push({ name, days, windows });
      }
    }
  }
  return out;
}

function emptyOperator(): OperatorBlock {
  return { name: '', windows: [{ start: '09:00', end: '17:00' }] };
}

function normalizeOperatingDays(raw: unknown): OperatingDays {
  if (!raw || typeof raw !== 'object') return { preset: 'all_week' };
  const o = raw as Record<string, unknown>;
  const p = o.preset;
  if (p === 'all_week' || p === 'weekends_off') return { preset: p };
  if (p === 'custom' && Array.isArray(o.days)) {
    return { preset: 'custom', days: (o.days as unknown[]).map((n) => Number(n)).filter((n) => !Number.isNaN(n)) };
  }
  return { preset: 'all_week' };
}

function emptyStaffVisitRow(): StaffVisitRow {
  return { name: '', days: [], windows: [{ start: '', end: '' }] };
}

/** Load saved schedule array (objects or legacy shapes) into editable rows. */
function scheduleRowsFromUnknown(raw: unknown): StaffVisitRow[] {
  if (!Array.isArray(raw) || raw.length === 0) return [emptyStaffVisitRow()];
  const parsed = staffScheduleFromSavedUnknown(raw);
  return parsed.length ? parsed.map((r) => ({ ...r, windows: r.windows.length ? r.windows : [{ start: '', end: '' }] })) : [emptyStaffVisitRow()];
}

function unknownArrayFromStaffRows(rows: StaffVisitRow[]): unknown[] {
  return rows
    .map((r) => {
      const wins = r.windows.filter((w) => String(w.start ?? '').trim() && String(w.end ?? '').trim());
      return {
        name: r.name.trim(),
        days: [...r.days].sort((a, b) => a - b),
        windows: wins.map((w) => ({
          start: String(w.start ?? '').trim(),
          end: String(w.end ?? '').trim(),
        })),
      };
    })
    .filter((r) => r.name || r.days.length > 0 || r.windows.length > 0);
}

function visitDaysLabel(days: number[]): string {
  if (!days.length) return '—';
  return days
    .map((d) => DAY_LABELS[d] ?? String(d))
    .filter(Boolean)
    .join(', ');
}

function StaffVisitScheduleRows(props: {
  variant: 'technician' | 'qa';
  rows: StaffVisitRow[];
  setRows: Dispatch<SetStateAction<StaffVisitRow[]>>;
}) {
  const { variant, rows, setRows } = props;
  const nameFieldCaption = variant === 'technician' ? 'Name of Tech Responsible' : 'Name of QA Responsible';
  const sectionTitle = variant === 'technician' ? 'Technician' : 'QA Officer';

  const toggleDay = (rowIdx: number, d: number) => {
    setRows((prev) => {
      const next = [...prev];
      const row = next[rowIdx];
      const days = row.days.includes(d) ? row.days.filter((x) => x !== d) : [...row.days, d].sort((a, b) => a - b);
      next[rowIdx] = { ...row, days };
      return next;
    });
  };

  return (
    <div className="adminStaffVariant">
      <h3 className="adminSubsectionTitle">{sectionTitle}</h3>
      {rows.map((row, idx) => (
        <div key={idx} className="adminStaffPersonBlock">
          <div className="adminFieldBlock">
            <span className="adminFieldCaption">{nameFieldCaption}</span>
            <div className="adminStaffInputRow">
              <input
                className="adminInputFluid"
                value={row.name}
                onChange={(e) => {
                  const next = [...rows];
                  next[idx] = { ...next[idx], name: e.target.value };
                  setRows(next);
                }}
                autoComplete="off"
                aria-label={nameFieldCaption}
              />
              <button
                type="button"
                className="danger adminStaffRemoveCompact"
                onClick={() => {
                  setRows((prev) => {
                    const cut = prev.filter((_, i) => i !== idx);
                    return cut.length ? cut : [emptyStaffVisitRow()];
                  });
                }}
              >
                Remove
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
              Visit days
            </div>
            <div className="adminVisitDayStrip">
              {DAY_LABELS.map((lab, d) => (
                <label key={d} className="adminDayCheckbox">
                  <input type="checkbox" checked={row.days.includes(d)} onChange={() => toggleDay(idx, d)} />
                  {lab}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
              Visit hours (start and end)
            </div>
            {row.windows.map((w, wi) => (
              <div key={wi} className="adminStaffHoursRow">
                <div className="adminFieldCell">
                  <span className="adminFieldCaption">Start</span>
                  <input
                    type="time"
                    value={w.start}
                    onChange={(e) => {
                      const next = [...rows];
                      const wins = [...next[idx].windows];
                      wins[wi] = { ...wins[wi], start: e.target.value };
                      next[idx] = { ...next[idx], windows: wins };
                      setRows(next);
                    }}
                  />
                </div>
                <div className="adminFieldCell">
                  <span className="adminFieldCaption">End</span>
                  <input
                    type="time"
                    value={w.end}
                    onChange={(e) => {
                      const next = [...rows];
                      const wins = [...next[idx].windows];
                      wins[wi] = { ...wins[wi], end: e.target.value };
                      next[idx] = { ...next[idx], windows: wins };
                      setRows(next);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setRows((prev) => {
                      const next = [...prev];
                      const wins = next[idx].windows.filter((_, i) => i !== wi);
                      next[idx] = { ...next[idx], windows: wins.length ? wins : [{ start: '', end: '' }] };
                      return next;
                    });
                  }}
                >
                  Remove slot
                </button>
              </div>
            ))}
            <button
              type="button"
              className="primary"
              style={{ marginTop: 6 }}
              onClick={() => {
                setRows((prev) => {
                  const next = [...prev];
                  next[idx] = { ...next[idx], windows: [...next[idx].windows, { start: '', end: '' }] };
                  return next;
                });
              }}
            >
              Add time slot
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="primary" style={{ marginTop: 8 }} onClick={() => setRows((p) => [...p, emptyStaffVisitRow()])}>
        Add another person
      </button>
    </div>
  );
}

export function MachineProfileSection() {
  const qc = useQueryClient();
  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<MachinesApiResponse>('/api/alert/machines'),
  });
  const profilesQ = useQuery({
    queryKey: ['alert-machine-profiles'],
    queryFn: () => apiGet<{ rows: ProfileRow[] }>('/api/alert/admin/machine-profiles'),
  });

  const [machineId, setMachineId] = useState('');
  const [locationOwner, setLocationOwner] = useState('');
  const [locationHours, setLocationHours] = useState('');
  const [opPreset, setOpPreset] = useState<'all_week' | 'weekends_off' | 'custom'>('all_week');
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [cleaningWindows, setCleaningWindows] = useState<TimeWindow[]>([{ start: '14:00', end: '15:00' }]);
  const [operators, setOperators] = useState<OperatorBlock[]>([emptyOperator()]);
  const [technicianRows, setTechnicianRows] = useState<StaffVisitRow[]>([emptyStaffVisitRow()]);
  const [qaRows, setQaRows] = useState<StaffVisitRow[]>([emptyStaffVisitRow()]);
  const [timezone, setTimezone] = useState('Asia/Kuwait');
  const [priority, setPriority] = useState(10);
  const [formErr, setFormErr] = useState<string | null>(null);

  const machines = machinesQ.data?.machines ?? [];
  const ownerOptions = machinesQ.data?.location_owner_options ?? [];
  const machineName = useMemo(() => machines.find((m) => m.id === machineId)?.name ?? '', [machines, machineId]);
  const selectedMachine = useMemo(() => machines.find((m) => m.id === machineId), [machines, machineId]);
  const vendonLocationTag = (selectedMachine?.vendon_location_owner ?? '').trim();
  const vendonTagSourceHint = useMemo(
    () => fleetTagSourceDescription(selectedMachine?.vendon_tag_source ?? undefined),
    [selectedMachine?.vendon_tag_source],
  );

  const loadProfileIntoForm = useCallback(
    (p: ProfileRow) => {
    setMachineId(p.machine_id);
    const m = machines.find((x) => x.id === p.machine_id);
    const vendonTag = (m?.vendon_location_owner ?? '').trim();
    // Do not prefill from DB `location_owner` — it is often a legacy site name. Only show Vendon machine tag (or user-typed value after edit).
    setLocationOwner(vendonTag);
    setLocationHours(p.location_hours ?? '');
    const od = normalizeOperatingDays(p.operating_days);
    setOpPreset(od.preset === 'custom' ? 'custom' : od.preset);
    setCustomDays(od.preset === 'custom' ? od.days : []);
    const cw = Array.isArray(p.cleaning_windows) ? p.cleaning_windows : [];
    setCleaningWindows(cw.length ? cw : [{ start: '09:00', end: '17:00' }]);
    const oh = Array.isArray(p.operator_hours) ? p.operator_hours : [];
    setOperators(
      oh.length
        ? oh.map((x: OperatorBlock) => ({
            name: String(x.name ?? ''),
            windows: Array.isArray(x.windows) && x.windows.length ? x.windows : [{ start: '09:00', end: '17:00' }],
          }))
        : [emptyOperator()],
    );
    setTechnicianRows(scheduleRowsFromUnknown(p.technician_schedule));
    setQaRows(scheduleRowsFromUnknown(p.qa_schedule));
    setTimezone(p.timezone || 'Asia/Kuwait');
    setPriority(typeof p.priority === 'number' && !Number.isNaN(p.priority) ? p.priority : 10);
    setFormErr(null);
  },
  [machines],
);

  const clearForm = useCallback(() => {
    setMachineId('');
    setLocationOwner('');
    setLocationHours('');
    setOpPreset('all_week');
    setCustomDays([]);
    setCleaningWindows([{ start: '14:00', end: '15:00' }]);
    setOperators([emptyOperator()]);
    setTechnicianRows([emptyStaffVisitRow()]);
    setQaRows([emptyStaffVisitRow()]);
    setTimezone('Asia/Kuwait');
    setPriority(10);
    setFormErr(null);
  }, []);

  /** New machine with no saved profile — seed machine tag from live machine list. */
  const seedNewMachine = useCallback(
    (id: string, machineList: MachineRow[]) => {
      const m = machineList.find((x) => x.id === id);
      setMachineId(id);
      setLocationOwner((m?.vendon_location_owner ?? '').trim());
      setLocationHours('');
      setOpPreset('all_week');
      setCustomDays([]);
      setCleaningWindows([{ start: '14:00', end: '15:00' }]);
      setOperators([emptyOperator()]);
      setTechnicianRows([emptyStaffVisitRow()]);
      setQaRows([emptyStaffVisitRow()]);
      setTimezone('Asia/Kuwait');
      setPriority(10);
      setFormErr(null);
    },
    [],
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!machineId.trim()) {
        throw new Error('Choose a machine first.');
      }
      const tech = unknownArrayFromStaffRows(technicianRows);
      const qa = unknownArrayFromStaffRows(qaRows);
      const operating_days: OperatingDays =
        opPreset === 'custom' ? { preset: 'custom', days: customDays } : { preset: opPreset };
      return apiJson('/api/alert/admin/machine-profiles', {
        machine_id: machineId,
        machine_name: machineName || null,
        location_owner: (vendonLocationTag || locationOwner).trim() || null,
        location_hours: locationHours || null,
        operating_days,
        cleaning_windows: cleaningWindows.filter((w) => w.start && w.end),
        operator_hours: operators
          .map((o) => ({
            name: o.name.trim(),
            windows: o.windows.filter((w) => w.start && w.end),
          }))
          .filter((o) => o.name || o.windows.length > 0),
        technician_schedule: tech,
        qa_schedule: qa,
        timezone,
        priority,
      });
    },
    onSuccess: async () => {
      setFormErr(null);
      await qc.invalidateQueries({ queryKey: ['alert-machine-profiles'] });
      await qc.invalidateQueries({ queryKey: ['alert-admin-cleaning-schedules'] });
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      apiJson<{ ok?: boolean }>(`/api/alert/admin/machine-profiles/${encodeURIComponent(id)}`, undefined, 'DELETE'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['alert-machine-profiles'] });
      await qc.invalidateQueries({ queryKey: ['alert-admin-cleaning-schedules'] });
    },
  });

  const rows = profilesQ.data?.rows ?? [];
  const [expandedMachineId, setExpandedMachineId] = useState<string | null>(null);

  const toggleDay = (d: number) => {
    setCustomDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  return (
    <>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: '0.9rem' }}>
        <strong>{machines.length}</strong> machines in catalog · <strong>{rows.length}</strong> saved profiles — use the form to
        add real Admin data for review.
      </p>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">{machineId ? `Edit: ${machineName || machineId}` : 'Machine profile'}</h2>
          <HelpTip text="Required: vending machine + at least one cleaning window. Operators, technician, and QA officer schedules are optional." />
        </div>

        {formErr || saveMut.isError ? (
          <div className="pillDanger" style={{ marginBottom: 12 }}>
            {formErr || (saveMut.error as Error)?.message}
          </div>
        ) : null}

        <div className="adminGroup">
          <div className="adminGroupLabel adminGroupLabelRow">
            Core
            <HelpTip text="Machine, tag, open-hours preset, operating days." />
          </div>
          <div className="adminMachineCoreRow">
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Vending machine</span>
              <select
                title="Machines from the catalog"
                value={machineId}
                onChange={(e) => {
                  const id = e.target.value;
                  setFormErr(null);
                  const prof = rows.find((r) => r.machine_id === id);
                  if (prof) {
                    loadProfileIntoForm(prof);
                    return;
                  }
                  if (id) {
                    seedNewMachine(id, machines);
                  } else {
                    clearForm();
                  }
                }}
              >
                <option value="">Choose…</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Location Owner</span>
              <input
                name="location_owner"
                title="From live feed when present; used for grouping"
                list="alert-location-owner-options"
                value={vendonLocationTag || locationOwner}
                onChange={(e) => (vendonLocationTag ? null : setLocationOwner(e.target.value))}
                placeholder={vendonLocationTag ? vendonLocationTag : 'e.g. MOH'}
                autoComplete="off"
                readOnly={!!vendonLocationTag}
              />
              <datalist id="alert-location-owner-options">
                {ownerOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Location hours</span>
              <select title="Site open duration (Overall operating hours)" value={locationHours} onChange={(e) => setLocationHours(e.target.value)}>
                <option value="">Select…</option>
                <option value="9">9 hrs</option>
                <option value="12">12 hrs</option>
                <option value="16">16 hrs</option>
                <option value="24">24 hrs</option>
              </select>
            </div>
          </div>

          {machineId && vendonLocationTag ? (
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8, marginBottom: 0, lineHeight: 1.45 }}>
              Location Owner from device feed: <strong>{vendonLocationTag}</strong>
              {vendonTagSourceHint ? (
                <>
                  {' '}
                  <span style={{ opacity: 0.92 }}>({vendonTagSourceHint})</span>
                </>
              ) : null}
            </p>
          ) : machineId && !vendonLocationTag ? (
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8, marginBottom: 0, lineHeight: 1.45 }}>
              No Location Owner in the live feed for this device — enter one below or keep your saved value.
            </p>
          ) : null}

          <div style={{ marginTop: 12 }} className="adminInlineDayPick">
            <span className="adminGroupLabel" style={{ marginRight: 10, display: 'inline', textTransform: 'none', letterSpacing: 'normal' }}>
              Operating days
            </span>
            <HelpTip text="All week, weekends off, or pick individual days." />
            <label style={{ display: 'inline-flex', marginRight: 12, marginLeft: 8 }}>
              <input type="radio" name="od" checked={opPreset === 'all_week'} onChange={() => setOpPreset('all_week')} />{' '}
              All week
            </label>
            <label style={{ display: 'inline-flex', marginRight: 12 }}>
              <input
                type="radio"
                name="od"
                checked={opPreset === 'weekends_off'}
                onChange={() => setOpPreset('weekends_off')}
              />{' '}
              Weekends off
            </label>
            <label style={{ display: 'inline-flex' }}>
              <input type="radio" name="od" checked={opPreset === 'custom'} onChange={() => setOpPreset('custom')} />{' '}
              Pick days
            </label>
          </div>
          {opPreset === 'custom' ? (
            <div className="adminVisitDayStrip" style={{ marginTop: 10 }}>
              {DAY_LABELS.map((lb, i) => (
                <label key={lb} className="adminDayCheckbox">
                  <input type="checkbox" checked={customDays.includes(i)} onChange={() => toggleDay(i)} /> {lb}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <details className="adminDetails" open>
          <summary title="Multiple windows allowed. Used so idle time during cleaning is not flagged as a fault.">
            Cleaning schedule
          </summary>
          {cleaningWindows.map((w, idx) => (
            <div key={idx} className="adminTimePairRow" style={{ marginBottom: 8 }}>
              <div className="adminFieldCell">
                <span className="adminFieldCaption">From</span>
                <input
                  type="time"
                  value={w.start}
                  onChange={(e) => {
                    const next = [...cleaningWindows];
                    next[idx] = { ...next[idx], start: e.target.value };
                    setCleaningWindows(next);
                  }}
                />
              </div>
              <div className="adminFieldCell">
                <span className="adminFieldCaption">To</span>
                <input
                  type="time"
                  value={w.end}
                  onChange={(e) => {
                    const next = [...cleaningWindows];
                    next[idx] = { ...next[idx], end: e.target.value };
                    setCleaningWindows(next);
                  }}
                />
              </div>
              <button type="button" className="danger" onClick={() => setCleaningWindows((prev) => prev.filter((_, i) => i !== idx))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="primary" onClick={() => setCleaningWindows((p) => [...p, { start: '', end: '' }])}>
            Add time range
          </button>
        </details>

        <details className="adminDetails">
          <summary title="Optional. Name plus shift windows; appears on operator columns in Red Flags / Overall.">
            Operator hours
          </summary>
          {operators.map((op, oi) => (
            <div key={oi} className="adminOperatorCard">
              <div className="adminFieldCell adminOperatorNameField">
                <span className="adminFieldCaption">Name</span>
                <input
                  value={op.name}
                  onChange={(e) => {
                    const next = [...operators];
                    next[oi] = { ...next[oi], name: e.target.value };
                    setOperators(next);
                  }}
                />
              </div>
              {op.windows.map((w, wi) => (
                <div key={wi} className="adminTimePairRow" style={{ marginTop: 4 }}>
                  <div className="adminFieldCell">
                    <span className="adminFieldCaption">From</span>
                    <input
                      type="time"
                      value={w.start}
                      onChange={(e) => {
                        const next = [...operators];
                        const ws = [...next[oi].windows];
                        ws[wi] = { ...ws[wi], start: e.target.value };
                        next[oi] = { ...next[oi], windows: ws };
                        setOperators(next);
                      }}
                    />
                  </div>
                  <div className="adminFieldCell">
                    <span className="adminFieldCaption">To</span>
                    <input
                      type="time"
                      value={w.end}
                      onChange={(e) => {
                        const next = [...operators];
                        const ws = [...next[oi].windows];
                        ws[wi] = { ...ws[wi], end: e.target.value };
                        next[oi] = { ...next[oi], windows: ws };
                        setOperators(next);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      const next = [...operators];
                      next[oi] = { ...next[oi], windows: next[oi].windows.filter((_, i) => i !== wi) };
                      setOperators(next);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="adminButtonRow">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const next = [...operators];
                    next[oi] = { ...next[oi], windows: [...next[oi].windows, { start: '', end: '' }] };
                    setOperators(next);
                  }}
                >
                  Add shift segment
                </button>
                <button type="button" className="danger" onClick={() => setOperators((prev) => prev.filter((_, i) => i !== oi))}>
                  Remove operator
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="primary" onClick={() => setOperators((p) => [...p, emptyOperator()])}>
            Add another operator
          </button>
        </details>

        <details className="adminDetails">
          <summary title="Technician and QA: one text field per person, visit days, hours.">
            Technician &amp; QA Officer
          </summary>
          <p className="muted adminTechQaIntro">
            Use <strong>Name of Tech Responsible</strong> and <strong>Name of QA Responsible</strong> as <strong>one line of text each</strong>. Then set visit days and hours. Add more rows if several people cover this machine.
          </p>
          <StaffVisitScheduleRows variant="technician" rows={technicianRows} setRows={setTechnicianRows} />
          <StaffVisitScheduleRows variant="qa" rows={qaRows} setRows={setQaRows} />
        </details>

        <details className="adminDetails">
          <summary title="IANA time zone for cleaning and operator windows; priority resolves overlapping cleaning rules.">
            Time zone &amp; priority
          </summary>
          <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0, lineHeight: 1.45 }}>
            <strong>Time zone</strong> applies when interpreting cleaning and operator windows (default <code>Asia/Kuwait</code>).{' '}
            <strong>Priority</strong> resolves overlaps on automated cleaning rules for this machine — higher wins.
          </p>
          <div className="adminTzPriorityRow" style={{ marginTop: 8 }}>
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Time zone</span>
              <input
                title="IANA name, e.g. Asia/Kuwait"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Priority</span>
              <input
                type="number"
                title="Higher wins when cleaning rules overlap"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
          </div>
        </details>

        <div className="adminSaveBar">
          <button
            type="button"
            className="primary"
            disabled={!machineId || saveMut.isPending}
            onClick={() => {
              setFormErr(null);
              saveMut.mutate(undefined, {
                onError: (e) => setFormErr((e as Error).message),
              });
            }}
          >
            {saveMut.isPending ? 'Saving…' : 'Save machine'}
          </button>
          <button type="button" onClick={clearForm}>
            Clear form
          </button>
          {!machineId ? (
            <span className="muted adminQuietNote" title="Select a vending machine above">
              Select a machine
            </span>
          ) : null}
        </div>
      </div>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">Saved profiles</h2>
          <HelpTip text="Long lists scroll inside this card. Hover a machine tag for how it was derived from the feed. Edit loads the form above; Remove deletes saved data for that machine." />
        </div>
        {profilesQ.isLoading ? <div className="muted">Loading…</div> : null}
        {profilesQ.isError ? <div className="muted">{(profilesQ.error as Error).message}</div> : null}
        <div className="tableWrap tableWrapBounded">
          <table className="adminSavedProfilesTable">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Location Owner</th>
                <th>Open hours</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vm = machines.find((x) => x.id === r.machine_id);
                const feedTag = (vm?.vendon_location_owner ?? '').trim();
                const displayTag = feedTag || r.location_owner || '—';
                const tagHint = fleetTagSourceDescription(vm?.vendon_tag_source ?? undefined);
                const expanded = expandedMachineId === r.machine_id;
                return (
                  <Fragment key={r.machine_id}>
                    <tr>
                      <td className="tableCellWrap">{r.machine_name || r.machine_id}</td>
                      <td className="tableCellWrap" title={tagHint ? `${displayTag}. ${tagHint}` : displayTag}>
                        {displayTag}
                      </td>
                      <td>{r.location_hours ? `${r.location_hours} h` : '—'}</td>
                      <td className="muted">{r.updated_at?.slice(0, 16) || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => setExpandedMachineId((cur) => (cur === r.machine_id ? null : r.machine_id))}
                          title="Show all saved data for this machine"
                        >
                          {expanded ? 'Hide' : 'View'}
                        </button>{' '}
                        <button type="button" className="primary" onClick={() => loadProfileIntoForm(r)}>
                          Edit
                        </button>{' '}
                        <button
                          type="button"
                          className="danger"
                          disabled={delMut.isPending}
                          onClick={() => {
                            if (confirm(`Remove saved profile for ${r.machine_name || r.machine_id}?`)) {
                              delMut.mutate(r.machine_id);
                            }
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr key={`${r.machine_id}-details`}>
                        <td colSpan={5} style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)' }}>
                          <div style={{ padding: 12 }}>
                            <div className="adminGroupLabel" style={{ marginBottom: 8 }}>
                              Saved data
                            </div>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                gap: 10,
                                alignItems: 'start',
                              }}
                            >
                              <div>
                                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                  Operating days
                                </div>
                                <div style={{ fontSize: 13 }}>{operatingDaysLabel(r.operating_days)}</div>
                              </div>
                              <div>
                                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                  Cleaning windows
                                </div>
                                {Array.isArray(r.cleaning_windows) && r.cleaning_windows.length ? (
                                  <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 13, lineHeight: 1.5 }}>
                                    {r.cleaning_windows
                                      .map((w) => fmtTimeWindow(w))
                                      .filter(Boolean)
                                      .map((t, i) => (
                                        <li key={i}>{t}</li>
                                      ))}
                                  </ul>
                                ) : (
                                  <div className="muted" style={{ fontSize: 13 }}>
                                    —
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                  Operator hours
                                </div>
                                {Array.isArray(r.operator_hours) && r.operator_hours.length ? (
                                  <div style={{ display: 'grid', gap: 8 }}>
                                    {r.operator_hours.map((op, i) => {
                                      const name = nonEmptyString(op?.name) || `Operator ${i + 1}`;
                                      const wins = Array.isArray(op?.windows) ? op.windows : [];
                                      const label = wins
                                        .map((w) => fmtTimeWindow(w))
                                        .filter(Boolean)
                                        .join(', ');
                                      return (
                                        <div key={i} style={{ fontSize: 13 }}>
                                          <div style={{ fontWeight: 700 }}>{name}</div>
                                          <div className="muted">{label || '—'}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="muted" style={{ fontSize: 13 }}>
                                    —
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                  Technician
                                </div>
                                {(() => {
                                  const staffRows = staffScheduleFromSavedUnknown(r.technician_schedule);
                                  return staffRows.length ? (
                                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 13, lineHeight: 1.5 }}>
                                      {staffRows.map((x, i) => (
                                        <li key={i}>
                                          <strong>{x.name || '—'}</strong>
                                          <div className="muted" style={{ marginTop: 2 }}>
                                            Days: {visitDaysLabel(x.days)}
                                          </div>
                                          <div className="muted">
                                            Hours:{' '}
                                            {x.windows.filter((w) => w.start && w.end).length
                                              ? x.windows
                                                  .filter((w) => w.start && w.end)
                                                  .map((w) => fmtTimeWindow(w))
                                                  .join(' · ')
                                              : '—'}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className="muted" style={{ fontSize: 13 }}>
                                      —
                                    </div>
                                  );
                                })()}
                              </div>
                              <div>
                                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                  QA Officer
                                </div>
                                {(() => {
                                  const staffRows = staffScheduleFromSavedUnknown(r.qa_schedule);
                                  return staffRows.length ? (
                                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 13, lineHeight: 1.5 }}>
                                      {staffRows.map((x, i) => (
                                        <li key={i}>
                                          <strong>{x.name || '—'}</strong>
                                          <div className="muted" style={{ marginTop: 2 }}>
                                            Days: {visitDaysLabel(x.days)}
                                          </div>
                                          <div className="muted">
                                            Hours:{' '}
                                            {x.windows.filter((w) => w.start && w.end).length
                                              ? x.windows
                                                  .filter((w) => w.start && w.end)
                                                  .map((w) => fmtTimeWindow(w))
                                                  .join(' · ')
                                              : '—'}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className="muted" style={{ fontSize: 13 }}>
                                      —
                                    </div>
                                  );
                                })()}
                              </div>
                              <div>
                                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                                  Time zone / priority
                                </div>
                                <div style={{ fontSize: 13 }}>
                                  <div>
                                    <strong>{String(r.timezone ?? '—')}</strong>
                                  </div>
                                  <div className="muted">Priority: {r.priority != null ? String(r.priority) : '—'}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {rows.length === 0 && !profilesQ.isLoading ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No machines saved yet — use the form above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {machinesQ.isError ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Could not load machine list: {(machinesQ.error as Error).message}
        </p>
      ) : null}
    </>
  );
}
