// 10 The Project Summary
const fs = require('fs'), path = require('path');
module.exports = { opts: { seed: 'ls_linked' }, run: async s => {
  const v = y => s.ev(t => document.getElementById('view').scrollTo({ top: t, behavior: 'smooth' }), y);
  const toSec = async t => { await s.ev(t => { const h = [...document.querySelectorAll('#view .sec h2')].find(x => x.textContent.includes(t)); const v = document.getElementById('view'); v.scrollTo({ top: h.closest('.sec').getBoundingClientRect().top + v.scrollTop - 160, behavior: 'smooth' }); }, t); await s.wait(1); };
  await s.beat(0, async () => { await s.click('#segView button[data-v=summary]'); await s.wait(.6); await s.zoom([960, 400], { scale: 1.25 }); });
  await s.beat(1, async () => { await s.unzoom(); await s.zoom('.kpis', { scale: 1.55 }); const k = '.kpis .kpi'; for (let i = 0; i < 4; i++) { await s.callout(`${k} >> nth=${i}`, { n: i + 1 }); await s.wait(.9); } });
  await s.beat(2, async () => { await s.clear(); await s.unzoom(); await s.zoom('#sNarr', { scale: 1.5, fy: .2 }); await s.click('#sAuto', { sound: 'pop' }); await s.wait(1.6); await s.click('#sNarr', { fy: .95 }); await s.page.keyboard.press('Control+End'); await s.type(' Recovery plan to be presented on Thursday.', { delay: 35 }); });
  await s.beat(3, async () => { await s.clear(); await s.unzoom(); await toSec('Status by WBS element'); await s.zoom('#view .sec:has(h2:has-text("Status by WBS element"))', { scale: 1.3 }); await s.click('#segLv button:nth-child(2)'); await s.wait(1.5); await s.click('#segLv button:nth-child(1)'); });
  await s.beat(4, async () => { await s.unzoom(); for (const t of ['Critical path', 'Delayed', 'Coming up', 'Milestones', 'Baseline history']) { await toSec(t); await s.wait(.6); } });
  await s.beat(5, async () => { const sel = '[data-sum="achievements"]'; await s.ev(() => { const el = document.querySelector('[data-sum="achievements"]'); const v = document.getElementById('view'); v.scrollTo({ top: el.getBoundingClientRect().top + v.scrollTop - 200, behavior: 'smooth' }); }); await s.wait(1);
    await s.zoom(sel, { scale: 1.5, fx: 1 }); for (const k of ['achievements', 'next', 'risks']) { await s.click(`[data-fill="${k}"]`, { sound: 'pop' }); await s.wait(.8); }
    await s.click('[data-sum="decisions"]'); await s.type('Approve weekend shifts at the test lab.', { delay: 35 }); });
  await s.beat(6, async () => { await s.unzoom(); await v(0); await s.wait(.8); await s.zoom('#sCopy', { scale: 2.2, fx: 0 }); await s.click('#sCopy', { sound: 'pop' }); await s.wait(1.2); await s.click('#sDl');
    await s.wait(1.2); await s.unzoom(); const f = fs.readdirSync(s.dir).find(x => x.endsWith('.html')); if (f) { await s.ev(([t, h]) => window.__ov.preview(t, h), [f, fs.readFileSync(path.join(s.dir, f), 'utf8')]); s.sfx('pop'); await s.wait(2); await s.ev(() => window.__ov.scrollPreview(700)); } });
  await s.wait(1); await s.clear(); await s.wait(.4);
} };
