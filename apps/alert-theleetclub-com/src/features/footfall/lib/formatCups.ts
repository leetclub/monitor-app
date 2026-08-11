/** Cups are whole units in the UI — API averages may be fractional. */
export function cupsInt(n: number): number {
  return Math.round(Number(n) || 0);
}

export function formatCups(n: number): string {
  return cupsInt(n).toLocaleString();
}
