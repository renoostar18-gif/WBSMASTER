import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pruneHistory } from '../src/audit.js';
import type { PaymentGateway } from '../src/moyasar.js';
import { runDailyDeletions } from '../src/orgadmin.js';
import { Client, TODAY, type TestApp, startApp } from './setup.js';

let t: TestApp;
const cancelled: string[] = [];
const gateway: PaymentGateway = {
  createInvoice: async () => { throw new Error('not used'); },
  getInvoice: async id => ({ id, status: 'initiated', amount: 0, currency: 'SAR', url: '' }),
  cancelInvoice: async id => { cancelled.push(id); },
};

beforeAll(async () => { t = await startApp({}, { gateway }); });
afterAll(async () => { await t.close(); });

const actions = async (c: Client, orgId: string, q = '') =>
  ((await c.get(`/api/orgs/${orgId}/audit${q}`)).body.events as { action: string }[]).map(e => e.action);

describe('transferring ownership', () => {
  it('makes another member an owner, and the old owner an administrator when they step down', async () => {
    const { client: owner, userId: ownerId, orgId } = await Client.signUp(t.app, 'Tamara');
    const { client: next, userId: nextId } = await Client.signUp(t.app, 'Nabil');
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'nabil@example.com', role: 'member' });

    expect((await owner.post(`/api/orgs/${orgId}/transfer`, { userId: ownerId })).body.error).toBe('transfer_to_self');
    expect((await next.post(`/api/orgs/${orgId}/transfer`, { userId: nextId })).status).toBe(403);
    const r = await owner.post(`/api/orgs/${orgId}/transfer`, { userId: nextId, stepDown: true });
    expect(r.body).toEqual({ ok: true });
    const roles = Object.fromEntries((await next.get(`/api/orgs/${orgId}/members`)).body.members.map((m: { id: string; role: string }) => [m.id, m.role]));
    expect(roles).toEqual({ [ownerId]: 'admin', [nextId]: 'owner' });
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'nabil@example.com', subject: 'You are now an owner of Tamara\'s workspace' });

    // the former owner is now an admin: no more owner-only actions; the new owner keeps at least one owner
    expect((await owner.post(`/api/orgs/${orgId}/transfer`, { userId: ownerId })).status).toBe(403);
    expect((await next.patch(`/api/orgs/${orgId}/members/${nextId}`, { role: 'admin' })).body.error).toBe('last_owner');

    const log = (await next.get(`/api/orgs/${orgId}/audit?action=org`)).body.events;
    expect(log[0]).toMatchObject({ action: 'org.ownership_transferred', target: 'nabil@example.com', actorName: 'Tamara', details: { from: 'member', stepDown: true } });
    expect(log[0].ip).toBeTruthy();
  });
});

describe('audit log', () => {
  let owner: Client;
  let orgId: string;
  beforeAll(async () => { ({ client: owner, orgId } = await Client.signUp(t.app, 'Aisha')); });

  it('records people, invitations and projects, newest first', async () => {
    const { userId: badrId } = await Client.signUp(t.app, 'Badr');
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'badr@example.com', role: 'member' });
    await owner.patch(`/api/orgs/${orgId}/members/${badrId}`, { role: 'admin' });
    const inv = await owner.post(`/api/orgs/${orgId}/members`, { email: 'new@example.com', role: 'member' });
    await owner.post(`/api/orgs/${orgId}/invitations/${inv.body.invitationId}/resend`);
    await owner.del(`/api/orgs/${orgId}/invitations/${inv.body.invitationId}`);
    await owner.del(`/api/orgs/${orgId}/members/${badrId}`);
    const p = (await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Tower' })).body.id;
    await owner.patch(`/api/projects/${p}`, { archived: true });
    await owner.patch(`/api/projects/${p}`, { archived: false });
    await owner.del(`/api/projects/${p}`);
    await owner.patch(`/api/orgs/${orgId}`, { name: 'Aisha & Co' });

    expect(await actions(owner, orgId)).toEqual([
      'org.renamed', 'project.deleted', 'project.restored', 'project.archived', 'project.created', 'member.removed',
      'invitation.withdrawn', 'invitation.resent', 'invitation.sent', 'member.role_changed', 'member.added', 'org.created',
    ]);
    const r = (await owner.get(`/api/orgs/${orgId}/audit?action=member.role_changed`)).body;
    expect(r.events).toEqual([expect.objectContaining({ target: 'badr@example.com', actorName: 'Aisha', details: { userId: badrId, name: 'Badr', from: 'member', to: 'admin' } })]);
    expect(r).toMatchObject({ retentionDays: 30, canExport: false, next: null });
    expect(await actions(owner, orgId, '?action=invitation')).toEqual(['invitation.withdrawn', 'invitation.resent', 'invitation.sent']);
  });

  it('pages through the log', async () => {
    const first = (await owner.get(`/api/orgs/${orgId}/audit?limit=5`)).body;
    expect(first.events).toHaveLength(5);
    const second = (await owner.get(`/api/orgs/${orgId}/audit?limit=5&before=${first.next}`)).body;
    expect(second.events[0].id).toBeLessThan(first.events[4].id);
    const third = (await owner.get(`/api/orgs/${orgId}/audit?limit=5&before=${second.next}`)).body;
    expect(third.events).toHaveLength(2);
    expect(third.next).toBeNull();
  });

  it('records invitations accepted, trials, plan changes, API keys and webhooks', async () => {
    const inv = await owner.post(`/api/orgs/${orgId}/members`, { email: 'dana@example.com', role: 'member' });
    expect(inv.body.invited).toBe(true);
    const token = /invite\/([A-Za-z0-9_-]+)/.exec(t.mail.sent.at(-1)!.text)![1];
    await new Client(t.app).post('/api/auth/signup', { email: 'dana@example.com', password: 'correct horse battery', name: 'Dana', invite: token });
    await owner.post(`/api/orgs/${orgId}/billing/trial`, { plan: 'team' });
    const key = await owner.post('/api/me/api-keys', { name: 'Reports', orgId, scope: 'read' });
    await owner.del(`/api/me/api-keys/${key.body.id}`);
    const hook = await owner.post(`/api/orgs/${orgId}/webhooks`, { url: 'https://hooks.example.com/x', events: ['item.changed'] });
    await owner.del(`/api/orgs/${orgId}/webhooks/${hook.body.id}`);
    expect((await actions(owner, orgId)).slice(0, 7)).toEqual([
      'webhook.deleted', 'webhook.created', 'api_key.revoked', 'api_key.created', 'billing.plan_changed', 'billing.trial_started', 'invitation.accepted',
    ]);
    const plan = (await owner.get(`/api/orgs/${orgId}/audit?action=billing.plan_changed`)).body.events[0];
    expect(plan).toMatchObject({ actorName: null, target: 'team', details: { from: 'free', to: 'team', trial: true } });
    const accepted = (await owner.get(`/api/orgs/${orgId}/audit?action=invitation.accepted`)).body.events[0];
    expect(accepted).toMatchObject({ actorName: 'Dana', target: 'dana@example.com' });
  });

  it('is for admins only; Business can export it as CSV', async () => {
    const dana = new Client(t.app);
    await dana.post('/api/auth/login', { email: 'dana@example.com', password: 'correct horse battery' });
    expect((await dana.get(`/api/orgs/${orgId}/audit`)).status).toBe(403);
    expect((await owner.get(`/api/orgs/${orgId}/audit.csv`)).body.error).toBe('plan_history_export');

    await t.db.query("update organisations set plan = 'business' where id = $1", [orgId]);
    await t.db.query("insert into audit_log (org_id, action, target) values ($1, 'project.created', '=HYPERLINK(\"x\")')", [orgId]);
    const res = await t.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/audit.csv`, headers: { cookie: owner.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.split('\r\n');
    expect(lines[0]).toBe('﻿"time","actor","action","target","details","ip"');
    expect(lines[1]).toContain('"\'=HYPERLINK(""x"")"'); // not run as a formula
    expect(lines.at(-2)).toContain('"org.created"');
    expect((await owner.get(`/api/orgs/${orgId}/audit`)).body).toMatchObject({ retentionDays: null, canExport: true });
  });
});

describe('deleting an organisation', () => {
  let owner: Client;
  let member: Client;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    ({ client: owner, orgId } = await Client.signUp(t.app, 'Omar'));
    ({ client: member } = await Client.signUp(t.app, 'Mona'));
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'mona@example.com', role: 'admin' });
    projectId = (await owner.post(`/api/orgs/${orgId}/projects`, { name: 'Plant' })).body.id;
    await owner.post(`/api/orgs/${orgId}/members`, { email: 'later@example.com', role: 'member' });
    await t.db.query(
      `insert into billing_invoices (org_id, kind, plan, interval, seats, period_start, period_end, subtotal, total, moyasar_id)
       values ($1, 'new', 'team', 'month', 2, '2026-10-22', '2026-11-22', 9000, 9000, 'mi_open')`, [orgId]);
  });

  it('is for owners only, and needs the organisation’s exact name', async () => {
    expect((await member.post(`/api/orgs/${orgId}/deletion`, { confirm: 'Omar\'s workspace' })).status).toBe(403);
    expect((await owner.post(`/api/orgs/${orgId}/deletion`, { confirm: 'omar\'s workspace' })).body.error).toBe('delete_confirm_mismatch');
  });

  it('locks the organisation for 30 days, tells the owners and cancels open checkouts', async () => {
    const r = await owner.post(`/api/orgs/${orgId}/deletion`, { confirm: 'Omar\'s workspace' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ deleteOn: '2026-11-21' });
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'omar@example.com', subject: 'Organisation scheduled for deletion: Omar\'s workspace' });
    expect(t.mail.sent.at(-1)!.text).toContain('21 November 2026');
    expect(cancelled).toEqual(['mi_open']);
    expect((await t.db.query("select status from billing_invoices where org_id = $1", [orgId])).rows).toEqual([{ status: 'canceled' }]);
    expect((await owner.post(`/api/orgs/${orgId}/deletion`, { confirm: 'Omar\'s workspace' })).body.error).toBe('org_pending_deletion');

    // members no longer see it
    expect((await member.get('/api/me')).body.organisations.map((o: { id: string }) => o.id)).not.toContain(orgId);
    expect((await member.get(`/api/orgs/${orgId}/projects`)).status).toBe(404);
    expect((await member.get(`/api/projects/${projectId}`)).status).toBe(404);
    // owners can read, not change
    expect((await owner.get('/api/me')).body.organisations.find((o: { id: string }) => o.id === orgId)).toMatchObject({ deleteOn: '2026-11-21' });
    expect((await owner.get(`/api/projects/${projectId}`)).body.project).toMatchObject({ readOnly: 'deletion', deleteOn: '2026-11-21' });
    expect((await owner.post(`/api/orgs/${orgId}/projects`, { name: 'More' })).body.error).toBe('org_pending_deletion');
    expect((await owner.post(`/api/projects/${projectId}/ops`, { ops: [] })).body.error).toBe('org_pending_deletion');
    expect((await owner.patch(`/api/orgs/${orgId}`, { name: 'X' })).body.error).toBe('org_pending_deletion');
    // nobody else can reach it by an invitation link
    const token = /invite\/([A-Za-z0-9_-]+)/.exec(t.mail.sent.find(m => m.to === 'later@example.com')!.text)![1];
    expect((await new Client(t.app).get(`/api/invitations/${token}`)).status).toBe(404);
  });

  it('can be cancelled by an owner, which unlocks it', async () => {
    expect((await member.del(`/api/orgs/${orgId}/deletion`)).status).toBe(404);
    expect((await owner.del(`/api/orgs/${orgId}/deletion`)).body).toEqual({ ok: true });
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'omar@example.com', subject: 'Deletion cancelled: Omar\'s workspace' });
    expect((await member.get(`/api/projects/${projectId}`)).body.project.readOnly).toBeNull();
    expect((await owner.del(`/api/orgs/${orgId}/deletion`)).body.error).toBe('deletion_not_scheduled');
    expect(await actions(owner, orgId, '?action=org')).toEqual(['org.deletion_cancelled', 'org.deletion_scheduled', 'org.created']);
  });

  it('is done by the daily job after 30 days, with all its data; the people can start again', async () => {
    // an issued invoice, which must be kept for years, next to the cancelled checkout from before
    const buyer = { organisation: 'Omar\'s workspace', name: 'Omar Trading', address: 'Jeddah', vatNumber: '300000000000003', email: 'billing@example.com' };
    const paid = (await t.db.query<{ id: string }>(
      `insert into billing_invoices (org_id, number, kind, plan, interval, seats, period_start, period_end, subtotal, total, status, paid_at, seller, buyer)
       values ($1, 9001, 'new', 'team', 'month', 2, '2026-09-22', '2026-10-22', 9000, 9000, 'paid', now(), '{"name":"WBS Master Co"}', $2) returning id`,
      [orgId, JSON.stringify(buyer)])).rows[0]!.id;
    await owner.post(`/api/orgs/${orgId}/deletion`, { confirm: 'Omar\'s workspace' });
    const day = (iso: string) => () => new Date(`${iso}T03:00:00Z`);
    const ctx = { db: t.db, mailer: t.mail, appUrl: 'https://app.example' };
    expect(await runDailyDeletions({ ...ctx, today: day('2026-11-20') })).toBe(0);
    expect(await runDailyDeletions({ ...ctx, today: day('2026-11-21') })).toBe(1);
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'omar@example.com', subject: 'Organisation deleted: Omar\'s workspace' });
    for (const table of ['organisations', 'projects', 'audit_log', 'billing_invoices', 'invitations', 'memberships']) {
      const col = table === 'organisations' ? 'id' : 'org_id';
      expect((await t.db.query(`select 1 from ${table} where ${col} = $1`, [orgId])).rowCount, table).toBe(0);
    }
    expect((await t.db.query('select 1 from wbs_items where project_id = $1', [projectId])).rowCount).toBe(0);
    // the paid invoice stays, without the organisation, with its number and buyer; the unpaid checkout is gone
    expect((await t.db.query('select org_id, number, status, buyer from billing_invoices where id = $1', [paid])).rows)
      .toEqual([{ org_id: null, number: 9001, status: 'paid', buyer }]);
    expect((await t.db.query("select 1 from billing_invoices where moyasar_id = 'mi_open'")).rowCount).toBe(0);
    // Omar belongs to nothing now, but can still sign in and make a new organisation
    const omar = new Client(t.app);
    expect((await omar.post('/api/auth/login', { email: 'omar@example.com', password: 'correct horse battery' })).status).toBe(200);
    expect((await omar.get('/api/me')).body.organisations).toEqual([]);
    const fresh = await omar.post('/api/orgs', { name: 'Omar Again' });
    expect(fresh.status).toBe(201);
    expect((await omar.get('/api/me')).body.organisations).toEqual([expect.objectContaining({ id: fresh.body.id, role: 'owner' })]);
  });
});

describe('history retention by plan', () => {
  it('deletes activity and audit entries older than the plan keeps; Business keeps everything', async () => {
    const orgs: Record<string, { client: Client; orgId: string; projectId: string }> = {};
    for (const plan of ['free', 'team', 'business']) {
      const s = await Client.signUp(t.app, `Keep${plan}`);
      const projectId = (await s.client.post(`/api/orgs/${s.orgId}/projects`, { name: 'P' })).body.id;
      await t.db.query('update organisations set plan = $2 where id = $1', [s.orgId, plan]);
      for (const ago of [29, 31, 364, 366, 2000]) {
        await t.db.query("insert into activity_log (project_id, action, at) values ($1, 'test', $2::timestamptz - make_interval(days => $3))", [projectId, TODAY, ago]);
        await t.db.query("insert into audit_log (org_id, action, created_at) values ($1, 'project.created', $2::timestamptz - make_interval(days => $3))", [s.orgId, TODAY, ago]);
      }
      orgs[plan] = { ...s, projectId };
    }
    const count = async (plan: string) => ({
      activity: (await t.db.query("select 1 from activity_log where project_id = $1 and action = 'test'", [orgs[plan]!.projectId])).rowCount,
      audit: (await t.db.query("select 1 from audit_log where org_id = $1 and created_at < now() - interval '1 day'", [orgs[plan]!.orgId])).rowCount,
    });
    await pruneHistory(t.db, '2026-10-22');
    expect(await count('free')).toEqual({ activity: 1, audit: 1 });
    expect(await count('team')).toEqual({ activity: 3, audit: 3 });
    expect(await count('business')).toEqual({ activity: 5, audit: 5 });
    // the latest entries are always kept
    expect((await t.db.query("select 1 from activity_log where project_id = $1 and action = 'project.create'", [orgs.free!.projectId])).rowCount).toBe(1);
  });

  it('tells the activity panel how long history is kept; Business exports it as CSV', async () => {
    const { client, orgId } = await Client.signUp(t.app, 'Exporter');
    const p = (await client.post(`/api/orgs/${orgId}/projects`, { name: 'Bridge' })).body.id;
    await client.post(`/api/projects/${p}/ops`, { ops: [{ op: 'add', parentId: null, values: { name: '=1+1 فحص' } }] });
    expect((await client.get(`/api/projects/${p}/activity`)).body).toMatchObject({ retentionDays: 30, canExport: false });
    expect((await client.get(`/api/projects/${p}/activity.csv`)).body.error).toBe('plan_history_export');
    await t.db.query("update organisations set plan = 'business' where id = $1", [orgId]);
    expect((await client.get(`/api/projects/${p}/activity`)).body).toMatchObject({ retentionDays: null, canExport: true });
    const res = await t.app.inject({ method: 'GET', url: `/api/projects/${p}/activity.csv`, headers: { cookie: client.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('activity.csv');
    expect(res.body).toContain('"item.add"');
    expect(res.body).toContain('"\'=1+1 فحص"');
    expect(res.body).toContain('"project.create"');
  });
});
