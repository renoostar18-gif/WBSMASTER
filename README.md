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

Coming next: `infra` (Terraform for Google Cloud Dammam), then notifications, single sign-on and billing.

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
it also needs `DATABASE_URL`, to put the test organisation on the Team plan). Set `CHROMIUM_PATH`
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
| Portfolio | `GET /orgs/:orgId/portfolio` (`?asOf=YYYY-MM-DD` for one status date across projects); Team and Business plans |
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
