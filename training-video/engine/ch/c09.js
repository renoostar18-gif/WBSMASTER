// 09 The Gantt view
const row = id => `.g-row[data-id="${id}"]`;
module.exports = { opts: { seed: 'ls_linked' }, run: async s => {
  await s.beat(0, async () => { await s.click('#segView button[data-v=gantt]'); await s.wait(.4); await s.zoom('#segScale', { scale: 2.4, fx: .8 }); for (const k of ['day', 'week', 'month']) { await s.click(`#segScale button[data-s=${k}]`); await s.wait(.7); } await s.unzoom(); await s.click('#segScale button[data-s=quarter]'); await s.wait(.6); });
  await s.beat(1, async () => { await s.click('#segScale button[data-s=week]'); await s.wait(.4); const id = await s.idOf('Busbar & insulation', '.g-row'); const b = await s.box(`[data-bar="${id}"]`); await s.zoom([b.x + b.width / 2, b.y + 14], { scale: 2.6 });
    await s.callout([b.x, b.y, b.width * .8, b.height], { label: 'Forecast · solid = % done', pos: 'above' }); await s.wait(1.8); await s.callout(`${row(id)} .bl`, { label: 'Baseline', pos: 'below' }); await s.wait(1.6); await s.callout(`${row(id)} .act`, { n: '—' }); });
  await s.beat(2, async () => { await s.clear(); await s.unzoom(); await s.click('#segScale button[data-s=month]'); await s.wait(.4); const p = await s.idOf('Prototype & Type Test', '.g-row'); await s.callout(`${row(p)} .sum`, { label: 'Summary bar', pos: 'above' }); await s.wait(1.2);
    const c = await s.idOf('Type test certificate', '.g-row'); await s.callout(`${row(c)} .msk`, { label: 'Milestone', pos: 'right' }); await s.wait(1.2); await s.callout('.g-bg .today', { label: 'Today', pos: 'right' }); await s.wait(1.2); await s.clear(); await s.click('#segScale button[data-s=week]'); await s.zoom([1000, 480], { scale: 1.6 }); });
  await s.beat(3, async () => { await s.unzoom(); const id = await s.idOf('Pilot production run', '.g-row'); await s.ev(i => document.querySelector(`[data-bar="${i}"]`).scrollIntoView({ block: 'center', inline: 'center' }), id); await s.wait(.4);
    const bar = `[data-bar="${id}"]`; let b = await s.box(bar); await s.zoom([b.x + b.width / 2, b.y + 30], { scale: 1.7 });
    await s.drag([b.x + b.width * .5, b.y + b.height / 2], [b.x + b.width * .5 + 70, b.y + b.height / 2], { steps: 45, hold: 700 }); await s.wait(.5); b = await s.box(bar);
    await s.drag([b.x + b.width - 2, b.y + b.height / 2], [b.x + b.width + 60, b.y + b.height / 2], { steps: 40, hold: 700 }); });
  await s.beat(4, async () => { await s.unzoom(); await s.zoom('#gScale', { scale: 2.4, fx: .7 }); await s.click('#cBase'); await s.wait(1); await s.click('#cBase'); await s.wait(.6); await s.click('#cCrit'); await s.wait(1); await s.click('#cCrit'); await s.unzoom(); });
  await s.beat(5, async () => { const id = await s.idOf('Project Management', '.g-row'); await s.click(row(id) + ' .g-left'); await s.press('Tab'); await s.wait(.5); await s.type('Lessons learned review'); await s.press('Enter', { badge: false });
    const nid = await s.idOf('Lessons learned review', '.g-row'); await s.ev(i => document.querySelector(`.g-row[data-id="${i}"] .nodate`)?.scrollIntoView({ block: 'center', inline: 'center' }), nid); await s.wait(.3); await s.zoom(row(nid) + ' .nodate', { scale: 2.2 }); await s.wait(1.5); await s.click(row(nid) + ' .g-track', { fx: .55 }); s.sfx('pop'); });
  await s.beat(6, async () => { await s.unzoom(); await s.ev(() => document.querySelector('.legend').scrollIntoView({ block: 'center', inline: 'start' })); await s.wait(.6); await s.zoom('.legend', { scale: 2 }); await s.callout('.legend', {}); });
  await s.clear(); await s.unzoom(); await s.wait(.5);
} };
