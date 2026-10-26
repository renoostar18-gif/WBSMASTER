import { resolveTxt } from 'node:dns/promises';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { type AppDeps, parse, requireUser, setSessionCookie } from '../app.js';
import { createSession } from '../auth.js';
import { checkRoomForMember } from '../billing.js';
import { tx } from '../db.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { orgAccess } from '../permissions.js';
import { PLANS } from '../plans.js';
import { Sealer } from '../secrets.js';
import {
  type Connection, SsoClients, connectionForEmail, finishSignIn, isPublicDomain, issuerFor, newVerificationToken, startSignIn,
  verificationRecord,
} from '../sso.js';

type O = { Params: { orgId: string } };
const domainRe = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Single sign-on (spec 7.2, Business plan): settings for organisation admins, and the sign-in itself. */
export const ssoRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  // without a SECRET_KEY nothing can be encrypted, so SSO cannot be set up or used
  const sealer = new Sealer(deps.config.secretKey ?? '');
  const ready = () => { if (!deps.config.secretKey) throw new ApiError(503, 'sso_unavailable'); };
  const clients = new SsoClients(sealer, deps.config.ssoAllowHttp);
  const txt = deps.resolveTxt ?? (async (name: string) => (await resolveTxt(name)).map(parts => parts.join('')));
  const callbackUrl = () => `${deps.config.appUrl}/api/auth/sso/callback`;

  async function admin(req: Parameters<typeof requireUser>[0], orgId: string) {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, orgId, 'admin');
    if (!PLANS[acc.plan].sso) throw forbidden('plan_sso');
    return user;
  }

  app.get<O>('/orgs/:orgId/sso', async req => {
    await admin(req, req.params.orgId);
    const c = await deps.db.query<Connection & { updated_at: Date }>('select * from sso_connections where org_id = $1', [req.params.orgId]);
    const d = await deps.db.query<{ domain: string; token: string; verified_at: Date | null }>(
      'select domain, token, verified_at from sso_domains where org_id = $1 order by domain', [req.params.orgId]);
    const conn = c.rows[0];
    return {
      callbackUrl: callbackUrl(),
      connection: conn ? {
        provider: conn.provider, issuer: conn.issuer, clientId: conn.client_id, enforce: conn.enforce, autoJoin: conn.auto_join,
        tenant: conn.provider === 'entra' ? /microsoftonline\.com\/([^/]+)\/v2\.0$/.exec(conn.issuer)?.[1] ?? '' : undefined,
      } : null,
      domains: d.rows.map(x => ({ domain: x.domain, verified: !!x.verified_at, record: verificationRecord(x.token) })),
    };
  });

  app.put<O>('/orgs/:orgId/sso', async req => {
    const user = await admin(req, req.params.orgId);
    ready();
    const b = parse(z.object({
      provider: z.enum(['entra', 'google', 'oidc']),
      tenant: z.string().trim().max(100).optional(),
      issuer: z.string().trim().url().max(500).optional(),
      clientId: z.string().trim().min(1).max(500),
      clientSecret: z.string().min(1).max(2000).optional(),
      enforce: z.boolean(),
      autoJoin: z.boolean(),
    }), req.body);
    const issuer = issuerFor(b.provider, b);
    if (!deps.config.ssoAllowHttp && !issuer.startsWith('https://')) throw badRequest('sso_bad_issuer');
    const old = (await deps.db.query<Connection>('select * from sso_connections where org_id = $1', [req.params.orgId])).rows[0];
    const secret = b.clientSecret ? sealer.seal(b.clientSecret) : old?.client_secret_enc;
    if (!secret) throw badRequest('sso_secret_required');
    // requiring SSO only makes sense once a domain is proved, or nobody could sign in with a password or SSO
    if (b.enforce) {
      const v = await deps.db.query('select 1 from sso_domains where org_id = $1 and verified_at is not null', [req.params.orgId]);
      if (!v.rowCount) throw badRequest('sso_verify_domain_first');
    }
    await clients.check(issuer, b.clientId, secret);
    await deps.db.query(
      `insert into sso_connections (org_id, provider, issuer, client_id, client_secret_enc, enforce, auto_join, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (org_id) do update set provider = excluded.provider, issuer = excluded.issuer, client_id = excluded.client_id,
         client_secret_enc = excluded.client_secret_enc, enforce = excluded.enforce, auto_join = excluded.auto_join,
         updated_by = excluded.updated_by, updated_at = now()`,
      [req.params.orgId, b.provider, issuer, b.clientId, secret, b.enforce, b.autoJoin, user.id]);
    return { ok: true };
  });

  app.delete<O>('/orgs/:orgId/sso', async req => {
    await admin(req, req.params.orgId);
    await deps.db.query('delete from sso_connections where org_id = $1', [req.params.orgId]);
    return { ok: true };
  });

  app.post<O>('/orgs/:orgId/sso/domains', async (req, reply) => {
    await admin(req, req.params.orgId);
    const { domain } = parse(z.object({ domain: z.string().trim().toLowerCase().regex(domainRe) }), req.body);
    if (isPublicDomain(domain)) throw badRequest('sso_public_domain');
    const token = newVerificationToken();
    await deps.db.query('insert into sso_domains (org_id, domain, token) values ($1, $2, $3) on conflict do nothing', [req.params.orgId, domain, token]);
    return reply.status(201).send({ domain, record: verificationRecord(token) });
  });

  /** Look for the TXT record on the domain; the first organisation to prove a domain keeps it. */
  app.post<O & { Params: { domain: string } }>('/orgs/:orgId/sso/domains/:domain/verify', async req => {
    await admin(req, req.params.orgId);
    const d = (await deps.db.query<{ token: string; verified_at: Date | null }>(
      'select token, verified_at from sso_domains where org_id = $1 and domain = $2', [req.params.orgId, req.params.domain])).rows[0];
    if (!d) throw notFound('domain_not_found');
    if (d.verified_at) return { verified: true };
    const records = await txt(req.params.domain).catch(() => [] as string[]);
    if (!records.includes(verificationRecord(d.token))) throw badRequest('sso_record_not_found');
    try {
      await deps.db.query('update sso_domains set verified_at = now() where org_id = $1 and domain = $2', [req.params.orgId, req.params.domain]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'sso_domain_taken');
      throw e;
    }
    return { verified: true };
  });

  app.delete<O & { Params: { domain: string } }>('/orgs/:orgId/sso/domains/:domain', async req => {
    await admin(req, req.params.orgId);
    await tx(deps.db, async c => {
      await c.query('delete from sso_domains where org_id = $1 and domain = $2', [req.params.orgId, req.params.domain]);
      // without a proved domain nobody could sign in, so stop requiring SSO
      const v = await c.query('select 1 from sso_domains where org_id = $1 and verified_at is not null', [req.params.orgId]);
      if (!v.rowCount) await c.query('update sso_connections set enforce = false where org_id = $1', [req.params.orgId]);
    });
    return { ok: true };
  });

  // ---- signing in ----

  /** Where to send this person to sign in, by their email's domain. */
  app.post('/auth/sso/start', async req => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254) }), req.body);
    ready();
    const c = await connectionForEmail(deps.db, email);
    if (!c) throw notFound('sso_not_configured');
    const plan = (await deps.db.query<{ plan: keyof typeof PLANS }>('select plan from organisations where id = $1', [c.org_id])).rows[0]!.plan;
    if (!PLANS[plan].sso) throw forbidden('plan_sso');
    return { url: await startSignIn(deps.db, clients, c, email, callbackUrl()) };
  });

  /** The provider sends the person back here; sign them in (creating their account the first time if allowed). */
  app.get('/auth/sso/callback', async (req, reply) => {
    const url = new URL(req.url.replace(/^\/api\/auth\/sso\/callback/, ''), callbackUrl());
    try {
      const who = await finishSignIn(deps.db, clients, url);
      const userId = await tx(deps.db, async c => {
        let u = (await c.query<{ id: string }>('select id from users where lower(email) = $1', [who.email])).rows[0];
        const member = u ? (await c.query('select 1 from memberships where org_id = $1 and user_id = $2', [who.orgId, u.id])).rowCount : 0;
        if (!member && !who.autoJoin) throw new ApiError(403, 'sso_not_member');
        if (!u) u = (await c.query<{ id: string }>('insert into users (email, name) values ($1, $2) returning id', [who.email, who.name])).rows[0]!;
        if (!member) await checkRoomForMember(c, who.orgId);
        if (!member) await c.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'member') on conflict do nothing", [who.orgId, u.id]);
        return u.id;
      });
      setSessionCookie(reply, await createSession(deps.db, userId, deps.config.sessionDays), deps);
      return reply.redirect('/');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'sso_failed';
      return reply.redirect(`/signin?sso_error=${encodeURIComponent(code)}`);
    }
  });
};

/** Password sign-in and sign-up are refused for domains whose organisation requires SSO. */
export async function requireSsoFor(db: Parameters<typeof connectionForEmail>[0], email: string): Promise<void> {
  const c = await connectionForEmail(db, email);
  if (c?.enforce) throw new ApiError(403, 'sso_required');
}
