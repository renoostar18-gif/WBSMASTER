import { useEffect } from 'react';
import { useI18n } from '../i18n.js';
import { SiteFooter, SiteHeader, jump } from './chrome.js';
import { SITE_COPY } from './copy.js';
import { LEGAL_AR } from './legal.ar.js';
import { LEGAL_EN } from './legal.en.js';

/** Terms of Service or Privacy Policy, in the reader's language. Both are drafts until a lawyer has reviewed them. */
export function LegalPage({ doc }: { doc: 'terms' | 'privacy' }) {
  const { locale, setLocale } = useI18n();
  const c = SITE_COPY[locale].legal;
  const d = (locale === 'ar' ? LEGAL_AR : LEGAL_EN)[doc];
  useEffect(() => {
    document.title = `${d.title} · WBS Master`;
    return () => { document.title = 'WBS Master'; };
  }, [d]);
  useEffect(() => { window.scrollTo(0, 0); }, [doc]);

  return (
    <div className="site">
      <SiteHeader />
      <main className="site-in legal">
        <p className="draft" role="note">{c.draft}</p>
        <h1>{d.title}</h1>
        <p className="muted small">
          {c.updated} · <button type="button" className="linkish" lang={locale === 'ar' ? 'en' : 'ar'} onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{c.otherLang}</button>
        </p>
        <div className="legal-intro">{d.intro}</div>
        <nav className="toc" aria-label={c.contents}>
          <h2>{c.contents}</h2>
          <ol>{d.sections.map(s => <li key={s.id}><a href={`#${s.id}`} onClick={jump(s.id)}>{s.h}</a></li>)}</ol>
        </nav>
        {d.sections.map((s, i) => (
          <section key={s.id} id={s.id}>
            <h2><span className="num">{i + 1}.</span> {s.h}</h2>
            {s.body}
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
