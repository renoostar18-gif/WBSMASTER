import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.js';
import { useSession } from '../session.js';
import { TopBar } from '../ui.js';
import { SITE_COPY } from './copy.js';

/** Scroll to a section of the page without changing the route (also works in the in-memory demo router). */
export const jump = (id: string) => (e: MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** Puts elements in a sentence: fill('Agree to the {terms}.', { terms: <a/> }). */
export function fill(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/\{(\w+)\}/).map((s, i) => <Fragment key={i}>{i % 2 ? parts[s] : s}</Fragment>);
}

/** Top bar of the public pages: the app's bar, with sign-in / start buttons for visitors. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  const { locale } = useI18n();
  const { me } = useSession();
  const c = SITE_COPY[locale].nav;
  return (
    <TopBar end={me ? <Link className="btn primary" to="/">{c.projects}</Link> : (
      <>
        <Link className="btn site-signin" to="/signin">{c.signIn}</Link>
        <Link className="btn primary" to="/signup">{c.start}</Link>
      </>
    )}>
      {children}
    </TopBar>
  );
}

export function SiteFooter() {
  const { locale } = useI18n();
  const c = SITE_COPY[locale];
  const f = c.footer;
  return (
    <footer className="site-foot">
      <div className="site-in foot-cols">
        <div className="foot-brand">
          <Link className="mark" to="/"><i><b /><b /><b /><b /></i>WBS Master</Link>
          <p className="muted">{f.tagline}</p>
          <p className="muted foot-ksa">{f.hosted}</p>
        </div>
        <nav aria-label={f.product}>
          <h2>{f.product}</h2>
          <Link to="/pricing">{c.nav.pricing}</Link>
          <Link to="/signin">{c.nav.signIn}</Link>
          <Link to="/signup">{c.nav.start}</Link>
        </nav>
        <nav aria-label={f.legal}>
          <h2>{f.legal}</h2>
          <Link to="/terms">{f.terms}</Link>
          <Link to="/privacy">{f.privacy}</Link>
        </nav>
        <div>
          <h2>{f.contact}</h2>
          <span>{f.email}</span>
          <span className="muted">{f.company}</span>
        </div>
      </div>
      <div className="site-in foot-base muted">© {new Date().getFullYear()} {locale === 'ar' ? 'ريشة' : 'Raysha'}</div>
    </footer>
  );
}
