import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider } from './i18n.js';
import { AuthPage } from './pages/Auth.js';
import { ProjectsPage } from './pages/Projects.js';
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

export function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/signin" element={<PublicOnly><AuthPage mode="signin" /></PublicOnly>} />
              <Route path="/signup" element={<PublicOnly><AuthPage mode="signup" /></PublicOnly>} />
              <Route path="/" element={<Private><ProjectsPage /></Private>} />
              <Route path="/p/:projectId" element={<Private><ProjectPage /></Private>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
