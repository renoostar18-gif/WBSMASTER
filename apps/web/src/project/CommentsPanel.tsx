import type { WbsItem } from '@wbs-master/engine';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n.js';
import { useToast } from '../ui.js';
import type { Comment, CommentsStore, Person, Thread } from './comments.js';

/** Text with @mentions of known people highlighted. */
function Body({ text, people }: { text: string; people: Person[] }) {
  const names = useMemo(() => people.map(p => p.name).sort((a, b) => b.length - a.length), [people]);
  const parts: ReactNode[] = [];
  let rest = text, k = 0;
  while (rest) {
    let at = -1, name = '';
    for (const n of names) {
      const i = rest.indexOf(`@${n}`);
      if (i >= 0 && (at < 0 || i < at)) { at = i; name = n; }
    }
    if (at < 0) { parts.push(rest); break; }
    parts.push(rest.slice(0, at), <b key={k++} className="mention">@{name}</b>);
    rest = rest.slice(at + name.length + 1);
  }
  return <p className="cbody" dir="auto">{parts}</p>;
}

/** A text box that suggests people after "@". Ctrl+Enter sends. */
export function Composer({ people, placeholder, initial = '', submitLabel, autoFocus, onSubmit, onCancel }: {
  people: Person[]; placeholder: string; initial?: string; submitLabel: string; autoFocus?: boolean;
  onSubmit: (body: string) => Promise<string | null>; onCancel?: () => void;
}) {
  const { t, error } = useI18n();
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (query == null) return [];
    const q = query.toLowerCase();
    return people.filter(p => p.name.toLowerCase().includes(q) || p.email.toLowerCase().startsWith(q)).slice(0, 6);
  }, [query, people]);

  const track = (value: string, caret: number) => {
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setQuery(m ? m[1]! : null);
    setPick(0);
  };
  const choose = (p: Person) => {
    const el = box.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const code = await onSubmit(body);
    setBusy(false);
    if (code) setErr(error(code));
    else { setText(''); setErr(''); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setPick(k => (k + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    } else if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      choose(matches[pick]!);
    } else if (e.key === 'Escape') {
      if (query != null) { e.stopPropagation(); setQuery(null); } else onCancel?.();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      <div className="cbox">
        <textarea ref={box} value={text} placeholder={placeholder} rows={2} dir="auto" autoFocus={autoFocus} maxLength={5000}
          aria-label={placeholder} onKeyDown={onKey}
          onChange={e => { setText(e.target.value); track(e.target.value, e.target.selectionStart); }}
          onBlur={() => setTimeout(() => setQuery(null), 150)} />
        {matches.length > 0 && (
          <ul className="mentions" role="listbox" aria-label={t('mentionSomeone')}>
            {matches.map((p, k) => (
              <li key={p.id} role="option" aria-selected={k === pick}>
                <button type="button" onMouseDown={e => { e.preventDefault(); choose(p); }}>
                  <b dir="auto">{p.name}</b> <span className="hint">{p.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {err && <div className="err">{err}</div>}
      <div className="cfoot">
        <span className="hint">{t('mentionHint')}</span>
        {onCancel && <button type="button" className="btn sm" onClick={onCancel}>{t('cancel')}</button>}
        <button type="button" className="btn sm primary" disabled={!text.trim() || busy} onClick={send}>{submitLabel}</button>
      </div>
    </div>
  );
}

/** Comment threads (spec 7.1) for the whole project or the selected item, with an "open only" filter. */
export function CommentsPanel({ store, items, codes, selected, meId, isAdmin, canComment, scope, onScope, onSelectItem, onClose }: {
  store: CommentsStore; items: WbsItem[]; codes: Map<string, string>; selected: string | null; meId: string | null;
  isAdmin: boolean; canComment: boolean; scope: 'all' | 'item'; onScope: (s: 'all' | 'item') => void;
  onSelectItem: (id: string) => void; onClose: () => void;
}) {
  const { t, locale, error } = useI18n();
  const toast = useToast();
  const [openOnly, setOpenOnly] = useState(false);
  const { refresh } = store;
  useEffect(() => { refresh(); }, [refresh]);
  const names = useMemo(() => new Map(items.map(i => [i.id, i.name])), [items]);
  const when = useMemo(() => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const itemId = scope === 'item' ? selected : null;
  const shown = store.threads.filter(th => (!itemId || th.root.itemId === itemId) && (!openOnly || !th.root.resolvedAt));
  const report = (code: string | null) => { if (code) toast(error(code)); return code; };

  const label = (id: string | null) => {
    if (!id) return t('activityAll');
    const name = names.get(id);
    return name == null ? t('aDeletedItem') : `${codes.get(id) ?? ''} ${name}`.trim();
  };
  const target = itemId ? label(itemId) : t('theProject');

  return (
    <aside className="insp comments" aria-label={t('comments')}>
      <div className="dhead"><h3>{t('comments')}</h3><button className="btn sm" onClick={onClose}>{t('close')}</button></div>
      <div className="seg">
        <button aria-pressed={scope === 'all'} onClick={() => onScope('all')}>{t('activityAll')}</button>
        <button aria-pressed={scope === 'item'} disabled={!selected} onClick={() => onScope('item')}>{t('activityThis')}</button>
      </div>
      <label className="chk sm"><input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} /> {t('openOnly')}</label>
      {canComment && (
        <Composer people={store.people} placeholder={t('commentOn', { target })} submitLabel={t('comment')}
          onSubmit={body => store.add(body, { itemId })} />
      )}
      {!canComment && <p className="hint">{t('viewersCannotComment')}</p>}
      {store.loaded && !shown.length && <p className="hint">{openOnly ? t('noOpenComments') : t('noComments')}</p>}
      <ol className="threads">
        {shown.map(th => (
          <ThreadView key={th.root.id} thread={th} label={scope === 'all' ? label(th.root.itemId) : null} store={store} meId={meId}
            isAdmin={isAdmin} canComment={canComment} when={when} report={report}
            onSelectItem={th.root.itemId && names.has(th.root.itemId) ? () => onSelectItem(th.root.itemId!) : undefined} />
        ))}
      </ol>
    </aside>
  );
}

function ThreadView({ thread, label, store, meId, isAdmin, canComment, when, report, onSelectItem }: {
  thread: Thread; label: string | null; store: CommentsStore; meId: string | null; isAdmin: boolean; canComment: boolean;
  when: Intl.DateTimeFormat; report: (code: string | null) => string | null; onSelectItem?: () => void;
}) {
  const { t } = useI18n();
  const [replying, setReplying] = useState(false);
  const resolved = !!thread.root.resolvedAt;
  return (
    <li className={`thread${resolved ? ' resolved' : ''}`}>
      {label && (onSelectItem
        ? <button className="ptag linkish" onClick={onSelectItem} dir="auto">{label}</button>
        : <span className="ptag" dir="auto">{label}</span>)}
      {[thread.root, ...thread.replies].map(c => (
        <CommentView key={c.id} c={c} store={store} people={store.people} when={when} report={report}
          canEdit={c.authorId === meId} canDelete={canComment && (c.authorId === meId || isAdmin)} isRoot={c === thread.root} />
      ))}
      {resolved && <p className="hint">{t('resolvedBy', { name: thread.root.resolvedByName ?? t('someone') })}</p>}
      {canComment && (
        <div className="tactions">
          {!replying && <button className="btn sm" onClick={() => setReplying(true)}>{t('reply')}</button>}
          <button className="btn sm" onClick={async () => report(await store.resolve(thread.root.id, !resolved))}>{resolved ? t('reopen') : t('resolve')}</button>
        </div>
      )}
      {replying && (
        <Composer people={store.people} placeholder={t('replyPh')} submitLabel={t('reply')} autoFocus onCancel={() => setReplying(false)}
          onSubmit={async body => { const code = await store.add(body, { parentId: thread.root.id }); if (!code) setReplying(false); return code; }} />
      )}
    </li>
  );
}

function CommentView({ c, store, people, when, report, canEdit, canDelete, isRoot }: {
  c: Comment; store: CommentsStore; people: Person[]; when: Intl.DateTimeFormat; report: (code: string | null) => string | null;
  canEdit: boolean; canDelete: boolean; isRoot: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  return (
    <div className="cmt">
      <div className="cmeta">
        <b dir="auto">{c.authorName ?? t('someone')}</b>
        <time className="hint">{when.format(new Date(c.createdAt))}{c.editedAt ? ` · ${t('edited')}` : ''}</time>
      </div>
      {editing
        ? <Composer people={people} placeholder={t('comment')} initial={c.body} submitLabel={t('save')} autoFocus onCancel={() => setEditing(false)}
            onSubmit={async body => { const code = await store.edit(c.id, body); if (!code) setEditing(false); return code; }} />
        : <Body text={c.body} people={people} />}
      {!editing && (canEdit || canDelete) && (
        <div className="cacts">
          {canEdit && <button className="linkish" onClick={() => setEditing(true)}>{t('edit')}</button>}
          {canDelete && (
            <button className={`linkish${armed ? ' danger' : ''}`} onClick={async () => {
              if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3500); return; }
              report(await store.remove(c.id));
            }}>{armed ? (isRoot ? t('deleteThread') : t('confirmDelete')) : t('delete')}</button>
          )}
        </div>
      )}
    </div>
  );
}
