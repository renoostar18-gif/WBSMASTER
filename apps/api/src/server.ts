import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { WebhookDispatcher } from './webhooks.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
await migrate(db);
const webhooks = new WebhookDispatcher(db, config.webhookAllowPrivate);
const app = buildApp({ db, config, webhooks });
await app.listen({ port: config.port, host: config.host });
webhooks.start();
console.log(`WBS Master API listening on http://${config.host}:${config.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    webhooks.stop();
    await app.close();
    await db.end();
    process.exit(0);
  });
}
