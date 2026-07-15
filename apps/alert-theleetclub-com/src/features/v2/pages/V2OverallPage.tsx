import { OverallPage } from '@/features/overall/OverallPage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + full Classic Overall workbook. */
export function V2OverallPage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Fleet command"
        title="Overall"
        description="Full Classic fleet workbook — sales, attendance, QA, waste, footfall, and compare presets."
      />
      <div className="v2BoardHost">
        <OverallPage embedded />
      </div>
    </div>
  );
}
