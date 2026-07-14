import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';
import { HelpTip } from '@/components/HelpTip';

type MachineRow = { id: string; name: string };

type TargetMetric = 'revenue' | 'cups';
type TargetPeriod = 'daily' | 'weekly' | 'monthly';

type PromotedProduct = {
  productName: string;
  metric: TargetMetric;
  dailyTarget: number | null;
  period: TargetPeriod;
  primary?: boolean;
};

type TargetsRow = {
  machineId: string;
  dailySalesTarget?: number | null;
  locationTargetMetric?: TargetMetric;
  dailyLocationCupsTarget?: number | null;
  sxTargetPeriod?: TargetPeriod;
  promotedProducts?: PromotedProduct[];
  sxProductName?: string | null;
  dailyProductTarget?: number | null;
};

type VendonProduct = { name: string; vendCount: number };

function emptyProduct(name = ''): PromotedProduct {
  return {
    productName: name,
    metric: 'cups',
    dailyTarget: null,
    period: 'daily',
    primary: false,
  };
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function TargetsAdminSection() {
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState('');
  const [locMetric, setLocMetric] = useState<TargetMetric>('revenue');
  const [dailySalesTarget, setDailySalesTarget] = useState('');
  const [dailyLocCups, setDailyLocCups] = useState('');
  const [defaultPeriod, setDefaultPeriod] = useState<TargetPeriod>('daily');
  const [products, setProducts] = useState<PromotedProduct[]>([]);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [addProductName, setAddProductName] = useState('');

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<{ machines: MachineRow[] }>('/api/alert/machines'),
  });
  const targetsQ = useQuery({
    queryKey: ['alert-admin-targets'],
    queryFn: () => apiGet<{ rows: TargetsRow[] }>('/api/alert/admin/targets'),
  });
  const vendonQ = useQuery({
    queryKey: ['alert-vendon-products', machineId || 'none'],
    queryFn: () =>
      apiGet<{ products?: VendonProduct[] }>(
        `/api/alert/admin/vendon-products?machineId=${encodeURIComponent(machineId)}&days=21`,
      ),
    enabled: Boolean(machineId),
    staleTime: 5 * 60_000,
  });

  const machines = machinesQ.data?.machines ?? [];
  const targetById = useMemo(() => {
    const m = new Map<string, TargetsRow>();
    for (const r of targetsQ.data?.rows || []) m.set(r.machineId, r);
    return m;
  }, [targetsQ.data?.rows]);

  const machineName = useMemo(
    () => machines.find((m) => m.id === machineId)?.name ?? '',
    [machines, machineId],
  );

  const catalog = useMemo(() => {
    const list = vendonQ.data?.products || [];
    return [...list].sort((a, b) => b.vendCount - a.vendCount || a.name.localeCompare(b.name));
  }, [vendonQ.data?.products]);

  const loadMachine = useCallback(
    (id: string) => {
      setMachineId(id);
      setFormErr(null);
      setAddProductName('');
      const t = targetById.get(id);
      if (!t) {
        setLocMetric('revenue');
        setDailySalesTarget('');
        setDailyLocCups('');
        setDefaultPeriod('daily');
        setProducts([]);
        return;
      }
      setLocMetric(t.locationTargetMetric === 'cups' ? 'cups' : 'revenue');
      setDailySalesTarget(
        t.dailySalesTarget != null && Number.isFinite(Number(t.dailySalesTarget))
          ? String(t.dailySalesTarget)
          : '',
      );
      setDailyLocCups(
        t.dailyLocationCupsTarget != null && Number.isFinite(Number(t.dailyLocationCupsTarget))
          ? String(t.dailyLocationCupsTarget)
          : '',
      );
      setDefaultPeriod(
        t.sxTargetPeriod === 'weekly' || t.sxTargetPeriod === 'monthly' ? t.sxTargetPeriod : 'daily',
      );
      const prods = Array.isArray(t.promotedProducts) ? t.promotedProducts : [];
      if (prods.length) {
        setProducts(
          prods.map((p, i) => ({
            productName: p.productName,
            metric: p.metric === 'revenue' ? 'revenue' : 'cups',
            dailyTarget: p.dailyTarget ?? null,
            period:
              p.period === 'weekly' || p.period === 'monthly' ? p.period : 'daily',
            primary: Boolean(p.primary) || i === 0,
          })),
        );
      } else if (t.sxProductName) {
        setProducts([
          {
            productName: t.sxProductName,
            metric: 'cups',
            dailyTarget: t.dailyProductTarget ?? null,
            period:
              t.sxTargetPeriod === 'weekly' || t.sxTargetPeriod === 'monthly'
                ? t.sxTargetPeriod
                : 'daily',
            primary: true,
          },
        ]);
      } else {
        setProducts([]);
      }
    },
    [targetById],
  );

  const clearForm = () => {
    setMachineId('');
    setLocMetric('revenue');
    setDailySalesTarget('');
    setDailyLocCups('');
    setDefaultPeriod('daily');
    setProducts([]);
    setAddProductName('');
    setFormErr(null);
  };

  const setPrimary = (idx: number) => {
    setProducts((prev) => prev.map((p, i) => ({ ...p, primary: i === idx })));
  };

  const updateProduct = (idx: number, patch: Partial<PromotedProduct>) => {
    setProducts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const removeProduct = (idx: number) => {
    setProducts((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length && !next.some((p) => p.primary)) next[0].primary = true;
      return next;
    });
  };

  const addProduct = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setProducts((prev) => {
      if (prev.some((p) => p.productName.toLowerCase() === n.toLowerCase())) return prev;
      const row = emptyProduct(n);
      row.period = defaultPeriod;
      row.primary = prev.length === 0;
      return [...prev, row];
    });
    setAddProductName('');
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!machineId.trim()) throw new Error('Choose a machine first.');
      const cleaned = products
        .map((p) => ({
          productName: p.productName.trim(),
          metric: p.metric,
          dailyTarget:
            p.dailyTarget != null && Number.isFinite(Number(p.dailyTarget))
              ? Number(p.dailyTarget)
              : null,
          period: p.period,
          primary: Boolean(p.primary),
        }))
        .filter((p) => p.productName);
      if (cleaned.length && !cleaned.some((p) => p.primary)) cleaned[0].primary = true;
      return apiJson('/api/alert/admin/targets', {
        machineId,
        locationTargetMetric: locMetric,
        dailySalesTarget: dailySalesTarget.trim() === '' ? null : Number(dailySalesTarget),
        dailyLocationCupsTarget: dailyLocCups.trim() === '' ? null : Number(dailyLocCups),
        sxTargetPeriod: defaultPeriod,
        promotedProducts: cleaned,
      });
    },
    onSuccess: async () => {
      setFormErr(null);
      await qc.invalidateQueries({ queryKey: ['alert-admin-targets'] });
      await qc.invalidateQueries({ queryKey: ['alert-machine-profiles'] });
      await qc.invalidateQueries({ queryKey: ['alert-performance-fleet'] });
      if (machineId) loadMachine(machineId);
    },
  });

  const q = filter.trim().toLowerCase();
  const tableRows = useMemo(() => {
    const rows = machines.map((m) => {
      const t = targetById.get(m.id);
      const prods = t?.promotedProducts?.length
        ? t.promotedProducts
        : t?.sxProductName
          ? [{ productName: t.sxProductName, dailyTarget: t.dailyProductTarget }]
          : [];
      return {
        id: m.id,
        name: m.name,
        locMetric: t?.locationTargetMetric || 'revenue',
        locKd: t?.dailySalesTarget ?? null,
        locCups: t?.dailyLocationCupsTarget ?? null,
        products: prods,
        hasAny: Boolean(
          t?.dailySalesTarget != null ||
            t?.dailyLocationCupsTarget != null ||
            (prods && prods.length),
        ),
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
        r.products.some((p) => (p.productName || '').toLowerCase().includes(q)),
    );
  }, [machines, targetById, q]);

  return (
    <>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: '0.9rem' }}>
        Location targets (KD or cups) and promoted products from Vendon — each product has its own
        cups or revenue target. Used by Performance + SX.
      </p>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">
            {machineId ? `Targets · ${machineName || machineId}` : 'Location & product targets'}
          </h2>
          <HelpTip text="Pick a machine, set the location target unit (KD or cups), then promote one or more Vendon products with their own targets. Mark one product as Primary for SX column compatibility." />
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
          <div className="adminGroupLabelRow">
            <div className="adminGroupLabel">Location target</div>
            <HelpTip text="Revenue = KD (overrides week default). Cups = total location cups target for the period." />
          </div>
          <div className="adminMachineCoreRow adminMachineCoreRow--3">
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Measure by</span>
              <select
                value={locMetric}
                onChange={(e) => setLocMetric(e.target.value as TargetMetric)}
              >
                <option value="revenue">Revenue (KD)</option>
                <option value="cups">Cups</option>
              </select>
            </div>
            {locMetric === 'revenue' ? (
              <div className="adminFieldCell">
                <span className="adminFieldCaption">Target (KD)</span>
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  value={dailySalesTarget}
                  onChange={(e) => setDailySalesTarget(e.target.value)}
                  placeholder="e.g. 45"
                />
              </div>
            ) : (
              <div className="adminFieldCell">
                <span className="adminFieldCaption">Target (cups)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={dailyLocCups}
                  onChange={(e) => setDailyLocCups(e.target.value)}
                  placeholder="e.g. 200"
                />
              </div>
            )}
            <div className="adminFieldCell">
              <span className="adminFieldCaption">Default period</span>
              <select
                value={defaultPeriod}
                onChange={(e) => setDefaultPeriod(e.target.value as TargetPeriod)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        </div>

        <div className="adminGroup">
          <div className="adminGroupLabelRow">
            <div className="adminGroupLabel">Promoted products</div>
            <HelpTip text="Products are loaded from recent Vendon vends for this machine. Add several; each has cups or KD target and its own period." />
          </div>

          {!machineId ? (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Select a machine to load Vendon products.
            </p>
          ) : (
            <>
              <div className="adminMachineCoreRow adminMachineCoreRow--2" style={{ marginBottom: 12 }}>
                <div className="adminFieldCell">
                  <span className="adminFieldCaption">Add from Vendon</span>
                  <select
                    value={addProductName}
                    onChange={(e) => setAddProductName(e.target.value)}
                    disabled={vendonQ.isLoading}
                  >
                    <option value="">
                      {vendonQ.isLoading
                        ? 'Loading products…'
                        : catalog.length
                          ? 'Choose product…'
                          : 'No recent products found'}
                    </option>
                    {catalog.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({p.vendCount})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adminFieldCell" style={{ justifyContent: 'flex-end' }}>
                  <span className="adminFieldCaption" style={{ visibility: 'hidden' }}>
                    Add
                  </span>
                  <button
                    type="button"
                    className="primary"
                    disabled={!addProductName}
                    onClick={() => addProduct(addProductName)}
                  >
                    Promote product
                  </button>
                </div>
              </div>

              {vendonQ.isError ? (
                <p className="pillDanger" style={{ fontSize: '0.85rem' }}>
                  Could not load Vendon products: {(vendonQ.error as Error).message}
                </p>
              ) : null}

              {!products.length ? (
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  No promoted products yet — pick from the Vendon list above.
                </p>
              ) : (
                <div className="tableWrap">
                  <table className="adminSavedProfilesTable">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Measure</th>
                        <th>Target</th>
                        <th>Period</th>
                        <th>Primary</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p, idx) => (
                        <tr key={`${p.productName}-${idx}`}>
                          <td className="tableCellWrap">{p.productName}</td>
                          <td>
                            <select
                              value={p.metric}
                              onChange={(e) =>
                                updateProduct(idx, { metric: e.target.value as TargetMetric })
                              }
                            >
                              <option value="cups">Cups</option>
                              <option value="revenue">Revenue (KD)</option>
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={p.metric === 'cups' ? 1 : 0.001}
                              value={p.dailyTarget ?? ''}
                              onChange={(e) =>
                                updateProduct(idx, {
                                  dailyTarget:
                                    e.target.value.trim() === '' ? null : Number(e.target.value),
                                })
                              }
                              placeholder={p.metric === 'cups' ? 'cups' : 'KD'}
                              style={{ minWidth: 88 }}
                            />
                          </td>
                          <td>
                            <select
                              value={p.period}
                              onChange={(e) =>
                                updateProduct(idx, { period: e.target.value as TargetPeriod })
                              }
                            >
                              <option value="daily">Daily</option>
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                            </select>
                          </td>
                          <td>
                            <label className="adminInlineDayPick" style={{ gap: 6 }}>
                              <input
                                type="radio"
                                name="primary-product"
                                checked={Boolean(p.primary)}
                                onChange={() => setPrimary(idx)}
                              />
                              SX
                            </label>
                          </td>
                          <td>
                            <button type="button" className="danger" onClick={() => removeProduct(idx)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
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
          <HelpTip text="Catalog machines with saved location/product targets. Edit loads the form above." />
        </div>
        <div className="adminFieldCell" style={{ maxWidth: 320, marginBottom: 12 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, id, or product…"
            aria-label="Filter machines"
          />
        </div>
        {machinesQ.isLoading || targetsQ.isLoading ? <div className="muted">Loading…</div> : null}
        <div className="tableWrap tableWrapBounded">
          <table className="adminSavedProfilesTable">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Location</th>
                <th>Promoted products</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.id}>
                  <td className="tableCellWrap">{r.name}</td>
                  <td>
                    {r.locMetric === 'cups'
                      ? r.locCups != null
                        ? `${fmtNum(r.locCups)} cups`
                        : '—'
                      : r.locKd != null
                        ? `${fmtNum(r.locKd)} KD`
                        : '—'}
                  </td>
                  <td className="tableCellWrap">
                    {r.products.length
                      ? r.products
                          .map(
                            (p) =>
                              `${p.productName}${
                                p.dailyTarget != null ? ` (${fmtNum(p.dailyTarget)})` : ''
                              }`,
                          )
                          .join(' · ')
                      : '—'}
                  </td>
                  <td>
                    <button type="button" className="primary" onClick={() => loadMachine(r.id)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!tableRows.length && !machinesQ.isLoading ? (
                <tr>
                  <td colSpan={4} className="muted">
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
