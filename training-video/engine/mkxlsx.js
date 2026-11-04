const XLSX = require('../lib/xlsx.full.min.js');
const rows = [
 ['Engineering','Site survey & load study','Engineering','2026-10-04','2026-10-22',100,''],
 ['','Protection coordination study','Engineering','2026-10-18','2026-11-12',70,'Relay settings under review'],
 ['','Single-line diagram & layout','Engineering','2026-10-25','2026-11-19',40,''],
 ['','Civil & foundation design','Civil','2026-11-01','2026-11-26',20,''],
 ['Procurement','Power transformer 40 MVA','Procurement','2026-11-15','2027-02-18',0,'Long-lead item'],
 ['','13.8 kV switchgear','Procurement','2026-11-22','2027-01-28',0,''],
 ['','Cables & accessories','Procurement','2026-12-06','2027-01-14',0,''],
 ['Construction','Civil works & foundations','Civil','2026-12-06','2027-01-21',0,''],
 ['','Transformer installation','Site','2027-02-21','2027-03-11',0,''],
 ['','Switchgear installation','Site','2027-02-01','2027-02-25',0,''],
 ['','Cabling & terminations','Site','2027-02-28','2027-03-18',0,''],
 ['Testing & Commissioning','Pre-commissioning tests','Commissioning','2027-03-21','2027-04-01',0,''],
 ['','Protection relay testing','Commissioning','2027-03-28','2027-04-08',0,''],
 ['','Energization','Commissioning','2027-04-11','2027-04-11',0,'Milestone'],
 ['Handover','As-built drawings','Engineering','2027-04-04','2027-04-22',0,''],
 ['','Training & handover to operations','PMO','2027-04-18','2027-04-29',0,''],
];
const d = s => { const [y,m,dd] = s.split('-').map(Number); return new Date(Date.UTC(y, m-1, dd)); };
const aoa = [['132/13.8 kV Substation Upgrade — Task list'], ['Prepared by PMO · Rev B'], [], ['Phase','Task','Owner','Start','Finish','% Complete','Notes'],
  ...rows.map(r => [r[0], r[1], r[2], d(r[3]), d(r[4]), r[5] / 100, r[6]])];
const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
ws['!cols'] = [{wch:24},{wch:36},{wch:16},{wch:12},{wch:12},{wch:12},{wch:28}];
// merged Phase cells, as people usually lay them out
const merges = []; let start = null;
rows.forEach((r, i) => { if (r[0]) { if (start != null && i - 1 > start) merges.push({ s: { r: 4 + start, c: 0 }, e: { r: 4 + i - 1, c: 0 } }); start = i; } });
merges.push({ s: { r: 4 + start, c: 0 }, e: { r: 4 + rows.length - 1, c: 0 } }); ws['!merges'] = merges;
for (let r = 4; r < 4 + rows.length; r++) { for (const c of [3,4]) { const a = XLSX.utils.encode_cell({r,c}); if (ws[a]) ws[a].z = 'dd/mm/yyyy'; } const p = XLSX.utils.encode_cell({r,c:5}); if (ws[p]) ws[p].z = '0%'; }
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
require('fs').writeFileSync(__dirname + '/../data/Substation Upgrade - Task List.xlsx', XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
console.log('ok');
