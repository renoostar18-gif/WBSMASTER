// A stand-in for Moyasar in browser tests: its invoice API (under /v1) and a hosted payment page.
// Start it before the API, and start the API with
//   MOYASAR_SECRET_KEY=sk_test_e2e MOYASAR_WEBHOOK_SECRET=whsec_e2e MOYASAR_API_URL=http://127.0.0.1:4010/v1
//   node e2e/fake-moyasar.mjs [port]
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? process.env.FAKE_MOYASAR_PORT ?? 4010);
const base = `http://127.0.0.1:${port}`;
const auth = `Basic ${Buffer.from('sk_test_e2e:').toString('base64')}`;
const invoices = new Map();
const body = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => r(b)); });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

createServer(async (req, res) => {
  const url = new URL(req.url, base);
  const json = (status, v) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  const parts = url.pathname.split('/').filter(Boolean);

  // the hosted payment page
  if (parts[0] === 'pay') {
    const inv = invoices.get(parts[1]);
    if (!inv) { res.writeHead(404); return res.end('not found'); }
    if (req.method === 'POST') {
      inv.status = 'paid';
      // Moyasar's webhook, as configured in its dashboard
      await fetch(inv.callback_url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: randomBytes(6).toString('hex'), type: 'payment_paid', secret_token: 'whsec_e2e', live: false,
          data: { id: `pay_${inv.id}`, status: 'paid', amount: inv.amount, currency: inv.currency, invoice_id: inv.id } }),
      }).catch(() => {});
      res.writeHead(302, { location: inv.success_url });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Moyasar (test)</title>
<body style="font:16px system-ui;max-width:420px;margin:40px auto"><h1>Moyasar test checkout</h1>
<p>${esc(inv.description)}</p><p><b>SAR ${(inv.amount / 100).toFixed(2)}</b></p>
<form method="post"><button>Pay</button></form><p><a href="${esc(inv.back_url)}">Back</a></p></body>`);
  }

  if (parts[0] !== 'v1') return json(404, {});
  if (req.headers.authorization !== auth) return json(401, { type: 'authentication_error', message: 'Invalid authorization credentials' });
  if (req.method === 'POST' && parts[1] === 'invoices' && !parts[2]) {
    const b = JSON.parse(await body(req));
    if (!Number.isInteger(b.amount) || b.amount < 100 || !b.description) return json(400, { type: 'invalid_request_error' });
    const id = randomBytes(8).toString('hex');
    const inv = { ...b, id, status: 'initiated', url: `${base}/pay/${id}`, created_at: new Date().toISOString() };
    invoices.set(id, inv);
    return json(201, inv);
  }
  const inv = parts[1] === 'invoices' ? invoices.get(parts[2]) : undefined;
  if (!inv) return json(404, { type: 'record_not_found' });
  if (req.method === 'GET') return json(200, inv);
  if (req.method === 'PUT' && parts[3] === 'cancel') { inv.status = 'canceled'; return json(200, inv); }
  json(404, {});
}).listen(port, '127.0.0.1', () => console.log(`fake Moyasar on ${base}`));
