import { randomBytes, timingSafeEqual } from 'node:crypto';
import { type SessionUser, hashToken } from './auth.js';
import type { Queryable } from './db.js';

/**
 * Personal API keys (spec 7.2): `wbsm_<prefix>_<secret>`. The key acts with its
 * owner's permissions, in one organisation, read-only or read-write. Only a
 * hash of it is stored; the full key is shown once, when it is created.
 */
export function newApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString('hex');
  const key = `wbsm_${prefix}_${randomBytes(24).toString('base64url')}`;
  return { key, prefix, hash: hashToken(key) };
}

const FORMAT = /^wbsm_([0-9a-f]{12})_[A-Za-z0-9_-]{32}$/;

/** The person behind an API key, or null for an unknown, revoked or malformed key. */
export async function userForApiKey(db: Queryable, key: string): Promise<SessionUser | null> {
  const m = FORMAT.exec(key);
  if (!m) return null;
  const r = await db.query<SessionUser & { key_id: string; key_hash: string; org_id: string; scope: 'read' | 'write'; last_used_at: Date | null }>(
    `select u.id, u.email, u.name, u.locale, u.theme, u.notify_email as "notifyEmail",
            k.id as key_id, k.key_hash, k.org_id, k.scope, k.last_used_at
       from api_keys k join users u on u.id = k.user_id
      where k.prefix = $1 and k.revoked_at is null`, [m[1]]);
  const row = r.rows[0];
  if (!row) return null;
  const a = Buffer.from(row.key_hash), b = Buffer.from(hashToken(key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // note when a key was last used (at most once a minute, to keep requests cheap)
  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) {
    await db.query('update api_keys set last_used_at = now() where id = $1', [row.key_id]);
  }
  const { key_id, key_hash: _h, org_id, scope, last_used_at: _l, ...user } = row;
  return { ...user, apiKey: { id: key_id, orgId: org_id, scope } };
}
