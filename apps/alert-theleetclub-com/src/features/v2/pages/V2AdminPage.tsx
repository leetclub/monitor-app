import { useEffect, useState } from 'react';
import { useAccess } from '@/context/AccessContext';
import { MachineProfileSection } from '@/features/admin/MachineProfileSection';
import { TargetsAdminSection } from '@/features/admin/TargetsAdminSection';
import { AreaOwnerAdminSection } from '@/features/admin/AreaOwnerAdminSection';
import { AlertPeopleManager } from '@/features/admin/AlertPeopleManager';
import { V2SectionHead } from '@/features/v2/v2Ui';

type Tab = 'machines' | 'targets' | 'owners' | 'roles';

const TABS: Array<{ id: Tab; label: string; blurb: string }> = [
  { id: 'machines', label: 'Machines', blurb: 'Registry & operators' },
  { id: 'targets', label: 'Targets', blurb: 'Revenue & cups' },
  { id: 'owners', label: 'Area Owners', blurb: 'Ownership map' },
  { id: 'roles', label: 'User Roles', blurb: 'Who can use Alert' },
];

export function V2AdminPage() {
  const { canSeeTab } = useAccess();
  const canEditOrgAccess = canSeeTab('admin');
  const [tab, setTab] = useState<Tab>('machines');

  useEffect(() => {
    if (tab === 'roles' && !canEditOrgAccess) setTab('machines');
  }, [tab, canEditOrgAccess]);

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
    <div className="v2Page v2AdminPage">
      <V2SectionHead
        eyebrow="Governance and controls"
        title="Admin"
        description="Fleet configuration — machines, targets, area owners, and Alert access roles."
      />

      <div className="v2AdminTabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => {
          if (t.id === 'roles' && !canEditOrgAccess) return null;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`v2AdminTab ${active ? 'v2AdminTabActive' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <strong>{t.label}</strong>
              <span>{t.blurb}</span>
            </button>
          );
        })}
      </div>

      <div className="v2AdminBody" role="tabpanel">
        {tab === 'machines' ? <MachineProfileSection /> : null}
        {tab === 'targets' ? <TargetsAdminSection /> : null}
        {tab === 'owners' ? <AreaOwnerAdminSection /> : null}
        {tab === 'roles' && canEditOrgAccess ? <AlertPeopleManager /> : null}
      </div>
    </div>
  );
}
