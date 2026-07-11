import { useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { OpsViewToggle } from '@/components/OpsViewToggle';
import {
  OVERALL_COLUMN_GROUPS,
  OVERALL_PINNED_COLUMN,
  OVERALL_PRESET_ESSENTIAL,
  OVERALL_PRESET_OPS,
  OVERALL_PRESET_SALES,
  OVERALL_TOTAL_COLUMNS,
  setOverallGroupColumns,
  storedForOverallPreset,
  toggleOverallCustomColumn,
  type OverallColumnGroupId,
  type OverallColumnPreset,
  type StoredOverallColumns,
} from './overallColumnVisibility';
import {
  OVERALL_COLUMN_UI,
  OVERALL_RIBBON_ORDER,
  type OverallColumnFamily,
} from './overallColumnUiMeta';
import type { RedFlagsColumnSyncState } from '@/lib/useRedFlagsColumnPrefs';
import type { OverallColumnKey } from './overallWorkbookColumns';
import { OVERALL_COLUMNS, OVERALL_XLSX_ORDER } from './overallWorkbookColumns';

const PRESET_CARDS: { id: OverallColumnPreset; label: string; hint: string }[] = [
  { id: 'all', label: 'Everything', hint: 'Full fleet workbook' },
  { id: 'essential', label: 'Essential', hint: 'Core metrics without wide scroll' },
  { id: 'sales', label: 'Sales focus', hint: 'Sales, MTD, products' },
  { id: 'ops', label: 'Ops focus', hint: 'Cleaning, QA, issues' },
];

const BUNDLE_ORDER: OverallColumnGroupId[] = ['sales', 'people', 'ops'];

const PRESET_TOGGLE: { id: OverallColumnPreset; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'essential', label: 'Ess.' },
  { id: 'sales', label: 'Sales' },
  { id: 'ops', label: 'Ops' },
];

function syncLabel(state: RedFlagsColumnSyncState | undefined): string | null {
  if (state === 'loading') return 'Loading…';
  if (state === 'saving') return 'Saving…';
  if (state === 'error') return 'Offline — saved on device';
  if (state === 'saved') return 'Saved for you';
  return null;
}

function keysForPreset(preset: OverallColumnPreset): OverallColumnKey[] {
  if (preset === 'essential') return OVERALL_PRESET_ESSENTIAL;
  if (preset === 'sales') return OVERALL_PRESET_SALES;
  if (preset === 'ops') return OVERALL_PRESET_OPS;
  return [...OVERALL_XLSX_ORDER];
}

function bundleKeys(gid: OverallColumnGroupId): OverallColumnKey[] {
  return OVERALL_COLUMN_GROUPS[gid].keys.filter((k) => k !== OVERALL_PINNED_COLUMN);
}

function bundleTriState(visibleSet: Set<OverallColumnKey>, gid: OverallColumnGroupId): 'on' | 'off' | 'mix' {
  const keys = bundleKeys(gid);
  if (!keys.length) return 'off';
  const on = keys.filter((k) => visibleSet.has(k)).length;
  if (on === keys.length) return 'on';
  if (on === 0) return 'off';
  return 'mix';
}

export function OverallColumnPicker({
  stored,
  visibleKeys,
  visibleCount,
  syncState,
  onChange,
  compact = false,
}: {
  stored: StoredOverallColumns;
  visibleKeys: OverallColumnKey[];
  visibleCount: number;
  syncState?: RedFlagsColumnSyncState;
  onChange: (next: StoredOverallColumns) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [pulseFamily, setPulseFamily] = useState<OverallColumnFamily | OverallColumnGroupId | null>(null);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const syncNote = syncLabel(syncState);

  const applyPreset = (preset: OverallColumnPreset) => {
    onChange(storedForOverallPreset(preset));
    setPulseFamily(null);
  };

  const baseCustom = (): OverallColumnKey[] =>
    stored.preset === 'custom' ? stored.custom : visibleKeys;

  const toggleColumn = (key: OverallColumnKey) => {
    if (OVERALL_COLUMN_UI[key].pinned) return;
    const on = !visibleSet.has(key);
    onChange({
      preset: 'custom',
      custom: toggleOverallCustomColumn(baseCustom(), key, on),
    });
  };

  const toggleBundle = (gid: OverallColumnGroupId) => {
    const state = bundleTriState(visibleSet, gid);
    const turnOn = state !== 'on';
    onChange({
      preset: 'custom',
      custom: setOverallGroupColumns(baseCustom(), OVERALL_COLUMN_GROUPS[gid].keys, turnOn),
    });
  };

  const flashBundle = (gid: OverallColumnGroupId) => {
    setPulseFamily(gid);
    window.setTimeout(() => setPulseFamily((p) => (p === gid ? null : p)), 1400);
  };

  const presetToggleValue =
    stored.preset === 'essential' || stored.preset === 'sales' || stored.preset === 'ops'
      ? stored.preset
      : 'all';

  if (compact && !expanded) {
    return (
      <div className="rfColPickerBar" aria-label="Table columns">
        <span className="rfColPickerBarLabel">Columns</span>
        <OpsViewToggle
          ariaLabel="Column preset"
          value={presetToggleValue}
          onChange={(id) => applyPreset(id as OverallColumnPreset)}
          options={PRESET_TOGGLE}
        />
        <span className="rfColPickerBarCount">
          {visibleCount}/{OVERALL_TOTAL_COLUMNS}
        </span>
        {syncNote ? <span className="rfColPickerBarSync">{syncNote}</span> : null}
        <button type="button" className="rfColPickerBarExpand" onClick={() => setExpanded(true)}>
          Customize
        </button>
      </div>
    );
  }

  return (
    <div className={`opsInset rfColComposer${compact ? ' rfColComposer--expanded' : ''}`} aria-label="Table columns">
      {compact ? (
        <div className="rfColComposerCollapseRow">
          <span className="opsSectionTitle">
            Columns · {visibleCount}/{OVERALL_TOTAL_COLUMNS}
          </span>
          <button type="button" className="rfColPickerBarExpand" onClick={() => setExpanded(false)}>
            Collapse
          </button>
        </div>
      ) : (
        <div className="opsSectionHead rfColComposerHead">
          <div>
            <span className="opsSectionTitle">Table columns</span>
            <span className="opsSectionTitleStrong">Sculpt your view</span>
            <span className="opsSectionMeta">
              {visibleCount} of {OVERALL_TOTAL_COLUMNS} shown · tap pills below
            </span>
          </div>
          {syncNote ? (
            <span
              className={`opsStatusPill opsStatusPill--${syncState === 'saved' ? 'ok' : syncState === 'saving' ? 'busy' : syncState === 'error' ? 'warn' : ''}`}
            >
              {syncNote}
            </span>
          ) : null}
        </div>
      )}

      <div className="opsSelectGrid opsSelectGrid--4 rfColPresetCards" role="group" aria-label="Quick layouts">
        {PRESET_CARDS.map((card) => {
          const active = stored.preset === card.id;
          const lit = keysForPreset(card.id);
          return (
            <button
              key={card.id}
              type="button"
              className={`opsSelectCard rfColPresetCard${active ? ' opsSelectCard--active' : ''}`}
              aria-pressed={active}
              title={card.hint}
              onClick={() => applyPreset(card.id)}
            >
              <span className="opsSelectCardLabel">{card.label}</span>
              <PresetPreview litKeys={lit} />
              <span className="opsSelectCardHint">{card.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="rfColHelpers" role="group" aria-label="Column bundles">
        {BUNDLE_ORDER.map((gid) => {
          const g = OVERALL_COLUMN_GROUPS[gid];
          const tri = bundleTriState(visibleSet, gid);
          return (
            <div key={gid} className={`rfColBundle${pulseFamily === gid ? ' rfColBundle--pulse' : ''}`}>
              <button
                type="button"
                className={`rfColBundleTrack${tri === 'on' ? ' rfColBundleTrack--on' : tri === 'mix' ? ' rfColBundleTrack--mix' : ''}`}
                aria-pressed={tri === 'on'}
                aria-label={`${g.label} columns ${tri === 'on' ? 'on' : tri === 'mix' ? 'partly on' : 'off'}`}
                onClick={() => toggleBundle(gid)}
              >
                <span className="rfColBundleKnob" />
              </button>
              <div className="rfColBundleMeta">
                <button type="button" className="rfColBundleName" onClick={() => flashBundle(gid)}>
                  {g.label}
                </button>
                <InfoTip text={g.help} label={`${g.label} help`}>
                  <span className="rfColBundleHelp">?</span>
                </InfoTip>
              </div>
            </div>
          );
        })}
        <div className="rfColHelperActions">
          <button type="button" className="rfColHelperBtn rfColHelperBtn--sales" onClick={() => applyPreset('sales')}>
            Sales view
          </button>
          <button type="button" className="rfColHelperBtn rfColHelperBtn--alerts" onClick={() => applyPreset('ops')}>
            Ops view
          </button>
        </div>
      </div>

      <div className="rfColRibbonWrap">
        <div className="rfColRibbonScroll">
          <div className="rfColRibbon" role="group" aria-label="Individual columns">
            {OVERALL_RIBBON_ORDER.map((key) => {
              const meta = OVERALL_COLUMN_UI[key];
              const on = visibleSet.has(key);
              const col = OVERALL_COLUMNS[key];
              const tip = col.note ?? meta.label;
              const gid = keyToGroupId(key);
              const pulsing = pulseFamily === gid || pulseFamily === meta.family;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    'rfColPill',
                    `rfColPill--${meta.family === 'ops' ? 'alerts' : meta.family}`,
                    on ? 'rfColPill--on' : 'rfColPill--off',
                    meta.pinned ? 'rfColPill--pinned' : '',
                    pulsing ? 'rfColPill--pulse' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-pressed={on}
                  disabled={meta.pinned}
                  title={tip}
                  onClick={() => toggleColumn(key)}
                >
                  <span className="rfColPillAbbr">{meta.abbr}</span>
                  <span className="rfColPillFull">{meta.label}</span>
                  {meta.pinned ? <span className="rfColPillLock" aria-hidden>🔒</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function keyToGroupId(key: OverallColumnKey): OverallColumnGroupId | null {
  for (const gid of BUNDLE_ORDER) {
    if (OVERALL_COLUMN_GROUPS[gid].keys.includes(key)) return gid;
  }
  return null;
}

function PresetPreview({ litKeys }: { litKeys: OverallColumnKey[] }) {
  const lit = new Set(litKeys);
  return (
    <span className="rfColPresetPreview" aria-hidden>
      {OVERALL_RIBBON_ORDER.map((key) => {
        const family = OVERALL_COLUMN_UI[key].family;
        const cssFamily = family === 'ops' ? 'alerts' : family;
        return (
          <span
            key={key}
            className={`rfColPresetBar rfColPresetBar--${cssFamily}${lit.has(key) ? ' rfColPresetBar--lit' : ''}`}
          />
        );
      })}
    </span>
  );
}
