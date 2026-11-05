// Renders an .xlsx as a generic spreadsheet window for the overlay (read with SheetJS).
const XLSX = require('../lib/xlsx.full.min.js'); const fs = require('fs');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function read(file) { return XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true }); }
function fmt(v) { if (v instanceof Date) { const d = v; return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear(); } if (typeof v === 'number' && v > 0 && v < 1 && String(v).length > 3) return Math.round(v * 100) + '%'; return v; }
function html(file, sheet, { title, maxRows = 26, maxCols = 12, hdr = 0, calcFrom = 99 } = {}) {
  const wb = read(file); const name = sheet || wb.SheetNames[0]; const ws = wb.Sheets[name];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }).slice(0, maxRows);
  const cols = Math.min(maxCols, Math.max(...aoa.map(r => r.length)));
  const L = i => String.fromCharCode(65 + i);
  let h = `<div class="tb">${esc(title || file.split('/').pop())}<span>— spreadsheet</span></div><div class="fx"><b>A1</b><span></span></div><div class="gr"><table><tr><th></th>${[...Array(cols)].map((_, i) => `<th>${L(i)}</th>`).join('')}</tr>`;
  aoa.forEach((r, ri) => { h += `<tr class="${ri === hdr ? 'h' : ''}"><td class="rn">${ri + 1}</td>${[...Array(cols)].map((_, c) => `<td data-rc="${ri}:${c}" class="${c >= calcFrom ? 'calc' : ''}">${esc(fmt(r[c]))}</td>`).join('')}</tr>`; });
  h += `</table></div><div class="tabs">${wb.SheetNames.map(n => `<span class="${n === name ? 'on' : ''}">${esc(n)}</span>`).join('')}</div>`;
  return h;
}
module.exports = { html, read, XLSX };
