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
export function PerfMachineFilter({ machines, selected, onChange, maxSelect = 24 }: Props) {
  const allSelected = selected === null;
  const count = allSelected ? Math.min(machines.length, maxSelect) : selected.size;
  const allIds = machines.slice(0, maxSelect).map((m) => m.id);
  const list = machines.slice(0, 200);

  const toggle = (id: string) => {
    const checked = isChecked(id, selected);
    if (checked) {
      if (allSelected) {
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
    if (next.size >= allIds.length) onChange(null);
    else onChange(next);
  };

  return (
    <section className="perfMachineFilter" aria-label="Filter machines for graphs">
      <div className="perfMachineFilterHead">
        <h3 className="perfMachineFilterTitle">Locations</h3>
        <span className="perfMachineFilterCount">
          {count} of {Math.min(machines.length, maxSelect)} selected
          {machines.length > maxSelect ? ` · max ${maxSelect}` : ''}
        </span>
        <div className="perfMachineFilterActions">
          <button
            type="button"
            className={`perfSegPill ${allSelected ? 'active' : ''}`}
            onClick={() => onChange(null)}
          >
            Select all
          </button>
          {!allSelected ? (
            <button type="button" className="perfSegPill" onClick={() => onChange(new Set())}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
      <div className="perfMachineList">
        {list.map((m) => (
          <label key={m.id} className="perfMachineRow">
            <input type="checkbox" checked={isChecked(m.id, selected)} onChange={() => toggle(m.id)} />
            <span className="perfMachineRowName">{m.name}</span>
            <span className="perfMachineRowId">{m.id}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
