import type { ReactNode } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DEMO } from './api.js';
import { I18nProvider } from './i18n.js';
import { AuthPage } from './pages/Auth.js';
import { PortfolioPage } from './pages/Portfolio.js';
import { ProjectsPage } from './pages/Projects.js';
import { SettingsPage } from './pages/Settings.js';
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
  if (loading) return null;
  return me ? <Navigate to="/" replace /> : <>{children}</>;
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Router>
        </ToastProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
