-- WBS Master: initial schema (spec section 5).
-- Dates are DATE (whole days, no time zone). Every customer table carries org_id
-- directly or through its project, for tenant isolation.

create extension if not exists pgcrypto;

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  password_hash text,
  locale        text not null default 'en' check (locale in ('en', 'ar')),
  theme         text not null default 'auto' check (theme in ('auto', 'light', 'dark')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  token_hash   text primary key,
  user_id      uuid not null references users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 200),
  plan       text not null default 'free' check (plan in ('free', 'team', 'business')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  org_id     uuid not null references organisations (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'member', 'guest')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

create table calendars (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations (id) on delete cascade,
  name       text not null check (length(name) between 1 and 120),
  week_days  smallint[] not null default '{0,1,2,3,4}',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(week_days) between 1 and 7)
);
create unique index calendars_one_default on calendars (org_id) where is_default;

create table projects (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organisations (id) on delete cascade,
  name               text not null check (length(name) between 1 and 200),
  status_date        date,
  red_threshold_days integer not null default 10 check (red_threshold_days >= 1),
  auto_schedule      boolean not null default true,
  active_baseline_id uuid,
  calendar_id        uuid references calendars (id) on delete set null,
  locale             text not null default 'en' check (locale in ('en', 'ar')),
  version            bigint not null default 0,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references users (id) on delete set null
);
create index projects_org_idx on projects (org_id);

create table calendar_exceptions (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid references calendars (id) on delete cascade,
  project_id  uuid references projects (id) on delete cascade,
  date        date not null,
  name        text not null default '',
  is_working  boolean not null,
  estimated   boolean not null default false,
  check ((calendar_id is null) <> (project_id is null))
);
create unique index calendar_exceptions_cal_date on calendar_exceptions (calendar_id, date) where calendar_id is not null;
create unique index calendar_exceptions_proj_date on calendar_exceptions (project_id, date) where project_id is not null;

create table project_members (
  project_id uuid not null references projects (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  role       text not null check (role in ('admin', 'editor', 'commenter', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members (user_id);

create table wbs_items (
  id              uuid primary key,
  project_id      uuid not null references projects (id) on delete cascade,
  parent_id       uuid references wbs_items (id) on delete cascade,
  sort_key        double precision not null,
  name            text not null check (length(name) <= 300),
  owner_text      text not null default '' check (length(owner_text) <= 120),
  owner_user_id   uuid references users (id) on delete set null,
  status          text not null default 'auto'
                  check (status in ('auto', 'not_started', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  planned_start   date,
  planned_finish  date,
  forecast_start  date,
  forecast_finish date,
  actual_start    date,
  actual_finish   date,
  progress        smallint not null default 0 check (progress between 0 and 100),
  notes           text not null default '' check (length(notes) <= 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users (id) on delete set null
);
create index wbs_items_project_idx on wbs_items (project_id, sort_key);

create table dependencies (
  project_id     uuid not null references projects (id) on delete cascade,
  successor_id   uuid not null references wbs_items (id) on delete cascade,
  predecessor_id uuid not null references wbs_items (id) on delete cascade,
  lag_days       integer not null default 0 check (lag_days between -365 and 365),
  primary key (successor_id, predecessor_id),
  check (successor_id <> predecessor_id)
);
create index dependencies_project_idx on dependencies (project_id);

create table baselines (
  id         uuid primary key,
  project_id uuid not null references projects (id) on delete cascade,
  name       text not null check (length(name) between 1 and 120),
  set_on     date not null,
  reason     text not null default '' check (length(reason) <= 1000),
  position   integer not null,
  created_at timestamptz not null default now(),
  created_by uuid references users (id) on delete set null
);
create index baselines_project_idx on baselines (project_id, position);

create table baseline_items (
  baseline_id    uuid not null references baselines (id) on delete cascade,
  item_id        uuid not null,
  planned_start  date,
  planned_finish date,
  primary key (baseline_id, item_id)
);

alter table projects add constraint projects_active_baseline_fk
  foreign key (active_baseline_id) references baselines (id) on delete set null;

create table project_summaries (
  project_id   uuid primary key references projects (id) on delete cascade,
  narrative    text not null default '',
  achievements text not null default '',
  next_steps   text not null default '',
  risks        text not null default '',
  decisions    text not null default '',
  updated_at   timestamptz not null default now()
);

create table project_snapshots (
  project_id    uuid not null references projects (id) on delete cascade,
  date          date not null,
  progress      smallint not null,
  planned_pct   smallint,
  variance_days integer,
  primary key (project_id, date)
);

create table activity_log (
  id         bigserial primary key,
  project_id uuid not null references projects (id) on delete cascade,
  item_id    uuid,
  actor_id   uuid references users (id) on delete set null,
  action     text not null,
  field      text,
  old_value  jsonb,
  new_value  jsonb,
  at         timestamptz not null default now()
);
create index activity_log_project_idx on activity_log (project_id, at desc);
