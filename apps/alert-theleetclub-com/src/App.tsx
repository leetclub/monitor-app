import { BrowserRouter, NavLink, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import { AdminPage } from './features/admin/AdminPage';
import { RedFlagsPage } from './features/redflags/RedFlagsPage';
import { OverallPage } from './features/overall/OverallPage';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AccessProvider, useAccess } from '@/context/AccessContext';
import { LoginPage } from '@/pages/LoginPage';
import { NoAccessPage } from '@/pages/NoAccessPage';
import { HomePage } from '@/pages/HomePage';

function SideNav() {
  const { canSeeTab } = useAccess();
  return (
    <aside className="sideNav">
      <div className="brand">Leet Alert</div>
      <p className="sideNavTagline">Operations</p>
      <div className="navList">
        <NavLink
          to="/home"
          title="Overview"
          className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        >
          <span className="navLinkTitle">Home</span>
        </NavLink>
        {canSeeTab('leetAlertAdmin') ? (
          <NavLink
            to="/admin"
            title="Machines and access"
            className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
          >
            <span className="navLinkTitle">Admin</span>
          </NavLink>
        ) : null}
        <NavLink
          to="/red-flags"
          title="Attention needed"
          className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        >
          <span className="navLinkTitle">Red Flags</span>
        </NavLink>
        <NavLink
          to="/overall"
          title="Fleet overview"
          className={({ isActive }) => `navLink ${isActive ? 'navLinkActive' : ''}`}
        >
          <span className="navLinkTitle">Overall</span>
        </NavLink>
      </div>
      <div className="sideNavFoot muted">Figures refresh ~1 min</div>
    </aside>
  );
}

function HomeRedirect() {
  return <Navigate to="/home" replace />;
}

function ProtectedShell() {
  const access = useAccess();

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

  return (
    <BrowserRouter>
      <div className="appShell">
        <SideNav />
        <div className="mainColumn">
          <UserTopBar />
          <main className="content contentMain appMain">
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/red-flags" element={<RedFlagsPage />} />
              <Route path="/overall" element={<OverallPage />} />
              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

function UserTopBar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user?.email) return null;

  return (
    <header className="topBar">
      <span className="topBarSignedIn">
        Signed in as <strong>{user.email}</strong>
      </span>
      <button
        type="button"
        className="topBarSignOut"
        onClick={async () => {
          await signOut();
          navigate('/login', { replace: true });
        }}
      >
        Sign out
      </button>
    </header>
  );
}

function AppRoutes() {
  const { user } = useAuth();

  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <AccessProvider userEmail={user.email}>
      <ProtectedShell />
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
