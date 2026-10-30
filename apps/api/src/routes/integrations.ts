import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { newApiKey } from '../apikeys.js';
import { type AppDeps, parse, requireUser } from '../app.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { orgAccess } from '../permissions.js';
import { audit, by } from '../audit.js';
import { PLANS } from '../plans.js';
import { WEBHOOK_EVENTS, checkWebhookUrl, enqueueWebhookEvent, newWebhookSecret } from '../webhooks.js';

type W = { Params: { orgId: string; webhookId: string } };

/** API keys (any member, for themselves) and webhooks (organisation admins), spec 7.2. Team and Business plans. */
export const integrationRoutes = (deps: AppDeps): FastifyPluginAsync => async app => {
  // ---- API keys ----
  app.get('/me/api-keys', async req => {
    const user = requireUser(req);
    const r = await deps.db.query(
      `select k.id, k.name, k.prefix, k.scope, k.org_id as "orgId", o.name as "orgName", k.created_at as "createdAt", k.last_used_at as "lastUsedAt"
         from api_keys k join organisations o on o.id = k.org_id
        where k.user_id = $1 and k.revoked_at is null order by k.created_at desc`, [user.id]);
    return { keys: r.rows };
  });

  app.post('/me/api-keys', async (req, reply) => {
    const user = requireUser(req);
    const b = parse(z.object({ name: z.string().trim().min(1).max(120), orgId: z.string().uuid(), scope: z.enum(['read', 'write']) }), req.body);
    const acc = await orgAccess(deps.db, user, b.orgId, 'member');
    if (!PLANS[acc.plan].api) throw forbidden('plan_api');
    const k = newApiKey();
    const r = await deps.db.query<{ id: string }>(
      'insert into api_keys (user_id, org_id, name, prefix, key_hash, scope) values ($1, $2, $3, $4, $5, $6) returning id',
      [user.id, b.orgId, b.name, k.prefix, k.hash, b.scope]);
    await audit(deps.db, b.orgId, by(req), 'api_key.created', b.name, { keyId: r.rows[0]!.id, prefix: k.prefix, scope: b.scope });
    // the only time the full key is shown
    return reply.status(201).send({ id: r.rows[0]!.id, key: k.key, prefix: k.prefix });
  });

  app.delete<{ Params: { keyId: string } }>('/me/api-keys/:keyId', async req => {
    const user = requireUser(req);
    const r = await deps.db.query<{ org_id: string; name: string; prefix: string }>(
      'update api_keys set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning org_id, name, prefix', [req.params.keyId, user.id]);
    const k = r.rows[0];
    if (!k) throw notFound('api_key_not_found');
    await audit(deps.db, k.org_id, by(req), 'api_key.revoked', k.name, { keyId: req.params.keyId, prefix: k.prefix });
    return { ok: true };
  });

  // ---- webhooks ----
  async function admin(req: Parameters<typeof requireUser>[0], orgId: string) {
    const user = requireUser(req);
    const acc = await orgAccess(deps.db, user, orgId, 'admin');
    if (!PLANS[acc.plan].api) throw forbidden('plan_api');
    return user;
  }
  const hookBody = z.object({
    url: z.string().trim().max(2000),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
    active: z.boolean(),
  });
  const COLS = `id, url, events, active, created_at as "createdAt",
    (select json_build_object('status', d.status, 'responseCode', d.response_code, 'error', d.error, 'at', coalesce(d.delivered_at, d.created_at))
       from webhook_deliveries d where d.webhook_id = webhooks.id order by d.created_at desc limit 1) as "lastDelivery"`;

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/webhooks', async req => {
    await admin(req, req.params.orgId);
    const r = await deps.db.query(`select ${COLS} from webhooks where org_id = $1 order by created_at`, [req.params.orgId]);
    return { webhooks: r.rows, events: WEBHOOK_EVENTS };
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/webhooks', async (req, reply) => {
    const user = await admin(req, req.params.orgId);
    const b = parse(hookBody.partial({ active: true }), req.body);
    const bad = await checkWebhookUrl(b.url, deps.config.webhookAllowPrivate);
    if (bad) throw badRequest(bad);
    const secret = newWebhookSecret();
    const r = await deps.db.query<{ id: string }>(
      'insert into webhooks (org_id, url, secret, events, active, created_by) values ($1, $2, $3, $4, $5, $6) returning id',
      [req.params.orgId, b.url, secret, [...new Set(b.events)], b.active ?? true, user.id]);
    await audit(deps.db, req.params.orgId, by(req), 'webhook.created', b.url, { webhookId: r.rows[0]!.id, events: [...new Set(b.events)] });
    // the secret is shown once, so the receiver can check signatures
    return reply.status(201).send({ id: r.rows[0]!.id, secret });
  });

  app.patch<W>('/orgs/:orgId/webhooks/:webhookId', async req => {
    await admin(req, req.params.orgId);
    const b = parse(hookBody.partial(), req.body);
    if (b.url !== undefined) {
      const bad = await checkWebhookUrl(b.url, deps.config.webhookAllowPrivate);
      if (bad) throw badRequest(bad);
    }
    const r = await deps.db.query<{ url: string }>(
      `update webhooks set url = coalesce($3, url), events = coalesce($4, events), active = coalesce($5, active)
        where id = $1 and org_id = $2 returning url`,
      [req.params.webhookId, req.params.orgId, b.url ?? null, b.events ? [...new Set(b.events)] : null, b.active ?? null]);
    if (!r.rows[0]) throw notFound('webhook_not_found');
    await audit(deps.db, req.params.orgId, by(req), 'webhook.updated', r.rows[0].url, { webhookId: req.params.webhookId, ...b });
    return { ok: true };
  });

  app.delete<W>('/orgs/:orgId/webhooks/:webhookId', async req => {
    await admin(req, req.params.orgId);
    const r = await deps.db.query<{ url: string }>('delete from webhooks where id = $1 and org_id = $2 returning url', [req.params.webhookId, req.params.orgId]);
    if (!r.rows[0]) throw notFound('webhook_not_found');
    await audit(deps.db, req.params.orgId, by(req), 'webhook.deleted', r.rows[0].url, { webhookId: req.params.webhookId });
    return { ok: true };
  });

  /** Send a "ping" to check the receiver, whatever events the webhook subscribes to. */
  app.post<W>('/orgs/:orgId/webhooks/:webhookId/test', async req => {
    await admin(req, req.params.orgId);
    const r = await deps.db.query(
      `insert into webhook_deliveries (webhook_id, event, payload)
       select id, 'ping', jsonb_build_object('event', 'ping', 'createdAt', now(), 'orgId', org_id, 'data', '{}'::jsonb)
         from webhooks where id = $1 and org_id = $2`, [req.params.webhookId, req.params.orgId]);
    if (!r.rowCount) throw notFound('webhook_not_found');
    deps.webhooks?.kick();
    return { ok: true };
  });

  app.get<W>('/orgs/:orgId/webhooks/:webhookId/deliveries', async req => {
    await admin(req, req.params.orgId);
    const r = await deps.db.query(
      `select d.id, d.event, d.status, d.attempts, d.response_code as "responseCode", d.error, d.created_at as "createdAt",
              d.delivered_at as "deliveredAt", d.next_attempt_at as "nextAttemptAt"
         from webhook_deliveries d join webhooks w on w.id = d.webhook_id
        where w.id = $1 and w.org_id = $2 order by d.created_at desc limit 50`, [req.params.webhookId, req.params.orgId]);
    return { deliveries: r.rows };
  });
};

/** Queue a webhook event and start delivering it. Never fails the request that caused it. */
export async function emitEvent(deps: AppDeps, orgId: string, event: (typeof WEBHOOK_EVENTS)[number], data: Record<string, unknown>) {
  try {
    if (await enqueueWebhookEvent(deps.db, orgId, event, data)) deps.webhooks?.kick();
  } catch (e) {
    console.error('webhook event failed', event, e);
  }
}
