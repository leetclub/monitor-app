import { OverallPage } from '@/features/overall/OverallPage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + Classic Overall workbook fields/APIs. */
export function V2OverallPage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Fleet command"
        title="Overall"
        description="Manus layout with the full Classic fleet workbook — attendance, sales, footfall, waste, QA, and more."
      />
      <OverallPage variant="manus" />
    </div>
  );
}
