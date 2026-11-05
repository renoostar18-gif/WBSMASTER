// 04 Importing from Excel
const path = require('path'); const { html } = require('../sheets');
const FILE = path.join(__dirname, '../../data/Substation Upgrade - Task List.xlsx');
module.exports = { opts: { seed: 'ls_rmu' }, run: async s => {
  await s.beat(0, async () => { await s.wait(.3); await s.ev(h => window.__ov.sheet(h), html(FILE, 'Tasks', { hdr: 3, maxCols: 7 })); s.sfx('pop'); await s.wait(1.2); await s.zoom([520, 330], { scale: 1.5 }); await s.wait(2.2); await s.unzoom(); });
  await s.beat(1, async () => { await s.clear(); await s.click('#bImport'); await s.wait(.5); await s.hover('#dz'); await s.ev(() => document.getElementById('dz').classList.add('over')); await s.wait(1.2);
    await s.page.setInputFiles('#fileIn', FILE); s.sfx('pop'); await s.ev(() => document.getElementById('dz').classList.remove('over')); await s.wait(1); });
  await s.beat(2, async () => { await s.zoom('.modal .map', { scale: 1.65, fy: .45 }); await s.callout('#mName', { n: 1, label: 'Item name → Task' }); await s.hover('#mName'); await s.wait(1.6);
    for (const id of ['#mOwner', '#mFS', '#mFE', '#mProg', '#mNotes']) { await s.hover(id); await s.wait(.45); } await s.callout('#mDeps', { n: 2, label: 'Set any that were missed', pos: 'below-right' }); });
  await s.beat(3, async () => { await s.clear(); await s.callout('#mHdr', { n: 3, label: 'Header row (title block above)' }); await s.hover('#mHdr'); });
  await s.beat(4, async () => { await s.clear(); await s.zoom('.hier', { scale: 1.7 }); await s.callout('#hMode', { n: 4, label: '2 levels · Suggested', pos: 'below' }); await s.hover('#hMode button:nth-child(4)'); });
  await s.beat(5, async () => { await s.clear(); await s.callout('#hG1', { n: 5, label: 'Each Phase becomes Level 1', pos: 'right' }); await s.hover('#hG1'); await s.wait(2.5); await s.zoom('#hHint', { scale: 2 }); });
  await s.beat(6, async () => { await s.clear(); await s.zoom('#mPrev', { scale: 1.45 }); await s.callout('#mPrev', { n: 6, label: 'Preview — exactly as it will be built', pos: 'above', teal: true }); await s.hover('#mPrev', .3, .5);
    for (let y = 0; y <= 600; y += 30) { await s.ev(v => document.getElementById('mPrev').scrollTop = v, y); await s.wait(.08); } });
  await s.beat(7, async () => { await s.clear(); await s.unzoom(); await s.zoom('.modal .radios', { scale: 1.8, fx: .9 }); await s.callout('.modal .radios', { n: 7 }); await s.hover('input[name=mMode][value=append]'); await s.wait(1); await s.hover('input[name=mMode][value=new]'); await s.wait(.6); await s.clear(); await s.unzoom(); await s.click('#impGo', { sound: 'pop' }); });
  await s.beat(8, async () => { s.sfx('chime'); await s.wait(.5); await s.zoom([700, 400], { scale: 1.3 }); await s.wait(2.2); await s.zoom('#projName', { scale: 2.2 }); await s.wait(1.8); await s.unzoom(); await s.click('.box:has-text("Protection coordination study")'); await s.zoom('#insp', { scale: 1.8, fy: .32 }); });
  await s.unzoom(); await s.wait(.5);
} };
