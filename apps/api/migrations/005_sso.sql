-- Single sign-on (spec 7.2, Business plan): one OpenID Connect connection per organisation
-- (Microsoft Entra ID, Google Workspace or another provider), used for the email domains the
-- organisation has proved it owns with a DNS record.
create table sso_connections (
  org_id            uuid primary key references organisations (id) on delete cascade,
  provider          text not null check (provider in ('entra', 'google', 'oidc')),
  issuer            text not null,
  client_id         text not null,
  -- encrypted with the server's SECRET_KEY (AES-256-GCM)
  client_secret_enc text not null,
  -- password sign-in is refused for the organisation's verified domains
  enforce           boolean not null default false,
  -- people from the verified domains who are not members yet join as members on first sign-in
  auto_join         boolean not null default true,
  updated_by        uuid references users (id) on delete set null,
  updated_at        timestamptz not null default now()
);

create table sso_domains (
  org_id      uuid not null references organisations (id) on delete cascade,
  domain      text not null check (domain = lower(domain)),
  token       text not null,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  primary key (org_id, domain)
);
-- any organisation may claim a domain, but only one can prove it
create unique index sso_domains_verified on sso_domains (domain) where verified_at is not null;

-- sign-ins in progress: kept for 10 minutes between leaving for the provider and coming back
create table sso_logins (
  state         text primary key,
  org_id        uuid not null references organisations (id) on delete cascade,
  nonce         text not null,
  code_verifier text not null,
  created_at    timestamptz not null default now()
);
