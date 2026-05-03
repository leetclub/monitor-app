import {
  createDefaultCompareSelection,
  type ComparePresetId,
  type CompareSelection,
} from '@/components/ComparePresetPicker';
import type { RedAlertCompareMode } from '@/features/redflags/redAlertTypes';
import { freqColumnHeading } from '@/features/redflags/redFlagsModel';

const STORAGE_KEY = 'leet-alert-compare-v1';

export function readStoredCompareSelection(): CompareSelection | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as CompareSelection;
    if (o?.preset && o?.a?.start && o?.a?.end && o?.b?.start && o?.b?.end) return o;
  } catch {
    /* ignore */
  }
  return null;
}

export function persistCompareSelection(c: CompareSelection): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function initialCompareSelection(): CompareSelection {
  return readStoredCompareSelection() ?? createDefaultCompareSelection();
}

/** Maps workbook-style presets to Red Alert snapshot trend modes (Kuwait week / day semantics). */
export function comparePresetToRedAlertMode(preset: ComparePresetId): RedAlertCompareMode {
  switch (preset) {
    case 'today_vs_yesterday':
      return 'yesterday';
    case 'today_vs_same_day_last_week':
      return 'sameWeekdayLw';
    case 'wtd_vs_last_week':
      return 'week';
    case 'mtd_vs_mtd':
    case 'custom_vs_custom':
      return 'week';
    default:
      return 'week';
  }
}

/**
 * Column headings for the trend column: uses snapshot-backed modes, with honest subtitles when the
 * cached API does not yet implement MTD or arbitrary custom windows.
 */
export function freqHeadingForComparePreset(
  preset: ComparePresetId,
  mode: RedAlertCompareMode,
): { title: string; sub: string } {
  const base = freqColumnHeading(mode);
  if (preset === 'mtd_vs_mtd') {
    return {
      title: base.title,
      sub: 'Snapshot uses Kuwait week/day metrics until MTD KPIs are wired (see workbook)',
    };
  }
  if (preset === 'custom_vs_custom') {
    return {
      title: base.title,
      sub: 'Custom calendar ranges apply when backend compares periods; snapshot trend unchanged',
    };
  }
  return base;
}
