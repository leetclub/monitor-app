import { useState } from 'react';
import type { CompareSelection } from '@/components/ComparePresetPicker';
import { ProCompareChips } from '@/features/pro/ProCompareChips';
import { SalesHistoryModal } from '@/components/SalesHistoryModal';
import {
  formatKwd,
  formatSalesTrendPct,
  type DailySalesElapsedResponse,
  type SalesElapsedRow,
} from '@/lib/salesDisplay';
import type { StitchKpi } from '@/components/StitchKpiStrip';
import './pro.css';

export type ProOverallCard = {
  id: string;
  name: string;
  operator: string;
  salesPrimary: number | null;
  salesBaseline: number | null;
  salesTrendPct: number | null;
  salesCaption: string;
  lastTx: string;
  lastClean: string;
  flagged: boolean;
  salesRow: SalesElapsedRow | null;
};

export function ProOverallView({
  cards,
  kpis,
  compare,
  onCompareChange,
  salesNote,
  asOfLocal,
  salesMeta,
  loading,
  error,
  info,
  fetching,
  fleetPrimaryKwd,
  fleetBaselineKwd,
  fleetTrendPct,
  onRefresh,
}: {
  cards: ProOverallCard[];
  kpis: StitchKpi[];
  compare: CompareSelection;
  onCompareChange: (next: CompareSelection) => void;
  salesNote: string;
  asOfLocal?: string | null;
  salesMeta?: DailySalesElapsedResponse;
  loading: boolean;
  error: string | null;
  info: string | null;
  fetching: boolean;
  fleetPrimaryKwd?: number | null;
  fleetBaselineKwd?: number | null;
  fleetTrendPct?: number | null;
  onRefresh: () => void;
}) {
  const [salesDetail, setSalesDetail] = useState<ProOverallCard | null>(null);

  return (
    <div className="proWorkspace">
      <div className="proPage">
        <header className="proPageHead">
          <div className="proPageTitleBlock">
            <p className="proPageEyebrow">Fleet · iPad workspace</p>
            <h1 className="proPageTitle">Overall</h1>
            <p className="proPageMeta">{cards.length} machines · essential metrics</p>
          </div>
          <div className="proPageActions">
            <span className="proLivePill">
              <span className="proLiveDot" aria-hidden />
              Auto · ~1m
            </span>
            <button type="button" className="proBtn proBtnPrimary" onClick={onRefresh} disabled={fetching}>
              {fetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        <div className="proKpiRow" role="group" aria-label="Key metrics">
          {kpis.map((k) => (
            <div key={k.label} className="proKpi">
              <span className="proKpiLabel">{k.label}</span>
              <span
                className={`proKpiValue${k.tone === 'warn' ? ' proKpiValueWarn' : ''}${k.tone === 'good' ? ' proKpiValueGood' : ''}`}
              >
                {k.value}
              </span>
              {k.sub ? <span className="proKpiSub">{k.sub}</span> : null}
            </div>
          ))}
        </div>

        <div className="proToolbar">
          <ProCompareChips value={compare} onChange={onCompareChange} />
          <p className="proToolbarNote">
            <strong>Sales</strong> — {salesNote}
            {asOfLocal ? ` · ${asOfLocal.replace('T', ' ')} KWT` : ''}
          </p>
        </div>

        {loading ? (
          <p className="proBanner proBannerInfo" role="status">
            Loading fleet…
          </p>
        ) : null}
        {error ? (
          <p className="proBanner proBannerDanger" role="alert">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="proBanner proBannerInfo" role="status">
            {info}
          </p>
        ) : null}

        {!loading && cards.length === 0 ? (
          <div className="proEmpty">
            <p className="proEmptyTitle">No machines</p>
            <p>Check Vendon machine list or Red Flags snapshot.</p>
          </div>
        ) : null}

        {cards.length > 0 ? (
          <ul className="proCardList" aria-label="Fleet machines">
            {cards.map((c) => {
              const tone =
                c.salesTrendPct != null && Number.isFinite(c.salesTrendPct)
                  ? c.salesTrendPct >= 0
                    ? 'up'
                    : 'down'
                  : null;
              return (
                <li key={c.id}>
                  <article className={`proCard${c.flagged ? ' proCardWarn' : ''}`}>
                    <div className="proCardMain" style={{ cursor: 'default' }}>
                      <div className="proCardTop">
                        <div>
                          <h2 className="proCardName">{c.name}</h2>
                          <p className="proCardId">#{c.id}</p>
                        </div>
                        <div className="proChips">
                          {c.flagged ? <span className="proChip proChipUpd">In Red Flags</span> : null}
                          <span className="proChip proChipTag">{c.operator || 'No operator'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="proMetricGrid">
                      <div className="proMetric">
                        <span className="proMetricLabel">Sales</span>
                        <span
                          className={`proMetricValue${tone === 'up' ? ' proMetricValueUp' : ''}${tone === 'down' ? ' proMetricValueDown' : ''}`}
                        >
                          {c.salesPrimary != null ? formatKwd(c.salesPrimary) : '—'}
                        </span>
                        <span className="proMetricHint">
                          {c.salesTrendPct != null ? formatSalesTrendPct(c.salesTrendPct) : c.salesCaption}
                        </span>
                      </div>
                      <div className="proMetric">
                        <span className="proMetricLabel">Compare</span>
                        <span className="proMetricValue">
                          {c.salesBaseline != null ? formatKwd(c.salesBaseline) : '—'}
                        </span>
                        <span className="proMetricHint">{c.salesCaption}</span>
                      </div>
                      <div className="proMetric">
                        <span className="proMetricLabel">Last TX</span>
                        <span className="proMetricValue">{c.lastTx}</span>
                      </div>
                      <div className="proMetric">
                        <span className="proMetricLabel">Last clean</span>
                        <span className="proMetricValue">{c.lastClean}</span>
                      </div>
                    </div>
                    <div className="proCardFoot">
                      <button
                        type="button"
                        className="proBtn proBtnPrimary"
                        disabled={!c.salesRow}
                        onClick={() => setSalesDetail(c)}
                      >
                        Sales history
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : null}

        {cards.length > 0 ? (
          <div className="proFleetBar" aria-label="Fleet sales">
            <div>
              <div className="proFleetBarLabel">Fleet sales</div>
              <div className="proFleetBarVal">
                {fleetPrimaryKwd != null && Number.isFinite(fleetPrimaryKwd) ? formatKwd(fleetPrimaryKwd) : '—'}
              </div>
            </div>
            <div>
              <div className="proFleetBarLabel">Compare</div>
              <div className="proFleetBarVal">
                {fleetBaselineKwd != null && Number.isFinite(fleetBaselineKwd) ? formatKwd(fleetBaselineKwd) : '—'}
              </div>
            </div>
            <div>
              <div className="proFleetBarLabel">Trend</div>
              <div className="proFleetBarVal">
                {fleetTrendPct != null && Number.isFinite(fleetTrendPct) ? formatSalesTrendPct(fleetTrendPct) : '—'}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {salesDetail?.salesRow ? (
        <SalesHistoryModal
          machineName={salesDetail.name}
          machineId={salesDetail.id}
          row={salesDetail.salesRow}
          meta={salesMeta}
          onClose={() => setSalesDetail(null)}
        />
      ) : null}
    </div>
  );
}
