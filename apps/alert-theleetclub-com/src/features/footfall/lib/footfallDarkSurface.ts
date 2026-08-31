/** v2 is always dark. Only explicit Light mode uses the white chart palette. */
export function footfallSurfaceIsDark(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.querySelector('.v2AppRoot')) return true;
  return document.documentElement.getAttribute('data-mode') !== 'light';
}
