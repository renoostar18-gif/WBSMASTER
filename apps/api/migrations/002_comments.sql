-- Comments (spec 7.1): threads on an item or on the project, with @mentions and resolve/reopen.
-- A thread is a root comment (parent_id null) and its replies; resolving applies to the root.
create table comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  -- no foreign key: a thread stays with its item id, so it comes back if a deleted item is restored
  item_id     uuid,
  parent_id   uuid references comments (id) on delete cascade,
  author_id   uuid references users (id) on delete set null,
  body        text not null check (length(body) between 1 and 5000),
  mentions    uuid[] not null default '{}',
  resolved_at timestamptz,
  resolved_by uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index comments_project_idx on comments (project_id, created_at);
create index comments_mentions_idx on comments using gin (mentions);
