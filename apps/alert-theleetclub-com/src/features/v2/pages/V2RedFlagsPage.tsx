import { RedFlagsPage } from '@/features/redflags/RedFlagsPage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus Fleet Intelligence chrome + Classic Red Flags fields/APIs (not Classic page chrome). */
export function V2RedFlagsPage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Priority queue"
        title="Red Flags"
        description="Manus layout with every Classic field — sales, target, SX, frequency, cleaning, QA, credits, and actions."
      />
      <RedFlagsPage variant="manus" />
    </div>
  );
}
