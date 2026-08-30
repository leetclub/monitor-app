import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatKwd } from '@/lib/salesDisplay';
import type { WeeklyExportMachine, WeeklyExportProduct } from '@/features/performance/exportWeeklyProductReport';

export type WeeklyPdfOpts = {
  periodLabel: string;
  priorLabel: string;
  windowStart?: string;
  windowEnd?: string;
  preparedBy?: string;
  fleetProducts: WeeklyExportProduct[];
  machines: WeeklyExportMachine[];
  focusProduct?: string | null;
  compare: boolean;
  /** Authoritative YoY / period KD from daily sales cache (preferred over SKU mix sum). */
  fleetPeriodKd?: number | null;
  fleetYoyKd?: number | null;
};

/**
 * jsPDF Helvetica cannot render many Unicode glyphs and often inserts
 * odd spacing (looks like letter-spacing) when it falls back. Keep ASCII.
 */
function pdfSafe(text: string): string {
  return String(text || '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2190-\u21FF\u27F0-\u27FF]/g, '->')
    .replace(/[\u00B7\u2022\u2219]/g, '|')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (ch) => {
      // Keep common Latin-1 letters used in drink/location names
      const code = ch.charCodeAt(0);
      if (code >= 0xc0 && code <= 0xff) return ch;
      return '';
    })
    .replace(/ {2,}/g, ' ')
    .trim();
}

function pctChange(cur: number, prev: number | null | undefined): string {
  if (prev == null || !(prev > 0)) return '-';
  const p = ((cur - prev) / prev) * 100;
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}%`;
}

function kd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '-';
  return pdfSafe(formatKwd(Number(v)));
}

function cups(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '-';
  return String(Math.round(Number(v)));
}

function tableEndY(doc: jsPDF): number {
  const withTable = doc as jsPDF & { lastAutoTable?: { finalY?: number } };
  return withTable.lastAutoTable?.finalY ?? 0;
}

function isIosOrIpad(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as MacIntel with touch
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Open PDF in a new tab on iPad/iOS (doc.save navigates away / same tab). Else download. */
function deliverPdf(doc: jsPDF, filename: string) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);

  if (isIosOrIpad()) {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      // Popup blocked: same-tab navigate is worse for the app — try download attribute
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function buildKeyFindings(opts: {
  compare: boolean;
  rising: WeeklyExportProduct[];
  falling: WeeklyExportProduct[];
  lowMachines: WeeklyExportMachine[];
  totalRev: number;
  totalYoy: number;
  totalCups: number;
  totalYoyCups: number;
  topProduct: WeeklyExportProduct | null;
}): string[] {
  const out: string[] = [];
  const {
    compare,
    rising,
    falling,
    lowMachines,
    totalRev,
    totalYoy,
    totalCups,
    totalYoyCups,
    topProduct,
  } = opts;

  if (rising[0]) {
    const p = rising[0];
    out.push(
      pdfSafe(
        `Top riser: ${p.name} moved from ${kd(p.prevRevenueKwd)} to ${kd(p.revenueKwd)} (${pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0))}; cups ${cups(p.prevCups)} to ${cups(p.cups)}).`,
      ),
    );
  }
  if (falling[0]) {
    const p = falling[0];
    out.push(
      pdfSafe(
        `Top faller: ${p.name} moved from ${kd(p.prevRevenueKwd)} to ${kd(p.revenueKwd)} (${pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0))}; cups ${cups(p.prevCups)} to ${cups(p.cups)}).`,
      ),
    );
  }
  if (lowMachines[0]) {
    const m = lowMachines[0];
    const pct =
      m.pctOfLocationTarget != null ? `${Math.round(Number(m.pctOfLocationTarget))}%` : '-';
    out.push(
      pdfSafe(
        `Weakest vs machine target: ${m.machineName} at ${kd(m.periodKd)} of ${kd(m.locationTargetKd)} (${pct}).`,
      ),
    );
  }
  if (totalYoy > 0) {
    out.push(
      pdfSafe(
        `YoY revenue ${pctChange(totalRev, totalYoy)} (${kd(totalRev)} vs last year ${kd(totalYoy)}); cups ${pctChange(totalCups, totalYoyCups)}.`,
      ),
    );
  }
  if (topProduct) {
    out.push(
      pdfSafe(
        `Top product by revenue: ${topProduct.name} at ${kd(topProduct.revenueKwd)} (${cups(topProduct.cups)} cups).`,
      ),
    );
  }
  if (!out.length) {
    out.push(
      compare
        ? 'No strong risers/fallers or YoY signal in this window for the selected fleet.'
        : 'Single-period view - enable a comparison preset for trend findings.',
    );
  }
  return out.slice(0, 5);
}

function buildUpDownNarrative(opts: {
  compare: boolean;
  rising: WeeklyExportProduct[];
  falling: WeeklyExportProduct[];
  lowMachines: WeeklyExportMachine[];
}): string {
  const { compare, rising, falling, lowMachines } = opts;
  if (!compare) return 'Comparison off - rising/falling narrative needs a compare period.';
  const bits: string[] = [];
  if (rising.length) {
    bits.push(
      `What's up: ${rising
        .slice(0, 3)
        .map((p) => `${p.name} (${pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0))})`)
        .join(', ')}.`,
    );
  } else {
    bits.push("What's up: no products up vs prior in this window.");
  }
  if (falling.length) {
    bits.push(
      `What's down: ${falling
        .slice(0, 3)
        .map((p) => `${p.name} (${pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0))})`)
        .join(', ')}.`,
    );
  } else {
    bits.push("What's down: no products down vs prior in this window.");
  }
  if (lowMachines.length) {
    bits.push(
      `Machines behind target: ${lowMachines
        .slice(0, 3)
        .map(
          (m) =>
            `${m.machineName} (${m.pctOfLocationTarget != null ? `${Math.round(Number(m.pctOfLocationTarget))}%` : '-'})`,
        )
        .join(', ')}.`,
    );
  }
  return pdfSafe(bits.join(' '));
}

/** Download a Weekly Performance PDF auto-filled from Products data (ops template sections, no issues/recs). */
export function downloadWeeklyProductReportPdf(opts: WeeklyPdfOpts) {
  const {
    periodLabel: periodLabelRaw,
    priorLabel: priorLabelRaw,
    windowStart,
    windowEnd,
    preparedBy = '',
    fleetProducts,
    machines,
    focusProduct,
    compare,
    fleetPeriodKd,
    fleetYoyKd,
  } = opts;

  const periodLabel = pdfSafe(periodLabelRaw);
  const priorLabel = pdfSafe(priorLabelRaw);

  const mixRev = fleetProducts.reduce((s, p) => s + Number(p.revenueKwd || 0), 0);
  const mixYoy = fleetProducts.reduce((s, p) => s + Number(p.yoyRevenueKwd || 0), 0);
  const totalRev =
    fleetPeriodKd != null && Number.isFinite(Number(fleetPeriodKd)) ? Number(fleetPeriodKd) : mixRev;
  const totalPrev = fleetProducts.reduce((s, p) => s + Number(p.prevRevenueKwd || 0), 0);
  const totalYoy =
    fleetYoyKd != null && Number.isFinite(Number(fleetYoyKd)) && Number(fleetYoyKd) > 0
      ? Number(fleetYoyKd)
      : mixYoy;
  const totalCups = fleetProducts.reduce((s, p) => s + Number(p.cups || 0), 0);
  const totalPrevCups = fleetProducts.reduce((s, p) => s + Number(p.prevCups || 0), 0);
  const totalYoyCups = fleetProducts.reduce((s, p) => s + Number(p.yoyCups || 0), 0);

  const rising = [...fleetProducts]
    .filter((p) => compare && p.trendPct != null && Number(p.trendPct) > 0)
    .sort((a, b) => Number(b.trendPct) - Number(a.trendPct))
    .slice(0, 5);
  const falling = [...fleetProducts]
    .filter((p) => compare && p.trendPct != null && Number(p.trendPct) < 0)
    .sort((a, b) => Number(a.trendPct) - Number(b.trendPct))
    .slice(0, 5);

  const topSelling = [...fleetProducts]
    .filter((p) => Number(p.revenueKwd || 0) > 0)
    .sort((a, b) => Number(b.revenueKwd || 0) - Number(a.revenueKwd || 0) || a.name.localeCompare(b.name))
    .slice(0, 5);
  const lowSelling = [...fleetProducts]
    .filter((p) => Number(p.revenueKwd || 0) > 0)
    .sort((a, b) => Number(a.revenueKwd || 0) - Number(b.revenueKwd || 0) || a.name.localeCompare(b.name))
    .slice(0, 5);

  const lowMachines = [...machines]
    .filter((m) => m.locationTargetKd != null && Number(m.locationTargetKd) > 0)
    .sort(
      (a, b) =>
        (a.pctOfLocationTarget ?? 999) - (b.pctOfLocationTarget ?? 999) ||
        a.machineName.localeCompare(b.machineName),
    )
    .slice(0, 8);

  const topProduct =
    [...fleetProducts].sort(
      (a, b) => Number(b.revenueKwd || 0) - Number(a.revenueKwd || 0) || a.name.localeCompare(b.name),
    )[0] || null;

  const focus = pdfSafe((focusProduct || '').trim());
  const focusRows = focus
    ? machines
        .map((m) => {
          const hit = (m.products || []).find((p) => p.name.toLowerCase() === focus.toLowerCase());
          return {
            location: pdfSafe(m.machineName),
            rev: Number(hit?.revenueKwd || 0),
            prev: Number(hit?.prevRevenueKwd || 0),
            pct: hit?.trendPct ?? null,
          };
        })
        .filter((r) => r.rev > 0 || r.prev > 0)
        .sort((a, b) => b.rev - a.rev)
    : [];

  const findings = buildKeyFindings({
    compare,
    rising,
    falling,
    lowMachines,
    totalRev,
    totalYoy,
    totalCups,
    totalYoyCups,
    topProduct,
  });
  const narrative = buildUpDownNarrative({ compare, rising, falling, lowMachines });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;

  const ensureSpace = (need: number) => {
    if (y + need > doc.internal.pageSize.getHeight() - 18) {
      doc.addPage();
      y = 16;
    }
  };

  const sectionTitle = (title: string) => {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.setCharSpace(0);
    doc.text(pdfSafe(title), margin, y);
    y += 6;
  };

  const bodyText = (text: string, size = 9) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(51, 65, 85);
    doc.setCharSpace(0);
    const safe = pdfSafe(text);
    const lines = doc.splitTextToSize(safe, pageW - margin * 2);
    ensureSpace(lines.length * 4.2 + 2);
    doc.text(lines, margin, y);
    y += lines.length * 4.2 + 3;
  };

  const footerNote =
    'Actual revenue = customer sales only (excludes WEB cashless / remote-credit dispenses).';

  const stampFooter = () => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.setCharSpace(0);
      doc.text(footerNote, margin, doc.internal.pageSize.getHeight() - 8);
      doc.text(`Page ${i} / ${pageCount}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, {
        align: 'right',
      });
    }
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.setCharSpace(0);
  doc.text('LEET Weekly Performance Report', margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Auto-filled from Alert -> Performance -> Products.', margin, y);
  y += 5;
  const weekLine = `Week ending: ${windowEnd || '-'}   |   Prepared by: ${preparedBy || '-'}   |   Window: ${periodLabel}${
    windowStart && windowEnd ? ` (${windowStart} -> ${windowEnd})` : ''
  }`;
  bodyText(weekLine, 8);

  // 1. YoY
  sectionTitle('1. Year-on-Year Comparison');
  bodyText('Compares this period to the same dates last year.', 8);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Metric', periodLabel, 'Same period last year', '% Change']],
    body: [
      ['Total Revenue', kd(totalRev), kd(totalYoy), pctChange(totalRev, totalYoy)],
      ['Total Units Sold', cups(totalCups), cups(totalYoyCups), pctChange(totalCups, totalYoyCups)],
    ],
    styles: { fontSize: 8, cellPadding: 2, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 8;

  // 2. Key findings
  sectionTitle('2. Top 5 Key Findings');
  findings.forEach((f, i) => bodyText(`${i + 1}. ${f}`, 9));

  // 3. What's up / down
  sectionTitle("3. What's Up / What's Down");
  bodyText(narrative, 9);

  // 4. Machine performance
  sectionTitle('4. Machine Performance (location KD vs target)');
  const machineRows = [...machines]
    .sort((a, b) => Number(b.periodKd || 0) - Number(a.periodKd || 0))
    .slice(0, 40)
    .map((m) => [
      pdfSafe(m.machineName),
      kd(m.periodKd),
      compare ? kd(m.prevKd) : '-',
      kd(m.locationTargetKd),
      m.pctOfLocationTarget != null ? `${Math.round(Number(m.pctOfLocationTarget))}%` : '-',
    ]);
  ensureSpace(20);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Location', `${periodLabel} KD`, `${priorLabel} KD`, 'Target KD', '% of target']],
    body: machineRows.length ? machineRows : [['(no machines)', '-', '-', '-', '-']],
    styles: { fontSize: 7.5, cellPadding: 1.8, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 8;

  // 5. Product performance WoW
  sectionTitle('5. Product Performance');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Comparison', 'Current Period', 'Prior Period', '% Change']],
    body: [
      [
        'Period-on-Period (Total Revenue)',
        kd(totalRev),
        compare ? kd(totalPrev) : '-',
        compare ? pctChange(totalRev, totalPrev) : '-',
      ],
      [
        'Period-on-Period (Total Cups)',
        cups(totalCups),
        compare ? cups(totalPrevCups) : '-',
        compare ? pctChange(totalCups, totalPrevCups) : '-',
      ],
    ],
    styles: { fontSize: 8, cellPadding: 2, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 8;

  sectionTitle('5b. Top / lowest selling (period KD)');
  bodyText('Top 5 by revenue', 8);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Product', `${periodLabel} Rev`, compare ? `${priorLabel} Rev` : 'Prior', 'WoW %', 'Cups']],
    body: topSelling.length
      ? topSelling.map((p) => [
          pdfSafe(p.name),
          kd(p.revenueKwd),
          compare ? kd(p.prevRevenueKwd) : '-',
          compare ? pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)) : '-',
          cups(p.cups),
        ])
      : [['(none)', '-', '-', '-', '-']],
    styles: { fontSize: 7.5, cellPadding: 1.8, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 5;
  bodyText('Lowest 5 by revenue', 8);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Product', `${periodLabel} Rev`, compare ? `${priorLabel} Rev` : 'Prior', 'WoW %', 'Cups']],
    body: lowSelling.length
      ? lowSelling.map((p) => [
          pdfSafe(p.name),
          kd(p.revenueKwd),
          compare ? kd(p.prevRevenueKwd) : '-',
          compare ? pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)) : '-',
          cups(p.cups),
        ])
      : [['(none)', '-', '-', '-', '-']],
    styles: { fontSize: 7.5, cellPadding: 1.8, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 8;

  // 6. Top 5 increasing / decreasing
  sectionTitle('6. Top 5 Increasing + Top 5 Decreasing');
  bodyText('Increasing', 8);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [
      [
        'Product',
        `${periodLabel} Rev`,
        `${priorLabel} Rev`,
        'WoW %',
        `${periodLabel} Cups`,
        `${priorLabel} Cups`,
      ],
    ],
    body: rising.length
      ? rising.map((p) => [
          pdfSafe(p.name),
          kd(p.revenueKwd),
          kd(p.prevRevenueKwd),
          pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)),
          cups(p.cups),
          cups(p.prevCups),
        ])
      : [['(none)', '-', '-', '-', '-', '-']],
    styles: { fontSize: 7.5, cellPadding: 1.8, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 5;
  bodyText('Decreasing', 8);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [
      [
        'Product',
        `${periodLabel} Rev`,
        `${priorLabel} Rev`,
        'WoW %',
        `${periodLabel} Cups`,
        `${priorLabel} Cups`,
      ],
    ],
    body: falling.length
      ? falling.map((p) => [
          pdfSafe(p.name),
          kd(p.revenueKwd),
          kd(p.prevRevenueKwd),
          pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)),
          cups(p.cups),
          cups(p.prevCups),
        ])
      : [['(none)', '-', '-', '-', '-', '-']],
    styles: { fontSize: 7.5, cellPadding: 1.8, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 8;

  // 7. Lowest performing (no Why/Rec)
  sectionTitle('7. Lowest Performing Products');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Product', `${periodLabel} Revenue`, `${priorLabel} Revenue`, '% Change']],
    body: falling.length
      ? falling.slice(0, 5).map((p) => [
          pdfSafe(p.name),
          kd(p.revenueKwd),
          kd(p.prevRevenueKwd),
          pctChange(Number(p.revenueKwd || 0), Number(p.prevRevenueKwd || 0)),
        ])
      : [['(none)', '-', '-', '-']],
    styles: { fontSize: 8, cellPadding: 2, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 8;

  // 8. Focus products by location
  sectionTitle('8. Focus Products by Location');
  bodyText(`Focus product: ${focus || '(select a product filter in Alert)'}`, 8);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Location', `${periodLabel} Revenue`, `${priorLabel} Revenue`, 'WoW %']],
    body: focusRows.length
      ? focusRows.slice(0, 40).map((r) => [
          r.location,
          kd(r.rev),
          kd(r.prev),
          r.pct != null
            ? `${Number(r.pct) >= 0 ? '+' : ''}${Number(r.pct).toFixed(1)}%`
            : pctChange(r.rev, r.prev),
        ])
      : [['(pick a product filter to fill this section)', '-', '-', '-']],
    styles: { fontSize: 7.5, cellPadding: 1.8, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });
  y = tableEndY(doc) + 8;

  // 9. Summary
  sectionTitle('9. Summary / Key Figures at a Glance');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Metric', periodLabel, priorLabel, 'Same period last year']],
    body: [
      ['Total Revenue', kd(totalRev), compare ? kd(totalPrev) : '-', kd(totalYoy)],
      ['Total Units Sold', cups(totalCups), compare ? cups(totalPrevCups) : '-', cups(totalYoyCups)],
    ],
    styles: { fontSize: 8, cellPadding: 2, font: 'helvetica', cellWidth: 'wrap' },
    headStyles: { fillColor: [15, 118, 110], textColor: 255 },
  });

  stampFooter();

  const stamp = (windowEnd || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  deliverPdf(doc, `LEET-Weekly-Performance-Report-${stamp}.pdf`);
}
