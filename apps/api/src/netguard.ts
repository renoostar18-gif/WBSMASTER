import { type LookupAddress, lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

/**
 * Outgoing requests to addresses that customers choose (webhooks, SSO providers) may only reach the
 * public internet, never the hosting network (server-side request forgery). The address is checked
 * when a connection is made, so a DNS answer that changes after an earlier check cannot get through.
 */

function privateV4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

/** An IPv6 address as eight 16-bit groups, or null when it is not one. */
function v6groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  // a dotted IPv4 tail (::ffff:1.2.3.4) becomes two groups
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (isIP(v4[1]!) !== 4) return null;
    const [a, b, c, d] = v4[1]!.split('.').map(Number) as [number, number, number, number];
    s = s.slice(0, -v4[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (h: string) => (h ? h.split(':').map(x => parseInt(x, 16)) : []);
  const head = part(halves[0]!), tail = halves.length === 2 ? part(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const g = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return g.length === 8 && g.every(x => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? g : null;
}

const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** Loopback, private, link-local, shared, multicast, documentation and other non-public addresses, IPv4 or IPv6. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const g = v6groups(ip);
  if (!g) return true;
  const zeros = (from: number, to: number) => g.slice(from, to).every(x => x === 0);
  if (zeros(0, 8)) return true; // ::
  if (zeros(0, 7) && g[7] === 1) return true; // ::1
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d), 6to4 (2002:aabb:ccdd::)
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return privateV4(v4of(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b) return zeros(2, 6) ? privateV4(v4of(g[6]!, g[7]!)) : true;
  if (g[0] === 0x2002) return privateV4(v4of(g[1]!, g[2]!));
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x100 && zeros(1, 4)) return true; // discard
  const top = g[0]!;
  return (top & 0xfe00) === 0xfc00 || (top & 0xffc0) === 0xfe80 || (top & 0xffc0) === 0xfec0 || (top & 0xff00) === 0xff00;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup that refuses names resolving to a non-public address. */
export function publicLookup(hostname: string, options: { all?: boolean; family?: number } | number, cb: LookupCb) {
  const opts = typeof options === 'number' ? { family: options } : options ?? {};
  dnsLookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err, opts.all ? [] : '');
    if (!addrs.length || addrs.some(a => privateAddress(a.address))) {
      const e: NodeJS.ErrnoException = new Error(`refused non-public address for ${hostname}`);
      e.code = 'EPRIVATE';
      return cb(e, opts.all ? [] : '');
    }
    if (opts.all) return cb(null, addrs);
    cb(null, addrs[0]!.address, addrs[0]!.family);
  });
}

const MAX_RESPONSE = 1024 * 1024;

/**
 * A fetch that only connects to public addresses: IP literals are checked here, names when they are
 * resolved for the connection. Redirects are not followed; responses are cut at 1 MB.
 */
export const publicFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('unsupported protocol');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && privateAddress(host)) throw new TypeError('refused non-public address');
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
  const body = init.body == null ? null : typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : null;
  if (init.body != null && body == null) throw new TypeError('unsupported body');
  if (body != null && !headers['content-type'] && init.body instanceof URLSearchParams) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  const signal = init.signal ?? AbortSignal.timeout(15_000);
  return new Promise<Response>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: init.method ?? 'GET', headers, lookup: publicLookup as never, signal,
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE) { req.destroy(new Error('response too large')); return; }
        chunks.push(c);
      });
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode ?? 500;
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
        const nobody = status === 204 || status === 304 || (status >= 100 && status < 200);
        resolve(new Response(nobody ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage, headers: h }));
      });
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
};
