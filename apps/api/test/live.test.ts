import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Client, type TestApp, startApp } from './setup.js';

let t: TestApp;
let base: string;
beforeAll(async () => {
  t = await startApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address();
  base = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(async () => { await t.close(); });

/** A WebSocket that collects messages and can wait for one matching a test. */
function connect(path: string, cookie: string) {
  const ws = new WebSocket(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  const messages: { type: string; [k: string]: unknown }[] = [];
  const waiters: [(m: (typeof messages)[number]) => boolean, (m: (typeof messages)[number]) => void][] = [];
  ws.on('message', raw => {
    const m = JSON.parse(String(raw));
    messages.push(m);
    for (const [k, w] of [...waiters.entries()].reverse()) if (w[0](m)) { w[1](m); waiters.splice(k, 1); }
  });
  const closed = new Promise<number>(res => ws.on('close', code => res(code)));
  const opened = new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej); });
  const next = (pred: (m: (typeof messages)[number]) => boolean, ms = 3000) =>
    new Promise<(typeof messages)[number]>((res, rej) => {
      const hit = messages.find(pred);
      if (hit) return res(hit);
      waiters.push([pred, res]);
      setTimeout(() => rej(new Error('no matching message')), ms);
    });
  return { ws, messages, next, closed, opened };
}

describe('live updates', () => {
  let owner: Client, editor: Client, projectId: string, editorId: string, ownerId: string;

  beforeAll(async () => {
    const o = await Client.signUp(t.app, 'LiveOwner');
    owner = o.client; ownerId = o.userId;
    const e = await Client.signUp(t.app, 'LiveEditor');
    editor = e.client; editorId = e.userId;
    projectId = (await owner.post(`/api/orgs/${o.orgId}/projects`, { name: 'Live' })).body.id;
    await owner.post(`/api/orgs/${o.orgId}/members`, { email: 'liveeditor@example.com', role: 'member' });
    await owner.put(`/api/projects/${projectId}/members/${editorId}`, { role: 'editor' });
  });

  it('shows who is viewing and what they selected', async () => {
    const a = connect(`/api/projects/${projectId}/live`, owner.cookie);
    await a.opened;
    const b = connect(`/api/projects/${projectId}/live`, editor.cookie);
    await b.opened;
    const both = await a.next(m => m.type === 'presence' && (m.viewers as unknown[]).length === 2);
    expect((both.viewers as { userId: string }[]).map(v => v.userId).sort()).toEqual([ownerId, editorId].sort());
    const item = randomUUID();
    b.ws.send(JSON.stringify({ type: 'select', itemId: item }));
    const sel = await a.next(m => m.type === 'presence' && (m.viewers as { selected: string | null }[]).some(v => v.selected === item));
    expect((sel.viewers as { userId: string; selected: string }[]).find(v => v.selected === item)!.userId).toBe(editorId);
    b.ws.close();
    await a.next(m => m.type === 'presence' && (m.viewers as unknown[]).length === 1);
    a.ws.close();
  });

  it('tells open pages when someone saves, with the new version and the items changed', async () => {
    const a = connect(`/api/projects/${projectId}/live`, owner.cookie);
    await a.opened;
    const id = randomUUID();
    const r = await editor.post(`/api/projects/${projectId}/ops`, { ops: [{ op: 'add', id, parentId: null, values: { name: 'From editor' } }] });
    const msg = await a.next(m => m.type === 'changed');
    expect(msg).toMatchObject({ type: 'changed', version: r.body.version, actorId: editorId, actorName: 'LiveEditor', items: [id], clientId: null });
    await owner.patch(`/api/projects/${projectId}`, { redThresholdDays: 4 });
    const msg2 = await a.next(m => m.type === 'changed' && (m.version as number) > r.body.version);
    expect(msg2.actorId).toBe(ownerId);
    a.ws.close();
  });

  it('refuses people who are not signed in or cannot see the project', async () => {
    const anon = connect(`/api/projects/${projectId}/live`, '');
    expect(await anon.closed).toBe(4401);
    const stranger = (await Client.signUp(t.app, 'LiveStranger')).client;
    const s = connect(`/api/projects/${projectId}/live`, stranger.cookie);
    expect(await s.closed).toBe(4404);
  });
});
