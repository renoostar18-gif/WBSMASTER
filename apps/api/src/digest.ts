// The daily jobs, run once a day by a scheduler (Cloud Scheduler + Cloud Run job in production):
// the notification digest, billing (settle missed payments, end trials and lapsed periods, reminders),
// deleting organisations whose 30 days are over, and trimming history to each plan's retention.
import { toIso, todayDay } from '@wbs-master/engine';
import { pruneHistory } from './audit.js';
import { runDailyBilling } from './billing.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createMailer } from './mailer.js';
import { Moyasar } from './moyasar.js';
import { sendDigests } from './notify.js';
import { runDailyDeletions } from './orgadmin.js';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const mailer = createMailer(config.smtpUrl, config.mailFrom);
const sent = await sendDigests(db, mailer, config.appUrl);
console.log(`digest: ${sent} emails sent`);
const gateway = config.moyasar ? new Moyasar(config.moyasar.secretKey, config.moyasar.apiUrl) : null;
const billing = await runDailyBilling({ db, gateway, seller: config.seller, mailer, appUrl: config.appUrl, today: () => new Date() });
console.log(`billing: ${billing.settled} payments settled, ${billing.changed} plans changed, ${billing.reminders} reminders sent`);
const deleted = await runDailyDeletions({ db, mailer, appUrl: config.appUrl, today: () => new Date() });
console.log(`organisations: ${deleted} deleted after their waiting period`);
// after billing, so each organisation's plan is the one in force today
const pruned = await pruneHistory(db, toIso(todayDay(new Date()))!);
console.log(`history: ${pruned.activity} activity and ${pruned.audit} audit entries past their plan's retention deleted`);
await db.end();
