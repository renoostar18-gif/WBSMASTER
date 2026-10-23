import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, type Me, api } from './api.js';

export type Theme = 'auto' | 'light' | 'dark';

interface Session {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<Session | null>(null);

function applyTheme(t: Theme) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<Theme>(() => {
    try { const v = localStorage.getItem('wbs.theme'); if (v === 'light' || v === 'dark' || v === 'auto') return v; } catch { /* blocked */ }
    return 'auto';
  });
  useEffect(() => applyTheme(theme), [theme]);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh().catch(() => setLoading(false)); }, [refresh]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setMe(null);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem('wbs.theme', t); } catch { /* blocked */ }
    api.patch('/me', { theme: t }).catch(() => {});
  }, []);

  return <Ctx.Provider value={{ me, loading, refresh, signOut, theme, setTheme }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
