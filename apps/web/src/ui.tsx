import type { Health } from '@wbs-master/engine';
import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type MessageKey, useI18n } from './i18n.js';
import { type Theme, useSession } from './session.js';

export function Pill({ health, title }: { health: Health; title?: string }) {
  const { t } = useI18n();
  return <span className={`pill ${health}`} title={title}>{t(`health_${health}` as MessageKey)}</span>;
}

/** Finish variance in working days: red when late, green when early. Always left-to-right. */
export function Var({ v }: { v: number | null }) {
  const { t } = useI18n();
  if (v == null) return <span className="var zero">—</span>;
  return <span className={`var ${v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero'}`} title={t('varianceLong')}>{v > 0 ? '+' : ''}{v}{t('daysShort')}</span>;
}

/** Marks an item another person has selected right now. */
export function Who({ names }: { names?: string[] }) {
  const { t } = useI18n();
  if (!names?.length) return null;
  return <span className="who" title={t('selectedBy', { names: names.join(', ') })}>{names.map(n => n.trim()[0]?.toUpperCase()).join('')}</span>;
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

const NEXT_THEME: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };

/** Top bar shared by every signed-in page. */
export function TopBar({ children }: { children?: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { me, signOut, theme, setTheme } = useSession();
  return (
    <header className="top wrap">
      <Link className="mark" to="/"><i><b /><b /><b /><b /></i>{t('app')}</Link>
      {children}
      <span className="sp" />
      {import.meta.env.MODE === 'demo' && (
        <span className="demo-chip" title={t('demoNote')}>
          {t('demo')}
          <button className="btn sm" onClick={async () => { (await import('./demo/server.js')).resetDemo(); location.reload(); }}>{t('demoReset')}</button>
        </span>
      )}
      <button className="btn" onClick={() => setTheme(NEXT_THEME[theme])} title={t('theme')}>{t(`theme_${theme}` as MessageKey)}</button>
      <button className="btn" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')} lang={locale === 'en' ? 'ar' : 'en'}>{t('language')}</button>
      {me && <button className="btn" onClick={signOut} title={me.user.email}>{t('signOut')}</button>}
    </header>
  );
}

export const Icon = {
  child: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flip"><path d="M4 2v8h4M11 7v6M8 10h6" /></svg>,
  sibling: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flip"><path d="M2 4h7M2 8h7M12 9v6M9 12h6" /></svg>,
  outdent: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flip"><path d="M7 4H14M7 8h7M7 12h7M5 6 2 8l3 2" /></svg>,
  indent: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flip"><path d="M7 4H14M7 8h7M7 12h7M2 6l3 2-3 2" /></svg>,
  up: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 13V3M4 7l4-4 4 4" /></svg>,
  down: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 3v10M4 9l4 4 4-4" /></svg>,
  del: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" /></svg>,
  undo: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flip"><path d="M5 3 2 6l3 3M2 6h7.5a4 4 0 0 1 0 8H6" /></svg>,
  redo: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flip"><path d="m11 3 3 3-3 3M14 6H6.5a4 4 0 0 0 0 8H10" /></svg>,
  gear: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>,
};
