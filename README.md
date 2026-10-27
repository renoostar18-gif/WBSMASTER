# WBS Master

Plan and track projects as a work breakdown structure: hierarchy, schedule and health in one place.
English and Arabic, hosted in Saudi Arabia.

The product specification (requirements, business rules, data dictionary, Excel spec) is the
"WBS Master – Product Requirements & Functional Specification" document.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/engine` | Calculation engine: WBS codes, status, health, roll-ups, working-day calendars, Saudi holidays, dependencies, auto-schedule, critical path, baselines, report data, Excel import parsing and the connected workbook (export, re-import, change preview). Pure TypeScript with no dependencies; runs in the browser and on the server. |
| `apps/api` | HTTP API (Fastify + PostgreSQL): sign-up and sign-in, organisations and roles, plan limits, calendars, projects, WBS edits through the engine, baselines, summary text, activity history. |
| `apps/web` | Web app (React + Vite): sign-in, projects, Table, Chart, Gantt and Summary views, baselines, activity history, inspector, keyboard shortcuts, undo/redo, project settings, live co-editing with presence. English and Arabic (right-to-left, including a mirrored Gantt), light and dark themes. Edits apply instantly in the browser with the engine, then save to the API. |
| `infra` | Terraform for production on Google Cloud, Dammam (me-central2): Cloud Run, Cloud SQL, regional HTTPS load balancer with Cloud Armor, secrets, scheduler, alerts, keyless deploys. See [infra/README.md](infra/README.md). |

Coming next: billing (KSA payment gateway, ZATCA e-invoicing).

## Develop

Requires Node.js 22, pnpm 10 and PostgreSQL 16.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env   # then point the URLs at your PostgreSQL
createdb wbs_dev && createdb wbs_test
pnpm test        # all tests (the API tests wipe TEST_DATABASE_URL)
pnpm typecheck
pnpm build
pnpm --filter @wbs-master/api dev        # API on http://localhost:3000, migrates on start
pnpm --filter @wbs-master/web dev        # web app on http://localhost:5173 (proxies /api)
```

Browser-only demo: `pnpm --filter @wbs-master/web build:demo` packs the web app into one HTML file
(`apps/web/dist-demo/wbs-master-demo.html`) where the API is simulated in the browser with the same
engine, seeded with three example projects (the 24 kV RMU, a substation upgrade and an ERP roll-out) and a
comment thread. Data stays in that browser.

Browser tests (API and web app running): `node apps/web/e2e/smoke.mjs` (one user, all views),
`node apps/web/e2e/collab.mjs` (two people editing the same project live),
`node apps/web/e2e/excel.mjs` (import a plain sheet, export, edit in Excel, re-import, undo) and
`node apps/web/e2e/portfolio.mjs` (portfolio views; comments, mentions and resolving between two people;
it also needs `DATABASE_URL`, to put the test organisation on the Team plan) and
`node apps/web/e2e/notifications.mjs` (a mention and an assignment reach the bell and open the item) and
`node apps/web/e2e/integrations.mjs` (API keys and a webhook from Settings; also needs `DATABASE_URL`) and
`node apps/web/e2e/sso.mjs` (single sign-on with a fake identity provider; the API needs `SSO_ALLOW_HTTP=1`
and `APP_URL` set to the web address) and `node apps/web/e2e/invites.mjs` (inviting from the Members page and joining from the link; needs `DATABASE_URL`) and
`node apps/web/e2e/billing.mjs` (trial, then paying on a fake Moyasar page;
start `node apps/web/e2e/fake-moyasar.mjs` first and the API with `MOYASAR_SECRET_KEY=sk_test_e2e
MOYASAR_WEBHOOK_SECRET=whsec_e2e MOYASAR_API_URL=http://127.0.0.1:4010/v1`). Set `CHROMIUM_PATH`
to use an installed Chromium, and `WEB_URL` to test another address.

## Portfolio and comments

- **Portfolio** (Team and Business plans) shows every active project the person can see, worst first:
  Delayed, At risk, On track, then the largest finish slip. *Executives* gives headline figures,
  decisions and risks (suggested from the critical path until people write their own), a roadmap of
  plan against forecast, the trend of each project's finish slip, and milestones in the next 60 days.
  *Project team* lists overdue work, work due or starting in the next 14, 30 or 60 days, early warnings
  (waiting for late work, late start, on hold, 25+ points behind plan) and workload per owner. Both
  copy as plain text for email or Teams. The trend is one point per project per day, saved when the
  project changes or the portfolio is opened.
- **Comments** are threads on an item or on the whole project. Typing `@` suggests the people who can
  see the project; replies reopen a resolved thread; "Open threads only" filters the rest out.
  Commenters can comment without being able to edit, viewers can read only, and everyone viewing the
  project sees new comments without reloading.

## Notifications

The bell (top bar) lists what needs the person's attention (spec 7.1): being @mentioned, replies in
threads they are part of, an item assigned to them (its owner text is their name or email), their
items turning red after an edit, and baselines saved on their projects. Nobody is told about their own
change. Each notification links to the item, opening its comments for mentions and replies.

Email follows each person's choice in the bell menu: each one straight away (default), a daily digest,
or none. Emails are in the person's language (Arabic right to left) and link back to the app.

| Setting | Meaning |
| --- | --- |
| `SMTP_URL` | SMTP server, e.g. `smtps://user:password@smtp.example.com:465`. Unset: emails are only logged. |
| `MAIL_FROM` | Sender, e.g. `WBS Master <no-reply@your-domain>` |
| `APP_URL` | Public address of the app, for links in emails |

The daily digest is `pnpm --filter @wbs-master/api digest` (`node apps/api/dist/digest.js`), run once
a day by a scheduler. The bell checks for new notifications every minute and whenever the page
regains focus. Not yet covered: items that turn red only because time passed (no edit), and
Teams/Slack delivery.

## Public API and webhooks

Team and Business plans (spec 7.2). The reference is served at `/api/docs`, and the OpenAPI 3.1
description at `/api/openapi.json`.

- **API keys** (Settings → API & webhooks): `Authorization: Bearer wbsm_…`. A key acts with its
  owner's permissions in one organisation, read-only or read-and-change, and cannot sign in, change the
  account or make other keys. Only a hash is stored. 300 requests a minute per key (`API_RATE_LIMIT`);
  sign-in and sign-up are limited to 20 a minute per address (`AUTH_RATE_LIMIT`; set `TRUST_PROXY=1`
  behind a load balancer so the client's address is used).
- **Webhooks** (organisation admins): `item.changed`, `health.changed`, `baseline.saved`,
  `project.created`, signed with HMAC-SHA256 (`X-WBS-Signature: t=…,v1=…`), retried after 1, 5, 30, 120
  and 720 minutes. Only public https addresses are allowed in production, checked again before every
  delivery; `WEBHOOK_ALLOW_PRIVATE=1` allows local addresses (the default outside production). The API
  process delivers them; with several instances each claims different deliveries.

## Single sign-on

Business plan (spec 7.2). Each organisation connects one OpenID Connect provider (Microsoft Entra ID,
Google Workspace, or another provider) in Settings → Single sign-on:

1. **Prove the email domains.** Add a domain and publish the TXT record shown
   (`wbs-master-verification=…`), then select Verify. Personal email domains (gmail.com, outlook.com
   and so on) are refused. Only one organisation can prove a domain, and only proved domains are used
   for SSO, so an organisation cannot take over another company's people.
2. **Connect the provider.** Register the redirect address shown (`<APP_URL>/api/auth/sso/callback`) in
   the provider. Then enter the tenant ID (Entra ID) or issuer address, the client ID and the client
   secret. The secret is stored encrypted with `SECRET_KEY` (AES-256-GCM).
3. **Choose:**
   - whether people from the proved domains join automatically on their first sign-in;
   - whether SSO is required, which turns password sign-in and sign-up off for those domains.

On the sign-in page, "Sign in with your company account" asks for the work email and sends the person
to their organisation's provider (authorization code with PKCE, state and nonce). On the way back the
ID token is checked: signature, issuer, audience and nonce. The email's domain must be one the
organisation proved; for Google, the account must belong to that Workspace (`hd`). An existing account
with the same email is signed in, not duplicated.

| Setting | Meaning |
| --- | --- |
| `SECRET_KEY` | 32+ characters; encrypts SSO client secrets. Without it in production, SSO is unavailable (the rest works). |
| `SSO_ALLOW_HTTP=1` | Allows a provider on plain http (local tests only; ignored in production). |

## Members and invitations

Admins manage people on the Members page (`/members/:orgId`). Adding an email that already has an
account adds the person at once and tells them by email. Anyone else gets an invitation email (English
and Arabic) with a link, valid for 14 days, to create their account and join. Someone who already has an
account signs in from the link and comes back to it. A link only works for the email it was sent to, and
only once; sending again makes a new link and the old one stops working. Open invitations for members
hold a seat, so an organisation cannot invite more people than its plan or paid seats allow.

## Billing

Owners manage the plan on the Billing page (`/billing/:orgId`). Prices are in SAR: Team SAR 45 and Business
SAR 90 per seat a month, or SAR 432 and SAR 864 a year (20% off). Members need a seat; guests are free.

- **Free trial:** 14 days of Team or Business, once per organisation, no card.
- **Paying:** prepaid, a month or a year at a time, on [Moyasar](https://moyasar.com)'s hosted page (mada,
  Visa, Mastercard, Apple Pay). Nothing is charged automatically; owners get reminders 7 days and 1 day
  before the end, and the plan carries on for 7 grace days after it.
- **Changes:** moving up (a higher plan or more seats) is charged now for the days left in the period.
  Moving down, or switching between monthly and annual, applies at renewal.
- **Only Moyasar decides what is paid.** The return from the payment page, Moyasar's webhook and its
  invoice callback each only name a checkout; the app then fetches that invoice from Moyasar and turns the
  plan on only if Moyasar says it is paid, for the right amount in SAR. The daily job also checks unpaid
  checkouts, in case a notification never arrives.
- **After a plan ends** nothing is deleted. On Free, the oldest three active projects stay editable and the
  rest become read-only until the organisation upgrades or archives some.
- **Invoices** are numbered without gaps (INV-000001…), in English and Arabic, printable as PDF. With
  `VAT_ENABLED=1`, 15% VAT is added and shown on invoices; without it, invoices say no VAT is charged.
  With `SELLER_VAT_NUMBER` set they are tax invoices with the VAT number and the ZATCA QR code
  (phase 1). Invoices already issued keep the seller details they were issued with.
- **Pilots:** `update organisations set comp_plan = 'business' where id = …` gives a plan free of charge.

| Setting | Meaning |
| --- | --- |
| `MOYASAR_SECRET_KEY` | Moyasar secret key (`sk_test_…` or `sk_live_…`). Unset: plans cannot be bought; trials still work. |
| `MOYASAR_WEBHOOK_SECRET` | The secret token set on the webhook in Moyasar's dashboard; webhooks with another token are refused. |
| `MOYASAR_API_URL` | Defaults to `https://api.moyasar.com/v1` (tests point it at a fake). |
| `SELLER_NAME`, `SELLER_NAME_AR`, `SELLER_ADDRESS`, `SELLER_CR` | The seller printed on invoices. |
| `SELLER_VAT_NUMBER` | With it, invoices are tax invoices with the ZATCA QR code. |
| `VAT_ENABLED` | `1` adds 15% VAT to prices, `0` does not. Unset: on only with a VAT number. Only VAT-registered sellers may charge VAT. |

In Moyasar's dashboard, add a webhook to `https://<your domain>/api/billing/moyasar/notify` for paid
payments, with the same secret token. Before going live, make one test payment with the test keys and
check the plan turns on: the field names used are in `apps/api/src/moyasar.ts`.

## Excel

Excel runs in the browser (ExcelJS, loaded only when used), so files never pass through the server
as files; an import becomes ordinary editing operations.

- **Import any sheet** (.xlsx, .xlsm, .csv): columns are matched by name in English or Arabic, and
  levels come from a WBS code column, numbering in names (1.2 Design), or grouping columns such as
  Phase (the app suggests one). Day-first or month-first dates, Excel date numbers, 85% or 0.85.
  Add to the open project or create a new one. Old .xls files must be saved as .xlsx first.
- **Export** gives the connected workbook: WBS (17 editable columns plus read-only results),
  Summary, Baselines and a Read me, in the app's language and direction.
- **Re-import** that workbook to bring Excel edits back: the app lists what changed, added and
  removed before applying, and one Undo reverses it all.

Production: `docker build -t wbs-master .` gives one image that serves the API and the web app on port
8080 and migrates the database on start (several instances may start together: migrations take a lock,
and live updates are shared through Postgres). Releases go to Google Cloud with the *Deploy* workflow;
setting up the hosting is in [infra/README.md](infra/README.md). Without Docker: `pnpm build`, then
`node apps/api/dist/server.js` with `WEB_DIST=apps/web/dist`.

## API overview

All routes are under `/api` and use a session cookie set by sign-up or sign-in.
Errors return `{ "error": "<code>" }` with a stable code the web app translates.

| Area | Routes |
| --- | --- |
| Account | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /me`, `PATCH /me` |
| Organisations | `POST /orgs`, `PATCH /orgs/:orgId`, `GET/POST /orgs/:orgId/members`, `PATCH/DELETE /orgs/:orgId/members/:userId` |
| Calendars | `GET/POST /orgs/:orgId/calendars`, `PATCH /orgs/:orgId/calendars/:id`, `POST /orgs/:orgId/calendars/:id/exceptions` (or `{ "saudiYear": 2027 }`), `DELETE .../exceptions/:date` |
| Projects | `GET/POST /orgs/:orgId/projects`, `GET/PATCH/DELETE /projects/:id` |
| Editing | `POST /projects/:id/ops` with `{ "ops": [...] }`: `add`, `set`, `move`, `delete`, `link`, `unlink`, `setLag`, `setDeps`. A batch is all-or-nothing and ends with auto-schedule. |
| Sharing | `GET /projects/:id/members`, `PUT/DELETE /projects/:id/members/:userId` |
| Baselines | `POST /projects/:id/baselines`, `PATCH/DELETE /projects/:id/baselines/:bid`, `POST .../:bid/restore` |
| Reporting | `PUT /projects/:id/summary`, `GET /projects/:id/activity` |
| Portfolio | `GET /orgs/:orgId/portfolio` (`?asOf=YYYY-MM-DD` for one status date across projects); Team and Business plans |
| API keys | `GET/POST /me/api-keys`, `DELETE /me/api-keys/:id` (signed-in sessions only) |
| Webhooks | `GET/POST /orgs/:orgId/webhooks`, `PATCH/DELETE .../:id`, `POST .../:id/test`, `GET .../:id/deliveries` |
| Single sign-on | `GET/PUT/DELETE /orgs/:orgId/sso`, `POST /orgs/:orgId/sso/domains`, `POST .../domains/:domain/verify`, `DELETE .../domains/:domain`; `POST /auth/sso/start` (`{ email }` → `{ url }`), `GET /auth/sso/callback` |
| Invitations | `POST /orgs/:orgId/members` (`{ email, role }`: adds or invites), `GET /orgs/:orgId/invitations`, `POST .../invitations/:id/resend`, `DELETE .../invitations/:id`; `GET /invitations/:token`, `POST /invitations/:token/accept`; `POST /auth/signup` with `invite` |
| Billing (owners, signed-in sessions only) | `GET /orgs/:orgId/billing`, `PUT .../billing/profile`, `POST .../billing/trial`, `POST .../billing/quote` and `.../billing/checkout` (`{ plan, interval, seats, renew? }`; checkout → `{ url }` of Moyasar's page), `GET .../billing/invoices/:id` (HTML); `GET /billing/return`, `POST /billing/moyasar/notify` |
| Notifications | `GET /notifications`, `GET /notifications/unread`, `POST /notifications/read` (`{ ids }`, or all); `PATCH /me` with `notifyEmail`: `instant`, `daily` or `off` |
| Comments | `GET/POST /projects/:id/comments`, `PATCH/DELETE /projects/:id/comments/:cid`, `POST .../:cid/resolve`, `GET /projects/:id/people` (who can be mentioned) |
| Live | WebSocket `GET /projects/:id/live`: `presence` (who is viewing, what each has selected) and `changed` (a new version was saved) messages; send `{ "type": "select", "itemId": … }` to share a selection. One API process holds the connections; several instances will need Redis pub/sub. |

`GET /projects/:id` returns the stored project plus `computed`: codes, health, variance, roll-ups and the critical path from the engine.

## How the engine is tested

- `test/oracle.test.ts` runs 3,000 random projects through the engine and through the original
  WBS Builder prototype's calculation code (`test/reference/prototype.ts`, kept unchanged).
  With every day a working day, both must give identical results. Scheduling is compared on
  2,000 more.
- The other tests cover working-day behaviour (Saudi week, holidays, weekend slips), edits,
  baselines, links, reports and import parsing.

### Deliberate differences from the prototype

1. Durations, lags, variance, planned % and the red threshold count **working days** from the
   project calendar (default Sunday–Thursday). The prototype counted calendar days.
2. An undated successor gets a **5-working-day** block (prototype: 7 calendar days).
3. Auto-schedule never moves a finish before its start. The prototype could, when an item had a
   forecast start but no forecast finish and an earlier planned finish.
4. Importing the status "Not started" gives Not started. The prototype read it as In progress.
5. Typing a planned start and then a planned finish fills the whole forecast. The prototype left a
   one-day forecast.

Undo and redo work by computing the edits between two versions (`diffToOps`), so an undo is saved
like any other edit. A `put` edit restores stored values exactly, including dates a parent kept
from before it had sub-items.

All rights reserved.
