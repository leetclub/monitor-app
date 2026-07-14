import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';
import { HelpTip } from '@/components/HelpTip';

type MachineRow = { id: string; name: string };

type ProfileRow = {
  machine_id: string;
  machine_name: string | null;
  location_owner: string | null;
  location_hours: string | null;
  operating_days: unknown;
  cleaning_windows: unknown;
  operator_hours: unknown;
  technician_schedule: unknown;
  qa_schedule: unknown;
  timezone: string;
  priority?: number;
  daily_sales_target?: number | null;
  sx_product_name?: string | null;
  daily_product_target?: number | null;
  sx_target_period?: string | null;
  updated_at?: string | null;
};

function fmtKd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return String(v);
}

function fmtCups(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return String(Math.round(Number(v)));
}

export function TargetsAdminSection() {
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState('');
  const [dailySalesTarget, setDailySalesTarget] = useState('');
  const [sxProductName, setSxProductName] = useState('Americano Max');
  const [dailyProductTarget, setDailyProductTarget] = useState('');
  const [sxTargetPeriod, setSxTargetPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [formErr, setFormErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<{ machines: MachineRow[] }>('/api/alert/machines'),
  });
  const profilesQ = useQuery({
    queryKey: ['alert-machine-profiles'],
    queryFn: () => apiGet<{ rows: ProfileRow[] }>('/api/alert/admin/machine-profiles'),
  });

  const machines = machinesQ.data?.machines ?? [];
  const profiles = profilesQ.data?.rows ?? [];
  const profileById = useMemo(() => {
    const m = new Map<string, ProfileRow>();
    for (const r of profiles) m.set(r.machine_id, r);
    return m;
  }, [profiles]);

  const machineName = useMemo(
    () => machines.find((m) => m.id === machineId)?.name ?? '',
    [machines, machineId],
  );

  const loadMachine = useCallback(
    (id: string) => {
      setMachineId(id);
      setFormErr(null);
      const p = profileById.get(id);
      if (!p) {
        setDailySalesTarget('');
        setSxProductName('Americano Max');
        setDailyProductTarget('');
        setSxTargetPeriod('daily');
        return;
      }
      setDailySalesTarget(
        p.daily_sales_target != null && Number.isFinite(Number(p.daily_sales_target))
          ? String(p.daily_sales_target)
          : '',
      );
      setSxProductName((p.sx_product_name || '').trim() || 'Americano Max');
      setDailyProductTarget(
        p.daily_product_target != null && Number.isFinite(Number(p.daily_product_target))
          ? String(p.daily_product_target)
          : '',
      );
      const per = String(p.sx_target_period || 'daily').toLowerCase();
      setSxTargetPeriod(per === 'weekly' || per === 'monthly' ? per : 'daily');
    },
    [profileById],
  );

  const clearForm = () => {
    setMachineId('');
    setDailySalesTarget('');
    setSxProductName('Americano Max');
    setDailyProductTarget('');
    setSxTargetPeriod('daily');
    setFormErr(null);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!machineId.trim()) throw new Error('Choose a machine first.');
      const existing = profileById.get(machineId);
      const body: Record<string, unknown> = {
        machine_id: machineId,
        machine_name: machineName || existing?.machine_name || null,
        location_owner: existing?.location_owner ?? null,
        location_hours: existing?.location_hours ?? null,
        operating_days: existing?.operating_days ?? { preset: 'all_week' },
        cleaning_windows: Array.isArray(existing?.cleaning_windows) ? existing!.cleaning_windows : [],
        operator_hours: Array.isArray(existing?.operator_hours) ? existing!.operator_hours : [],
        technician_schedule: Array.isArray(existing?.technician_schedule)
          ? existing!.technician_schedule
          : [],
        qa_schedule: Array.isArray(existing?.qa_schedule) ? existing!.qa_schedule : [],
        timezone: existing?.timezone || 'Asia/Kuwait',
        priority: typeof existing?.priority === 'number' ? existing.priority : 10,
        daily_sales_target: dailySalesTarget.trim() === '' ? null : Number(dailySalesTarget),
        sx_product_name: sxProductName.trim() || 'Americano Max',
        daily_product_target: dailyProductTarget.trim() === '' ? null : Number(dailyProductTarget),
        sx_target_period: sxTargetPeriod,
      };
      if (
        body.daily_sales_target != null &&
        (!Number.isFinite(body.daily_sales_target as number) || (body.daily_sales_target as number) < 0)
      ) {
        throw new Error('Daily target (KD) must be a valid number.');
      }
      if (
        body.daily_product_target != null &&
        (!Number.isFinite(body.daily_product_target as number) || (body.daily_product_target as number) < 0)
      ) {
        throw new Error('Product target (cups) must be a valid number.');
      }
      return apiJson('/api/alert/admin/machine-profiles', body);
    },
    onSuccess: async () => {
      setFormErr(null);
      await qc.invalidateQueries({ queryKey: ['alert-machine-profiles'] });
      await qc.invalidateQueries({ queryKey: ['alert-performance-fleet'] });
      await qc.invalidateQueries({ queryKey: ['alert-performance'] });
    },
  });

  const q = filter.trim().toLowerCase();
  const tableRows = useMemo(() => {
    const rows = machines.map((m) => {
      const p = profileById.get(m.id);
      return {
        id: m.id,
        name: m.name,
        locKd: p?.daily_sales_target ?? null,
        product: (p?.sx_product_name || '').trim() || null,
        cups: p?.daily_product_target ?? null,
        period: (p?.sx_target_period || 'daily').toLowerCase(),
        hasAny:
          p?.daily_sales_target != null ||
          p?.daily_product_target != null ||
          Boolean((p?.sx_product_name || '').trim()),
      };
    });
    rows.sort((a, b) => {
      if (a.hasAny !== b.hasAny) return a.hasAny ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.product || '').toLowerCase().includes(q),
    );
  }, [machines, profileById, q]);

  return (
    <>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: '0.9rem' }}>
        Location KD and promoted-product cup targets used by Performance + SX. Cleaning schedules stay under{' '}
        <strong>Machines</strong>.
      </p>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">
            {machineId ? `Targets: ${machineName || machineId}` : 'Location & product targets'}
          </h2>
          <HelpTip text="Daily KD target overrides the week default when set. SX product is matched as a substring on Vendon vend names (default Americano Max). Period converts weekly/monthly targets into a daily yardstick on charts." />
        </div>

        {formErr || saveMut.isError ? (
          <div className="pillDanger" style={{ marginBottom: 12 }}>
            {formErr || (saveMut.error as Error)?.message}
          </div>
        ) : null}

        <div className="adminGroup">
          <div className="adminGroupLabel">Machine</div>
          <div className="adminFieldCell" style={{ maxWidth: 420 }}>
            <select
              value={machineId}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) clearForm();
                else loadMachine(id);
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
        </div>

        <div className="adminGroup">
          <div className="adminGroupLabel">Location revenue</div>
          <div className="adminMachineCoreRow">
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Daily target (KD)</span>
              <input
                type="number"
                min={0}
                step={0.001}
                value={dailySalesTarget}
                onChange={(e) => setDailySalesTarget(e.target.value)}
                placeholder="e.g. 45"
                title="Location daily sales target — overrides week default when set"
              />
            </div>
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Target period</span>
              <select
                value={sxTargetPeriod}
                onChange={(e) => setSxTargetPeriod(e.target.value as 'daily' | 'weekly' | 'monthly')}
                title="How location/product targets apply for Performance + SX"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        </div>

        <div className="adminGroup">
          <div className="adminGroupLabel">Promoted product (SX)</div>
          <div className="adminMachineCoreRow">
            <div className="adminFieldCell">
              <span className="adminFieldCaption">SX product</span>
              <input
                value={sxProductName}
                onChange={(e) => setSxProductName(e.target.value)}
                placeholder="e.g. Americano Max"
                autoComplete="off"
                title="Vendon product name (substring match)"
              />
            </div>
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Product target (cups)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={dailyProductTarget}
                onChange={(e) => setDailyProductTarget(e.target.value)}
                placeholder="e.g. 80"
                title="Cup target for the SX product (interpreted by period)"
              />
            </div>
          </div>
        </div>

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
            {saveMut.isPending ? 'Saving…' : 'Save targets'}
          </button>
          <button type="button" onClick={clearForm}>
            Clear
          </button>
        </div>
      </div>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">Fleet targets</h2>
          <HelpTip text="All catalog machines. Edit loads the form above. Machines with no saved targets show dashes." />
        </div>
        <div className="adminFieldCell" style={{ maxWidth: 320, marginBottom: 12 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, id, or product…"
            aria-label="Filter machines"
          />
        </div>
        {machinesQ.isLoading || profilesQ.isLoading ? <div className="muted">Loading…</div> : null}
        {machinesQ.isError ? (
          <div className="muted">{(machinesQ.error as Error).message}</div>
        ) : null}
        <div className="tableWrap tableWrapBounded">
          <table className="adminSavedProfilesTable">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Loc KD</th>
                <th>SX product</th>
                <th>Cups</th>
                <th>Period</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.id}>
                  <td className="tableCellWrap">{r.name}</td>
                  <td>{fmtKd(r.locKd)}</td>
                  <td className="tableCellWrap">{r.product || '—'}</td>
                  <td>{fmtCups(r.cups)}</td>
                  <td className="muted">{r.period}</td>
                  <td>
                    <button type="button" className="primary" onClick={() => loadMachine(r.id)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!tableRows.length && !machinesQ.isLoading ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No machines match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
