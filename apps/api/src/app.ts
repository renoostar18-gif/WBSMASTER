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
import { LiveHub } from './live.js';
import { OpError } from './ops.js';
import { authRoutes } from './routes/auth.js';
import { calendarRoutes } from './routes/calendars.js';
import { orgRoutes } from './routes/orgs.js';
import { liveRoutes } from './routes/live.js';
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
}

export function buildApp(deps: AppDeps): FastifyInstance {
  deps.live ??= new LiveHub();
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  app.register(cookie);
  app.register(websocket);
  app.decorateRequest('user', null);

  app.addHook('preHandler', async req => {
    req.user = await userForToken(deps.db, req.cookies[SESSION_COOKIE]);
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
