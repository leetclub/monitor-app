export type ColumnSortDir = 'asc' | 'desc';

export type ColumnSortState<K extends string> = {
  column: K | null;
  dir: ColumnSortDir | null;
};

/** Cycle: inactive → desc → asc → inactive (one active column at a time). */
export function cycleColumnSort<K extends string>(
  prev: ColumnSortState<K>,
  column: K,
): ColumnSortState<K> {
  if (prev.column !== column) return { column, dir: 'desc' };
  if (prev.dir === 'desc') return { column, dir: 'asc' };
  return { column: null, dir: null };
}

export function sortDirForColumn<K extends string>(
  sort: ColumnSortState<K>,
  column: K,
): ColumnSortDir | null {
  return sort.column === column ? sort.dir : null;
}

export function compareStrings(a: string, b: string, dir: ColumnSortDir): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: 'base' });
  return dir === 'asc' ? cmp : -cmp;
}

export function compareNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: ColumnSortDir,
  nullSentinel = dir === 'desc' ? -Infinity : Infinity,
): number {
  const va = a != null && Number.isFinite(Number(a)) ? Number(a) : nullSentinel;
  const vb = b != null && Number.isFinite(Number(b)) ? Number(b) : nullSentinel;
  const cmp = va - vb;
  return dir === 'asc' ? cmp : -cmp;
}
