# WBS Master

Plan and track projects as a work breakdown structure: hierarchy, schedule and health in one place.
English and Arabic, hosted in Saudi Arabia.

The product specification (requirements, business rules, data dictionary, Excel spec) is the
"WBS Master – Product Requirements & Functional Specification" document.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/engine` | Calculation engine: WBS codes, status, health, roll-ups, working-day calendars, Saudi holidays, dependencies, auto-schedule, critical path, baselines, report data, Excel import parsing. Pure TypeScript with no dependencies; runs in the browser and on the server. |

Coming next: `apps/api` (Node.js + PostgreSQL), `apps/web` (React), `infra` (Terraform for Google Cloud Dammam).

## Develop

Requires Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm test        # all tests
pnpm typecheck
pnpm build
```

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

All rights reserved.
