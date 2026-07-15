import { QaVisitPage } from '@/features/qavisit/QaVisitPage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + full Classic QA Visit fleet/workspace. */
export function V2QaVisitPage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Quality assurance"
        title="QA Visit"
        description="Full Classic quality workspace — date filters, fleet table, machine audits, and reports."
      />
      <div className="v2BoardHost">
        <QaVisitPage embedded />
      </div>
    </div>
  );
}
