// 01 What WBS Builder is
module.exports = { opts: { landing: true }, run: async s => {
  await s.beat(0, async () => { await s.wait(.6); await s.zoom('.hero', { scale: 1.25 }); await s.wait(1.6); await s.unzoom(); await s.callout('#hList', { n: 1, label: 'Your projects', pos: 'above', teal: true }); await s.wait(1); await s.callout('#hImport', { n: 2, label: 'Import Excel', pos: 'below' }); await s.wait(1); await s.callout('#hWatch', { n: 3, label: 'This training', pos: 'above' }); await s.hover('#hWatch'); await s.wait(1.4); await s.clear(); await s.click('#hOpen', { sound: 'pop' }); });
  await s.beat(1, async () => { await s.card({ pos: 'c', kicker: 'Private by design', title: 'Works offline', width: 680, items: [{ html: '<b class="sw" style="background:#138A3E"></b>Excel reader and writer built into the file' }, { html: '<b class="sw" style="background:#138A3E"></b>Nothing is sent to a server' }] }); });
  await s.beat(2, async () => { await s.clear(); await s.zoom('#status', { scale: 2.4 }); await s.callout('#status', { n: 1, label: 'Save status' }); await s.hover('#status'); });
  await s.beat(3, async () => {
    await s.clear(); await s.unzoom(); await s.callout('#banner', { label: 'The example project', teal: true }); await s.wait(2.2);
    await s.clear(); await s.zoom([600, 300], { scale: 1.5 }); await s.click('.box:has-text("Commercial Launch") .tg'); await s.wait(.8);
    await s.zoom([560, 40], { scale: 2.2 }); await s.wait(1.6); await s.callout('#status', { n: 1, label: 'Saved automatically' });
  });
  await s.beat(4, async () => { await s.clear(); await s.unzoom(); await s.click('.box:has-text("Commercial Launch") .tg'); await s.click('#bSync'); await s.wait(2.2); await s.click([900, 900]);
    await s.card({ pos: 'lt', kicker: 'Opened from its Claude link', title: 'Projects shared live', width: 640, items: [{ html: '<b class="sw" style="background:#138A3E"></b>Everyone with the link sees the same projects' }, { html: '<b class="sw" style="background:#138A3E"></b>Changes appear within seconds, with who made them' }] }); });
  await s.clear(); await s.wait(.4);
} };
