import { useEffect, useState } from 'react';
import {
  ALERT_UI_THEME_LABELS,
  persistAlertUiTheme,
  readAlertUiTheme,
  subscribeAlertUiTheme,
  type AlertUiThemeId,
} from '@/lib/uiTheme';

/** Switch Classic ↔ Pro professional workspace (persisted). */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useState<AlertUiThemeId>(() => readAlertUiTheme());

  useEffect(() => subscribeAlertUiTheme(() => setTheme(readAlertUiTheme())), []);

  const select = (next: AlertUiThemeId) => {
    setTheme(next);
    persistAlertUiTheme(next);
  };

  return (
    <div
      className={`themeToggle${compact ? ' themeToggle--compact' : ''}`}
      role="group"
      aria-label="Interface look"
    >
      {(['classic', 'pro'] as const).map((id) => (
        <button
          key={id}
          type="button"
          className={`themeToggleBtn${theme === id ? ' themeToggleBtn--active' : ''}`}
          aria-pressed={theme === id}
          onClick={() => select(id)}
          title={
            id === 'pro'
              ? 'Pro — dedicated iPad card workspace (not Classic tables)'
              : 'Classic — tactical Stitch look'
          }
        >
          {compact ? (id === 'pro' ? 'Pro' : 'Classic') : ALERT_UI_THEME_LABELS[id]}
        </button>
      ))}
    </div>
  );
}
