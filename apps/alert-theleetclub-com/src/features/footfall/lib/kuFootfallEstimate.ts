import type { HourRow, LocationReport } from '@/features/footfall/lib/types';
import { inferOwnerSegment } from '@/features/footfall/lib/ownerSegment';
import { displayFootfallTotal } from '@/features/footfall/lib/footfallMetrics';

export type KuFootfallEstimateMeta = {
  peerName: string;
  method: string;
};

const VENUE_KEYWORDS = [
  'hall',
  'library',
  'gate',
  'cafeteria',
  'cafe',
  'center',
  'centre',
  'building',
  'student',
  'faculty',
  'admin',
  'science',
  'engineering',
  'medical',
  'sport',
  'parking',
  'main',
  'west',
  'east',
  'north',
  'south',
  'lobby',
  'food',
  'union',
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmtConversionRatio(footfall: number, cups: number): string {
  if (!(footfall > 0) || !(cups > 0)) return '—';
  return `1 : ${(footfall / cups).toFixed(1)}`;
}

function venueTokens(name: string): Set<string> {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const tokens = new Set<string>();
  for (const w of n.split(/\s+/)) {
    if (w.length >= 3) tokens.add(w);
  }
  for (const kw of VENUE_KEYWORDS) {
    if (n.includes(kw)) tokens.add(kw);
  }
  return tokens;
}

function referenceFootfallPerCup(loc: LocationReport): number | null {
  const ff = loc.daily.projectedFootfall ?? loc.daily.totalFootfall;
  const cups = loc.daily.totalCups;
  if (ff > 0 && cups > 0) return ff / cups;
  return null;
}

function scorePeer(target: LocationReport, ref: LocationReport): number {
  let score = 0;
  const segR = inferOwnerSegment(ref);
  if (segR === 'MOH') score += 0.32;
  else if (segR === 'O2') score += 0.24;
  else if (segR === 'KU') score += 0.12;

  const tokensT = venueTokens(target.locationName);
  const tokensR = venueTokens(ref.locationName);
  for (const t of tokensT) {
    if (tokensR.has(t)) score += 0.14;
  }

  const revT = Math.max(0.01, target.daily.totalRevenueKd || 0);
  const revR = Math.max(0.01, ref.daily.totalRevenueKd || 0);
  const revLog = Math.abs(Math.log(revT) - Math.log(revR));
  score += Math.max(0, 0.42 - revLog * 0.14);

  const cupsT = Math.max(1, target.daily.totalCups);
  const cupsR = Math.max(1, ref.daily.totalCups);
  const logRatio = Math.abs(Math.log(cupsT) - Math.log(cupsR));
  score += Math.max(0, 0.18 - logRatio * 0.08);

  const ratioT = referenceFootfallPerCup(target);
  const ratioR = referenceFootfallPerCup(ref);
  if (ratioT != null && ratioR != null) {
    const r = Math.abs(Math.log(ratioT + 0.01) - Math.log(ratioR + 0.01));
    score += Math.max(0, 0.2 - r * 0.08);
  }

  return score;
}

function salesActivityWeight(h: HourRow): number {
  const cups = Math.max(0, h.cupsCashless ?? h.cups);
  const rev = Math.max(0, h.revenueKd ?? 0);
  if (cups >= 0.5) return cups;
  if (rev >= 0.01) return rev * 0.1;
  return 0;
}

function redistributeFootfallByShape(
  loc: LocationReport,
  totalFootfall: number,
  shapePeer: LocationReport,
  benchmarkPct: number,
  pricePerCup: number,
): HourRow[] {
  const locHours = loc.hours;
  const activityWeights = locHours.map((h) => salesActivityWeight(h));

  const peerHours = shapePeer.hours;
  const activeIdx = locHours
    .map((_, i) => i)
    .filter((i) => activityWeights[i]! > 0);
  const peerShape = activeIdx.map((i) => {
    const p = peerHours[i]?.footfall ?? 0;
    return p > 0 ? p : 1;
  });
  const peerShapeSum = peerShape.reduce((a, b) => a + b, 0) || activeIdx.length;
  const activePos = new Map(activeIdx.map((idx, pos) => [idx, pos]));

  return locHours.map((h, i) => {
    if (activityWeights[i]! <= 0) {
      return {
        ...h,
        footfall: 0,
        footfallProjected: true,
        conversionPct: 0,
        conversionRatio: '—',
        revenuePerVisitorKd: 0,
        aspiredCups: 0,
        upliftCups: 0,
        upliftKd: 0,
        benchmarkConversionPct: benchmarkPct,
        isWeakConversion: false,
      };
    }
    const pos = activePos.get(i) ?? 0;
    const share = peerShape[pos]! / peerShapeSum;
    const newFoot = totalFootfall * share;
    const cashless = h.cupsCashless ?? h.cups;
    const aspired = newFoot * (benchmarkPct / 100);
    const uplift = Math.max(0, aspired - cashless);
    const convPct = newFoot > 0 ? (cashless / newFoot) * 100 : 0;
    return {
      ...h,
      footfall: round1(newFoot),
      footfallProjected: true,
      conversionPct: newFoot > 0 ? Number(convPct.toFixed(2)) : 0,
      conversionRatio: fmtConversionRatio(newFoot, cashless),
      revenuePerVisitorKd:
        newFoot > 0 ? Number((h.revenueKd / newFoot).toFixed(4)) : 0,
      aspiredCups: aspired,
      upliftCups: uplift,
      upliftKd: uplift * pricePerCup,
      benchmarkConversionPct: benchmarkPct,
      isWeakConversion: newFoot > 0 && convPct < benchmarkPct * 0.85,
    };
  });
}

function needsKuEstimate(loc: LocationReport): boolean {
  if (inferOwnerSegment(loc) !== 'KU') return false;
  if (loc.kuFootfallEstimate) return false;
  if (loc.footfallDataKind === 'actual' || loc.footfallDataKind === 'mirrored') return false;
  if (loc.hasPeopleFootfall && loc.footfallDataKind !== 'none') return false;
  if (displayFootfallTotal(loc) > 0 && loc.footfallDataKind === 'projected') return false;
  const cups = loc.daily.totalCups;
  return cups > 0 && (loc.footfallDataKind === 'none' || displayFootfallTotal(loc) <= 0);
}

function buildEstimated(
  loc: LocationReport,
  estimatedTotal: number,
  peerName: string,
  method: string,
  benchmarkPct: number,
  shapePeer: LocationReport,
): LocationReport {
  const cupsWeek = loc.daily.totalCups || 0;
  const cashlessWeek = loc.daily.totalCupsCashless ?? cupsWeek;
  const revenueWeek = loc.daily.totalRevenueKd || 0;
  const pricePerCup = cupsWeek > 0 ? revenueWeek / cupsWeek : 0;
  const dayCount = loc.daily.footfallDayCount ?? loc.periodDates?.length ?? 5;
  const total = Math.max(0, Math.round(estimatedTotal));
  const aspiredWeek = total * (benchmarkPct / 100);
  const missedCups = Math.max(0, aspiredWeek - cashlessWeek);

  const newHours = redistributeFootfallByShape(
    loc,
    total,
    shapePeer,
    benchmarkPct,
    pricePerCup,
  );

  return {
    ...loc,
    hours: newHours,
    daily: {
      ...loc.daily,
      totalFootfall: total,
      projectedFootfall: total,
      avgDailyFootfall: dayCount > 0 ? total / dayCount : total,
      conversionPct:
        total > 0 ? Number(((cashlessWeek / total) * 100).toFixed(2)) : 0,
      conversionRatio: fmtConversionRatio(total, cashlessWeek),
      revenuePerVisitorKd:
        total > 0 ? Number((revenueWeek / total).toFixed(4)) : 0,
      detectionsPerCup:
        cupsWeek > 0 ? Number((total / cupsWeek).toFixed(2)) : null,
      illustrativeMissedPotentialKd: Number(
        (missedCups * pricePerCup).toFixed(2),
      ),
      salesTargetCups: Math.round(aspiredWeek),
      salesUpliftCups: Math.round(missedCups),
    },
    footfallDataKind: 'mirrored',
    projectionPeerName: peerName,
    mirrorSourceName: peerName,
    footfallDisplay: {
      kind: 'mirrored',
      label: `Mirrored footfall from ${peerName}`,
      shortLabel: 'mirror',
      color: '#5eb8e8',
    },
    kuFootfallEstimate: { peerName, method },
    hasPeopleFootfall: false,
  };
}

/**
 * For KU sites without cameras: estimate period footfall from fleet peers
 * (footfall per cup, venue-name similarity, sales volume) and benchmark conversion.
 */
export function applyKuFootfallEstimateIfNeeded(
  loc: LocationReport,
  referenceFleet: LocationReport[],
  benchmarkPct: number,
): LocationReport {
  if (!needsKuEstimate(loc)) return loc;

  const refs = referenceFleet.filter((r) => {
    if (r.machineId === loc.machineId) return false;
    const ff = r.daily.projectedFootfall ?? r.daily.totalFootfall;
    return ff > 0 && r.daily.totalCups > 0;
  });

  const cups = loc.daily.totalCups;
  const fromBenchmark = cups / (benchmarkPct / 100);

  if (refs.length === 0) {
    return buildEstimated(
      loc,
      fromBenchmark,
      `${benchmarkPct}% conversion benchmark`,
      `cups ÷ ${benchmarkPct}% target conversion`,
      benchmarkPct,
      loc,
    );
  }

  let bestPeer = refs[0]!;
  let bestScore = -1;
  for (const r of refs) {
    const s = scorePeer(loc, r);
    if (s > bestScore) {
      bestScore = s;
      bestPeer = r;
    }
  }

  const estimatedTotal = fromBenchmark;

  const method = (
    `Footfall from ${benchmarkPct}% KU benchmark (local cups ÷ target conversion); ` +
    `hourly shape from ${bestPeer.locationName}.`
  );

  return buildEstimated(
    loc,
    estimatedTotal,
    bestPeer.locationName,
    method,
    benchmarkPct,
    bestPeer,
  );
}
