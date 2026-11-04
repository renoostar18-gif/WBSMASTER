// Recording session: drives the real WBS Builder in Chromium, captures every frame with its
// timestamp (CDP screencast), and logs beats, sound cues and zoom moves for the compositor.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const URL = 'http://localhost:8765/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function voDurations(cid, n) {
  const f = path.join(ROOT, 'vo', cid + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)).beats.map(b => b.dur);
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'script.json'))).chapters.find(c => c.id === cid);
  return s.beats.map(t => t.split(/\s+/).length / 2.55);
}

class Session {
  constructor(cid, opts = {}) { this.cid = cid; this.opts = opts; this.log = { cid, beats: [], sfx: [], zoom: [], frames: [] }; this.x = 960; this.y = 600; }
  async start() {
    const dir = this.dir = path.join(ROOT, 'rec', this.cid); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'f'), { recursive: true });
    this.browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--lang=en-GB'], env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB' } });
    this.ctx = await this.browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Asia/Riyadh', colorScheme: this.opts.dark ? 'dark' : 'light', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    await this.ctx.addInitScript({ path: path.join(__dirname, 'overlay.js') });
    if (this.opts.seed) await this.ctx.addInitScript(s => { if (!sessionStorage.__seeded) { const o = JSON.parse(s); for (const k in o) localStorage.setItem(k, o[k]); sessionStorage.__seeded = 1; } }, fs.readFileSync(path.join(ROOT, 'data', this.opts.seed + '.json'), 'utf8'));
    if (this.opts.init) await this.ctx.addInitScript(this.opts.init);
    await this.ctx.addInitScript(k => { try { if (k) localStorage.removeItem('wbs.skipLanding'); else localStorage.setItem('wbs.skipLanding', '1'); } catch (e) {} }, !!this.opts.landing);
    const p = this.page = await this.ctx.newPage();
    p.on('pageerror', e => console.log('[pageerror]', e.message));
    p.on('download', d => d.saveAs(path.join(this.dir, d.suggestedFilename())).catch(() => {}));
    await p.goto(URL); await p.waitForLoadState('networkidle'); await sleep(this.opts.settle ?? 1500);
    if (this.opts.prep) await this.opts.prep(this);
    await p.evaluate(() => window.__ov.show(true)); await p.mouse.move(this.x, this.y);
    this.cdp = await this.ctx.newCDPSession(p); let k = 0;
    this.cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      const name = String(k++).padStart(6, '0') + '.jpg';
      fs.writeFile(path.join(dir, 'f', name), Buffer.from(data, 'base64'), () => {});
      this.log.frames.push([metadata.timestamp, name]);
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    await sleep(300); this.t0 = now(); this.vo = voDurations(this.cid, 0);
    // a heartbeat keeps frames flowing while the page is still (screencast only sends on change)
    await p.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:2147483647;pointer-events:none'; document.documentElement.appendChild(d); let o = 0; setInterval(() => { o = o ? 0 : 1; d.style.background = o ? 'rgba(0,0,0,.004)' : 'rgba(0,0,0,.006)'; }, 100); });
    return this;
  }
  t() { return now() - this.t0; }
  sfx(kind, extra = {}) { this.log.sfx.push({ t: this.t(), kind, ...extra }); }
  async beat(i, fn, { tail = 0.45, min = 0 } = {}) {
    const t0 = this.t(); const target = Math.max(min, (this.vo[i] ?? 3) + tail);
    try { await fn(); } catch (e) { console.log(`[${this.cid} beat ${i}]`, e.message.split('\n')[0]); }
    const left = target - (this.t() - t0); if (left > 0) await sleep(left * 1000);
    this.log.beats.push({ i, t0, t1: this.t() });
  }
  async idOf(name, sel = '[data-id]') { return this.page.evaluate(([n, s]) => { const el = [...document.querySelectorAll(s)].find(e => e.dataset.id && (e.textContent.includes(n) || [...e.querySelectorAll('input')].some(i => (i.value || '').includes(n)))); return el && el.dataset.id; }, [name, sel]); }
  async card(o) { this.sfx('pop'); await this.page.evaluate(x => window.__ov.card(x), o); }
  // ---------- pointer ----------
  async box(sel) { const b = await this.page.locator(sel).first().boundingBox(); if (!b) throw new Error('no box: ' + sel); return b; }
  async at(sel, fx = .5, fy = .5) { const b = await this.box(sel); return [b.x + b.width * fx, b.y + b.height * fy]; }
  async move(x, y, ms) {
    const x0 = this.x, y0 = this.y; const d = Math.hypot(x - x0, y - y0); ms = ms ?? Math.min(900, 260 + d * 0.55);
    const n = Math.max(2, Math.round(ms / 16));
    for (let k = 1; k <= n; k++) { const e = ease(k / n); await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(ms / n * 0.55); }
    this.x = x; this.y = y;
  }
  async hover(sel, fx, fy) { const [x, y] = await this.at(sel, fx, fy); await this.move(x, y); }
  async click(sel, { fx = .5, fy = .5, pause = 160, dbl = false, sound = 'click' } = {}) {
    let x, y; if (Array.isArray(sel)) [x, y] = sel; else { await this.page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); [x, y] = await this.at(sel, fx, fy); }
    await this.move(x, y); await sleep(pause);
    this.sfx(sound); await this.page.mouse.down(); await sleep(70); await this.page.mouse.up();
    if (dbl) { await sleep(90); this.sfx(sound); await this.page.mouse.click(x, y, { clickCount: 2 }); }
    await sleep(220);
  }
  async drag(from, to, { steps = 40, hold = 250, native = false } = {}) {
    const [x0, y0] = Array.isArray(from) ? from : await this.at(from); const [x1, y1] = Array.isArray(to) ? to : await this.at(to);
    await this.move(x0, y0); await sleep(200); this.sfx('click'); await this.page.mouse.down(); await sleep(hold);
    const n = steps; for (let k = 1; k <= n; k++) { const e = ease(k / n); await this.page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e); await sleep(22); }
    this.x = x1; this.y = y1; await sleep(hold); this.sfx('click'); await this.page.mouse.up(); await sleep(300);
  }
  // ---------- keyboard ----------
  async type(text, { delay = 55 } = {}) { for (const ch of text) { await this.page.keyboard.type(ch); if (ch !== ' ') this.sfx('key'); await sleep(delay + Math.random() * 35); } }
  async press(key, { badge, caption, pause = 250 } = {}) { if (badge !== false) await this.page.evaluate(([b, c]) => window.__ov.keys(b, c), [badge || [key.replace('Control', 'Ctrl').replace('Arrow', '')], caption || '']); this.sfx('key'); await this.page.keyboard.press(key); await sleep(pause); }
  async fill(sel, text, opts) { await this.click(sel); await this.page.keyboard.press('Control+A'); await this.type(text, opts); }
  async setDate(sel, iso) { // types a date into a native date input (en-GB: dd/mm/yyyy)
    await this.click(sel, { fx: .18 }); const [y, m, d] = iso.split('-'); await this.type(d + m + y, { delay: 70 }); await this.page.keyboard.press('Tab'); await sleep(250);
  }
  // ---------- presentation ----------
  async settle(sel) { // wait until the element stops moving (smooth scrolls, re-renders)
    let prev = null; for (let k = 0; k < 15; k++) { const b = await this.page.locator(sel).first().boundingBox().catch(() => null); if (b && prev && Math.abs(b.x - prev.x) < 1 && Math.abs(b.y - prev.y) < 1) return b; prev = b; await sleep(110); } return prev;
  }
  async zoom(target, { scale = 1.6, dur = .7, fx = .5, fy = .5 } = {}) {
    const w = 1920 / scale, h = 1080 / scale; let cx, cy;
    if (Array.isArray(target)) [cx, cy] = target;
    else {
      const b = await this.settle(target); if (!b) throw new Error('no box: ' + target);
      const vx0 = Math.max(0, b.x), vy0 = Math.max(0, b.y), vx1 = Math.min(1920, b.x + b.width), vy1 = Math.min(1080, b.y + b.height); // visible part only
      const bw = Math.max(1, vx1 - vx0), bh = Math.max(1, vy1 - vy0);
      fx = Math.min(1, Math.max(0, fx)); fy = Math.min(1, Math.max(0, fy));
      cx = bw > w ? vx0 + w / 2 - 20 + (bw - w) * fx * 0 : vx0 + bw * fx;   // wide targets: frame their start
      cy = bh > h ? vy0 + h / 2 - 20 : vy0 + bh * fy;
    }
    const x = Math.min(Math.max(cx - w / 2, 0), 1920 - w), y = Math.min(Math.max(cy - h / 2, 0), 1080 - h);
    this.log.zoom.push({ t: this.t(), x, y, w, h, dur }); this.sfx('zoom');
  }
  async unzoom(dur = .7) { this.log.zoom.push({ t: this.t(), x: 0, y: 0, w: 1920, h: 1080, dur }); }
  async callout(sel, opts = {}) { const b = Array.isArray(sel) ? { x: sel[0], y: sel[1], width: sel[2], height: sel[3] } : await this.box(sel); this.sfx('pop'); await this.page.evaluate(([r, o]) => window.__ov.callout(r, o), [{ x: b.x, y: b.y, w: b.width, h: b.height }, opts]); }
  async spot(sel) { const b = Array.isArray(sel) ? { x: sel[0], y: sel[1], width: sel[2], height: sel[3] } : await this.box(sel); await this.page.evaluate(r => window.__ov.spot(r), { x: b.x, y: b.y, w: b.width, h: b.height }); }
  async clear(sel) { await this.page.evaluate(s => window.__ov.clear(s), sel); }
  async ev(fn, arg) { return this.page.evaluate(fn, arg); }
  wait(s) { return sleep(s * 1000); }
  async end() {
    await sleep(400); await this.cdp.send('Page.stopScreencast').catch(() => {}); await sleep(300);
    this.log.t0 = this.t0; this.log.dur = this.t();
    fs.writeFileSync(path.join(this.dir, 'log.json'), JSON.stringify(this.log));
    await this.browser.close();
    console.log(`[${this.cid}] ${this.log.frames.length} frames, ${this.log.dur.toFixed(1)}s, ${this.log.beats.length} beats`);
  }
}
module.exports = { Session, sleep, ROOT };
