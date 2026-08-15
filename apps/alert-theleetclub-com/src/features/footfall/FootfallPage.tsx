import { useCallback, useEffect, useState } from 'react';
import {
  applyComparePreset,
  createDefaultCompareSelection,
  type CompareSelection,
} from '@/components/ComparePresetPicker';
import { FootfallCompareBar } from '@/features/footfall/components/FootfallCompareBar';
import { TargetsPage } from '@/features/footfall/TargetsPage';
import {
  FootfallViewModeProvider,
  type FootfallViewMode,
} from '@/features/footfall/FootfallViewMode';
import { useFootfallDarkSurface } from '@/features/footfall/NightChartContext';
import {
  persistCompareSelection,
  readStoredCompareSelection,
} from '@/lib/comparePresetBridge';
import { prefetchDefaultCache } from '@/features/footfall/lib/api';
import '@/features/footfall/footfall-targets.css';
import '@/features/footfall/footfall-alert.css';

/** Prefer WTD for live sales — footfall baselines stay on fixed cached weeks. */
function initialFootfallCompare(): CompareSelection {
  const stored = readStoredCompareSelection();
  if (stored?.preset === 'wtd_vs_last_week' || stored?.preset === 'mtd_vs_mtd') {
    return stored;
  }
  if (stored?.preset === 'custom_vs_custom') return stored;
  return applyComparePreset('wtd_vs_last_week', createDefaultCompareSelection());
}

/**
 * Alert Footfall — same Targets layout as target.theleetclub.com (segment facets +
 * left machine list). Fixed cached weeks for footfall; Alert presets for live sales.
 */
export function FootfallPage() {
  const [mode, setMode] = useState<FootfallViewMode>('raw');
  const [compare, setCompareState] = useState<CompareSelection>(() => initialFootfallCompare());
  const darkMode = useFootfallDarkSurface();

  useEffect(() => {
    prefetchDefaultCache();
  }, []);

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
