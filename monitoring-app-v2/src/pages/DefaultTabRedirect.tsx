import { Navigate } from 'react-router-dom';
import { TABS } from '@/navigation/tabs';
import { useAccess } from '@/context/AccessContext';

export function DefaultTabRedirect() {
  const { canSeeTab, isLoading } = useAccess();

  if (isLoading) {
    return null;
  }

  const first = TABS.find((t) => canSeeTab(t.id));
  if (!first) {
    return (
      <div className="panel muted">
        <h1>No access</h1>
        <p>
          Your signed-in account is not allowed to open any dashboard tabs. An administrator must either add
          your email in the access rules or set a non-empty <strong>default</strong> tab list for everyone.
        </p>
        <p className="muted" style={{ marginBottom: 0, fontSize: '0.9rem' }}>
          If you recently changed dashboard permissions in the database, an empty default tab list blocks all
          users who do not have their own row.
        </p>
      </div>
    );
  }

  return <Navigate to={`/tab/${first.id}`} replace />;
}
