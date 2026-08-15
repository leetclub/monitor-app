import { useCallback, useState } from 'react';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import { FootfallCompareBar } from '@/features/footfall/components/FootfallCompareBar';
import { TargetsPage } from '@/features/footfall/TargetsPage';
import { AnalyticsPage } from '@/features/footfall/AnalyticsPage';
import {
  FootfallViewModeProvider,
  type FootfallViewMode,
} from '@/features/footfall/FootfallViewMode';
import { useFootfallDarkSurface } from '@/features/footfall/NightChartContext';
import {
  initialCompareSelection,
  persistCompareSelection,
} from '@/lib/comparePresetBridge';
import '@/features/footfall/footfall-targets.css';
import '@/features/footfall/footfall-alert.css';

/**
 * Alert Footfall tab — Targets + Full report with Alert compare presets.
 * Default footfall = raw camera (no mirror / unique-ratio); Adjusted is opt-in.
 */
export function FootfallPage() {
  const [sub, setSub] = useState<'targets' | 'analytics'>('targets');
  const [mode, setMode] = useState<FootfallViewMode>('raw');
  const [compare, setCompareState] = useState<CompareSelection>(() => initialCompareSelection());
  const darkMode = useFootfallDarkSurface();

  const setCompare = useCallback((next: CompareSelection) => {
    setCompareState(next);
    persistCompareSelection(next);
  }, []);

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
            className={mode === 'raw' ? 'ffAlertModeBtn active' : 'ffAlertModeBtn'}
            aria-pressed={mode === 'raw'}
            title="Camera detections as measured — no mirror fill, no unique-ratio adjustment"
            onClick={() => setMode('raw')}
          >
            As measured
          </button>
          <button
            type="button"
            className={mode === 'adjusted' ? 'ffAlertModeBtn active' : 'ffAlertModeBtn'}
            aria-pressed={mode === 'adjusted'}
            title="Enable mirror / projection where needed + unique-visitor ratio on camera sites"
            onClick={() => setMode('adjusted')}
          >
            Mirror & adjust
          </button>
        </div>
      </div>
      <div className="ffAlertCompareRow">
        <FootfallCompareBar value={compare} onChange={setCompare} />
      </div>
      <p className="ffAlertModeHint">
        {mode === 'adjusted'
          ? 'Mirror & adjust on: mirrored / projected footfall + unique-visitor ratio. Sales unchanged.'
          : 'As measured (default): raw camera detections only. Mirrored / no-camera sites show 0 camera footfall. Sales unchanged.'}
      </p>
      <FootfallViewModeProvider mode={mode}>
        {sub === 'targets' ? (
          <TargetsPage compare={compare} />
        ) : (
          <AnalyticsPage compare={compare} />
        )}
      </FootfallViewModeProvider>
    </div>
  );
}
