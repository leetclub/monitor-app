import type { ReactNode } from 'react';

type Props = {
  onExport: () => void;
  disabled?: boolean;
  label?: string;
  children: ReactNode;
  className?: string;
};

export function ChartExportButton({
  onExport,
  disabled,
  label = 'Download chart as PNG',
}: {
  onExport: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="chartExportBtn"
      onClick={onExport}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <svg className="chartExportIcon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v10m0 0l3.5-3.5M12 13 8.5 9.5M6 17h12"
        />
        <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 20h14" />
      </svg>
      <span className="chartExportBtnText">PNG</span>
    </button>
  );
}

/** Chart panel with top-right export control (Targets Areas parity). */
export function ChartExportWrap({ onExport, disabled, children, className }: Props) {
  return (
    <div className={`chartExportWrap ${className ?? ''}`.trim()}>
      <div className="chartExportToolbar">
        <ChartExportButton onExport={onExport} disabled={disabled} />
      </div>
      {children}
    </div>
  );
}
