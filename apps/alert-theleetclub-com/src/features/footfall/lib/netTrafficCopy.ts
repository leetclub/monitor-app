/** Single source for net-traffic labels (camera in − out only). */

export const NET_TRAFFIC_LABEL = 'Net (in − out)';

export const NET_TRAFFIC_SECTION_TITLE = 'Net traffic (in − out)';

export const NET_TRAFFIC_KPI_HINT = 'entries − exits · week';

/** Shown above the chart. */
export const NET_TRAFFIC_LEAD =
  'Filling up vs emptying, by hour. Purple line = net (in − out).';

/** Action-oriented bullets (decisions you can make). */
export const NET_TRAFFIC_USE_FOR = [
  'Spot hours where people enter but also leave fast (low net) vs hours where the site keeps people (high net) — different promo or staffing.',
  'Compare to cups: high footfall + high net + weak sales → crowd near the site but not converting (placement, price, stock).',
  'Compare weeks or locations with similar footfall but different net — one may be a through-corridor, another a destination.',
] as const;

export const NET_TRAFFIC_WHY = [
  '“In” counts every line-crossing; the same person can be counted more than once. Net is in minus out — directional flow, not headcount.',
  'Positive net for the period: more entries than exits (building occupancy). Negative net: net outflow.',
  'Purple line on the chart: net by hour. Green/red stacks: ins and outs per hour.',
] as const;

export const NET_TRAFFIC_NOT =
  'Not unique visitors, not the same number as footfall detections, and not used for conversion % (that uses footfall vs cups).';

export function formatNetPeriodLine(inVal: number, outVal: number, netVal: number): string {
  return `In ${inVal.toLocaleString()} · out ${outVal.toLocaleString()} · net ${netVal.toLocaleString()}`;
}
