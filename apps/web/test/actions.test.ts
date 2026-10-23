import { type Op, type Project, Tree, WorkCalendar, applyOps, blankItem, DEFAULT_SETTINGS } from '@wbs-master/engine';
import { describe, expect, it } from 'vitest';
import { addChildOps, addSiblingOps, indentOps, moveOps, outdentOps, visibleItems } from '../src/project/actions.js';

const it_ = (id: string, parentId: string | null = null) => blankItem(parentId, { id, name: id });
const project = (items = [it_('a'), it_('b'), it_('b1', 'b'), it_('b2', 'b'), it_('c')]): Project =>
  ({ id: 'p', name: 'p', items, baselines: [], settings: { ...DEFAULT_SETTINGS, autoSchedule: false } });
const apply = (p: Project, ops: Op[] | null) => applyOps(p, ops!, { statusDate: 0, calendar: new WorkCalendar(), maxItems: Infinity }).project;
const codes = (p: Project) => Object.fromEntries([...new Tree(p.items).codes()].map(([id, c]) => [id, c.code]));

describe('toolbar actions', () => {
  it('indents under the item above, at the end of its children', () => {
    const p = apply(project(), indentOps(project().items, 'c'));
    expect(codes(p)).toMatchObject({ b1: '2.1', b2: '2.2', c: '2.3' });
  });
  it('cannot indent the first item of a level', () => {
    expect(indentOps(project().items, 'a')).toBeNull();
    expect(indentOps(project().items, 'b1')).toBeNull();
  });
  it('outdents to just after the former parent', () => {
    const p = apply(project(), outdentOps(project().items, 'b1'));
    expect(codes(p)).toMatchObject({ a: '1', b: '2', b2: '2.1', b1: '3', c: '4' });
    expect(outdentOps(project().items, 'a')).toBeNull();
  });
  it('moves up and down among siblings only', () => {
    expect(codes(apply(project(), moveOps(project().items, 'c', -1)))).toMatchObject({ c: '2', b: '3' });
    expect(codes(apply(project(), moveOps(project().items, 'b1', 1)))).toMatchObject({ b2: '2.1', b1: '2.2' });
    expect(moveOps(project().items, 'b2', 1)).toBeNull();
  });
  it('adds a child at the end and a sibling right after', () => {
    const c = addChildOps('b', 'New');
    expect(codes(apply(project(), c.ops))[c.id]).toBe('2.3');
    const s = addSiblingOps(project().items, 'a', 'New');
    expect(codes(apply(project(), s.ops))[s.id]).toBe('2');
  });
  it('lists visible rows by level filter and collapsed parents', () => {
    const items = project().items;
    expect(visibleItems(items, 0, new Set()).map(i => i.id)).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    expect(visibleItems(items, 1, new Set()).map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(visibleItems(items, 0, new Set(['b'])).map(i => i.id)).toEqual(['a', 'b', 'c']);
  });
});
