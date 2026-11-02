import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.js';
import { SiteFooter, SiteHeader, jump } from './chrome.js';
import { SITE_COPY, type SiteCopy, sar } from './copy.js';
import { SITE_PRICES } from './pricing.js';

type Interval = 'month' | 'year';
type Health = 'green' | 'amber' | 'red' | 'none';

/** The illustration's rows: level, health, baseline and forecast as % of the six-month timeline. */
const MOCK_ROWS: { code: string; lv: 1 | 2; h: Health; plan: [number, number]; fc: [number, number]; crit?: boolean; ms?: boolean }[] = [
  { code: '1', lv: 1, h: 'green', plan: [2, 40], fc: [2, 40] },
  { code: '1.1', lv: 2, h: 'green', plan: [2, 24], fc: [2, 24] },
  { code: '1.2', lv: 2, h: 'amber', plan: [16, 40], fc: [18, 44] },
  { code: '2', lv: 1, h: 'amber', plan: [30, 70], fc: [32, 76] },
  { code: '2.1', lv: 2, h: 'red', plan: [30, 62], fc: [36, 72], crit: true },
  { code: '3', lv: 1, h: 'none', plan: [64, 92], fc: [72, 96] },
  { code: '3.1', lv: 2, h: 'none', plan: [90, 90], fc: [92, 92], crit: true, ms: true },
];
const TODAY = 47;

const span = ([a, b]: [number, number]) => ({ insetInlineStart: `${a}%`, width: `${b - a}%` });

function WbsMock({ c }: { c: SiteCopy['mock'] }) {
  return (
    <figure className="mock" aria-label={c.label}>
      <div className="mock-bar" aria-hidden="true">
        <span className="mock-dots"><i /><i /><i /></span>
        <b>{c.project}</b>
        <span className="sp" />
        <span className="mock-seg">{c.views.map((v, i) => <span key={v} className={i === 2 ? 'on' : ''}>{v}</span>)}</span>
      </div>
      <div className="mock-grid" aria-hidden="true" style={{ ['--today' as string]: `${TODAY}%` }}>
        <div className="mock-head mock-l"><span className="mono">{c.cols[0]}</span><span>{c.cols[1]}</span><span className="mock-hl">{c.cols[2]}</span></div>
        <div className="mock-head mock-scale">{c.months.map(m => <span key={m}>{m}</span>)}<em>{c.today}</em></div>
        {MOCK_ROWS.map((r, i) => (
          <div key={r.code} className={`mock-row lv${r.lv === 1 ? 1 : 2}${r.lv === 1 ? ' parent' : ''}`}>
            <div className="mock-l">
              <span className="mono code">{r.code}</span>
              <span className="nm">{c.rows[i]}</span>
              <span className="mock-hl"><span className={`dot ${r.h === 'none' ? '' : r.h}`} /><span className="hl-t">{c.health[r.h]}</span></span>
            </div>
            <div className="mock-track">
              {!r.ms && <span className="mb-plan" style={span(r.plan)} />}
              {r.ms
                ? <span className={`mb-ms${r.crit ? ' crit' : ''}`} style={{ insetInlineStart: `${r.fc[0]}%` }} />
                : <span className={`mb-fc h-${r.h}${r.lv === 1 ? ' sum' : ''}${r.crit ? ' crit' : ''}`} style={span(r.fc)} />}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mock-legend" aria-hidden="true">
        <span><i className="mk-plan" />{c.legend.plan}</span>
        <span><i className="mk-crit" />{c.legend.crit}</span>
        <span><i className="dot green" />{c.health.green}</span>
        <span><i className="dot amber" />{c.health.amber}</span>
        <span><i className="dot red" />{c.health.red}</span>
      </figcaption>
    </figure>
  );
}

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const FEATURE_ICONS: ReactNode[] = [
  <svg viewBox="0 0 24 24" {...S}><rect x="9" y="3" width="6" height="4" rx="1" /><rect x="2.5" y="16" width="6" height="4" rx="1" /><rect x="15.5" y="16" width="6" height="4" rx="1" /><path d="M12 7v4.5M5.5 16v-2.5h13V16" /></svg>,
  <svg viewBox="0 0 24 24" {...S}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4M7 13h2M11 13h2M15 13h2M7 16.5h2M11 16.5h2" /></svg>,
  <svg viewBox="0 0 24 24" {...S} className="flip"><path d="M3 19h18" /><path d="M5 15h8" /><path d="M7 11h10" /><path d="M9 7h10" /><path d="M14 3v18" strokeDasharray="2 2" /></svg>,
  <svg viewBox="0 0 24 24" {...S}><path d="M3 20h18" /><path d="M6 16v-5M10.5 16V6M15 16v-7M19.5 16V4" /></svg>,
  <svg viewBox="0 0 24 24" {...S}><path d="M4 5h16v10h-8l-4.5 4v-4H4z" /><path d="M8.5 9.5h7M8.5 12h4" /></svg>,
  <svg viewBox="0 0 24 24" {...S}><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4M10 12l4 4M14 12l-4 4" /><path d="M3.5 9v7M2 14.5l1.5 1.5 1.5-1.5" /></svg>,
];

function Pricing({ c, locale }: { c: SiteCopy['pricing']; locale: 'en' | 'ar' }) {
  const [interval, setInterval] = useState<Interval>('month');
  const paid = (['team', 'business'] as const);
  return (
    <section id="pricing" className="site-sec" aria-labelledby="pricing-h">
      <div className="site-in">
        <div className="site-head">
          <h2 id="pricing-h">{c.title}</h2>
          <p className="muted">{c.lead}</p>
          <div className="seg bill-toggle" role="group" aria-label={`${c.monthly} / ${c.yearly}`}>
            <button type="button" aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>{c.monthly}</button>
            <button type="button" aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>{c.yearly} <span className="save">{c.save}</span></button>
          </div>
        </div>
        <div className="price-grid">
          <article className="price-card" data-plan="free">
            <h3>{c.plans.free.name}</h3>
            <p className="muted tag">{c.plans.free.tag}</p>
            <div className="amount"><b>{c.free}</b></div>
            <p className="muted billed">{c.freeSub}</p>
            <Link className="btn wide" to="/signup">{c.startFree}</Link>
            <ul className="ticks">{c.features.free.map(f => <li key={f}>{f}</li>)}</ul>
          </article>
          {paid.map(p => (
            <article key={p} className={`price-card${p === 'team' ? ' featured' : ''}`} data-plan={p}>
              {p === 'team' && <span className="rec-tag">{c.popular}</span>}
              <h3>{c.plans[p].name}</h3>
              <p className="muted tag">{c.plans[p].tag}</p>
              <div className="amount"><b data-testid={`price-${p}`}>{sar(locale, SITE_PRICES[p][interval])}</b> <span className="muted">{c.perUser}</span></div>
              <p className="muted billed">{interval === 'year' ? c.billedYearly.replace('{amount}', sar(locale, SITE_PRICES[p].year * 12)) : c.billedMonthly}</p>
              <Link className={`btn wide${p === 'team' ? ' primary' : ''}`} to="/signup">{c.startTrial}</Link>
              <p className="trial">{c.trial}</p>
              <ul className="ticks">{c.features[p].map((f, i) => <li key={f} className={i === 0 ? 'lead' : ''}>{f}</li>)}</ul>
            </article>
          ))}
        </div>
        <p className="price-notes muted"><b>{c.exVat}</b> {c.payNote}</p>
      </div>
    </section>
  );
}

/** The public home page for visitors who are not signed in: what it is, pricing and questions. */
export function LandingPage({ section }: { section?: 'pricing' }) {
  const { locale } = useI18n();
  const c = SITE_COPY[locale];
  useEffect(() => {
    document.title = c.metaTitle;
    return () => { document.title = 'WBS Master'; };
  }, [c]);
  useEffect(() => { if (section) document.getElementById(section)?.scrollIntoView(); }, [section]);

  return (
    <div className="site">
      <SiteHeader>
        <nav className="site-nav" aria-label="WBS Master">
          <a href="#features" onClick={jump('features')}>{c.nav.features}</a>
          <a href="#pricing" onClick={jump('pricing')}>{c.nav.pricing}</a>
          <a href="#faq" onClick={jump('faq')}>{c.nav.faq}</a>
        </nav>
      </SiteHeader>
      <main>
        <section className="hero">
          <div className="site-in hero-in">
            <div className="hero-copy">
              <p className="eyebrow">{c.hero.eyebrow}</p>
              <h1>{c.hero.title}</h1>
              <p className="lead">{c.hero.lead}</p>
              <div className="hero-cta">
                <Link className="btn primary big" to="/signup">{c.hero.primary}</Link>
                <a className="btn big" href="#pricing" onClick={jump('pricing')}>{c.hero.secondary}</a>
              </div>
              <p className="muted small">{c.hero.note}</p>
            </div>
            <WbsMock c={c.mock} />
          </div>
          <ul className="site-in facts">{c.facts.map(f => <li key={f}>{f}</li>)}</ul>
        </section>

        <section id="features" className="site-sec" aria-labelledby="features-h">
          <div className="site-in">
            <div className="site-head">
              <h2 id="features-h">{c.featuresTitle}</h2>
              <p className="muted">{c.featuresLead}</p>
            </div>
            <div className="feat-grid">
              {c.features.map((f, i) => (
                <article key={f.h} className="feat">
                  <span className="feat-ic" aria-hidden="true">{FEATURE_ICONS[i]}</span>
                  <h3>{f.h}</h3>
                  <p>{f.p}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-sec region" aria-labelledby="region-h">
          <div className="site-in">
            <h2 id="region-h">{c.regionTitle}</h2>
            <div className="region-grid">
              {c.region.map(r => <div key={r.h}><h3>{r.h}</h3><p>{r.p}</p></div>)}
            </div>
          </div>
        </section>

        <Pricing c={c.pricing} locale={locale} />

        <section id="faq" className="site-sec" aria-labelledby="faq-h">
          <div className="site-in narrow">
            <h2 id="faq-h">{c.faqTitle}</h2>
            <div className="faq">
              {c.faq.map(q => (
                <details key={q.q}>
                  <summary>{q.q}</summary>
                  <p>{q.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="site-sec cta-wrap">
          <div className="cta-band">
            <div>
              <h2>{c.cta.title}</h2>
              <p>{c.cta.lead}</p>
            </div>
            <Link className="btn big cta-btn" to="/signup">{c.cta.button}</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
