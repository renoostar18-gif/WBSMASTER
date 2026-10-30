import type { ReactNode } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { DEMO } from './api.js';
import { I18nProvider } from './i18n.js';
import { AuditPage } from './pages/Audit.js';
import { AuthPage } from './pages/Auth.js';
import { BillingPage } from './pages/Billing.js';
import { InvitePage } from './pages/Invite.js';
import { MembersPage } from './pages/Members.js';
import { PortfolioPage } from './pages/Portfolio.js';
import { ProjectsPage } from './pages/Projects.js';
import { SettingsPage } from './pages/Settings.js';
import { safeNext } from './next.js';
import { ProjectPage } from './project/ProjectPage.js';
import { SessionProvider, useSession } from './session.js';
import { ToastProvider } from './ui.js';

function Private({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return null;
  return me ? <>{children}</> : <Navigate to="/signin" replace />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const next = new URLSearchParams(useLocation().search).get('next');
  if (loading) return null;
  // signed in: go where the sign-in was for (an invitation), only within this site
  return me ? <Navigate to={safeNext(next)} replace /> : <>{children}</>;
}

// the demo runs inside a framed page whose address it cannot change, so it keeps routes in memory
const Router = DEMO ? MemoryRouter : BrowserRouter;

export function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <ToastProvider>
          <Router>
            <Routes>
              <Route path="/signin" element={<PublicOnly><AuthPage mode="signin" /></PublicOnly>} />
              <Route path="/signup" element={<PublicOnly><AuthPage mode="signup" /></PublicOnly>} />
              <Route path="/" element={<Private><ProjectsPage /></Private>} />
              <Route path="/p/:projectId" element={<Private><ProjectPage /></Private>} />
              <Route path="/portfolio/:orgId" element={<Private><PortfolioPage /></Private>} />
              <Route path="/settings" element={<Private><SettingsPage /></Private>} />
              <Route path="/billing/:orgId" element={<Private><BillingPage /></Private>} />
              <Route path="/members/:orgId" element={<Private><MembersPage /></Private>} />
              <Route path="/audit/:orgId" element={<Private><AuditPage /></Private>} />
              <Route path="/invite/:token" element={<InvitePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Router>
        </ToastProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
