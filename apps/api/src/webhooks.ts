import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { privateAddress, publicFetch } from './netguard.js';
import type { Queryable } from './db.js';

/** Events a webhook can subscribe to (spec 7.2). */
export const WEBHOOK_EVENTS = ['item.changed', 'health.changed', 'baseline.saved', 'project.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Waits before each retry; after the last one the delivery is marked failed. */
const RETRY_MINUTES = [1, 5, 30, 120, 720];
const TIMEOUT_MS = 10_000;

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/**
 * Signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the secret>`.
 * Receivers recompute it and reject old timestamps, so a captured request cannot be replayed later.
 */
export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/**
 * A webhook may only call a public HTTPS address, so it cannot be used to reach
 * the hosting network (server-side request forgery). Checked when saved, before every
 * delivery, and when the connection is made, because DNS answers can change.
 * Returns an error code, or null when the address is allowed.
 */
export async function checkWebhookUrl(raw: string, allowPrivate: boolean): Promise<string | null> {
  let url: URL;
  try { url = new URL(raw); } catch { return 'webhook_bad_url'; }
  if (url.username || url.password) return 'webhook_bad_url';
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) return 'webhook_https_only';
  if (allowPrivate) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map(a => a.address);
  } catch {
    return 'webhook_unresolvable';
  }
  return !addresses.length || addresses.some(privateAddress) ? 'webhook_private_address' : null;
}

/** Queue an event for every active webhook of the organisation that subscribes to it. */
export async function enqueueWebhookEvent(db: Queryable, orgId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
  const r = await db.query(
    `insert into webhook_deliveries (webhook_id, event, payload)
     select w.id, $2, jsonb_build_object('event', $2::text, 'createdAt', now(), 'orgId', $1::uuid, 'data', $3::jsonb)
       from webhooks w where w.org_id = $1 and w.active and $2 = any(w.events)`,
    [orgId, event, JSON.stringify(data)]);
  return r.rowCount ?? 0;
}

type Fetch = typeof fetch;

/** Send what is due: each delivery once, retried later on failure. Returns how many were attempted. */
export async function deliverDue(db: Queryable, opts: { allowPrivate: boolean; fetch?: Fetch; limit?: number }): Promise<number> {
  // outside development, connect only to public addresses, checked again as the connection is made
  const doFetch = opts.fetch ?? (opts.allowPrivate ? fetch : publicFetch);
  // claim due deliveries so two workers never send the same one
  const due = await db.query<{ id: string; event: string; payload: unknown; attempts: number; url: string; secret: string; created_at: Date }>(
    `update webhook_deliveries d set next_attempt_at = now() + interval '5 minutes'
       from webhooks w
      where d.id in (select id from webhook_deliveries where status = 'pending' and next_attempt_at <= now()
                     order by next_attempt_at limit $1 for update skip locked)
        and w.id = d.webhook_id
      returning d.id, d.event, d.payload, d.attempts, w.url, w.secret, d.created_at`, [opts.limit ?? 50]);
  // oldest first, so receivers see events in the order they happened
  due.rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  for (const d of due.rows) {
    const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
    let code: number | null = null, error: string | null = null;
    const bad = await checkWebhookUrl(d.url, opts.allowPrivate);
    if (bad) error = bad;
    else {
      try {
        const res = await doFetch(d.url, {
          method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            'content-type': 'application/json', 'user-agent': 'WBS-Master-Webhooks/1',
            'x-wbs-event': d.event, 'x-wbs-delivery': d.id, 'x-wbs-signature': sign(d.secret, body),
          },
        });
        code = res.status;
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (e) {
        error = (e as Error).name === 'TimeoutError' ? 'timeout' : 'connection_failed';
      }
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await db.query(`update webhook_deliveries set status = 'delivered', attempts = $2, response_code = $3, error = null, delivered_at = now() where id = $1`,
        [d.id, attempts, code]);
    } else {
      const wait = RETRY_MINUTES[attempts - 1];
      await db.query(
        `update webhook_deliveries set attempts = $2, response_code = $3, error = $4,
                status = case when $5::int is null then 'failed' else 'pending' end,
                next_attempt_at = now() + make_interval(mins => coalesce($5::int, 0)) where id = $1`,
        [d.id, attempts, code, error, wait ?? null]);
    }
  }
  return due.rows.length;
}

/** Runs deliveries every few seconds in the API process, and at once when an event is queued. */
export class WebhookDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private readonly db: Queryable, private readonly allowPrivate: boolean) {}

  start(everyMs = 5000) {
    this.timer ??= setInterval(() => this.kick(), everyMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  /** Deliver now (no-op when not started, so tests decide when deliveries run). */
  kick() {
    if (!this.timer || this.running) return;
    this.running = true;
    deliverDue(this.db, { allowPrivate: this.allowPrivate })
      .catch(e => console.error('webhook delivery failed', e))
      .finally(() => { this.running = false; });
  }
}
