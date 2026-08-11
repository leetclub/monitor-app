import { useState, useSyncExternalStore } from 'react';
import { TargetsPage } from '@/features/footfall/TargetsPage';
import { AnalyticsPage } from '@/features/footfall/AnalyticsPage';
import {
  FootfallViewModeProvider,
  type FootfallViewMode,
} from '@/features/footfall/FootfallViewMode';
import { documentIsDarkMode, subscribeColorMode } from '@/lib/colorMode';
import '@/features/footfall/footfall-targets.css';
import '@/features/footfall/footfall-alert.css';

function useAlertDarkMode(): boolean {
  return useSyncExternalStore(subscribeColorMode, documentIsDarkMode, () => true);
}

/**
 * Alert Footfall tab — full Leet Target experience (weekday Targets + Analytics report)
 * styled for Alert, with Adjusted (mirror + unique ratio) vs Raw camera toggle.
 */
export function FootfallPage() {
  const [sub, setSub] = useState<'targets' | 'analytics'>('targets');
  const [mode, setMode] = useState<FootfallViewMode>('adjusted');
  const darkMode = useAlertDarkMode();

  return (
    <div className={darkMode ? 'alertFootfallRoot alertFootfallDark' : 'alertFootfallRoot'}>
      <div className="ffAlertToolbar" role="toolbar" aria-label="Footfall controls">
        <div className="ffAlertSubTabs" role="tablist" aria-label="Footfall views">
          <button
            type="button"
            role="tab"
            aria-selected={sub === 'targets'}
            className={sub === 'targets' ? 'ffAlertSubTab active' : 'ffAlertSubTab'}
            onClick={() => setSub('targets')}
          >
            Targets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sub === 'analytics'}
            className={sub === 'analytics' ? 'ffAlertSubTab active' : 'ffAlertSubTab'}
            onClick={() => setSub('analytics')}
          >
            Full report
          </button>
        </div>
        <div className="ffAlertMode" role="group" aria-label="Footfall numbers">
          <span className="ffAlertModeLabel">Footfall</span>
          <button
            type="button"
            className={mode === 'adjusted' ? 'ffAlertModeBtn active' : 'ffAlertModeBtn'}
            aria-pressed={mode === 'adjusted'}
            title="Mirrored / projected where needed + unique-visitor ratio on camera sites"
            onClick={() => setMode('adjusted')}
          >
            Adjusted
          </button>
          <button
            type="button"
            className={mode === 'raw' ? 'ffAlertModeBtn active' : 'ffAlertModeBtn'}
            aria-pressed={mode === 'raw'}
            title="Camera detections only — no mirror fill, no unique ratio"
            onClick={() => setMode('raw')}
          >
            Raw camera
          </button>
        </div>
      </div>
      <p className="ffAlertModeHint">
        {mode === 'adjusted'
          ? 'Showing adjusted footfall (mirror / projection + unique ratio). Sales unchanged.'
          : 'Showing raw camera detections only. Mirrored / no-camera sites show 0 camera footfall.'}
      </p>
      <FootfallViewModeProvider mode={mode}>
        {sub === 'targets' ? <TargetsPage /> : <AnalyticsPage />}
      </FootfallViewModeProvider>
    </div>
  );
}
