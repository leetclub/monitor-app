import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiJson } from '@/lib/api';

type Instrument = {
  id: number;
  name: string;
  vendon_user_id?: string;
  sort_order?: number;
};

type SwipeResult = {
  ok?: boolean;
  deltaCups?: number | null;
  productCupsNow?: number | null;
  productCupsYesterdaySameTime?: number | null;
  swipedAt?: string | null;
  error?: string;
};

type SwipeEvent = {
  id: number;
  instrument_name?: string;
  delta_cups?: number | null;
  swiped_at?: string;
  product_cups_now?: number | null;
  product_cups_yesterday_same_time?: number | null;
};

/**
 * iPhone-style lock swipe: drag or arrow to change promo instrument and log
 * cup delta vs same clock yesterday (Kuwait).
 */
export function PromoSwipeDeck({
  vendonUserId,
  vendonUserName,
  machineId,
  machineName,
  productName,
  onLogged,
}: {
  vendonUserId: string;
  vendonUserName?: string | null;
  machineId: string;
  machineName?: string;
  productName: string;
  onLogged?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [last, setLast] = useState<SwipeResult | null>(null);
  const [dragPx, setDragPx] = useState(0);
  const startX = useRef<number | null>(null);

  const instrumentsQ = useQuery({
    queryKey: ['alert-promo-instruments', vendonUserId],
    queryFn: () =>
      apiGet<{ ok?: boolean; instruments?: Instrument[] }>(
        `/api/alert/promo/instruments?vendonUserId=${encodeURIComponent(vendonUserId)}`,
      ),
    enabled: Boolean(vendonUserId),
    staleTime: 60_000,
  });

  const eventsQ = useQuery({
    queryKey: ['alert-promo-swipe-events', vendonUserId, machineId],
    queryFn: () =>
      apiGet<{ events?: SwipeEvent[] }>(
        `/api/alert/promo/swipe-events?vendonUserId=${encodeURIComponent(vendonUserId)}&machineId=${encodeURIComponent(machineId)}`,
      ),
    enabled: Boolean(vendonUserId && machineId),
    staleTime: 30_000,
  });

  const swipeMut = useMutation({
    mutationFn: (instrumentId: number) =>
      apiJson<SwipeResult>('/api/alert/promo/swipe', {
        instrumentId,
        machineId,
        productName,
        vendonUserId,
      }),
    onSuccess: (data) => {
      setLast(data);
      onLogged?.();
    },
  });

  const instruments = instrumentsQ.data?.instruments ?? [];
  const current = instruments.length ? instruments[index % instruments.length] : null;

  const go = useCallback(
    (dir: -1 | 1, log = true) => {
      if (!instruments.length) return;
      setIndex((i) => {
        const next = (i + dir + instruments.length) % instruments.length;
        const nextInst = instruments[next];
        if (log && nextInst) {
          void swipeMut.mutateAsync(nextInst.id).catch(() => undefined);
        }
        return next;
      });
      setDragPx(0);
    },
    [instruments, swipeMut],
  );

  function onPointerDown(clientX: number) {
    startX.current = clientX;
    setDragPx(0);
  }
  function onPointerMove(clientX: number) {
    if (startX.current == null) return;
    setDragPx(clientX - startX.current);
  }
  function onPointerUp() {
    if (startX.current == null) return;
    const dx = dragPx;
    startX.current = null;
    if (dx <= -48) go(1, true);
    else if (dx >= 48) go(-1, true);
    else setDragPx(0);
  }

  if (instrumentsQ.isLoading) {
    return <p className="perfMuted">Loading promo instruments…</p>;
  }
  if (!instruments.length) {
    return (
      <section className="promoSwipeDeck">
        <h3 className="perfSectionTitle">Promotion instruments</h3>
        <p className="perfMuted">
          No instruments for {vendonUserName || vendonUserId}. Admin → Area owners → set swipe instrument names.
        </p>
      </section>
    );
  }

  const events = eventsQ.data?.events ?? [];

  return (
    <section className="promoSwipeDeck" aria-label="Promotion instruments">
      <h3 className="perfSectionTitle">Promotion instruments</h3>
      <p className="perfSectionHint">
        Swipe the card (or use ‹ ›) to select an instrument for {machineName || machineId}. Each swipe logs cups Δ vs
        same time yesterday ({productName}).
      </p>
      <div
        className="promoSwipeCard"
        style={{ transform: `translateX(${Math.max(-56, Math.min(56, dragPx))}px)` }}
        onTouchStart={(e) => onPointerDown(e.touches[0]?.clientX ?? 0)}
        onTouchMove={(e) => onPointerMove(e.touches[0]?.clientX ?? 0)}
        onTouchEnd={onPointerUp}
        onMouseDown={(e) => onPointerDown(e.clientX)}
        onMouseMove={(e) => {
          if (startX.current != null) onPointerMove(e.clientX);
        }}
        onMouseUp={onPointerUp}
        onMouseLeave={() => {
          if (startX.current != null) onPointerUp();
        }}
      >
        <button type="button" className="promoSwipeBtn" aria-label="Previous promo" onClick={() => go(-1, true)}>
          ‹
        </button>
        <div className="promoSwipeMain">
          <p className="promoSwipeOwner">{vendonUserName || vendonUserId}</p>
          <p className="promoSwipeName">{current?.name}</p>
          <p className="promoSwipeMeta">
            {index + 1} / {instruments.length}
            {swipeMut.isPending ? ' · Logging…' : ''}
          </p>
          <button
            type="button"
            className="promoSwipeLogBtn"
            disabled={swipeMut.isPending || !current}
            onClick={() => current && void swipeMut.mutateAsync(current.id)}
          >
            Log impact now
          </button>
          {last?.deltaCups != null ? (
            <p className={`promoSwipeDelta ${last.deltaCups >= 0 ? 'alertSalesUp' : 'alertSalesDown'}`}>
              Δ vs yesterday (same time): {last.deltaCups >= 0 ? '+' : ''}
              {last.deltaCups} cups
              {last.productCupsNow != null ? ` · now ${last.productCupsNow}` : ''}
              {last.productCupsYesterdaySameTime != null ? ` · yday ${last.productCupsYesterdaySameTime}` : ''}
            </p>
          ) : null}
          {swipeMut.isError ? <p className="perfError">{(swipeMut.error as Error).message}</p> : null}
        </div>
        <button type="button" className="promoSwipeBtn" aria-label="Next promo" onClick={() => go(1, true)}>
          ›
        </button>
      </div>
      {events.length ? (
        <div className="promoSwipeHistory">
          <span className="perfSectionHint">Recent logs</span>
          <ul>
            {events.slice(0, 6).map((ev) => (
              <li key={ev.id}>
                <strong>{ev.instrument_name}</strong>
                {ev.delta_cups != null ? (
                  <span className={ev.delta_cups >= 0 ? 'alertSalesUp' : 'alertSalesDown'}>
                    {' '}
                    {ev.delta_cups >= 0 ? '+' : ''}
                    {ev.delta_cups} cups
                  </span>
                ) : null}
                <span className="promoSwipeWhen"> · {String(ev.swiped_at || '').slice(0, 16)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
