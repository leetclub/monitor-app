import type { ECharts } from 'echarts';
import { footfallSurfaceIsDark } from '@/features/footfall/lib/footfallDarkSurface';

export function chartFilename(parts: (string | undefined)[]): string {
  return parts
    .filter(Boolean)
    .map((p) =>
      String(p)
        .trim()
        .replace(/[^\w\u0600-\u06FF\-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60),
    )
    .filter(Boolean)
    .join('_');
}

export function downloadChartPng(chart: ECharts, filename: string): void {
  const base = chartFilename([filename]) || 'chart';
  const url = chart.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: footfallSurfaceIsDark() ? '#0a0e14' : '#ffffff',
  });
  const link = document.createElement('a');
  link.href = url;
  link.download = `${base}.png`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
