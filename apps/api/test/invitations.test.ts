import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
let owner: Client;
let orgId: string;

beforeAll(async () => {
  t = await startApp();
  ({ client: owner, orgId } = await Client.signUp(t.app, 'Owner'));
});
afterAll(async () => { await t.close(); });

/** The link in the last email to this address, and its token. */
function linkFor(email: string) {
  const m = [...t.mail.sent].reverse().find(x => x.to === email)!;
  const link = /https:\/\/app\.example\/invite\/([A-Za-z0-9_-]+)/.exec(m.text)!;
  return { mail: m, link: link[0], token: link[1]! };
}

describe('invitations', () => {
  it('invites someone without an account by email, in English and Arabic', async () => {
    const r = await owner.post(`/api/orgs/${orgId}/members`, { email: 'Sara@Example.com', role: 'member' });
    expect(r.status).toBe(201);
    expect(r.body.invited).toBe(true);
    const { mail, link } = linkFor('sara@example.com');
    expect(mail.subject).toContain('Owner invited you to Owner\'s workspace');
    expect(mail.html).toContain('قبول الدعوة');
    expect(mail.html).toContain(link);

    const list = await owner.get(`/api/orgs/${orgId}/invitations`);
    expect(list.body.invitations).toMatchObject([{ email: 'sara@example.com', role: 'member', invitedBy: 'Owner', expired: false }]);
    expect(list.body.seats).toEqual({ used: 2, limit: 3 }); // Free plan: the open invitation holds a seat
  });

  it('shows what the link is for, and lets the person sign up straight into the organisation', async () => {
    const { token } = linkFor('sara@example.com');
    const info = await new Client(t.app).get(`/api/invitations/${token}`);
    expect(info.body).toEqual({ organisation: 'Owner\'s workspace', invitedBy: 'Owner', email: 'sara@example.com', role: 'member', status: 'open', hasAccount: false });

    // the link is for Sara: someone else cannot use it to sign up
    const other = await new Client(t.app).post('/api/auth/signup', { email: 'mallory@example.com', password: 'correct horse battery', name: 'Mallory', invite: token });
    expect(other.body.error).toBe('invitation_other_email');
    expect((await t.db.query("select 1 from users where email = 'mallory@example.com'")).rowCount).toBe(0);

    const sara = new Client(t.app);
    const r = await sara.post('/api/auth/signup', { email: 'sara@example.com', password: 'correct horse battery', name: 'Sara', invite: token });
    expect(r.status).toBe(201);
    expect(r.body.orgId).toBe(orgId);
    const me = (await sara.get('/api/me')).body;
    expect(me.organisations).toEqual([expect.objectContaining({ id: orgId, role: 'member' })]); // no workspace of her own
    expect((await new Client(t.app).get(`/api/invitations/${token}`)).body.status).toBe('used');
    expect((await owner.get(`/api/orgs/${orgId}/invitations`)).body.invitations).toEqual([]);
  });

  it('lets someone with an account accept after signing in, once', async () => {
    const { client: omar } = await Client.signUp(t.app, 'Omar');
    // an invitation that was sent before Omar had an account
    await t.db.query(
      "insert into invitations (org_id, email, role, token_hash, expires_at) values ($1, 'omar@example.com', 'admin', encode(sha256('tok-omar-0123456789abcdef'::bytea), 'hex'), now() + interval '1 day')",
      [orgId]);
    const token = 'tok-omar-0123456789abcdef';
    expect((await new Client(t.app).get(`/api/invitations/${token}`)).body).toMatchObject({ hasAccount: true, status: 'open', role: 'admin' });
    const { client: eve } = await Client.signUp(t.app, 'Eve');
    expect((await eve.post(`/api/invitations/${token}/accept`)).body.error).toBe('invitation_other_email');
    expect((await omar.post(`/api/invitations/${token}/accept`)).body).toEqual({ orgId });
    expect((await omar.get('/api/me')).body.organisations.find((o: { id: string }) => o.id === orgId).role).toBe('admin');
    expect((await omar.post(`/api/invitations/${token}/accept`)).body.error).toBe('invitation_used');
  });

  it('adds people who already have an account at once, and tells them', async () => {
    const { client: host, orgId: o } = await Client.signUp(t.app, 'Host');
    const r = await host.post(`/api/orgs/${o}/members`, { email: 'eve@example.com', role: 'member' });
    expect(r.status).toBe(201);
    expect(r.body.userId).toBeTruthy();
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'eve@example.com', subject: 'Host added you to Host\'s workspace on WBS Master as a member.' });
    expect((await host.post(`/api/orgs/${o}/members`, { email: 'eve@example.com', role: 'member' })).body.error).toBe('already_member');
  });

  it('counts open invitations against the plan, and frees the seat when one is withdrawn', async () => {
    // Free plan: 3 members, the owner included
    const { client: boss, orgId: small } = await Client.signUp(t.app, 'Boss');
    await boss.post(`/api/orgs/${small}/members`, { email: 'a@example.com', role: 'member' });
    await boss.post(`/api/orgs/${small}/members`, { email: 'b@example.com', role: 'member' });
    expect((await boss.post(`/api/orgs/${small}/members`, { email: 'c@example.com', role: 'member' })).body.error).toBe('plan_member_limit');
    // inviting the same person again renews the invitation instead of taking another seat
    expect((await boss.post(`/api/orgs/${small}/members`, { email: 'b@example.com', role: 'member' })).status).toBe(201);
    const first = (await boss.get(`/api/orgs/${small}/invitations`)).body.invitations.find((i: { email: string }) => i.email === 'a@example.com');
    expect((await boss.del(`/api/orgs/${small}/invitations/${first.id}`)).status).toBe(200);
    expect((await boss.post(`/api/orgs/${small}/members`, { email: 'c@example.com', role: 'member' })).status).toBe(201);
    // a withdrawn invitation's link stops working
    expect((await new Client(t.app).get('/api/invitations/not-a-real-token-at-all-xyz')).status).toBe(404);
  });

  it('resends with a new link; the old one stops working', async () => {
    const { client: boss, orgId: o } = await Client.signUp(t.app, 'Lead');
    await boss.post(`/api/orgs/${o}/members`, { email: 'nadia@example.com', role: 'member' });
    const old = linkFor('nadia@example.com').token;
    const inv = (await boss.get(`/api/orgs/${o}/invitations`)).body.invitations[0];
    expect((await boss.post(`/api/orgs/${o}/invitations/${inv.id}/resend`)).status).toBe(200);
    const fresh = linkFor('nadia@example.com').token;
    expect(fresh).not.toBe(old);
    expect((await new Client(t.app).get(`/api/invitations/${old}`)).status).toBe(404);
    expect((await new Client(t.app).get(`/api/invitations/${fresh}`)).body.status).toBe('open');
  });

  it('refuses expired links and keeps invitations to admins', async () => {
    await t.db.query(
      "insert into invitations (org_id, email, role, token_hash, expires_at) values ($1, 'late@example.com', 'member', encode(sha256('tok-late-0123456789abcdef'::bytea), 'hex'), now() - interval '1 minute')",
      [orgId]);
    expect((await new Client(t.app).get('/api/invitations/tok-late-0123456789abcdef')).body.status).toBe('expired');
    const late = new Client(t.app);
    const r = await late.post('/api/auth/signup', { email: 'late@example.com', password: 'correct horse battery', name: 'Late', invite: 'tok-late-0123456789abcdef' });
    expect(r.body.error).toBe('invitation_expired');
    const { client: stranger } = await Client.signUp(t.app, 'Stranger');
    expect((await stranger.get(`/api/orgs/${orgId}/invitations`)).status).toBe(404);
  });
});
