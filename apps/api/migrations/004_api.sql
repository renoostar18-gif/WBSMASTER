-- Public API (spec 7.2): personal API keys, scoped to one organisation, and outgoing webhooks.
create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  org_id       uuid not null references organisations (id) on delete cascade,
  name         text not null check (length(name) between 1 and 120),
  -- shown in lists so people can tell keys apart; the secret itself is only stored hashed
  prefix       text not null unique,
  key_hash     text not null,
  scope        text not null check (scope in ('read', 'write')),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index api_keys_user_idx on api_keys (user_id);

create table webhooks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations (id) on delete cascade,
  url         text not null,
  secret      text not null,
  events      text[] not null,
  active      boolean not null default true,
  created_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index webhooks_org_idx on webhooks (org_id);

create table webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  webhook_id      uuid not null references webhooks (id) on delete cascade,
  event           text not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  response_code   int,
  error           text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);
create index webhook_deliveries_due_idx on webhook_deliveries (next_attempt_at) where status = 'pending';
create index webhook_deliveries_hook_idx on webhook_deliveries (webhook_id, created_at desc);
