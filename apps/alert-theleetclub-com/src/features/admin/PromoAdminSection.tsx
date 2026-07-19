import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { HelpTip } from '@/components/HelpTip';
import { qaTodayIso } from '@/lib/qaVisitDateRange';
import {
  DEFAULT_PROMO_PRODUCT,
  savePromoAssignment,
  savePromoDayTargetsBulk,
  savePromoInstruments,
} from '@/features/promo/promoApi';

type MachineRow = { id: string; name: string };
type AreaOwnerRow = {
  vendonUserId: string;
  vendonUserName: string;
  machineIds: string[];
};
type VendonUser = { id: string; name: string };
type VendonProduct = { name: string; vendCount: number };

/** Admin → Promo: product assignment, calendar day cups targets, swipe instrument names. */
export function PromoAdminSection() {
  const qc = useQueryClient();
  const [scopeType, setScopeType] = useState<'machine' | 'owner'>('owner');
  const [machineId, setMachineId] = useState('');
  const [vendonUserId, setVendonUserId] = useState('');
  const [productName, setProductName] = useState(DEFAULT_PROMO_PRODUCT);
  const [targetCups, setTargetCups] = useState('20');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);
  const [instrumentOwnerId, setInstrumentOwnerId] = useState('');
  const [instrumentNames, setInstrumentNames] = useState('Promo A\nPromo B\nPromo C');
  const [message, setMessage] = useState<string | null>(null);

  const machinesQ = useQuery({
    queryKey: ['alert-machines'],
    queryFn: () => apiGet<{ machines: MachineRow[] }>('/api/alert/machines'),
  });
  const ownersQ = useQuery({
    queryKey: ['alert-admin-area-owners'],
    queryFn: () => apiGet<{ rows: AreaOwnerRow[] }>('/api/alert/admin/area-owners'),
  });
  const usersQ = useQuery({
    queryKey: ['alert-admin-vendon-users'],
    queryFn: () => apiGet<{ users: VendonUser[] }>('/api/alert/admin/vendon-users'),
  });

  const machines = machinesQ.data?.machines ?? [];
  const owners = ownersQ.data?.rows ?? [];
  const users = usersQ.data?.users ?? [];

  const catalogMachineId = useMemo(() => {
    if (scopeType === 'machine') return machineId;
    const area = owners.find((o) => o.vendonUserId === vendonUserId);
    return (area?.machineIds ?? []).find(Boolean) || '';
  }, [scopeType, machineId, owners, vendonUserId]);

  const vendonQ = useQuery({
    queryKey: ['alert-vendon-products', catalogMachineId || 'fleet'],
    queryFn: () => {
      const qs = new URLSearchParams({ days: '21' });
      if (catalogMachineId) qs.set('machineId', catalogMachineId);
      return apiGet<{ products?: VendonProduct[] }>(`/api/alert/admin/vendon-products?${qs}`);
    },
    staleTime: 5 * 60_000,
  });

  const catalog = useMemo(() => {
    const list = [...(vendonQ.data?.products || [])].sort(
      (a, b) => b.vendCount - a.vendCount || a.name.localeCompare(b.name),
    );
    if (
      DEFAULT_PROMO_PRODUCT &&
      !list.some((p) => p.name.toLowerCase() === DEFAULT_PROMO_PRODUCT.toLowerCase())
    ) {
      list.unshift({ name: DEFAULT_PROMO_PRODUCT, vendCount: 0 });
    }
    return list;
  }, [vendonQ.data?.products]);

  useEffect(() => {
    if (!catalog.length) return;
    const hit = catalog.find((p) => p.name.toLowerCase() === productName.toLowerCase());
    if (!hit) {
      const preferred =
        catalog.find((p) => p.name.toLowerCase() === DEFAULT_PROMO_PRODUCT.toLowerCase()) ??
        catalog[0];
      if (preferred) setProductName(preferred.name);
    }
  }, [catalog, productName]);

  const assignMut = useMutation({
    mutationFn: savePromoAssignment,
    onSuccess: async () => {
      setMessage('Product assignment saved.');
      await qc.invalidateQueries({ queryKey: ['alert-promo-performance'] });
    },
    onError: (e: Error) => setMessage(e.message),
  });
  const bulkMut = useMutation({
    mutationFn: savePromoDayTargetsBulk,
    onSuccess: async () => {
      setMessage('Day targets saved.');
      await qc.invalidateQueries({ queryKey: ['alert-promo-performance'] });
    },
    onError: (e: Error) => setMessage(e.message),
  });
  const instMut = useMutation({
    mutationFn: ({ uid, names }: { uid: string; names: string[] }) => savePromoInstruments(uid, names),
    onSuccess: async () => {
      setMessage('Swipe instruments saved.');
      await qc.invalidateQueries({ queryKey: ['alert-promo-instruments'] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const calendarDay = useMemo(() => qaTodayIso(), []);

  function toggleDate(d: string) {
    if (!d) return;
    setSelectedDates((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  const canSaveAssignment =
    Boolean(productName.trim()) &&
    (scopeType === 'machine' ? Boolean(machineId) : Boolean(vendonUserId));

  return (
    <div className="adminCard adminCardFlush">
      <div className="adminCardHeadRow">
        <h2 className="adminCardTitle">Promo</h2>
        <HelpTip text="Separate from Admin → Targets (KD / SX). Pick a Vendon product that counts toward promo cups, set calendar-day cup targets, and name swipe instruments." />
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 14, fontSize: '0.9rem', lineHeight: 1.5 }}>
        Promo uses the same cup-target tables as target.theleetclub.com. Product names come from Vendon (same catalog
        as Admin → Targets). Operators track progress on the Promo tab.
      </p>

      {message ? (
        <p className="muted" style={{ marginBottom: 12 }} role="status">
          {message}
        </p>
      ) : null}

      <div className="promoAdminGrid">
        <div>
          <h3 className="adminCardSubtitle">Product assignment</h3>
          <label className="promoField">
            Scope
            <select
              value={scopeType}
              onChange={(e) => setScopeType(e.target.value as 'machine' | 'owner')}
            >
              <option value="owner">Area owner (all their machines)</option>
              <option value="machine">Single machine</option>
            </select>
          </label>
          {scopeType === 'owner' ? (
            <label className="promoField">
              Owner
              <select value={vendonUserId} onChange={(e) => setVendonUserId(e.target.value)}>
                <option value="">Select…</option>
                {owners.map((o) => (
                  <option key={o.vendonUserId} value={o.vendonUserId}>
                    {o.vendonUserName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="promoField">
              Machine
              <select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">Select…</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="promoField">
            Product (from Vendon)
            <select
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              disabled={vendonQ.isLoading && !catalog.length}
            >
              {!catalog.length ? (
                <option value={DEFAULT_PROMO_PRODUCT}>
                  {vendonQ.isLoading ? 'Loading Vendon products…' : DEFAULT_PROMO_PRODUCT}
                </option>
              ) : (
                catalog.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.vendCount > 0 ? `${p.name} (${p.vendCount})` : p.name}
                  </option>
                ))
              )}
            </select>
          </label>
          {vendonQ.isError ? (
            <p className="muted" style={{ fontSize: '0.82rem', marginTop: 0 }}>
              Could not load Vendon catalog — check machine/owner selection.
            </p>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={assignMut.isPending || !canSaveAssignment}
            onClick={() => {
              setMessage(null);
              void assignMut.mutateAsync({
                scopeType,
                machineId: scopeType === 'machine' ? machineId : undefined,
                vendonUserId: scopeType === 'owner' ? vendonUserId : undefined,
                productName: productName.trim() || DEFAULT_PROMO_PRODUCT,
              });
            }}
          >
            {assignMut.isPending ? 'Saving…' : 'Save assignment'}
          </button>
        </div>

        <div>
          <h3 className="adminCardSubtitle">Calendar day targets</h3>
          <label className="promoField">
            Add day (toggle)
            <input type="date" value={calendarDay} onChange={(e) => toggleDate(e.target.value)} />
          </label>
          <p className="promoChipRow">
            {selectedDates.map((d) => (
              <button key={d} type="button" className="promoChip" onClick={() => toggleDate(d)}>
                {d} ×
              </button>
            ))}
          </p>
          <label className="promoField">
            Machines
            <select
              multiple
              size={6}
              value={selectedMachines}
              onChange={(e) => setSelectedMachines(Array.from(e.target.selectedOptions, (o) => o.value))}
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="promoField">
            Target cups / day
            <input value={targetCups} onChange={(e) => setTargetCups(e.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            disabled={bulkMut.isPending || !selectedDates.length || !selectedMachines.length}
            onClick={() => {
              setMessage(null);
              void bulkMut.mutateAsync({
                machineIds: selectedMachines,
                dates: selectedDates,
                targetCups: Math.max(0, parseInt(targetCups, 10) || 0),
              });
            }}
          >
            {bulkMut.isPending ? 'Saving…' : 'Save day targets'}
          </button>
        </div>

        <div>
          <h3 className="adminCardSubtitle">Swipe instruments</h3>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Placeholder names until real promo titles are supplied. Also editable under Area owners.
          </p>
          <label className="promoField">
            Owner
            <select value={instrumentOwnerId} onChange={(e) => setInstrumentOwnerId(e.target.value)}>
              <option value="">Select…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="promoField">
            Promotion names (one per line)
            <textarea
              rows={5}
              value={instrumentNames}
              onChange={(e) => setInstrumentNames(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={instMut.isPending || !instrumentOwnerId}
            onClick={() => {
              setMessage(null);
              void instMut.mutateAsync({
                uid: instrumentOwnerId,
                names: instrumentNames
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
            }}
          >
            {instMut.isPending ? 'Saving…' : 'Save instruments'}
          </button>
        </div>
      </div>
    </div>
  );
}
