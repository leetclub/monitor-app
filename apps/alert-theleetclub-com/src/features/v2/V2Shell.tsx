import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NavIcon } from '@/components/NavIcon';
import { useAuth } from '@/context/AuthContext';
import { useAccess } from '@/context/AccessContext';
import { V2_NAV, v2PageMeta } from '@/features/v2/v2Nav';
import '@/features/v2/v2-theme.css';

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

export function V2Shell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { canSeeTab } = useAccess();
  const meta = v2PageMeta(location.pathname);
  const [clock, setClock] = useState(() => kuwaitClockLabel(new Date()));

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(kuwaitClockLabel(new Date())), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <div className="v2AppRoot" data-alert-shell="v2">
      {menuOpen ? (
        <button
          type="button"
          className="v2Backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        id="alert-v2-sidebar"
        className={`v2Sidebar ${menuOpen ? 'v2SidebarOpen' : ''}`}
        aria-label="Fleet navigation"
      >
        <div className="v2Brand">
          <div className="v2BrandMark" aria-hidden>
            <NavIcon name="performance" />
          </div>
          <div>
            <p className="v2BrandName">Leet Alert</p>
            <p className="v2BrandSub">Fleet intelligence</p>
          </div>
        </div>

        <nav className="v2Nav" aria-label="Operations">
          <p className="v2NavSection">Operations</p>
          {V2_NAV.map((item) => {
            if (item.adminOnly && !canSeeTab('leetAlertAdmin')) return null;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={`${item.title} — ${item.description}`}
                className={({ isActive }) => `v2NavLink ${isActive ? 'v2NavLinkActive' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                <NavIcon name={item.icon} />
                <span className="v2NavText">
                  <span className="v2NavTitle">{item.title}</span>
                  <span className="v2NavDesc">{item.description}</span>
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="v2SidebarFoot">
          <div className="v2Online">
            <span className="v2OnlineDot" aria-hidden />
            <div>
              <strong>Workspace online</strong>
              <span>Alert v2 · live fleet APIs</span>
            </div>
          </div>
          {user?.email ? (
            <div className="v2UserChip" title={user.email}>
              <NavIcon name="account_circle" />
              <span>{user.email}</span>
            </div>
          ) : null}
          <button type="button" className="v2ClassicLink" onClick={() => navigate('/red-flags')}>
            Open classic Alert →
          </button>
        </div>
      </aside>

      <div className="v2Main">
        <header className="v2Top">
          <div className="v2TopStart">
            <button
              type="button"
              className="v2MenuBtn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="alert-v2-sidebar"
              title={menuOpen ? 'Close menu' : 'Open menu'}
            >
              <NavIcon name={menuOpen ? 'panel_close' : 'menu'} />
            </button>
            <div>
              <p className="v2Breadcrumb">
                <span>Operations</span>
                <span aria-hidden> / </span>
                <span className="v2BreadcrumbActive">{meta.crumb}</span>
              </p>
              <h1 className="v2PageTitle">{meta.headline}</h1>
            </div>
          </div>
          <div className="v2TopEnd">
            <span className="v2Live" title="Live data">
              <span className="v2LiveDot" aria-hidden />
              Live
            </span>
            <span className="v2Clock" title="Kuwait time">
              {clock}
            </span>
            <button
              type="button"
              className="v2SignOut"
              onClick={async () => {
                await signOut();
                navigate('/v2/login', { replace: true, state: { signedOut: true } });
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="v2Content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
