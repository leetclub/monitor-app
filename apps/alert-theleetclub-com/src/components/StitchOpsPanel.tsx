import type { ReactNode } from 'react';
import { NavIcon } from '@/components/NavIcon';
import { StitchKpiStrip, type StitchKpi } from '@/components/StitchKpiStrip';

export function StitchOpsPanel({
  iconName,
  title,
  subtitle,
  badge,
  metaLine,
  toolbar,
  kpis,
  children,
  className = '',
  compact = false,
}: {
  iconName: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  /** Snapshot / meta — shown inline in compact header (saves vertical space). */
  metaLine?: ReactNode;
  toolbar?: ReactNode;
  kpis?: StitchKpi[];
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const kpisInline = compact && (kpis?.length ?? 0) > 0;

  return (
    <section
      className={`stitchDataPanel stitchOpsPanel${compact ? ' stitchOpsPanelCompact' : ''} ${className}`.trim()}
    >
      <header className="stitchOpsHead">
        <div className="stitchOpsHeadMain">
          <div className="stitchOpsTitleRow">
            <h1 className="stitchDataPanelTitle">
              <NavIcon name={iconName} />
              {title}
            </h1>
            {badge ? <span className="stitchOpsBadge">{badge}</span> : null}
            {metaLine && compact ? <span className="stitchOpsMetaInline">{metaLine}</span> : null}
          </div>
          {subtitle && !compact ? <p className="stitchOpsSubtitle">{subtitle}</p> : null}
          {kpisInline ? (
            <div className="stitchKpiInline" role="group" aria-label="Key metrics">
              {kpis!.map((k) => (
                <span
                  key={k.label}
                  className={`stitchKpiInlineItem${k.tone === 'warn' ? ' stitchKpiInlineItemWarn' : ''}${k.tone === 'good' ? ' stitchKpiInlineItemGood' : ''}`}
                  title={k.sub ? `${k.label}: ${k.sub}` : k.label}
                >
                  <span className="stitchKpiInlineVal">{k.value}</span>
                  <span className="stitchKpiInlineLabel">{k.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {toolbar ? <div className="stitchOpsToolbar">{toolbar}</div> : null}
      </header>
      <div className="stitchOpsBody">
        <div className="opsDashboard opsDashboard--tight">
          {!kpisInline && kpis?.length ? (
            <section className="opsDashboardSection" aria-labelledby="ops-kpi-heading">
              <header className="opsDashboardSectionHead">
                <h2 id="ops-kpi-heading" className="opsDashboardSectionTitle">
                  At a glance
                </h2>
              </header>
              <div className="opsDashboardSectionBody opsDashboardSectionBody--kpis">
                <StitchKpiStrip items={kpis} />
              </div>
            </section>
          ) : null}
          {children}
        </div>
      </div>
    </section>
  );
}
