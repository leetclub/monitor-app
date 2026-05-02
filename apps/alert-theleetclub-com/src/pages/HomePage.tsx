import { Link } from 'react-router-dom';
import { useAccess } from '@/context/AccessContext';

export function HomePage() {
  const { canSeeTab } = useAccess();
  const showAdmin = canSeeTab('leetAlertAdmin');

  return (
    <div className="pageShell protoHome">
      <header className="protoHomeHero">
        <p className="protoHomeEyebrow">Leet Alert</p>
        <h1 className="protoHomeTitle">Choose a workspace</h1>
        <p className="protoHomeLead">
          Live machine data. Lists refresh about once a minute — use <strong>Refresh</strong> on each screen for an
          immediate update.
        </p>
      </header>

      <ul className="protoCardGrid" aria-label="Main areas">
        <li>
          <Link to="/red-flags" className="protoCard protoCardAccent">
            <span className="protoCardKicker">Priority</span>
            <span className="protoCardTitle">Red Flags</span>
            <span className="protoCardBody">Machines failing checks — start here for visits.</span>
            <span className="protoCardAction">Continue</span>
          </Link>
        </li>
        <li>
          <Link to="/overall" className="protoCard">
            <span className="protoCardKicker">Fleet</span>
            <span className="protoCardTitle">Overall</span>
            <span className="protoCardBody">All machines and roll-up KPIs when connected.</span>
            <span className="protoCardAction">Continue</span>
          </Link>
        </li>
        {showAdmin ? (
          <li>
            <Link to="/admin" className="protoCard">
              <span className="protoCardKicker">Configuration</span>
              <span className="protoCardTitle">Admin</span>
              <span className="protoCardBody">Machines, access, and advanced options.</span>
              <span className="protoCardAction">Continue</span>
            </Link>
          </li>
        ) : null}
      </ul>

      <p className="protoHomeFoot muted">Questions about access? Contact your organization administrator.</p>
    </div>
  );
}
