import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { MAIN_SECTIONS, TAB_BY_ID, tabsForMain, type MainSectionId } from '@/navigation/tabs';
import { useAccess } from '@/context/AccessContext';
import { useAuth } from '@/context/AuthContext';
import { isMockAccessEnabled } from '@/config/runtimeEnv';
import { BrandLogo } from '@/components/BrandLogo';
import { OpenInstalledAppBanner } from '@/components/OpenInstalledAppBanner';
import { DelayRiskEventsPrefetch } from '@/features/events/DelayRiskEventsPrefetch';
import { MaintenanceGeneralCleaningPrefetch } from '@/features/maintenance/MaintenanceGeneralCleaningPrefetch';
import styles from './Layout.module.css';

const NAV_SECTIONS_STORAGE_KEY = 'leet-monitor:nav-sections-v1';

function loadSectionExpanded(): Record<string, boolean> {
  try {
    const r = localStorage.getItem(NAV_SECTIONS_STORAGE_KEY);
    if (r) {
      const p = JSON.parse(r) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        return p as Record<string, boolean>;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function persistSectionExpanded(map: Record<string, boolean>) {
  try {
    localStorage.setItem(NAV_SECTIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Absent key ⇒ expanded (first visit / new sections). */
function isSectionExpanded(id: string, map: Record<string, boolean>): boolean {
  return map[id] !== false;
}

function tabPath(tabId: string): string {
  return `/tab/${tabId}`;
}

function userInitials(email: string): string {
  const local = email.split('@')[0] || email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return local.slice(0, 2).toUpperCase();
}

export function Layout() {
  const match = useMatch('/tab/:tabId');
  const activeTabId = match?.params.tabId ?? '';
  const activeMain = activeTabId ? TAB_BY_ID[activeTabId]?.main : undefined;
  const { canSeeTab, isLoading, error, refetch } = useAccess();
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sectionExpanded, setSectionExpanded] = useState(loadSectionExpanded);
  const mainColumnRef = useRef<HTMLDivElement>(null);
  const [boardFullscreen, setBoardFullscreen] = useState(false);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    closeSidebar();
  }, [activeTabId, closeSidebar]);

  useEffect(() => {
    persistSectionExpanded(sectionExpanded);
  }, [sectionExpanded]);

  useEffect(() => {
    if (!activeMain) {
      return;
    }
    setSectionExpanded((prev) => {
      if (prev[activeMain] === false) {
        return { ...prev, [activeMain]: true };
      }
      return prev;
    });
  }, [activeMain]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) {
        setSidebarOpen(false);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = mainColumnRef.current;
    const sync = () => {
      setBoardFullscreen(!!el && document.fullscreenElement === el);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!boardFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void document.exitFullscreen?.();
        (document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [boardFullscreen]);

  const toggleBoardFullscreen = useCallback(async () => {
    const el = mainColumnRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      try {
        if (document.fullscreenElement === el) {
          await (document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen?.();
        } else {
          await (el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.();
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  const visibleSections = useMemo(
    () =>
      MAIN_SECTIONS.map((m) => ({
        ...m,
        tabs: tabsForMain(m.id).filter((t) => canSeeTab(t.id)),
      })).filter((s) => s.tabs.length > 0),
    [canSeeTab],
  );

  const toggleSection = useCallback((id: MainSectionId) => {
    setSectionExpanded((prev) => ({
      ...prev,
      [id]: !isSectionExpanded(id, prev),
    }));
  }, []);

  const expandAllSections = useCallback(() => {
    setSectionExpanded({});
  }, []);

  const collapseAllSections = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const s of visibleSections) {
      next[s.id] = false;
    }
    setSectionExpanded(next);
  }, [visibleSections]);

  const activeMeta = activeTabId ? TAB_BY_ID[activeTabId] : undefined;

  return (
    <div className={styles.shell}>
      <DelayRiskEventsPrefetch />
      <MaintenanceGeneralCleaningPrefetch />
      {sidebarOpen && (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close navigation"
          onClick={closeSidebar}
        />
      )}

      <aside
        id="app-sidebar-nav"
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
        aria-label="Application sections"
      >
        <div className={styles.sidebarBrand}>
          <BrandLogo mark="favicon" size={72} className={styles.sidebarLogo} />
          <div className={styles.sidebarBrandText}>
            <span className={styles.sidebarTitle}>Leet Monitor</span>
            <span className={styles.sidebarBadge}>v2</span>
          </div>
          <button
            type="button"
            className={styles.sidebarClose}
            aria-label="Close menu"
            onClick={closeSidebar}
          />
        </div>

        {visibleSections.length > 1 && (
          <div className={styles.navToolbar} role="group" aria-label="Section visibility">
            <button type="button" className={styles.navToolbarBtn} onClick={expandAllSections}>
              Expand all
            </button>
            <span className={styles.navToolbarSep} aria-hidden>
              ·
            </span>
            <button type="button" className={styles.navToolbarBtn} onClick={collapseAllSections}>
              Collapse all
            </button>
          </div>
        )}

        <nav className={styles.sidebarNav}>
          {visibleSections.map((section) => {
            const open = isSectionExpanded(section.id, sectionExpanded);
            const isActiveSection = activeMain === section.id;
            return (
              <div
                key={section.id}
                className={`${styles.navGroup} ${isActiveSection ? styles.navGroupActive : ''}`}
              >
                <button
                  type="button"
                  className={styles.navGroupToggle}
                  aria-expanded={open}
                  aria-controls={`nav-section-${section.id}`}
                  id={`nav-section-trigger-${section.id}`}
                  onClick={() => toggleSection(section.id)}
                >
                  <span className={styles.navGroupTitleRow}>
                    <span className={styles.navGroupDot} aria-hidden />
                    <span className={styles.navGroupTitle}>{section.label}</span>
                    <span className={styles.navGroupCount}>{section.tabs.length}</span>
                  </span>
                  <span
                    className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
                    aria-hidden
                  />
                </button>
                <div
                  id={`nav-section-${section.id}`}
                  role="region"
                  aria-labelledby={`nav-section-trigger-${section.id}`}
                  className={`${styles.navGroupPanel} ${open ? styles.navGroupPanelOpen : ''}`}
                >
                  <div className={styles.navGroupPanelInner}>
                    <ul className={styles.navList}>
                      {section.tabs.map((t) => (
                        <li key={t.id}>
                          <NavLink
                            to={tabPath(t.id)}
                            title={t.description}
                            className={({ isActive }) =>
                              `${styles.navItem} ${isActive ? styles.navItemActive : ''} ${t.id === 'redAlert' || t.id === 'redAlertExpert' ? styles.navItemRedAlert : ''}`
                            }
                            onClick={closeSidebar}
                          >
                            <span className={styles.navItemBar} aria-hidden />
                            <span className={styles.navItemText}>{t.label}</span>
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div ref={mainColumnRef} className={styles.mainColumn}>
        <header className={styles.topBar}>
          <button
            type="button"
            className={styles.burgerBtn}
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar-nav"
            onClick={() => setSidebarOpen(true)}
          >
            <span className={styles.burgerIcon} aria-hidden />
          </button>
          <span className={styles.topBarAppName}>Leet Monitor</span>
          <div className={styles.topBarLead}>
            {activeMeta ? (
              <>
                <span className={styles.crumb}>{MAIN_SECTIONS.find((m) => m.id === activeMeta.main)?.label}</span>
                <span className={styles.crumbSep} aria-hidden>
                  /
                </span>
                <h1 className={styles.pageTitle}>{activeMeta.label}</h1>
              </>
            ) : (
              <h1 className={styles.pageTitle}>Dashboard</h1>
            )}
          </div>
          <div className={styles.topBarTrail}>
            <button
              type="button"
              className={styles.fsBtn}
              onClick={() => void toggleBoardFullscreen()}
              title="Fullscreen this dashboard column (hides sidebar). Press Esc to exit."
            >
              {boardFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
            {isMockAccessEnabled() && <span className={styles.pillWarn}>Mock access</span>}
            {user ? (
              <div className={styles.userChip}>
                <span className={styles.userAvatar} aria-hidden>
                  {userInitials(user.email)}
                </span>
                <span className={styles.userEmail} title={user.email}>
                  {user.email}
                </span>
                <button type="button" className={styles.btnGhost} onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <OpenInstalledAppBanner />

        {error && (
          <div className={styles.bannerError} role="alert">
            <span>Could not load tab permissions: {error.message}</span>
            <button type="button" className={styles.linkBtn} onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}

        <main className={styles.main}>
          {isLoading ? <div className={styles.loading}>Loading access…</div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
