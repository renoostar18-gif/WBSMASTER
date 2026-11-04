const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--lang=en-GB'] });
  for (const [name, vp, scheme] of [['light', { width: 1440, height: 900 }, 'light'], ['dark', { width: 1440, height: 900 }, 'dark'], ['phone', { width: 390, height: 844 }, 'light']]) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, locale: 'en-GB' });
    await ctx.addInitScript(s => { const o = JSON.parse(s); for (const k in o) localStorage.setItem(k, o[k]); }, fs.readFileSync('data/ls_portfolio.json', 'utf8'));
    const p = await ctx.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1800);
    await p.screenshot({ path: `shots/land_${name}.png`, fullPage: name === 'phone' });
    if (name === 'light') { await p.click('#hOpen'); await p.waitForTimeout(500); await p.click('#bHome'); await p.waitForTimeout(400); await p.click('.hp:has-text("132 kV") [data-hopen]'); await p.waitForTimeout(800); console.log('after open:', await p.textContent('#projName').catch(()=>''), await p.inputValue('#projName'), 'home hidden', await p.isHidden('#home'));
      await p.click('#segView button[data-v=summary]'); await p.waitForTimeout(400); console.log('sAI present:', await p.locator('#sAI').count()); }
    await ctx.close();
  }
  await b.close();
})();
