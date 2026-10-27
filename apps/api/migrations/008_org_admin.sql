-- Organisation administration (spec 2): the audit log, and deleting an organisation after a waiting period.

-- An owner asked to delete the organisation. Until delete_on it is locked (owners read only, everyone
-- else cannot see it) and an owner can cancel; on delete_on the daily job deletes it and all its data.
alter table organisations
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references users (id) on delete set null,
  add column delete_on date;
create index organisations_delete_on_idx on organisations (delete_on) where delete_on is not null;

-- Organisation-level events for admins: people, invitations, ownership, SSO, API keys, webhooks,
-- billing, projects and deletion. Kept as long as project activity (plan retention, spec 3.4).
create table audit_log (
  id         bigserial primary key,
  org_id     uuid not null references organisations (id) on delete cascade,
  actor_id   uuid references users (id) on delete set null,
  -- the name as it was, so the entry still reads well after the person leaves
  actor_name text,
  action     text not null,
  -- what the action was about, in words (an email, a project name, a plan)
  target     text,
  details    jsonb not null default '{}',
  ip         text,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on audit_log (org_id, id desc);
create index audit_log_created_idx on audit_log (created_at);
create index activity_log_at_idx on activity_log (at);
