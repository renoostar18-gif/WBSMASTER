// Confirming a test account's email, as following the link in the confirmation email would.
// The real token is only in the email, so this swaps in one the test knows (needs DATABASE_URL),
// then confirms through the API like the /verify page does.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const pg = createRequire(new URL('../../api/package.json', import.meta.url))('pg');

export async function confirmEmail(api, email) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/wbs_dev?host=/tmp' });
  await db.connect();
  try {
    const token = `e2e-${randomBytes(12).toString('hex')}`;
    const r = await db.query(
      "update email_tokens set token_hash = $2 where purpose = 'verify' and user_id = (select id from users where lower(email) = lower($1))",
      [email, createHash('sha256').update(token).digest('hex')]);
    if (!r.rowCount) throw new Error(`no confirmation link for ${email}`);
    const res = await fetch(`${api}/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (!res.ok) throw new Error(`confirming ${email} failed: ${res.status}`);
  } finally {
    await db.end();
  }
}
