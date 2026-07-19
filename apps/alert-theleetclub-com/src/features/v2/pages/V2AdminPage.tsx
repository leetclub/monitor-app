import { useEffect, useState } from 'react';
import { useAccess } from '@/context/AccessContext';
import { MachineProfileSection } from '@/features/admin/MachineProfileSection';
import { TargetsAdminSection } from '@/features/admin/TargetsAdminSection';
import { PromoAdminSection } from '@/features/admin/PromoAdminSection';
import { AreaOwnerAdminSection } from '@/features/admin/AreaOwnerAdminSection';
import { AlertPeopleManager } from '@/features/admin/AlertPeopleManager';
import { QaVisitAdminSection } from '@/features/admin/QaVisitAdminSection';
import { V2Panel, V2SectionHead } from '@/features/v2/v2Ui';

type Tab = 'machines' | 'targets' | 'promo' | 'owners' | 'qa' | 'roles';

const TABS: Array<{ id: Tab; label: string; blurb: string }> = [
  { id: 'machines', label: 'Machines', blurb: 'Registry & operators' },
  { id: 'targets', label: 'Targets', blurb: 'Revenue & cups' },
  { id: 'promo', label: 'Promo', blurb: 'Campaign cups' },
  { id: 'owners', label: 'Area Owners', blurb: 'Ownership map' },
  { id: 'qa', label: 'QA Visit', blurb: 'Manual summaries' },
  { id: 'roles', label: 'User Roles', blurb: 'Who can use Alert' },
];

/** Pure Manus Admin — Manus tabs hosting config sections (no Classic admin shell). */
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
    <div className="v2Page">
      <V2SectionHead
        eyebrow="Governance and controls"
        title="Admin"
        description="Fleet configuration — machines, targets, promo, area owners, QA, and access roles."
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

      <V2Panel title={TABS.find((t) => t.id === tab)?.label || 'Admin'} subtitle="Configuration">
        <div className="v2AdminManusBody">
          {tab === 'machines' ? <MachineProfileSection /> : null}
          {tab === 'targets' ? <TargetsAdminSection /> : null}
          {tab === 'promo' ? <PromoAdminSection /> : null}
          {tab === 'owners' ? <AreaOwnerAdminSection /> : null}
          {tab === 'qa' ? <QaVisitAdminSection /> : null}
          {tab === 'roles' && canEditOrgAccess ? <AlertPeopleManager /> : null}
        </div>
      </V2Panel>
    </div>
  );
}
