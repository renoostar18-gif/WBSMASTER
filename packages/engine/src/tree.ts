import type { WbsItem } from './types.js';

/** Parent/child index over a flat item list. Sibling order = array order. */
export class Tree {
  readonly byId: Map<string, WbsItem>;
  private readonly children = new Map<string | null, WbsItem[]>();

  constructor(readonly items: readonly WbsItem[]) {
    this.byId = new Map(items.map(i => [i.id, i]));
    this.children.set(null, []);
    for (const i of items) {
      // an orphan (parent missing) is treated as Level 1, as the prototype does
      const p = i.parentId != null && this.byId.has(i.parentId) ? i.parentId : null;
      let list = this.children.get(p);
      if (!list) this.children.set(p, (list = []));
      list.push(i);
    }
  }

  kids(id: string | null): WbsItem[] {
    return this.children.get(id) ?? [];
  }

  isLeaf(id: string): boolean {
    return this.kids(id).length === 0;
  }

  parentOf(id: string): string | null {
    const p = this.byId.get(id)?.parentId ?? null;
    return p != null && this.byId.has(p) ? p : null;
  }

  descendants(id: string): string[] {
    const out: string[] = [];
    const stack = [...this.kids(id)];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n.id);
      stack.push(...this.kids(n.id));
    }
    return out;
  }

  ancestors(id: string): string[] {
    const out: string[] = [];
    let p = this.parentOf(id);
    while (p != null && !out.includes(p)) {
      out.push(p);
      p = this.parentOf(p);
    }
    return out;
  }

  /** True when a and b are the same item, or one is an ancestor of the other. */
  related(a: string, b: string): boolean {
    return a === b || this.ancestors(a).includes(b) || this.ancestors(b).includes(a);
  }

  /** The leaves an item stands for: itself if it is a leaf, otherwise all leaf descendants. */
  leavesOf(id: string): string[] {
    if (!this.byId.has(id)) return [];
    return this.isLeaf(id) ? [id] : this.descendants(id).filter(d => this.isLeaf(d));
  }

  leaves(): WbsItem[] {
    return this.items.filter(i => this.isLeaf(i.id));
  }

  /** WBS codes by id: "1", "1.2", "1.2.3" from sibling positions. */
  codes(): Map<string, { code: string; level: number }> {
    const out = new Map<string, { code: string; level: number }>();
    const walk = (pid: string | null, prefix: string, level: number) => {
      this.kids(pid).forEach((n, i) => {
        const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
        out.set(n.id, { code, level });
        walk(n.id, code, level + 1);
      });
    };
    walk(null, '', 1);
    return out;
  }
}
