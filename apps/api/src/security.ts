import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * What pages may load: the app's own scripts only (no inline scripts), styles inline and from Google
 * Fonts, and no framing by other sites.
 */
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

/** The same policy, also allowing one inline script given by its text (server-rendered pages). */
export function cspWithScript(script: string): string {
  const hash = createHash('sha256').update(script).digest('base64');
  return CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`);
}

/** Security headers on every response; HSTS only when the site is served over HTTPS. */
export function securityHeaders(app: FastifyInstance, opts: { hsts: boolean }) {
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (opts.hsts) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    return payload;
  });
}

/**
 * A request sent by a page of another site (cross-site request forgery). Browsers say where a
 * request comes from (Sec-Fetch-Site, and Origin on anything but plain GETs); requests without
 * these headers come from programs, not from a browser on another site.
 */
export function fromAnotherSite(req: FastifyRequest, appUrl: string): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  if (origin === new URL(appUrl).origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true; // "null" and other unreadable origins
  }
}
