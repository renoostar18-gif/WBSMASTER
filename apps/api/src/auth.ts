import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Queryable } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

/**
 * Email + password sign-in for local accounts. Passwords are hashed with
 * scrypt. Business-plan SSO (OIDC with Keycloak or Entra ID) is added in Phase 3
 * and creates the same sessions.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Create a session and return the raw token for the cookie. Only its hash is stored. */
export async function createSession(db: Queryable, userId: string, days: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`,
    [hashToken(token), userId, String(days)],
  );
  return token;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  locale: string;
  theme: string;
  /** Email for notifications: each one at once, a daily digest, or none. */
  notifyEmail: 'instant' | 'daily' | 'off';
  /** Set when the request came with an API key instead of a session. */
  apiKey?: { id: string; orgId: string; scope: 'read' | 'write' } | null;
}

export async function userForToken(db: Queryable, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const r = await db.query<SessionUser>(
    `update sessions s set last_seen_at = now()
       from users u
      where s.token_hash = $1 and s.expires_at > now() and u.id = s.user_id
      returning u.id, u.email, u.name, u.locale, u.theme, u.notify_email as "notifyEmail"`,
    [hashToken(token)],
  );
  return r.rows[0] ?? null;
}

export async function deleteSession(db: Queryable, token: string | undefined): Promise<void> {
  if (token) await db.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}
