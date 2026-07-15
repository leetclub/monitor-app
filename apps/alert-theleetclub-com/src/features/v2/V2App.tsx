import { Navigate, Route, Routes } from 'react-router-dom';
import { useAccess } from '@/context/AccessContext';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { V2Shell } from '@/features/v2/V2Shell';
import { V2RedFlagsPage } from '@/features/v2/pages/V2RedFlagsPage';
import { V2OverallPage } from '@/features/v2/pages/V2OverallPage';
import { V2AdminPage } from '@/features/v2/pages/V2AdminPage';
import { PerformancePage } from '@/features/performance/PerformancePage';
import { QaVisitPage } from '@/features/qavisit/QaVisitPage';

/** Authenticated Alert v2 workspace — Manus fleet UI + live Alert APIs. */
export function V2App() {
  const access = useAccess();

  if (access.isLoading) {
    return (
      <div className="v2LoginShell v2LoginShellSolo">
        <div className="v2LoginCard v2LoginCardCenter">
          <p className="v2LoginMuted">Loading permissions…</p>
        </div>
      </div>
    );
  }

  if (access.error) {
    return (
      <div className="v2LoginShell v2LoginShellSolo">
        <div className="v2LoginCard v2LoginCardCenter">
          <h2>Permission lookup failed</h2>
          <p className="v2LoginMuted">{(access.error as Error).message}</p>
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
        <Route path="red-flags" element={<V2RedFlagsPage />} />
        <Route path="overall" element={<V2OverallPage />} />
        <Route path="qa-visit" element={<QaVisitPage variant="manus" />} />
        <Route path="performance" element={<PerformancePage variant="manus" />} />
        <Route path="admin" element={<V2AdminPage />} />
        <Route path="*" element={<Navigate to="red-flags" replace />} />
      </Route>
    </Routes>
  );
}
