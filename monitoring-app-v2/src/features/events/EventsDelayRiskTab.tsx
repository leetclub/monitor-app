import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccess } from '@/context/AccessContext';
import { DateInput } from '@/components/DateInput';
import shell from '@/features/_shared/featureShell.module.css';
import { kuwaitDateISO } from '@/lib/kuwaitDate';
import {
  defaultVendonEventsFilters,
  fetchEventNameOptions,
  fetchVendonEventsForQuery,
  fetchVendonMachines,
  sendStrike,
  vendonEventsQueryKey,
  yesterdayIso,
  type EventNameOption,
  type VendonEventsAppliedFilters,
  type VendonEventRow,
} from './eventsApi';
import { formatDuration, formatDurationDetailed } from './duration';
import styles from './EventsDelayRiskTab.module.css';

/** Dark-theme row / card tones (matches dashboard variables). */
function eventTypeToneClass(displayName: string): string {
  const map: Record<string, string> = {
    REFILL: styles.toneRefill,
    'Machine OFF': styles.toneMachineOff,
    'KNet OFF': styles.toneKnetOff,
    'Vendon OFF': styles.toneVendonOff,
    'Dispense Failed': styles.toneDispense,
    'All Products refilled': styles.toneAllProducts,
  };
  return map[displayName.trim()] || styles.toneDefault;
}

function tsLabel(sec: number | undefined): string {
  if (sec == null || sec <= 0) return '';
  const d = new Date(sec * 1000);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

type Insights = {
  topMachine: string;
  topCount: number;
  totalDowntimeSec: number;
  avgTtrSec: number;
} | null;

function computeInsights(events: VendonEventRow[]): Insights {
  const offEvents = events.filter((e) => (e.display_name || '').toLowerCase().includes('off'));
  if (offEvents.length === 0) return null;
  const counts: Record<string, number> = {};
  const downtime: Record<string, number> = {};
  const ttr: number[] = [];
  for (const e of offEvents) {
    const machine = e.machine_name || 'Unknown';
    counts[machine] = (counts[machine] || 0) + 1;
    let dur = typeof e.duration === 'number' ? e.duration : 0;
    if (!dur && e.received_at && e.resolved_at) {
      dur = e.resolved_at - e.received_at;
    }
    if (dur > 0) {
      downtime[machine] = (downtime[machine] || 0) + dur;
      ttr.push(dur);
    }
  }
  let topMachine = '';
  let topCount = 0;
  for (const [m, c] of Object.entries(counts)) {
    if (c > topCount) {
      topCount = c;
      topMachine = m;
    }
  }
  const totalDowntimeSec = Object.values(downtime).reduce((a, b) => a + b, 0);
  const avgTtrSec =
    ttr.length > 0 ? Math.round(ttr.reduce((a, b) => a + b, 0) / ttr.length) : 0;
  return { topMachine, topCount, totalDowntimeSec, avgTtrSec };
}

function StrikeButtons({
  ev,
}: {
  ev: VendonEventRow;
}) {
  const [state, setState] = useState<Record<number, 'idle' | 'loading' | 'ok' | 'fail'>>({});

  const fire = async (n: 1 | 2 | 3) => {
    setState((s) => ({ ...s, [n]: 'loading' }));
    const ts = new Date().toLocaleString();
    try {
      const r = await sendStrike({
        strikeNumber: n,
        machineName: String(ev.machine_name || 'Unknown'),
        machineId: ev.machine_id != null ? String(ev.machine_id) : undefined,
        eventType: String(ev.display_name || ''),
        timestamp: ts,
      });
      setState((s) => ({ ...s, [n]: r.success ? 'ok' : 'fail' }));
    } catch {
      setState((s) => ({ ...s, [n]: 'fail' }));
    }
  };

  const label = (n: 1 | 2 | 3) => {
    const st = state[n];
    if (st === 'loading') return '…';
    if (st === 'ok') return `Strike ${n} ✓`;
    if (st === 'fail') return `Strike ${n} ✗`;
    return `Strike ${n}`;
  };

  return (
    <div className={styles.strikeRow}>
      {([1, 2, 3] as const).map((n) => (
        <button
          key={n}
          type="button"
          className={`${styles.strikeBtn} ${state[n] === 'ok' ? styles.sent : ''}`}
          disabled={state[n] === 'loading' || state[n] === 'ok'}
          onClick={() => void fire(n)}
        >
          {label(n)}
        </button>
      ))}
    </div>
  );
}

export default function EventsDelayRiskTab() {
  const { canSeeTab } = useAccess();
  const defaults = useMemo(() => defaultVendonEventsFilters(), []);
  const [machineId, setMachineId] = useState('');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [eventName, setEventName] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<VendonEventsAppliedFilters | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const userClearedRef = useRef(false);

  /** Classic app: auto-load Delay Risk ~500ms after init with yesterday (index.html). */
  useEffect(() => {
    if (!canSeeTab('events')) return;
    const id = window.setTimeout(() => {
      setAppliedFilters((prev) => {
        if (prev != null) return prev;
        if (userClearedRef.current) return prev;
        return defaultVendonEventsFilters();
      });
    }, 500);
    return () => window.clearTimeout(id);
  }, [canSeeTab]);

  /**
   * UX: in classic, operators expect date changes to affect results immediately.
   * Keep parity with the "Apply" button, but also auto-apply when dates change after an initial load.
   */
  useEffect(() => {
    if (!canSeeTab('events')) return;
    if (!appliedFilters) return; // nothing loaded yet
    if (!startDate || !endDate) return;
    const same =
      appliedFilters.startDate === startDate &&
      appliedFilters.endDate === endDate &&
      appliedFilters.machineId === machineId &&
      appliedFilters.eventName === eventName;
    if (same) return;
    const id = window.setTimeout(() => {
      setAppliedFilters({ startDate, endDate, machineId, eventName });
      setPage(1);
    }, 350);
    return () => window.clearTimeout(id);
  }, [canSeeTab, appliedFilters, startDate, endDate, machineId, eventName]);

  const eventsQ = useQuery({
    queryKey: appliedFilters ? vendonEventsQueryKey(appliedFilters) : ['vendon', 'events', 'idle'],
    queryFn: async () => {
      const res = await fetchVendonEventsForQuery(appliedFilters!);
      if (res.error) throw new Error(res.error);
      return res;
    },
    enabled: appliedFilters != null,
  });

  const allEvents = eventsQ.data?.events ?? [];
  const totalCount = eventsQ.data?.totalCount ?? 0;
  const loading = eventsQ.isFetching;
  const loadErrorMsg =
    eventsQ.error instanceof Error ? eventsQ.error.message : formError;

  const machinesQ = useQuery({
    queryKey: ['vendon', 'machines'],
    queryFn: fetchVendonMachines,
  });

  const optionsQ = useQuery({
    queryKey: ['vendon', 'event-name-options'],
    queryFn: fetchEventNameOptions,
  });

  const apply = useCallback(() => {
    if (!startDate || !endDate) {
      setFormError('Choose start and end dates.');
      return;
    }
    setFormError(null);
    userClearedRef.current = false;
    setAppliedFilters({
      startDate,
      endDate,
      machineId,
      eventName,
    });
    setPage(1);
  }, [startDate, endDate, machineId, eventName]);

  const insights = useMemo(() => computeInsights(allEvents), [allEvents]);

  const typeSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of allEvents) {
      const t = e.display_name || 'Unknown';
      counts[t] = (counts[t] || 0) + 1;
    }
    const entries = Object.entries(counts)
      .map(([type, count]) => ({
        type,
        count,
        pct: totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0',
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return entries;
  }, [allEvents, totalCount]);

  const maxPage = Math.max(1, Math.ceil(allEvents.length / perPage));
  const safePage = Math.min(page, maxPage);
  const sliceStart = (safePage - 1) * perPage;
  const pageRows = allEvents.slice(sliceStart, sliceStart + perPage);

  const clearFilters = () => {
    userClearedRef.current = true;
    setMachineId('');
    const y = yesterdayIso();
    setStartDate(y);
    setEndDate(y);
    setEventName('');
    setAppliedFilters(null);
    setFormError(null);
    setPage(1);
  };

  const setQuickRange = (range: 'today' | 'yesterday' | 'lastWeek' | 'lastMonth') => {
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);
    if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (range === 'lastWeek') {
      start.setDate(start.getDate() - 7);
    } else if (range === 'lastMonth') {
      start.setDate(start.getDate() - 30);
    }
    setStartDate(kuwaitDateISO(start));
    setEndDate(kuwaitDateISO(end));
  };

  const tableEmptyMessage = (() => {
    if (loading && appliedFilters) return 'Loading…';
    if (!appliedFilters) {
      return userClearedRef.current
        ? 'Filters cleared — click Apply to load events.'
        : 'Loading events (default: yesterday, all machines)…';
    }
    return 'No events in this filter.';
  })();

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        <strong>Delays</strong> highlights machines with frequent turn-offs (Vendon), downtime totals, and
        resolution times. Data comes from the Vendon <code>/event</code> feed via the API (same filters as
        the classic tab). Up to <strong>5,000</strong> raw events per request.
      </p>

      <div className={`${styles.insights} ${insights ? styles.visible : ''}`}>
        <h2>Delay Risk Insights</h2>
        <div className={styles.insightGrid}>
          <div className={`${styles.insightCard} ${styles.cardRed}`}>
            <div className={styles.insightLabel}>Machine with most turn-offs (OFF events)</div>
            <div className={styles.insightValue}>{insights?.topMachine || '—'}</div>
            <div className={styles.insightSub}>
              {insights && insights.topCount > 0
                ? `${insights.topCount} turn-offs in range`
                : 'No OFF events in range'}
            </div>
          </div>
          <div className={`${styles.insightCard} ${styles.cardBlue}`}>
            <div className={styles.insightLabel}>Total downtime (OFF events, summed)</div>
            <div className={styles.insightValue}>
              {insights && insights.totalDowntimeSec > 0
                ? formatDuration(insights.totalDowntimeSec)
                : '—'}
            </div>
            <div className={styles.insightSub}>All machines in filter</div>
          </div>
          <div className={`${styles.insightCard} ${styles.cardGreen}`}>
            <div className={styles.insightLabel}>Average resolution time</div>
            <div className={styles.insightValue}>
              {insights && insights.avgTtrSec > 0 ? formatDuration(insights.avgTtrSec) : '—'}
            </div>
            <div className={styles.insightSub}>From event durations</div>
          </div>
        </div>
      </div>

      <div className={shell.filters}>
        <div className={shell.field}>
          <label htmlFor="ev-machine">Machine</label>
          <select
            id="ev-machine"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            disabled={machinesQ.isLoading}
          >
            <option value="">All Machines</option>
            {(machinesQ.data ?? []).map((m) => (
              <option key={String(m.id)} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className={shell.field}>
          <label htmlFor="ev-start">Start date</label>
          <DateInput
            id="ev-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className={shell.field}>
          <label htmlFor="ev-end">End date</label>
          <DateInput id="ev-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className={shell.field}>
          <label htmlFor="ev-type">Event type</label>
          <select
            id="ev-type"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            disabled={optionsQ.isLoading}
          >
            <option value="">All Events</option>
            {(optionsQ.data ?? []).map((o: EventNameOption) => (
              <option key={o.id} value={o.id}>
                {o.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className={shell.field}>
          <span className={shell.quickLabel}>Quick ranges</span>
          <div className={shell.quickBtns}>
            <button type="button" onClick={() => setQuickRange('today')}>
              Today
            </button>
            <button type="button" onClick={() => setQuickRange('yesterday')}>
              Yesterday
            </button>
            <button type="button" onClick={() => setQuickRange('lastWeek')}>
              Last week
            </button>
            <button type="button" onClick={() => setQuickRange('lastMonth')}>
              Last month
            </button>
          </div>
        </div>
        <div className={shell.actions}>
          <button type="button" className={shell.btnPrimary} disabled={loading} onClick={() => void apply()}>
            {loading ? 'Loading…' : 'Apply filters'}
          </button>
          <button
            type="button"
            className={shell.btn}
            disabled={loading || !appliedFilters}
            onClick={() => void eventsQ.refetch()}
          >
            Refresh
          </button>
          <button type="button" className={shell.btn} onClick={clearFilters}>
            Clear
          </button>
        </div>
      </div>

      {loadErrorMsg && <div className={shell.err}>{loadErrorMsg}</div>}

      <div className={`${styles.summary} ${typeSummary.length > 0 ? styles.visible : ''}`}>
        <h2>Most common event types</h2>
        <div className={styles.typeGrid}>
          {typeSummary.map((item) => (
            <div
              key={item.type}
              className={`${styles.typeCard} ${eventTypeToneClass(item.type)}`}
            >
              <div className={styles.typeTitle}>{item.type}</div>
              <div className={styles.typeCount}>{item.count}</div>
              <div className={styles.typePct}>{item.pct}% of loaded rows</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.toolbar}>
        <span>Total: {totalCount} events</span>
        <label>
          Per page{' '}
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.pag}>
          <button
            type="button"
            className={styles.btn}
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span>
            Page {safePage} / {maxPage}
          </span>
          <button
            type="button"
            className={styles.btn}
            disabled={safePage >= maxPage}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Machine</th>
              <th>Received</th>
              <th>Resolved</th>
              <th>Duration</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {allEvents.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.tableEmpty}>
                  {tableEmptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((e, idx) => {
                const disp = e.display_name || 'Unknown';
                const tone = eventTypeToneClass(disp);
                let dur = e.duration;
                if ((dur == null || dur <= 0) && e.received_at && e.resolved_at) {
                  dur = e.resolved_at - e.received_at;
                }
                return (
                  <tr key={`${e.id ?? idx}-${e.received_at ?? idx}`} className={tone}>
                    <td>
                      <strong>{disp}</strong>
                      <br />
                      <small className={styles.rowDesc}>{e.description || ''}</small>
                    </td>
                    <td>{e.machine_name || '—'}</td>
                    <td>{tsLabel(e.received_at)}</td>
                    <td>{tsLabel(e.resolved_at)}</td>
                    <td>{dur && dur > 0 ? formatDurationDetailed(dur) : '—'}</td>
                    <td>
                      <StrikeButtons ev={e} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className={styles.note}>
        Strike buttons post to Slack when <code>SLACK_WEBHOOK_URL</code> is set on the API deployment.
        Operator DMs match the classic app once we port <code>notifications.js</code> logic.
      </p>
    </div>
  );
}
