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
  /** Requests per minute for each API key, and sign-in or sign-up attempts per minute from one address. */
  apiRateLimit: number;
  authRateLimit: number;
  /** Requests per minute from one address to public read-only links. */
  shareRateLimit: number;
  /** Behind a load balancer (Cloud Run): take the client address from X-Forwarded-For. */
  trustProxy: boolean;
  /** Allow webhooks to private and local addresses (development and tests only). */
  webhookAllowPrivate: boolean;
  /** Encrypts secrets kept in the database (SSO client secrets). Without it in production, SSO cannot be set up. */
  secretKey: string | null;
  /** Allow SSO providers on plain http (tests and local development only). */
  ssoAllowHttp: boolean;
  /** Moyasar payment gateway. Unset: paid plans cannot be bought (trials still work). */
  moyasar: { secretKey: string; webhookSecret: string | null; apiUrl: string } | null;
  /** The seller printed on invoices. With a VAT number, invoices are tax invoices with the ZATCA QR code. */
  seller: Seller;
  /** Add 15% VAT to prices (VAT_ENABLED=1 or 0). By default on only when the seller has a VAT number. */
  vatEnabled: boolean;
}

export interface Seller {
  name: string;
  nameAr: string;
  address: string;
  cr: string | null;
  vatNumber: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp',
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    // SECURE_COOKIES=0 only for testing a production build over plain http on one machine
    secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === '1' : env.NODE_ENV === 'production',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
    webDist: env.WEB_DIST ? resolve(env.WEB_DIST) : null,
    appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    smtpUrl: env.SMTP_URL || null,
    mailFrom: env.MAIL_FROM ?? 'WBS Master <no-reply@wbs-master.example>',
    apiRateLimit: Number(env.API_RATE_LIMIT ?? 300),
    authRateLimit: Number(env.AUTH_RATE_LIMIT ?? 20),
    shareRateLimit: Number(env.SHARE_RATE_LIMIT ?? 60),
    trustProxy: env.TRUST_PROXY === '1',
    webhookAllowPrivate: env.WEBHOOK_ALLOW_PRIVATE ? env.WEBHOOK_ALLOW_PRIVATE === '1' : env.NODE_ENV !== 'production',
    secretKey: secretKey(env),
    ssoAllowHttp: env.NODE_ENV !== 'production' && env.SSO_ALLOW_HTTP === '1',
    moyasar: env.MOYASAR_SECRET_KEY ? {
      secretKey: env.MOYASAR_SECRET_KEY,
      webhookSecret: env.MOYASAR_WEBHOOK_SECRET || null,
      apiUrl: (env.MOYASAR_API_URL ?? 'https://api.moyasar.com/v1').replace(/\/$/, ''),
    } : null,
    seller: {
      name: env.SELLER_NAME || 'Raysha',
      nameAr: env.SELLER_NAME_AR || 'ريشة',
      address: env.SELLER_ADDRESS ?? '',
      cr: env.SELLER_CR || null,
      vatNumber: env.SELLER_VAT_NUMBER || null,
    },
    vatEnabled: env.VAT_ENABLED ? env.VAT_ENABLED === '1' : !!env.SELLER_VAT_NUMBER,
  };
}

function secretKey(env: NodeJS.ProcessEnv): string | null {
  if (env.SECRET_KEY && env.SECRET_KEY.length >= 32) return env.SECRET_KEY;
  if (env.NODE_ENV === 'production') return null;
  return 'development-only-secret-key-do-not-use-in-production';
}
