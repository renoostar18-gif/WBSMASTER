import type { WebSocket } from 'ws';

/**
 * Live updates per project: who is viewing, what each person has selected,
 * and a "changed" message after every save so open pages fetch the new version.
 * One process holds the connections; with several API instances this becomes
 * Redis pub/sub (spec 8.2).
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

interface Conn { socket: WebSocket; viewer: Viewer }

export class LiveHub {
  private rooms = new Map<string, Map<string, Conn>>();
  private seq = 0;

  join(projectId: string, socket: WebSocket, user: { id: string; name: string }): string {
    const connId = `c${++this.seq}`;
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
    else this.presence(projectId);
  }

  select(projectId: string, connId: string, itemId: string | null) {
    const c = this.rooms.get(projectId)?.get(connId);
    if (!c || c.viewer.selected === itemId) return;
    c.viewer.selected = itemId;
    this.presence(projectId);
  }

  /** Tell everyone viewing the project that a new version was saved. */
  changed(projectId: string, version: number, actor: { id: string; name: string }, items: string[] = [], clientId: string | null = null) {
    this.send(projectId, { type: 'changed', version, actorId: actor.id, actorName: actor.name, items, clientId });
  }

  /** Tell everyone viewing the project that its comments changed. */
  comments(projectId: string, actor: { id: string }, clientId: string | null = null) {
    this.send(projectId, { type: 'comments', actorId: actor.id, clientId });
  }

  viewers(projectId: string): Viewer[] {
    return [...(this.rooms.get(projectId)?.values() ?? [])].map(c => c.viewer);
  }

  private presence(projectId: string) {
    this.send(projectId, { type: 'presence', viewers: this.viewers(projectId) });
  }

  private send(projectId: string, msg: LiveMessage) {
    const data = JSON.stringify(msg);
    for (const c of this.rooms.get(projectId)?.values() ?? []) {
      if (c.socket.readyState === c.socket.OPEN) c.socket.send(data);
    }
  }
}
