import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
beforeAll(async () => { t = await startApp({ shareRateLimit: 1000 }); });
afterAll(async () => { await t.close(); });

const anon = () => new Client(t.app);
const tokenOf = (url: string) => /\/share\/([A-Za-z0-9_-]+)$/.exec(url)![1]!;

describe('public read-only links', () => {
  let owner: Client, orgId: string, projectId: string, otherProject: string;
  let member: Client, memberId: string;

  beforeAll(async () => {
    const o = await Client.signUp(t.app, 'LinkOwner');
    owner = o.client; orgId = o.orgId;
    const m = await Client.signUp(t.app, 'LinkMember');
    member = m.client; memberId = m.userId;
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'linkmember@example.com', role: 'member' });
    projectId = (await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Client plan' })).body.id;
    otherProject = (await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Secret other project' })).body.id;
    await owner.post(`/api/projects/${projectId}/ops`, { ops: [
      { op: 'add', parentId: null, values: { name: 'Design', owner: 'Nora Q', notes: 'internal: budget is tight', plannedStart: '2026-10-04', plannedFinish: '2026-10-29', progress: 30 } },
      { op: 'add', parentId: null, values: { name: 'Build', owner: 'Faisal K', plannedStart: '2026-11-01', plannedFinish: '2026-11-26' } },
    ] });
    await owner.post(`/api/projects/${otherProject}/ops`, { ops: [{ op: 'add', parentId: null, values: { name: 'Other work', notes: 'other notes' } }] });
    await owner.post(`/api/projects/${projectId}/baselines`, { name: 'Contract', reason: 'private reason for the baseline' });
    await owner.put(`/api/projects/${projectId}/summary`, { narrative: 'On track overall.' });
    await owner.post(`/api/projects/${projectId}/comments`, { body: 'a private comment' });
    await owner.put(`/api/projects/${projectId}/members/${memberId}`, { role: 'editor' });
  });

  it('is part of the Team and Business plans', async () => {
    expect((await owner.get(`/api/projects/${projectId}/links`)).body).toEqual({ links: [], available: false });
    expect((await owner.post(`/api/projects/${projectId}/links`, {})).body.error).toBe('plan_public_links');
    await t.db.query("update organisations set plan = 'team' where id = $1", [orgId]);
  });

  it('only project admins make or see links', async () => {
    expect((await member.post(`/api/projects/${projectId}/links`, {})).status).toBe(403);
    expect((await member.get(`/api/projects/${projectId}/links`)).status).toBe(403);
    const { client: stranger } = await Client.signUp(t.app, 'LinkStranger');
    expect((await stranger.post(`/api/projects/${projectId}/links`, {})).status).toBe(404);
  });

  it('makes a link and shows the plan to anyone with it, without private fields', async () => {
    const r = await owner.post(`/api/projects/${projectId}/links`, {});
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/^https:\/\/app\.example\/share\/[A-Za-z0-9_-]{32}$/);
    expect(r.body).toMatchObject({ views: ['table', 'chart', 'gantt', 'summary'], showOwners: true, expiresAt: null });
    const token = tokenOf(r.body.url);
    // only the hash is stored
    const stored = await t.db.query('select token_hash from public_links where id = $1', [r.body.id]);
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(JSON.stringify((await owner.get(`/api/projects/${projectId}/links`)).body)).not.toContain(token);

    const res = await t.app.inject({ method: 'GET', url: `/api/share/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.project).toMatchObject({ name: 'Client plan', archived: false });
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['Design', 'Build']);
    expect(body.items[0].owner).toBe('Nora Q');
    expect(Object.keys(body.computed.items)).toHaveLength(2);
    expect(body.summary.narrative).toBe('On track overall.');
    expect(body.baselines.map((b: { name: string }) => b.name)).toContain('Contract');
    const text = JSON.stringify(body);
    for (const secret of ['internal: budget', 'private reason', 'a private comment', 'linkowner@example.com', 'linkmember@example.com',
      'LinkOwner', 'Secret other project', 'other notes', orgId, projectId]) {
      expect(text).not.toContain(secret);
    }
    expect(body).not.toHaveProperty('role');
    expect(body).not.toHaveProperty('comments');
    expect(body).not.toHaveProperty('activity');
  });

  it('shows only the chosen views, and hides owners when asked', async () => {
    const r = await owner.post(`/api/projects/${projectId}/links`, { views: ['gantt', 'table', 'gantt'], showOwners: false });
    expect(r.body.views).toEqual(['table', 'gantt']);
    const body = (await anon().get(`/api/share/${tokenOf(r.body.url)}`)).body;
    expect(body.views).toEqual(['table', 'gantt']);
    expect(body.summary).toBeNull(); // no Summary view: no summary text
    expect(body.items.every((i: { owner: string }) => i.owner === '')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Nora Q');
    expect((await owner.post(`/api/projects/${projectId}/links`, { views: [] })).status).toBe(400);
    expect((await owner.post(`/api/projects/${projectId}/links`, { views: ['comments'] })).status).toBe(400);
  });

  it('expires at the end of the chosen day', async () => {
    expect((await owner.post(`/api/projects/${projectId}/links`, { expiresOn: '2020-01-01' })).body.error).toBe('share_expiry_past');
    const r = await owner.post(`/api/projects/${projectId}/links`, { expiresOn: '2099-12-31' });
    expect(r.body.expiresAt).toBe('2100-01-01T00:00:00.000Z');
    const token = tokenOf(r.body.url);
    expect((await anon().get(`/api/share/${token}`)).status).toBe(200);
    await t.db.query("update public_links set expires_at = now() - interval '1 minute' where id = $1", [r.body.id]);
    expect((await anon().get(`/api/share/${token}`)).body.error).toBe('share_expired');
    const listed = (await owner.get(`/api/projects/${projectId}/links`)).body.links.find((l: { id: string }) => l.id === r.body.id);
    expect(listed.expired).toBe(true);
  });

  it('stops working when revoked, and records who made and revoked it', async () => {
    const r = await owner.post(`/api/projects/${projectId}/links`, {});
    const token = tokenOf(r.body.url);
    expect((await anon().get(`/api/share/${token}`)).status).toBe(200);
    expect((await member.del(`/api/projects/${projectId}/links/${r.body.id}`)).status).toBe(403);
    expect((await owner.del(`/api/projects/${projectId}/links/${r.body.id}`)).body).toEqual({ ok: true });
    expect((await anon().get(`/api/share/${token}`)).body.error).toBe('share_not_found');
    expect((await owner.del(`/api/projects/${projectId}/links/${r.body.id}`)).status).toBe(404);
    const acts = (await owner.get(`/api/projects/${projectId}/activity`)).body.activity.map((a: { action: string }) => a.action);
    expect(acts).toContain('share.create');
    expect(acts).toContain('share.revoke');
  });

  it('cannot reach another project, nor revoke a link through another project', async () => {
    const r = await owner.post(`/api/projects/${projectId}/links`, {});
    expect((await owner.del(`/api/projects/${otherProject}/links/${r.body.id}`)).status).toBe(404);
    expect((await anon().get('/api/share/not-a-real-token-but-long-enough')).body.error).toBe('share_not_found');
    expect((await anon().get('/api/share/x')).status).toBe(404);
    // signed-out people still cannot use the normal project routes
    expect((await anon().get(`/api/projects/${otherProject}`)).status).toBe(401);
    expect((await anon().get(`/api/projects/${projectId}`)).status).toBe(401);
  });

  it('cannot be made with an API key', async () => {
    const { key } = (await owner.post('/api/me/api-keys', { name: 'k', orgId, scope: 'write' })).body;
    const res = await t.app.inject({ method: 'POST', url: `/api/projects/${projectId}/links`, payload: {}, headers: { authorization: `Bearer ${key}` } });
    expect(res.json().error).toBe('not_with_api_key');
  });

  it('keeps working for an archived project, and stops when the plan drops to Free or the project is deleted', async () => {
    const r = await owner.post(`/api/projects/${projectId}/links`, {});
    const token = tokenOf(r.body.url);
    await owner.patch(`/api/projects/${projectId}`, { archived: true });
    expect((await anon().get(`/api/share/${token}`)).body.project.archived).toBe(true);
    await owner.patch(`/api/projects/${projectId}`, { archived: false });

    await t.db.query("update organisations set plan = 'free' where id = $1", [orgId]);
    expect((await anon().get(`/api/share/${token}`)).body.error).toBe('share_not_found');
    await t.db.query("update organisations set plan = 'business' where id = $1", [orgId]);
    expect((await anon().get(`/api/share/${token}`)).status).toBe(200);

    await owner.del(`/api/projects/${projectId}`);
    expect((await anon().get(`/api/share/${token}`)).body.error).toBe('share_not_found');
    expect((await t.db.query('select 1 from public_links where project_id = $1', [projectId])).rowCount).toBe(0);
  });
});

describe('public link rate limit', () => {
  it('limits requests from one address', async () => {
    const s = await startApp({ shareRateLimit: 3 });
    try {
      const codes: number[] = [];
      for (let k = 0; k < 4; k++) codes.push((await s.app.inject({ method: 'GET', url: '/api/share/abcdefghijklmnopqrstuvwxyz' })).statusCode);
      expect(codes).toEqual([404, 404, 404, 429]);
    } finally {
      await s.close();
    }
  });
});
