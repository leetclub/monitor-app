import { AdminPage } from '@/features/admin/AdminPage';
import { useAccess } from '@/context/AccessContext';
import { V2SectionHead } from '@/features/v2/v2Ui';

/** Manus chrome + full Classic Admin (all sections). */
export function V2AdminPage() {
  const { canSeeTab } = useAccess();

  if (!canSeeTab('leetAlertAdmin')) {
    return (
      <div className="v2Page">
        <V2SectionHead
          eyebrow="Governance"
          title="Admin"
          description="You do not have Admin access for this workspace."
        />
      </div>
    );
  }

  return (
    <div className="v2Page v2PageBoard">
      <V2SectionHead
        eyebrow="Governance and controls"
        title="Admin"
        description="Full Classic Admin — machines, targets, area owners, QA visit, access, and advanced rules."
      />
      <div className="v2BoardHost">
        <AdminPage embedded />
      </div>
    </div>
  );
}
