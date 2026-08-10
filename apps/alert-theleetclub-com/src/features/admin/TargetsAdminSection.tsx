import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';
import { HelpTip } from '@/components/HelpTip';
import { MachineIdSearchSelect, MachineMultiSearchSelect } from '@/components/MachineSearchSelect';

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

type LocInsights = {
  todayKd?: number;
  yesterdayKd?: number;
  avgDaily7d?: number | null;
  avgDaily14d?: number | null;
  avgDaily28d?: number | null;
  last7TotalKd?: number;
  wtdTotalKd?: number;
  lastWeekTotalKd?: number;
  suggestedDailyKd?: number | null;
  hint?: string;
};

type ProdInsights = {
  productName: string;
  todayCups?: number;
  yesterdayCups?: number;
  avgDaily7d?: number | null;
  avgDaily14d?: number | null;
  last7TotalCups?: number;
  wtdTotalCups?: number;
  lastWeekTotalCups?: number;
  suggestedDailyCups?: number | null;
  hint?: string;
};

type InsightsPayload = {
  location?: LocInsights;
  products?: ProdInsights[];
  error?: string;
};

function emptyProduct(name = '', period: TargetPeriod = 'daily'): PromotedProduct {
  return {
    productName: name,
    metric: 'cups',
    dailyTarget: null,
    period,
    primary: false,
  };
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function productsFromRow(t?: TargetsRow | null): PromotedProduct[] {
  if (!t) return [];
  const prods = Array.isArray(t.promotedProducts) ? t.promotedProducts : [];
  if (prods.length) {
    return prods.map((p, i) => ({
      productName: p.productName,
      metric: p.metric === 'revenue' ? 'revenue' : 'cups',
      dailyTarget: p.dailyTarget ?? null,
      period: p.period === 'weekly' || p.period === 'monthly' ? p.period : 'daily',
      primary: Boolean(p.primary) || i === 0,
    }));
  }
  if (t.sxProductName) {
    return [
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
    ];
  }
  return [];
}

function InsightsChip({
  title,
  body,
  onApply,
  applyLabel,
}: {
  title: string;
  body: string;
  onApply?: () => void;
  applyLabel?: string;
}) {
  return (
    <details className="adminInsightChip">
      <summary title="Sales insight to help set targets">{title}</summary>
      <div className="adminInsightBody">
        <p>{body}</p>
        {onApply ? (
          <button type="button" className="primary" onClick={onApply}>
            {applyLabel || 'Use suggested'}
          </button>
        ) : null}
      </div>
    </details>
  );
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkMachineIds, setBulkMachineIds] = useState<string[]>([]);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

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

  const productNamesKey = products
    .map((p) => p.productName)
    .filter(Boolean)
    .slice(0, 8)
    .join(',');

  const insightsQ = useQuery({
    queryKey: ['alert-target-insights', machineId, productNamesKey || 'auto'],
    queryFn: () => {
      const qs = new URLSearchParams({ machineId });
      if (productNamesKey) qs.set('products', productNamesKey);
      return apiGet<InsightsPayload>(`/api/alert/admin/target-insights?${qs}`);
    },
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

  const applyRowToForm = useCallback((id: string, t?: TargetsRow | null) => {
    setMachineId(id);
    setFormErr(null);
    setAddProductName('');
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
    setProducts(productsFromRow(t));
  }, []);

  const loadMachine = useCallback(
    (id: string) => applyRowToForm(id, targetById.get(id)),
    [applyRowToForm, targetById],
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
      if (next.length && !next.some((p) => p.primary)) next[0] = { ...next[0], primary: true };
      return next;
    });
  };

  const addProduct = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setProducts((prev) => {
      if (prev.some((p) => p.productName.toLowerCase() === n.toLowerCase())) return prev;
      const row = emptyProduct(n, defaultPeriod);
      row.primary = prev.length === 0;
      return [...prev, row];
    });
    setAddProductName('');
  };

  const promoteAllCatalog = () => {
    setProducts((prev) => {
      const byName = new Map(prev.map((p) => [p.productName.toLowerCase(), p]));
      for (const c of catalog) {
        const key = c.name.toLowerCase();
        if (!byName.has(key)) {
          const row = emptyProduct(c.name, defaultPeriod);
          byName.set(key, row);
        }
      }
      const next = [...byName.values()];
      if (next.length && !next.some((p) => p.primary)) next[0] = { ...next[0], primary: true };
      return next;
    });
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
      // Each product keeps its own target — server stores full promotedProducts JSON array
      return apiJson<TargetsRow & { ok?: boolean }>('/api/alert/admin/targets', {
        machineId,
        locationTargetMetric: locMetric,
        dailySalesTarget: dailySalesTarget.trim() === '' ? null : Number(dailySalesTarget),
        dailyLocationCupsTarget: dailyLocCups.trim() === '' ? null : Number(dailyLocCups),
        sxTargetPeriod: defaultPeriod,
        promotedProducts: cleaned,
      });
    },
    onSuccess: async (saved) => {
      setFormErr(null);
      await qc.invalidateQueries({ queryKey: ['alert-admin-targets'] });
      await qc.invalidateQueries({ queryKey: ['alert-target-insights'] });
      await qc.invalidateQueries({ queryKey: ['alert-performance-fleet'] });
      // Apply server response directly so products never “collapse” to one after save
      if (saved?.machineId) {
        applyRowToForm(saved.machineId, {
          machineId: saved.machineId,
          locationTargetMetric: saved.locationTargetMetric,
          dailySalesTarget: saved.dailySalesTarget,
          dailyLocationCupsTarget: saved.dailyLocationCupsTarget,
          sxTargetPeriod: saved.sxTargetPeriod,
          promotedProducts: saved.promotedProducts,
        });
      }
    },
  });

  const bulkLocMut = useMutation({
    mutationFn: async () => {
      if (!bulkMachineIds.length) throw new Error('Select at least one machine for bulk location target.');
      return apiJson<{ ok?: boolean; updated?: number }>('/api/alert/admin/targets/bulk-location', {
        machineIds: bulkMachineIds,
        locationTargetMetric: locMetric,
        dailySalesTarget: dailySalesTarget.trim() === '' ? null : Number(dailySalesTarget),
        dailyLocationCupsTarget: dailyLocCups.trim() === '' ? null : Number(dailyLocCups),
        sxTargetPeriod: defaultPeriod,
      });
    },
    onSuccess: async (res) => {
      setBulkMsg(`Location target applied to ${res.updated ?? bulkMachineIds.length} machine(s). Products unchanged.`);
      await qc.invalidateQueries({ queryKey: ['alert-admin-targets'] });
      await qc.invalidateQueries({ queryKey: ['alert-performance-fleet'] });
    },
    onError: (e: Error) => setBulkMsg(e.message),
  });

  const locIns = insightsQ.data?.location;
  const prodInsByName = useMemo(() => {
    const m = new Map<string, ProdInsights>();
    for (const p of insightsQ.data?.products || []) {
      if (p.productName) m.set(p.productName.toLowerCase(), p);
    }
    return m;
  }, [insightsQ.data?.products]);

  const q = filter.trim().toLowerCase();
  const tableRows = useMemo(() => {
    const rows = machines.map((m) => {
      const t = targetById.get(m.id);
      const prods = productsFromRow(t);
      return {
        id: m.id,
        name: m.name,
        locMetric: t?.locationTargetMetric || 'revenue',
        locKd: t?.dailySalesTarget ?? null,
        locCups: t?.dailyLocationCupsTarget ?? null,
        period: t?.sxTargetPeriod || 'daily',
        products: prods,
        hasAny: Boolean(
          t?.dailySalesTarget != null || t?.dailyLocationCupsTarget != null || prods.length,
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
        r.products.some((p) => p.productName.toLowerCase().includes(q)),
    );
  }, [machines, targetById, q]);

  useEffect(() => {
    if (expandedId && !targetById.has(expandedId) && !machines.some((m) => m.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, targetById, machines]);

  return (
    <>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: '0.9rem' }}>
        Set the <strong>location</strong> target once (KD or cups) — optionally apply to many machines at once.
        Promote <strong>one or many</strong> Vendon products <strong>per location</strong> — each keeps its own
        target. Insights use cached sales to guide the numbers.
      </p>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">
            {machineId ? `Targets · ${machineName || machineId}` : 'Location & product targets'}
          </h2>
          <HelpTip text="Location target is independent of products. Promote any number of products; saving stores the full list (not just the Primary/SX product)." />
        </div>

        {formErr || saveMut.isError ? (
          <div className="pillDanger" style={{ marginBottom: 12 }}>
            {formErr || (saveMut.error as Error)?.message}
          </div>
        ) : null}

        <div className="adminGroup">
          <div className="adminGroupLabel">Machine</div>
          <div className="adminFieldCell" style={{ maxWidth: 420 }}>
            <MachineIdSearchSelect
              aria-label="Machine"
              machines={machines}
              value={machineId}
              placeholder="Type to search, then pick…"
              onChange={(id) => {
                if (!id) clearForm();
                else loadMachine(id);
              }}
            />
          </div>
        </div>

        <div className="adminGroup">
          <div className="adminGroupLabelRow">
            <div className="adminGroupLabel">1 · Location target</div>
            <HelpTip text="Entered once for this machine. Edit anytime. Not overwritten by product targets." />
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
                <span className="adminFieldCaption">Target (KD / period)</span>
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
                <span className="adminFieldCaption">Target (cups / period)</span>
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
              <span className="adminFieldCaption">Period</span>
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
          {machineId ? (
            <div className="adminInsightRow">
              {insightsQ.isLoading ? (
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Loading sales insights…
                </span>
              ) : locIns ? (
                <InsightsChip
                  title={`Insight · loc 14d avg ${fmtNum(locIns.avgDaily14d)} KD`}
                  body={[
                    locIns.hint,
                    `Today ${fmtNum(locIns.todayKd)} · Yesterday ${fmtNum(locIns.yesterdayKd)}`,
                    `7d avg ${fmtNum(locIns.avgDaily7d)} · 28d avg ${fmtNum(locIns.avgDaily28d)}`,
                    `WTD ${fmtNum(locIns.wtdTotalKd)} · Last week ${fmtNum(locIns.lastWeekTotalKd)}`,
                    locIns.suggestedDailyKd != null
                      ? `Suggested daily ≈ ${fmtNum(locIns.suggestedDailyKd)} KD`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                  onApply={
                    locIns.suggestedDailyKd != null && locMetric === 'revenue'
                      ? () => setDailySalesTarget(String(locIns.suggestedDailyKd))
                      : undefined
                  }
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="adminGroup">
          <div className="adminGroupLabelRow">
            <div className="adminGroupLabel">1b · Apply location target to many machines</div>
            <HelpTip text="Sets the same location KD/cups + period on every selected machine. Does not change promoted products — those stay per location." />
          </div>
          <div className="adminFieldCell" style={{ maxWidth: 480 }}>
            <span className="adminFieldCaption">Machines (multi-select)</span>
            <MachineMultiSearchSelect
              aria-label="Machines for bulk location target"
              machines={machines}
              value={bulkMachineIds}
              onChange={setBulkMachineIds}
            />
          </div>
          <div className="adminSaveBar" style={{ marginTop: 10, borderTop: 'none', paddingTop: 0 }}>
            <button
              type="button"
              className="primary"
              disabled={!bulkMachineIds.length || bulkLocMut.isPending}
              onClick={() => {
                setBulkMsg(null);
                bulkLocMut.mutate();
              }}
            >
              {bulkLocMut.isPending
                ? 'Applying…'
                : `Apply location target to ${bulkMachineIds.length || '…'} machine(s)`}
            </button>
          </div>
          {bulkMsg ? (
            <p className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }} role="status">
              {bulkMsg}
            </p>
          ) : null}
        </div>

        <div className="adminGroup">
          <div className="adminGroupLabelRow">
            <div className="adminGroupLabel">2 · Promoted products</div>
            <HelpTip text="Add one product or promote the whole Vendon catalog for this machine. Each row has its own measure, target, and period. Primary = SX column." />
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
                <div className="adminFieldCell adminFieldCellActions">
                  <span className="adminFieldCaption" style={{ visibility: 'hidden' }}>
                    Actions
                  </span>
                  <div className="adminInlineActions">
                    <button
                      type="button"
                      className="primary"
                      disabled={!addProductName}
                      onClick={() => addProduct(addProductName)}
                    >
                      Promote
                    </button>
                    <button
                      type="button"
                      disabled={!catalog.length}
                      onClick={promoteAllCatalog}
                      title="Add every product seen in recent Vendon vends"
                    >
                      Promote all ({catalog.length})
                    </button>
                  </div>
                </div>
              </div>

              {!products.length ? (
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  No promoted products — pick from Vendon or Promote all.
                </p>
              ) : (
                <div className="tableWrap">
                  <table className="adminSavedProfilesTable">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Measure</th>
                        <th>Own target</th>
                        <th>Period</th>
                        <th>Primary</th>
                        <th>Insight</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p, idx) => {
                        const ins = prodInsByName.get(p.productName.toLowerCase());
                        return (
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
                              <label className="adminCheckLabel">
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
                              {ins ? (
                                <InsightsChip
                                  title={`14d ${fmtNum(ins.avgDaily14d)} cups`}
                                  body={[
                                    ins.hint,
                                    `Today ${fmtNum(ins.todayCups)} · Yday ${fmtNum(ins.yesterdayCups)}`,
                                    `Last week ${fmtNum(ins.lastWeekTotalCups)} · WTD ${fmtNum(ins.wtdTotalCups)}`,
                                    ins.suggestedDailyCups != null
                                      ? `Suggested ≈ ${fmtNum(ins.suggestedDailyCups)} cups/day`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join('\n')}
                                  onApply={
                                    ins.suggestedDailyCups != null && p.metric === 'cups'
                                      ? () =>
                                          updateProduct(idx, {
                                            dailyTarget: Number(ins.suggestedDailyCups),
                                          })
                                      : undefined
                                  }
                                />
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td>
                              <button type="button" className="danger" onClick={() => removeProduct(idx)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
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
          {products.length ? (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {products.length} product{products.length === 1 ? '' : 's'} will be saved with individual
              targets
            </span>
          ) : null}
        </div>
      </div>

      <div className="adminCard">
        <div className="adminCardHeadRow">
          <h2 className="adminCardTitle">Fleet targets</h2>
          <HelpTip text="One row per location. Expand to see every promoted product and its own target." />
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
                <th>Location</th>
                <th>Loc target</th>
                <th>Products</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => {
                const open = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="tableCellWrap">{r.name}</td>
                      <td>
                        {r.locMetric === 'cups'
                          ? r.locCups != null
                            ? `${fmtNum(r.locCups)} cups`
                            : '—'
                          : r.locKd != null
                            ? `${fmtNum(r.locKd)} KD`
                            : '—'}
                        <div className="muted" style={{ fontSize: '0.7rem' }}>
                          {r.period}
                        </div>
                      </td>
                      <td className="tableCellWrap">
                        {r.products.length ? (
                          <button
                            type="button"
                            className="adminLinkBtn"
                            onClick={() => setExpandedId(open ? null : r.id)}
                          >
                            {r.products.length} promoted {open ? '▴' : '▾'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="primary" onClick={() => loadMachine(r.id)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="adminExpandRow">
                        <td colSpan={4}>
                          <div className="adminExpandPanel">
                            <div className="adminGroupLabel" style={{ marginBottom: 8 }}>
                              Promoted products · {r.name}
                            </div>
                            <table className="adminSavedProfilesTable">
                              <thead>
                                <tr>
                                  <th>Product</th>
                                  <th>Measure</th>
                                  <th>Target</th>
                                  <th>Period</th>
                                  <th>Primary</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.products.map((p) => (
                                  <tr key={p.productName}>
                                    <td>{p.productName}</td>
                                    <td>{p.metric === 'revenue' ? 'KD' : 'Cups'}</td>
                                    <td>{fmtNum(p.dailyTarget)}</td>
                                    <td>{p.period}</td>
                                    <td>{p.primary ? 'SX' : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
