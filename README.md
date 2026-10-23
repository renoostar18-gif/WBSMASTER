# WBS Master

Plan and track projects as a work breakdown structure: hierarchy, schedule and health in one place.
English and Arabic, hosted in Saudi Arabia.

The product specification (requirements, business rules, data dictionary, Excel spec) is the
"WBS Master – Product Requirements & Functional Specification" document.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/engine` | Calculation engine: WBS codes, status, health, roll-ups, working-day calendars, Saudi holidays, dependencies, auto-schedule, critical path, baselines, report data, Excel import parsing. Pure TypeScript with no dependencies; runs in the browser and on the server. |
| `apps/api` | HTTP API (Fastify + PostgreSQL): sign-up and sign-in, organisations and roles, plan limits, calendars, projects, WBS edits through the engine, baselines, summary text, activity history. |

| `apps/web` | Web app (React + Vite): sign-in, projects, the Table view with inline editing, inspector, keyboard shortcuts, undo/redo, project settings. English and Arabic (right-to-left), light and dark themes. Edits apply instantly in the browser with the engine, then save to the API. |

Coming next: Chart and Gantt views, real-time co-editing, then `infra` (Terraform for Google Cloud Dammam).

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

Browser smoke test (API and web app running): `node apps/web/e2e/smoke.mjs`. Set `CHROMIUM_PATH`
to use an installed Chromium, and `WEB_URL` to test another address.

Production: `pnpm build`, then run `node apps/api/dist/server.js` with `WEB_DIST=apps/web/dist`;
the API serves the web app and migrates the database on start.

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
