-- Public read-only links (spec 3.4, Team and Business plans): anyone with the link sees one project,
-- read-only, without signing in. Revoking a link deletes it.
create table public_links (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects (id) on delete cascade,
  -- sha-256 of the token in the link; the token itself is shown once, when the link is made
  token_hash   text not null unique,
  -- which views the page shows, and whether item owners' names are shown
  views        text[] not null check (views <@ array['table', 'chart', 'gantt', 'summary'] and cardinality(views) > 0),
  show_owners  boolean not null default true,
  created_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  last_used_at timestamptz
);
create index public_links_project_idx on public_links (project_id);
