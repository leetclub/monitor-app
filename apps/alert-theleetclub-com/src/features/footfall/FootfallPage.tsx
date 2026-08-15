import { useCallback, useState } from 'react';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import { FootfallCompareBar } from '@/features/footfall/components/FootfallCompareBar';
import { TargetsPage } from '@/features/footfall/TargetsPage';
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
 * Alert Footfall — same Targets layout as target.theleetclub.com (segment facets +
 * left machine list), with Alert date presets and as-measured / mirror toggle.
 */
export function FootfallPage() {
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
      <FootfallViewModeProvider mode={mode}>
        <TargetsPage compare={compare} />
      </FootfallViewModeProvider>
    </div>
  );
}
