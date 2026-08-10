import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { machineMatchesSearch } from '@/lib/fleetOpsTools';

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type NameProps = {
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

/** Searchable machine combobox — type to filter, click/Enter to select (by name). */
export function MachineSearchSelect({
  machines,
  value = '',
  placeholder = 'Search machine…',
  disabled = false,
  onSelect,
  onQueryChange,
  className = '',
  label = 'Machine',
}: NameProps) {
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
        {label ? <span className="qaVisitFieldLabel">{label}</span> : null}
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

export type MachineOption = { id: string; name: string };

type IdProps = {
  machines: MachineOption[];
  value: string;
  onChange: (machineId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Caption above the control. Omit or pass empty to hide (parent caption). */
  label?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  title?: string;
  'aria-label'?: string;
};

/** Searchable single machine picker by id (Admin / forms). */
export function MachineIdSearchSelect({
  machines,
  value,
  onChange,
  placeholder = 'Type to search, then pick…',
  disabled = false,
  className = '',
  label,
  allowEmpty = true,
  emptyLabel = 'Choose…',
  title,
  'aria-label': ariaLabel,
}: IdProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedName = useMemo(() => {
    const hit = machines.find((m) => m.id === value);
    return hit ? hit.name || hit.id : '';
  }, [machines, value]);

  useEffect(() => {
    if (!open) setQuery(selectedName);
  }, [selectedName, open]);

  const filtered = useMemo(() => {
    const list = machines.filter((m) => machineMatchesSearch(query, m));
    return list.slice(0, 100);
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

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    const hit = machines.find((m) => m.id === id);
    setQuery(hit ? hit.name || hit.id : '');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const options: Array<{ id: string; name: string }> = allowEmpty
      ? [{ id: '', name: emptyLabel }, ...filtered]
      : filtered;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = options[activeIndex];
      if (hit) pick(hit.id);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery(selectedName);
      inputRef.current?.blur();
    }
  }

  const listRows: Array<{ id: string; name: string; meta?: string }> = allowEmpty
    ? [{ id: '', name: emptyLabel }, ...filtered.map((m) => ({ id: m.id, name: m.name || m.id, meta: m.id }))]
    : filtered.map((m) => ({ id: m.id, name: m.name || m.id, meta: m.id }));

  return (
    <div
      ref={rootRef}
      className={`machineSearchSelect machineIdSearchSelect ${className}`.trim()}
      data-open={open ? 'true' : undefined}
      title={title}
    >
      <div className="qaVisitField machineSearchSelectField">
        {label ? <span className="qaVisitFieldLabel">{label}</span> : null}
        <div className="machineSearchSelectControl">
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={ariaLabel || label || 'Machine'}
            aria-activedescendant={
              open && listRows[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined
            }
            placeholder={placeholder}
            value={open ? query : selectedName}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setQuery('');
              setOpen(true);
            }}
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
      </div>
      {open ? (
        <ul id={listId} className="machineSearchSelectList" role="listbox" aria-label="Machines">
          {filtered.length === 0 && query.trim() ? (
            <li className="machineSearchSelectEmpty" role="presentation">
              No machines match
            </li>
          ) : null}
          {listRows.map((row, index) => {
            if (filtered.length === 0 && query.trim() && row.id === '') return null;
            return (
              <li key={row.id || '__empty'} role="presentation">
                <button
                  type="button"
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={index === activeIndex || row.id === value}
                  className={`machineSearchSelectOption${index === activeIndex ? ' machineSearchSelectOption--active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(row.id)}
                >
                  <span className="machineSearchSelectOptionName">{row.name}</span>
                  {row.meta && row.id ? (
                    <span className="machineSearchSelectOptionMeta">#{row.meta}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

type MultiProps = {
  machines: MachineOption[];
  value: string[];
  onChange: (machineIds: string[]) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
  'aria-label'?: string;
  sizeHint?: number;
};

/** Searchable multi machine picker (checkboxes). */
export function MachineMultiSearchSelect({
  machines,
  value,
  onChange,
  disabled = false,
  className = '',
  label,
  'aria-label': ariaLabel,
  sizeHint = 8,
}: MultiProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    return machines.filter((m) => machineMatchesSearch(query, m)).slice(0, 200);
  }, [machines, query]);

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

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  const summary =
    value.length === 0
      ? 'None selected'
      : value.length === 1
        ? machines.find((m) => m.id === value[0])?.name || value[0]
        : `${value.length} machines selected`;

  return (
    <div
      ref={rootRef}
      className={`machineSearchSelect machineMultiSearchSelect ${className}`.trim()}
      data-open={open ? 'true' : undefined}
    >
      <div className="qaVisitField machineSearchSelectField">
        {label ? <span className="qaVisitFieldLabel">{label}</span> : null}
        <button
          type="button"
          className="machineMultiSearchTrigger"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel || label || 'Machines'}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="machineMultiSearchSummary">{summary}</span>
          <span aria-hidden>▾</span>
        </button>
      </div>
      {open ? (
        <div className="machineMultiSearchPanel" style={{ maxHeight: Math.max(220, sizeHint * 28) }}>
          <div className="machineMultiSearchToolbar">
            <input
              type="search"
              className="machineMultiSearchInput"
              placeholder="Search name or id…"
              value={query}
              disabled={disabled}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="machineMultiSearchActions">
              <button
                type="button"
                disabled={disabled || !machines.length}
                onClick={() => onChange(machines.map((m) => m.id))}
              >
                Select all
              </button>
              <button type="button" disabled={disabled || !value.length} onClick={() => onChange([])}>
                Clear
              </button>
            </div>
          </div>
          <ul className="machineMultiSearchList" role="listbox" aria-multiselectable>
            {filtered.length === 0 ? (
              <li className="machineSearchSelectEmpty">No machines match</li>
            ) : (
              filtered.map((m) => {
                const checked = selected.has(m.id);
                return (
                  <li key={m.id}>
                    <label className={`machineMultiSearchRow${checked ? ' machineMultiSearchRow--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(m.id)}
                      />
                      <span className="machineSearchSelectOptionName">{m.name || m.id}</span>
                      <span className="machineSearchSelectOptionMeta">#{m.id}</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
