import { Tree } from './tree.js';
import type { Dependency, WbsItem } from './types.js';

export interface LeafEdge {
  pred: string;
  lag: number;
}

/**
 * Links expanded to leaf level: a link on a parent applies to every leaf under
 * it. Map key = successor leaf id.
 */
export function leafEdges(tree: Tree): Map<string, LeafEdge[]> {
  const m = new Map<string, LeafEdge[]>();
  for (const n of tree.items) {
    for (const d of n.deps) {
      const preds = tree.leavesOf(d.id), succs = tree.leavesOf(n.id);
      for (const s of succs) for (const p of preds) {
        if (p === s) continue;
        let list = m.get(s);
        if (!list) m.set(s, (list = []));
        list.push({ pred: p, lag: d.lag || 0 });
      }
    }
  }
  return m;
}

/** Kahn topological order over leaf edges; `cycle` is true when some nodes could not be ordered. */
export function topoOrder(edges: Map<string, LeafEdge[]>): { order: string[]; cycle: boolean } {
  const nodes = new Set<string>(), indeg = new Map<string, number>(), out = new Map<string, string[]>();
  for (const [s, ps] of edges) {
    nodes.add(s);
    for (const { pred } of ps) {
      nodes.add(pred);
      let o = out.get(pred);
      if (!o) out.set(pred, (o = []));
      o.push(s);
      indeg.set(s, (indeg.get(s) ?? 0) + 1);
    }
  }
  const queue = [...nodes].filter(x => !indeg.get(x));
  const order: string[] = [];
  for (let k = 0; k < queue.length; k++) {
    const x = queue[k]!;
    order.push(x);
    for (const y of out.get(x) ?? []) {
      const v = indeg.get(y)! - 1;
      indeg.set(y, v);
      if (!v) queue.push(y);
    }
  }
  return { order, cycle: order.length < nodes.size };
}

export type LinkError = 'not_found' | 'same_family' | 'duplicate' | 'cycle';

/** Check whether `succ` may wait for `pred` (spec 4.6). Returns null when the link is allowed. */
export function validateLink(tree: Tree, succ: string, pred: string): LinkError | null {
  const s = tree.byId.get(succ);
  if (!s || !tree.byId.has(pred)) return 'not_found';
  if (tree.related(succ, pred)) return 'same_family';
  if (s.deps.some(d => d.id === pred)) return 'duplicate';
  return wouldCycle(tree, succ, [...s.deps, { id: pred, lag: 0 }]) ? 'cycle' : null;
}

/** True when giving `succ` this dependency list would create a loop. */
export function wouldCycle(tree: Tree, succ: string, deps: Dependency[]): boolean {
  const items: WbsItem[] = tree.items.map(i => (i.id === succ ? { ...i, deps } : i));
  return topoOrder(leafEdges(new Tree(items))).cycle;
}

const DEP_TOKEN = /^(\d+(?:\.\d+)*)(?:\s*([+-])\s*(\d+)\s*d?)?$/i;

/**
 * Parse "2.1, 3.2+5, 4-2d" into dependencies using WBS codes. Tokens that are
 * unknown, or point at the item itself or its own family, are returned in `invalid`.
 */
export function parseDepsText(
  text: string,
  succId: string,
  idByCode: Map<string, string>,
  tree: Tree,
): { deps: Dependency[]; invalid: string[] } {
  const deps: Dependency[] = [], invalid: string[] = [];
  for (const part of String(text).split(/[,;\s]+/).filter(Boolean)) {
    const m = DEP_TOKEN.exec(part);
    const pid = m ? idByCode.get(m[1]!) : undefined;
    if (!m || !pid || tree.related(succId, pid)) { invalid.push(part); continue; }
    const lag = m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
    if (!deps.some(d => d.id === pid)) deps.push({ id: pid, lag });
  }
  return { deps, invalid };
}

/** Dependencies as text: "2.1, 3.2+5". */
export function formatDeps(deps: Dependency[], codeById: Map<string, string>): string {
  return deps
    .map(d => {
      const c = codeById.get(d.id);
      return c ? c + (d.lag ? (d.lag > 0 ? '+' : '') + d.lag : '') : '';
    })
    .filter(Boolean)
    .join(', ');
}
