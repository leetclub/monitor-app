import type { MachineRow } from '@/features/performance/perfTypes';

type Props = {
  machines: MachineRow[];
  /** null = all selected */
  selected: Set<string> | null;
  onChange: (selected: Set<string> | null) => void;
  maxSelect?: number;
};

function isChecked(id: string, selected: Set<string> | null): boolean {
  return selected === null || selected.has(id);
}

/** Areas-style checkbox machine filter for Performance multi-graphs. */
export function PerfMachineFilter({ machines, selected, onChange, maxSelect = 48 }: Props) {
  const allSelected = selected === null;
  const count = allSelected ? Math.min(machines.length, maxSelect) : selected.size;
  const allIds = machines.slice(0, maxSelect).map((m) => m.id);
  const list = machines.slice(0, 200);
  const empty = selected !== null && selected.size === 0;

  const toggle = (id: string) => {
    const checked = isChecked(id, selected);
    if (checked) {
      if (allSelected) {
        // Leaving "all" by unchecking one → keep the rest (not a surprise wipe)
        onChange(new Set(allIds.filter((mid) => mid !== id)));
        return;
      }
      const next = new Set(selected);
      next.delete(id);
      onChange(next);
      return;
    }
    const next = new Set(selected ?? []);
    if (next.size >= maxSelect) return;
    next.add(id);
    if (next.size >= allIds.length && allIds.length > 0) onChange(null);
    else onChange(next);
  };

  const onlyThis = (id: string) => {
    onChange(new Set([id]));
  };

  return (
    <section className="perfMachineFilter" aria-label="Filter machines for graphs">
      <div className="perfMachineFilterHead">
        <h3 className="perfMachineFilterTitle">Locations</h3>
        <span className="perfMachineFilterCount">
          {empty
            ? 'None selected'
            : allSelected
              ? `All (${Math.min(machines.length, maxSelect)})`
              : `${count} of ${Math.min(machines.length, maxSelect)}`}
          {machines.length > maxSelect ? ` · max ${maxSelect}` : ''}
        </span>
        <div className="perfMachineFilterActions">
          <button
            type="button"
            className={`perfSegPill ${allSelected ? 'active' : ''}`}
            onClick={() => onChange(null)}
            title="Include every location in the overview"
          >
            Select all
          </button>
          <button
            type="button"
            className={`perfSegPill ${empty ? 'active' : ''}`}
            onClick={() => onChange(new Set())}
            title="Clear selection, then tick the locations you want"
          >
            Clear
          </button>
        </div>
      </div>
      <p className="perfMachineFilterHint">
        Tip: use <strong>Only</strong> on a row to jump to one machine. Clear first if you want a
        small custom set.
      </p>
      <div className="perfMachineList">
        {list.map((m) => {
          const checked = isChecked(m.id, selected);
          const solo = selected !== null && selected.size === 1 && selected.has(m.id);
          return (
            <label key={m.id} className={`perfMachineRow ${solo ? 'perfMachineRowSolo' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(m.id)} />
              <span className="perfMachineRowName">{m.name}</span>
              <span className="perfMachineRowId">{m.id}</span>
              <button
                type="button"
                className={`perfMachineOnlyBtn ${solo ? 'active' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onlyThis(m.id);
                }}
                title="Show only this location"
              >
                Only
              </button>
            </label>
          );
        })}
      </div>
    </section>
  );
}
