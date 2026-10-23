export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  /** Secure cookies (HTTPS only). On in production. */
  secureCookies: boolean;
  sessionDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp',
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    secureCookies: env.NODE_ENV === 'production',
    sessionDays: Number(env.SESSION_DAYS ?? 30),
  };
}
