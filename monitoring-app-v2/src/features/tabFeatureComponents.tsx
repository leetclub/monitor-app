import { type ComponentType, type LazyExoticComponent } from 'react';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { TABS } from '@/navigation/tabs';

const EventsDelayRiskTab = lazyWithReload(() => import('./events/EventsDelayRiskTab'));
const WasteAnalysisTab = lazyWithReload(() => import('./waste/WasteAnalysisTab'));
const MaintenanceTab = lazyWithReload(() => import('./maintenance/MaintenanceTab'));
const TransactionsTab = lazyWithReload(() => import('./transactions/TransactionsTab'));
const AdminTab = lazyWithReload(() => import('./admin/AdminTab'));
const LiveDashboardTab = lazyWithReload(() => import('./liveDashboard/LiveDashboardTab'));
const OverallTab = lazyWithReload(() => import('./overall/OverallTab'));
const RedAlertTab = lazyWithReload(() => import('./redAlert/RedAlertTab'));
const RefundTestsTab = lazyWithReload(() => import('./remoteCredits/RefundTestsTab'));

const SPECIAL: Record<string, LazyExoticComponent<ComponentType>> = {
  events: EventsDelayRiskTab,
  waste: WasteAnalysisTab,
  maintenance: MaintenanceTab,
  transactions: TransactionsTab,
  remoteCredits: RefundTestsTab,
  admin: AdminTab,
  liveDashboard: LiveDashboardTab,
  overall: OverallTab,
  redAlert: RedAlertTab,
  redAlertExpert: RedAlertTab,
};

/**
 * Lazy feature entry per dashboard tab. Add new slices to SPECIAL, then flesh out src/features/&lt;id&gt;/.
 */
function buildTabFeatureComponents(): Record<string, LazyExoticComponent<ComponentType>> {
  const map: Record<string, LazyExoticComponent<ComponentType>> = { ...SPECIAL };
  for (const t of TABS) {
    if (map[t.id]) continue;
    const id = t.id;
    map[t.id] = lazyWithReload(() =>
      import('./_shared/LegacyTabPlaceholder').then((m) => ({
        default: () => <m.LegacyTabPlaceholder tabId={id} />,
      })),
    );
  }
  return map;
}

export const TAB_FEATURE_COMPONENTS = buildTabFeatureComponents();
