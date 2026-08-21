import { useEffect, useMemo, useRef, useState } from 'react';
import type { MachineRow } from '@/features/performance/perfTypes';

type Props = {
  machines: MachineRow[];
  /** null = all locations in the list */
  selected: Set<string> | null;
  onChange: (selected: Set<string> | null) => void;
  /** When set, the user cannot check more than this many locations. */
  maxSelected?: number;
  /** When all locations are selected, clicking one starts a selection with only that site. */
  narrowFromAll?: boolean;
  hint?: string;
};

function isChecked(id: string, selected: Set<string> | null): boolean {
  return selected === null || selected.has(id);
}

function displayName(m: MachineRow): string {
  const n = (m.name || '').trim();
  return n || 'Unnamed location';
}

/** Compact searchable Locations bar (full width — not a tall empty sidebar). */
export function PerfMachineFilter({
  machines,
  selected,
  onChange,
  maxSelected,
  narrowFromAll = false,
  hint,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [atCapHint, setAtCapHint] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const allSelected = selected === null;
  const empty = selected !== null && selected.size === 0;
  const count = allSelected ? machines.length : selected.size;
  const atCap = maxSelected != null && selected !== null && selected.size >= maxSelected;

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
        if (narrowFromAll) {
          setAtCapHint(false);
          onChange(new Set([id]));
          return;
        }
        onChange(new Set(machines.map((m) => m.id).filter((mid) => mid !== id)));
        return;
      }
      const next = new Set(selected);
      next.delete(id);
      setAtCapHint(false);
      onChange(next);
      return;
    }
    if (maxSelected != null && selected !== null && selected.size >= maxSelected) {
      setAtCapHint(true);
      return;
    }
    const next = new Set(selected ?? []);
    next.add(id);
    setAtCapHint(false);
    if (maxSelected == null && next.size >= machines.length) onChange(null);
    else onChange(next);
  };

  const onlyThis = (id: string) => {
    onChange(new Set([id]));
    setOpen(false);
  };

  const summary = empty
    ? 'No locations selected'
    : allSelected
      ? maxSelected != null
        ? `Pick up to ${maxSelected}`
        : `All locations (${machines.length})`
      : count === 1
        ? displayName(selectedRows[0] || { id: '', name: '1 location' })
        : maxSelected != null
          ? `${count} of ${maxSelected} locations`
          : `${count} locations`;

  return (
    <section className="perfMachineFilter perfMachineFilterBar" aria-label="Filter machines for graphs">
      <div className="perfLocBarMain" ref={rootRef}>
        <div className="perfLocBarLabel">
          <h3 className="perfMachineFilterTitle">Locations</h3>
          <span className="perfMachineFilterCount">{summary}</span>
        </div>
        <div className="perfLocSelect">
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
                  <button
                    type="button"
                    className={`perfSegPill ${
                      maxSelected == null
                        ? allSelected
                          ? 'active'
                          : ''
                        : selected !== null && selected.size === maxSelected
                          ? 'active'
                          : ''
                    }`}
                    onClick={() => {
                      setAtCapHint(false);
                      if (maxSelected == null) {
                        onChange(null);
                        return;
                      }
                      onChange(new Set(machines.slice(0, maxSelected).map((m) => m.id)));
                    }}
                  >
                    {maxSelected == null ? 'Select all' : `Select all (${maxSelected})`}
                  </button>
                  <button
                    type="button"
                    className={`perfSegPill ${empty ? 'active' : ''}`}
                    onClick={() => {
                      setAtCapHint(false);
                      onChange(new Set());
                    }}
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
                      <div key={m.id} className={`perfLocRow ${solo ? 'perfLocRowSolo' : ''}`}>
                        <label className="perfLocRowMain">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!checked && atCap}
                            onChange={() => toggle(m.id)}
                          />
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
      </div>
      {!allSelected && selectedRows.length > 0 ? (
        <div className="perfLocChips perfLocChipsUnder">
          {selectedRows.slice(0, 10).map((m) => (
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
          {selectedRows.length > 10 ? (
            <span className="perfLocChipMore">+{selectedRows.length - 10}</span>
          ) : null}
        </div>
      ) : null}
      <p className="perfMachineFilterHint">
        {atCapHint && maxSelected != null ? (
          `Maximum ${maxSelected} locations. Uncheck one to add another.`
        ) : hint ? (
          hint
        ) : (
          <>
            Data scope for all charts. Trajectory lists up to 12 locations above the graph — side arrows
            or swipe change pages; <strong>Mix machines</strong> combines ranks across pages.
          </>
        )}
      </p>
    </section>
  );
}
