import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { type SessionUser, userForToken } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { ApiError } from './errors.js';
import { userForApiKey } from './apikeys.js';
import { renderApiDocs } from './apidocs.js';
import { openApi } from './openapi.js';
import { LiveHub } from './live.js';
import { type Mailer, createMailer } from './mailer.js';
import { RateLimiter } from './ratelimit.js';
import { integrationRoutes } from './routes/integrations.js';
import { ssoRoutes } from './routes/sso.js';
import { billingRoutes } from './routes/billing.js';
import type { PaymentGateway } from './moyasar.js';
import { WebhookDispatcher } from './webhooks.js';
import { OpError } from './ops.js';
import { authRoutes } from './routes/auth.js';
import { calendarRoutes } from './routes/calendars.js';
import { orgRoutes } from './routes/orgs.js';
import { liveRoutes } from './routes/live.js';
import { notificationRoutes } from './routes/notifications.js';
import { commentRoutes } from './routes/comments.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { projectRoutes } from './routes/projects.js';

export const SESSION_COOKIE = 'wbs_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AppDeps {
  db: Db;
  config: Config;
  /** Fixed "today" for tests; real clock otherwise. */
  today?: () => Date;
  /** Live updates hub; created by buildApp when not given. */
  live?: LiveHub;
  /** Email sender; created from the config by buildApp when not given. */
  mailer?: Mailer;
  /** DNS TXT lookup for SSO domain verification; tests replace it. */
  resolveTxt?: (name: string) => Promise<string[]>;
  /** Webhook delivery worker; started by the server, not in tests (which deliver on demand). */
  webhooks?: WebhookDispatcher;
  /** Payment gateway; Moyasar from the config when not given (tests give a fake). */
  gateway?: PaymentGateway;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  deps.live ??= new LiveHub();
  deps.mailer ??= createMailer(deps.config.smtpUrl, deps.config.mailFrom);
  deps.webhooks ??= new WebhookDispatcher(deps.db, deps.config.webhookAllowPrivate);
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: deps.config.trustProxy });
  app.register(cookie);
  app.register(websocket);
  app.decorateRequest('user', null);
  const keyLimit = new RateLimiter(deps.config.apiRateLimit);
  const authLimit = new RateLimiter(deps.config.authRateLimit);

  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    // sign-in and sign-up: limit guessing from one address
    if (req.method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/signup' || path === '/api/auth/sso/start')) {
      const r = authLimit.hit(`ip:${req.ip}`);
      if (!r.ok) { reply.header('retry-after', r.retryAfter); throw new ApiError(429, 'rate_limited'); }
    }
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!bearer) {
      req.user = await userForToken(deps.db, req.cookies[SESSION_COOKIE]);
      return;
    }
    // API key (spec 7.2): the owner's permissions, in one organisation, rate-limited
    req.user = await userForApiKey(deps.db, bearer);
    if (!req.user) throw new ApiError(401, 'invalid_api_key');
    const r = keyLimit.hit(`key:${req.user.apiKey!.id}`);
    reply.header('x-ratelimit-limit', keyLimit.limit);
    if (!r.ok) { reply.header('retry-after', r.retryAfter); throw new ApiError(429, 'rate_limited'); }
    reply.header('x-ratelimit-remaining', r.remaining);
    if (req.user.apiKey!.scope === 'read' && req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(403, 'key_read_only');
    // a key cannot sign in, make keys or organisations, or change the person's account
    if (path.startsWith('/api/auth/') || path.startsWith('/api/me') || (req.method === 'POST' && path === '/api/orgs')) {
      if (!(req.method === 'GET' && path === '/api/me')) throw new ApiError(403, 'not_with_api_key');
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) return reply.status(err.status).send({ error: err.code, details: err.details });
    if (err instanceof OpError) return reply.status(400).send({ error: err.code, opIndex: err.index, details: err.details });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid_request', details: err.issues });
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.status(409).send({ error: 'already_exists' });
    if (pgCode === '22P02') return reply.status(404).send({ error: 'not_found' }); // malformed uuid in a path
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'invalid_request' });
    app.log.error(err);
    return reply.status(500).send({ error: 'server_error' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.register(authRoutes(deps), { prefix: '/api' });
  app.register(orgRoutes(deps), { prefix: '/api' });
  app.register(calendarRoutes(deps), { prefix: '/api' });
  app.register(projectRoutes(deps), { prefix: '/api' });
  app.register(portfolioRoutes(deps), { prefix: '/api' });
  app.register(commentRoutes(deps), { prefix: '/api' });
  app.register(notificationRoutes(deps), { prefix: '/api' });
  app.register(integrationRoutes(deps), { prefix: '/api' });
  app.register(ssoRoutes(deps), { prefix: '/api' });
  app.register(billingRoutes(deps), { prefix: '/api' });
  app.get('/api/openapi.json', async () => openApi);
  const docs = renderApiDocs();
  app.get('/api/docs', async (_req, reply) => reply.type('text/html; charset=utf-8').send(docs));
  app.register(liveRoutes(deps), { prefix: '/api' });

  // production: serve the web app, and its index.html for any page route (client-side routing)
  const dist = deps.config.webDist;
  if (dist && existsSync(dist)) {
    app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'not_found' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found' }));
  }
  return app;
}

/** The signed-in user, or 401. */
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new ApiError(401, 'not_signed_in');
  return req.user;
}

/** The browser tab that made a change (header x-wbs-client), so that tab can skip its own live announcement. */
export function clientOf(req: { headers: Record<string, unknown> }): string | null {
  const v = req.headers['x-wbs-client'];
  return typeof v === 'string' ? v.slice(0, 64) : null;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function setSessionCookie(reply: FastifyReply, token: string, deps: AppDeps) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: deps.config.secureCookies,
    maxAge: deps.config.sessionDays * 86400,
  });
}
