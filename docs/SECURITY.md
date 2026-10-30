# Security

## Reporting a vulnerability

Email **security@&lt;domain&gt;** (replace with the production domain before launch) with what you
found, how to reproduce it and what it affects. Please do not open a public issue or test against other
customers' data. We reply within three working days and tell you when it is fixed.

## Pre-launch review (October 2026)

### What was reviewed

- **Authorisation:** every route in `apps/api/src/routes/` against `orgAccess` / `projectAccess`;
  ids in paths and bodies (projects, items, comments, baselines, calendars, webhooks, invitations,
  billing invoices, members) are always checked against the organisation or project of the caller.
  Guests and viewers cannot write; API keys are held to their organisation and scope.
- **Authentication:** scrypt password hashing, sessions (random token, only its hash stored, expiry,
  logout), sign-in and sign-up answers, rate limits, SSO (state, nonce, PKCE, verified domains),
  invitation links (hashed, single use, bound to the invited email, expiring).
- **CSRF and headers** for the API and the served web app, the invoice page and `/api/docs`.
- **Injection:** all SQL is parameterised (the dynamic `update ... set` statements only use fixed column
  names); server-rendered HTML (emails, invoices, API docs, the downloaded summary report) escapes
  user text; redirects go only to fixed paths or `?next=` paths of this site.
- **SSRF:** webhooks and SSO provider discovery.
- **Limits:** request bodies (2 MB), edits per batch (500), items per project, WebSocket messages.
- **Secrets:** nothing secret is logged or returned after creation; SSO client secrets are sealed with
  `SECRET_KEY` (AES-256-GCM); the Moyasar webhook secret is compared in constant time, and nothing in a
  Moyasar notice is trusted (the invoice is fetched again from Moyasar).
- **Dependencies:** `pnpm audit --prod` reports no known vulnerabilities.

### What was fixed

| Severity | Issue | Fix |
|---|---|---|
| High | Webhook SSRF: an IPv4 address written as IPv6 (`https://[::ffff:127.0.0.1]/`, which URLs normalise to `::ffff:7f00:1`) and NAT64 / 6to4 / compatible forms passed the private-address check; and the address was checked, then resolved again by `fetch` (DNS rebinding). | `netguard.ts`: a full IPv6 parser that checks IPv4 inside IPv6 and more reserved ranges; outside development, deliveries connect through a lookup that refuses non-public addresses at connection time. No redirects, 1 MB response cap. |
| Medium | SSO discovery SSRF: an organisation admin's issuer address (and the endpoints its settings name) were fetched from the server without any address check. | The same connection-time check for all requests to SSO providers outside development. |
| Medium | SSO login CSRF: the `state` was not tied to the browser, so someone could send their own provider callback link to another person and sign them into the sender's account. | `/api/auth/sso/start` sets a short-lived httpOnly `wbs_sso` cookie with the state; the callback requires it. |
| Medium | API keys could read the owner's notifications (project names, comment excerpts) and organisation list from **every** organisation, not only the key's. | `/api/notifications*` and `/api/me` are limited to the key's organisation. |
| Medium | Password guessing for one account was only limited per client address, which a client can spread out (or, with `TRUST_PROXY=1`, choose via X-Forwarded-For). | A per-account pause after 10 wrong passwords in 15 minutes (`LOGIN_FAILURE_LIMIT`); `TRUST_PROXY` also accepts a hop count. |
| Low | No CSRF defence beyond `SameSite=Lax`, which does not cover sibling subdomains; Fastify accepts `text/plain` bodies, so some body-less POSTs (logout, accepting an invitation, webhook test) could be sent by a form. | Cookie-authenticated non-GET requests from another site (by `Sec-Fetch-Site`, or `Origin`) get 403 `cross_site_request`. Requests with an API key, without browser headers, and Moyasar's notice are not affected. |
| Low | Cross-site WebSocket hijacking of `/api/projects/:id/live` (no Origin check); WebSocket messages up to the library default of 100 MB. | Connections from another site close with 4403; messages are limited to 4 KB. |
| Low | No security headers. | CSP (`script-src 'self'`, no inline scripts; styles inline and Google Fonts; `frame-ancestors 'none'`), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, and HSTS when cookies are secure. The invoice's inline `onclick` became a script allowed by its hash. |
| Low | Sign-in timing told unknown emails (and SSO-only accounts) from wrong passwords. | A dummy scrypt check, so both take about as long. |
| Low | `?next=/\evil.example` passed the "starts with one slash" check (browsers read `/\` as `//`). | `safeNext()` in the web app also refuses backslashes and control characters. |

Each fix has tests in `apps/api/test/security.test.ts`, `apps/api/test/sso.test.ts` and
`apps/web/test/next.test.ts`; all browser suites pass under the new headers and checks.

### Known limitations and follow-ups

- **Email addresses are not verified at sign-up (High, not fixed).** Someone can create an account for
  an address they do not own. When an admin then adds that address, an existing account joins
  straight away, so the person who registered it first gets in; and an account made before a company
  set up SSO keeps its password after the real owner signs in with SSO. Fix: verify email at sign-up
  (or treat unverified accounts like people without an account and send them the invitation link), and
  remove the password of an unverified account on its first SSO sign-in. This changes the sign-up and
  invitation flows, so it needs product decisions and its own change.
- **Client address behind the load balancer.** With `TRUST_PROXY=1` the left-most X-Forwarded-For
  address is used, which a client can set. Check the header in production and set `TRUST_PROXY` to the
  number of trusted hops (likely 2 for the regional load balancer in front of Cloud Run). Cloud Armor's
  per-address limit is unaffected, and the per-account sign-in pause does not depend on the address.
- **Rate limits are in memory per instance** (spec 8.2: move to Redis or Postgres with several
  instances).
- **No password change or reset, and no "sign out everywhere"** yet; sessions last `SESSION_DAYS`
  (30) and only end on sign-out or expiry.
- **Moyasar notices without `secret_token`** are accepted, by design: they only make the server look the
  invoice up again with Moyasar. Anyone can trigger such a look-up for an id they know.
- **Dev-only dependency advisories:** `pnpm audit` (all dependencies) lists advisories in vitest 3
  (`@vitest/mocker`, `tinypool`); they affect the test runner only and need vitest 4.
- The CSP keeps `style-src 'unsafe-inline'` for React `style` props and server-rendered pages.
