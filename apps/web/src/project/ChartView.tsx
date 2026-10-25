import { type ComputedProject, type Op, Tree, type WbsItem, toIso } from '@wbs-master/engine';
import { type DragEvent, useMemo, useState } from 'react';
import { useI18n } from '../i18n.js';
import { Var, Who } from '../ui.js';

interface Props {
  projectName: string;
  items: WbsItem[];
  computed: ComputedProject;
  canEdit: boolean;
  selected: string | null;
  collapsed: Set<string>;
  maxLevel: number;
  zoom: number;
  showCritical: boolean;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string | null) => void;
  onEdit: (ops: Op[]) => boolean;
  onRename: (id: string) => void;
  othersByItem?: Map<string, string[]>;
}

// box geometry from the prototype: one column per Level 1 item, deeper levels indented beneath
const BW = 216, BH = 76, IND = 24, VG = 10, CG = 26, RW = 320, RH = 64, BUS = 34;

export function ChartView(p: Props) {
  const { t, date, dir } = useI18n();
  const rtl = dir === 'rtl';
  const tree = useMemo(() => new Tree(p.items), [p.items]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const visible = (level: number) => !p.maxLevel || level <= p.maxLevel;

  const layout = useMemo(() => {
    const top = visible(1) ? tree.kids(null) : [];
    let depth = 1;
    const cols: { n: WbsItem; depth: number }[][] = [];
    for (const l1 of top) {
      const col = [{ n: l1, depth: 1 }];
      const walk = (pid: string, d: number) => {
        if (p.collapsed.has(pid) || !visible(d)) return;
        for (const c of tree.kids(pid)) { col.push({ n: c, depth: d }); depth = Math.max(depth, d); walk(c.id, d + 1); }
      };
      walk(l1.id, 2);
      cols.push(col);
    }
    const colW = BW + IND * (depth - 1);
    const width = Math.max(RW, cols.length * colW + Math.max(0, cols.length - 1) * CG);
    const boxes: { n: WbsItem; x: number; y: number }[] = [];
    const paths: string[] = [];
    const sx = (x: number) => (rtl ? width - x : x);
    const y1 = RH + BUS * 2;
    let height = y1 + BH;
    // the bus runs from the project box to every Level 1 column, whichever is further out
    const busFrom = Math.min(width / 2, BW / 2), busTo = Math.max(width / 2, (cols.length - 1) * (colW + CG) + BW / 2);
    if (cols.length) paths.push(`M${sx(width / 2)} ${RH}V${RH + BUS}`, `M${sx(busFrom)} ${RH + BUS}H${sx(busTo)}`);
    cols.forEach((col, ci) => {
      const x0 = ci * (colW + CG);
      let y = y1;
      const pos = new Map<string, { x: number; y: number }>();
      for (const { n, depth: d } of col) {
        const x = x0 + IND * (d - 1);
        pos.set(n.id, { x, y });
        if (d === 1) paths.push(`M${sx(x + BW / 2)} ${RH + BUS}V${y}`);
        else {
          const pp = pos.get(n.parentId!);
          if (pp) paths.push(`M${sx(pp.x + 11)} ${pp.y + BH}V${y + BH / 2}H${sx(x)}`);
        }
        boxes.push({ n, x, y });
        y += BH + VG;
      }
      height = Math.max(height, y);
    });
    return { boxes, paths, width, height: height + 10, empty: !cols.length };
  }, [tree, p.collapsed, p.maxLevel, rtl]);

  const proj = p.computed.project;

  function drop(e: DragEvent, targetId: string | null) {
    e.preventDefault();
    setDropId(null);
    const id = dragId;
    setDragId(null);
    if (!id || id === targetId) return;
    p.onEdit([{ op: 'move', id, parentId: targetId, index: tree.kids(targetId).filter(k => k.id !== id).length }]);
  }
  const dragProps = (targetId: string | null) => (p.canEdit ? {
    onDragOver: (e: DragEvent) => { if (dragId && dragId !== targetId) { e.preventDefault(); setDropId(targetId ?? '__root'); } },
    onDragLeave: () => setDropId(d => (d === (targetId ?? '__root') ? null : d)),
    onDrop: (e: DragEvent) => drop(e, targetId),
  } : {});

  const z = p.zoom, W = layout.width, H = layout.height;
  return (
    <div className="stage" style={{ width: W * z, height: H * z }} onMouseDown={e => { if (e.target === e.currentTarget) p.onSelect(null); }}>
      <div className="stage-in" style={{ width: W, height: H, transform: `scale(${z})` }}>
        <svg className="links" width={W} height={H} aria-hidden><path d={layout.paths.join(' ')} /></svg>
        <div className={`box root${dropId === '__root' ? ' drop' : ''}`} style={{ insetInlineStart: (W - RW) / 2, top: 0, width: RW, height: RH }} {...dragProps(null)}>
          <div className="c">{t('projectWord')} · {proj.progress}%</div>
          <div className="n" dir="auto">{p.projectName}</div>
          <div className="c" style={{ fontWeight: 400 }}>{proj.forecast.finish != null ? `${t('finishOn', { date: date(toIso(proj.forecast.finish)) })} ` : ''}{proj.variance ? <Var v={proj.variance} /> : null}</div>
          {p.canEdit && <button className="add" onClick={() => p.onAddChild(null)} title={t('addLevel1')} aria-label={t('addLevel1')}>+</button>}
        </div>
        {layout.boxes.map(({ n, x, y }) => {
          const i = p.computed.items.get(n.id);
          if (!i) return null;
          const expandable = i.childCount > 0 && (!p.maxLevel || i.level < p.maxLevel);
          const crit = p.showCritical && p.computed.critical.has(n.id);
          return (
            <div key={n.id} data-box={n.id}
              className={`box lv${Math.min(i.level, 6)}${i.level === 1 ? ' l1' : ''}${p.selected === n.id ? ' sel' : ''}${crit ? ' crit' : ''}${dropId === n.id ? ' drop' : ''}`}
              style={{ insetInlineStart: x, top: y, width: BW, height: BH }}
              draggable={p.canEdit}
              onDragStart={e => { setDragId(n.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); }}
              onDragEnd={() => { setDragId(null); setDropId(null); }}
              onMouseDown={() => p.onSelect(n.id)}
              onDoubleClick={() => p.onRename(n.id)}
              {...dragProps(n.id)}>
              <div className="c"><span className={`dot ${i.health}`} /><span dir="ltr">{i.code}</span>{crit && <span className="cp">CP</span>}{n.owner && <span className="muted" style={{ fontWeight: 400 }}>· {n.owner}</span>}<Who names={p.othersByItem?.get(n.id)} /></div>
              <div className="n" dir="auto">{n.name || <i className="muted">{t('unnamed')}</i>}</div>
              <div className="d">
                {i.forecast.start != null ? `${date(toIso(i.forecast.start))} – ${date(toIso(i.forecast.finish))}` : t('health_none')}
                {i.variance ? <Var v={i.variance} /> : null}
                <span>{i.progress}%</span>
              </div>
              {expandable && (
                <button className="tg" onMouseDown={e => e.stopPropagation()} onClick={() => p.onToggle(n.id)} aria-label={p.collapsed.has(n.id) ? '+' : '−'}>
                  {p.collapsed.has(n.id) ? `+${i.childCount}` : '−'}
                </button>
              )}
              {p.canEdit && <button className="add" onMouseDown={e => e.stopPropagation()} onClick={() => p.onAddChild(n.id)} title={t('addChild')} aria-label={t('addChild')}>+</button>}
              {i.progress > 0 && <div className="pb" style={{ width: `${i.progress}%` }} />}
            </div>
          );
        })}
        {layout.empty && <div className="emptycard" style={{ top: RH + 70 }}>{t('noItems')}</div>}
      </div>
    </div>
  );
}
