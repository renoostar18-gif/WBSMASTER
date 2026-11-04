// 02 Screen tour
module.exports = async s => {
  const p = s.page;
  await s.beat(0, async () => { await s.move(960, 520); await s.wait(.6); await s.spot('header.top'); await s.wait(.9); await s.spot('.rail'); await s.wait(.9); await s.spot('main'); await s.wait(.9); await s.clear('.spot'); });
  await s.beat(1, async () => {
    await s.zoom([560, 60], { scale: 1.9 });
    await s.callout('#projName', { n: 1, label: 'Project name — click to rename' }); await s.hover('#projName', .3); await s.wait(1.6);
    await s.callout('#status', { n: 2, label: 'Save status' }); await s.wait(1.5);
    await s.zoom([1600, 60], { scale: 1.9 }); await s.wait(.6);
    await s.callout('#bTheme', { n: 3, label: 'Theme', pos: 'below' }); await s.wait(.9);
    await s.callout('#bProjects', { n: 4 }); await s.wait(.7);
    await s.callout('#bSync', { n: 5 }); await s.wait(.7);
    await s.callout('#bImport', { n: 6 }); await s.wait(.7);
    await s.callout('#bExport', { n: 7, label: 'Excel in / out', pos: 'below-right' }); await s.hover('#bExport'); await s.wait(1.2);
  });
  await s.beat(2, async () => {
    await s.clear(); await s.zoom([420, 78], { scale: 2 });
    await s.callout('#segView', { n: 8, label: 'Views' }); await s.wait(.5);
    for (const v of ['table', 'gantt', 'summary', 'visual']) { await s.click(`#segView button[data-v=${v}]`); await s.wait(.55); }
    await s.callout('#segLv', { n: 9, label: 'Show levels' });
    await s.click('#segLv button:nth-child(1)'); await s.wait(.8); await s.click('#segLv button:nth-child(2)'); await s.wait(.8); await s.click('#segLv button:last-child'); await s.wait(.4);
  });
  await s.beat(3, async () => {
    await s.clear(); await s.click('.box:has-text("Mechanism integration")'); await s.zoom([960, 78], { scale: 2 });
    await s.callout('#gEdit', { n: 10, label: 'Child · Sibling · Outdent · Indent · Up · Down · Delete' });
    for (const id of ['#aChild', '#aSib', '#aOut', '#aIn', '#aUp', '#aDown', '#aDel']) { await s.hover(id); await s.wait(.32); }
    await s.callout('#aUndo', { n: 11 }); await s.hover('#aRedo'); await s.wait(.5);
    await s.callout('#aBase', { n: 12, label: 'Baselines' }); await s.hover('#aBase'); await s.wait(.7);
    await s.callout('#aLink', { n: 13, label: 'Links', pos: 'below-right' }); await s.hover('#aLink'); await s.wait(.6);
  });
  await s.beat(4, async () => { await s.clear(); await s.zoom('#summary', { scale: 2.2, fx: .4 }); await s.callout('#summary', { n: 15, label: 'Summary line', pos: 'below-right' }); await s.hover('#summary', .2); await s.wait(1.5); await s.hover('#summary', .85); });
  await s.beat(5, async () => {
    await s.clear(); await s.unzoom(); await s.click([1200, 900]); await s.wait(.4);
    await s.callout('#view', { n: 16, label: 'Canvas', teal: true }); await s.callout('#insp', { n: 17, label: 'Side panel', pos: 'left', teal: true }); await s.wait(1.6);
    await s.zoom('#insp', { scale: 1.7, fy: .25 }); await s.wait(1.6);
    await s.clear(); await s.click('.box:has-text("Prototype build")'); await s.wait(.4); await s.callout('#insp', { n: 17, label: 'Editor for the selected item', pos: 'left', teal: true }); await s.wait(.6);
  });
  await s.unzoom(); await s.clear(); await s.wait(.6);
};
