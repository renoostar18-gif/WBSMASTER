import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignSortKeys } from '../src/store.js';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
beforeAll(async () => { t = await startApp(); });
afterAll(async () => { await t.close(); });

describe('sign-up and sign-in', () => {
  it('creates a user, an organisation and a Saudi calendar with holidays', async () => {
    const { client, orgId } = await Client.signUp(t.app, 'Rayan', { organisation: 'Acme' });
    const me = await client.get('/api/me');
    expect(me.body.user.name).toBe('Rayan');
    expect(me.body.organisations).toEqual([{ id: orgId, name: 'Acme', plan: 'free', role: 'owner' }]);
    const cals = await client.get(`/api/orgs/${orgId}/calendars`);
    const cal = cals.body.calendars[0];
    expect(cal.weekDays).toEqual([0, 1, 2, 3, 4]);
    expect(cal.isDefault).toBe(true);
    expect(cal.exceptions.map((e: { name: string }) => e.name)).toContain('National Day');
    expect(cal.exceptions.some((e: { estimated: boolean }) => e.estimated)).toBe(true);
  });

  it('rejects a duplicate email, a short password and a wrong password', async () => {
    const c = new Client(t.app);
    expect((await c.post('/api/auth/signup', { email: 'RAYAN@example.com', password: 'correct horse battery', name: 'X' })).body.error).toBe('email_taken');
    expect((await c.post('/api/auth/signup', { email: 'new@example.com', password: 'short', name: 'X' })).status).toBe(400);
    expect((await c.post('/api/auth/login', { email: 'rayan@example.com', password: 'wrong password' })).body.error).toBe('invalid_credentials');
    const ok = await c.post('/api/auth/login', { email: 'Rayan@Example.com', password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/me')).status).toBe(401);
  });
});

describe('projects and edits through the engine', () => {
  let owner: Client, orgId: string, projectId: string;

  beforeAll(async () => {
    const s = await Client.signUp(t.app, 'Owner1');
    owner = s.client;
    orgId = s.orgId;
    const p = await owner.post(`/api/orgs/${orgId}/projects`, { name: '24 kV RMU' });
    expect(p.status).toBe(201);
    projectId = p.body.id;
  });

  const ops = (list: unknown[]) => owner.post(`/api/projects/${projectId}/ops`, { ops: list });

  it('adds a tree of items and numbers them', async () => {
    const pm = randomUUID(), design = randomUUID(), a = randomUUID(), b = randomUUID();
    const r = await ops([
      { op: 'add', id: pm, parentId: null, values: { name: 'Project management', owner: 'PMO' } },
      { op: 'add', id: design, parentId: null, values: { name: 'Design' } },
      { op: 'add', id: a, parentId: design, values: { name: 'Electrical design', plannedStart: '2026-10-18', plannedFinish: '2026-10-22' } },
      { op: 'add', id: b, parentId: design, values: { name: 'Mechanical design', plannedStart: '2026-10-25', plannedFinish: '2026-10-29' } },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(1);
    expect(r.body.computed.items[b].code).toBe('2.2');
    expect(r.body.computed.items[design].planned).toEqual({ start: '2026-10-18', finish: '2026-10-29' });
    // the first plan also filled the forecast
    expect(r.body.items.find((i: { id: string }) => i.id === a).forecastFinish).toBe('2026-10-22');
  });

  it('links items and auto-schedules over the Saudi weekend', async () => {
    const p = (await owner.get(`/api/projects/${projectId}`)).body;
    const [a, b] = p.items.filter((i: { name: string }) => i.name.endsWith('design')).map((i: { id: string }) => i.id);
    const r1 = await ops([{ op: 'link', succ: b, pred: a }]);
    expect(r1.body.scheduled).toEqual([]);
    // electrical slips by one working day: Thu 22 → Sun 25; mechanical moves Sun 25 → Mon 26
    const r2 = await ops([{ op: 'set', id: a, field: 'forecastFinish', value: '2026-10-25' }]);
    expect(r2.body.scheduled).toEqual([b]);
    const mech = r2.body.items.find((i: { id: string }) => i.id === b);
    // 5 working days kept: Mon 26 – Thu 29, skip Fri/Sat, Sun 1 Nov
    expect([mech.forecastStart, mech.forecastFinish]).toEqual(['2026-10-26', '2026-11-01']);
    expect(r2.body.computed.items[a].variance).toBe(1);
    expect(r2.body.computed.critical.sort()).toEqual([a, b].sort());
  });

  it('refuses a loop, a link inside a family and editing rolled-up parent dates', async () => {
    const p = (await owner.get(`/api/projects/${projectId}`)).body;
    const design = p.items.find((i: { name: string }) => i.name === 'Design').id;
    const [a, b] = p.items.filter((i: { name: string }) => i.name.endsWith('design')).map((i: { id: string }) => i.id);
    expect((await ops([{ op: 'link', succ: a, pred: b }])).body.error).toBe('link_cycle');
    expect((await ops([{ op: 'link', succ: a, pred: design }])).body.error).toBe('link_same_family');
    const r = await ops([{ op: 'set', id: design, field: 'forecastFinish', value: '2026-12-01' }]);
    expect(r.body).toMatchObject({ error: 'parent_rolled_up', opIndex: 0 });
  });

  it('rejects a whole batch when one op is invalid', async () => {
    const before = (await owner.get(`/api/projects/${projectId}`)).body;
    const r = await ops([
      { op: 'add', parentId: null, values: { name: 'Should not exist' } },
      { op: 'delete', id: randomUUID() },
    ]);
    expect(r.body).toMatchObject({ error: 'item_not_found', opIndex: 1 });
    const after = (await owner.get(`/api/projects/${projectId}`)).body;
    expect(after.items.length).toBe(before.items.length);
    expect(after.project.version).toBe(before.project.version);
  });

  it('moves, reorders and deletes items, keeping order after reload', async () => {
    let p = (await owner.get(`/api/projects/${projectId}`)).body;
    const pm = p.items.find((i: { name: string }) => i.name === 'Project management').id;
    const design = p.items.find((i: { name: string }) => i.name === 'Design').id;
    await ops([{ op: 'move', id: design, parentId: null, index: 0 }]);
    p = (await owner.get(`/api/projects/${projectId}`)).body;
    expect(p.computed.items[design].code).toBe('1');
    expect(p.computed.items[pm].code).toBe('2');
    const x = randomUUID();
    await ops([{ op: 'add', id: x, parentId: pm, values: { name: 'Charter' } }, { op: 'move', id: x, parentId: design, index: 1 }]);
    p = (await owner.get(`/api/projects/${projectId}`)).body;
    expect(p.computed.items[x].code).toBe('1.2');
    await ops([{ op: 'delete', id: x }]);
    p = (await owner.get(`/api/projects/${projectId}`)).body;
    expect(p.items.some((i: { id: string }) => i.id === x)).toBe(false);
    expect(p.computed.items[design].childCount).toBe(2);
  });

  it('parses link text with WBS codes and reports ignored tokens', async () => {
    const p = (await owner.get(`/api/projects/${projectId}`)).body;
    const pm = p.items.find((i: { name: string }) => i.name === 'Project management').id;
    const r = await ops([{ op: 'setDeps', id: pm, text: '1.1+2, 9.9' }]);
    expect(r.body.ignoredDeps).toEqual(['9.9']);
    expect(r.body.items.find((i: { id: string }) => i.id === pm).deps).toHaveLength(1);
  });

  it('records activity', async () => {
    const a = await owner.get(`/api/projects/${projectId}/activity`);
    const actions = a.body.activity.map((x: { action: string }) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['project.create', 'item.add', 'link.add', 'item.schedule', 'item.move', 'item.delete']));
    expect(a.body.activity[0].actorName).toBe('Owner1');
  });

  it('saves baselines, compares and restores', async () => {
    let p = (await owner.get(`/api/projects/${projectId}`)).body;
    const a = p.items.find((i: { name: string }) => i.name === 'Electrical design').id;
    const s = await owner.post(`/api/projects/${projectId}/baselines`, { reason: 'Supplier delay approved' });
    expect(s.status).toBe(201);
    expect(s.body.saved).toEqual(['Original baseline', 'Re-baseline 1']);
    p = (await owner.get(`/api/projects/${projectId}`)).body;
    expect(p.computed.items[a].variance).toBe(0); // the forecast is now the plan
    const original = p.baselines[0].id;
    await owner.patch(`/api/projects/${projectId}`, { activeBaselineId: original });
    p = (await owner.get(`/api/projects/${projectId}`)).body;
    expect(p.computed.items[a].variance).toBe(1);
    // free plan allows 1 baseline per project; two now exist, so a third is refused
    expect((await owner.post(`/api/projects/${projectId}/baselines`, {})).body.error).toBe('plan_baseline_limit');
    await owner.post(`/api/projects/${projectId}/baselines/${original}/restore`);
    p = (await owner.get(`/api/projects/${projectId}`)).body;
    expect(p.items.find((i: { id: string }) => i.id === a).plannedFinish).toBe('2026-10-22');
    expect(p.project.settings.activeBaselineId).toBeNull();
  });

  it('re-schedules when a calendar holiday is added', async () => {
    const cals = (await owner.get(`/api/orgs/${orgId}/calendars`)).body.calendars;
    const r = await owner.post(`/api/orgs/${orgId}/calendars/${cals[0].id}/exceptions`, {
      exceptions: [{ date: '2026-10-26', name: 'Shutdown', working: false }],
    });
    expect(r.status).toBe(200);
    const p = (await owner.get(`/api/projects/${projectId}`)).body;
    const mech = p.items.find((i: { name: string }) => i.name === 'Mechanical design');
    expect(mech.forecastStart).toBe('2026-10-27');
    expect(p.calendar.exceptions.some((e: { date: string }) => e.date === '2026-10-26')).toBe(true);
  });
});

describe('permissions and plan limits', () => {
  let owner: Client, orgId: string, viewer: Client, viewerId: string, outsider: Client, projectId: string;

  beforeAll(async () => {
    const o = await Client.signUp(t.app, 'Owner2');
    owner = o.client; orgId = o.orgId;
    const v = await Client.signUp(t.app, 'Viewer2');
    viewer = v.client; viewerId = v.userId;
    outsider = (await Client.signUp(t.app, 'Outsider2')).client;
    projectId = (await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Secret' })).body.id;
    expect((await owner.post(`/api/orgs/${orgId}/members`, { email: 'viewer2@example.com', role: 'member' })).status).toBe(201);
  });

  it('hides projects from non-members and from org members not added to them', async () => {
    expect((await outsider.get(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await viewer.get(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await viewer.get(`/api/orgs/${orgId}/projects`)).body.projects).toEqual([]);
    expect((await outsider.get(`/api/orgs/${orgId}/projects`)).status).toBe(404);
  });

  it('lets a viewer read but not edit', async () => {
    await owner.put(`/api/projects/${projectId}/members/${viewerId}`, { role: 'viewer' });
    expect((await viewer.get(`/api/projects/${projectId}`)).body.role).toBe('viewer');
    const r = await viewer.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'add', parentId: null }] });
    expect(r.status).toBe(403);
    expect((await viewer.post(`/api/projects/${projectId}/baselines`, {})).status).toBe(403);
  });

  it('lets an editor edit but not change settings or baselines', async () => {
    await owner.put(`/api/projects/${projectId}/members/${viewerId}`, { role: 'editor' });
    expect((await viewer.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'add', parentId: null }] })).status).toBe(200);
    expect((await viewer.patch(`/api/projects/${projectId}`, { redThresholdDays: 3 })).status).toBe(403);
  });

  it('enforces free-plan limits: 3 active projects, 3 members, no guests', async () => {
    await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Two' });
    await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Three' });
    expect((await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Four' })).body.error).toBe('plan_project_limit');
    await Client.signUp(t.app, 'Third2');
    await Client.signUp(t.app, 'Fourth2');
    expect((await owner.post(`/api/orgs/${orgId}/members`, { email: 'third2@example.com', role: 'member' })).status).toBe(201);
    expect((await owner.post(`/api/orgs/${orgId}/members`, { email: 'fourth2@example.com', role: 'member' })).body.error).toBe('plan_member_limit');
    expect((await owner.post(`/api/orgs/${orgId}/members`, { email: 'fourth2@example.com', role: 'guest' })).body.error).toBe('plan_no_guests');
  });

  it('keeps at least one owner', async () => {
    const me = (await owner.get('/api/me')).body.user.id;
    expect((await owner.patch(`/api/orgs/${orgId}/members/${me}`, { role: 'admin' })).body.error).toBe('last_owner');
  });

  it('returns 404 for malformed ids instead of a server error', async () => {
    expect((await owner.get('/api/projects/not-a-uuid')).status).toBe(404);
  });
});

describe('sort keys', () => {
  const it_ = (id: string, parentId: string | null = null) => ({ id, parentId }) as never;
  it('keeps existing keys and fits new items between neighbours', () => {
    const old = new Map([['a', 1], ['b', 2], ['c', 3]]);
    const k = assignSortKeys([it_('a'), it_('x'), it_('b'), it_('c')], old);
    expect([k.get('a'), k.get('b'), k.get('c')]).toEqual([1, 2, 3]);
    expect(k.get('x')).toBeGreaterThan(1);
    expect(k.get('x')).toBeLessThan(2);
  });
  it('re-keys a moved item only', () => {
    const old = new Map([['a', 1], ['b', 2], ['c', 3]]);
    const k = assignSortKeys([it_('c'), it_('a'), it_('b')], old);
    expect([k.get('a'), k.get('b')]).toEqual([1, 2]);
    expect(k.get('c')).toBeLessThan(1);
  });
});
