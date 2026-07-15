import type { ReactNode } from 'react';
import { NavIcon } from '@/components/NavIcon';

export function V2SectionHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="v2SectionHead">
      <div>
        <p className="v2Eyebrow">{eyebrow}</p>
        <h2 className="v2SectionTitle">{title}</h2>
        <p className="v2SectionDesc">{description}</p>
      </div>
      {actions ? <div className="v2SectionActions">{actions}</div> : null}
    </div>
  );
}

export function V2KpiCard({
  label,
  value,
  detail,
  tone = 'teal',
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'teal' | 'red' | 'amber' | 'blue' | 'slate';
  icon: string;
}) {
  return (
    <article className={`v2Kpi v2KpiTone-${tone}`}>
      <div className="v2KpiBody">
        <p className="v2KpiLabel">{label}</p>
        <p className="v2KpiValue">{value}</p>
        <p className="v2KpiDetail">{detail}</p>
      </div>
      <div className="v2KpiIcon" aria-hidden>
        <NavIcon name={icon} />
      </div>
    </article>
  );
}

export function V2Panel({
  title,
  subtitle,
  meta,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`v2Panel ${className}`.trim()}>
      <header className="v2PanelHead">
        <div>
          <h3 className="v2PanelTitle">{title}</h3>
          {subtitle ? <p className="v2PanelSub">{subtitle}</p> : null}
        </div>
        {meta ? <div className="v2PanelMeta">{meta}</div> : null}
      </header>
      <div className="v2PanelBody">{children}</div>
    </section>
  );
}

export function V2EmptyState({
  title,
  description,
  icon = 'overall',
}: {
  title: string;
  description: string;
  icon?: string;
}) {
  return (
    <div className="v2Empty">
      <div className="v2EmptyIcon" aria-hidden>
        <NavIcon name={icon} />
      </div>
      <p className="v2EmptyTitle">{title}</p>
      <p className="v2EmptyDesc">{description}</p>
    </div>
  );
}

export function V2ProgressBar({
  label,
  pct,
  valueLabel,
}: {
  label: string;
  pct: number;
  valueLabel: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div className="v2ProgressBlock">
      <div className="v2ProgressLabels">
        <span>{label}</span>
        <span>{valueLabel}</span>
      </div>
      <div className="v2ProgressTrack" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
        <div className="v2ProgressFill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function V2GhostBtn({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  return (
    <button type={type} className="v2GhostBtn" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
