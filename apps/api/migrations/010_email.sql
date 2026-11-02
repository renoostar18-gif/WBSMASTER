-- Confirmed email addresses, and password resets (security review: sign-up did not prove the email).
alter table users add column email_verified_at timestamptz;
-- accounts made before this change keep working as before
update users set email_verified_at = created_at;

-- One-time links sent by email: confirming the address, or choosing a new password.
-- Only the sha-256 of the token is kept; the token itself is only in the email.
create table email_tokens (
  token_hash text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  purpose    text not null check (purpose in ('verify', 'reset')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index email_tokens_user_idx on email_tokens (user_id, purpose);
