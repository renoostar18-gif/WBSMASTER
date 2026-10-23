import {
  type Baseline, type CalendarDefinition, type ComputedProject, type Op, OpError, type Project, type ProjectSettings,
  type WbsItem, WorkCalendar, applyOps, computeProject, diffToOps, toDay, todayDay,
} from '@wbs-master/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, CLIENT_ID, api } from '../api.js';

export type Role = 'admin' | 'editor' | 'commenter' | 'viewer';

export interface ProjectPayload {
  project: {
    id: string; orgId: string; name: string; version: number; calendarId: string | null; locale: string; archived: boolean;
    settings: ProjectSettings;
  };
  role: Role;
  items: WbsItem[];
  baselines: Baseline[];
  calendar: CalendarDefinition;
}

interface OpsResponse { version: number; items: WbsItem[]; scheduled: string[]; ignoredDeps: string[] }

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export interface Viewer { connId: string; userId: string; name: string; selected: string | null }
type LiveMessage =
  | { type: 'presence'; viewers: Viewer[] }
  | { type: 'changed'; version: number; actorId: string; actorName: string; items: string[]; clientId: string | null };

/** Someone else saved a change: who, and which items it touched. */
export interface RemoteChange { actorName: string; items: string[] }

export interface EditResult {
  ok: boolean;
  /** Error code when the edit was refused (shown translated). */
  error?: string;
  scheduled: number;
  ignoredDeps: string[];
}

const UNDO_LIMIT = 80;

/**
 * Project state for the editor. Edits are applied at once in the browser with
 * the same engine as the server (instant feedback), then sent in order. If the
 * server refuses one, the latest saved version is reloaded.
 */
export function useProject(projectId: string, me: string | null, onRemoteChange?: (c: RemoteChange) => void) {
  const [data, setData] = useState<ProjectPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [items, setItems] = useState<WbsItem[]>([]);
  const itemsRef = useRef<WbsItem[]>([]);
  const undoStack = useRef<{ before: WbsItem[]; after: WbsItem[] }[]>([]);
  const redoStack = useRef<{ before: WbsItem[]; after: WbsItem[] }[]>([]);
  const [, bump] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const version = useRef(0);
  const refreshAfterQueue = useRef(false);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const remoteCb = useRef(onRemoteChange);
  remoteCb.current = onRemoteChange;

  const setAll = (next: WbsItem[]) => { itemsRef.current = next; setItems(next); };

  const load = useCallback(async () => {
    try {
      const p = await api.get<ProjectPayload>(`/projects/${projectId}`);
      version.current = p.project.version;
      setData(p);
      setAll(p.items);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.code : 'server_error');
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  /** Fetch someone else's saved change, but never over this tab's edits that are still saving. */
  const refresh = useCallback(async () => {
    try {
      const p = await api.get<ProjectPayload>(`/projects/${projectId}`);
      if (pending.current) { refreshAfterQueue.current = true; return; }
      version.current = p.project.version;
      setData(p);
      setAll(p.items);
    } catch { /* the next change or reconnect will try again */ }
  }, [projectId]);

  const calendar = useMemo(() => (data ? new WorkCalendar(data.calendar) : new WorkCalendar()), [data]);
  const model: Project | null = useMemo(() => data && ({
    id: data.project.id, name: data.project.name, items, baselines: data.baselines, settings: data.project.settings,
  }), [data, items]);
  const computed: ComputedProject | null = useMemo(
    () => (model ? computeProject(model, { calendar, today: todayDay() }) : null), [model, calendar]);

  const send = useCallback((ops: Op[]) => {
    pending.current++;
    setSave('saving');
    queue.current = queue.current.then(async () => {
      try {
        const r = await api.post<OpsResponse>(`/projects/${projectId}/ops`, { ops });
        pending.current--;
        version.current = Math.max(version.current, r.version);
        // the server is authoritative once nothing else is in flight
        if (!pending.current) {
          setAll(r.items);
          setSave('saved');
          if (refreshAfterQueue.current) { refreshAfterQueue.current = false; await refresh(); }
        }
      } catch (e) {
        pending.current--;
        undoStack.current = [];
        redoStack.current = [];
        setSave(e instanceof ApiError && e.code === 'offline' ? 'offline' : 'error');
        await load();
      }
    });
  }, [projectId, load, refresh]);

  // live updates: presence, and fetching the latest version when someone else saves
  useEffect(() => {
    if (import.meta.env.MODE === 'demo' || !data) return;
    let stopped = false, retry = 1000, timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/projects/${projectId}/live`);
      socket.current = ws;
      ws.onopen = () => { retry = 1000; };
      ws.onmessage = ev => {
        const m = JSON.parse(String(ev.data)) as LiveMessage;
        if (m.type === 'presence') { setViewers(m.viewers); return; }
        if (m.clientId === CLIENT_ID || m.version <= version.current) return; // this tab's own save, or already seen
        if (m.actorId !== me) remoteCb.current?.({ actorName: m.actorName, items: m.items });
        if (pending.current) refreshAfterQueue.current = true;
        else refresh();
      };
      ws.onclose = ev => {
        socket.current = null;
        setViewers([]);
        if (stopped || ev.code === 4401 || ev.code === 4404) return;
        timer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 30_000);
      };
    };
    open();
    return () => { stopped = true; clearTimeout(timer); socket.current?.close(); };
    // reconnect only when the project changes, not on every reload of its data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, !!data, me, refresh]);

  /** Share which item this person has selected. */
  const shareSelection = useCallback((itemId: string | null) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'select', itemId }));
  }, []);

  /** Apply edits locally, record undo, send to the server. */
  const run = useCallback((ops: Op[], record: 'push' | 'none' = 'push'): EditResult => {
    if (!model || !ops.length) return { ok: false, scheduled: 0, ignoredDeps: [] };
    const before = itemsRef.current;
    try {
      const statusDate = toDay(model.settings.statusDate) ?? todayDay();
      const r = applyOps({ ...model, items: before }, ops, { statusDate, calendar, maxItems: Infinity });
      // nothing changed (e.g. the same value typed again): no undo step, no request
      if (JSON.stringify(r.project.items) === JSON.stringify(before)) return { ok: true, scheduled: 0, ignoredDeps: r.ignoredDeps };
      setAll(r.project.items);
      if (record === 'push') {
        undoStack.current.push({ before, after: r.project.items });
        if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
        redoStack.current = [];
      }
      bump(x => x + 1);
      send(ops);
      return { ok: true, scheduled: r.scheduled.length, ignoredDeps: r.ignoredDeps };
    } catch (e) {
      return { ok: false, error: e instanceof OpError ? e.code : 'server_error', scheduled: 0, ignoredDeps: [] };
    }
  }, [model, calendar, send]);

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    const ops = diffToOps(itemsRef.current, entry.before);
    redoStack.current.push(entry);
    if (ops.length) run(ops, 'none'); else bump(x => x + 1);
  }, [run]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    const ops = diffToOps(itemsRef.current, entry.after);
    undoStack.current.push(entry);
    if (ops.length) run(ops, 'none'); else bump(x => x + 1);
  }, [run]);

  /** Project settings (admins): saved, then reloaded because a calendar or auto-schedule change can move work. */
  const updateProject = useCallback(async (patch: Record<string, unknown>) => {
    setSave('saving');
    try {
      await api.patch(`/projects/${projectId}`, patch);
      await load();
      setSave('saved');
      return null;
    } catch (e) {
      setSave('error');
      return e instanceof ApiError ? e.code : 'server_error';
    }
  }, [projectId, load]);

  return {
    data, loadError, save, items, model, computed, calendar,
    run, undo, redo, updateProject, reload: load, viewers, shareSelection,
    canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0,
    canEdit: data ? data.role === 'admin' || data.role === 'editor' : false,
    isAdmin: data?.role === 'admin',
  };
}

export type ProjectStore = ReturnType<typeof useProject>;
