import { useCallback, useRef, type ReactNode } from 'react';
import { ChartExportButton } from '@/features/footfall/components/ChartExportWrap';
import { chartFilename } from '@/features/footfall/lib/chartExport';
import { downloadElementPng } from '@/features/footfall/lib/domExport';

type Props = {
  filename: string | (string | undefined)[];
  label?: string;
  children: ReactNode;
  className?: string;
  darkBg?: boolean;
};

/** Export panel / table / insights block as PNG (hides export toolbar in capture). */
export function PanelExportWrap({ filename, label, children, className, darkBg }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onExport = useCallback(async () => {
    if (!ref.current) return;
    const name = Array.isArray(filename) ? chartFilename(filename) : filename;
    try {
      await downloadElementPng(ref.current, name, {
        backgroundColor: darkBg ? '#0f1a28' : '#ffffff',
      });
    } catch (e) {
      console.error('PNG export failed', e);
    }
  }, [filename, darkBg, label]);

  return (
    <div className={`panelExportWrap ${className ?? ''}`.trim()}>
      <div className="panelExportToolbar">
        <ChartExportButton
          onExport={() => void onExport()}
          label={label ?? 'Download panel as PNG'}
        />
      </div>
      <div ref={ref} className="panelExportCapture">
        {children}
      </div>
    </div>
  );
}
