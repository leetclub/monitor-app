import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';
import { useCallback, useMemo, useState } from 'react';
import { HelpTip } from '@/components/HelpTip';

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
  /** Location/site tag from Vendon machine payload when present */
  vendon_location_owner?: string | null;
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
  updated_at?: string | null;
};

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
  const [technicianJson, setTechnicianJson] = useState('[]');
  const [qaJson, setQaJson] = useState('[]');
  const [timezone, setTimezone] = useState('Asia/Kuwait');
  const [priority, setPriority] = useState(10);
  const [formErr, setFormErr] = useState<string | null>(null);

  const machines = machinesQ.data?.machines ?? [];
  const ownerOptions = machinesQ.data?.location_owner_options ?? [];
  const machineName = useMemo(() => machines.find((m) => m.id === machineId)?.name ?? '', [machines, machineId]);
  const selectedMachine = useMemo(() => machines.find((m) => m.id === machineId), [machines, machineId]);
  const vendonLocationTag = (selectedMachine?.vendon_location_owner ?? '').trim();

  const loadProfileIntoForm = useCallback((p: ProfileRow) => {
    setMachineId(p.machine_id);
    setLocationOwner(p.location_owner ?? '');
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
    setTechnicianJson(JSON.stringify(p.technician_schedule ?? [], null, 2));
    setQaJson(JSON.stringify(p.qa_schedule ?? [], null, 2));
    setTimezone(p.timezone || 'Asia/Kuwait');
    setFormErr(null);
  }, []);

  const clearForm = useCallback(() => {
    setMachineId('');
    setLocationOwner('');
    setLocationHours('');
    setOpPreset('all_week');
    setCustomDays([]);
    setCleaningWindows([{ start: '14:00', end: '15:00' }]);
    setOperators([emptyOperator()]);
    setTechnicianJson('[]');
    setQaJson('[]');
    setTimezone('Asia/Kuwait');
    setPriority(10);
    setFormErr(null);
  }, []);

  /** New machine with no saved profile — seed Location owner from Vendon. */
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
      setTechnicianJson('[]');
      setQaJson('[]');
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
      let tech: unknown[] = [];
      let qa: unknown[] = [];
      try {
        tech = JSON.parse(technicianJson || '[]') as unknown[];
        if (!Array.isArray(tech)) throw new Error('Technician must be a JSON array');
      } catch (e) {
        throw new Error(`Technician JSON: ${(e as Error).message}`);
      }
      try {
        qa = JSON.parse(qaJson || '[]') as unknown[];
        if (!Array.isArray(qa)) throw new Error('QA must be a JSON array');
      } catch (e) {
        throw new Error(`QA JSON: ${(e as Error).message}`);
      }
      const operating_days: OperatingDays =
        opPreset === 'custom' ? { preset: 'custom', days: customDays } : { preset: opPreset };
      return apiJson('/api/alert/admin/machine-profiles', {
        machine_id: machineId,
        machine_name: machineName || null,
        location_owner: locationOwner.trim() || null,
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

  const toggleDay = (d: number) => {
    setCustomDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  return (
    <>
      <details className="adminFold">
        <summary title="Maps alert.theleetclub.com.xlsx Admin sheet. Full mapping in repo: docs/alert-workbook-admin-tab.md">
          Workbook column guide
        </summary>
        <ul className="adminSpecList muted adminFoldBody">
          <li>
            <strong>Vending machine</strong> — Vendon list (dropdown).
          </li>
          <li>
            <strong>Location owner</strong> — prefilled from Vendon when available; pick from the list or type; overrides if
            Vendon is wrong.
          </li>
          <li>
            <strong>Location hours</strong> — 9 / 12 / 16 / 24 hrs.
          </li>
          <li>
            <strong>Operating days</strong> — week / weekends off / custom days.
          </li>
          <li>
            <strong>Cleaning / operators / tech / QA</strong> — see sections below; tech &amp; QA JSON until UI editor.
          </li>
        </ul>
      </details>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">Saved profiles</h2>
          <HelpTip text="Edit loads the form below. Remove deletes saved profile data for that machine." />
        </div>
        {profilesQ.isLoading ? <div className="muted">Loading…</div> : null}
        {profilesQ.isError ? <div className="muted">{(profilesQ.error as Error).message}</div> : null}
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Owner tag</th>
                <th>Open hours</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.machine_id}>
                  <td>{r.machine_name || r.machine_id}</td>
                  <td>{r.location_owner || '—'}</td>
                  <td>{r.location_hours ? `${r.location_hours} h` : '—'}</td>
                  <td className="muted">{r.updated_at?.slice(0, 16) || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
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
              ))}
              {rows.length === 0 && !profilesQ.isLoading ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No machines saved yet — use the form below.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">{machineId ? `Edit: ${machineName || machineId}` : 'Machine profile'}</h2>
          <HelpTip text="Required: vending machine + at least one cleaning window. Operators, technician, and QA are optional." />
        </div>

        {formErr || saveMut.isError ? (
          <div className="pillDanger" style={{ marginBottom: 12 }}>
            {formErr || (saveMut.error as Error)?.message}
          </div>
        ) : null}

        <div className="adminGroup">
          <div className="adminGroupLabel adminGroupLabelRow">
            Core
            <HelpTip text="Workbook Admin columns: machine, owner, hours preset, operating days." />
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label style={{ flex: '2 1 200px' }} title="From Vendon">
              Vending machine
              <select
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
            </label>
            <label style={{ flex: '1 1 200px' }} title="From Vendon when possible; type or pick from list">
              Location owner
              <input
                name="location_owner"
                list="alert-location-owner-options"
                value={locationOwner}
                onChange={(e) => setLocationOwner(e.target.value)}
                placeholder={vendonLocationTag ? vendonLocationTag : 'e.g. MOH'}
                autoComplete="off"
              />
              <datalist id="alert-location-owner-options">
                {ownerOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </label>
            <label style={{ flex: '0 0 140px' }} title="Site open duration (Overall ‘Operating hours’ source)">
              Location hours
              <select value={locationHours} onChange={(e) => setLocationHours(e.target.value)}>
                <option value="">Select…</option>
                <option value="9">9 hrs</option>
                <option value="12">12 hrs</option>
                <option value="16">16 hrs</option>
                <option value="24">24 hrs</option>
              </select>
            </label>
          </div>

          {machineId && vendonLocationTag && locationOwner.trim() !== vendonLocationTag ? (
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8, marginBottom: 0, lineHeight: 1.45 }}>
              Vendon associates this machine with <strong>{vendonLocationTag}</strong>.{' '}
              <button type="button" className="btnLink" onClick={() => setLocationOwner(vendonLocationTag)}>
                Use Vendon tag
              </button>{' '}
              if the value above should match.
            </p>
          ) : null}

          <div style={{ marginTop: 12 }} className="adminInlineDayPick">
            <span className="adminGroupLabel" style={{ marginRight: 10, display: 'inline', textTransform: 'none', letterSpacing: 'normal' }}>
              Operating days
            </span>
            <HelpTip text="Workbook: All week, Weekends off, or pick individual days." />
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
            <div className="row" style={{ marginTop: 8 }}>
              {DAY_LABELS.map((lb, i) => (
                <label key={lb}>
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
            <div key={idx} className="row" style={{ marginBottom: 6 }}>
              <label>
                From
                <input
                  type="time"
                  value={w.start}
                  onChange={(e) => {
                    const next = [...cleaningWindows];
                    next[idx] = { ...next[idx], start: e.target.value };
                    setCleaningWindows(next);
                  }}
                />
              </label>
              <label>
                To
                <input
                  type="time"
                  value={w.end}
                  onChange={(e) => {
                    const next = [...cleaningWindows];
                    next[idx] = { ...next[idx], end: e.target.value };
                    setCleaningWindows(next);
                  }}
                />
              </label>
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
            <div
              key={oi}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 10,
                marginBottom: 10,
              }}
            >
              <label style={{ width: '100%' }}>
                Name
                <input
                  value={op.name}
                  onChange={(e) => {
                    const next = [...operators];
                    next[oi] = { ...next[oi], name: e.target.value };
                    setOperators(next);
                  }}
                />
              </label>
              {op.windows.map((w, wi) => (
                <div key={wi} className="row" style={{ marginTop: 6 }}>
                  <label>
                    From
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
                  </label>
                  <label>
                    To
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
                  </label>
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
              <button
                type="button"
                className="primary"
                style={{ marginTop: 6 }}
                onClick={() => {
                  const next = [...operators];
                  next[oi] = { ...next[oi], windows: [...next[oi].windows, { start: '', end: '' }] };
                  setOperators(next);
                }}
              >
                Add shift segment
              </button>
              <button type="button" className="danger" style={{ marginTop: 6, marginLeft: 8 }} onClick={() => setOperators((prev) => prev.filter((_, i) => i !== oi))}>
                Remove operator
              </button>
            </div>
          ))}
          <button type="button" className="primary" onClick={() => setOperators((p) => [...p, emptyOperator()])}>
            Add another operator
          </button>
        </details>

        <details className="adminDetails">
          <summary title="Visit schedules from Workflow APIs. JSON until visual editor; use [] if not set up.">
            Technician &amp; QA (JSON)
          </summary>
          <label style={{ width: '100%', alignItems: 'flex-start' }}>
            Technician (responsible + visits)
            <textarea
              rows={4}
              value={technicianJson}
              onChange={(e) => setTechnicianJson(e.target.value)}
              style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
          </label>
          <label style={{ width: '100%', alignItems: 'flex-start', marginTop: 10 }}>
            QA officer (visits)
            <textarea
              rows={4}
              value={qaJson}
              onChange={(e) => setQaJson(e.target.value)}
              style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
          </label>
        </details>

        <details className="adminDetails">
          <summary title="Timezone for schedules; higher priority wins when rules overlap.">Time zone &amp; priority</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <label title="Usually Asia/Kuwait">
              Time zone
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: 160 }} />
            </label>
            <label title="Higher wins when rules overlap">
              Priority
              <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} style={{ width: 88 }} />
            </label>
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

      {machinesQ.isError ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Could not load machine list: {(machinesQ.error as Error).message}
        </p>
      ) : null}
    </>
  );
}
