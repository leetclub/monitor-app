import { useEffect, useState } from 'react';
import {
  ALERT_COLOR_MODE_LABELS,
  persistColorMode,
  resolveColorMode,
  subscribeColorMode,
  type AlertColorMode,
} from '@/lib/colorMode';
import { subscribeAlertUiTheme } from '@/lib/uiTheme';

/** Switch Light ↔ Dark (works for Classic and Pro shells). */
export function ColorModeToggle({ compact }: { compact?: boolean }) {
  const [mode, setMode] = useState<AlertColorMode>(() => resolveColorMode());

  useEffect(() => {
    const sync = () => setMode(resolveColorMode());
    const a = subscribeColorMode(sync);
    const b = subscribeAlertUiTheme(sync);
    return () => {
      a();
      b();
    };
  }, []);

  const select = (next: AlertColorMode) => {
    setMode(next);
    persistColorMode(next);
  };

  return (
    <div
      className={`themeToggle colorModeToggle${compact ? ' themeToggle--compact' : ''}`}
      role="group"
      aria-label="Color mode"
    >
      {(['light', 'dark'] as const).map((id) => (
        <button
          key={id}
          type="button"
          className={`themeToggleBtn${mode === id ? ' themeToggleBtn--active' : ''}`}
          aria-pressed={mode === id}
          onClick={() => select(id)}
          title={id === 'light' ? 'Light mode — bright surfaces' : 'Dark mode — dim surfaces'}
        >
          {compact ? (id === 'light' ? 'Light' : 'Dark') : ALERT_COLOR_MODE_LABELS[id]}
        </button>
      ))}
    </div>
  );
}
