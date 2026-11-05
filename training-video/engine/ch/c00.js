// Cold open: a fast tour of the finished result
module.exports = { opts: { seed: 'ls_portfolio' }, run: async s => {
  await s.ev(() => window.__ov.show(false));
  await s.beat(0, async () => { await s.zoom([700, 420], { scale: 1.35, dur: .01 }); await s.wait(.2); await s.zoom([1100, 520], { scale: 1.2, dur: 5.5 }); await s.wait(3.2); await s.click('#segView button[data-v=table]', { sound: 'none' }); });
  await s.beat(1, async () => { await s.click('#segView button[data-v=gantt]', { sound: 'none' }); await s.unzoom(.01); await s.page.check('#cCrit'); await s.wait(.3); await s.zoom([900, 560], { scale: 1.3, dur: 4 }); await s.wait(3.2); await s.click('#segView button[data-v=summary]', { sound: 'none' }); await s.unzoom(.01); await s.zoom([960, 380], { scale: 1.25, dur: 3 }); });
  await s.beat(2, async () => { await s.click('#segView button[data-v=portfolio]', { sound: 'none' }); await s.unzoom(.01); await s.wait(1.2); await s.ev(() => document.getElementById('view').scrollTo({ top: 600, behavior: 'smooth' })); await s.zoom([960, 560], { scale: 1.15, dur: 4 }); });
} };
