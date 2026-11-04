// 03 Projects
module.exports = { opts: { seed: 'ls_base' }, run: async s => {
  await s.beat(0, async () => { await s.click('#bProjects'); await s.wait(.6); await s.callout('.drawer', { label: 'Projects panel', pos: 'left', teal: true }); });
  await s.beat(1, async () => { await s.clear(); await s.zoom('.drawer', { scale: 1.7, fy: .15 }); await s.click('#newName'); await s.type('Office Fit-out — Riyadh HQ'); await s.wait(.3); await s.click('#newForm button[type=submit]', { sound: 'pop' }); await s.unzoom(); await s.wait(1.2); await s.callout('.emptycard', { label: 'Ready for Level 1 items' }); });
  await s.beat(2, async () => { await s.clear(); await s.zoom('#projName', { scale: 2.2 }); await s.click('#projName', { fx: .9 }); await s.page.keyboard.press('End'); await s.type(' (Phase 1)'); await s.press('Enter'); await s.wait(.4); });
  await s.beat(3, async () => { await s.unzoom(); await s.click('#bProjects'); await s.wait(.5); await s.zoom('.drawer', { scale: 1.6, fy: .3 }); await s.callout('.pitem:has-text("24 kV RMU") .pm', { label: 'Items · last update', pos: 'below' }); await s.wait(1.4); await s.clear(); await s.click('.pitem:has-text("24 kV RMU") [data-open]'); await s.unzoom(); await s.wait(.8); });
  await s.beat(4, async () => { await s.click('#bProjects'); await s.wait(.5); await s.zoom('.drawer', { scale: 1.6, fy: .3 }); await s.click('.pitem:has-text("24 kV RMU") [data-dup]'); await s.unzoom(); await s.wait(.6); await s.zoom('#projName', { scale: 2.2 }); await s.wait(1); });
  await s.beat(5, async () => { await s.unzoom(); await s.click('#bProjects'); await s.wait(.5); await s.zoom('.drawer', { scale: 1.6, fy: .45 });
    await s.click('.pitem:has-text("Office Fit-out") [data-delp]'); await s.callout('.pitem:has-text("Office Fit-out") [data-delp]', { label: 'Click again to confirm', pos: 'below' }); await s.wait(1.2); await s.clear();
    await s.click('.pitem:has-text("Office Fit-out") [data-delp]', { sound: 'pop' }); await s.wait(1.2); await s.unzoom(); await s.click('#dClose'); });
  await s.wait(.5);
} };
