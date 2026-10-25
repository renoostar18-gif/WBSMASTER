import { openApi } from './openapi.js';

/**
 * The API reference as one HTML page, built from the OpenAPI description so the
 * two never disagree. Served at /api/docs; `fragment` leaves out the document
 * wrapper for hosts that add their own.
 */
export function renderApiDocs(opts: { fragment?: boolean } = {}): string {
  const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const code = (s: string, lang = '') => `<pre class="code"${lang ? ` data-lang="${lang}"` : ''}><code>${esc(s.trim())}</code></pre>`;
  const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

  type Op = { summary?: string; parameters?: { name: string; in: string; description?: string; schema?: { type?: unknown } }[]; requestBody?: { content: { 'application/json': { schema: Schema } } } };
  type Schema = { type?: unknown; properties?: Record<string, Schema & { description?: string; enum?: readonly string[]; const?: string; format?: string }>; required?: readonly string[]; $ref?: string; items?: Schema; maxItems?: number };
  const typeOf = (s: Schema & { enum?: readonly string[]; const?: string; format?: string }): string => {
    if (s.$ref) return s.$ref.split('/').pop()!;
    if (s.enum) return s.enum.map(v => `"${v}"`).join(' | ');
    if (s.const) return `"${s.const}"`;
    if (s.type === 'array') return `${s.items ? typeOf(s.items) : 'any'}[]`;
    const t = Array.isArray(s.type) ? s.type.join(' | ') : String(s.type ?? 'any');
    return s.format ? `${t} (${s.format})` : t;
  };
  const fields = (s: Schema) => {
    if (!s.properties) return '';
    const req = new Set(s.required ?? []);
    return `<table class="fields"><tbody>${Object.entries(s.properties).map(([k, v]) =>
      `<tr><td><code>${esc(k)}</code>${req.has(k) ? ' <span class="req">required</span>' : ''}</td><td><code class="t">${esc(typeOf(v))}</code></td></tr>`).join('')}</tbody></table>`;
  };

  // group paths by area, in a reading order
  const AREAS: [string, (p: string) => boolean][] = [
    ['Account', p => p === '/me'],
    ['Projects', p => /^\/orgs\/\{orgId\}\/projects$|^\/projects\/\{projectId\}$/.test(p)],
    ['Editing', p => p.endsWith('/ops')],
    ['Baselines and reports', p => /baselines|summary|activity/.test(p)],
    ['Comments', p => p.includes('/comments')],
    ['Portfolio', p => p.includes('/portfolio')],
    ['Webhooks', p => p.includes('/webhooks')],
  ];
  const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
  const paths = openApi.paths as unknown as Record<string, Record<string, Op>>;
  const endpoints = AREAS.map(([area, match]) => {
    const rows = Object.entries(paths).filter(([p]) => match(p)).flatMap(([p, item]) =>
      METHODS.filter(m => item[m]).map(m => ({ method: m, path: p, op: item[m]! })));
    return { area, rows };
  }).filter(a => a.rows.length);

  const endpointHtml = endpoints.map(({ area, rows }) => `
    <section class="area" id="${slug(area)}">
      <h3>${esc(area)}</h3>
      ${rows.map(({ method, path, op }) => {
        const query = (op.parameters ?? []).filter(x => x.in === 'query');
        const body = op.requestBody?.content['application/json'].schema;
        return `<article class="ep">
          <div class="sig"><span class="m m-${method}">${method.toUpperCase()}</span><code class="path">${esc(path)}</code></div>
          <p>${esc(op.summary ?? '')}</p>
          ${query.length ? `<p class="sub">Query</p><table class="fields"><tbody>${query.map(q => `<tr><td><code>${esc(q.name)}</code></td><td>${esc(q.description ?? typeOf(q.schema ?? {}))}</td></tr>`).join('')}</tbody></table>` : ''}
          ${body ? `<p class="sub">Body</p>${body.properties ? fields(body) : `<code class="t">${esc(typeOf(body))}</code>`}` : ''}
        </article>`;
      }).join('')}
    </section>`).join('');

  const item = openApi.components.schemas.Item as unknown as Schema;
  const events = openApi.components.schemas.WebhookEvent.enum;

  const css = `
:root {
  /* Layout: reference manual, a sticky contents column beside one reading column; stacks on phones. Tokens follow the WBS Master app. */
  --bg: #ECF0EF; --panel: #FFFFFF; --ink: #0D1821; --muted: #46535E; --line: #BCC8C5; --line2: #D9E1DF; --accent: #08776C; --code-bg: #F4F7F6;
  --get: #08776C; --post: #1D5FD6; --put: #8B3CC9; --patch: #A65A00; --delete: #C42318;
  --f-ui: "IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --f-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #090E13; --panel: #121A22; --ink: #EEF4F2; --muted: #A8B6BD; --line: #344550; --line2: #1F2C35; --accent: #36D6C3; --code-bg: #0D141A;
  --get: #36D6C3; --post: #6FA9FF; --put: #CB94FF; --patch: #FFC23D; --delete: #FF6F61; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #090E13; --panel: #121A22; --ink: #EEF4F2; --muted: #A8B6BD; --line: #344550; --line2: #1F2C35; --accent: #36D6C3; --code-bg: #0D141A;
  --get: #36D6C3; --post: #6FA9FF; --put: #CB94FF; --patch: #FFC23D; --delete: #FF6F61; color-scheme: dark }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 15px/1.6 var(--f-ui); margin: 0; }
.wrap { max-width: 1180px; margin: 0 auto; padding-block: 28px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 40px; }
nav { position: sticky; top: calc(16px + env(safe-area-inset-top, 0px)); align-self: start; font-size: 13.5px; display: flex; flex-direction: column; gap: 14px; }
nav .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: .02em; }
nav .brand i { display: grid; grid-template-columns: repeat(3, 6px); gap: 2px; }
nav .brand b { height: 6px; background: var(--accent); border-radius: 1px; }
nav .brand b:nth-child(1) { grid-column: 2; }
nav .brand b:nth-child(n+2) { opacity: .6; }
nav ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
nav a { color: var(--muted); text-decoration: none; display: block; padding: 3px 8px; border-radius: 5px; }
nav a:hover, nav a:focus-visible { color: var(--ink); background: var(--line2); outline: none; }
nav .label { font-size: 11px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); font-weight: 600; padding-inline: 8px; }
main { min-width: 0; display: flex; flex-direction: column; gap: 44px; }
header h1 { font-size: 30px; line-height: 1.15; margin: 0 0 8px; text-wrap: balance; }
header p { margin: 0; color: var(--muted); max-width: 68ch; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 14px; font-size: 13px; color: var(--muted); }
.meta code { color: var(--ink); }
h2 { font-size: 20px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 2px solid var(--ink); text-wrap: balance; }
h3 { font-size: 15px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
section > p, li { max-width: 72ch; }
section { min-width: 0; }
code { font-family: var(--f-mono); font-size: .9em; }
p code, li code, td code { background: var(--code-bg); border: 1px solid var(--line2); border-radius: 4px; padding: 0 4px; }
.code { background: var(--code-bg); border: 1px solid var(--line2); border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-size: 13px; line-height: 1.55; margin: 10px 0; position: relative; }
.code[data-lang] { padding-top: 26px; }
.code[data-lang]::before { content: attr(data-lang); position: absolute; inset-inline-end: 10px; top: 6px; font: 600 10px var(--f-ui); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.code code { background: none; border: 0; padding: 0; }
table { border-collapse: collapse; font-size: 13.5px; }
.tbl { overflow-x: auto; }
.tbl table, .fields { width: 100%; }
th { text-align: start; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); padding: 6px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 6px 10px; border-bottom: 1px solid var(--line2); vertical-align: top; }
.fields td:first-child { white-space: nowrap; width: 1%; }
.t { color: var(--muted); background: none !important; border: 0 !important; padding: 0 !important; }
.req { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); }
.area { display: flex; flex-direction: column; gap: 10px; }
.ep { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; min-width: 0; }
.ep p { margin: 6px 0 0; }
.ep .sub { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; margin-top: 10px; }
.sig { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.path { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.m { font: 700 11px/1 var(--f-mono); letter-spacing: .04em; padding: 4px 7px; border-radius: 4px; border: 1.5px solid currentColor; min-width: 58px; text-align: center; }
.m-get { color: var(--get); } .m-post { color: var(--post); } .m-put { color: var(--put); } .m-patch { color: var(--patch); } .m-delete { color: var(--delete); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips code { background: var(--code-bg); border: 1px solid var(--line2); border-radius: 999px; padding: 2px 10px; }
@media (max-width: 820px) {
  .wrap { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  nav { position: static; flex-direction: row; flex-wrap: wrap; align-items: center; }
  nav ol { flex-direction: row; flex-wrap: wrap; }
  nav .label { display: none; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
html { scroll-behavior: smooth; }`;

  const guide = [
    ['start', 'Getting started'], ['auth', 'Keys and permissions'], ['limits', 'Rate limits'], ['errors', 'Errors'],
    ['editing', 'Editing a WBS'], ['webhooks', 'Webhooks'], ['reference', 'Endpoint reference'],
  ];

  const body = `
<div class="wrap">
  <nav aria-label="Contents">
    <div class="brand"><i><b></b><b></b><b></b><b></b></i>WBS Master</div>
    <span class="label">Guide</span>
    <ol>${guide.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ol>
    <span class="label">Endpoints</span>
    <ol>${endpoints.map(e => `<li><a href="#${slug(e.area)}">${esc(e.area)}</a></li>`).join('')}</ol>
  </nav>
  <main>
    <header>
      <h1>WBS Master API</h1>
      <p>Read and change work breakdown structures from your own tools: reporting, ERP, Power Automate, or scripts. Every request runs through the same rules as the app: WBS codes, working-day calendars, roll-ups, auto-scheduling and permissions.</p>
      <div class="meta"><span>Version <code>${esc(openApi.info.version)}</code></span><span>Base URL <code>https://&lt;your WBS Master address&gt;/api</code></span><span>OpenAPI <code>/api/openapi.json</code></span><span>Plans: Team and Business</span></div>
    </header>

    <section id="start">
      <h2>Getting started</h2>
      <p>Create a key in <b>Settings → API &amp; webhooks</b>, choose the organisation it works in, and whether it may change data. Copy it when it is shown: only a hash is stored. Send it with every request:</p>
      ${code(`curl https://wbs.example.sa/api/me \\
  -H "Authorization: Bearer wbsm_3f9a1c0b7e42_Xq2…"`, 'shell')}
      <p>Dates are ISO <code>YYYY-MM-DD</code>. Durations, lags and variance are counted in working days of the project's calendar (Sunday to Thursday with Saudi public holidays by default).</p>
    </section>

    <section id="auth">
      <h2>Keys and permissions</h2>
      <ul>
        <li>A key acts as the person who made it. It can do what they can do in the app, in one organisation; projects elsewhere answer <code>404</code>.</li>
        <li><b>Read only</b> keys can only use <code>GET</code>; anything else answers <code>403 key_read_only</code>.</li>
        <li>A key cannot sign in, change the account, create organisations or make other keys (<code>403 not_with_api_key</code>).</li>
        <li>A key stops working when it is revoked, or when the organisation moves to a plan without the API (<code>403 plan_api</code>).</li>
      </ul>
    </section>

    <section id="limits">
      <h2>Rate limits</h2>
      <p>Each key may make <b>300 requests a minute</b>. Responses carry <code>X-RateLimit-Limit</code> and <code>X-RateLimit-Remaining</code>. Over the limit the API answers <code>429 rate_limited</code> with <code>Retry-After</code> in seconds. Batch edits into one <code>/ops</code> request (up to 500 edits) rather than one request per field.</p>
    </section>

    <section id="errors">
      <h2>Errors</h2>
      <p>Errors are JSON with a stable code your code can rely on: <code>{ "error": "link_cycle", "opIndex": 2 }</code>.</p>
      <div class="tbl"><table><thead><tr><th>Status</th><th>Common codes</th></tr></thead><tbody>
        <tr><td>400</td><td><code>invalid_request</code> <code>link_cycle</code> <code>same_family</code> <code>parent_rolled_up</code> <code>item_not_found</code> <code>webhook_https_only</code> <code>webhook_private_address</code></td></tr>
        <tr><td>401</td><td><code>not_signed_in</code> <code>invalid_api_key</code></td></tr>
        <tr><td>403</td><td><code>forbidden</code> <code>key_read_only</code> <code>not_with_api_key</code> <code>plan_api</code> <code>plan_item_limit</code></td></tr>
        <tr><td>404</td><td><code>project_not_found</code> <code>org_not_found</code> <code>not_found</code></td></tr>
        <tr><td>429</td><td><code>rate_limited</code></td></tr>
      </tbody></table></div>
    </section>

    <section id="editing">
      <h2>Editing a WBS</h2>
      <p><code>GET /projects/{projectId}</code> returns the stored items and, under <code>computed</code>, what the engine calculates for each: WBS code, level, rolled-up dates, status, progress, planned&nbsp;%, variance and health with its reason. To change anything, send a batch of edits to <code>POST /projects/{projectId}/ops</code>. A batch applies completely or not at all, then linked work is auto-scheduled.</p>
      ${code(`POST /api/projects/7c1e…/ops
{
  "ops": [
    { "op": "add", "id": "b1f0…", "parentId": null,
      "values": { "name": "Busbar & insulation design", "owner": "R&D",
                  "plannedStart": "2026-08-16", "plannedFinish": "2026-09-24" } },
    { "op": "set", "id": "b1f0…", "field": "forecastFinish", "value": "2026-10-08" },
    { "op": "link", "succ": "c4d2…", "pred": "b1f0…", "lag": 3 }
  ]
}`, 'http')}
      <p>Edits: <code>add</code>, <code>set</code> (one field), <code>put</code> (several fields), <code>move</code>, <code>delete</code> (with its children), <code>link</code> and <code>unlink</code> (finish-to-start, with a lag in working days). Parents roll up their dates, progress and health, so editing a parent's dates is refused.</p>
      <p class="sub" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin:16px 0 0">Item fields</p>
      ${fields(item)}
    </section>

    <section id="webhooks">
      <h2>Webhooks</h2>
      <p>Organisation admins add webhooks in <b>Settings → API &amp; webhooks</b> or with <code>POST /orgs/{orgId}/webhooks</code>. WBS Master sends a <code>POST</code> with a JSON body to your https address when these events happen:</p>
      <div class="chips">${events.map(e => `<code>${e}</code>`).join('')}</div>
      ${code(`{
  "id": "5d0b…",                     // delivery id, also in X-WBS-Delivery
  "event": "health.changed",
  "createdAt": "2026-10-25T09:14:03Z",
  "orgId": "a2e4…",
  "data": {
    "project": { "id": "7c1e…", "name": "24 kV RMU development", "from": "amber", "to": "red" },
    "actor": { "id": "…", "name": "Rayan Hamdan" },
    "items": [ { "id": "b1f0…", "code": "2.1.2", "name": "Busbar & insulation design", "from": "amber", "to": "red" } ]
  }
}`, 'json')}
      <p><b>Check the signature.</b> Every request has <code>X-WBS-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, where <code>v1</code> is HMAC-SHA256 of <code>&lt;t&gt;.&lt;raw body&gt;</code> with the secret shown when the webhook was created. Reject requests older than five minutes so a captured request cannot be replayed.</p>
      ${code(`import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map(p => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const want = createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest();
  const got = Buffer.from(v1, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}`, 'node')}
      ${code(`import hmac, hashlib, time

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300:
        return False
    want = hmac.new(secret.encode(), parts["t"].encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, parts["v1"])`, 'python')}
      <p>Answer with any <code>2xx</code> within 10 seconds. Anything else is retried after 1, 5, 30, 120 and 720 minutes, then marked failed; redirects are not followed. Addresses must be public https: private, loopback and cloud metadata addresses are refused. <code>POST …/webhooks/{id}/test</code> sends a <code>ping</code>, and <code>GET …/deliveries</code> shows the last 50 attempts.</p>
    </section>

    <section id="reference">
      <h2>Endpoint reference</h2>
      <p>Paths are relative to <code>/api</code>. Project roles decide what each person (and their keys) may do: viewers read, commenters also comment, editors also edit items, project admins also change settings and baselines.</p>
    </section>
    ${endpointHtml}
  </main>
</div>`;

  const head = `<title>WBS Master API</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600;700&display=swap">
<style>${css}</style>`;
  if (opts.fragment) return `${head}\n${body}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${head}</head><body>${body}</body></html>`;
}
