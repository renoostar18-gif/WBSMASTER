-- Email invitations (spec 2): admins invite people by email; the link lets them create an account
-- or sign in, and join the organisation with the role chosen.
create table invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations (id) on delete cascade,
  email       text not null check (length(email) between 3 and 254),
  role        text not null check (role in ('admin', 'member', 'guest')),
  -- sha-256 of the token in the link; the token itself is only in the email
  token_hash  text not null unique,
  invited_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users (id) on delete set null
);
-- one open invitation per person and organisation; inviting again renews it
create unique index invitations_open_idx on invitations (org_id, lower(email)) where accepted_at is null;
