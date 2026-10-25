// Builds the browser-only demo and packs it into one HTML file: dist-demo/wbs-master-demo.html.
// The file has no <html>/<head>/<body> of its own: it is published as a page that is wrapped at publish time.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build --mode demo', { stdio: 'inherit' });
const dir = 'dist-demo';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const assets = join(dir, 'assets');
const js = readdirSync(assets).filter(f => f.endsWith('.js')).map(f => readFileSync(join(assets, f), 'utf8'));
const css = readdirSync(assets).filter(f => f.endsWith('.css')).map(f => readFileSync(join(assets, f), 'utf8'));
if (js.length !== 1) throw new Error(`expected one script, got ${js.length}`);
const pick = re => (html.match(re) ?? []).join('\n');
const out = [
  '<meta charset="utf-8">',
  '<title>WBS Master</title>',
  pick(/<link rel="icon"[^>]*>/g),
  pick(/<link rel="preconnect"[^>]*>/g),
  pick(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/g),
  `<style>${css.join('\n')}</style>`,
  '<div id="root"></div>',
  // a module script with "</script" inside a string would end the tag early
  // U+FFFD as an escape, which means the same in strings and regexes (the publish check rejects the raw character)
  `<script type="module">${js[0].replaceAll('</script', '<\\/script').replaceAll('\uFFFD', '\\uFFFD')}</script>`,
].join('\n');
writeFileSync(join(dir, 'wbs-master-demo.html'), out);
console.log(`dist-demo/wbs-master-demo.html: ${(out.length / 1024).toFixed(0)} KB`);
