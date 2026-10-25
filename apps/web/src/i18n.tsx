import { type HealthReason, toIso } from '@wbs-master/engine';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en' | 'ar';

const en = {
  app: 'WBS Master',
  demo: 'Demo · saved in this browser only', demoNote: 'This demo runs entirely in your browser. Nothing is sent to a server.', demoReset: 'Start over',
  signIn: 'Sign in', signUp: 'Create account', signOut: 'Sign out',
  email: 'Email', password: 'Password', yourName: 'Your name', organisation: 'Organisation name (optional)',
  noAccount: 'New to WBS Master?', haveAccount: 'Already have an account?',
  passwordHint: 'At least 10 characters.',
  projects: 'Projects', newProject: 'New project', projectName: 'Project name', create: 'Create', cancel: 'Cancel', save: 'Save', close: 'Close',
  noProjects: 'No projects yet. Create your first one above.',
  items: 'items', updated: 'Updated', open: 'Open', plan: 'Plan',
  plan_free: 'Free', plan_team: 'Team', plan_business: 'Business',
  language: 'العربية', theme: 'Theme', theme_auto: 'Auto', theme_light: 'Light', theme_dark: 'Night',
  r_slip_one: 'Forecast finish 1 working day later than plan', r_finished_late_one: 'Finished 1 working day after plan', workingDaysN_one: '1 working day',
  n_late_one: '1 working day late', n_early_one: '1 working day early', f_late_one: ' (1 working day late)', scheduledN_one: '1 linked item moved to follow its predecessor.',
  driftLater_one: 'Against the original plan ({date}), today’s forecast finish is 1 working day later.', driftEarlier_one: 'Against the original plan ({date}), today’s forecast finish is 1 working day earlier.',
  critHint_one: '1 linked item drives the finish date of {date}.', deleteMany_one: 'Delete 1 item?',
  importExcel: 'Import Excel', exportExcel: 'Export Excel', newFromExcel: 'New project from Excel',
  exported: 'Workbook downloaded. Edit it in Excel, then use Import Excel to bring the changes back.',
  imTitle: 'Import from Excel', imDrop: 'Drop an Excel or CSV file here, or click to choose one', imReading: 'Reading the file…',
  imDropHint: '.xlsx, .xlsm or .csv. A workbook exported from WBS Master brings your edits back; any other sheet becomes a new WBS.',
  imConnectedUpdate: 'This is the WBS Master workbook for “{name}”. These are the changes compared with the project now:',
  imConnectedCopy: 'This is a WBS Master workbook for “{name}”. It will be imported as a new project.', imItemsN: '{n} items',
  imSheet: 'Sheet', imHeaderRow: 'Header row', imDateOrder: 'Dates are written', imDmy: 'Day first (31/12/2026)', imMdy: 'Month first (12/31/2026)',
  imCode: 'WBS code', imPlannedStart: 'Planned start', imPlannedFinish: 'Planned finish', imForecastStart: 'Forecast start', imForecastFinish: 'Forecast finish',
  imActualStart: 'Actual start', imActualFinish: 'Actual finish', imNone: '— none —',
  imHowManyLevels: 'How should the levels be built?', imModeCode: 'From WBS code / Level', imModeNum: 'From numbering in names', imMode1: '1 level',
  imMode2: '2 levels', imMode3: '3 levels', imSuggested: 'Suggested', imGroup1: 'Level 1 groups come from', imGroup2: 'Level 2 groups come from',
  imGroupOpt: '{name} ({n} groups)',
  imHint_code: 'Levels come from the WBS code or Level column.', imHint_num: 'Levels come from the numbers at the start of each name (1, 1.1, 1.1.1). The numbers are removed from the names.',
  imHint_1: 'Every row becomes a Level 1 item. You can build deeper levels in the app.',
  imHint_2: 'Each value in the chosen column becomes a Level 1 item, with its rows under it. Empty cells take the value above, like merged cells.',
  imHint_3: 'Level 1 and Level 2 come from the two chosen columns. Your rows become Level 3.',
  imAppend: 'Add to this project', imNew: 'Create a new project', imRowsN: '{n} rows', imRowsN_one: '1 row', imGroupsN: '{n} groups', imGroupsN_one: '1 group', imLevelsN: '{n} levels', imLevelsN_one: '1 level',
  imNoRows: 'No rows with a name. Check the header row and the item name column.', imOtherFile: 'Choose another file', imApply: 'Apply changes', imImport: 'Import',
  imNoChanges: 'No changes: the workbook matches the project.', imChangesN: '{changed} changed · {added} added · {removed} removed', imAndMore: '…and {n} more',
  imAdded: 'Added', imRemoved: 'Removed', imPosition: 'position', imUntitled: 'Imported project', imCopy: 'copy',
  xlReadMe: 'Read me', xlReadMe1: 'How this workbook works with WBS Master',
  xlReadMe2: '• Edit the WBS sheet: names, owners, dates, progress, predecessors (WBS codes such as 2.1, or 2.1+3 for a 3-day lag) and notes.',
  xlReadMe3: '• To add an item, insert a row where it belongs, set its Level (1, 2, 3…) and leave Item ID empty. To remove an item, delete its row.',
  xlReadMe4: '• Status override: leave empty for automatic status, or type Not started, In progress, On hold, Completed or Cancelled.',
  xlReadMe5: '• Columns starting with (calc) are calculated by WBS Master and ignored on import. Keep the Project ID and Item ID columns.',
  xlReadMe6: '• To bring your changes back: WBS Master → open the project → Import Excel → choose this file → check the changes → Apply.',
  e_xls_unsupported: 'Old .xls files can’t be read. Open the file in Excel and save it as .xlsx, then import it.', e_unreadable_file: 'That file couldn’t be read. Save it as .xlsx or .csv and try again.',
  view_summary: 'Summary', execSummary: 'Executive summary', statusDateEyebrow: 'Status date {date}',
  overall: 'Overall status', plannedByDate: '{pp}% planned by the status date (black mark)', noBaselineDates: 'No planned dates',
  forecastFinish: 'Forecast finish', planVs: 'Plan {date} ({baseline})', latestPlan: 'latest plan',
  workPackages: 'Work packages · {n}', completeOnTrack: '{done} complete · {green} on track', undatedN: ' · {n} without dates',
  summaryH: 'Summary', writeFromWbs: 'Write from WBS data', fillFromWbs: 'Fill from WBS', summaryPh: 'Click “Write from WBS data” to draft this paragraph, then edit it.',
  statusByElement: 'Status by WBS element', levelsHint: 'Levels 1–{n} · change with “Show levels”', element: 'Element',
  planFinish: 'Plan finish', forecastActual: 'Forecast / actual', doneVsPlan: 'Done vs plan',
  delayedAtRisk: 'Delayed and at-risk items', comingUp: 'Coming up in the next 30 days', nothingDelayed: 'Nothing is delayed or at risk.',
  nothingDue: 'Nothing is due in the next 30 days.', startsOn: 'Starts {date}', dueOn: 'Due {date}',
  critHint: '{n} linked items drive the finish date of {date}. Any slip here moves the project end.', critNone: 'Link items to see which chain drives the finish date.',
  milestones: 'Milestones', noMilestones: 'No milestones yet. Give an item the same start and finish date to make it one.',
  planOn: 'Plan {date}', doneOn: 'Done {date}', forecastOn: 'Forecast {date}',
  sec_achievements: 'Key achievements (last 30 days)', sec_nextSteps: 'Next steps (next 30 days)', sec_risks: 'Risks, issues and delays', sec_decisions: 'Decisions and support needed',
  copyText: 'Copy as text', downloadReport: 'Download report', copied: 'Copied. Paste it into an email or Teams.', copyBlocked: 'Copying was blocked here. Use Download report instead.',
  reportSaved: 'Report downloaded. Open it in a browser or Word, or print it to PDF.',
  baselineHistory: 'Baseline history', bhHint: 'Change = how far the planned finish moved at each re-baseline', setOn: 'Set on', reason: 'Reason',
  plannedFinish: 'Planned finish', change: 'Change', original: 'original', comparedNow: 'Compared now',
  driftLater: 'Against the original plan ({date}), today’s forecast finish is {n} working days later.',
  driftEarlier: 'Against the original plan ({date}), today’s forecast finish is {n} working days earlier.',
  driftOn: 'Against the original plan ({date}), today’s forecast finish is on time.', generatedOn: 'Generated with WBS Master on {date}.',
  n_open: 'As of {date}, {name} is {health} and {done}% complete{vsPlan}.', n_vsPlan: ' against {pp}% planned',
  n_finishPlan: 'Forecast completion is {finish} against a planned {plan}, {delta}.', n_late: '{n} working days late', n_early: '{n} working days early', n_onPlan: 'on plan',
  n_finish: 'Forecast completion is {finish}.', n_counts: '{done} of {total} work packages are complete; {red} delayed and {amber} at risk.',
  n_pressure: 'Main schedule pressure: {list}.', n_upcoming: '{n} items are due in the next 30 days.', n_upcoming1: 'One item is due in the next 30 days.',
  f_done: '• {name} completed {date}', f_late: ' ({n} working days late)', f_noDone: '• No work packages completed in the last 30 days.',
  f_next: '• {name}: {start}finish {date}', f_start: 'start {date}, ', f_noNext: '• Nothing scheduled in the next 30 days.', f_noRisk: '• No delayed or at-risk items.',
  baselines: 'Baselines', compareAgainst: 'Compare progress against', latestPlanSub: 'The working plan · finish {date}',
  blSub: 'Set {date} · finish {finish} · {n} items', saveBaseline: 'Save a new baseline from the current forecast', blName: 'Name', blReason: 'Reason (shown in reports)',
  blReasonPh: 'e.g. Scope change approved by the steering committee', blSaveHint: 'Today’s forecast dates become the new plan. Earlier baselines stay saved, and you can compare against any of them.',
  rename: 'Rename', restore: 'Make this the working plan again', deleteQ: 'Delete?', noBaselines: 'No saved baselines yet. The first one you save keeps today’s plan as the original.',
  baselineSaved: 'Baseline saved. Earlier baselines are kept.', comparingTo: 'vs {name}', backToLatest: 'Back to the latest plan',
  activity: 'Activity', activityAll: 'Whole project', activityThis: 'Selected item', loadMore: 'Load more', noActivity: 'No changes yet.',
  a_item_add: '{who} added {item}', a_item_delete: '{who} deleted {item}', a_item_update: '{who} changed the {field} of {item}: {from} → {to}',
  a_item_schedule: 'Auto-schedule moved {item}: {field} {from} → {to}', a_item_move: '{who} moved {item}', a_link_add: '{who} made {item} wait for {pred}',
  a_link_remove: '{who} removed the link from {item} to {pred}', a_link_lag: '{who} changed the lag of {item} after {pred}', a_project_create: '{who} created the project',
  a_project_settings: '{who} changed the project settings', a_baseline_save: '{who} saved the baseline “{name}”', someone: 'Someone', aDeletedItem: 'a deleted item',
  f_plannedStart: 'planned start', f_plannedFinish: 'planned finish', f_forecastStart: 'forecast start', f_forecastFinish: 'forecast finish',
  f_actualStart: 'actual start', f_actualFinish: 'actual finish', f_name: 'name', f_owner: 'owner', f_status: 'status', f_progress: 'progress', f_notes: 'notes', empty: 'empty',
  e_plan_baseline_limit: 'Your plan allows 1 baseline per project, plus the original. Upgrade to Team for unlimited baselines.', e_no_forecast_dates: 'Give items forecast dates first, then save a baseline.',
  view: 'View', view_table: 'Table', view_chart: 'Chart', view_gantt: 'Gantt',
  showLevels: 'Show levels', all: 'All',
  scale: 'Scale', scale_day: 'Day', scale_week: 'Week', scale_month: 'Month', scale_quarter: 'Quarter', zoom: 'Zoom',
  showBaseline: 'Baseline', criticalOnly: 'Critical only', workingDaysN: '{n} working days',
  linkDragHint: 'Drag the dot at a bar’s end onto another row to link', noDatesPlace: 'No dates — click the timeline to place',
  lgForecast: 'Forecast (drag to move)', nonWorking: 'Non-working days', projectWord: 'Project', linkedN: 'Linked: {succ} now waits for {pred}.',
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
  alsoViewing: 'Also viewing: {names}', selectedBy: 'Selected by {names}', remoteChanged: '{name} just changed this item. You’re seeing their update.',
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
  demo: 'نسخة تجريبية · تُحفظ في هذا المتصفح فقط', demoNote: 'تعمل هذه النسخة التجريبية بالكامل داخل متصفحك، ولا يُرسل شيء إلى أي خادم.', demoReset: 'البدء من جديد',
  signIn: 'تسجيل الدخول', signUp: 'إنشاء حساب', signOut: 'تسجيل الخروج',
  email: 'البريد الإلكتروني', password: 'كلمة المرور', yourName: 'اسمك', organisation: 'اسم المنشأة (اختياري)',
  noAccount: 'جديد على WBS Master؟', haveAccount: 'لديك حساب؟',
  passwordHint: '10 أحرف على الأقل.',
  projects: 'المشاريع', newProject: 'مشروع جديد', projectName: 'اسم المشروع', create: 'إنشاء', cancel: 'إلغاء', save: 'حفظ', close: 'إغلاق',
  noProjects: 'لا توجد مشاريع بعد. أنشئ أول مشروع من الأعلى.',
  items: 'بنود', updated: 'آخر تحديث', open: 'فتح', plan: 'الباقة',
  plan_free: 'مجانية', plan_team: 'الفريق', plan_business: 'الأعمال',
  language: 'English', theme: 'المظهر', theme_auto: 'تلقائي', theme_light: 'فاتح', theme_dark: 'داكن',
  r_slip_one: 'النهاية المتوقعة متأخرة يوم عمل واحد عن الخطة', r_finished_late_one: 'اكتمل بعد الخطة بيوم عمل واحد', workingDaysN_one: 'يوم عمل واحد',
  n_late_one: 'بتأخير يوم عمل واحد', n_early_one: 'قبل الموعد بيوم عمل واحد', f_late_one: ' (بتأخير يوم عمل واحد)', scheduledN_one: 'تم تحريك بند مرتبط واحد ليتبع البند السابق له.',
  driftLater_one: 'مقارنة بالخطة الأصلية ({date})، النهاية المتوقعة اليوم متأخرة يوم عمل واحد.', driftEarlier_one: 'مقارنة بالخطة الأصلية ({date})، النهاية المتوقعة اليوم مبكرة يوم عمل واحد.',
  critHint_one: 'بند مرتبط واحد يحدد تاريخ النهاية {date}.', deleteMany_one: 'حذف بند واحد؟',
  importExcel: 'استيراد Excel', exportExcel: 'تصدير Excel', newFromExcel: 'مشروع جديد من Excel',
  exported: 'تم تنزيل المصنف. عدّله في Excel ثم استخدم «استيراد Excel» لإعادة التغييرات.',
  imTitle: 'استيراد من Excel', imDrop: 'أفلت ملف Excel أو CSV هنا، أو انقر لاختياره', imReading: 'جارٍ قراءة الملف…',
  imDropHint: '‎.xlsx أو ‎.xlsm أو ‎.csv. المصنف المصدَّر من WBS Master يعيد تعديلاتك؛ وأي جدول آخر يصبح هيكل عمل جديدًا.',
  imConnectedUpdate: 'هذا مصنف WBS Master الخاص بمشروع «{name}». هذه هي التغييرات مقارنة بالمشروع الآن:',
  imConnectedCopy: 'هذا مصنف WBS Master لمشروع «{name}»، وسيُستورد كمشروع جديد.', imItemsN: '{n} بنود',
  imSheet: 'الورقة', imHeaderRow: 'صف العناوين', imDateOrder: 'صيغة التواريخ', imDmy: 'اليوم أولًا (31/12/2026)', imMdy: 'الشهر أولًا (12/31/2026)',
  imCode: 'رمز الهيكل', imPlannedStart: 'البداية المخططة', imPlannedFinish: 'النهاية المخططة', imForecastStart: 'البداية المتوقعة', imForecastFinish: 'النهاية المتوقعة',
  imActualStart: 'البداية الفعلية', imActualFinish: 'النهاية الفعلية', imNone: '— لا شيء —',
  imHowManyLevels: 'كيف تُبنى المستويات؟', imModeCode: 'من رمز الهيكل / المستوى', imModeNum: 'من الترقيم في الأسماء', imMode1: 'مستوى واحد',
  imMode2: 'مستويان', imMode3: '3 مستويات', imSuggested: 'مقترح', imGroup1: 'مجموعات المستوى 1 من العمود', imGroup2: 'مجموعات المستوى 2 من العمود',
  imGroupOpt: '{name} ({n} مجموعات)',
  imHint_code: 'تُبنى المستويات من عمود رمز الهيكل أو المستوى.', imHint_num: 'تُبنى المستويات من الأرقام في بداية كل اسم (1، 1.1، 1.1.1)، وتُحذف الأرقام من الأسماء.',
  imHint_1: 'يصبح كل صف بندًا في المستوى 1، ويمكنك بناء مستويات أعمق داخل التطبيق.',
  imHint_2: 'تصبح كل قيمة في العمود المختار بندًا في المستوى 1 وتحته صفوفه. الخلايا الفارغة تأخذ القيمة التي فوقها كالخلايا المدمجة.',
  imHint_3: 'يُبنى المستويان 1 و2 من العمودين المختارين، وتصبح صفوفك في المستوى 3.',
  imAppend: 'إضافة إلى هذا المشروع', imNew: 'إنشاء مشروع جديد', imRowsN: '{n} صفوف', imRowsN_one: 'صف واحد', imGroupsN: '{n} مجموعات', imGroupsN_one: 'مجموعة واحدة', imLevelsN: '{n} مستويات', imLevelsN_one: 'مستوى واحد',
  imNoRows: 'لا توجد صفوف بأسماء. تحقق من صف العناوين وعمود اسم البند.', imOtherFile: 'اختيار ملف آخر', imApply: 'تطبيق التغييرات', imImport: 'استيراد',
  imNoChanges: 'لا تغييرات: المصنف مطابق للمشروع.', imChangesN: '{changed} معدّلة · {added} مضافة · {removed} محذوفة', imAndMore: '…و{n} أخرى',
  imAdded: 'أُضيف', imRemoved: 'حُذف', imPosition: 'الموضع', imUntitled: 'مشروع مستورد', imCopy: 'نسخة',
  xlReadMe: 'اقرأني', xlReadMe1: 'طريقة عمل هذا المصنف مع WBS Master',
  xlReadMe2: '• عدّل ورقة WBS: الأسماء والمسؤولين والتواريخ والإنجاز والبنود السابقة (رموز مثل 2.1 أو 2.1+3 لتأخير 3 أيام) والملاحظات.',
  xlReadMe3: '• لإضافة بند، أدرج صفًا في مكانه وحدد مستواه (1، 2، 3…) واترك معرّف البند فارغًا. لحذف بند، احذف صفه.',
  xlReadMe4: '• تجاوز الحالة: اتركه فارغًا للحالة التلقائية، أو اكتب Not started أو In progress أو On hold أو Completed أو Cancelled.',
  xlReadMe5: '• الأعمدة التي تبدأ بـ (calc) يحسبها WBS Master وتُتجاهل عند الاستيراد. أبقِ عمودي معرّف المشروع ومعرّف البند.',
  xlReadMe6: '• لإعادة تغييراتك: WBS Master ← افتح المشروع ← استيراد Excel ← اختر هذا الملف ← راجع التغييرات ← تطبيق.',
  e_xls_unsupported: 'لا يمكن قراءة ملفات ‎.xls القديمة. افتح الملف في Excel واحفظه بصيغة ‎.xlsx ثم استورده.', e_unreadable_file: 'تعذّرت قراءة الملف. احفظه بصيغة ‎.xlsx أو ‎.csv وحاول مرة أخرى.',
  view_summary: 'الملخص', execSummary: 'الملخص التنفيذي', statusDateEyebrow: 'تاريخ الحالة {date}',
  overall: 'الوضع العام', plannedByDate: '{pp}٪ مخطط حتى تاريخ الحالة (العلامة السوداء)', noBaselineDates: 'لا توجد تواريخ مخططة',
  forecastFinish: 'النهاية المتوقعة', planVs: 'المخطط {date} ({baseline})', latestPlan: 'أحدث خطة',
  workPackages: 'حزم العمل · {n}', completeOnTrack: '{done} مكتملة · {green} في المسار', undatedN: ' · {n} بلا تواريخ',
  summaryH: 'الملخص', writeFromWbs: 'اكتب من بيانات الهيكل', fillFromWbs: 'املأ من الهيكل', summaryPh: 'انقر «اكتب من بيانات الهيكل» لصياغة هذه الفقرة، ثم عدّلها.',
  statusByElement: 'الحالة حسب عناصر الهيكل', levelsHint: 'المستويات 1–{n} · غيّرها من «المستويات»', element: 'العنصر',
  planFinish: 'النهاية المخططة', forecastActual: 'المتوقع / الفعلي', doneVsPlan: 'المنجز مقابل المخطط',
  delayedAtRisk: 'البنود المتأخرة والمعرّضة للخطر', comingUp: 'القادم خلال 30 يومًا', nothingDelayed: 'لا يوجد ما هو متأخر أو معرّض للخطر.',
  nothingDue: 'لا يوجد ما يستحق خلال 30 يومًا القادمة.', startsOn: 'يبدأ {date}', dueOn: 'يستحق {date}',
  critHint: '{n} بنود مرتبطة تحدد تاريخ النهاية {date}. أي تأخير فيها يؤخر نهاية المشروع.', critNone: 'اربط البنود لمعرفة السلسلة التي تحدد تاريخ النهاية.',
  milestones: 'المعالم الرئيسية', noMilestones: 'لا توجد معالم بعد. اجعل تاريخ البداية والنهاية متساويين لتحويل البند إلى معلم.',
  planOn: 'المخطط {date}', doneOn: 'اكتمل {date}', forecastOn: 'المتوقع {date}',
  sec_achievements: 'أبرز الإنجازات (آخر 30 يومًا)', sec_nextSteps: 'الخطوات القادمة (30 يومًا القادمة)', sec_risks: 'المخاطر والمشكلات والتأخيرات', sec_decisions: 'القرارات والدعم المطلوب',
  copyText: 'نسخ كنص', downloadReport: 'تنزيل التقرير', copied: 'تم النسخ. الصقه في بريد إلكتروني أو في Teams.', copyBlocked: 'تعذّر النسخ هنا. استخدم «تنزيل التقرير».',
  reportSaved: 'تم تنزيل التقرير. افتحه في المتصفح أو Word، أو اطبعه بصيغة PDF.',
  baselineHistory: 'سجل خطوط الأساس', bhHint: 'التغيير = مقدار تحرك النهاية المخططة عند كل إعادة لخط الأساس', setOn: 'تاريخ الحفظ', reason: 'السبب',
  plannedFinish: 'النهاية المخططة', change: 'التغيير', original: 'الأصلي', comparedNow: 'المقارنة الحالية',
  driftLater: 'مقارنة بالخطة الأصلية ({date})، النهاية المتوقعة اليوم متأخرة {n} أيام عمل.',
  driftEarlier: 'مقارنة بالخطة الأصلية ({date})، النهاية المتوقعة اليوم مبكرة {n} أيام عمل.',
  driftOn: 'مقارنة بالخطة الأصلية ({date})، النهاية المتوقعة اليوم في موعدها.', generatedOn: 'أُنشئ باستخدام WBS Master في {date}.',
  n_open: 'حتى تاريخ {date}، وضع مشروع {name} «{health}» ونسبة إنجازه {done}٪{vsPlan}.', n_vsPlan: ' مقابل {pp}٪ مخطط',
  n_finishPlan: 'الاكتمال المتوقع في {finish} مقابل {plan} حسب الخطة، {delta}.', n_late: 'بتأخير {n} أيام عمل', n_early: 'قبل الموعد بـ {n} أيام عمل', n_onPlan: 'حسب الخطة',
  n_finish: 'الاكتمال المتوقع في {finish}.', n_counts: 'اكتملت {done} من أصل {total} حزم عمل؛ {red} متأخرة و{amber} معرّضة للخطر.',
  n_pressure: 'أبرز ضغوط الجدول الزمني: {list}.', n_upcoming: 'يستحق {n} بنود خلال 30 يومًا القادمة.', n_upcoming1: 'يستحق بند واحد خلال 30 يومًا القادمة.',
  f_done: '• اكتمل {name} في {date}', f_late: ' (بتأخير {n} أيام عمل)', f_noDone: '• لم تكتمل أي حزمة عمل خلال آخر 30 يومًا.',
  f_next: '• {name}: {start}النهاية {date}', f_start: 'البداية {date}، ', f_noNext: '• لا يوجد ما هو مجدول خلال 30 يومًا القادمة.', f_noRisk: '• لا توجد بنود متأخرة أو معرّضة للخطر.',
  baselines: 'خطوط الأساس', compareAgainst: 'مقارنة التقدم مع', latestPlanSub: 'خطة العمل الحالية · النهاية {date}',
  blSub: 'حُفظ {date} · النهاية {finish} · {n} بنود', saveBaseline: 'حفظ خط أساس جديد من التواريخ المتوقعة الحالية', blName: 'الاسم', blReason: 'السبب (يظهر في التقارير)',
  blReasonPh: 'مثال: تغيير في النطاق اعتمدته اللجنة التوجيهية', blSaveHint: 'تصبح التواريخ المتوقعة اليوم هي الخطة الجديدة. تبقى خطوط الأساس السابقة محفوظة، ويمكنك المقارنة مع أي منها.',
  rename: 'إعادة تسمية', restore: 'اجعل هذه خطة العمل مجددًا', deleteQ: 'حذف؟', noBaselines: 'لا توجد خطوط أساس محفوظة بعد. أول خط أساس تحفظه يحتفظ بخطة اليوم كخطة أصلية.',
  baselineSaved: 'تم حفظ خط الأساس، وبقيت خطوط الأساس السابقة محفوظة.', comparingTo: 'مقابل {name}', backToLatest: 'العودة إلى أحدث خطة',
  activity: 'السجل', activityAll: 'المشروع كاملًا', activityThis: 'البند المحدد', loadMore: 'تحميل المزيد', noActivity: 'لا توجد تغييرات بعد.',
  a_item_add: 'أضاف {who} البند {item}', a_item_delete: 'حذف {who} البند {item}', a_item_update: 'غيّر {who} {field} في {item}: {from} ← {to}',
  a_item_schedule: 'حرّكت الجدولة التلقائية {item}: {field} {from} ← {to}', a_item_move: 'نقل {who} البند {item}', a_link_add: 'جعل {who} البند {item} ينتظر {pred}',
  a_link_remove: 'أزال {who} الارتباط بين {item} و{pred}', a_link_lag: 'غيّر {who} التأخير بين {item} و{pred}', a_project_create: 'أنشأ {who} المشروع',
  a_project_settings: 'غيّر {who} إعدادات المشروع', a_baseline_save: 'حفظ {who} خط الأساس «{name}»', someone: 'شخص ما', aDeletedItem: 'بند محذوف',
  f_plannedStart: 'البداية المخططة', f_plannedFinish: 'النهاية المخططة', f_forecastStart: 'البداية المتوقعة', f_forecastFinish: 'النهاية المتوقعة',
  f_actualStart: 'البداية الفعلية', f_actualFinish: 'النهاية الفعلية', f_name: 'الاسم', f_owner: 'المسؤول', f_status: 'الحالة', f_progress: 'الإنجاز', f_notes: 'الملاحظات', empty: 'فارغ',
  e_plan_baseline_limit: 'تسمح باقتك بخط أساس واحد لكل مشروع إضافة إلى الأصلي. رقِّ إلى باقة الفريق لخطوط أساس غير محدودة.', e_no_forecast_dates: 'أضف تواريخ متوقعة للبنود أولًا، ثم احفظ خط الأساس.',
  view: 'العرض', view_table: 'جدول', view_chart: 'مخطط', view_gantt: 'جانت',
  showLevels: 'المستويات', all: 'الكل',
  scale: 'المقياس', scale_day: 'يوم', scale_week: 'أسبوع', scale_month: 'شهر', scale_quarter: 'ربع سنة', zoom: 'التكبير',
  showBaseline: 'خط الأساس', criticalOnly: 'الحرج فقط', workingDaysN: '{n} أيام عمل',
  linkDragHint: 'اسحب النقطة في نهاية الشريط إلى صف آخر لإنشاء ارتباط', noDatesPlace: 'بلا تواريخ — انقر على المخطط الزمني لتحديد موعد',
  lgForecast: 'المتوقع (اسحب للتحريك)', nonWorking: 'أيام العطل', projectWord: 'المشروع', linkedN: 'تم الربط: {succ} ينتظر الآن {pred}.',
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
  alsoViewing: 'يشاهد أيضًا: {names}', selectedBy: 'محدد بواسطة {names}', remoteChanged: 'غيّر {name} هذا البند للتو، ويظهر لك تحديثه الآن.',
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
      // singular wording when the count is 1 ("1 working day"), where the dictionary has it
      const count = vars?.n ?? vars?.days;
      const oneKey = `${key}_one` as MessageKey;
      let s: string = (count === 1 && (dict as Record<string, string>)[oneKey]) || dict[key] || en[key] || key;
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
