-- Billing (spec 3.4, Phase 3): prepaid periods paid through Moyasar's hosted invoice page.
-- organisations.plan stays the plan in force; it is worked out from the trial and the paid invoices (billing.ts).

alter table organisations
  -- paid seats in force (members, not guests); null while free or on trial, when the plan's own limit applies
  add column seats integer check (seats is null or seats > 0),
  add column trial_plan text check (trial_plan in ('team', 'business')),
  -- a plan given free of charge (pilot organisations, set by hand); wins over trials and payments
  add column comp_plan text check (comp_plan in ('team', 'business')),
  add column trial_ends date,
  -- details printed on invoices
  add column billing_name text check (length(billing_name) <= 200),
  add column billing_address text check (length(billing_address) <= 500),
  add column billing_vat_number text check (length(billing_vat_number) <= 30),
  add column billing_email text check (length(billing_email) <= 254);

-- A checkout, and once paid, the invoice for it. Amounts in halalas (SAR / 100).
create table billing_invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisations (id) on delete cascade,
  -- sequential, without gaps, given when paid (pending checkouts are not invoices)
  number         integer unique,
  kind           text not null check (kind in ('new', 'renew', 'upgrade')),
  plan           text not null check (plan in ('team', 'business')),
  interval       text not null check (interval in ('month', 'year')),
  seats          integer not null check (seats > 0),
  period_start   date not null,
  period_end     date not null check (period_end > period_start),
  subtotal       integer not null check (subtotal >= 0),
  vat_rate       numeric(5, 2) not null default 0,
  vat            integer not null default 0 check (vat >= 0),
  total          integer not null check (total >= 0),
  currency       text not null default 'SAR',
  status         text not null default 'pending' check (status in ('pending', 'paid', 'canceled', 'expired', 'failed')),
  moyasar_id     text unique,
  pay_url        text,
  -- seller and customer as they were when paid: an issued invoice never changes
  seller         jsonb,
  buyer          jsonb,
  created_by     uuid references users (id) on delete set null,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);
create index billing_invoices_org_idx on billing_invoices (org_id, created_at desc);
create index billing_invoices_pending_idx on billing_invoices (created_at) where status = 'pending';

create table billing_counters (
  name  text primary key,
  value integer not null
);
insert into billing_counters (name, value) values ('invoice', 0);

-- Renewal and trial reminders already sent, so the daily job sends each once.
create table billing_reminders (
  org_id   uuid not null references organisations (id) on delete cascade,
  kind     text not null,
  for_date date not null,
  sent_at  timestamptz not null default now(),
  primary key (org_id, kind, for_date)
);
