import { AlertModalAnticipate } from '@/components/AlertModalAnticipate';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { OperatorContactIcons } from '@/components/OperatorContactIcons';
import { getAlertRuntimeEnv } from '@/config/runtimeEnv';
import { apiGet } from '@/lib/api';
import { formatKwd, formatSalesTrendPct } from '@/lib/salesDisplay';
import { resolveAreaManagerFromMachineName } from '@/data/operatorAreaPlan';
import { formatTargetPct, targetStackValues, type TargetMachineDetail } from '@/lib/targetDisplay';
import { useSlackUserMap } from '@/lib/useSlackUserMap';
import { getAlertModalPortal, modalBackdropHandlers, modalPanelHandlers, useAlertModal } from '@/lib/useAlertModal';

function useTargetMachineDetail(opts: {
  machineId: string;
  machineName: string;
  todayKwd?: number;
  yesterdayKwd?: number;
}) {
  const { machineId, machineName, todayKwd, yesterdayKwd } = opts;
  return useQuery({
    queryKey: ['alert-target-detail', machineId, machineName, todayKwd, yesterdayKwd],
    queryFn: () => {
      const q = new URLSearchParams();
      q.set('machineId', machineId);
      if (machineName) q.set('machineName', machineName);
      if (todayKwd != null && Number.isFinite(todayKwd)) q.set('todayKwd', String(todayKwd));
      if (yesterdayKwd != null && Number.isFinite(yesterdayKwd)) q.set('yesterdayKwd', String(yesterdayKwd));
      return apiGet<TargetMachineDetail>(`/api/alert/targets/machine-detail?${q.toString()}`);
    },
    enabled: Boolean(machineId),
    staleTime: 60_000,
  });
}

export function TargetDetailModal({
  machineName,
  machineId,
  todayKwd,
  yesterdayKwd,
  dailyTargetKd,
  locationOwnerName,
  onClose,
}: {
  machineName: string;
  machineId: string;
  todayKwd?: number;
  yesterdayKwd?: number;
  dailyTargetKd?: number | null;
  /** Row/snapshot owner before machine-detail API returns. */
  locationOwnerName?: string | null;
  onClose: () => void;
}) {
  useAlertModal(onClose);
  const backdrop = modalBackdropHandlers(onClose);
  const panel = modalPanelHandlers();

  const detailQ = useTargetMachineDetail({ machineId, machineName, todayKwd, yesterdayKwd });
  const detail = detailQ.data;
  const fallbackStack = useMemo(
    () => targetStackValues(todayKwd, yesterdayKwd, dailyTargetKd),
    [todayKwd, yesterdayKwd, dailyTargetKd],
  );
  const slackMapQ = useSlackUserMap();
  const slackContact = useMemo(() => {
    const env = getAlertRuntimeEnv();
    return {
      map: slackMapQ.data?.map ?? {},
      team: (slackMapQ.data?.teamId || env.SLACK_TEAM_ID || '').trim(),
    };
  }, [slackMapQ.data]);

  const dailyTarget = detail?.dailyTargetKd ?? dailyTargetKd;
  const today = detail?.todayKwd ?? todayKwd;
  const yesterday = detail?.yesterdayKwd ?? yesterdayKwd;
  const remainingKd =
    dailyTarget != null && today != null && Number.isFinite(dailyTarget) && Number.isFinite(today)
      ? Math.max(0, dailyTarget - today)
      : null;
  const todayPct = detail?.todayPct ?? fallbackStack.todayPct;
  const remainingPct = detail?.remainingPct ?? fallbackStack.remainingPct;
  const yesterdayPct = detail?.yesterdayPct ?? fallbackStack.yesterdayPct;
  const am = resolveAreaManagerFromMachineName(machineName || machineId);
  const amLabel = am === 'suhaib' ? 'Suhaib' : am === 'ahmed' ? 'Ahmed' : null;
  const ownerName =
    detail?.locationOwner?.trim() || locationOwnerName?.trim() || amLabel || null;
  const ownerContact = detail?.ownerContact;
  const hasOwnerContact =
    ownerContact &&
    (ownerContact.email || ownerContact.phone || ownerContact.whatsappUrl || ownerContact.slackDmUrl);

  const wtdTrend = detail?.wtdTrendPct;
  const wtdTrendUp = wtdTrend != null && wtdTrend >= 0;
  const wtdTrendDown = wtdTrend != null && wtdTrend < 0;
  const showFetchError = detailQ.isError || detail?.error;
  const wtdReady = !detailQ.isLoading && detail && !detail.error;

  return createPortal(
    <div
      className="salesHistoryBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="target-detail-title"
      {...backdrop}
    >
      <div className="salesHistoryModal targetDetailModal" {...panel}>
        <div className="salesHistoryHead">
          <div>
            <p className="salesHistoryEyebrow">Daily target · WTD</p>
            <h2 id="target-detail-title" className="salesHistoryTitle">
              {machineName}
            </h2>
            <p className="salesHistorySub">#{machineId}</p>
          </div>
          <button type="button" className="salesHistoryClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {showFetchError ? (
          <p className="salesHistoryNote">
            Could not refresh target detail{detail?.error ? `: ${detail.error}` : ''}. Showing row snapshot below.
          </p>
        ) : null}

        <div className="targetDetailHeroGrid">
          <div className="targetDetailHeroCard">
            <span className="targetDetailHeroLabel">Daily target</span>
            <span className="targetDetailHeroVal">
              {dailyTarget != null ? formatKwd(dailyTarget) : '—'}
            </span>
            {detail?.segment ? (
              <span className="targetDetailHeroSub">{detail.segment} segment</span>
            ) : null}
          </div>
          <div className="targetDetailHeroCard">
            <span className="targetDetailHeroLabel">Today (same clock)</span>
            <span className="targetDetailHeroVal">{today != null ? formatKwd(today) : '—'}</span>
            <span className="targetDetailHeroSub">{formatTargetPct(todayPct)} of daily target</span>
          </div>
          <div className="targetDetailHeroCard">
            <span className="targetDetailHeroLabel">Remaining today</span>
            <span className="targetDetailHeroVal">
              {remainingKd != null ? formatKwd(remainingKd) : '—'}
            </span>
            <span className="targetDetailHeroSub">{formatTargetPct(remainingPct)} left</span>
          </div>
          <div className="targetDetailHeroCard">
            <span className="targetDetailHeroLabel">Yesterday (same time)</span>
            <span className="targetDetailHeroVal">
              {yesterday != null ? formatKwd(yesterday) : '—'}
            </span>
            <span className="targetDetailHeroSub">{formatTargetPct(yesterdayPct)} of daily target</span>
          </div>
        </div>

        {todayPct != null && Number.isFinite(todayPct) ? (
          <div className="targetProgressWrap">
            <div className="targetProgressHead">
              <span className="targetProgressLabel">Today vs daily target</span>
              <span className="targetProgressPct">{formatTargetPct(todayPct)}</span>
            </div>
            <div className="targetProgressTrack">
              <div
                className="targetProgressFill"
                style={{ width: `${Math.min(100, Math.max(0, todayPct))}%` }}
              />
            </div>
          </div>
        ) : null}

        <section>
          <h3 className="historyModalSectionTitle">Week to date</h3>
          {detail?.wtdThroughDate ? (
            <p className="historyModalNoteMuted">
              Through {detail.wtdThroughDate} (Sun–Thu business week)
            </p>
          ) : detailQ.isLoading ? (
            <AlertModalAnticipate hint="Week totals incoming" lines={2} />
          ) : null}
          <div className="targetDetailHeroGrid">
            <div className="targetDetailHeroCard">
              <span className="targetDetailHeroLabel">WTD actual</span>
              <span className="targetDetailHeroVal">
                {detail?.wtdActualKd != null ? formatKwd(detail.wtdActualKd) : wtdReady ? '—' : '…'}
              </span>
              <span className="targetDetailHeroSub">
                vs {detail?.wtdTargetKd != null ? formatKwd(detail.wtdTargetKd) : '—'} week target
              </span>
            </div>
            <div className="targetDetailHeroCard">
              <span className="targetDetailHeroLabel">WTD progress</span>
              <span className="targetDetailHeroVal">
                {detail?.wtdPct != null ? formatTargetPct(detail.wtdPct) : wtdReady ? '—' : '…'}
              </span>
              <span className="targetDetailHeroSub">
                Prior week {formatTargetPct(detail?.priorWtdPct)}
              </span>
            </div>
            <div className="targetDetailHeroCard">
              <span className="targetDetailHeroLabel">Prior week WTD</span>
              <span className="targetDetailHeroVal">
                {detail?.priorWtdActualKd != null ? formatKwd(detail.priorWtdActualKd) : wtdReady ? '—' : '…'}
              </span>
              <span className="targetDetailHeroSub">Same elapsed days last week</span>
            </div>
            <div className="targetDetailHeroCard">
              <span className="targetDetailHeroLabel">WTD trend</span>
              {wtdTrend != null && Number.isFinite(wtdTrend) ? (
                <span
                  className={`targetDetailHeroVal ${wtdTrendUp ? 'alertSalesUp' : wtdTrendDown ? 'alertSalesDown' : ''}`.trim()}
                >
                  {formatSalesTrendPct(wtdTrend)}
                </span>
              ) : (
                <span className="targetDetailHeroVal">{wtdReady ? '—' : '…'}</span>
              )}
              <span className="targetDetailHeroSub">vs prior week WTD %</span>
            </div>
          </div>
        </section>

        {ownerName || hasOwnerContact ? (
          <section className="historyModalContact">
            <h3 className="historyModalSectionTitle">Area owner</h3>
            {ownerName ? <p className="targetDetailOwnerName">{ownerName}</p> : null}
            {!ownerName && detailQ.isLoading ? (
              <AlertModalAnticipate hint="Owner profile incoming" lines={2} />
            ) : null}
            <OperatorContactIcons
              layout="modal"
              iconsOnly
              machineLabel={machineName || machineId}
              slackEmailMap={slackContact.map}
              slackTeamId={slackContact.team}
              channels={
                ownerContact
                  ? {
                      email: ownerContact.email ?? undefined,
                      phone: ownerContact.phone ?? undefined,
                      whatsapp: ownerContact.whatsappUrl ?? undefined,
                      slackUserId: ownerContact.slackUserId ?? undefined,
                      slackDmUrl: ownerContact.slackDmUrl ?? undefined,
                    }
                  : {}
              }
            />
          </section>
        ) : null}
      </div>
    </div>,
    getAlertModalPortal(),
  );
}
