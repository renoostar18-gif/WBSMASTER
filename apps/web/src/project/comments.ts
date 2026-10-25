import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api.js';

export interface Comment {
  id: string;
  itemId: string | null;
  parentId: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  authorId: string | null;
  authorName: string | null;
}

export interface Person { id: string; name: string; email: string }

/** A thread: its first comment and the replies, oldest first. Resolving applies to the thread. */
export interface Thread { root: Comment; replies: Comment[] }

/** Threads newest first, so recent discussion is on top. */
export function toThreads(comments: Comment[]): Thread[] {
  const byRoot = new Map<string, Thread>();
  for (const c of comments) if (!c.parentId) byRoot.set(c.id, { root: c, replies: [] });
  for (const c of comments) if (c.parentId) byRoot.get(c.parentId)?.replies.push(c);
  const last = (t: Thread) => (t.replies.at(-1) ?? t.root).createdAt;
  return [...byRoot.values()].sort((a, b) => last(b).localeCompare(last(a)));
}

/**
 * Names in the text that match people who can see the project, as their ids.
 * The longest names are matched first, so "@Sara Ahmed" is not read as "@Sara".
 */
export function mentionedIn(body: string, people: Person[]): string[] {
  const out: string[] = [];
  let rest = body;
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${p.name}`;
    if (rest.includes(tag)) { out.push(p.id); rest = rest.replaceAll(tag, ''); }
  }
  return out;
}

/** Comments of one project (spec 7.1). `tick` changes when someone else changed them, to reload. */
export function useComments(projectId: string, tick: number) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  const load = useCallback(async () => {
    try {
      setComments((await api.get<{ comments: Comment[] }>(`/projects/${projectId}/comments`)).comments);
    } catch { setComments(c => c ?? []); }
  }, [projectId]);
  useEffect(() => { load(); }, [load, tick]);
  /** Who can be mentioned; people can be added to the project at any time, so this reloads when the panel opens. */
  const loadPeople = useCallback(() => {
    api.get<{ people: Person[] }>(`/projects/${projectId}/people`).then(r => setPeople(r.people), () => { /* keep the last list */ });
  }, [projectId]);

  /** Run a change, then reload; returns an error code or null. */
  const act = useCallback(async (call: () => Promise<unknown>) => {
    try {
      await call();
      await load();
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.code : 'server_error';
    }
  }, [load]);

  const base = `/projects/${projectId}/comments`;
  const actions = useMemo(() => ({
    add: (body: string, where: { itemId?: string | null; parentId?: string | null }) =>
      act(() => api.post(base, { body, itemId: where.itemId ?? null, parentId: where.parentId ?? null, mentions: mentionedIn(body, people) })),
    edit: (id: string, body: string) => act(() => api.patch(`${base}/${id}`, { body })),
    resolve: (id: string, resolved: boolean) => act(() => api.post(`${base}/${id}/resolve`, { resolved })),
    remove: (id: string) => act(() => api.del(`${base}/${id}`)),
  }), [act, base, people]);

  const threads = useMemo(() => toThreads(comments ?? []), [comments]);
  /** Open threads per item ('' = the project itself). */
  const openByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) if (!t.root.resolvedAt) m.set(t.root.itemId ?? '', (m.get(t.root.itemId ?? '') ?? 0) + 1);
    return m;
  }, [threads]);

  /** The panel opened: fetch the latest comments and people. */
  const refresh = useCallback(() => { load(); loadPeople(); }, [load, loadPeople]);

  return { loaded: comments != null, threads, people, openByItem, open: threads.filter(t => !t.root.resolvedAt).length, refresh, ...actions };
}

export type CommentsStore = ReturnType<typeof useComments>;
