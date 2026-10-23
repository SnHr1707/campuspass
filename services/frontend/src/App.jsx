import { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './session';
import EventsPage from './pages/EventsPage';
import TicketsPage from './pages/TicketsPage';
import LoginPage from './pages/LoginPage';
// Staff-only pages load on demand, so students never download the QR scanner.
const GatePage = lazy(() => import('./pages/GatePage'));
const OrganisePage = lazy(() => import('./pages/OrganisePage'));

function RequireRole({ roles, children }) {
  const { user } = useSession();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, signOut } = useSession();
  const staff = user && ['volunteer', 'organiser'].includes(user.role);

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="wordmark" aria-label="CampusPass home">
          <span className="wordmark-stub" aria-hidden="true" />
          CampusPass
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Events</NavLink>
          {user && <NavLink to="/tickets">My tickets</NavLink>}
          {staff && <NavLink to="/gate">Gate check-in</NavLink>}
          {user?.role === 'organiser' && <NavLink to="/organise">Organise</NavLink>}
          {user ? (
            <button type="button" className="link-button" onClick={signOut}>
              Log out
            </button>
          ) : (
            <NavLink to="/login">Log in</NavLink>
          )}
        </nav>
      </header>

      <main className="page">
        <Suspense fallback={<p className="notice">Loading…</p>}>
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/tickets" element={<RequireRole><TicketsPage /></RequireRole>} />
          <Route path="/gate" element={<RequireRole roles={['volunteer', 'organiser']}><GatePage /></RequireRole>} />
          <Route path="/organise" element={<RequireRole roles={['organiser']}><OrganisePage /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      <footer className="footer">
        <span>CampusPass, a cloud-native ticketing demo for 4CS505ME25.</span>
        <span className="footer-version">build {import.meta.env.VITE_BUILD_SHA || 'local'}</span>
      </footer>
    </div>
  );
}
