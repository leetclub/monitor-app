import { QaVisitPage } from '@/features/qavisit/QaVisitPage';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + Classic QA Visit fields/workspace. */
export function V2QaVisitPage() {
  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Quality assurance"
        title="QA Visit"
        description="Manus layout with Classic fleet filters, scores, Admin MTD, and machine audit workspace."
      />
      <QaVisitPage variant="manus" />
    </div>
  );
}
