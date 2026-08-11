import type { AreaOwnerRow } from '@/features/footfall/lib/areaOwnersApi';

/** Restrict each area to selected machine ids; null = all assigned machines. */
export function subsetAreasByMachines(
  areas: AreaOwnerRow[],
  machineFilter: Set<string> | null,
): AreaOwnerRow[] {
  if (machineFilter === null) return areas;
  if (machineFilter.size === 0) return [];
  return areas
    .map((a) => ({
      ...a,
      machineIds: a.machineIds.filter((id) => machineFilter.has(id)),
    }))
    .filter((a) => a.machineIds.length > 0);
}
