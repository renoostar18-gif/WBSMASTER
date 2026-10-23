import { type Op, Tree, type WbsItem } from '@wbs-master/engine';

const newId = () => crypto.randomUUID();

/** Toolbar and keyboard actions, expressed as edit ops (same semantics as the prototype). */
export function addChildOps(parentId: string | null, name: string): { ops: Op[]; id: string } {
  const id = newId();
  return { id, ops: [{ op: 'add', id, parentId, values: { name } }] };
}

export function addSiblingOps(items: WbsItem[], refId: string, name: string): { ops: Op[]; id: string } {
  const ref = items.find(i => i.id === refId)!;
  const id = newId();
  return { id, ops: [{ op: 'add', id, parentId: ref.parentId, afterId: ref.id, values: { name } }] };
}

export function indentOps(items: WbsItem[], id: string): Op[] | null {
  const t = new Tree(items);
  const n = t.byId.get(id);
  if (!n) return null;
  const sib = t.kids(t.parentOf(id));
  const i = sib.indexOf(n);
  if (i < 1) return null;
  const newParent = sib[i - 1]!;
  return [{ op: 'move', id, parentId: newParent.id, index: t.kids(newParent.id).length }];
}

export function outdentOps(items: WbsItem[], id: string): Op[] | null {
  const t = new Tree(items);
  const parentId = t.parentOf(id);
  if (!parentId) return null;
  const grand = t.parentOf(parentId);
  const index = t.kids(grand).findIndex(x => x.id === parentId) + 1;
  return [{ op: 'move', id, parentId: grand, index }];
}

export function moveOps(items: WbsItem[], id: string, dir: -1 | 1): Op[] | null {
  const t = new Tree(items);
  const parentId = t.parentOf(id);
  const sib = t.kids(parentId);
  const i = sib.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sib.length) return null;
  return [{ op: 'move', id, parentId, index: j }];
}

/** Items shown, in order: hidden below `maxLevel` (0 = all) and under collapsed parents. */
export function visibleItems(items: WbsItem[], maxLevel: number, collapsed: Set<string>): WbsItem[] {
  const t = new Tree(items);
  const out: WbsItem[] = [];
  const walk = (pid: string | null, level: number) => {
    if (maxLevel && level > maxLevel) return;
    for (const n of t.kids(pid)) {
      out.push(n);
      if (!collapsed.has(n.id)) walk(n.id, level + 1);
    }
  };
  walk(null, 1);
  return out;
}
