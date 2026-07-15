import { Navigate, Route, Routes } from 'react-router-dom';
import { useAccess } from '@/context/AccessContext';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { AdminPage } from '@/features/admin/AdminPage';
import { RedFlagsPage } from '@/features/redflags/RedFlagsPage';
import { OverallPage } from '@/features/overall/OverallPage';
import { QaVisitPage } from '@/features/qavisit/QaVisitPage';
import { PerformancePage } from '@/features/performance/PerformancePage';
import { V2Shell } from '@/features/v2/V2Shell';

/** Authenticated Alert v2 workspace (Manus fleet shell + production pages). */
export function V2App() {
  const access = useAccess();

  if (access.isLoading) {
    return (
      <div className="v2LoginShell" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="muted">Loading permissions…</div>
      </div>
    );
  }

  if (access.error) {
    return (
      <div className="v2LoginShell" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Permission lookup failed</div>
          <div className="muted">{(access.error as Error).message}</div>
        </div>
      </div>
    );
  }

  if (!access.canSeeTab('leetAlert') && !access.canSeeTab('redAlert')) {
    return <NoAccessPage email={access.email} />;
  }

  return (
    <Routes>
      <Route element={<V2Shell />}>
        <Route index element={<Navigate to="red-flags" replace />} />
        <Route path="red-flags" element={<RedFlagsPage />} />
        <Route path="overall" element={<OverallPage />} />
        <Route path="qa-visit" element={<QaVisitPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="red-flags" replace />} />
      </Route>
    </Routes>
  );
}
