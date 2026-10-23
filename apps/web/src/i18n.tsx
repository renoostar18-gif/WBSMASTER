import { type HealthReason, toIso } from '@wbs-master/engine';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en' | 'ar';

const en = {
  app: 'WBS Master',
  signIn: 'Sign in', signUp: 'Create account', signOut: 'Sign out',
  email: 'Email', password: 'Password', yourName: 'Your name', organisation: 'Organisation name (optional)',
  noAccount: 'New to WBS Master?', haveAccount: 'Already have an account?',
  passwordHint: 'At least 10 characters.',
  projects: 'Projects', newProject: 'New project', projectName: 'Project name', create: 'Create', cancel: 'Cancel', save: 'Save', close: 'Close',
  noProjects: 'No projects yet. Create your first one above.',
  items: 'items', updated: 'Updated', open: 'Open', plan: 'Plan',
  plan_free: 'Free', plan_team: 'Team', plan_business: 'Business',
  language: 'العربية', theme: 'Theme', theme_auto: 'Auto', theme_light: 'Light', theme_dark: 'Night',
  view: 'View', view_table: 'Table', view_chart: 'Chart', view_gantt: 'Gantt', comingSoon: 'Coming in the next update',
  showLevels: 'Show levels', all: 'All',
  addChild: 'Child', addSibling: 'Sibling', addLevel1: 'Add Level 1 item', indent: 'Indent', outdent: 'Outdent',
  moveUp: 'Move up', moveDown: 'Move down', delete: 'Delete', deleteMany: 'Delete {n} items?', undo: 'Undo', redo: 'Redo',
  settings: 'Project settings', statusDate: 'Status date', statusDateHint: 'Empty = today',
  redThreshold: 'Delayed if late by (working days)', autoSchedule: 'Move linked items automatically',
  saving: 'Saving…', saved: 'Saved', notSaved: 'Not saved — reloaded the latest version', offline: 'Offline — changes not saved',
  wbs: 'WBS', name: 'Item name', owner: 'Owner', status: 'Status', health: 'Health', planPct: 'Plan %',
  planned: 'Planned', forecast: 'Forecast', actual: 'Actual', start: 'Start', finish: 'Finish',
  daysShort: 'd', variance: 'Var', varianceLong: 'Finish variance (working days)', dependsOn: 'Depends on', progress: 'Progress', notes: 'Notes',
  dependsHint: 'WBS codes, e.g. 2.1 or 3.2+5 (5-day lag)',
  rolledUp: 'Rolled up from sub-items',
  status_auto: 'Auto', status_not_started: 'Not started', status_in_progress: 'In progress', status_on_hold: 'On hold',
  status_completed: 'Completed', status_cancelled: 'Cancelled',
  health_green: 'On track', health_amber: 'At risk', health_red: 'Delayed', health_done: 'Completed', health_none: 'No dates',
  newItem: 'New item', unnamed: 'Unnamed',
  summaryLine: '{items} items · {levels} levels · {done}% done', vsPlan: 'vs {pp}% plan', finishOn: 'finish {date}',
  delayedN: '{n} delayed', atRiskN: '{n} at risk',
  noItems: 'No items yet. Add a Level 1 item to start your WBS.',
  selectItem: 'Select an item to see its details.',
  links: 'Links', addLink: 'Wait for (WBS code)', lag: 'Lag (days)', remove: 'Remove', critical: 'Critical path',
  milestone: 'Milestone', code: 'Code', level: 'Level',
  scheduledN: '{n} linked items moved to follow their predecessors.',
  ignoredDeps: 'Ignored: {list}. Use WBS codes like 2.1 or 2.1+3.',
  keyboardHint: 'Tab adds a child, Enter a sibling, Alt+Shift+←/→ indents, Alt+↑/↓ moves, Del deletes.',
  // health reasons
  r_cancelled: 'Cancelled', r_finished_on_plan: 'Finished on plan', r_finished_late: 'Finished {days} working days after plan',
  r_no_dates: 'No dates yet', r_overdue: 'Overdue — forecast finish {date} has passed',
  r_slip: 'Forecast finish {days} working days later than plan', r_late_start: 'Should have started {date}', r_on_hold: 'On hold',
  r_behind_plan: 'Progress {progress}% vs {planned}% planned', r_children_need_attention: 'Some sub-items need attention', r_on_plan: 'On plan',
  // errors
  e_invalid_credentials: 'Wrong email or password.', e_email_taken: 'An account with this email already exists.',
  e_password_too_short: 'Password must be at least 10 characters.', e_invalid_request: 'Please check the fields and try again.',
  e_plan_project_limit: 'Your plan allows 3 active projects. Upgrade to Team for unlimited projects.',
  e_plan_item_limit: 'Your plan’s item limit for one project has been reached.',
  e_link_cycle: 'That link would create a loop, so it wasn’t added.', e_link_same_family: 'An item can’t depend on itself, its parent or its sub-items.',
  e_link_duplicate: 'That link already exists.', e_parent_rolled_up: 'Parent dates and progress are rolled up from sub-items.',
  e_move_into_self: 'An item can’t move under its own sub-item.', e_forbidden: 'You don’t have permission to do that.',
  e_offline: 'You appear to be offline.', e_server_error: 'Something went wrong. Please try again.',
  e_not_signed_in: 'Please sign in.', e_project_not_found: 'Project not found.', e_generic: 'Couldn’t complete that. ({code})',
};

const ar: typeof en = {
  app: 'WBS Master',
  signIn: 'تسجيل الدخول', signUp: 'إنشاء حساب', signOut: 'تسجيل الخروج',
  email: 'البريد الإلكتروني', password: 'كلمة المرور', yourName: 'اسمك', organisation: 'اسم المنشأة (اختياري)',
  noAccount: 'جديد على WBS Master؟', haveAccount: 'لديك حساب؟',
  passwordHint: '10 أحرف على الأقل.',
  projects: 'المشاريع', newProject: 'مشروع جديد', projectName: 'اسم المشروع', create: 'إنشاء', cancel: 'إلغاء', save: 'حفظ', close: 'إغلاق',
  noProjects: 'لا توجد مشاريع بعد. أنشئ أول مشروع من الأعلى.',
  items: 'بنود', updated: 'آخر تحديث', open: 'فتح', plan: 'الباقة',
  plan_free: 'مجانية', plan_team: 'الفريق', plan_business: 'الأعمال',
  language: 'English', theme: 'المظهر', theme_auto: 'تلقائي', theme_light: 'فاتح', theme_dark: 'داكن',
  view: 'العرض', view_table: 'جدول', view_chart: 'مخطط', view_gantt: 'جانت', comingSoon: 'قريبًا في التحديث القادم',
  showLevels: 'المستويات', all: 'الكل',
  addChild: 'بند فرعي', addSibling: 'بند مجاور', addLevel1: 'إضافة بند في المستوى 1', indent: 'إزاحة للداخل', outdent: 'إزاحة للخارج',
  moveUp: 'نقل لأعلى', moveDown: 'نقل لأسفل', delete: 'حذف', deleteMany: 'حذف {n} بنود؟', undo: 'تراجع', redo: 'إعادة',
  settings: 'إعدادات المشروع', statusDate: 'تاريخ الحالة', statusDateHint: 'فارغ = اليوم',
  redThreshold: 'متأخر إذا تجاوز (أيام عمل)', autoSchedule: 'تحريك البنود المرتبطة تلقائيًا',
  saving: 'جارٍ الحفظ…', saved: 'تم الحفظ', notSaved: 'لم يُحفظ — تم تحميل أحدث نسخة', offline: 'غير متصل — لم تُحفظ التغييرات',
  wbs: 'الرمز', name: 'اسم البند', owner: 'المسؤول', status: 'الحالة', health: 'الوضع', planPct: '٪ المخطط',
  planned: 'المخطط', forecast: 'المتوقع', actual: 'الفعلي', start: 'البداية', finish: 'النهاية',
  daysShort: 'ي', variance: 'الانحراف', varianceLong: 'انحراف النهاية (أيام عمل)', dependsOn: 'يعتمد على', progress: 'الإنجاز', notes: 'ملاحظات',
  dependsHint: 'رموز البنود، مثل 2.1 أو 3.2+5 (تأخير 5 أيام)',
  rolledUp: 'محسوب من البنود الفرعية',
  status_auto: 'تلقائي', status_not_started: 'لم يبدأ', status_in_progress: 'قيد التنفيذ', status_on_hold: 'معلّق',
  status_completed: 'مكتمل', status_cancelled: 'ملغى',
  health_green: 'في المسار', health_amber: 'معرّض للخطر', health_red: 'متأخر', health_done: 'مكتمل', health_none: 'بلا تواريخ',
  newItem: 'بند جديد', unnamed: 'بدون اسم',
  summaryLine: '{items} بند · {levels} مستويات · منجز {done}٪', vsPlan: 'مقابل {pp}٪ مخطط', finishOn: 'النهاية {date}',
  delayedN: '{n} متأخر', atRiskN: '{n} معرّض للخطر',
  noItems: 'لا توجد بنود بعد. أضف بندًا في المستوى 1 لبدء هيكل العمل.',
  selectItem: 'اختر بندًا لعرض تفاصيله.',
  links: 'الارتباطات', addLink: 'ينتظر (رمز البند)', lag: 'التأخير (أيام)', remove: 'إزالة', critical: 'المسار الحرج',
  milestone: 'معلم رئيسي', code: 'الرمز', level: 'المستوى',
  scheduledN: 'تم تحريك {n} من البنود المرتبطة لتتبع البنود السابقة لها.',
  ignoredDeps: 'تم تجاهل: {list}. استخدم رموزًا مثل 2.1 أو 2.1+3.',
  keyboardHint: 'Tab لإضافة بند فرعي، Enter لبند مجاور، Alt+Shift+←/→ للإزاحة، Alt+↑/↓ للنقل، Del للحذف.',
  r_cancelled: 'ملغى', r_finished_on_plan: 'اكتمل حسب الخطة', r_finished_late: 'اكتمل بعد الخطة بـ {days} أيام عمل',
  r_no_dates: 'لا توجد تواريخ بعد', r_overdue: 'متجاوز — مضى تاريخ النهاية المتوقع {date}',
  r_slip: 'النهاية المتوقعة متأخرة {days} أيام عمل عن الخطة', r_late_start: 'كان يجب أن يبدأ في {date}', r_on_hold: 'معلّق',
  r_behind_plan: 'الإنجاز {progress}٪ مقابل {planned}٪ مخطط', r_children_need_attention: 'بعض البنود الفرعية تحتاج متابعة', r_on_plan: 'حسب الخطة',
  e_invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', e_email_taken: 'يوجد حساب بهذا البريد الإلكتروني.',
  e_password_too_short: 'يجب ألا تقل كلمة المرور عن 10 أحرف.', e_invalid_request: 'يرجى مراجعة الحقول والمحاولة مرة أخرى.',
  e_plan_project_limit: 'تسمح باقتك بـ 3 مشاريع نشطة. رقِّ إلى باقة الفريق لمشاريع غير محدودة.',
  e_plan_item_limit: 'وصلت إلى حد البنود في المشروع الواحد لباقتك.',
  e_link_cycle: 'هذا الارتباط سيُنشئ حلقة، لذلك لم تتم إضافته.', e_link_same_family: 'لا يمكن أن يعتمد البند على نفسه أو على البند الأب أو بنوده الفرعية.',
  e_link_duplicate: 'هذا الارتباط موجود بالفعل.', e_parent_rolled_up: 'تواريخ البند الأب وإنجازه محسوبة من البنود الفرعية.',
  e_move_into_self: 'لا يمكن نقل البند تحت أحد بنوده الفرعية.', e_forbidden: 'ليست لديك صلاحية للقيام بذلك.',
  e_offline: 'يبدو أنك غير متصل.', e_server_error: 'حدث خطأ. يرجى المحاولة مرة أخرى.',
  e_not_signed_in: 'يرجى تسجيل الدخول.', e_project_not_found: 'المشروع غير موجود.', e_generic: 'تعذّر إكمال العملية. ({code})',
};

export type MessageKey = keyof typeof en;
const DICTS: Record<Locale, typeof en> = { en, ar };

export interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLocale: (l: Locale) => void;
  /** Short date, Gregorian with Western digits in both languages (spec 7.3). */
  date: (iso: string | null | undefined) => string;
  num: (n: number) => string;
  error: (code: string) => string;
  reason: (r: HealthReason | (Omit<HealthReason, 'date'> & { date?: string | number | null })) => string;
}

const Ctx = createContext<I18n | null>(null);
const STORE_KEY = 'wbs.locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try { const v = localStorage.getItem(STORE_KEY); if (v === 'ar' || v === 'en') return v; } catch { /* storage blocked */ }
    return navigator.language?.startsWith('ar') ? 'ar' : 'en';
  });
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORE_KEY, l); } catch { /* storage blocked */ }
  }, []);
  const value = useMemo<I18n>(() => {
    const dict = DICTS[locale];
    const tag = locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB';
    const df = new Intl.DateTimeFormat(tag, { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
    const nf = new Intl.NumberFormat(tag);
    const t: I18n['t'] = (key, vars) => {
      let s: string = dict[key] ?? en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    const date: I18n['date'] = iso => (iso ? df.format(new Date(`${iso}T00:00:00Z`)) : '—');
    return {
      locale, dir, t, setLocale, date, num: n => nf.format(n),
      error: code => (`e_${code}` in dict ? t(`e_${code}` as MessageKey) : t('e_generic', { code })),
      reason: r => {
        const d = 'date' in r ? (typeof r.date === 'number' ? toIso(r.date) : r.date) : null;
        return t(`r_${r.code}` as MessageKey, { ...(r as Record<string, string | number>), date: date(d) });
      },
    };
  }, [locale, dir, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
