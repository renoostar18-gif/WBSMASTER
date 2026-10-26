import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { WebSocket } from 'ws';

/**
 * Live updates per project: who is viewing, what each person has selected,
 * and a "changed" message after every save so open pages fetch the new version.
 * Each API instance holds its own connections; with a bus (Postgres
 * LISTEN/NOTIFY) instances share messages and presence, so people connected to
 * different instances still see each other (spec 8.2).
 */
export interface Viewer {
  connId: string;
  userId: string;
  name: string;
  selected: string | null;
}

export type LiveMessage =
  | { type: 'presence'; viewers: Viewer[] }
  | { type: 'changed'; version: number; actorId: string; actorName: string; items: string[]; clientId: string | null }
  | { type: 'comments'; actorId: string; clientId: string | null };

/** What instances tell each other: a message for a project's viewers, or one instance's viewers of a project. */
export type BusMessage =
  | { kind: 'send'; instance: string; projectId: string; msg: LiveMessage }
  | { kind: 'presence'; instance: string; projectId: string; viewers: Viewer[] };

export interface LiveBus {
  publish(m: BusMessage): void;
  subscribe(fn: (m: BusMessage) => void): void;
  close(): Promise<void>;
}

/** NOTIFY payloads are limited to 8000 bytes: long lists of changed items are cut (they only drive a notice). */
const MAX_ITEMS = 100;
/** Instances repeat their presence this often, and forget another instance's after this long without it. */
const HEARTBEAT_MS = 30_000;
const STALE_MS = 75_000;

interface Conn { socket: WebSocket; viewer: Viewer }

export class LiveHub {
  readonly instance = randomBytes(4).toString('hex');
  private rooms = new Map<string, Map<string, Conn>>();
  /** projectId → instance → its viewers, as last announced. */
  private remote = new Map<string, Map<string, { viewers: Viewer[]; at: number }>>();
  private seq = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly bus: LiveBus | null = null, private readonly now = () => Date.now()) {
    bus?.subscribe(m => this.receive(m));
    if (bus) {
      this.heartbeat = setInterval(() => { for (const p of this.rooms.keys()) this.announce(p); }, HEARTBEAT_MS);
      this.heartbeat.unref?.();
    }
  }

  join(projectId: string, socket: WebSocket, user: { id: string; name: string }): string {
    const connId = `${this.instance}-${++this.seq}`;
    let room = this.rooms.get(projectId);
    if (!room) this.rooms.set(projectId, (room = new Map()));
    room.set(connId, { socket, viewer: { connId, userId: user.id, name: user.name, selected: null } });
    this.presence(projectId);
    return connId;
  }

  leave(projectId: string, connId: string) {
    const room = this.rooms.get(projectId);
    if (!room) return;
    room.delete(connId);
    if (!room.size) this.rooms.delete(projectId);
    this.presence(projectId);
  }

  select(projectId: string, connId: string, itemId: string | null) {
    const c = this.rooms.get(projectId)?.get(connId);
    if (!c || c.viewer.selected === itemId) return;
    c.viewer.selected = itemId;
    this.presence(projectId);
  }

  /** Tell everyone viewing the project that a new version was saved. */
  changed(projectId: string, version: number, actor: { id: string; name: string }, items: string[] = [], clientId: string | null = null) {
    this.broadcast(projectId, { type: 'changed', version, actorId: actor.id, actorName: actor.name, items: items.slice(0, MAX_ITEMS), clientId });
  }

  /** Tell everyone viewing the project that its comments changed. */
  comments(projectId: string, actor: { id: string }, clientId: string | null = null) {
    this.broadcast(projectId, { type: 'comments', actorId: actor.id, clientId });
  }

  /** Viewers on this instance and, with a bus, on the others. */
  viewers(projectId: string): Viewer[] {
    const local = [...(this.rooms.get(projectId)?.values() ?? [])].map(c => c.viewer);
    const others = this.remote.get(projectId);
    if (!others) return local;
    const cutoff = this.now() - STALE_MS;
    for (const [inst, r] of others) if (r.at < cutoff) others.delete(inst);
    return [...local, ...[...others.values()].flatMap(r => r.viewers)];
  }

  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.bus?.close();
  }

  private broadcast(projectId: string, msg: LiveMessage) {
    this.sendLocal(projectId, msg);
    this.bus?.publish({ kind: 'send', instance: this.instance, projectId, msg });
  }

  private presence(projectId: string) {
    this.sendLocal(projectId, { type: 'presence', viewers: this.viewers(projectId) });
    this.announce(projectId);
  }

  private announce(projectId: string) {
    const viewers = [...(this.rooms.get(projectId)?.values() ?? [])].map(c => c.viewer);
    this.bus?.publish({ kind: 'presence', instance: this.instance, projectId, viewers });
  }

  private receive(m: BusMessage) {
    if (m.instance === this.instance) return;
    if (m.kind === 'send') { this.sendLocal(m.projectId, m.msg); return; }
    let others = this.remote.get(m.projectId);
    if (!others) this.remote.set(m.projectId, (others = new Map()));
    const before = JSON.stringify(others.get(m.instance)?.viewers ?? []);
    if (m.viewers.length) others.set(m.instance, { viewers: m.viewers, at: this.now() });
    else others.delete(m.instance);
    if (!others.size) this.remote.delete(m.projectId);
    // heartbeats repeat the same list: only tell local viewers when it changed
    if (JSON.stringify(m.viewers) !== before) this.sendLocal(m.projectId, { type: 'presence', viewers: this.viewers(m.projectId) });
  }

  private sendLocal(projectId: string, msg: LiveMessage) {
    const room = this.rooms.get(projectId);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const c of room.values()) {
      if (c.socket.readyState === c.socket.OPEN) c.socket.send(data);
    }
  }
}

const CHANNEL = 'wbs_live';

/** The bus over Postgres LISTEN/NOTIFY: no extra service to run. Reconnects if the listening connection drops. */
export class PgBus implements LiveBus {
  private client: pg.Client | null = null;
  private handlers: ((m: BusMessage) => void)[] = [];
  private closed = false;

  constructor(private readonly url: string, private readonly db: { query: (sql: string, args: unknown[]) => Promise<unknown> }) {}

  async start(): Promise<void> {
    const c = new pg.Client({ connectionString: this.url });
    c.on('notification', n => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        const m = JSON.parse(n.payload) as BusMessage;
        for (const h of this.handlers) h(m);
      } catch { /* ignore malformed */ }
    });
    c.on('error', () => this.retry());
    c.on('end', () => this.retry());
    await c.connect();
    await c.query(`listen ${CHANNEL}`);
    this.client = c;
  }

  private retry() {
    if (this.closed || !this.client) return;
    this.client = null;
    setTimeout(() => this.start().catch(() => this.retry()), 2000).unref?.();
  }

  publish(m: BusMessage) {
    this.db.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify(m)]).catch(e => console.error('live bus publish failed', e));
  }

  subscribe(fn: (m: BusMessage) => void) {
    this.handlers.push(fn);
  }

  async close() {
    this.closed = true;
    await this.client?.end().catch(() => {});
  }
}
