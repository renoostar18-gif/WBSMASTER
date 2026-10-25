import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { type I18n, useI18n } from './i18n.js';
import { useSession } from './session.js';

type Kind = 'mention' | 'reply' | 'assigned' | 'turned_red' | 'baseline';
export interface Notification {
  id: string; kind: Kind; projectId: string; itemId: string | null; commentId: string | null; createdAt: string; readAt: string | null;
  data: { actorName?: string; projectName: string; itemName?: string; excerpt?: string; baselineName?: string; daysLate?: number | null };
}

/** How often the unread count is checked while the page is open. */
const POLL_MS = 60_000;

export function notificationText(n: Notification, t: I18n['t']) {
  const d = n.data;
  const vars = { actor: d.actorName ?? t('someone'), project: d.projectName, item: d.itemName ?? t('theProject'), name: d.baselineName ?? '' };
  if (n.kind === 'turned_red') return d.daysLate ? t('n_turned_red', { ...vars, n: d.daysLate }) : t('n_turned_red_overdue', vars);
  return t(`n_${n.kind}`, vars);
}

/** Where a notification leads: the project, on the item, with its comments for mentions and replies. */
export function notificationLink(n: Notification) {
  const q = new URLSearchParams();
  if (n.itemId) q.set('item', n.itemId);
  if (n.kind === 'mention' || n.kind === 'reply') q.set('panel', 'comments');
  const s = q.toString();
  return `/p/${n.projectId}${s ? `?${s}` : ''}`;
}

/** The bell (spec 7.1): unread count, recent notifications, and the email setting. */
export function Bell() {
  const { t, locale } = useI18n();
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Notification[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const count = useCallback(() => {
    api.get<{ unread: number }>('/notifications/unread').then(r => setUnread(r.unread), () => { /* try again later */ });
  }, []);
  useEffect(() => {
    count();
    const timer = setInterval(count, POLL_MS);
    window.addEventListener('focus', count);
    return () => { clearInterval(timer); window.removeEventListener('focus', count); };
  }, [count]);
  useEffect(count, [location.pathname, count]);

  const load = useCallback(async () => {
    const r = await api.get<{ notifications: Notification[]; unread: number }>('/notifications');
    setList(r.notifications);
    setUnread(r.unread);
  }, []);
  useEffect(() => { if (open) load().catch(() => setList([])); }, [open, load]);
  // close when clicking elsewhere or pressing Escape
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const when = useMemo(() => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }), [locale]);

  const go = async (n: Notification) => {
    setOpen(false);
    if (!n.readAt) {
      setUnread(u => Math.max(0, u - 1));
      api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
    }
    nav(notificationLink(n));
  };
  const readAll = async () => {
    await api.post('/notifications/read', {});
    setUnread(0);
    setList(l => l?.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
  };

  if (!me) return null;
  return (
    <div className="bell" ref={box}>
      <button className="btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}
        title={t('notifications')} aria-label={unread ? t('notificationsN', { n: unread }) : t('notifications')}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8zM6.5 13.5a1.6 1.6 0 0 0 3 0" />
        </svg>
        {unread > 0 && <span className="count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="dialog" aria-label={t('notifications')}>
          <div className="dhead"><h3>{t('notifications')}</h3>
            <button className="btn sm" disabled={!unread} onClick={readAll}>{t('markAllRead')}</button></div>
          {list && !list.length && <p className="hint">{t('noNotifications')}</p>}
          <ul className="nlist">
            {list?.map(n => (
              <li key={n.id} className={n.readAt ? '' : 'unread'}>
                <button onClick={() => go(n)}>
                  <span dir="auto">{notificationText(n, t)}</span>
                  {n.data.excerpt && <span className="hint" dir="auto">“{n.data.excerpt}”</span>}
                  <time className="hint">{when.format(new Date(n.createdAt))}</time>
                </button>
              </li>
            ))}
          </ul>
          <label className="fld"><span>{t('emailMe')}</span>
            <select value={me.user.notifyEmail} onChange={async e => { await api.patch('/me', { notifyEmail: e.target.value }); await refresh(); }}>
              <option value="instant">{t('email_instant')}</option>
              <option value="daily">{t('email_daily')}</option>
              <option value="off">{t('email_off')}</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
