import { resolve } from 'node:path';

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  /** Secure cookies (HTTPS only). On in production. */
  secureCookies: boolean;
  sessionDays: number;
  /** Built web app to serve (apps/web/dist). Unset in development, where Vite serves it. */
  webDist: string | null;
  /** Public address of the app, for links in emails. */
  appUrl: string;
  /** SMTP connection URL (smtps://user:pass@host:465). Unset: emails are only logged. */
  smtpUrl: string | null;
  mailFrom: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp',
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    secureCookies: env.NODE_ENV === 'production',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    webDist: env.WEB_DIST ? resolve(env.WEB_DIST) : null,
    appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    smtpUrl: env.SMTP_URL || null,
    mailFrom: env.MAIL_FROM ?? 'WBS Master <no-reply@wbs-master.example>',
  };
}
