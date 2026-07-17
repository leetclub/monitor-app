import { useEffect, useMemo, useRef, useState } from 'react';
import type { MachineRow } from '@/features/performance/perfTypes';

type Props = {
  machines: MachineRow[];
  /** null = all locations in the list */
  selected: Set<string> | null;
  onChange: (selected: Set<string> | null) => void;
};

function isChecked(id: string, selected: Set<string> | null): boolean {
  return selected === null || selected.has(id);
}

function displayName(m: MachineRow): string {
  const n = (m.name || '').trim();
  return n || 'Unnamed location';
}

/** Searchable multi-select for Performance locations (Select all = full fleet, loaded in batches). */
export function PerfMachineFilter({ machines, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const allSelected = selected === null;
  const empty = selected !== null && selected.size === 0;
  const count = allSelected ? machines.length : selected.size;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return machines;
    return machines.filter((m) => displayName(m).toLowerCase().includes(needle));
  }, [machines, q]);

  const selectedRows = useMemo(() => {
    if (allSelected) return [];
    const byId = new Map(machines.map((m) => [m.id, m]));
    return [...selected]
      .map((id) => byId.get(id))
      .filter((m): m is MachineRow => Boolean(m));
  }, [allSelected, selected, machines]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (id: string) => {
    const checked = isChecked(id, selected);
    if (checked) {
      if (allSelected) {
        onChange(new Set(machines.map((m) => m.id).filter((mid) => mid !== id)));
        return;
      }
      const next = new Set(selected);
      next.delete(id);
      onChange(next);
      return;
    }
    const next = new Set(selected ?? []);
    next.add(id);
    if (next.size >= machines.length) onChange(null);
    else onChange(next);
  };

  const onlyThis = (id: string) => {
    onChange(new Set([id]));
    setOpen(false);
  };

  const summary = empty
    ? 'No locations selected'
    : allSelected
      ? `All locations (${machines.length})`
      : count === 1
        ? displayName(selectedRows[0] || { id: '', name: '1 location' })
        : `${count} locations`;

  return (
    <section className="perfMachineFilter perfMachineFilterDropdown" aria-label="Filter machines for graphs">
      <div className="perfMachineFilterHead">
        <h3 className="perfMachineFilterTitle">Locations</h3>
        <span className="perfMachineFilterCount">{summary}</span>
      </div>
      <p className="perfMachineFilterHint">
        Search and pick locations for data. Graphs show up to 12 lines — use trajectory paging or
        custom pick on the chart.
      </p>

      <div className="perfLocSelect" ref={rootRef}>
        <button
          type="button"
          className={`perfLocSelectTrigger ${open ? 'open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="perfLocSelectSummary">{summary}</span>
          <span className="perfLocSelectChevron" aria-hidden>
            ▾
          </span>
        </button>

        {!allSelected && selectedRows.length > 0 ? (
          <div className="perfLocChips">
            {selectedRows.slice(0, 8).map((m) => (
              <button
                key={m.id}
                type="button"
                className="perfLocChip"
                onClick={() => toggle(m.id)}
                title={`Remove ${displayName(m)}`}
              >
                {displayName(m)}
                <span aria-hidden>×</span>
              </button>
            ))}
            {selectedRows.length > 8 ? (
              <span className="perfLocChipMore">+{selectedRows.length - 8}</span>
            ) : null}
          </div>
        ) : null}

        {open ? (
          <div className="perfLocDropdown" role="listbox">
            <div className="perfLocDropdownToolbar">
              <input
                type="search"
                className="perfLocSearch"
                placeholder="Search location…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
              <div className="perfMachineFilterActions">
                <button type="button" className={`perfSegPill ${allSelected ? 'active' : ''}`} onClick={() => onChange(null)}>
                  Select all
                </button>
                <button
                  type="button"
                  className={`perfSegPill ${empty ? 'active' : ''}`}
                  onClick={() => onChange(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="perfLocDropdownList">
              {filtered.length === 0 ? (
                <p className="perfMuted">No matches.</p>
              ) : (
                filtered.map((m) => {
                  const checked = isChecked(m.id, selected);
                  const solo = selected !== null && selected.size === 1 && selected.has(m.id);
                  const label = displayName(m);
                  return (
                    <div
                      key={m.id}
                      className={`perfLocRow ${solo ? 'perfLocRowSolo' : ''}`}
                    >
                      <label className="perfLocRowMain">
                        <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} />
                        <span className="perfLocRowName" title={label}>
                          {label}
                        </span>
                      </label>
                      <button
                        type="button"
                        className={`perfMachineOnlyBtn ${solo ? 'active' : ''}`}
                        onClick={() => onlyThis(m.id)}
                        title="Show only this location"
                      >
                        Only
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
