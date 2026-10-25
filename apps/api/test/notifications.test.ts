import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendDigests } from '../src/notify.js';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
beforeAll(async () => { t = await startApp(); });
afterAll(async () => { await t.close(); });

describe('notifications', () => {
  let rayan: Client, sara: Client, saraId: string, omar: Client, omarId: string, projectId: string;
  const item = randomUUID(), next = randomUUID();

  beforeAll(async () => {
    const r = await Client.signUp(t.app, 'Rayan');
    rayan = r.client;
    await t.db.query("update organisations set plan = 'team' where id = $1", [r.orgId]);
    const s = await Client.signUp(t.app, 'Sara');
    sara = s.client; saraId = s.userId;
    const o = await Client.signUp(t.app, 'Omar', { locale: 'ar' });
    omar = o.client; omarId = o.userId;
    for (const e of ['sara', 'omar']) await rayan.post(`/api/orgs/${r.orgId}/members`, { email: `${e}@example.com`, role: 'member' });
    projectId = (await rayan.post(`/api/orgs/${r.orgId}/projects`, { name: 'Switchgear' })).body.id;
    await rayan.put(`/api/projects/${projectId}/members/${saraId}`, { role: 'editor' });
    await rayan.put(`/api/projects/${projectId}/members/${omarId}`, { role: 'commenter' });
    // today is Thu 22 Oct 2026
    await rayan.post(`/api/projects/${projectId}/ops`, { ops: [
      { op: 'add', id: item, parentId: null, values: { name: 'Busbar', plannedStart: '2026-10-18', plannedFinish: '2026-11-05' } },
      { op: 'add', id: next, parentId: null, values: { name: 'Type test', plannedStart: '2026-11-08', plannedFinish: '2026-11-19' } },
    ] });
    t.mail.sent.length = 0;
  });

  const list = async (c: Client) => (await c.get('/api/notifications')).body;

  it('tells people they were mentioned, in the app and by email, in their language', async () => {
    await rayan.post(`/api/projects/${projectId}/comments`, { body: 'Please check the drawings @Sara @Omar', itemId: item, mentions: [saraId, omarId] });
    const s = await list(sara);
    expect(s.unread).toBe(1);
    expect(s.notifications[0]).toMatchObject({ kind: 'mention', projectId, itemId: item, readAt: null,
      data: { actorName: 'Rayan', projectName: 'Switchgear', itemName: 'Busbar', excerpt: 'Please check the drawings @Sara @Omar' } });
    const toSara = t.mail.sent.find(m => m.to === 'sara@example.com')!;
    expect(toSara.subject).toBe('Rayan mentioned you on Busbar in Switchgear');
    expect(toSara.text).toContain(`https://app.example/p/${projectId}?item=${item}&panel=comments`);
    const toOmar = t.mail.sent.find(m => m.to === 'omar@example.com')!;
    expect(toOmar.subject).toBe('أشار إليك Rayan في Busbar ضمن Switchgear');
    expect(toOmar.html).toContain('dir="rtl"');
    expect(t.mail.sent.some(m => m.to === 'rayan@example.com')).toBe(false);
  });

  it('tells the others in a thread about a reply, once', async () => {
    const root = (await rayan.get(`/api/projects/${projectId}/comments`)).body.comments[0];
    t.mail.sent.length = 0;
    await omar.post(`/api/projects/${projectId}/comments`, { body: 'Done, see revision B.', parentId: root.id });
    // Rayan started the thread; Sara was not part of it yet
    expect((await list(rayan)).notifications.map((n: { kind: string }) => n.kind)).toEqual(['reply']);
    expect((await list(sara)).notifications).toHaveLength(1);
    await sara.post(`/api/projects/${projectId}/comments`, { body: 'Thanks @Omar', parentId: root.id, mentions: [omarId] });
    const kinds = (await list(omar)).notifications.map((n: { kind: string }) => n.kind);
    // mentioned in a reply: one new notification (a mention), not a reply as well; the older one is from the first test
    expect(kinds).toEqual(['mention', 'mention']);
  });

  it('tells people when an item is assigned to them, by name or email', async () => {
    await rayan.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'set', id: next, field: 'owner', value: 'sara@EXAMPLE.com' }] });
    expect((await list(sara)).notifications[0]).toMatchObject({ kind: 'assigned', itemId: next, data: { itemName: 'Type test', actorName: 'Rayan' } });
    // assigning work to yourself is not news
    const before = (await list(sara)).notifications.length;
    await sara.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'set', id: item, field: 'owner', value: 'Sara' }] });
    expect((await list(sara)).notifications.length).toBe(before);
  });

  it('tells owners when their item turns red', async () => {
    await rayan.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'set', id: item, field: 'forecastFinish', value: '2026-11-26' }] });
    const n = (await list(sara)).notifications[0];
    expect(n).toMatchObject({ kind: 'turned_red', itemId: item, data: { itemName: 'Busbar', daysLate: 15 } });
    // still red after another slip: no second notification
    await rayan.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'set', id: item, field: 'forecastFinish', value: '2026-11-30' }] });
    expect((await list(sara)).notifications.filter((x: { kind: string }) => x.kind === 'turned_red')).toHaveLength(1);
  });

  it('tells everyone on the project when a baseline is saved', async () => {
    await rayan.post(`/api/projects/${projectId}/baselines`, { name: 'Re-plan after CR-12', reason: 'Approved change request' });
    for (const c of [sara, omar]) {
      expect((await list(c)).notifications[0]).toMatchObject({ kind: 'baseline', data: { baselineName: 'Re-plan after CR-12' } });
    }
  });

  it('marks notifications read, one or all', async () => {
    const s = await list(sara);
    await sara.post('/api/notifications/read', { ids: [s.notifications[0].id] });
    expect((await sara.get('/api/notifications/unread')).body.unread).toBe(s.unread - 1);
    await sara.post('/api/notifications/read', {});
    expect((await sara.get('/api/notifications/unread')).body.unread).toBe(0);
    // nobody can mark someone else's
    await rayan.post('/api/notifications/read', { ids: [(await list(omar)).notifications[0].id] });
    expect((await list(omar)).unread).toBeGreaterThan(0);
  });

  it('collects daily-digest notifications into one email, and sends nothing to people who turned email off', async () => {
    await sara.patch('/api/me', { notifyEmail: 'daily' });
    await omar.patch('/api/me', { notifyEmail: 'off' });
    expect((await sara.get('/api/me')).body.user.notifyEmail).toBe('daily');
    t.mail.sent.length = 0;
    await rayan.post(`/api/projects/${projectId}/comments`, { body: 'One @Sara', mentions: [saraId, omarId] });
    await rayan.post(`/api/projects/${projectId}/comments`, { body: 'Two @Sara', mentions: [saraId] });
    expect(t.mail.sent).toEqual([]); // nothing instant
    expect(await sendDigests(t.db, t.mail, 'https://app.example')).toBe(1);
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]).toMatchObject({ to: 'sara@example.com', subject: 'Your WBS Master updates: 2 new' });
    expect(await sendDigests(t.db, t.mail, 'https://app.example')).toBe(0); // already sent
  });

  it('hides notifications about projects the person can no longer see', async () => {
    expect((await list(omar)).notifications.length).toBeGreaterThan(0);
    await rayan.del(`/api/projects/${projectId}/members/${omarId}`);
    expect(await list(omar)).toEqual({ notifications: [], unread: 0 });
  });
});
