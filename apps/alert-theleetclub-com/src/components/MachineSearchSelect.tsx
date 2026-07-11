import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type Props = {
  machines: string[];
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Called when user picks a machine from the list. */
  onSelect: (machineName: string) => void;
  /** Optional live filter text (for table filtering while typing). */
  onQueryChange?: (query: string) => void;
  className?: string;
  label?: string;
};

/** Searchable machine combobox — type to filter, click/Enter to select. */
export function MachineSearchSelect({
  machines,
  value = '',
  placeholder = 'Search machine…',
  disabled = false,
  onSelect,
  onQueryChange,
  className = '',
  label = 'Machine',
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return machines.slice(0, 80);
    const hits = machines.filter((name) => norm(name).includes(q));
    return hits.slice(0, 80);
  }, [machines, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent | TouchEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
    };
  }, [open]);

  function setQueryValue(next: string) {
    setQuery(next);
    onQueryChange?.(next);
    setOpen(true);
  }

  function pick(name: string) {
    setQuery(name);
    onQueryChange?.('');
    setOpen(false);
    onSelect(name);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = filtered[activeIndex];
      if (hit) pick(hit);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div
      ref={rootRef}
      className={`machineSearchSelect ${className}`.trim()}
      data-open={open ? 'true' : undefined}
    >
      <label className="qaVisitField machineSearchSelectField">
        <span className="qaVisitFieldLabel">{label}</span>
        <div className="machineSearchSelectControl">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && filtered[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => setQueryValue(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="machineSearchSelectChevron"
            tabIndex={-1}
            aria-label={open ? 'Close machine list' : 'Open machine list'}
            disabled={disabled}
            onClick={() => {
              setOpen((v) => !v);
              inputRef.current?.focus();
            }}
          >
            ▾
          </button>
        </div>
      </label>
      {open ? (
        <ul id={listId} className="machineSearchSelectList" role="listbox" aria-label="Machines">
          {filtered.length === 0 ? (
            <li className="machineSearchSelectEmpty" role="presentation">
              No machines match
            </li>
          ) : (
            filtered.map((name, index) => (
              <li key={name} role="presentation">
                <button
                  type="button"
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`machineSearchSelectOption${index === activeIndex ? ' machineSearchSelectOption--active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(name)}
                >
                  {name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
