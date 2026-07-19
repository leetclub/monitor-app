import { apiGet, apiJson } from '@/lib/api';

export const DEFAULT_PROMO_PRODUCT = 'Americano Max';

export type PromoAssignment = {
  id?: number;
  scope_type: 'machine' | 'owner';
  machine_id?: string | null;
  vendon_user_id?: string | null;
  product_name: string;
  updated_by?: string | null;
  updated_at?: string | null;
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
  error?: string;
};

export async function fetchPromoAssignments(): Promise<PromoAssignment[]> {
  const j = await apiGet<{ ok?: boolean; assignments?: PromoAssignment[] }>(
    '/api/alert/promo/assignments',
  );
  return j.assignments ?? [];
}

export async function savePromoAssignment(body: {
  scopeType: 'machine' | 'owner';
  machineId?: string;
  vendonUserId?: string;
  productName: string;
}): Promise<void> {
  await apiJson('/api/alert/promo/assignments', body);
}

export async function savePromoDayTargetsBulk(body: {
  machineIds: string[];
  dates: string[];
  targetCups: number;
}): Promise<void> {
  await apiJson('/api/alert/promo/day-targets/bulk', body);
}

export async function fetchPromoPerformance(
  startDate: string,
  endDate: string,
  machineIds?: string[],
): Promise<PromoPerformancePayload> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  if (machineIds?.length) params.set('machine_ids', machineIds.join(','));
  return apiGet<PromoPerformancePayload>(`/api/alert/promo/performance?${params}`);
}

export async function savePromoInstruments(vendonUserId: string, names: string[]): Promise<void> {
  await apiJson('/api/alert/promo/instruments', { vendonUserId, names });
}
