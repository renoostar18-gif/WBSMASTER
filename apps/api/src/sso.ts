import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import type { Queryable } from './db.js';
import { ApiError } from './errors.js';
import { publicFetch } from './netguard.js';
import type { Sealer } from './secrets.js';

export type SsoProvider = 'entra' | 'google' | 'oidc';

/**
 * Personal email services: anyone can have an address there, so no organisation
 * may claim them for single sign-on.
 */
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'mail.com', 'zoho.com',
]);
export const isPublicDomain = (d: string) => PUBLIC_DOMAINS.has(d);

/** The DNS TXT record that proves an organisation owns a domain. */
export const verificationRecord = (token: string) => `wbs-master-verification=${token}`;
export const newVerificationToken = () => randomBytes(16).toString('hex');

export const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';

/** Where each provider's sign-in lives. Entra ID is per tenant, so its address includes the tenant ID. */
export function issuerFor(provider: SsoProvider, opts: { tenant?: string; issuer?: string }): string {
  if (provider === 'google') return 'https://accounts.google.com';
  if (provider === 'entra') {
    if (!opts.tenant || !/^[0-9a-f-]{36}$|^[a-z0-9.-]+$/i.test(opts.tenant)) throw new ApiError(400, 'sso_bad_tenant');
    return `https://login.microsoftonline.com/${opts.tenant}/v2.0`;
  }
  if (!opts.issuer) throw new ApiError(400, 'sso_bad_issuer');
  return opts.issuer.replace(/\/$/, '');
}

export interface Connection {
  org_id: string;
  provider: SsoProvider;
  issuer: string;
  client_id: string;
  client_secret_enc: string;
  enforce: boolean;
  auto_join: boolean;
}

/** The organisation that has verified this email's domain, and its connection. */
export async function connectionForEmail(db: Queryable, email: string): Promise<(Connection & { domain: string }) | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  const r = await db.query<Connection & { domain: string }>(
    `select c.*, d.domain from sso_domains d join sso_connections c on c.org_id = d.org_id
      where d.domain = $1 and d.verified_at is not null`, [domain]);
  return r.rows[0] ?? null;
}

/**
 * Reads providers' settings (discovery) once an hour per connection rather than on every sign-in.
 * Outside development, requests to the provider may only reach public addresses (an admin types the
 * issuer address, and the provider's settings name further addresses).
 */
export class SsoClients {
  private cache = new Map<string, { at: number; config: Promise<oidc.Configuration> }>();
  constructor(private readonly sealer: Sealer, private readonly allowHttp: boolean, private readonly allowPrivate = allowHttp) {}

  config(c: Pick<Connection, 'issuer' | 'client_id' | 'client_secret_enc'>): Promise<oidc.Configuration> {
    const key = `${c.issuer}|${c.client_id}|${c.client_secret_enc}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 3600_000) return hit.config;
    const config = oidc.discovery(new URL(c.issuer), c.client_id, this.sealer.open(c.client_secret_enc), undefined,
      {
        ...(this.allowHttp ? { execute: [oidc.allowInsecureRequests] } : {}),
        ...(this.allowPrivate ? {} : { [oidc.customFetch]: publicFetch as oidc.CustomFetch }),
      });
    config.catch(() => this.cache.delete(key));
    this.cache.set(key, { at: Date.now(), config });
    return config;
  }

  /** Check a connection before saving it: the provider answers and its address is the one given. */
  async check(issuer: string, clientId: string, clientSecretEnc: string): Promise<void> {
    try {
      await this.config({ issuer, client_id: clientId, client_secret_enc: clientSecretEnc });
    } catch {
      throw new ApiError(400, 'sso_provider_unreachable');
    }
  }
}

/** Start a sign-in: remember what to check when the person comes back, and where to send them. */
export async function startSignIn(db: Queryable, clients: SsoClients, c: Connection & { domain: string }, email: string, redirectUri: string): Promise<{ url: string; state: string }> {
  const config = await clients.config(c).catch(() => { throw new ApiError(502, 'sso_provider_unreachable'); });
  const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
  await db.query("delete from sso_logins where created_at < now() - interval '10 minutes'");
  await db.query('insert into sso_logins (state, org_id, nonce, code_verifier) values ($1, $2, $3, $4)', [state, c.org_id, nonce, verifier]);
  const params: Record<string, string> = {
    redirect_uri: redirectUri, scope: 'openid email profile', state, nonce, login_hint: email,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
  };
  if (c.provider === 'google') params.hd = c.domain; // only accounts of that Google Workspace
  return { url: oidc.buildAuthorizationUrl(config, params).href, state };
}

export interface SsoIdentity { orgId: string; email: string; name: string; autoJoin: boolean }

/**
 * Finish a sign-in: check it comes back to the browser that started it, the provider's answer (signature, issuer, audience, nonce, PKCE),
 * then that the email belongs to a domain this organisation verified.
 */
export async function finishSignIn(db: Queryable, clients: SsoClients, callbackUrl: URL, browserState: string | undefined): Promise<SsoIdentity> {
  const state = callbackUrl.searchParams.get('state') ?? '';
  // the sign-in must finish in the browser that started it, or someone could send their own sign-in link to another person
  if (!state || state !== browserState) throw new ApiError(400, 'sso_expired');
  const r = await db.query<{ org_id: string; nonce: string; code_verifier: string }>(
    "delete from sso_logins where state = $1 and created_at > now() - interval '10 minutes' returning org_id, nonce, code_verifier", [state]);
  const login = r.rows[0];
  if (!login) throw new ApiError(400, 'sso_expired');
  const c = (await db.query<Connection>('select * from sso_connections where org_id = $1', [login.org_id])).rows[0];
  if (!c) throw new ApiError(400, 'sso_not_configured');
  if (callbackUrl.searchParams.get('error')) throw new ApiError(400, 'sso_cancelled');
  let claims: Record<string, unknown>;
  try {
    const tokens = await oidc.authorizationCodeGrant(await clients.config(c), callbackUrl, {
      pkceCodeVerifier: login.code_verifier, expectedState: state, expectedNonce: login.nonce, idTokenExpected: true,
    });
    claims = (tokens.claims() ?? {}) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'sso_failed');
  }
  // Entra ID may leave out "email" and give the sign-in name (UPN) instead
  const email = String(claims.email ?? (c.provider === 'entra' ? claims.preferred_username ?? '' : '')).trim().toLowerCase();
  if (!email.includes('@') || claims.email_verified === false) throw new ApiError(403, 'sso_email_unverified');
  const domain = domainOf(email);
  const owned = await db.query("select 1 from sso_domains where org_id = $1 and domain = $2 and verified_at is not null", [c.org_id, domain]);
  if (!owned.rowCount) throw new ApiError(403, 'sso_email_domain');
  if (c.provider === 'google' && claims.hd !== domain) throw new ApiError(403, 'sso_email_domain');
  const name = String(claims.name ?? [claims.given_name, claims.family_name].filter(Boolean).join(' ') ?? '').trim() || email.split('@')[0]!;
  return { orgId: c.org_id, email, name: name.slice(0, 120), autoJoin: c.auto_join };
}
