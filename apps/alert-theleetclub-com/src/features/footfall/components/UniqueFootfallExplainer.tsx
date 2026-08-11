import { useState } from 'react';
import {
  CALIBRATION_RATIONALE,
  SEGMENT_CALIBRATION,
  type UniqueFootfallBreakdown,
} from '@/features/footfall/lib/uniqueFootfall';
import type { OwnerSegment } from '@/features/footfall/lib/types';

type Props = {
  /** Active segment, highlighted in the factor table. */
  highlight?: OwnerSegment;
  /** Optional in-context breakdown for the currently selected location. */
  selectedBreakdown?: UniqueFootfallBreakdown;
};

export function UniqueFootfallExplainer({ highlight, selectedBreakdown }: Props) {
  const [open, setOpen] = useState(false);
  const segments: OwnerSegment[] = ['KU', 'MOH', 'O2'];

  return (
    <div className={`explainer ${open ? 'explainerOpen' : ''}`}>
      <button
        type="button"
        className="explainerToggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="explainerToggleIcon" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        How <strong>footfall</strong> works
      </button>
      {open ? (
        <div className="explainerBody">
          <p>
            Every location shows one of two user-facing footfall types — never a generic
            &quot;Footfall&quot; or &quot;estimated&quot; label.
          </p>
          <h4 className="explainerSubhead">Mirrored footfall</h4>
          <p>
            Sites <strong>without a camera</strong>. Period total = cashless cups ÷ segment
            benchmark (MOH/KU 20%, O2 6.2%). Hourly shape comes from a same-segment peer; zero
            cups means zero footfall for that hour.
          </p>
          <h4 className="explainerSubhead">Unique footfall</h4>
          <p>
            Sites <strong>with a camera</strong>. Raw <code>peopleIn</code> detections are calibrated
            and capped when they exceed the benchmark-implied visitor count (repeat visitors /
            wandering). Raw detections are kept as a small reference next to each location.
          </p>
          <ol className="explainerSteps">
            <li>
              Raw <code>peopleIn</code> over the 5-day window.
            </li>
            <li>
              Multiply by the per-segment calibration factor (below).
            </li>
            <li>
              Floor with net-arrivals: Σ <code>max(0, in − out)</code> per hour.
            </li>
            <li>
              Ceiling at raw <code>peopleIn</code> and segment benchmark when over-counted.
            </li>
            <li>
              <strong>Unique footfall</strong> = clamped estimate. Charts, KPIs and tables use this
              value on camera sites.
            </li>
          </ol>
          <table className="explainerTable">
            <thead>
              <tr>
                <th>Segment</th>
                <th>Calibration</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s} className={highlight === s ? 'explainerRowActive' : ''}>
                  <td>
                    <strong>{s}</strong>
                  </td>
                  <td>
                    <code>×{SEGMENT_CALIBRATION[s].toFixed(2)}</code>
                  </td>
                  <td>{CALIBRATION_RATIONALE[s]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedBreakdown ? (
            <div className="explainerExample">
              <strong>Selected location · unique footfall computation:</strong>
              <ul>
                <li>
                  Raw detections (week):{' '}
                  <code>{Math.round(selectedBreakdown.rawDetections).toLocaleString()}</code>
                </li>
                <li>
                  Factor × raw: <code>×{selectedBreakdown.factor.toFixed(2)}</code> ={' '}
                  <code>{Math.round(selectedBreakdown.factorEstimate).toLocaleString()}</code>
                </li>
                <li>
                  Net-arrivals floor:{' '}
                  <code>
                    {selectedBreakdown.netSignalMissing
                      ? '— no in/out data'
                      : Math.round(selectedBreakdown.netArrivalsFloor).toLocaleString()}
                  </code>
                </li>
                <li>
                  <strong>Unique footfall (week):</strong>{' '}
                  <code>{Math.round(selectedBreakdown.uniqueEstimate).toLocaleString()}</code>{' '}
                  <span className="explainerMuted">
                    (≈ {Math.round(selectedBreakdown.uniqueAvgPerDay).toLocaleString()} / day ·{' '}
                    {selectedBreakdown.dayCount} days)
                  </span>
                </li>
                {selectedBreakdown.floorActive ? (
                  <li className="explainerWarn">Floor active.</li>
                ) : null}
                {selectedBreakdown.ceilingActive ? (
                  <li className="explainerWarn">Ceiling active.</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
