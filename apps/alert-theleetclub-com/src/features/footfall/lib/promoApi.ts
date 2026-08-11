const API = import.meta.env.VITE_PEOPLE_API_BASE ?? '';

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { credentials: 'include', ...init });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; ok?: boolean };
  if (!r.ok) {
    throw new Error((j as { error?: string }).error || `Request failed (${r.status})`);
  }
  return j;
}

export type PromoAssignment = {
  id?: number;
  scope_type: 'machine' | 'owner';
  machine_id?: string | null;
  vendon_user_id?: string | null;
  product_name: string;
  updated_by?: string | null;
  updated_at?: string | null;
};

export type PromoDayTarget = {
  id?: number;
  machine_id: string;
  target_date: string;
  target_cups: number;
};

export type PromoDayPerformance = {
  date: string;
  targetCups: number;
  achievedCups: number;
  remainingCups: number;
  pct: number | null;
};

export type PromoLocationPerformance = {
  machineId: string;
  machineName: string;
  productName: string;
  days: PromoDayPerformance[];
  totalTargetCups: number;
  totalAchievedCups: number;
  periodPct: number | null;
};

export type PromoPerformancePayload = {
  ok?: boolean;
  startDate: string;
  endDate: string;
  defaultProduct: string;
  locations: PromoLocationPerformance[];
};

export type PromoInstrument = {
  id: number;
  vendon_user_id: string;
  name: string;
  sort_order: number;
};

export type PromoSwipeEvent = {
  id: number;
  instrument_id: number;
  instrument_name?: string;
  machine_id: string;
  swiped_at: string;
  product_cups_now?: number | null;
  product_cups_yesterday_same_time?: number | null;
  delta_cups?: number | null;
  note?: string | null;
};

export async function fetchPromoAssignments(): Promise<PromoAssignment[]> {
  const j = await authedJson<{ ok: boolean; assignments: PromoAssignment[] }>(
    '/api/target-site/promo/assignments',
  );
  return j.assignments ?? [];
}

export async function savePromoAssignment(body: {
  scopeType: 'machine' | 'owner';
  machineId?: string;
  vendonUserId?: string;
  productName: string;
}): Promise<void> {
  await authedJson('/api/target-site/promo/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function savePromoDayTargetsBulk(body: {
  machineIds: string[];
  dates: string[];
  targetCups: number;
}): Promise<void> {
  await authedJson('/api/target-site/promo/day-targets/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchPromoPerformance(
  startDate: string,
  endDate: string,
  machineIds?: string[],
): Promise<PromoPerformancePayload> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  if (machineIds?.length) params.set('machine_ids', machineIds.join(','));
  return authedJson<PromoPerformancePayload>(`/api/target-site/promo/performance?${params}`);
}

export async function fetchPromoInstruments(vendonUserId: string): Promise<PromoInstrument[]> {
  const params = new URLSearchParams({ vendon_user_id: vendonUserId });
  const j = await authedJson<{ ok: boolean; instruments: PromoInstrument[] }>(
    `/api/target-site/promo/instruments?${params}`,
  );
  return j.instruments ?? [];
}

export async function savePromoInstruments(vendonUserId: string, names: string[]): Promise<void> {
  await authedJson('/api/target-site/promo/instruments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendonUserId, names }),
  });
}

export async function logPromoSwipe(body: {
  instrumentId: number;
  machineId: string;
  productName?: string;
  vendonUserId?: string;
}): Promise<{
  deltaCups?: number;
  productCupsNow?: number;
  productCupsYesterdaySameTime?: number;
}> {
  return authedJson('/api/target-site/promo/swipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchPromoSwipeEvents(vendonUserId?: string): Promise<PromoSwipeEvent[]> {
  const params = vendonUserId ? `?vendon_user_id=${encodeURIComponent(vendonUserId)}` : '';
  const j = await authedJson<{ ok: boolean; events: PromoSwipeEvent[] }>(
    `/api/target-site/promo/swipe-events${params}`,
  );
  return j.events ?? [];
}
