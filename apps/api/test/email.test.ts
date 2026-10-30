import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type TestApp, linkToken, startApp } from './setup.js';

let t: TestApp;
beforeAll(async () => { t = await startApp(); });
afterAll(async () => { await t.close(); });

const me = async (c: Client) => (await c.get('/api/me')).body;

describe('confirming the email address', () => {
  it('sends a link at sign-up; until it is used the account is unconfirmed', async () => {
    const { client } = await Client.signUp(t.app, 'Lina', {}, { verify: false });
    expect((await me(client)).user.emailVerified).toBe(false);
    const mail = t.mail.sent.at(-1)!;
    expect(mail).toMatchObject({ to: 'lina@example.com', subject: 'Confirm your email for WBS Master' });
    expect(mail.text).toContain('https://app.example/verify/');

    const token = linkToken(t.app, 'lina@example.com', 'verify');
    // the link works without being signed in, and only once
    expect((await new Client(t.app).post('/api/auth/verify', { token })).status).toBe(200);
    expect((await me(client)).user.emailVerified).toBe(true);
    expect((await new Client(t.app).post('/api/auth/verify', { token })).body.error).toBe('link_invalid');
    expect((await new Client(t.app).post('/api/auth/verify', { token: 'not-a-real-token-at-all-0000' })).body.error).toBe('link_invalid');
  });

  it('sends the link again on request, a few times at most; a new link replaces the old one', async () => {
    const { client } = await Client.signUp(t.app, 'Maha', {}, { verify: false });
    const first = linkToken(t.app, 'maha@example.com', 'verify');
    expect((await client.post('/api/auth/verify/resend')).status).toBe(200);
    const second = linkToken(t.app, 'maha@example.com', 'verify');
    expect(second).not.toBe(first);
    expect((await new Client(t.app).post('/api/auth/verify', { token: first })).body.error).toBe('link_invalid');
    await client.post('/api/auth/verify/resend');
    await client.post('/api/auth/verify/resend');
    expect((await client.post('/api/auth/verify/resend')).body.error).toBe('rate_limited');
  });

  it('invites an unconfirmed account instead of adding it, and adds a confirmed one at once', async () => {
    const { client: owner, orgId } = await Client.signUp(t.app, 'Boss');
    // someone signed up with Faris's address but never confirmed it
    await Client.signUp(t.app, 'Faris', {}, { verify: false });
    const r = await owner.post(`/api/orgs/${orgId}/members`, { email: 'faris@example.com', role: 'member' });
    expect(r.body.invited).toBe(true);
    expect((await owner.get(`/api/orgs/${orgId}/members`)).body.members.map((m: { email: string }) => m.email)).not.toContain('faris@example.com');
    expect(t.mail.sent.at(-1)!.subject).toContain('invited you');

    await Client.signUp(t.app, 'Dana');
    expect((await owner.post(`/api/orgs/${orgId}/members`, { email: 'dana@example.com', role: 'member' })).body.userId).toBeTruthy();
  });

  it('counts accepting an invitation as confirming the address', async () => {
    const { client: owner, orgId } = await Client.signUp(t.app, 'Host');
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'yara@example.com', role: 'member' });
    const invite = /\/invite\/([A-Za-z0-9_-]+)/.exec(t.mail.sent.at(-1)!.text)![1];
    const { client } = await Client.signUp(t.app, 'Yara', { invite }, { verify: false });
    expect((await me(client)).user.emailVerified).toBe(true);
  });
});

describe('resetting a forgotten password', () => {
  it('gives the same answer for unknown emails, and sends nothing', async () => {
    const before = t.mail.sent.length;
    const r = await new Client(t.app).post('/api/auth/password/forgot', { email: 'nobody@example.com' });
    expect(r.body).toEqual({ ok: true });
    expect(t.mail.sent.length).toBe(before);
  });

  it('emails a one-hour link; the new password works, the old one does not, and other sessions are signed out', async () => {
    const { client: laptop } = await Client.signUp(t.app, 'Rania');
    expect((await new Client(t.app).post('/api/auth/password/forgot', { email: 'Rania@Example.com' })).body).toEqual({ ok: true });
    expect(t.mail.sent.at(-1)!.subject).toBe('Choose a new WBS Master password');
    const token = linkToken(t.app, 'rania@example.com', 'reset');

    expect((await new Client(t.app).post('/api/auth/password/reset', { token, password: 'short' })).status).toBe(400);
    const phone = new Client(t.app);
    const r = await phone.post('/api/auth/password/reset', { token, password: 'a brand new passphrase' });
    expect(r.status).toBe(200);
    expect((await me(phone)).user.email).toBe('rania@example.com');
    expect((await laptop.get('/api/me')).status).toBe(401);

    expect((await new Client(t.app).post('/api/auth/login', { email: 'rania@example.com', password: 'correct horse battery' })).status).toBe(401);
    expect((await new Client(t.app).post('/api/auth/login', { email: 'rania@example.com', password: 'a brand new passphrase' })).status).toBe(200);
    // the link works once
    expect((await new Client(t.app).post('/api/auth/password/reset', { token, password: 'another passphrase!' })).body.error).toBe('link_invalid');
  });

  it('refuses an expired link, and confirms the address of whoever resets', async () => {
    await Client.signUp(t.app, 'Salma', {}, { verify: false });
    await new Client(t.app).post('/api/auth/password/forgot', { email: 'salma@example.com' });
    const token = linkToken(t.app, 'salma@example.com', 'reset');
    await t.db.query("update email_tokens set expires_at = now() - interval '1 minute' where purpose = 'reset'");
    expect((await new Client(t.app).post('/api/auth/password/reset', { token, password: 'a brand new passphrase' })).body.error).toBe('link_invalid');

    await new Client(t.app).post('/api/auth/password/forgot', { email: 'salma@example.com' });
    const c = new Client(t.app);
    await c.post('/api/auth/password/reset', { token: linkToken(t.app, 'salma@example.com', 'reset'), password: 'a brand new passphrase' });
    expect((await me(c)).user.emailVerified).toBe(true);
  });
});
