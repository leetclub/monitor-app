import { Navigate, Route, Routes } from 'react-router-dom';
import { useAccess } from '@/context/AccessContext';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { V2Shell } from '@/features/v2/V2Shell';
import { V2RedFlagsPage } from '@/features/v2/pages/V2RedFlagsPage';
import { V2OverallPage } from '@/features/v2/pages/V2OverallPage';
import { V2QaVisitPage } from '@/features/v2/pages/V2QaVisitPage';
import { V2PerformancePage } from '@/features/v2/pages/V2PerformancePage';
import { V2AdminPage } from '@/features/v2/pages/V2AdminPage';

/** Authenticated Alert v2 workspace — Manus fleet UI + live Alert APIs. */
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
        <Route path="red-flags" element={<V2RedFlagsPage />} />
        <Route path="overall" element={<V2OverallPage />} />
        <Route path="qa-visit" element={<V2QaVisitPage />} />
        <Route path="performance" element={<V2PerformancePage />} />
        <Route path="admin" element={<V2AdminPage />} />
        <Route path="*" element={<Navigate to="red-flags" replace />} />
      </Route>
    </Routes>
  );
}
