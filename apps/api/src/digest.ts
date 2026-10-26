// The daily jobs, run once a day by a scheduler (Cloud Scheduler + Cloud Run job in production):
// the notification digest, and billing (settle missed payments, end trials and lapsed periods, reminders).
import { runDailyBilling } from './billing.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createMailer } from './mailer.js';
import { Moyasar } from './moyasar.js';
import { sendDigests } from './notify.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const mailer = createMailer(config.smtpUrl, config.mailFrom);
const sent = await sendDigests(db, mailer, config.appUrl);
console.log(`digest: ${sent} emails sent`);
const gateway = config.moyasar ? new Moyasar(config.moyasar.secretKey, config.moyasar.apiUrl) : null;
const billing = await runDailyBilling({ db, gateway, seller: config.seller, mailer, appUrl: config.appUrl, today: () => new Date() });
console.log(`billing: ${billing.settled} payments settled, ${billing.changed} plans changed, ${billing.reminders} reminders sent`);
await db.end();
