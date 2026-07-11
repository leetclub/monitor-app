import { useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { OpsViewToggle } from '@/components/OpsViewToggle';
import {
  RED_FLAGS_ALERTS_FOCUS_HELP,
  RED_FLAGS_COLUMN_GROUPS,
  RED_FLAGS_PINNED_COLUMN,
  RED_FLAGS_PRESET_ALERTS,
  RED_FLAGS_PRESET_SALES,
  RED_FLAGS_SALES_FOCUS_HELP,
  RED_FLAGS_TOTAL_COLUMNS,
  setGroupColumns,
  storedForPreset,
  toggleCustomColumn,
  type RedFlagsColumnGroupId,
  type RedFlagsColumnPreset,
  type StoredRedFlagsColumns,
} from './redFlagsColumnVisibility';
import {
  RED_FLAGS_COLUMN_UI,
  RED_FLAGS_RIBBON_ORDER,
  type RedFlagsColumnFamily,
} from './redFlagsColumnUiMeta';
import type { RedFlagsColumnSyncState } from '@/lib/useRedFlagsColumnPrefs';
import type { RedFlagsColumnKey } from './redFlagsWorkbookColumns';
import { RED_FLAGS_COLUMNS, RED_FLAGS_XLSX_ORDER } from './redFlagsWorkbookColumns';

const PRESET_CARDS: { id: RedFlagsColumnPreset; label: string; hint: string }[] = [
  { id: 'all', label: 'Everything', hint: 'Full workbook — all 19 columns' },
  { id: 'sales', label: 'Sales focus', hint: 'Machine, people, sales & targets' },
  { id: 'alerts', label: 'Alerts focus', hint: 'Flags, frequency, ops & calls' },
];

const BUNDLE_ORDER: RedFlagsColumnGroupId[] = ['sales', 'people', 'alerts'];

function syncLabel(state: RedFlagsColumnSyncState | undefined): string | null {
  if (state === 'loading') return 'Loading…';
  if (state === 'saving') return 'Saving…';
  if (state === 'error') return 'Offline — saved on device';
  if (state === 'saved') return 'Saved for you';
  return null;
}

function keysForPreset(preset: RedFlagsColumnPreset): RedFlagsColumnKey[] {
  if (preset === 'sales') return RED_FLAGS_PRESET_SALES;
  if (preset === 'alerts') return RED_FLAGS_PRESET_ALERTS;
  return [...RED_FLAGS_XLSX_ORDER];
}

function bundleKeys(gid: RedFlagsColumnGroupId): RedFlagsColumnKey[] {
  return RED_FLAGS_COLUMN_GROUPS[gid].keys.filter((k) => k !== RED_FLAGS_PINNED_COLUMN);
}

function bundleTriState(visibleSet: Set<RedFlagsColumnKey>, gid: RedFlagsColumnGroupId): 'on' | 'off' | 'mix' {
  const keys = bundleKeys(gid);
  if (!keys.length) return 'off';
  const on = keys.filter((k) => visibleSet.has(k)).length;
  if (on === keys.length) return 'on';
  if (on === 0) return 'off';
  return 'mix';
}

const PRESET_TOGGLE: { id: RedFlagsColumnPreset; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sales', label: 'Sales' },
  { id: 'alerts', label: 'Alerts' },
];

export function RedFlagsColumnPicker({
  stored,
  visibleKeys,
  visibleCount,
  syncState,
  onChange,
  compact = false,
}: {
  stored: StoredRedFlagsColumns;
  visibleKeys: RedFlagsColumnKey[];
  visibleCount: number;
  syncState?: RedFlagsColumnSyncState;
  onChange: (next: StoredRedFlagsColumns) => void;
  /** Collapsed one-line bar until user expands — saves space above the table. */
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [pulseFamily, setPulseFamily] = useState<RedFlagsColumnFamily | RedFlagsColumnGroupId | null>(null);
  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const syncNote = syncLabel(syncState);

  const applyPreset = (preset: RedFlagsColumnPreset) => {
    onChange(storedForPreset(preset));
    setPulseFamily(null);
  };

  const baseCustom = (): RedFlagsColumnKey[] =>
    stored.preset === 'custom' ? stored.custom : visibleKeys;

  const toggleColumn = (key: RedFlagsColumnKey) => {
    if (RED_FLAGS_COLUMN_UI[key].pinned) return;
    const on = !visibleSet.has(key);
    onChange({
      preset: 'custom',
      custom: toggleCustomColumn(baseCustom(), key, on),
    });
  };

  const toggleBundle = (gid: RedFlagsColumnGroupId) => {
    const state = bundleTriState(visibleSet, gid);
    const turnOn = state !== 'on';
    onChange({
      preset: 'custom',
      custom: setGroupColumns(baseCustom(), RED_FLAGS_COLUMN_GROUPS[gid].keys, turnOn),
    });
  };

  const flashBundle = (gid: RedFlagsColumnGroupId) => {
    setPulseFamily(gid);
    window.setTimeout(() => setPulseFamily((p) => (p === gid ? null : p)), 1400);
  };

  const presetToggleValue =
    stored.preset === 'sales' || stored.preset === 'alerts' ? stored.preset : 'all';

  if (compact && !expanded) {
    return (
      <div className="rfColPickerBar" aria-label="Table columns">
        <span className="rfColPickerBarLabel">Columns</span>
        <OpsViewToggle
          ariaLabel="Column preset"
          value={presetToggleValue}
          onChange={(id) => applyPreset(id as RedFlagsColumnPreset)}
          options={PRESET_TOGGLE}
        />
        <span className="rfColPickerBarCount">
          {visibleCount}/{RED_FLAGS_TOTAL_COLUMNS}
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
          <span className="opsSectionTitle">Columns · {visibleCount}/{RED_FLAGS_TOTAL_COLUMNS}</span>
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
              {visibleCount} of {RED_FLAGS_TOTAL_COLUMNS} shown · tap pills below
            </span>
          </div>
          {syncNote ? (
            <span className={`opsStatusPill opsStatusPill--${syncState === 'saved' ? 'ok' : syncState === 'saving' ? 'busy' : syncState === 'error' ? 'warn' : ''}`}>
              {syncNote}
            </span>
          ) : null}
        </div>
      )}

      <div className="opsSelectGrid opsSelectGrid--3 rfColPresetCards" role="group" aria-label="Quick layouts">
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
          const g = RED_FLAGS_COLUMN_GROUPS[gid];
          const tri = bundleTriState(visibleSet, gid);
          const help =
            gid === 'sales'
              ? RED_FLAGS_SALES_FOCUS_HELP
              : gid === 'alerts'
                ? RED_FLAGS_ALERTS_FOCUS_HELP
                : g.help;
          return (
            <div
              key={gid}
              className={`rfColBundle${pulseFamily === gid ? ' rfColBundle--pulse' : ''}`}
            >
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
                <InfoTip text={help} label={`${g.label} help`}>
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
          <button type="button" className="rfColHelperBtn rfColHelperBtn--alerts" onClick={() => applyPreset('alerts')}>
            Alerts view
          </button>
        </div>
      </div>

      <div className="rfColRibbonWrap">
        <div className="rfColRibbonScroll">
          <div className="rfColRibbon" role="group" aria-label="Individual columns">
            {RED_FLAGS_RIBBON_ORDER.map((key) => {
              const meta = RED_FLAGS_COLUMN_UI[key];
              const on = visibleSet.has(key);
              const col = RED_FLAGS_COLUMNS[key];
              const tip = col.placeholderNote ?? col.sub ?? meta.label;
              const gid = keyToGroupId(key);
              const pulsing = pulseFamily === gid || pulseFamily === meta.family;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    'rfColPill',
                    `rfColPill--${meta.family}`,
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

function keyToGroupId(key: RedFlagsColumnKey): RedFlagsColumnGroupId | null {
  for (const gid of BUNDLE_ORDER) {
    if (RED_FLAGS_COLUMN_GROUPS[gid].keys.includes(key)) return gid;
  }
  return null;
}

function PresetPreview({ litKeys }: { litKeys: RedFlagsColumnKey[] }) {
  const lit = new Set(litKeys);
  return (
    <span className="rfColPresetPreview" aria-hidden>
      {RED_FLAGS_RIBBON_ORDER.map((key) => {
        const family = RED_FLAGS_COLUMN_UI[key].family;
        return (
          <span
            key={key}
            className={`rfColPresetBar rfColPresetBar--${family}${lit.has(key) ? ' rfColPresetBar--lit' : ''}`}
          />
        );
      })}
    </span>
  );
}
