/** Inside Alert Footfall we always show the full Targets + dates UI. */
export type AppSiteMode = 'target' | 'targets';

export function appSiteMode(): AppSiteMode {
  return 'targets';
}

/** Never hide date labels in Alert Footfall. */
export function isTargetOnlySite(): boolean {
  return false;
}
