-- Notifications (spec 7.1): in-app, and by email instantly or as a daily digest, per user.
alter table users add column notify_email text not null default 'instant' check (notify_email in ('instant', 'daily', 'off'));

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  kind       text not null check (kind in ('mention', 'reply', 'assigned', 'turned_red', 'baseline')),
  project_id uuid not null references projects (id) on delete cascade,
  item_id    uuid,
  comment_id uuid references comments (id) on delete set null,
  actor_id   uuid references users (id) on delete set null,
  -- what the message shows, kept as it was when it happened (names can change later)
  data       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  emailed_at timestamptz
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unsent_idx on notifications (user_id) where emailed_at is null;
