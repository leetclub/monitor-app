const API = import.meta.env.VITE_PEOPLE_API_BASE ?? '';

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { credentials: 'include', ...init });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; success?: boolean };
  if (!r.ok) {
    throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  }
  return j;
}

export type VendonUserRow = {
  id: string;
  name: string;
  type?: string;
  email?: string | null;
};

export type TargetMachineRow = {
  id: string;
  name: string;
};

export type AreaOwnerRow = {
  vendonUserId: string;
  vendonUserName: string;
  machineIds: string[];
  machines?: TargetMachineRow[];
  loginUsername?: string | null;
  hasLogin?: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

export type SaveAreaOwnerInput = {
  vendonUserName: string;
  machineIds: string[];
  loginUsername?: string;
  password?: string;
};

export async function fetchVendonUsers(): Promise<VendonUserRow[]> {
  const j = await authedJson<{ success: boolean; users: VendonUserRow[] }>(
    '/api/target-site/vendon-users',
  );
  return j.users ?? [];
}

export async function fetchTargetMachines(): Promise<TargetMachineRow[]> {
  const j = await authedJson<{ success: boolean; machines: TargetMachineRow[] }>(
    '/api/target-site/machines',
  );
  return j.machines ?? [];
}

export async function fetchAreaOwners(): Promise<AreaOwnerRow[]> {
  const j = await authedJson<{ success: boolean; areas: AreaOwnerRow[] }>(
    '/api/target-site/area-owners',
  );
  return j.areas ?? [];
}

export async function saveAreaOwner(
  vendonUserId: string,
  input: SaveAreaOwnerInput,
): Promise<AreaOwnerRow> {
  const j = await authedJson<{ success: boolean; area: AreaOwnerRow }>(
    `/api/target-site/area-owners/${encodeURIComponent(vendonUserId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return j.area;
}

export async function deleteAreaOwner(vendonUserId: string): Promise<void> {
  await authedJson(`/api/target-site/area-owners/${encodeURIComponent(vendonUserId)}`, {
    method: 'DELETE',
  });
}
