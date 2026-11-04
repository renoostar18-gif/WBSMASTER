const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500);
  await p.click('.box[data-id] .tg >> nth=0'); await p.waitForTimeout(300); await p.click('.box[data-id] .tg >> nth=0'); await p.waitForTimeout(1800);
  await p.click('#bImport'); await p.setInputFiles('#fileIn', 'data/Substation Upgrade - Task List.xlsx'); await p.waitForTimeout(1200);
  await p.screenshot({ path: 'shots/imp2.png' });
  console.log(await p.evaluate(() => ({ hdr: document.querySelector('#mHdr').value, name: document.querySelector('#mName').value, hint: document.querySelector('#hHint').textContent, info: document.querySelector('#mInfo').textContent, modes: [...document.querySelectorAll('#hMode button')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')) })));
  await p.click('#impGo'); await p.waitForTimeout(2000); await p.screenshot({ path: 'shots/imp3.png' });
  const ls = await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  fs.writeFileSync('data/ls_base.json', ls); console.log('saved', ls.length); await b.close();
})();
