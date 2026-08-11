export type V2NavItem = {
  to: string;
  title: string;
  description: string;
  icon: string;
  adminOnly?: boolean;
};

/** Manus fleet-intelligence IA — paths are under /v2. */
export const V2_NAV: V2NavItem[] = [
  { to: '/v2/red-flags', title: 'Red Flags', description: 'Priority exceptions', icon: 'red_flags' },
  { to: '/v2/overall', title: 'Overall', description: 'Fleet overview', icon: 'overall' },
  { to: '/v2/qa-visit', title: 'QA Visit', description: 'Quality workspace', icon: 'qa_visit' },
  {
    to: '/v2/performance',
    title: 'Performance',
    description: 'Trends & targets',
    icon: 'performance',
  },
  {
    to: '/v2/footfall',
    title: 'Footfall',
    description: 'Targets & camera report',
    icon: 'footfall',
  },
  {
    to: '/v2/promo',
    title: 'Promo',
    description: 'Campaign cups',
    icon: 'promo',
  },
  {
    to: '/v2/admin',
    title: 'Admin',
    description: 'Fleet configuration',
    icon: 'admin',
    adminOnly: true,
  },
];

export function v2PageMeta(pathname: string) {
  const hit = V2_NAV.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  return {
    crumb: (hit?.title || 'Red Flags').toUpperCase(),
    headline: hit?.description || 'Priority exceptions',
    title: hit?.title || 'Red Flags',
  };
}
