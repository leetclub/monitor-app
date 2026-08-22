import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, NavLink, Route, Routes, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AdminPage } from './features/admin/AdminPage';
import { RedFlagsPage } from './features/redflags/RedFlagsPage';
import { OverallPage } from './features/overall/OverallPage';
import { QaVisitPage } from './features/qavisit/QaVisitPage';
import { PerformancePage } from './features/performance/PerformancePage';
import { PromoPage } from './features/promo/PromoPage';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AccessProvider, useAccess } from '@/context/AccessContext';
import { LoginPage } from '@/pages/LoginPage';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { NavIcon } from '@/components/NavIcon';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ColorModeToggle } from '@/components/ColorModeToggle';
import { useAlertUiTheme } from '@/lib/useAlertUiTheme';
import { V2App } from '@/features/v2/V2App';
import { V2LoginPage } from '@/features/v2/V2LoginPage';
import {
  navDrawerMediaQuery,
  persistNavExpandedPreference,
  readNavExpandedPreference,
  resolveNavLayout,
  coerceNavExpandedForViewport,
  type NavLayout,
} from '@/lib/navDrawer';

/** Lazy so Footfall CSS does not load on Red Flags / Overall. */
const FootfallPage = lazy(() =>
  import('./features/footfall/FootfallPage').then((m) => ({ default: m.FootfallPage })),
);

function kuwaitClockLabel(d: Date): string {
  try {
    return (
      d.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kuwait',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' KWT'
    );
  } catch {
    return d.toLocaleTimeString();
  }
}

function useNavLayout(): {
  layout: NavLayout;
  expanded: boolean;
  toggleExpanded: () => void;
  isRail: boolean;
} {
  const [expandedPref, setExpandedPref] = useState<boolean | null>(() => {
    const raw = readNavExpandedPreference();
    return coerceNavExpandedForViewport(raw);
  });
  const [layout, setLayout] = useState<NavLayout>(() => resolveNavLayout(expandedPref));

  useEffect(() => {
    setLayout(resolveNavLayout(expandedPref));
  }, [expandedPref]);

  useEffect(() => {
    const syncViewport = () => {
      setLayout(resolveNavLayout(expandedPref));
    };
    syncViewport();
    const mqDrawer = window.matchMedia(navDrawerMediaQuery());
    mqDrawer.addEventListener('change', syncViewport);
    window.addEventListener('resize', syncViewport);
    return () => {
      mqDrawer.removeEventListener('change', syncViewport);
      window.removeEventListener('resize', syncViewport);
    };
  }, [expandedPref]);

  const toggleExpanded = () => {
    setExpandedPref((prev) => {
      const next = prev !== true;
      persistNavExpandedPreference(next);
      return next ? true : false;
    });
  };

  return { layout, expanded: expandedPref === true, toggleExpanded, isRail: layout === 'rail' };
}

function useKuwaitClock(): string {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return kuwaitClockLabel(clock);
}

function NavLinks({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { canSeeTab } = useAccess();
  return (
    <nav className={className ?? 'navList'} aria-label="Primary">
      <NavLink
        to="/red-flags"
        title="Red Flags"
        className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        onClick={onNavigate}
      >
        <NavIcon name="red_flags" />
        <span className="navLinkTitle">Red Flags</span>
      </NavLink>
      <NavLink
        to="/overall"
        title="Overall"
        className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        onClick={onNavigate}
      >
        <NavIcon name="overall" />
        <span className="navLinkTitle">Overall</span>
      </NavLink>
      <NavLink
        to="/qa-visit"
        title="QA Visit"
        className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        onClick={onNavigate}
      >
        <NavIcon name="qa_visit" />
        <span className="navLinkTitle">QA Visit</span>
      </NavLink>
      <NavLink
        to="/performance"
        title="Performance"
        className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        onClick={onNavigate}
      >
        <NavIcon name="performance" />
        <span className="navLinkTitle">Performance</span>
      </NavLink>
      <NavLink
        to="/footfall"
        title="Footfall"
        className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        onClick={onNavigate}
      >
        <NavIcon name="footfall" />
        <span className="navLinkTitle">Footfall</span>
      </NavLink>
      <NavLink
        to="/promo"
        title="Promo"
        className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        onClick={onNavigate}
      >
        <NavIcon name="promo" />
        <span className="navLinkTitle">Promo</span>
      </NavLink>
      {canSeeTab('leetAlertAdmin') ? (
        <NavLink
          to="/admin"
          title="Admin"
          className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
          onClick={onNavigate}
        >
          <NavIcon name="admin" />
          <span className="navLinkTitle">Admin</span>
        </NavLink>
      ) : null}
    </nav>
  );
}

function SideNav({
  open,
  onNavigate,
  layout,
  onNavToggle,
  navToggleTitle,
}: {
  open: boolean;
  onNavigate: () => void;
  layout: NavLayout;
  onNavToggle: () => void;
  navToggleTitle: string;
}) {
  const { user } = useAuth();
  const email = user?.email ?? '';
  const isDrawer = layout === 'drawer';
  const isRail = layout === 'rail' || isDrawer;
  const showLabels = layout === 'full' || (isDrawer && open);

  return (
    <aside
      id="leet-alert-side-nav"
      className={[
        'sideNav',
        isDrawer ? 'sideNavDrawer' : '',
        isDrawer && open ? 'sideNavOpen' : '',
        isRail && !showLabels ? 'sideNavRail' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden={false}
    >
      <button
        type="button"
        className="sideNavExpandBtn sideNavToggleTop"
        onClick={onNavToggle}
        title={navToggleTitle}
        aria-label={navToggleTitle}
        aria-expanded={showLabels}
        aria-controls="leet-alert-side-nav"
      >
        <NavIcon name={isDrawer && open ? 'panel_close' : 'menu'} />
        <span className="navLinkTitle">{isDrawer ? (open ? 'Close' : 'Menu') : showLabels ? 'Icons' : 'Labels'}</span>
      </button>
      <div className="sideNavBrand">
        <h1 className="brand">
          <span className="brandFull">LEET ALERT</span>
          <span className="brandCompact" aria-hidden>
            LA
          </span>
        </h1>
        <p className="sideNavTagline">Operations</p>
      </div>
      <NavLinks onNavigate={onNavigate} />
      <div className="sideNavUser">
        <div className="sideNavAvatar" aria-hidden>
          <NavIcon name="account_circle" />
        </div>
        <div className="sideNavUserMeta">
          <p className="sideNavUserEmail" title={email}>
            {email || 'Signed in'}
          </p>
        </div>
      </div>
    </aside>
  );
}

function DefaultRedirect() {
  return <Navigate to="/red-flags" replace />;
}

/** Unauthenticated /v2/* → Manus login, preserve destination. */
function V2LoginRedirect() {
  const location = useLocation();
  const next = encodeURIComponent(`${location.pathname}${location.search}`);
  return <Navigate to={`/v2/login?next=${next}`} replace />;
}

function AppRoutesOutlet() {
  return (
    <Suspense fallback={<div className="panel" style={{ margin: 16 }}>Loading…</div>}>
      <Routes>
        <Route path="/" element={<DefaultRedirect />} />
        <Route path="/home" element={<DefaultRedirect />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/red-flags" element={<RedFlagsPage />} />
        <Route path="/overall" element={<OverallPage />} />
        <Route path="/qa-visit" element={<QaVisitPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/footfall" element={<FootfallPage />} />
        <Route path="/promo" element={<PromoPage />} />
        <Route path="*" element={<DefaultRedirect />} />
      </Routes>
    </Suspense>
  );
}

function UserSessionControls() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user?.email) return null;
  return (
    <>
      <ThemeToggle compact />
      <ColorModeToggle compact />
      <span className="topBarSignedIn">
        <NavIcon name="account_circle" />
        <strong>{user.email}</strong>
      </span>
      <button
        type="button"
        className="topBarSignOut"
        onClick={async () => {
          await signOut();
          navigate('/login', { replace: true, state: { signedOut: true } });
        }}
      >
        Sign out
      </button>
    </>
  );
}

/** Classic: sticky clock strip above content. */
function ClassicTopBar() {
  const clock = useKuwaitClock();
  return (
    <header className="topBar">
      <div className="topBarStart">
        <span className="topBarClock">{clock}</span>
      </div>
      <div className="topBarEnd">
        <UserSessionControls />
      </div>
    </header>
  );
}

/**
 * Pro: product app bar — brand + horizontal tabs + session.
 * Different IA from Classic sidebar shell.
 */
function ProAppHeader({
  menuOpen,
  onMenuToggle,
  onNavigate,
}: {
  menuOpen: boolean;
  onMenuToggle: () => void;
  onNavigate: () => void;
}) {
  const clock = useKuwaitClock();

  return (
    <header className="proAppHeader">
      <div className="proAppHeaderBar">
        <div className="proAppHeaderBrand">
          <button
            type="button"
            className="proAppMenuBtn"
            onClick={onMenuToggle}
            aria-expanded={menuOpen}
            aria-controls="pro-app-nav"
            title={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <NavIcon name={menuOpen ? 'panel_close' : 'menu'} />
            <span className="srOnly">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
          <div className="proAppBrandText">
            <p className="proAppBrandName">Leet Alert</p>
            <p className="proAppBrandSub">iPad ops</p>
          </div>
        </div>

        <div className="proAppHeaderEnd">
          <span className="proAppClock" title="Kuwait time">
            {clock}
          </span>
          <UserSessionControls />
        </div>
      </div>

      <div className="proAppTabStripWrap">
        <NavLinks className="proAppTabStrip" onNavigate={onNavigate} />
      </div>

      {menuOpen ? (
        <div id="pro-app-nav" className="proAppMobileNav">
          <NavLinks onNavigate={onNavigate} className="proAppMobileNavList" />
        </div>
      ) : null}
    </header>
  );
}

function ClassicShell() {
  const { layout, toggleExpanded, isRail } = useNavLayout();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const isDrawer = layout === 'drawer';

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isDrawer || !navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isDrawer, navOpen]);

  return (
    <div
      className={[
        'appShell',
        'stitchShell',
        isDrawer ? 'appShellNavDrawer' : '',
        layout === 'rail' || isDrawer ? 'appShellNavRail' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isDrawer && navOpen ? (
        <button type="button" className="navBackdrop" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      ) : null}
      <div className="navShell">
        <SideNav
          open={navOpen}
          onNavigate={() => setNavOpen(false)}
          layout={layout}
          onNavToggle={isDrawer ? () => setNavOpen((v) => !v) : toggleExpanded}
          navToggleTitle={
            isDrawer
              ? navOpen
                ? 'Close menu'
                : 'Open menu'
              : isRail
                ? 'Show menu labels'
                : 'Icons only'
          }
        />
      </div>
      <div className="mainColumn">
        <ClassicTopBar />
        <main className="content contentMain appMain">
          <AppRoutesOutlet />
        </main>
      </div>
    </div>
  );
}

function ProShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <div className="appShell appShellPro">
      {menuOpen ? (
        <button type="button" className="navBackdrop proNavBackdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
      ) : null}
      <ProAppHeader
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((v) => !v)}
        onNavigate={() => setMenuOpen(false)}
      />
      <main className="content contentMain appMain proAppMain">
        <AppRoutesOutlet />
      </main>
    </div>
  );
}

function ProtectedShell() {
  const access = useAccess();
  const theme = useAlertUiTheme();

  if (access.isLoading) {
    return (
      <div className="panel" style={{ margin: 24 }}>
        Loading permissions…
      </div>
    );
  }

  if (access.error) {
    return (
      <div className="panel" style={{ margin: 24 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Permission lookup failed</div>
        <div className="muted">{(access.error as Error).message}</div>
      </div>
    );
  }

  if (!access.canSeeTab('leetAlert') && !access.canSeeTab('redAlert')) {
    return <NoAccessPage email={access.email} />;
  }

  return theme === 'pro' ? <ProShell /> : <ClassicShell />;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loginShell">
        <div className="loginCard panel" style={{ textAlign: 'center' }}>
          <div className="muted">Checking your session…</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/v2/login" element={<V2LoginPage />} />
          <Route path="/v2/*" element={<V2LoginRedirect />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <AccessProvider userEmail={user.email}>
      <BrowserRouter>
        <Routes>
          <Route path="/v2/login" element={<Navigate to="/v2/red-flags" replace />} />
          <Route path="/v2/*" element={<V2App />} />
          <Route path="/*" element={<ProtectedShell />} />
        </Routes>
      </BrowserRouter>
    </AccessProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
