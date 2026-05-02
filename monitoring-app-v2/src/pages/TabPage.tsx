import { Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TAB_BY_ID } from '@/navigation/tabs';
import { useAccess } from '@/context/AccessContext';
import { TAB_FEATURE_COMPONENTS } from '@/features/tabFeatureComponents';

/**
 * Each tab resolves to a lazy feature under src/features/ (see tabFeatureComponents.tsx).
 * Reference for parity: monitoring-app index.html + per-tab *.js.
 */
export function TabPage() {
  const { tabId = '' } = useParams();
  const { canSeeTab } = useAccess();
  const meta = TAB_BY_ID[tabId];

  if (!meta) {
    return (
      <div className="panel">
        <h1>Not found</h1>
        <p>
          Unknown tab <code>{tabId}</code>.
        </p>
        <Link to="/">Go home</Link>
      </div>
    );
  }

  if (!canSeeTab(tabId)) {
    return (
      <div className="panel">
        <h1>Access denied</h1>
        <p>You do not have permission to open {meta.label}.</p>
        <Link to="/">Back to dashboard</Link>
      </div>
    );
  }

  const TabFeature = TAB_FEATURE_COMPONENTS[tabId];
  if (!TabFeature) {
    return (
      <div className="panel">
        <h1>Not configured</h1>
        <p>
          No feature module registered for <code>{tabId}</code>. Add it in{' '}
          <code>src/features/tabFeatureComponents.tsx</code>.
        </p>
        <Link to="/">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="panel muted" style={{ margin: 0 }}>
          Loading {meta.label}…
        </div>
      }
    >
      <TabFeature />
    </Suspense>
  );
}
