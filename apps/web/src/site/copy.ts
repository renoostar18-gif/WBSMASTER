// Words for the public site (landing page, pricing, FAQ, footer), in English and Arabic.
// Kept out of i18n.tsx because they are marketing copy, not app UI. Prices and limits come from pricing.ts.
import type { Locale } from '../i18n.js';

const en = {
  metaTitle: 'WBS Master: project planning for Saudi and GCC teams',
  nav: { features: 'Features', pricing: 'Pricing', faq: 'FAQ', signIn: 'Sign in', start: 'Start free', projects: 'Your projects' },
  hero: {
    eyebrow: 'Project planning for Saudi and GCC teams',
    title: 'Plan every project from one work breakdown structure.',
    lead: 'Build the WBS as a chart, a table or a Gantt, schedule it on your working-day calendar, and see at a glance what is on track, at risk or late. In Arabic or English, with your data kept in Saudi Arabia.',
    primary: 'Start free', secondary: 'See pricing',
    note: 'Free for up to 3 people. No card needed.',
  },
  facts: [
    'Data hosted in Saudi Arabia',
    'Arabic and English, right to left',
    'Sunday–Thursday week, Saudi holidays',
    'mada, Visa, Mastercard, Apple Pay',
  ],
  mock: {
    label: 'Example: a project in the Gantt view, with health colours, a baseline and the critical path',
    project: '24 kV RMU development', views: ['Chart', 'Table', 'Gantt'], today: 'Status date',
    cols: ['WBS', 'Item', 'Health'],
    rows: ['Design', 'Electrical design', 'Mechanical design', 'Procurement', 'Switchgear order', 'Testing and handover', 'Factory acceptance test'],
    health: { green: 'On track', amber: 'At risk', red: 'Delayed', none: 'Not started' },
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    legend: { plan: 'Baseline', crit: 'Critical path' },
  },
  featuresTitle: 'Everything a project plan needs, in one place',
  featuresLead: 'One structure drives the chart, the table, the schedule and the reports, so they never disagree.',
  features: [
    { h: 'One WBS, three views', p: 'Shape the breakdown as an org-style chart, fill in owners and dates in a table, and schedule in a Gantt. Every view edits the same items.' },
    { h: 'Schedules on your calendar', p: 'Working-day calendars with a Sunday–Thursday week and Saudi public holidays by default. Link items and see the critical path that drives the finish date.' },
    { h: 'Baselines and health', p: 'Save baselines, compare today’s forecast with the original plan, and see slips in working days. Items turn green, amber or red so problems stand out.' },
    { h: 'Portfolio at a glance', p: 'Every active project on one page, worst first, with a roadmap of plan against forecast, milestones, decisions and risks.' },
    { h: 'Work together, live', p: 'Edit the same project at the same time, comment on items, @mention colleagues and get notified when something needs you.' },
    { h: 'Excel, API and webhooks', p: 'Import any spreadsheet, export to Excel, edit offline and bring the changes back. Connect other systems with the REST API and webhooks.' },
  ],
  regionTitle: 'Made for how teams in the region work',
  region: [
    { h: 'Arabic and English', p: 'Every screen in both languages with a full right-to-left layout. Each person picks their own.' },
    { h: 'Your data stays in the Kingdom', p: 'Hosted on Google Cloud in the Dammam region (me-central2), through CNTXT.' },
    { h: 'Local payment', p: 'Pay in Saudi riyals with mada, Visa, Mastercard or Apple Pay. Prepaid, with no automatic renewal.' },
    { h: 'Company sign-in', p: 'On Business, people sign in with Microsoft Entra ID or Google Workspace.' },
  ],
  pricing: {
    title: 'Simple pricing per user',
    lead: 'Start free. Try Team or Business free for 14 days. Guests are always free.',
    monthly: 'Monthly', yearly: 'Yearly', save: 'save 20%',
    perUser: 'per user / month', free: 'SAR 0', freeSub: 'for up to 3 members',
    billedMonthly: 'Billed monthly', billedYearly: 'Billed yearly: {amount} per user',
    exVat: 'Prices exclude VAT. 15% VAT is added at checkout.',
    trial: '14-day free trial', popular: 'Recommended',
    startFree: 'Start free', startTrial: 'Start free trial',
    plans: {
      free: { name: 'Free', tag: 'For trying it out and small teams.' },
      team: { name: 'Team', tag: 'For teams running several projects.' },
      business: { name: 'Business', tag: 'For organisations that need SSO and more control.' },
    },
    features: {
      free: ['Up to 3 members', '3 active projects', '500 items per project', '1 baseline per project', '30 days of activity history', 'Chart, table and Gantt views', 'Excel import and export'],
      team: ['Everything in Free, plus:', 'Unlimited projects and baselines', '10,000 items per project', 'Portfolio view', 'Guests free', 'Public read-only links', 'REST API and webhooks', '1 year of activity history', 'Email support, next business day'],
      business: ['Everything in Team, plus:', 'Single sign-on (Entra ID, Google)', 'Several working calendars per organisation', 'Unlimited activity history, with export', 'Priority support'],
    },
    payNote: 'Pay with mada, Visa, Mastercard or Apple Pay through Moyasar. You pay in advance for a month or a year; nothing renews automatically.',
  },
  faqTitle: 'Questions',
  faq: [
    { q: 'How does the free trial work?', a: 'Team and Business come with a 14-day free trial for your organisation, once. You don’t need a card to start it. At the end, pay for a month or a year, or carry on with the Free plan.' },
    { q: 'Do prices include VAT?', a: 'No. Prices are in Saudi riyals and exclude VAT. 15% VAT is added at checkout and shown on your invoice.' },
    { q: 'How can we pay?', a: 'By mada, Visa, Mastercard or Apple Pay, through Moyasar. We never see or store your card number. You pay in advance for a month or a year, and we email a reminder before the period ends. Nothing renews automatically.' },
    { q: 'Where is our data stored?', a: 'In Saudi Arabia, on Google Cloud in the Dammam region (me-central2), through CNTXT. See the Privacy Policy for details.' },
    { q: 'Does it work in Arabic?', a: 'Yes. Every screen is available in Arabic and English, with a full right-to-left layout in Arabic. Each person chooses their language, and you can switch at any time.' },
    { q: 'Can we cancel or move to a smaller plan?', a: 'Yes. As nothing renews automatically, you simply don’t renew. Moving to a smaller plan never deletes data: projects over the Free limits become read-only until you upgrade again or archive some.' },
    { q: 'Who counts as a user?', a: 'Members of your organisation count as users. Guests, such as clients or subcontractors you invite to specific projects, are free.' },
  ],
  cta: { title: 'Build your first WBS in minutes', lead: 'Start on the Free plan. Upgrade when your team needs more.', button: 'Create a free account' },
  footer: {
    tagline: 'Project planning for Saudi and GCC teams.',
    product: 'Product', legal: 'Legal', contact: 'Contact',
    terms: 'Terms of Service', privacy: 'Privacy Policy',
    hosted: 'Data hosted in Saudi Arabia',
    company: 'Raysha · [Company address] · CR [CR number]',
    email: '[support email]',
  },
  legal: {
    draft: 'Draft — to be reviewed by a qualified lawyer before publication.',
    updated: 'Last updated: [date]',
    contents: 'Contents',
    otherLang: 'اقرأ النسخة العربية',
  },
  agree: 'By creating an account, you agree to the {terms} and the {privacy}.',
};

export type SiteCopy = typeof en;

const ar: SiteCopy = {
  metaTitle: 'WBS Master: تخطيط المشاريع لفرق السعودية والخليج',
  nav: { features: 'المزايا', pricing: 'الأسعار', faq: 'الأسئلة الشائعة', signIn: 'تسجيل الدخول', start: 'ابدأ مجانًا', projects: 'مشاريعك' },
  hero: {
    eyebrow: 'تخطيط المشاريع لفرق السعودية والخليج',
    title: 'خطِّط كل مشروع من هيكل تجزئة عمل واحد.',
    lead: 'ابنِ هيكل تجزئة العمل مخططًا أو جدولًا أو مخطط جانت، وجدوِله على تقويم أيام العمل لديك، واعرف بنظرة واحدة ما يسير وفق الخطة وما هو معرّض للخطر وما تأخر. بالعربية أو الإنجليزية، وبياناتك محفوظة في المملكة العربية السعودية.',
    primary: 'ابدأ مجانًا', secondary: 'اطّلع على الأسعار',
    note: 'مجاني لثلاثة أشخاص. لا حاجة إلى بطاقة.',
  },
  facts: [
    'البيانات مستضافة في المملكة العربية السعودية',
    'العربية والإنجليزية، من اليمين إلى اليسار',
    'أسبوع عمل من الأحد إلى الخميس، والعطل الرسمية السعودية',
    'مدى، فيزا، ماستركارد، Apple Pay',
  ],
  mock: {
    label: 'مثال: مشروع في عرض جانت، مع ألوان الحالة وخط الأساس والمسار الحرج',
    project: 'تطوير وحدة RMU جهد 24 ك.ف', views: ['المخطط', 'الجدول', 'جانت'], today: 'تاريخ الحالة',
    cols: ['WBS', 'البند', 'الحالة'],
    rows: ['التصميم', 'التصميم الكهربائي', 'التصميم الميكانيكي', 'المشتريات', 'طلب لوحات التوزيع', 'الاختبار والتسليم', 'اختبار القبول في المصنع'],
    health: { green: 'وفق الخطة', amber: 'معرّض للخطر', red: 'متأخر', none: 'لم يبدأ' },
    months: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'],
    legend: { plan: 'خط الأساس', crit: 'المسار الحرج' },
  },
  featuresTitle: 'كل ما تحتاجه خطة المشروع، في مكان واحد',
  featuresLead: 'هيكل واحد يغذّي المخطط والجدول والجدول الزمني والتقارير، فلا تتعارض أبدًا.',
  features: [
    { h: 'هيكل واحد، ثلاثة عروض', p: 'شكّل التجزئة في مخطط هرمي، وأدخل المسؤولين والتواريخ في جدول، وجدوِل العمل في مخطط جانت. كل العروض تعدّل البنود نفسها.' },
    { h: 'جداول زمنية على تقويمك', p: 'تقاويم أيام عمل بأسبوع من الأحد إلى الخميس والعطل الرسمية السعودية افتراضيًا. اربط البنود واعرف المسار الحرج الذي يحدد تاريخ الانتهاء.' },
    { h: 'خطوط الأساس والحالة', p: 'احفظ خطوط الأساس، وقارن توقع اليوم بالخطة الأصلية، واعرف التأخير بأيام العمل. تتلوّن البنود بالأخضر أو الكهرماني أو الأحمر لتبرز المشكلات.' },
    { h: 'المحفظة بنظرة واحدة', p: 'كل المشاريع النشطة في صفحة واحدة، الأسوأ أولًا، مع خارطة طريق للخطة مقابل التوقع، والمعالم والقرارات والمخاطر.' },
    { h: 'عمل جماعي مباشر', p: 'عدّلوا المشروع نفسه في الوقت نفسه، وعلّقوا على البنود، واذكروا الزملاء بـ @، وتلقَّوا إشعارًا حين يحتاجكم أمر ما.' },
    { h: 'Excel وواجهة برمجية وWebhooks', p: 'استورد أي جدول بيانات، وصدّر إلى Excel، وعدّل دون اتصال ثم أعد التغييرات. اربط أنظمتك الأخرى عبر واجهة REST البرمجية وWebhooks.' },
  ],
  regionTitle: 'مصمَّم لطريقة عمل الفرق في المنطقة',
  region: [
    { h: 'العربية والإنجليزية', p: 'كل الشاشات باللغتين مع تخطيط كامل من اليمين إلى اليسار. يختار كل شخص لغته.' },
    { h: 'بياناتك تبقى في المملكة', p: 'مستضافة على Google Cloud في منطقة الدمام (me-central2) عبر CNTXT.' },
    { h: 'دفع محلي', p: 'ادفع بالريال السعودي عبر مدى أو فيزا أو ماستركارد أو Apple Pay. دفع مسبق دون تجديد تلقائي.' },
    { h: 'دخول بحساب الشركة', p: 'في باقة الأعمال، يسجّل الأشخاص الدخول بحساب Microsoft Entra ID أو Google Workspace.' },
  ],
  pricing: {
    title: 'أسعار بسيطة لكل مستخدم',
    lead: 'ابدأ مجانًا. جرّب باقة الفريق أو الأعمال مجانًا لمدة 14 يومًا. الضيوف مجانًا دائمًا.',
    monthly: 'شهري', yearly: 'سنوي', save: 'وفّر 20%',
    perUser: 'لكل مستخدم / شهريًا', free: '0 ر.س', freeSub: 'حتى 3 أعضاء',
    billedMonthly: 'يُدفع شهريًا', billedYearly: 'يُدفع سنويًا: {amount} لكل مستخدم',
    exVat: 'الأسعار لا تشمل ضريبة القيمة المضافة. تُضاف ضريبة 15% عند الدفع.',
    trial: 'تجربة مجانية 14 يومًا', popular: 'موصى بها',
    startFree: 'ابدأ مجانًا', startTrial: 'ابدأ التجربة المجانية',
    plans: {
      free: { name: 'المجانية', tag: 'للتجربة وللفرق الصغيرة.' },
      team: { name: 'الفريق', tag: 'للفرق التي تدير عدة مشاريع.' },
      business: { name: 'الأعمال', tag: 'للمؤسسات التي تحتاج الدخول الموحّد وتحكمًا أكبر.' },
    },
    features: {
      free: ['حتى 3 أعضاء', '3 مشاريع نشطة', '500 بند لكل مشروع', 'خط أساس واحد لكل مشروع', 'سجل نشاط لمدة 30 يومًا', 'عروض المخطط والجدول وجانت', 'استيراد وتصدير Excel'],
      team: ['كل ما في المجانية، بالإضافة إلى:', 'مشاريع وخطوط أساس بلا حدود', '10,000 بند لكل مشروع', 'عرض المحفظة', 'الضيوف مجانًا', 'روابط عامة للقراءة فقط', 'واجهة REST البرمجية وWebhooks', 'سجل نشاط لمدة سنة', 'دعم بالبريد في يوم العمل التالي'],
      business: ['كل ما في الفريق، بالإضافة إلى:', 'الدخول الموحّد (Entra ID وGoogle)', 'عدة تقاويم عمل لكل مؤسسة', 'سجل نشاط بلا حدود مع إمكانية التصدير', 'دعم ذو أولوية'],
    },
    payNote: 'ادفع عبر مدى أو فيزا أو ماستركارد أو Apple Pay من خلال ميسّر. تدفع مقدمًا لشهر أو لسنة، ولا يتجدد شيء تلقائيًا.',
  },
  faqTitle: 'أسئلة شائعة',
  faq: [
    { q: 'كيف تعمل التجربة المجانية؟', a: 'تأتي باقتا الفريق والأعمال مع تجربة مجانية لمدة 14 يومًا لمؤسستك، مرة واحدة. لا تحتاج إلى بطاقة لبدئها. في نهايتها، ادفع لشهر أو لسنة، أو استمر على الباقة المجانية.' },
    { q: 'هل تشمل الأسعار ضريبة القيمة المضافة؟', a: 'لا. الأسعار بالريال السعودي ولا تشمل ضريبة القيمة المضافة. تُضاف ضريبة 15% عند الدفع وتظهر في فاتورتك.' },
    { q: 'كيف يمكننا الدفع؟', a: 'عبر مدى أو فيزا أو ماستركارد أو Apple Pay من خلال ميسّر. لا نرى رقم بطاقتك ولا نحفظه. تدفع مقدمًا لشهر أو لسنة، ونرسل تذكيرًا بالبريد قبل انتهاء المدة. لا يتجدد شيء تلقائيًا.' },
    { q: 'أين تُحفظ بياناتنا؟', a: 'في المملكة العربية السعودية، على Google Cloud في منطقة الدمام (me-central2) عبر CNTXT. التفاصيل في سياسة الخصوصية.' },
    { q: 'هل يعمل باللغة العربية؟', a: 'نعم. كل الشاشات متاحة بالعربية والإنجليزية، مع تخطيط كامل من اليمين إلى اليسار بالعربية. يختار كل شخص لغته ويمكنه التبديل في أي وقت.' },
    { q: 'هل يمكننا الإلغاء أو الانتقال إلى باقة أصغر؟', a: 'نعم. بما أنه لا يتجدد شيء تلقائيًا، يكفي ألّا تجدد. الانتقال إلى باقة أصغر لا يحذف أي بيانات أبدًا: تصبح المشاريع التي تتجاوز حدود الباقة المجانية للقراءة فقط حتى ترقّي باقتك من جديد أو تؤرشف بعضها.' },
    { q: 'من يُحتسب مستخدمًا؟', a: 'يُحتسب أعضاء مؤسستك مستخدمين. أما الضيوف، كالعملاء أو المقاولين من الباطن الذين تدعوهم إلى مشاريع محددة، فمجانًا.' },
  ],
  cta: { title: 'ابنِ أول هيكل تجزئة عمل في دقائق', lead: 'ابدأ بالباقة المجانية، ورقِّ باقتك حين يحتاج فريقك المزيد.', button: 'أنشئ حسابًا مجانيًا' },
  footer: {
    tagline: 'تخطيط المشاريع لفرق السعودية والخليج.',
    product: 'المنتج', legal: 'الشروط والسياسات', contact: 'التواصل',
    terms: 'شروط الخدمة', privacy: 'سياسة الخصوصية',
    hosted: 'البيانات مستضافة في المملكة العربية السعودية',
    company: 'ريشة · [عنوان الشركة] · سجل تجاري [رقم السجل التجاري]',
    email: '[بريد الدعم]',
  },
  legal: {
    draft: 'مسودة — تجب مراجعتها من محامٍ مؤهل قبل النشر.',
    updated: 'آخر تحديث: [التاريخ]',
    contents: 'المحتويات',
    otherLang: 'Read in English',
  },
  agree: 'بإنشاء حساب، فإنك توافق على {terms} و{privacy}.',
};

export const SITE_COPY: Record<Locale, SiteCopy> = { en, ar };

/** "SAR 45" in English, "45 ر.س" in Arabic, as on the Billing page. */
export function sar(locale: Locale, n: number): string {
  const v = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB').format(n);
  return locale === 'ar' ? `${v} ر.س` : `SAR ${v}`;
}
