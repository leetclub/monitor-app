import { toPng } from 'html-to-image';
import { chartFilename } from '@/features/footfall/lib/chartExport';

export async function downloadElementPng(
  element: HTMLElement,
  filename: string,
  options?: { backgroundColor?: string },
): Promise<void> {
  const bg = options?.backgroundColor ?? '#ffffff';
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: bg,
    filter: (node) => {
      if (node instanceof HTMLElement && node.classList.contains('chartExportToolbar')) {
        return false;
      }
      if (node instanceof HTMLElement && node.classList.contains('panelExportToolbar')) {
        return false;
      }
      return true;
    },
  });
  const base = chartFilename([filename]) || 'export';
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${base}.png`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
