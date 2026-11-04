const { chromium } = require('playwright'); const fs = require('fs');
const KEY = 'wbs.projects.v1';
(async () => {
  const base = JSON.parse(fs.readFileSync('data/ls_base.json'));
  const all = JSON.parse(base[KEY]); const ids = Object.keys(all);
  const rmuId = ids.find(i => /RMU/.test(all[i].name)), subId = ids.find(i => /Substation/.test(all[i].name));
  const put = (name, projs, last) => fs.writeFileSync(`data/${name}.json`, JSON.stringify({ [KEY]: JSON.stringify(projs), 'wbs.last': last, 'wbs.view': 'visual' }));
  put('ls_rmu', { [rmuId]: all[rmuId] }, rmuId);
  // linked: drive the app to chain + auto-link the RMU plan
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  await ctx.addInitScript(s => { if (!sessionStorage.__seeded) { const o = JSON.parse(s); for (const k in o) localStorage.setItem(k, o[k]); sessionStorage.__seeded = 1; } }, fs.readFileSync('data/ls_rmu.json', 'utf8'));
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500);
  await p.click('.box:has-text("Prototype & Type Test")'); await p.click('#aLink'); await p.click('#linkMenu [data-m=chain]'); await p.waitForTimeout(400);
  await p.click('#aLink'); await p.click('#linkMenu [data-m=auto]'); await p.waitForTimeout(600);
  console.log('toast:', await p.textContent('#toast'));
  await p.waitForTimeout(2000);
  const ls = JSON.parse(await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))));
  await b.close();
  const linked = JSON.parse(ls[KEY])[rmuId]; console.log('links', linked.nodes.reduce((a, n) => a + n.deps.length, 0));
  put('ls_linked', { [rmuId]: linked }, rmuId);
  // portfolio: linked RMU + substation + two more, with commentary and trend history
  const shift = (s, d) => { if (!s) return s; const t = new Date(s + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
  const rid = () => Math.random().toString(36).slice(2, 10);
  const clone = (src, name, days, prog) => { const map = {}; const nodes = src.nodes.map(n => { const id = rid(); map[n.id] = id; return { ...n, id }; });
    nodes.forEach(n => { n.parent = n.parent ? map[n.parent] : null; n.deps = (n.deps || []).map(d => ({ id: map[d.id], lag: d.lag })); for (const f of ['bStart', 'bEnd', 'start', 'end', 'aStart', 'aEnd']) n[f] = shift(n[f], days); if (prog) prog(n); });
    return { ...src, name, nodes, summary: {}, baselines: (src.baselines || []).map(bl => ({ ...bl, id: 'b' + rid(), d: bl.d.filter(x => map[x[0]]).map(x => [map[x[0]], x[1] + days, x[2] + days]) })), updatedAt: Date.now() - 86400e3 * 2 }; };
  const hist = vrs => vrs.map((vr, i) => ({ d: shift('2026-11-04', -7 * (vrs.length - 1 - i)), p: 10 + i * 4, pp: 12 + i * 5, vr }));
  const rmu = { ...linked, summary: { ...linked.summary, decisions: 'Approve weekend shifts at the test lab to recover the type-test slot.', risks: 'Insulation supplier data is late; busbar design sign-off may slip again.', achievements: 'Single-line diagram and enclosure 3D model completed.' }, history: hist([0, 2, 5, 7, 9, 12, 14, 14]) };
  const vcb = clone(linked, '36 kV Vacuum Circuit Breaker development', -40, n => { if (n.aStart && !n.aEnd && n.progress) n.progress = Math.min(100, n.progress + 10); }); vcb.history = hist([3, 3, 2, 1, 1, 0, 0, 0]);
  const sub = { ...all[subId], history: hist([0, 0, 0, 0, 1, 1, 2, 3]) };
  const erp = clone(all[subId], 'ERP roll-out — Finance', -70, n => { if (n.end && n.end < '2026-11-04' && !n.aEnd) { n.aStart = n.start; n.aEnd = n.end; n.progress = 100; } });
  erp.nodes.forEach(n => { n.name = n.name.replace('Engineering', 'Design').replace('Procurement', 'Build').replace('Construction', 'Data migration').replace('Testing & Commissioning', 'Testing').replace('Handover', 'Go-live'); });
  const g = erp.nodes.find(n => /Pre-commissioning/.test(n.name)); if (g) { g.name = 'User acceptance testing'; g.end = shift(g.end, 21); }
  erp.history = hist([0, 0, 4, 6, 10, 15, 19, 21]);
  const pid = () => 'p' + rid();
  const pf = { [rmuId]: rmu, [subId]: sub, [pid()]: vcb, [pid()]: erp };
  put('ls_portfolio', pf, rmuId); console.log('portfolio', Object.values(pf).map(x => x.name));
})();
