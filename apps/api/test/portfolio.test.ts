import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
beforeAll(async () => { t = await startApp(); });
afterAll(async () => { await t.close(); });

describe('portfolio', () => {
  let owner: Client, orgId: string, member: Client, memberId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const o = await Client.signUp(t.app, 'PfOwner');
    owner = o.client; orgId = o.orgId;
    const m = await Client.signUp(t.app, 'PfMember');
    member = m.client; memberId = m.userId;
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'pfmember@example.com', role: 'member' });
    for (const name of ['On plan', 'Slipping', 'Empty']) ids[name] = (await owner.post(`/api/orgs/${orgId}/projects`, { name })).body.id;
    // today is Thu 22 Oct 2026
    await owner.post(`/api/projects/${ids['On plan']}/ops`, { ops: [
      { op: 'add', parentId: null, values: { name: 'Survey', owner: 'R&D', plannedStart: '2026-10-18', plannedFinish: '2026-11-05', actualStart: '2026-10-18', progress: 25 } },
    ] });
    const late = randomUUID();
    await owner.post(`/api/projects/${ids.Slipping}/ops`, { ops: [
      { op: 'add', id: late, parentId: null, values: { name: 'Design', owner: 'R&D', plannedStart: '2026-09-01', plannedFinish: '2026-09-30' } },
    ] });
    await owner.post(`/api/projects/${ids.Slipping}/ops`, { ops: [{ op: 'set', id: late, values: { forecastFinish: '2026-10-20', progress: 40 } }] });
  });

  it('is a paid feature', async () => {
    expect((await owner.get(`/api/orgs/${orgId}/portfolio`)).body.error).toBe('plan_portfolio');
    await t.db.query("update organisations set plan = 'team' where id = $1", [orgId]);
  });

  it('lists projects worst first, with a trend point for today', async () => {
    const r = await owner.get(`/api/orgs/${orgId}/portfolio`);
    expect(r.status).toBe(200);
    expect(r.body.statusDate).toBe('2026-10-22');
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['Slipping', 'On plan', 'Empty']);
    const slipping = r.body.projects[0];
    expect(slipping.overall).toBe('red');
    expect(slipping.tasks[0]).toMatchObject({ name: 'Design', overdue: true, owner: 'R&D' });
    expect(slipping.trend).toEqual([{ date: '2026-10-22', variance: slipping.variance }]);
  });

  it('measures every project at a chosen status date', async () => {
    const r = await owner.get(`/api/orgs/${orgId}/portfolio?asOf=2026-09-15`);
    expect(r.body.statusDate).toBe('2026-09-15');
    expect(r.body.projects.every((p: { statusDate: string }) => p.statusDate === '2026-09-15')).toBe(true);
    expect((await owner.get(`/api/orgs/${orgId}/portfolio?asOf=2026-02-30`)).status).toBe(400);
  });

  it('shows members only the projects shared with them', async () => {
    expect((await member.get(`/api/orgs/${orgId}/portfolio`)).body.projects).toEqual([]);
    await owner.put(`/api/projects/${ids['On plan']}/members/${memberId}`, { role: 'viewer' });
    const r = await member.get(`/api/orgs/${orgId}/portfolio`);
    expect(r.body.projects.map((p: { name: string }) => p.name)).toEqual(['On plan']);
  });
});

describe('comments', () => {
  let owner: Client, commenter: Client, commenterId: string, viewer: Client, viewerId: string, outsiderId: string;
  let projectId: string, itemId: string;

  beforeAll(async () => {
    const o = await Client.signUp(t.app, 'CmOwner', { organisation: 'Comments Co' });
    owner = o.client;
    await t.db.query("update organisations set plan = 'team' where id = $1", [o.orgId]);
    const c = await Client.signUp(t.app, 'CmCommenter');
    commenter = c.client; commenterId = c.userId;
    const v = await Client.signUp(t.app, 'CmViewer');
    viewer = v.client; viewerId = v.userId;
    outsiderId = (await Client.signUp(t.app, 'CmOutsider')).userId;
    for (const e of ['cmcommenter', 'cmviewer']) await owner.post(`/api/orgs/${o.orgId}/members`, { email: `${e}@example.com`, role: 'member' });
    projectId = (await owner.post(`/api/orgs/${o.orgId}/projects`, { name: 'Discussed' })).body.id;
    await owner.put(`/api/projects/${projectId}/members/${commenterId}`, { role: 'commenter' });
    await owner.put(`/api/projects/${projectId}/members/${viewerId}`, { role: 'viewer' });
    itemId = randomUUID();
    await owner.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'add', id: itemId, parentId: null, values: { name: 'Busbar' } }] });
  });

  const list = async (c: Client) => (await c.get(`/api/projects/${projectId}/comments`)).body.comments;

  it('lists the people who can be mentioned', async () => {
    const r = await commenter.get(`/api/projects/${projectId}/people`);
    expect(r.body.people.map((p: { name: string }) => p.name).sort()).toEqual(['CmCommenter', 'CmOwner', 'CmViewer']);
  });

  it('lets a commenter start a thread on an item and mention people who can see the project', async () => {
    const r = await commenter.post(`/api/projects/${projectId}/comments`, {
      body: 'Is the insulation data in yet? @CmViewer', itemId, mentions: [viewerId, outsiderId],
    });
    expect(r.status).toBe(201);
    expect(r.body.mentions).toEqual([viewerId]);
    const [c] = await list(viewer);
    expect(c).toMatchObject({ itemId, parentId: null, authorName: 'CmCommenter', resolvedAt: null, mentions: [viewerId] });
  });

  it('does not let a viewer comment, or anyone comment on an item of another project', async () => {
    expect((await viewer.post(`/api/projects/${projectId}/comments`, { body: 'Hi' })).status).toBe(403);
    expect((await owner.post(`/api/projects/${projectId}/comments`, { body: 'Hi', itemId: randomUUID() })).body.error).toBe('item_not_found');
    expect((await owner.post(`/api/projects/${projectId}/comments`, { body: '   ' })).status).toBe(400);
  });

  it('replies on the thread, resolves it, and a new reply reopens it', async () => {
    const [root] = await list(owner);
    const reply = await owner.post(`/api/projects/${projectId}/comments`, { body: 'Due Sunday.', parentId: root.id, itemId: null });
    expect(reply.status).toBe(201);
    expect((await owner.post(`/api/projects/${projectId}/comments/${reply.body.id}`, {})).status).toBe(404);
    expect((await owner.post(`/api/projects/${projectId}/comments`, { body: 'x', parentId: reply.body.id })).body.error).toBe('reply_to_reply');
    let all = await list(owner);
    expect(all[1]).toMatchObject({ parentId: root.id, itemId, body: 'Due Sunday.' });
    expect((await commenter.post(`/api/projects/${projectId}/comments/${root.id}/resolve`, { resolved: true })).status).toBe(200);
    all = await list(owner);
    expect(all[0].resolvedByName).toBe('CmCommenter');
    expect((await owner.post(`/api/projects/${projectId}/comments/${reply.body.id}/resolve`, { resolved: true })).body.error).toBe('not_thread');
    await commenter.post(`/api/projects/${projectId}/comments`, { body: 'Thanks', parentId: root.id });
    expect((await list(owner))[0].resolvedAt).toBeNull();
  });

  it('lets authors edit and delete their own comments, and admins delete any', async () => {
    const all = await list(owner);
    const mine = all.find((c: { authorName: string }) => c.authorName === 'CmOwner');
    expect((await commenter.patch(`/api/projects/${projectId}/comments/${mine.id}`, { body: 'Hacked' })).body.error).toBe('not_author');
    expect((await owner.patch(`/api/projects/${projectId}/comments/${mine.id}`, { body: 'Due Monday.' })).status).toBe(200);
    expect((await list(owner)).find((c: { id: string }) => c.id === mine.id)).toMatchObject({ body: 'Due Monday.', editedAt: expect.any(String) });
    expect((await commenter.del(`/api/projects/${projectId}/comments/${mine.id}`)).body.error).toBe('not_author');
    // deleting the first comment removes the whole thread
    const root = all.find((c: { parentId: string | null }) => !c.parentId);
    expect((await owner.del(`/api/projects/${projectId}/comments/${root.id}`)).status).toBe(200);
    expect(await list(owner)).toEqual([]);
  });

  it('keeps comments private to people who can see the project', async () => {
    const outsider = new Client(t.app);
    await outsider.post('/api/auth/login', { email: 'cmoutsider@example.com', password: 'correct horse battery' });
    expect((await outsider.get(`/api/projects/${projectId}/comments`)).status).toBe(404);
  });
});
