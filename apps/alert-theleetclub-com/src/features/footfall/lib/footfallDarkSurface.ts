import { documentIsDarkMode } from '@/lib/colorMode';

/** v2 shell is always dark; Classic/Pro follow data-mode. */
export function footfallSurfaceIsDark(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.querySelector('.v2AppRoot')) return true;
  return documentIsDarkMode();
}
