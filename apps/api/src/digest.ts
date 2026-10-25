// Daily notification digest: run once a day by a scheduler (Cloud Scheduler + Cloud Run job in production).
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createMailer } from './mailer.js';
import { sendDigests } from './notify.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const sent = await sendDigests(db, createMailer(config.smtpUrl, config.mailFrom), config.appUrl);
console.log(`digest: ${sent} emails sent`);
await db.end();
