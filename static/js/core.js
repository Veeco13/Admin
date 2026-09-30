/* =====================================================================
   Lunx — CORE / STATE
   ===================================================================== */
'use strict';

let STATE = null;          // نفس شكل STATE في الوثيقة (القسم 6)
let IDX = {};              // فهارس سريعة
let VIEW = lsGet('mv_lastView') || 'dashboard';
let VIEW_ARGS = {};        // وسائط تُمرَّر عند الانتقال (فلاتر مثلاً)

const VIEWS = [
  { id: 'dashboard',   label: 'الصفحة الرئيسية',        ico: '🏠', render: () => renderDashboard() },
  { id: 'companies',   label: 'الشركات',                ico: '🏢', render: () => renderCompanies() },   // + المشاريع ومراكز التكلفة
  { id: 'recruitment', label: 'تسجيل موظف جديد',        ico: '🧭', render: () => renderRecruitment() }, // الموظف الجديد بيتضاف من هنا بس
  { id: 'employees',   label: 'الإقامات والموظفين',      ico: '👥', render: () => renderEmployees() },
  { id: 'vehicles',    label: 'السيارات',               ico: '🚗', render: () => renderVehicles() },
  { id: 'permits',     label: 'التصاريح',               ico: '🪪', render: () => renderPermits() },     // للموظفين والسيارات
  { id: 'custody',     label: 'العهد والمصروفات',        ico: '💰', render: () => renderCustody() },
  { id: 'contract',    label: 'عقد العمل',              ico: '📄', render: () => renderContractView() },
  { id: 'companylog',  label: 'السجل التاريخي والتدقيق', ico: '🗂️', render: () => renderCompanyLog() },
];

/* ---------- القوائم الثابتة (القسم 7) ---------- */
const GOV_STAGES = [
  { id: 'awaiting_contract',     label: 'بانتظار عقد العمل',                 dot: '⚪', color: 'var(--grey)' },
  { id: 'awaiting_work_permit',  label: 'بانتظار إذن العمل',                 dot: '🟠', color: 'var(--orange)' },
  { id: 'health_insurance',      label: 'التأمين الصحي',                    dot: '🔵', color: 'var(--blue)' },
  { id: 'residency',             label: 'الإقامة',                          dot: '🟣', color: 'var(--purple)' },
  { id: 'civil_id',              label: 'البطاقة المدنية',                   dot: '🟡', color: 'var(--yellow)' },
  { id: 'renewed',               label: 'تم التجديد',                        dot: '🟢', color: 'var(--green)' },
  { id: 'awaiting_cancellation', label: 'بانتظار إلغاء الإقامة وإذن العمل',   dot: '🔴', color: 'var(--red)' },
];
/** أنواع الخط الزمني اللي بتظهر في تبويب «التحركات» (history.MOVE_TYPES على السيرفر) */
const MOVE_ICONS = { baseline: '🏁', create: '🆕', import_add: '📥', transfer: '🔀', project: '📁', cost_center: '💼' };
const GENDER_LABELS = { male: 'ذكر', female: 'أنثى' };
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const MARITAL_LABELS = { single: 'أعزب', married: 'متزوج', divorced: 'مطلق', widowed: 'أرمل' };
// العمالة الوطنية (استمارة 103 للتأمينات واستمارة العلاوة الاجتماعية) — نفس pdf_forms.KUWAITI
const KUWAITI_NATIONALITIES = ['الكويت', 'كويتي', 'كويتية', 'معاملة كويتية'];
function isKuwaitiStaff(p) { return KUWAITI_NATIONALITIES.map(norm).includes(norm(p && p.nationality)); }
function maritalLabel(p) { const l = MARITAL_LABELS[p.maritalStatus]; return l ? t(l) : ''; }
function ageYears(dob) {
  const d = parseDate(dob); if (!d) return null;
  const n = new Date(); let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}
/** عنوان السكن (موظف أو مترشّح) في سطر واحد */
function addressText(p) {
  return [p.addressArea, p.addressBlock && `${t('قطعة')} ${p.addressBlock}`, p.addressStreet && `${t('شارع')} ${p.addressStreet}`,
    p.addressHouse && `${t('منزل')} ${p.addressHouse}`, p.addressApartment && `${t('شقة')} ${p.addressApartment}`].filter(Boolean).join('، ');
}
/** خانات الموظف/المترشّح المشتركة الجديدة في النماذج: الجنس + الرقم الموحد + فصيلة الدم + العنوان + هاتف المنزل */
function personExtraInputs(p) {
  const v = k => esc(p[k] ?? '');
  const inp = (k, l, extra = '') => `<label>${t(l)}<input name="${k}" value="${v(k)}" ${extra}></label>`;
  return `<label>${t('الرقم الموحد')}<input name="unifiedNumber" value="${v('unifiedNumber')}" inputmode="numeric" maxlength="9"></label>
    <label>${t('فصيلة الدم')}<select name="bloodType">${opt('', '—', !p.bloodType)}${BLOOD_TYPES.map(x => opt(x, x, x === p.bloodType)).join('')}</select></label>
    <h4>${t('عنوان السكن')}</h4>
    ${inp('addressArea', 'المنطقة')}${inp('addressBlock', 'القطعة')}${inp('addressStreet', 'الشارع')}
    ${inp('addressHouse', 'المنزل')}${inp('addressApartment', 'الشقة')}${inp('homePhone', 'هاتف المنزل', 'dir="ltr"')}`;
}
const EMP_STATUS_LABELS = {
  active:             { ar: 'في الخدمة',       en: 'In Service' },
  warning:            { ar: 'في فترة الإنذار',  en: 'Notice Period' },
  resigned:           { ar: 'مستقيل',          en: 'Resigned' },
  terminated:         { ar: 'إنهاء خدمات',     en: 'Terminated' },
  pending_completion: { ar: 'قيد الاستكمال',    en: 'Pending Completion' },
};
// خدمتهم انتهت (استقالة / إنهاء خدمات): برّه التنبيهات ولوحة المعلومات وقوايم العهد والعقود، وموجودين في الأرشيف والتقارير
const EMP_ENDED = ['resigned', 'terminated'];
function empEnded(e) { return EMP_ENDED.includes(e && e.employmentStatus); }
// سبب انتهاء الخدمة (نفس استمارة 103): «استقالة» ← مستقيل، والباقي ← إنهاء خدمات (app.end_type_for_reason)
const END_REASONS = ['استقالة', 'إنهاء خدمات من صاحب العمل', 'انتهاء العقد', 'التقاعد', 'الوفاة'];
function endTypeForReason(r) { return /استقال/.test(r || '') ? 'resigned' : 'terminated'; }
const RECRUIT_STAGES_OUTSIDE = [
  { id: 'work_permit',           label: 'استخراج تصريح العمل' },
  { id: 'work_visa',             label: 'إصدار تأشيرة العمل' },
  { id: 'medical_exam',          label: 'الفحص الطبي ونتيجته' },
  { id: 'foreign_ministry_auth', label: 'تصديق الأوراق من الخارجية' },
  { id: 'employment_contract',   label: 'عقد العمل' },
  { id: 'work_license',          label: 'إصدار إذن العمل' },
  { id: 'health_insurance',      label: 'إصدار الضمان الصحي' },
  { id: 'residency_issue',       label: 'إصدار الإقامة' },
  { id: 'civil_id_issue',        label: 'إصدار البطاقة المدنية' },
  { id: 'all_completed',         label: '✅ تم إنجاز جميع الإجراءات', final: true },
];
// العمالة الوطنية (الجنسية كويتي / معاملة كويتية ← المصدر «عمالة وطنية» تلقائيًا). أول مرحلة: عقد العمل
// واستمارة 103 واستمارة العلاوة الاجتماعية للطباعة والتوقيع
const RECRUIT_STAGES_KUWAITI = [
  { id: 'kw_forms',         label: 'طباعة النماذج والتوقيع عليها' },
  { id: 'kw_pifss',         label: 'التسجيل في التأمينات الاجتماعية' },
  { id: 'kw_work_permit',   label: 'استخراج إذن العمل' },
  { id: 'kw_labor_support', label: 'تسجيل دعم العمالة' },
  { id: 'all_completed',    label: '✅ تم إنجاز جميع الإجراءات', final: true },
];
const RECRUIT_SOURCES = { outside: ['استقدام من الخارج', 'من الخارج'], internal: ['نقل داخلي', 'نقل داخلي'], kuwaiti: ['عمالة وطنية', 'عمالة وطنية'] };
function recruitSourceLabel(src, short = false) { return t((RECRUIT_SOURCES[src] || RECRUIT_SOURCES.outside)[short ? 1 : 0]); }
const RECRUIT_STAGES_INTERNAL = [
  { id: 'employment_contract',       label: 'عقد العمل' },
  { id: 'sponsor_approval',          label: 'موافقة الكفيل' },
  { id: 'transfer_work_license',     label: 'نقل أو إصدار إذن العمل' },
  { id: 'health_insurance_internal', label: 'إصدار الضمان الصحي' },
  { id: 'residency_issue_internal',  label: 'إصدار الإقامة' },
  { id: 'civil_id_renew',            label: 'تجديد البطاقة المدنية' },
  { id: 'all_completed',             label: '✅ تم إنجاز جميع الإجراءات', final: true },
];
const REJECTED_STAGE = { id: 'rejected', label: 'مرفوض', rejected: true };
// tierOf بيرجّع شريحة واحدة (للألوان وتوزيع لوحة المعلومات — band)، والفلاتر «خلال X يوم» تراكمية (TIER_WITHIN):
// «خلال 60 يوم» = المنتهي + اللي بينتهي لحد 60 يوم، مش من 31 لـ 60 بس
const TIERS = {
  expired: { label: 'منتهي',          cls: 't-expired' },
  d30:     { label: 'خلال 30 يوم',    cls: 't-d30' },
  d60:     { label: 'خلال 60 يوم',    cls: 't-d60', band: '31–60 يوم' },
  d90:     { label: 'خلال 90 يوم',    cls: 't-d90', band: '61–90 يوم' },
  ok:      { label: 'سارية',          cls: 't-ok' },
  none:    { label: 'بدون تاريخ',     cls: 't-none' },
};
// «خلال X يوم» بيجيب المنتهي كمان (كل اللي محتاج إجراء لحد X يوم). الفلتر فيه 30 / 60 / 90 بس (TIER_FILTERS)
const TIER_WITHIN = { d30: ['expired', 'd30'], d60: ['expired', 'd30', 'd60'], d90: ['expired', 'd30', 'd60', 'd90'] };
const TIER_FILTERS = ['d30', 'd60', 'd90'];
/** قيمة فلتر مستوى قديمة محفوظة ← الجديدة (soon / منتهي ← خلال 30، سارية / بدون تاريخ ← الكل) */
function tierFilterValue(v) { return TIER_FILTERS.includes(v) ? v : v === 'soon' || v === 'expired' ? 'd30' : ''; }
/** التاريخ ده جوّه فلتر المستوى؟ (منتهي / خلال 30 / 60 / 90 يوم تراكمي / سارية / بدون تاريخ / منتهي أو خلال 30) */
function tierIn(date, tier) { return (TIER_WITHIN[tier] || [tier]).includes(tierOf(date)); }
const EMP_DATE_FIELDS = [
  { key: 'residencyExp',      label: 'الإقامة' },
  { key: 'workPermitExp',     label: 'إذن العمل' },
  { key: 'passportExp',       label: 'الجواز' },
  { key: 'healthCardExp',     label: 'البطاقة الصحية' },
  { key: 'drivingLicenseExp', label: 'رخصة القيادة', driverOnly: true },
];

/* ---------- localStorage (القسم 10) ---------- */
function lsGet(k, def = null) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch (e) { return def; } }
function lsSet(k, v) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function lsJson(k, def) { try { return JSON.parse(lsGet(k)) ?? def; } catch (e) { return def; } }

/* ---------- أدوات مساعدة ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const esc = escapeHtml;
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const m2 = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1]);
  return null;
}
function toISO(d) { return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : ''; }
function addDays(s, n) { const d = parseDate(s); if (!d) return null; d.setDate(d.getDate() + n); return toISO(d); }
function addYears(s, n) { const d = parseDate(s) || new Date(); d.setFullYear(d.getFullYear() + n); return toISO(d); }
function daysUntil(s) {
  const d = parseDate(s); if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}
function tierOf(s) {
  const n = daysUntil(s);
  if (n === null) return 'none';
  if (n < 0) return 'expired';
  if (n <= 30) return 'd30';
  if (n <= 60) return 'd60';
  if (n <= 90) return 'd90';
  return 'ok';
}
function fmtDate(s) { const d = parseDate(s); return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear() : ''; }
function fmtDateTime(s) { if (!s) return ''; const [d, t] = String(s).split('T'); return fmtDate(d) + (t ? ' ' + t.slice(0, 5) : ''); }
function daysText(n) {
  if (n === null) return '';
  if (n < 0) return t('منتهي منذ') + ' ' + (-n) + ' ' + t('يوم');
  if (n === 0) return t('ينتهي اليوم');
  return t('متبقي') + ' ' + n + ' ' + t('يوم');
}
function datePill(s) {
  if (!s) return `<span class="pill t-none">—</span>`;
  const tr = tierOf(s);
  return `<span class="pill ${TIERS[tr].cls}" title="${esc(daysText(daysUntil(s)))}">${fmtDate(s)}</span>`;
}
function fmtMoney(v) { if (v === null || v === undefined || v === '') return '—'; const n = Number(v); return isNaN(n) ? v : n.toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' ' + t('د.ك'); }
function statusPill(s) { const st = EMP_STATUS_LABELS[s] || EMP_STATUS_LABELS.active; return `<span class="pill s-${esc(s || 'active')}">${esc(LANG === 'en' ? st.en : st.ar)}</span>`; }
function govStageInfo(id) { return GOV_STAGES.find(g => g.id === id); }
function govStagePill(id) { const g = govStageInfo(id); return g ? `<span class="chip">${g.dot} ${esc(t(g.label))}</span>` : '<span class="muted">—</span>'; }
function norm(s) { return String(s ?? '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').trim(); }
function initials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join(''); }
function uniq(a) { return Array.from(new Set(a.filter(x => x !== null && x !== undefined && x !== ''))); }
/** قيمة فلتر ← قائمة ('' = فاضية، نص = عنصر واحد — توافق مع الفلاتر القديمة المحفوظة) */
function asList(v) { return Array.isArray(v) ? v.filter(x => x !== '' && x !== null && x !== undefined) : (v === '' || v === null || v === undefined ? [] : [v]); }
function sum(a) { return a.reduce((x, y) => x + (Number(y) || 0), 0); }
function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }

/* ---------- الفهارس والاستعلامات ---------- */
function buildIndex() {
  IDX = {
    company: Object.fromEntries(STATE.companies.map(c => [c.id, c])),
    project: Object.fromEntries(STATE.projects.map(p => [p.id, p])),
    employee: Object.fromEntries(STATE.employees.map(e => [e.id, e])),
    vehicle: Object.fromEntries(STATE.vehicles.map(v => [v.id, v])),
    candidate: Object.fromEntries(STATE.candidates.map(c => [c.id, c])),
    template: Object.fromEntries(STATE.templates.map(x => [x.id, x])),
    permitType: Object.fromEntries((STATE.permitTypes || []).map(x => [x.id, x])),
    permitPlace: Object.fromEntries((STATE.permitPlaces || []).map(x => [x.id, x])),
    permitsOf: { employee: {}, vehicle: {} },          // تصاريح كل موظف / عربية
    // بيانات أصحاب التصاريح (من مركز الموظفين والسيارات — للعرض بس في قسم التصاريح)
    permitHolder: {
      employee: Object.fromEntries(((STATE.permitHolders || {}).employees || []).map(x => [x.id, x])),
      vehicle: Object.fromEntries(((STATE.permitHolders || {}).vehicles || []).map(x => [x.id, x])),
    },
  };
  for (const p of STATE.permits || []) (IDX.permitsOf[p.holderKind][p.holderKind === 'employee' ? p.employeeId : p.vehicleId] ||= []).push(p);
}
function companyName(id) { const c = IDX.company[id]; return c ? (LANG === 'en' && c.nameEn ? c.nameEn : c.nameAr) : ''; }
function projectName(id) { const p = IDX.project[id]; return p ? (LANG === 'en' && p.nameEn ? p.nameEn : p.nameAr) : ''; }
function empName(e) { return e ? (LANG === 'en' && e.nameEn ? e.nameEn : e.name) : ''; }
/* ترجمة البيانات للإنجليزي: الجنسية والمهنة من القاموس (value_i18n.py + «🌐 ترجمة الجنسيات والمهن»)، ومركز التكلفة باسمه الإنجليزي */
let VT_CACHE = null;
function vtMap(kind) {
  const src = (STATE && STATE.valueTranslations) || {};
  if (!VT_CACHE || VT_CACHE.src !== src) VT_CACHE = { src, m: {} };
  if (!VT_CACHE.m[kind]) { const m = {}; Object.entries(src[kind] || {}).forEach(([ar, en]) => { if (en) m[norm(ar)] = en; }); VT_CACHE.m[kind] = m; }
  return VT_CACHE.m[kind];
}
/** الترجمة الإنجليزية للقيمة أو null لو مالهاش */
function vtFind(kind, v) { return v ? vtMap(kind)[norm(v)] || (window.I18N || {})[String(v).trim()] || null : null; }
function vt(kind, v) { return LANG === 'en' && v ? vtFind(kind, v) || v : v; }
function natLabel(v) { return vt('nationality', v); }
function profLabel(v) { return vt('profession', v); }
/* ---------- الوكالات والعقود والمشاريع الحكومية ----------
   الموظف (والسيارة) ليه: الكفيل (الشركة) · العقد / المشروع المسجّل عليه ← وكالته · مكان الشغل الفعلي (مركز التكلفة).
   «برّه وكالة عقده» = مركز التكلفة مش من مراكز وكالة العقد (agencies.costCenterIds). */
const PROJECT_KINDS = { main: 'ترخيص رئيسي (أهلي)', gov: 'عقد حكومي' };
const VEHICLE_TYPES = { private: 'خصوصي', truck: 'شاحنة', pickup: 'شاحنة نصف', tanker: 'صهريج', bus: 'حافلة', motorcycle: 'دراجة نارية', equipment: 'معدات', other: 'أخرى' };
function agencyById(id) { return (STATE.agencies || []).find(a => a.id === id) || null; }
function agencyName(a) { return a ? (LANG === 'en' && a.nameEn ? a.nameEn : a.nameAr) : ''; }
function projectAgency(pid) { const p = IDX.project[pid]; return p && p.agencyId ? agencyById(p.agencyId) : null; }
function agencyCcNames(a) { return (a.costCenterIds || []).map(id => (STATE.costCenters.find(c => c.id === id) || {}).name).filter(Boolean); }
function outsideAgency(pid, cc) { const a = projectAgency(pid); return !!(a && cc && !agencyCcNames(a).includes(cc)); }
function empProjectId(e) { return primaryAff(e).projectId || null; }
function empOutsideAgency(e) { return outsideAgency(empProjectId(e), e.costCenter); }
function projectKindLabel(p) { return p && p.kind ? t(PROJECT_KINDS[p.kind]) : t('مشروع'); }
/** الترتيب: الترخيص الرئيسي، وبعدين العقود الحكومية بترتيب الوكالة، وبعدين الباقي */
function projectSortKey(p) { const a = p.agencyId ? agencyById(p.agencyId) : null; return `${p.kind === 'main' ? 0 : p.kind === 'gov' ? 1 : 2}|${String((a && a.position) || 0).padStart(3, '0')}|${projectName(p.id)}`; }
/** «عقد حكومي · Superior · رقم العقد 19053598» */
function projectSummary(p) {
  if (!p) return '';
  const a = p.agencyId && agencyById(p.agencyId);
  return [projectKindLabel(p), a && agencyName(a), p.contractNo && `${t('رقم العقد')} ${p.contractNo}`].filter(Boolean).join(' · ');
}
/** الإقامة / إذن العمل (أو تأمين العربية / دفترها) بعد نهاية العقد المسجّل عليه */
function beyondLicense(obj, pid, keys) {
  const p = IDX.project[pid];
  return p && p.expiryDate ? keys.filter(k => obj[k] && obj[k] > p.expiryDate) : [];
}
/** الجنسية / المهنة بلغة العرض: خانة «الجنسية (إنجليزي)» / «المهنة (إنجليزي)» في البطاقة الأول، وبعدين القاموس */
function personNat(p) { return LANG === 'en' && p && p.nationalityEn ? p.nationalityEn : natLabel(p && p.nationality); }
function personProf(p) { return LANG === 'en' && p && p.professionEn ? p.professionEn : profLabel(p && p.profession); }
function ccLabel(name) {
  if (!name || LANG !== 'en') return name;
  const c = (STATE.costCenters || []).find(x => x.name === name);
  return (c && c.nameEn) || name;
}
/** تنفيذ fn بلغة تانية (تقرير إنجليزي والبرنامج شغال عربي أو العكس) — كل الترجمة (t، الأسماء، الجنسيات…) بتمشي عليها */
function withLang(lang, fn) {
  const old = LANG;
  LANG = lang === 'en' ? 'en' : 'ar';
  try { return fn(); } finally { LANG = old; }
}
function primaryAff(e) { return (e.affiliations && e.affiliations[0]) || {}; }
function empCompanyId(e) { return primaryAff(e).companyId || null; }
function isReadOnly() { return !!(STATE && STATE.me && STATE.me.readOnly); }

/* ---------- الصلاحيات (من السيرفر — هو اللي بيفرضها، والواجهة بتخفي بس) ----------
   can('employees.edit') · أي عنصر عليه data-p="مفتاح [مفتاح…]" بيختفي لو أي مفتاح منهم مش مسموح.
   scope.all = نطاق كل الشركات. */
const PERM_KEYS = [
  ...['employees', 'companies', 'vehicles', 'costcenters', 'recruitment', 'permits'].flatMap(m => ['view', 'edit', 'delete'].map(a => `${m}.${a}`)),
  'contract.view', 'contract.edit', 'companylog.view',
  'sensitive.salary', 'sensitive.bank', 'sensitive.documents', 'system.import', 'system.backup', 'contract.sign', 'scope.all', 'admin',
];
const VIEW_PERM = { employees: 'employees.view', companies: 'companies.view|costcenters.view', vehicles: 'vehicles.view',
  contract: 'contract.view employees.view sensitive.salary', recruitment: 'recruitment.view', companylog: 'companylog.view',
  custody: 'custody.view', permits: 'permits.view' };
function can(key) {
  const m = STATE && STATE.me;
  if (!m) return false;
  if (key === 'scope.all') return !!m.allCompanies;
  if (key === 'admin') return !!m.isAdmin;
  return !!(m.isAdmin || (m.perms || []).includes(key));
}
function canAll(keys) { return keys.split(/\s+/).every(can); }
/** حقل حساس مخفي عن المستخدم الحالي؟ kind = employee | candidate */
function hiddenField(kind, f) { return !!(STATE && STATE.me && ((STATE.me.hiddenFields || {})[kind] || []).includes(f)); }
/** VIEW_PERM: «أ ب» = الاتنين، «أ|ب» = أي واحد فيهم */
function viewAllowed(id) { return !VIEW_PERM[id] || VIEW_PERM[id].split('|').some(canAll); }
function applyPermStyles() {
  let st = document.getElementById('perm-style');
  if (!st) { st = document.createElement('style'); st.id = 'perm-style'; document.head.appendChild(st); }
  st.textContent = PERM_KEYS.filter(k => !can(k)).map(k => `[data-p~="${k}"]`).join(',') + (PERM_KEYS.some(k => !can(k)) ? '{display:none !important}' : '');
}

/* ---------- إعدادات العرض (لهذا المتصفح بس — تفضيل شخصي، مش صلاحية) ---------- */
function loadViewPerms() { return lsJson('mv_viewPerms', { hidden: [] }); }
function saveViewPerms(p) { lsSet('mv_viewPerms', JSON.stringify({ hidden: p.hidden || [] })); }
// نطاق الشركات بقى على السيرفر: STATE فيه بس الموظفين المسموحين. الشركات/المشاريع اللي عليها outOfScope
// جاية بالاسم بس (الشركة المسجّل عليها موظف ظاهر عن طريق مركز التكلفة) ← للعرض، مش للاختيار.
function companyInScope(cid) { const c = cid && IDX.company[cid]; return !c || !c.outOfScope; }
function scopedEmployees() { return STATE.employees; }
function scopedCompanies() { return STATE.companies.filter(c => !c.outOfScope); }
function scopedProjects() { return STATE.projects.filter(p => !p.outOfScope); }
/* ---------- التوقيعات (واحد لكل رقم مدني: مفوّض أو موظف) ---------- */
function hasSignature(civilId) { return !!(civilId && STATE.signatures && STATE.signatures[civilId]); }
function signatureChip(civilId) {
  return hasSignature(civilId) ? `<span class="chip on" title="${esc(t('التوقيع مرفوع'))}">✍️ ✓</span>` : `<span class="chip" title="${esc(t('مفيش توقيع مرفوع'))}">✍️ —</span>`;
}
/** نافذة التوقيع: عرض + رفع/تغيير + حذف. canWrite = صلاحية التعديل على الشخص ده */
function openSignatureModal(civilId, name, canWrite) {
  if (!civilId) return openBlockAlert(t('سجّل الرقم المدني الأول'));
  const has = hasSignature(civilId);
  const m = openModal({
    title: '✍️ ' + t('التوقيع') + ': ' + esc(name || civilId), size: 'narrow',
    body: `<div class="notice">${t('التوقيع بيتحفظ مرة واحدة لكل رقم مدني، وبيتحط في العقود لو اخترت «بتوقيع» وقت الطباعة.')}</div>
      <div class="sig-box">${has ? `<img src="${esc(STATE.signatures[civilId].url)}?t=${encodeURIComponent(STATE.signatures[civilId].uploadedAt || '')}" alt="">` : `<span class="muted">${t('مفيش توقيع مرفوع')}</span>`}</div>
      ${has ? `<div class="small muted" style="margin-top:6px">${t('آخر رفع')}: ${fmtDateTime(STATE.signatures[civilId].uploadedAt)}</div>` : ''}
      <p class="small muted">${t('الأفضل صورة PNG بخلفية شفافة أو بيضاء، التوقيع واضح وممسوح حواليه (أقل من 3MB).')}</p>`,
    foot: `${canWrite ? `<button class="btn primary" data-up>📤 ${has ? t('تغيير التوقيع') : t('رفع التوقيع')}</button>${has ? `<button class="btn danger" data-del>🗑️ ${t('حذف')}</button>` : ''}` : ''}
      <span class="spacer"></span><button class="btn" data-close>إغلاق</button>`,
  });
  const up = $('[data-up]', m.el), del = $('[data-del]', m.el);
  if (up) up.onclick = async () => {
    const f = await pickFile('image/png,image/jpeg');
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { await persist('POST', '/api/signatures/' + encodeURIComponent(civilId), fd, 'تم رفع التوقيع'); m.close(); openSignatureModal(civilId, name, canWrite); } catch (_) {}
  };
  if (del) del.onclick = async () => {
    if (!await openConfirm(t('حذف التوقيع؟'), { danger: true })) return;
    try { await persist('DELETE', '/api/signatures/' + encodeURIComponent(civilId), undefined, 'تم الحذف'); m.close(); } catch (_) {}
  };
}

/** الشركة الفعلية لمركز تكلفة (بالاسم) */
function costCenterCompanyId(name) { const c = name && STATE.costCenters.find(x => x.name === name); return (c && c.companyId) || null; }
/** الموظف تابع للشركة: مسجّل عليها أو على مركز تكلفة تابع لها */
function empInCompany(e, cid) { return (e.affiliations || []).some(a => a.companyId === cid) || costCenterCompanyId(e.costCenter) === cid; }
/** ارتباط الموظف بشركة: 'company' = مسجّل عليها، 'cc' = تابع لها بمركز التكلفة بس، null = مالوش علاقة.
    من غير شركة: 'cc' لو شركة مركز التكلفة غير الشركة المسجّل عليها، وإلا 'company'. */
function empLink(e, cid) {
  const ccCo = costCenterCompanyId(e.costCenter);
  const reg = (e.affiliations || []).some(a => a.companyId === (cid || ccCo));
  if (cid) return reg ? 'company' : (ccCo === cid ? 'cc' : null);
  return ccCo && !reg ? 'cc' : 'company';
}
const EMP_LINKS = { company: { ico: '🏢', label: 'على الشركة' }, cc: { ico: '🏭', label: 'على مركز التكلفة' } };
function empLinkChip(link) {
  if (!link) return '';
  const x = EMP_LINKS[link];
  return `<span class="chip" style="${link === 'cc' ? 'background:var(--orange-soft);color:var(--orange)' : 'background:var(--primary-soft);color:var(--primary)'}">${x.ico} ${esc(t(x.label))}</span>`;
}
function applyNavVisibility() {
  const hidden = loadViewPerms().hidden || [];
  $$('#navrail button[data-view]').forEach(b => { b.hidden = hidden.includes(b.dataset.view) || !viewAllowed(b.dataset.view); });
  if (hidden.includes(VIEW) || !viewAllowed(VIEW)) setView('dashboard');
}

/* ---------- API ---------- */
/* مؤشر «جاري التنفيذ»: شريط أعلى الصفحة طول ما فيه طلب شغّال (بيظهر بعد لحظة عشان الطلبات السريعة ماتعملش وميض) */
let BUSY = 0;
function setBusy(d) { BUSY = Math.max(0, BUSY + d); document.body.classList.toggle('busy', BUSY > 0); }
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  setBusy(1);
  try {
    const r = await fetch(url, opt);
    if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.mustChangePassword) openForcedPasswordModal();       // كلمة سر افتراضية / ضعيفة ← لازم تتغيّر الأول
      const e = new Error(j.error || r.statusText); e.data = j; e.status = r.status; throw e;
    }
    return j;
  } catch (e) {
    if (e instanceof TypeError) e.message = t('تعذّر الاتصال بالسيرفر — تأكد إن البرنامج شغّال والشبكة متصلة');
    throw e;
  } finally { setBusy(-1); }
}
/** persist(): تنفيذ تعديل على السيرفر ثم إعادة تحميل الحالة وإعادة العرض.
 *  الضغط على «حفظ» كذا مرة وهو لسه شغّال مابيبعتش الطلب تاني (نفس الطلب ← نفس النتيجة)، والزرار بيتقفل لحد ما يخلص. */
const IN_FLIGHT = new Map();
function persist(method, url, body, okMsg) {
  const key = body instanceof FormData ? null : `${method} ${url} ${JSON.stringify(body === undefined ? null : body)}`;
  if (key && IN_FLIGHT.has(key)) return IN_FLIGHT.get(key);
  const ae = document.activeElement;
  const btn = ae && ae.tagName === 'BUTTON' && !ae.disabled ? ae : null;
  if (btn) btn.disabled = true;
  const run = (async () => {
    let res;
    try { res = await api(method, url, body); }
    catch (e) { if (!(e.status === 409 && e.data && e.data.warn)) toast(e.message, 'err'); throw e; }
    if (okMsg) toast(okMsg, 'ok');
    // الحفظ تم خلاص؛ لو تحديث الشاشة فشل مانقولش «فشل الحفظ»
    try { await reload(); } catch (e) { toast('تم الحفظ، لكن تعذّر تحديث الشاشة — اضغط F5', 'err'); }
    return res;
  })().finally(() => { if (key) IN_FLIGHT.delete(key); if (btn) btn.disabled = false; });
  if (key) IN_FLIGHT.set(key, run);
  return run;
}
/** كلمة السر الافتراضية أو الضعيفة: نافذة مابتتقفلش لحد ما تتغيّر (السيرفر كمان مانع أي عملية تانية) */
function openForcedPasswordModal() {
  if ($('#force-pw')) return;
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'force-pw';
  ov.innerHTML = `<div class="modal narrow" role="dialog"><div class="modal-head"><h2>🔒 ${t('لازم تغيّر كلمة السر')}</h2></div>
    <div class="modal-body"><div class="notice warn">${t('كلمة السر الحالية افتراضية أو سهلة جدًا. غيّرها عشان تكمّل: 8 حروف على الأقل، ومش زي اسم المستخدم.')}</div>
      <div class="form" style="margin-top:10px"><label class="full">${t('كلمة المرور الحالية')}<input type="password" name="old" autocomplete="current-password"></label>
      <label class="full">${t('كلمة المرور الجديدة')}<input type="password" name="new" autocomplete="new-password" minlength="8"></label>
      <label class="full">${t('تأكيد كلمة المرور الجديدة')}<input type="password" name="confirm" autocomplete="new-password" minlength="8"></label></div></div>
    <div class="modal-foot"><button class="btn primary" data-save>${t('حفظ وكمّل')}</button><span class="spacer"></span><button class="btn" data-logout>🚪 ${t('تسجيل الخروج')}</button></div></div>`;
  $('#modal-root').appendChild(ov);
  translateDomText(ov);
  $('[name=old]', ov).focus();
  $('[data-logout]', ov).onclick = () => { location.href = '/logout'; };
  $('[data-save]', ov).onclick = async () => {
    const d = formValues(ov);
    if (!d.new || d.new.length < 8) return openBlockAlert(t('كلمة المرور لازم 8 أحرف على الأقل'));
    if (d.new !== d.confirm) return openBlockAlert(t('كلمة المرور الجديدة وتأكيدها مش زي بعض'));
    try {
      await api('POST', '/api/me/password', { old: d.old, new: d.new });
      ov.remove();
      toast('تم تغيير كلمة المرور', 'ok');
      await reload();
    } catch (e) { openBlockAlert(e.message); }
  };
}
async function reload(noRender) {
  STATE = await api('GET', '/api/state');
  buildIndex();
  applyPermStyles();
  document.body.classList.toggle('readonly', isReadOnly());
  $('#user-name').textContent = STATE.me.displayName || STATE.me.username;
  if (!noRender) render();
  if (STATE.me.mustChangePassword) openForcedPasswordModal();
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = t(msg);
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

/* ---------- النوافذ ---------- */
function openModal({ title, body, foot = '', size = '', onClose }) {
  const root = $('#modal-root');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${size}" role="dialog">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost" data-close>✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  root.appendChild(ov);
  const close = () => { ov.remove(); onClose && onClose(); };
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  ov.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  translateDomText(ov);
  return { el: ov.querySelector('.modal'), close };
}
function closeAllModals() { $('#modal-root').innerHTML = ''; }
function openConfirm(message, { okLabel = 'تأكيد', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title: t('تأكيد'), size: 'narrow', body: `<div style="white-space:pre-line">${message}</div>`,
      foot: `<button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(okLabel)}</button><button class="btn" data-close>إلغاء</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
  });
}
function openBlockAlert(message) {
  openModal({ title: '⛔ ' + t('غير مسموح'), size: 'narrow', body: `<div class="notice err">${esc(message)}</div>`, foot: '<button class="btn primary" data-close>حسنًا</button>' });
}

/** جمع قيم النموذج */
function formValues(root) {
  const o = {};
  root.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else if (el.type === 'file') return;
    else o[el.name] = el.value.trim() === '' ? null : el.value.trim();
  });
  return o;
}
function opt(value, label, selected) { return `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`; }
function companyOptions(sel, blank = '— اختر الشركة —') {
  return opt('', t(blank), !sel) + scopedCompanies().map(c => opt(c.id, companyName(c.id), c.id === sel)).join('');
}
function projectOptions(companyId, sel, blank = '— بدون مشروع —') {
  return opt('', t(blank), !sel) + scopedProjects().filter(p => !companyId || p.companyId === companyId).map(p => opt(p.id, projectName(p.id), p.id === sel)).join('');
}
function costCenterOptions(sel, blank = '— بدون —') {
  return opt('', t(blank), !sel) + STATE.costCenters.map(c => opt(c.name, LANG === 'en' && c.nameEn ? c.nameEn : c.name, c.name === sel)).join('');
}
function pickFile(accept) {
  return new Promise(resolve => {
    const inp = $('#hidden-file');
    inp.value = ''; inp.accept = accept || '';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
/* ---------- مفيش تنزيل ملفات: معاينة وطباعة بس ----------
   تصدير CSV لمدير النظام بس، وبكلمة سر التصدير (بيحددها من قايمة المستخدم) — السيرفر بيتأكد منها وبيسجّل. */
async function exportGuard(what, fn) {
  if (!can('admin')) return toast(t('التصدير لمدير النظام بس'), 'err');
  if (!STATE.exportPasswordSet) return openBlockAlert(t('حدد كلمة سر التصدير الأول: قايمة المستخدم ← «🔑 كلمة سر التصدير».'));
  const m = openModal({
    title: '📤 ' + t('تصدير') + ': ' + esc(what), size: 'narrow',
    body: `<div class="form"><label class="full">${t('كلمة سر التصدير')}<input type="password" name="password" autocomplete="off"></label></div>
      <div class="small muted" style="margin-top:6px">${t('التصدير بيتسجّل في سجل التدقيق.')}</div>`,
    foot: `<button class="btn primary" data-go>📤 ${t('تصدير')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const inp = $('[name=password]', m.el), go = $('[data-go]', m.el);
  inp.focus();
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') go.click(); });
  go.onclick = async () => {
    go.disabled = true;
    try { await api('POST', '/api/export/verify', { password: inp.value, what }); m.close(); fn(); }
    catch (e) { toast(e.message, 'err'); go.disabled = false; inp.select(); }
  };
}
function openExportPasswordModal() {
  const set = !!STATE.exportPasswordSet;
  const m = openModal({
    title: '🔑 ' + t('كلمة سر التصدير'), size: 'narrow',
    body: `<div class="notice small" style="margin-bottom:8px">${t('تصدير الملفات (CSV) لمدير النظام بس، وكل مرة بيطلب كلمة السر دي. غير كلمة سر الدخول.')}</div>
      <form class="form" id="xp-form" autocomplete="off">
        ${set ? `<label class="full"><span class="req">${t('كلمة السر الحالية')}</span><input type="password" name="old" autocomplete="off"></label>` : ''}
        <label class="full"><span class="req">${t('كلمة السر الجديدة')}</span><input type="password" name="password" minlength="6" autocomplete="new-password"></label>
        <label class="full"><span class="req">${t('تأكيد كلمة السر')}</span><input type="password" name="confirm" autocomplete="new-password"></label></form>`,
    foot: `<button class="btn primary" data-save>💾 ${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues($('#xp-form', m.el));
    if (!d.password || d.password.length < 6) return openBlockAlert(t('كلمة السر لازم 6 حروف على الأقل'));
    if (d.password !== d.confirm) return openBlockAlert(t('كلمة السر وتأكيدها مش زي بعض'));
    try { await persist('PUT', '/api/export-password', { old: d.old || '', password: d.password }, 'تم الحفظ'); m.close(); } catch (e) { /* ظاهر */ }
  };
}
/** الطباعة من المعاينة بتتسجّل (kind = custody | employee | candidate ← نوعها في سجل التدقيق) */
function printLog(what, kind) { api('POST', '/api/audit/print', { what, kind }).catch(() => {}); }
/** عرض مرفق جوّه البرنامج (صورة أو PDF) من غير تنزيل */
function openFileViewer(url, name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const img = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext), pdf = ext === 'pdf';
  const m = openModal({
    title: '👁️ ' + esc(name), size: 'wide',
    body: img ? `<div style="text-align:center"><img src="${esc(url)}" alt="" style="max-width:100%;max-height:75vh"></div>`
      : pdf ? `<iframe class="pdf-frame" src="${esc(url)}#toolbar=0&navpanes=0" title="PDF"></iframe>`
      : `<div class="notice">${t('الملف ده مايتعرضش جوّه البرنامج (صور و PDF بس). التنزيل مقفول.')}</div>`,
    foot: `${img || pdf ? `<button class="btn primary" data-print>🖨️ ${t('طباعة')}</button>` : ''}<span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const p = $('[data-print]', m.el);
  if (p) p.onclick = () => {
    printLog(name, 'employee');
    if (pdf) { const fr = $('iframe', m.el); try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (_) { /* */ } return; }
    printHtml(name, `<div style="text-align:center"><img src="${esc(location.origin + url)}" style="max-width:100%"></div>`);
  };
}
function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
}
function printHtml(title, html) {
  const w = window.open('', '_blank');
  if (!w) { toast('المتصفح منع نافذة الطباعة', 'err'); return; }
  const dir = LANG === 'en' ? 'ltr' : 'rtl';
  w.document.write(`<!DOCTYPE html><html dir="${dir}" lang="${LANG}"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;font-size:12px;padding:18px;color:#111}
  h1{font-size:18px;margin:0 0 4px}.muted{color:#666}table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border:1px solid #bbb;padding:4px 6px;text-align:start}th{background:#eef2f0}
  .pill{padding:0 6px;border-radius:8px}.t-expired{background:#fbe7e5;color:#c0392b}.t-d30{background:#fdeede;color:#d9730d}.t-d60{background:#fbf3d6}.t-d90{background:#e2f3e9}
  @page{size:A4 landscape;margin:12mm}</style></head><body>${html}
  <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}

/* ---------- قائمة اختيار متعدد (الفلاتر) ----------
   msField(key, title, allLabel, options, selected) ← زرار («الجنسية: مصر +2») بيفتح قائمة فيها بحث وعلامات.
   msBind(root, onChange) بيربط الأزرار: onChange(key, [القيم]) مع كل علامة، والقائمة بتفضل مفتوحة حتى لو الشاشة
   اترسمت تاني. options = [{ v, l, n? }] (n = العدد جنب الاختيار). */
const MS = { reg: {}, open: null, q: '', scroll: 0 };
function msField(key, title, allLabel, options, selected) {
  MS.reg[key] = Object.assign(MS.reg[key] || {}, { title, allLabel, options, selected: asList(selected) });
  return `<div class="ms ${MS.reg[key].selected.length ? 'on' : ''}" data-ms="${esc(key)}"><button type="button" class="ms-btn">${msText(key)}</button></div>`;
}
function msText(key) {
  const r = MS.reg[key], sel = r.selected;
  if (!sel.length) return `<span class="ms-val">${esc(t(r.allLabel))}</span><i class="ms-caret">▾</i>`;
  const first = (r.options.find(o => o.v === sel[0]) || { l: sel[0] }).l;
  return `<span class="ms-val"><small>${esc(t(r.title))}:</small> ${esc(first)}</span>${sel.length > 1 ? `<b class="ms-more">+${sel.length - 1}</b>` : ''}<i class="ms-caret">▾</i>`;
}
function msRefresh(key) {
  $$(`[data-ms="${CSS.escape(key)}"]`).forEach(el => { el.classList.toggle('on', MS.reg[key].selected.length > 0); $('.ms-btn', el).innerHTML = msText(key); });
}
function msClose() {
  const pop = $('.ms-pop');
  if (pop) pop.remove();
  MS.open = null; MS.q = ''; MS.scroll = 0;
}
function msOpen(el) {
  const key = el.dataset.ms, r = MS.reg[key];
  const old = $('.ms-pop');
  if (old) { MS.scroll = ($('.ms-list', old) || {}).scrollTop || 0; old.remove(); }
  MS.open = key;
  const pop = document.createElement('div');
  pop.className = 'ms-pop'; pop.dir = document.documentElement.dir;
  pop.innerHTML = `${r.options.length > 7 ? `<input type="search" class="ms-q" placeholder="${esc(t('بحث…'))}" value="${esc(MS.q)}">` : ''}
    <div class="ms-acts"><button type="button" data-ms-all>✓ ${esc(t('الكل'))}</button><button type="button" data-ms-none>✕ ${esc(t('مسح'))}</button><span class="ms-n"></span></div>
    <div class="ms-list">${r.options.map(o => `<label data-l="${esc(norm(o.l + ' ' + o.v))}"><input type="checkbox" value="${esc(o.v)}" ${r.selected.includes(o.v) ? 'checked' : ''}><span>${esc(o.l)}</span>${o.n != null ? `<b class="num">${o.n}</b>` : ''}</label>`).join('') || `<div class="empty">${esc(t('لا توجد نتائج'))}</div>`}</div>`;
  document.body.appendChild(pop);
  const list = $('.ms-list', pop), q = $('.ms-q', pop);
  const filter = () => { const v = norm(MS.q); $$('label', list).forEach(l => { l.hidden = !!v && !l.dataset.l.includes(v); }); };
  const count = () => { $('.ms-n', pop).textContent = r.selected.length ? `${r.selected.length} ${t('محدد')}` : ''; };
  const apply = sel => { r.selected = sel; msRefresh(key); count(); if (r.on) r.on(key, sel.slice()); };
  list.addEventListener('change', () => apply($$('input', list).filter(x => x.checked).map(x => x.value)));
  $('[data-ms-all]', pop).onclick = () => { $$('label:not([hidden]) input', list).forEach(x => { x.checked = true; }); apply($$('input', list).filter(x => x.checked).map(x => x.value)); };
  $('[data-ms-none]', pop).onclick = () => { $$('input', list).forEach(x => { x.checked = false; }); apply([]); };
  if (q) q.addEventListener('input', () => { MS.q = q.value; filter(); });
  filter(); count();
  msPlace(pop, el);
  list.scrollTop = MS.scroll;
  if (q && document.activeElement !== q && MS.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
/** المكان: تحت الزرار (أو فوقه لو مفيش مساحة)، ومحاذي لبدايته حسب اتجاه الصفحة */
function msPlace(pop, el) {
  const b = el.getBoundingClientRect(), w = Math.max(b.width, 270);
  pop.style.width = w + 'px';
  const h = pop.offsetHeight, below = innerHeight - b.bottom - 8;
  pop.style.top = (below >= h || b.top < h ? b.bottom + 4 : b.top - h - 4) + 'px';
  const x = document.documentElement.dir === 'rtl' ? b.right - w : b.left;
  pop.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + 'px';
}
function msBind(root, onChange) {
  $$('[data-ms]', root).forEach(el => {
    const key = el.dataset.ms;
    MS.reg[key].on = onChange;
    $('.ms-btn', el).onclick = ev => { ev.stopPropagation(); if (MS.open === key && $('.ms-pop')) msClose(); else { MS.q = ''; MS.scroll = 0; msOpen(el); } };
    if (MS.open === key) msOpen(el);                 // الشاشة اترسمت تاني والقائمة كانت مفتوحة
  });
}
document.addEventListener('mousedown', ev => { if (MS.open && !ev.target.closest('.ms-pop, [data-ms]')) msClose(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && MS.open) { ev.stopPropagation(); msClose(); } }, true);
// الصفحة اتحركت أو اتغيّر مقاسها (زي كيبورد الموبايل) ← القائمة تمشي مع زرارها
function msFollow(ev) {
  if (!MS.open || (ev.target instanceof Element && ev.target.closest('.ms-pop'))) return;
  const pop = $('.ms-pop'), el = $(`[data-ms="${CSS.escape(MS.open)}"]`);
  if (pop && el) msPlace(pop, el); else msClose();
}
addEventListener('resize', msFollow);
addEventListener('scroll', msFollow, true);

/* ---------- التقارير المطبوعة (شكل ERP) ----------
   رأس: شعار الشركة واسمها + عنوان التقرير + بيانات الطباعة، وبعدين المعايير والملخص والجدول وخانات التوقيع.
   رأس الجدول بيتكرر في كل صفحة، وترقيم «صفحة X من Y» في هامش الصفحة (@page). */
const REPORT_CSS = `
  :root{--ink:#1d2623;--muted:#66736f;--line:#d3dbd8;--head:#1f4d40;--band:#f1f5f3;--zebra:#f8faf9}
  *{box-sizing:border-box} html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{margin:0;font-family:"IBM Plex Sans Arabic","Cairo","Segoe UI",Tahoma,sans-serif;font-size:10.5px;color:var(--ink);background:#e7ecea}
  .toolbar{position:sticky;top:0;z-index:5;display:flex;gap:8px;align-items:center;padding:8px 16px;background:#163f32;color:#fff;font-size:13px}
  .toolbar button{font:inherit;border:0;border-radius:6px;padding:6px 14px;cursor:pointer;background:rgba(255,255,255,.14);color:#fff}
  .toolbar button.primary{background:#fff;color:#163f32;font-weight:600} .toolbar .sp{flex:1} .toolbar small{opacity:.75}
  .sheet{background:#fff;margin:14px auto;padding:12mm 10mm;box-shadow:0 2px 14px rgba(0,0,0,.14)}
  .sheet.land{width:297mm} .sheet.port{width:210mm}
  .rpt-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;padding-bottom:10px;border-bottom:2px solid var(--head)}
  .rpt-brand{display:flex;align-items:center;gap:10px;min-width:0}
  .rpt-brand img{height:54px;max-width:130px;object-fit:contain}
  .rpt-brand .mark{width:46px;height:46px;border-radius:8px;background:var(--head);color:#fff;display:grid;place-items:center;font-weight:800;font-size:20px}
  .rpt-brand .ar{font-size:14px;font-weight:700;line-height:1.3} .rpt-brand .en{font-size:9.5px;color:var(--muted);direction:ltr;unicode-bidi:plaintext}
  .rpt-title{text-align:center} .rpt-title h1{margin:0;font-size:18px} .rpt-title .sub{color:var(--muted);font-size:11px;margin-top:3px}
  .rpt-meta{justify-self:end;border-collapse:collapse;font-size:9.5px}
  .rpt-meta th{color:var(--muted);font-weight:500;text-align:start;padding:1px 0;padding-inline-end:10px;white-space:nowrap} .rpt-meta td{font-weight:600;padding:1px 0;white-space:nowrap}
  .rpt-criteria{margin:9px 0 8px;padding:6px 10px;background:var(--band);border-inline-start:3px solid var(--head);font-size:9.5px;line-height:1.6}
  .rpt-criteria b{color:var(--head)}
  .rpt-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin:0 0 10px}
  .rpt-summary div{border:1px solid var(--line);border-top:3px solid var(--head);border-radius:3px;padding:5px 9px}
  .rpt-summary b{display:block;font-size:15px;line-height:1.3} .rpt-summary span{color:var(--muted);font-size:9px}
  table.rpt{width:100%;border-collapse:collapse;font-size:9.8px}
  table.rpt thead th{background:var(--head);color:#fff;font-weight:600;text-align:center;padding:6px 5px;border:1px solid var(--head);vertical-align:middle}
  table.rpt td{padding:4px 5px;border:1px solid var(--line);vertical-align:middle;text-align:center}
  table.rpt tr{break-inside:avoid} table.rpt tr.z td{background:var(--zebra)}
  table.rpt td.num,table.rpt th.num{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap} table.rpt td.idx{color:var(--muted);width:28px}
  table.rpt td.txt,table.rpt th.txt{text-align:start;padding-inline:8px} table.rpt td.ltr{direction:ltr;text-align:left;padding-inline:8px}
  table.rpt tr.grp td{background:var(--band);font-weight:700;font-size:10.5px;padding:6px;border-top:1.5px solid var(--head);text-align:start}
  table.rpt tr.grp img{height:18px;max-width:40px;object-fit:contain;vertical-align:middle;margin-inline-end:6px}
  table.rpt tr.grp small{color:var(--muted);font-weight:500;margin-inline-start:6px}
  table.rpt tr.sub td{font-weight:600;background:#fbfcfb;border-bottom:1.5px solid var(--line)}
  table.rpt tfoot td{font-weight:700;background:var(--band);border-top:2px solid var(--head);padding:6px 5px}
  .pill{display:inline-block;padding:0 5px;border-radius:3px;white-space:nowrap}
  .t-expired{background:#fbe7e5;color:#b3261e}.t-d30{background:#fdeede;color:#b35c00}.t-d60{background:#fbf3d6;color:#7a5d00}.t-d90{background:#e2f3e9;color:#1e6b43}.t-ok,.t-none{background:none;color:inherit}
  .rpt-sign{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:30px;break-inside:avoid}
  .rpt-sign div{border-top:1px solid var(--ink);padding-top:4px;text-align:center;font-size:9.5px;color:var(--muted)}
  .rpt-end{text-align:center;color:var(--muted);font-size:8.5px;margin-top:14px;letter-spacing:.3px}
  @media print{body{background:#fff}.no-print{display:none!important}.sheet,.sheet.land,.sheet.port{margin:0;padding:0;box-shadow:none;width:auto;max-width:100%}
    table.rpt{width:100%;max-width:100%}}`;
/** CSS string آمن لـ content: في @page */
function cssStr(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"'; }
/**
 * معاينة طباعة تقرير في نافذة جديدة (فيها زرار طباعة).
 * company = شركة واحدة (شعارها واسمها في الرأس) أو null (اسم المجموعة). meta = [[العنوان، القيمة]].
 * summary = [[القيمة، الوصف]]. body = جدول/محتوى التقرير.
 */
function openReportWindow({ title, subtitle = '', company = null, meta = [], criteria = '', summary = [], body = '', sign = false, landscape = true }) {
  const w = window.open('', '_blank');
  if (!w) { toast('المتصفح منع نافذة الطباعة', 'err'); return; }
  const en = LANG === 'en', dir = en ? 'ltr' : 'rtl';
  const group = t(($('.brand small') || {}).textContent || 'Lunx');
  const brand = company
    ? `${company.logoUrl ? `<img src="${esc(location.origin + company.logoUrl)}" alt="">` : `<div class="mark">${esc((company.nameAr || '?').trim()[0])}</div>`}
       <div><div class="ar">${esc(en ? (company.nameEn || company.nameAr) : company.nameAr)}</div>${!en && company.nameEn ? `<div class="en">${esc(company.nameEn)}</div>` : ''}</div>`
    : `<div class="mark">${esc(group.trim()[0] || 'L')}</div><div><div class="ar">${esc(group)}</div><div class="en">${esc(t('كل الشركات'))}</div></div>`;
  const printed = `${fmtDate(todayISO())} ${new Date().toTimeString().slice(0, 5)}`;
  const pageNo = en ? `"Page " counter(page) " of " counter(pages)` : `"صفحة " counter(page) " من " counter(pages)`;
  const box = `font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;font-size:8pt;color:#66736f`;
  w.document.write(`<!DOCTYPE html><html dir="${dir}" lang="${LANG}"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">
    <style>${REPORT_CSS}
      @page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:11mm 9mm 13mm;
        @bottom-center{content:${pageNo};${box}}
        @bottom-${en ? 'left' : 'right'}{content:${cssStr(title + ' — ' + (company ? (en ? company.nameEn || company.nameAr : company.nameAr) : group))};${box}}
        @bottom-${en ? 'right' : 'left'}{content:${cssStr(printed)};${box}}}</style></head>
    <body><div class="toolbar no-print"><button class="primary" onclick="print()">🖨️ ${esc(t('طباعة'))}</button><button onclick="close()">${esc(t('إغلاق'))}</button>
      <span class="sp"></span><small>${esc(t('معاينة الطباعة'))} · A4 ${esc(t(landscape ? 'عرضي' : 'طولي'))}</small></div>
    <div class="sheet ${landscape ? 'land' : 'port'}">
      <header class="rpt-head"><div class="rpt-brand">${brand}</div>
        <div class="rpt-title"><h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div>
        <table class="rpt-meta">${[[t('تاريخ الطباعة'), printed], [t('أعده'), t((STATE.me && (STATE.me.displayName || STATE.me.username)) || '')], ...meta]
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></header>
      ${criteria ? `<div class="rpt-criteria"><b>${esc(t('معايير التقرير'))}:</b> ${criteria}</div>` : ''}
      ${summary.length ? `<div class="rpt-summary">${summary.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
      ${body}
      ${sign ? `<div class="rpt-sign">${(Array.isArray(sign) ? sign : [t('أعده'), t('راجعه'), t('اعتمده')]).map(x => `<div>${esc(x)}</div>`).join('')}</div>` : ''}
      <div class="rpt-end">— ${esc(t('نهاية التقرير'))} —</div></div></body></html>`);
  w.document.close();
}

/* =====================================================================
   THEME
   ===================================================================== */
function currentTheme() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  lsSet('mv_theme', next);
}

/* =====================================================================
   UI LANGUAGE — القاموس في i18n.js
   ===================================================================== */
let LANG = lsGet('mv_lang') === 'en' ? 'en' : 'ar';
function t(ar) {
  if (LANG !== 'en' || ar === null || ar === undefined) return ar;
  const s = String(ar);
  return (window.I18N && I18N[s.trim()]) || s;
}
function translateDomText(root) {
  if (LANG !== 'en' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentNode && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName)) || n.parentNode.closest('.contract-paper, [data-no-i18n]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue, key = raw.trim();
    if (!key || !/[؀-ۿ]/.test(key)) continue;
    if (I18N[key]) { n.nodeValue = raw.replace(key, I18N[key]); continue; }
    // ترجمة جزئية: رموز في البداية (⚪ 🟢 ✅ …) + نص معروف
    const rest = key.replace(/^[^\u0600-\u06FF]+/, '');
    if (I18N[rest]) { n.nodeValue = raw.replace(rest, I18N[rest]); continue; }
    const m = key.match(/^([^؀-ۿ]*)(.+?)([^؀-ۿ]*)$/);
    if (m && I18N[m[2].trim()]) n.nodeValue = raw.replace(m[2].trim(), I18N[m[2].trim()]);
  }
  root.querySelectorAll('[placeholder],[title]').forEach(el => {
    ['placeholder', 'title'].forEach(a => { const v = el.getAttribute(a); if (v && I18N[v.trim()]) el.setAttribute(a, I18N[v.trim()]); });
  });
}
function applyStaticTranslations() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl';
  $('#btn-lang').textContent = LANG === 'en' ? 'ع' : 'EN';
  translateDomText(document.querySelector('.topbar'));
}
function toggleLang() {
  LANG = LANG === 'en' ? 'ar' : 'en';
  lsSet('mv_lang', LANG);
  location.reload();
}

/* =====================================================================
   BACKUP / RESTORE
   ===================================================================== */
/* النسخة الكاملة (ZIP: البيانات + كل الملفات) بتتعمل تلقائي كل يوم على السيرفر (backup.py) — مدير النظام بيتابعها
   من «💾 النسخ الاحتياطية»، والتنبيه بيظهر لو التلقائية وقفت أكتر من يومين أو فشلت. */
function backupStale(bs) {
  if (!bs) return false;
  const ok = bs.lastOk ? daysUntil(bs.lastOk.slice(0, 10)) : null;
  return ok === null || ok < -2 || (!!bs.lastError && (!bs.lastOk || (bs.lastErrorAt || '') > bs.lastOk));
}
function backupStaleText(bs) {
  if (bs.lastError && (!bs.lastOk || (bs.lastErrorAt || '') > bs.lastOk)) return `${t('النسخة الاحتياطية التلقائية فشلت')}: ${bs.lastError}`;
  return bs.lastOk ? `${t('آخر نسخة احتياطية تلقائية من')} ${-daysUntil(bs.lastOk.slice(0, 10))} ${t('يوم')}` : t('لسه مفيش نسخة احتياطية تلقائية');
}
/* 🗑️ سلة المحذوفات (trash.py): الموظف / المترشّح / العربية / التصريح المحذوف بيفضل 90 يوم وبيترجع زي ما كان */
const TRASH_ICONS = { employee: '👤', candidate: '🧑‍💼', vehicle: '🚗', permit: '🪪' };
function trashNote() { return t('هيتنقل لسلة المحذوفات، وتقدر ترجّعه زي ما كان خلال 90 يوم.'); }
function canTrash() { return ['employees.delete', 'recruitment.delete', 'vehicles.delete', 'permits.delete'].some(k => can(k)); }
async function openTrashModal() {
  const F = { q: '', kind: '' };
  const m = openModal({ title: '🗑️ ' + t('سلة المحذوفات'), size: 'wide', body: '<div id="tr-body" class="muted">…</div>', foot: `<span id="tr-foot"></span><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>` });
  let data = null;
  const load = async () => { try { data = await api('GET', '/api/trash'); draw(); } catch (e) { $('#tr-body', m.el).innerHTML = `<div class="notice err">${esc(e.message)}</div>`; } };
  const sumText = x => [x.summary.permits ? `${x.summary.permits} ${t('تصريح')}` : '', x.summary.vehicles ? `${x.summary.vehicles} ${t('سيارة مربوطة')}` : '', x.summary.letters ? `${x.summary.letters} ${t('خطاب')}` : ''].filter(Boolean).join(' · ');
  const draw = () => {
    const q = norm(F.q);
    const list = data.items.filter(x => (!F.kind || x.kind === F.kind) && (!q || [x.label, x.recordId, x.deletedBy].some(v => norm(v).includes(q))));
    $('#tr-body', m.el).innerHTML = `<div class="notice small">${t('المحذوف بيفضل هنا')} ${data.keepDays} ${t('يوم وبعدها بيتحذف نهائي لوحده. «♻️ استرجاع» بيرجّعه زي ما كان ومعاه المرتبط بيه (الشركات، التصاريح ومرفقاتها).')}</div>
      <div class="filters" style="margin-top:8px"><input type="search" id="tr-q" placeholder="${esc(t('بحث بالاسم أو الرقم أو اللي حذف…'))}" value="${esc(F.q)}">
        <select id="tr-kind">${opt('', t('— كل الأنواع —'), !F.kind)}${Object.entries(TRASH_ICONS).map(([k, i]) => opt(k, `${i} ${t({ employee: 'موظف', candidate: 'مترشّح', vehicle: 'سيارة', permit: 'تصريح' }[k])}`, k === F.kind)).join('')}</select></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('النوع')}</th><th>${t('المحذوف')}</th><th>${t('اتحذف')}</th><th>${t('بيتحذف نهائي')}</th><th></th></tr></thead><tbody>
        ${list.map(x => `<tr><td>${TRASH_ICONS[x.kind] || ''} ${esc(t(x.kindLabel))}</td><td><b>${esc(x.label)}</b>${sumText(x) ? `<div class="small muted">${esc(sumText(x))}</div>` : ''}</td>
          <td class="small">${fmtDateTime(x.deletedAt)}<br>${esc(x.deletedBy || '')}</td><td>${datePill(x.purgeAt)}</td>
          <td style="white-space:nowrap"><button class="btn sm primary" data-tr-rs="${x.id}">♻️ ${t('استرجاع')}</button>${data.canPurge ? ` <button class="btn sm danger" data-tr-del="${x.id}" title="${esc(t('حذف نهائي'))}">🗑️</button>` : ''}</td></tr>`).join('')
          || `<tr><td colspan="5" class="empty">${t('السلة فاضية')}</td></tr>`}</tbody></table></div>`;
    $('#tr-foot', m.el).innerHTML = data.canPurge && data.items.length ? `<button class="btn danger" id="tr-empty">🗑️ ${t('تفريغ السلة')}</button>` : '';
    const qi = $('#tr-q', m.el);
    qi.oninput = debounce(() => { F.q = qi.value; draw(); const i = $('#tr-q', m.el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
    $('#tr-kind', m.el).onchange = e => { F.kind = e.target.value; draw(); };
    $$('[data-tr-rs]', m.el).forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await api('POST', `/api/trash/${b.dataset.trRs}/restore`, {}); toast(t('اترجع زي ما كان'), 'ok'); await reload(); load(); }
      catch (e) { b.disabled = false; if (e.data && e.data.block) openBlockAlert(e.message); else toast(e.message, 'err'); }
    });
    $$('[data-tr-del]', m.el).forEach(b => b.onclick = async () => {
      const x = data.items.find(y => y.id === b.dataset.trDel);
      if (!await openConfirm(`${t('حذف نهائي')} «${esc(x.label)}»؟\n${t('مش هيقدر يترجع تاني.')}`, { danger: true, okLabel: t('حذف نهائي') })) return;
      try { await api('DELETE', '/api/trash/' + x.id); load(); } catch (e) { toast(e.message, 'err'); }
    });
    const em = $('#tr-empty', m.el); if (em) em.onclick = async () => {
      if (!await openConfirm(`${t('تفريغ السلة؟')} (${data.items.length})\n${t('كل اللي فيها هيتحذف نهائي ومش هيقدر يترجع.')}`, { danger: true, okLabel: t('تفريغ السلة') })) return;
      try { await api('DELETE', '/api/trash'); load(); } catch (e) { toast(e.message, 'err'); }
    };
  };
  load();
}
const BACKUP_KIND_ICONS = { auto: '🔁', manual: '✋', 'pre-restore': '🛟' };
function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
async function openBackupsModal() {
  if (!can('admin')) return;
  const m = openModal({ title: '💾 ' + t('النسخ الاحتياطية'), size: 'wide', body: '<div id="bk-body" class="muted">…</div>', foot: `<button class="btn" data-close>${t('إغلاق')}</button>` });
  const draw = async () => {
    let r;
    try { r = await api('GET', '/api/backups'); } catch (e) { $('#bk-body', m.el).innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }
    $('#bk-body', m.el).innerHTML = `<div class="notice ${backupStale(r) ? 'warn' : ''}">${backupStale(r) ? '⚠️ ' + esc(backupStaleText(r)) : `✅ ${t('آخر نسخة تلقائية')}: <b>${fmtDateTime(r.lastOk)}</b>`}
        <div class="small" style="margin-top:4px">${t('النسخة الكاملة (ZIP) فيها كل البيانات وكل الملفات: المرفقات، والتوقيعات، واللوجوهات، ومستندات الشركات، والقوالب. التلقائية بتتعمل كل يوم، وبيتحفظ آخر 14 يوم ونسخة لكل شهر لمدة سنة. اليدوية بتفضل لحد ما تمسحها.')}</div></div>
      <div class="form" style="margin-top:10px"><label class="full">📂 ${t('مجلد النسخ الاحتياطية')} <span class="small muted">— ${t('الأحسن مجلد على هارد تاني أو OneDrive، عشان لو الجهاز باظ النسخ ماتروحش معاه')}</span>
        <div class="row" style="gap:6px"><input id="bk-dir" dir="ltr" style="flex:1" value="${esc(r.custom ? r.folder : '')}" placeholder="${esc(r.defaultFolder)}"><button class="btn" id="bk-dir-save">${t('حفظ المجلد')}</button></div></label></div>
      <div class="row" style="gap:8px;margin:10px 0;flex-wrap:wrap"><button class="btn primary" id="bk-new">➕ ${t('نسخة كاملة دلوقتي')}</button>
        <button class="btn" id="bk-dl">⬇️ ${t('نسخة كاملة وتنزيلها')}</button><button class="btn" id="bk-up">♻️ ${t('استعادة من ملف')}</button></div>
      <div class="table-wrap" style="max-height:340px"><table class="data"><thead><tr><th>${t('التاريخ')}</th><th>${t('النوع')}</th><th>${t('الحجم')}</th><th></th></tr></thead><tbody>
        ${r.items.map(x => `<tr><td>${fmtDateTime(x.createdAt)}</td><td>${BACKUP_KIND_ICONS[x.kind] || ''} ${esc(t(r.kinds[x.kind] || x.kind))}${x.format === 'json' ? ` <span class="chip">${t('بيانات بس')}</span>` : ''}</td><td class="num">${fmtBytes(x.size)}</td>
          <td style="white-space:nowrap"><button class="btn sm" data-bk-dl="${esc(x.name)}">⬇️</button> <button class="btn sm" data-bk-rs="${esc(x.name)}">♻️ ${t('استعادة')}</button> <button class="btn sm danger" data-bk-del="${esc(x.name)}">🗑️</button></td></tr>`).join('')
          || `<tr><td colspan="4" class="empty">${t('مفيش نسخ في المجلد ده لسه')}</td></tr>`}</tbody></table></div>
      <div class="small muted" style="margin-top:6px">${esc(r.folder)}</div>`;
    const E = m.el, busy = (b, on) => { b.disabled = on; };
    $('#bk-dir-save', E).onclick = async () => { try { await api('PUT', '/api/backups/folder', { path: $('#bk-dir', E).value.trim() }); toast(t('تم الحفظ'), 'ok'); draw(); } catch (e) { openBlockAlert(e.message); } };
    $('#bk-new', E).onclick = async ev => { busy(ev.currentTarget, true); try { const x = await api('POST', '/api/backups', {}); toast(`${t('اتعملت')} ${x.name}`, 'ok'); draw(); } catch (e) { toast(e.message, 'err'); busy(ev.currentTarget, false); } };
    $('#bk-dl', E).onclick = () => { const a = document.createElement('a'); a.href = '/api/backup'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(draw, 2500); };
    $('#bk-up', E).onclick = async () => {
      const f = await pickFile('.zip,.json');
      if (f && await confirmRestore(f.name)) { const fd = new FormData(); fd.append('file', f); await doRestore(() => api('POST', '/api/restore', fd)); draw(); }
    };
    $$('[data-bk-dl]', E).forEach(b => b.onclick = () => { const a = document.createElement('a'); a.href = '/api/backups/' + encodeURIComponent(b.dataset.bkDl); document.body.appendChild(a); a.click(); a.remove(); });
    $$('[data-bk-rs]', E).forEach(b => b.onclick = async () => { if (await confirmRestore(b.dataset.bkRs)) { await doRestore(() => api('POST', `/api/backups/${encodeURIComponent(b.dataset.bkRs)}/restore`, {})); draw(); } });
    $$('[data-bk-del]', E).forEach(b => b.onclick = async () => {
      if (!await openConfirm(`${t('حذف النسخة')} ${esc(b.dataset.bkDel)}؟`, { danger: true, okLabel: t('حذف') })) return;
      try { await api('DELETE', '/api/backups/' + encodeURIComponent(b.dataset.bkDel)); draw(); } catch (e) { toast(e.message, 'err'); }
    });
  };
  const confirmRestore = name => openConfirm(`${t('استعادة')} «${esc(name)}»؟\n${t('البيانات الحالية هتتستبدل بمحتوى النسخة (المستخدمين وكلمات السر بيفضلوا زي ما هم). قبل الاستعادة بتتعمل نسخة «قبل الاستعادة» من الحالة الحالية، فتقدر ترجع لها.')}`, { danger: true, okLabel: t('استعادة') });
  const doRestore = async call => {
    toast(t('جاري الاستعادة…'));
    try { const r = await call(); await reload(); toast(`${t('تمت الاستعادة بنجاح')}${r.files ? ` · ${r.files} ${t('ملف')}` : ''}`, 'ok'); }
    catch (e) { openBlockAlert(e.message); }
  };
  draw();
}

/* =====================================================================
   UI STATE — حفظ الفلاتر والصفحة
   ===================================================================== */
let UI = Object.assign({
  emp: { q: '', company: [], link: '', project: [], agency: [], status: [], stage: [], nationality: [], costCenter: [], profession: [], tier: '', tierField: 'any', driver: false, sort: 'name', dir: 1, page: 1, perPage: 50 },
  cand: { q: '', source: '', stage: '', company: '' },
  log: { tab: 'history', company: '', category: '', q: '' },
  vehicles: { q: '', project: '', agency: '', type: '', cc: '', owner: '' },
  permits: { tab: 'employee', employee: {}, vehicle: {} },
  co: { tab: '', projQ: '', projCompany: '', projAgency: '' },
  custody: { tab: 'list', q: '', status: '', type: '', custodian: '' },
}, lsJson('mv_uiState', {}));
const saveUiStateToLocalStorage = debounce(() => lsSet('mv_uiState', JSON.stringify(UI)), 300);

/* =====================================================================
   DRAFT AUTOSAVE — مسودة تلقائية لنماذج الإضافة
   ===================================================================== */
function saveDraft(form, data) { lsSet('mv_draft_' + form, JSON.stringify({ at: new Date().toISOString(), data })); }
function loadDraft(form) { return lsJson('mv_draft_' + form, null); }
function clearDraft(form) { lsSet('mv_draft_' + form, null); }
function attachDraftAutosave(form, root, collect) {
  const h = debounce(() => saveDraft(form, collect()), 400);
  root.addEventListener('input', h);
  root.addEventListener('change', h);
}

/* =====================================================================
   DOCUMENT COMPLETENESS
   ===================================================================== */
function empDocCompleteness(e) {
  const checks = [
    ['nameEn', 'الاسم بالإنجليزي'], ['nationality', 'الجنسية'], ['profession', 'المهنة'], ['dateOfBirth', 'تاريخ الميلاد'],
    ['dateOfHire', 'تاريخ التعيين'], ['salary', 'الراتب'], ['residencyExp', 'انتهاء الإقامة'], ['workPermitExp', 'انتهاء إذن العمل'],
    ['passportNo', 'رقم الجواز'], ['passportExp', 'انتهاء الجواز'], ['healthCardExp', 'انتهاء البطاقة الصحية'], ['costCenter', 'مركز التكلفة'],
  ].filter(([k]) => !hiddenField('employee', k));          // اللي مش مسموح يشوفه مايتحسبش ناقص
  if (e.isDriver) checks.push(['drivingLicenseExp', 'انتهاء رخصة القيادة']);
  const missing = checks.filter(([k]) => e[k] === null || e[k] === undefined || e[k] === '').map(([, l]) => l);
  if (!empCompanyId(e)) missing.push('الشركة');
  const total = checks.length + 1;
  return { pct: Math.round(100 * (total - missing.length) / total), missing };
}
function empUrgency(e) {
  let min = null;
  for (const f of EMP_DATE_FIELDS) {
    if (f.driverOnly && !e.isDriver) continue;
    const d = daysUntil(e[f.key]);
    if (d !== null && (min === null || d < min)) min = d;
  }
  return min;
}

/* =====================================================================
   ALERT CENTER — كل ما ينتهي خلال 90 يوم
   ===================================================================== */
/** التنبيهات بالتواريخ. system = تنبيهات النظام كمان (النسخ الاحتياطية) — للجرس بس، مش لعدّادات المستندات */
function trackedAlertItems(maxDays = 90, system = false) {
  const items = [], byKey = {};
  // نفس الشخص/الشركة/السيارة بنفس التاريخ (زي الإقامة وإذن العمل) ← سطر واحد: "الإقامة + إذن العمل"
  // what بتتترجم هنا عشان المدمجة مالهاش مفتاح في القاموس، و t() على نص مترجم بترجّعه زي ما هو
  const push = (o) => {
    const d = daysUntil(o.date);
    if (d === null || d > maxDays) return;
    const key = `${o.kind}|${o.refId}|${o.name}|${o.date}`;
    if (byKey[key]) { byKey[key].what += ' + ' + t(o.what); return; }
    items.push(byKey[key] = { ...o, what: t(o.what), days: d, tier: tierOf(o.date) });
  };
  for (const e of scopedEmployees()) {
    if (empEnded(e)) continue;
    for (const f of EMP_DATE_FIELDS) {
      if (f.driverOnly && !e.isDriver) continue;
      push({ kind: 'employee', refId: e.id, name: empName(e), what: f.label, date: e[f.key] });
    }
  }
  for (const c of scopedCompanies()) {
    push({ kind: 'company', refId: c.id, name: companyName(c.id), what: 'الرخصة التجارية', date: c.commercialLicenseExpiry });
    push({ kind: 'company', refId: c.id, name: companyName(c.id), what: 'تفويض المرور', date: c.trafficAuthExpiry });
    push({ kind: 'company', refId: c.id, name: companyName(c.id), what: 'تفويض الشؤون المدنية', date: c.civilAffairsAuthExpiry });
    for (const s of c.signatories || []) {
      const d = s.civilId && STATE.signatoryDocs[s.civilId];
      if (d) push({ kind: 'company', refId: c.id, name: s.nameAr, what: 'بطاقة المفوّض المدنية', date: d.expiryDate });
    }
  }
  // العقد / المشروع: انتهاؤه، ومعاه سطر واحد بعدد الموظفين والسيارات اللي إقامتهم / دفترهم بعد نهايته (لازم يتجدّد قبلها)
  for (const p of STATE.projects) if (companyInScope(p.companyId)) {
    push({ kind: 'project', refId: p.companyId, name: projectName(p.id), what: 'العقد / المشروع', date: p.expiryDate });
    const ne = scopedEmployees().filter(e => !empEnded(e) && empProjectId(e) === p.id && beyondLicense(e, p.id, ['residencyExp', 'workPermitExp']).length).length;
    const nv = STATE.vehicles.filter(v => v.projectId === p.id && beyondLicense(v, p.id, ['insuranceExpiry', 'govLicenseExpiry']).length).length;
    if (ne) push({ kind: 'project', refId: p.companyId, name: projectName(p.id), what: `${ne} ${t('موظف إقامته أو إذن عمله بعد نهاية العقد')}`, date: p.expiryDate });
    if (nv) push({ kind: 'project', refId: p.companyId, name: projectName(p.id), what: `${nv} ${t('سيارة تأمينها أو دفترها بعد نهاية العقد')}`, date: p.expiryDate });
  }
  for (const v of STATE.vehicles) if (companyInScope(v.companyId)) {
    push({ kind: 'vehicle', refId: v.id, name: v.plate, what: 'تأمين السيارة', date: v.insuranceExpiry });
    push({ kind: 'vehicle', refId: v.id, name: v.plate, what: 'دفتر السيارة', date: v.govLicenseExpiry });
  }
  // التصاريح (الموظف اللي خدمته انتهت مالوش تنبيه) ← بتفتح قسم التصاريح على التصريح نفسه
  for (const p of STATE.permits || []) {
    const h = permitHolder(p);
    if (!h || !permitCurrent(p)) continue;
    if (permitNeedsCancel(p))            // مستقيل / إنهاء خدمات / في فترة إنذار ← لازم يتلغي
      push({ kind: 'permit', refId: p.id, name: permitHolderName(p), what: `${t('لازم إلغاء')} ${permitLabel(p)} — ${t('آخر يوم شغل')} ${fmtDate(h.serviceEndDate) || '—'}`, date: h.serviceEndDate || todayISO() });
    else if (!(p.holderKind === 'employee' && empEnded(h))) push({ kind: 'permit', refId: p.id, name: permitHolderName(p), what: permitLabel(p), date: p.expiryDate });
  }
  for (const c of STATE.candidates) {
    if (c.stage === 'rejected' || c.stage === 'all_completed' || c.source === 'kuwaiti') continue;
    if (c.source !== 'internal') {
      push({ kind: 'candidate', refId: c.id, name: c.name, what: 'تأشيرة المترشّح', date: c.visaExp });
      if (c.entryDate) push({ kind: 'candidate', refId: c.id, name: c.name, what: 'مهلة 60 يوم من الدخول', date: addDays(c.entryDate, 60) });
    } else {
      push({ kind: 'candidate', refId: c.id, name: c.name, what: 'إقامة الكفيل القديم', date: c.oldSponsorResidencyExp });
    }
  }
  // النسخة الاحتياطية التلقائية وقفت أو فشلت (مدير النظام) ← بتفتح شاشة النسخ
  const bs = STATE.backupStatus;
  if (system && bs && backupStale(bs)) push({ kind: 'system', refId: 'backup', name: t('النسخ الاحتياطية'), what: backupStaleText(bs), date: (bs.lastOk || '').slice(0, 10) || todayISO() });
  // طلبات الموافقة: اللي معاه الصلاحية ← المستني، وصاحب الطلب ← القرار (آخر 7 أيام)
  if (system && typeof pendingApprovals === 'function') {
    const n = canApprove() ? pendingApprovals().length : 0;
    if (n) push({ kind: 'system', refId: 'approvals', name: t('طلبات الموافقة'), what: `${n} ${t('طلب مستني موافقتك')}`, date: todayISO() });
    for (const r of STATE.approvals || []) {
      if (!isMyRequest(r) || !['approved', 'rejected'].includes(r.status) || !r.decidedAt || daysUntil(r.decidedAt.slice(0, 10)) < -7) continue;
      push({ kind: 'system', refId: 'approvals', name: r.employeeName, what: `${t(r.kindLabel)}: ${t(APPROVAL_STATUS[r.status][0])}${r.decisionNote ? ' — ' + r.decisionNote : ''}`, date: r.decidedAt.slice(0, 10) });
    }
  }
  return items.sort((a, b) => a.days - b.days);
}
function openAlertTarget(it) {
  closeSidePanel();
  if (it.kind === 'employee') openProfileCard(it.refId);
  else if (it.kind === 'permit') setView('permits', { focusPermit: it.refId });
  else if (it.kind === 'company' || it.kind === 'project') setView('companies', { focusCompany: it.refId, focusTab: it.kind === 'project' ? 'projects' : 'info' });
  else if (it.kind === 'vehicle') { setView('vehicles'); setTimeout(() => openVehicleModal(it.refId), 50); }
  else if (it.kind === 'candidate') { setView('recruitment'); setTimeout(() => openCandidateModal(it.refId), 50); }
  else if (it.kind === 'system' && it.refId === 'backup') openBackupsModal();
  else if (it.kind === 'system' && it.refId === 'approvals') openApprovalsModal();
}
function renderAlertCenterPanel(filter = 'all') {
  if (filter !== 'all') filter = tierFilterValue(filter) || 'all';        // «منتهي» من لوحة المعلومات ← خلال 30 يوم
  const items = trackedAlertItems(90, true);
  const counts = { all: items.length };
  for (const k of TIER_FILTERS) counts[k] = items.filter(i => tierIn(i.date, k)).length;
  const shown = filter === 'all' ? items : items.filter(i => tierIn(i.date, filter));
  const root = $('#side-root');
  root.innerHTML = `<div class="side-panel" id="alert-panel">
    <div class="modal-head"><h2>🔔 مركز التنبيهات</h2><button class="btn ghost" id="close-side">✕</button></div>
    <div style="padding:8px 14px" class="row">
      ${['all', ...TIER_FILTERS].map(k => `<span class="chip clickable ${filter === k ? 'on' : ''}" data-f="${k}">${k === 'all' ? t('الكل') : t(TIERS[k].label)} (${counts[k]})</span>`).join('')}
    </div>
    <div class="body">${shown.length ? shown.map((it, i) => `
      <div class="alert-item" data-i="${i}">
        <div><b>${esc(it.name)}</b><div class="small muted">${esc(t(it.what))} · ${esc(t({ employee: 'موظف', company: 'شركة', project: 'مشروع', vehicle: 'سيارة', candidate: 'مترشّح', permit: 'التصاريح', system: 'النظام' }[it.kind]))}</div></div>
        <div style="text-align:end">${datePill(it.date)}<div class="small muted">${esc(daysText(it.days))}</div></div>
      </div>`).join('') : '<div class="empty">لا توجد تنبيهات 🎉</div>'}</div></div>`;
  translateDomText(root);
  $('#close-side').onclick = closeSidePanel;
  $$('#alert-panel [data-f]').forEach(c => c.onclick = () => renderAlertCenterPanel(c.dataset.f));
  $$('#alert-panel .alert-item').forEach(el => el.onclick = () => openAlertTarget(shown[+el.dataset.i]));
}
function closeSidePanel() { $('#side-root').innerHTML = ''; }
function updateAlertCount() {
  const n = trackedAlertItems(90, true).filter(i => i.days <= 30).length;
  const el = $('#alert-count');
  el.hidden = !n; el.textContent = n > 99 ? '99+' : n;
}

/* =====================================================================
   GLOBAL SEARCH
   ===================================================================== */
function runGlobalSearch(q) {
  const n = norm(q);
  if (n.length < 2) return [];
  const res = [];
  const add = (grp, label, sub, go) => res.push({ grp, label, sub, go });
  for (const e of scopedEmployees()) {
    if ([e.name, e.nameEn, e.id, e.passportNo, e.fileNo, e.phone].some(v => norm(v).includes(n)))
      add('الموظفين', empName(e), e.id + ' · ' + companyName(empCompanyId(e)), () => openProfileCard(e.id));
  }
  for (const c of STATE.candidates) if ([c.name, c.nameEn, c.passportNo, c.civilId, c.phone].some(v => norm(v).includes(n)))
    add('المترشّحين', c.name, c.passportNo || '', () => { setView('recruitment'); setTimeout(() => openCandidateModal(c.id), 50); });
  for (const c of scopedCompanies()) if ([c.nameAr, c.nameEn, c.mainFileNumber, c.commercialLicenseNo].some(v => norm(v).includes(n)))
    add('الشركات', companyName(c.id), c.mainFileNumber || '', () => setView('companies', { focusCompany: c.id }));
  for (const p of scopedProjects()) if ([p.nameAr, p.nameEn, p.fileNumber].some(v => norm(v).includes(n)))
    add('المشاريع', projectName(p.id), companyName(p.companyId), () => setView('companies', { focusCompany: p.companyId, focusTab: 'projects' }));
  for (const v of STATE.vehicles) if ([v.plate, v.model].some(x => norm(x).includes(n)))
    add('السيارات', v.plate, v.model || '', () => { setView('vehicles'); setTimeout(() => openVehicleModal(v.id), 50); });
  return res;
}
let SEARCH_RES = [], SEARCH_ACTIVE = -1;
function renderGlobalSearchResults(q) {
  const box = $('#search-results');
  SEARCH_RES = runGlobalSearch(q).slice(0, 40);
  SEARCH_ACTIVE = -1;
  if (!q || q.trim().length < 2) { box.hidden = true; return; }
  if (!SEARCH_RES.length) { box.innerHTML = `<div class="empty">${t('لا توجد نتائج')}</div>`; box.hidden = false; return; }
  let html = '', last = '';
  SEARCH_RES.forEach((r, i) => {
    if (r.grp !== last) { html += `<div class="grp">${esc(t(r.grp))}</div>`; last = r.grp; }
    html += `<div class="item" data-i="${i}"><span>${esc(r.label)}</span><span class="muted small">${esc(r.sub)}</span></div>`;
  });
  box.innerHTML = html; box.hidden = false;
  $$('.item', box).forEach(el => el.onmousedown = (ev) => { ev.preventDefault(); pickSearch(+el.dataset.i); });
}
function pickSearch(i) {
  const r = SEARCH_RES[i]; if (!r) return;
  $('#search-results').hidden = true; $('#global-search').value = ''; $('#global-search').blur();
  r.go();
}

/* =====================================================================
   NAV / RENDER
   ===================================================================== */
function setView(v, args) {
  VIEW = v; VIEW_ARGS = args || VIEW_ARGS || {};
  lsSet('mv_lastView', v);
  closeSidePanel();
  render();
  window.scrollTo(0, 0);
}
function renderNav() {
  $('#navrail').innerHTML = VIEWS.map(v => `<button data-view="${v.id}" class="${VIEW === v.id ? 'active' : ''}"><span class="ico">${v.ico}</span><span>${esc(t(v.label))}</span></button>`).join('')
    + `<div class="ver">Lunx ${esc(STATE.version)}</div>`;
  $$('#navrail button').forEach(b => b.onclick = () => { VIEW_ARGS = {}; setView(b.dataset.view); });
  applyNavVisibility();
}
function renderAlertBar() {
  const items = trackedAlertItems();
  const expired = items.filter(i => i.days < 0).length;
  const week = items.filter(i => i.days >= 0 && i.days <= 7).length;
  const stuck = scopedEmployees().filter(e => e.govStageNote && !empEnded(e)).length;
  let html = '';
  if ((expired || week || stuck) && VIEW !== 'dashboard') {   // الرئيسية فيها «محتاج إجراء»
    const parts = [];
    if (expired) parts.push(`⛔ ${expired} ${t('تاريخ منتهي')}`);
    if (week) parts.push(`⏰ ${week} ${t('ينتهي خلال 7 أيام')}`);
    if (stuck) parts.push(`⚠️ ${stuck} ${t('معاملة عليها ملاحظة تعطّل')}`);
    html += `<div class="alertbar no-print" id="alertbar"><b>${t('تنبيه')}:</b> ${parts.join(' · ')} <span class="spacer"></span><u>${t('عرض التفاصيل')}</u></div>`;
  }
  const bs = STATE.backupStatus;                        // مدير النظام بس — النسخة التلقائية وقفت أو فشلت
  if (bs && backupStale(bs) && lsGet('mv_backup_reminder_dismiss') !== todayISO()) {
    html += `<div class="alertbar backup no-print">💾 ${esc(backupStaleText(bs))}
      <span class="spacer"></span><button class="btn sm" id="bk-now">📂 ${t('النسخ الاحتياطية')}</button><button class="btn sm ghost" id="bk-dismiss">${t('إخفاء اليوم')}</button></div>`;
  }
  return html;
}
function bindAlertBar() {
  const ab = $('#alertbar'); if (ab) ab.onclick = () => renderAlertCenterPanel();
  const b1 = $('#bk-now'); if (b1) b1.onclick = openBackupsModal;
  const b2 = $('#bk-dismiss'); if (b2) b2.onclick = () => { lsSet('mv_backup_reminder_dismiss', todayISO()); render(); };
}
function render() {
  if (!STATE) return;
  if (VIEW === 'costcenters') { VIEW = 'companies'; UI.co.tab = 'costcenters'; }   // مراكز التكلفة بقت تبويب جوه الشركات
  renderNav();
  const v = VIEWS.find(x => x.id === VIEW) || VIEWS[0];
  const c = $('#content');
  c.innerHTML = renderAlertBar() + `<div id="view-root"></div>`;
  bindAlertBar();
  try { v.render(); } catch (e) { console.error(e); $('#view-root').innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
  translateDomText(c);
  updateAlertCount();
}
function viewRoot() { return $('#view-root'); }

/* =====================================================================
   قائمة المستخدم + إعدادات العرض + المستخدمين
   ===================================================================== */
function renderUserMenu() {
  const m = $('#user-menu');
  const me = STATE.me;
  const sub = me.isAdmin ? t('مدير النظام') : (me.jobTitle || '');
  m.innerHTML = `<div class="info">${esc(me.displayName || me.username)}${sub ? `<br><span class="small muted">${esc(sub)}</span>` : ''}</div>
    ${me.isAdmin ? `<button data-a="backup">💾 ${t('النسخ الاحتياطية')}${backupStale(STATE.backupStatus) ? ' ⚠️' : ''}</button><button data-a="users">🔑 ${t('المستخدمين والصلاحيات')}</button>
      <button data-a="exportpw">🔐 ${t('كلمة سر التصدير')}${STATE.exportPasswordSet ? '' : ' ⚠️'}</button>
      <button data-a="dq">📋 ${t('جودة البيانات')}</button><button data-a="importx">📥 ${t('استيراد بيانات تكميلية')}</button>` : ''}
    ${canApprove() || (STATE.approvals || []).length ? `<button data-a="approvals">✋ ${t('طلبات الموافقة')}${pendingApprovals().length ? ` (${pendingApprovals().length})` : ''}</button>` : ''}
    ${canTrash() ? `<button data-a="trash">🗑️ ${t('سلة المحذوفات')}</button>` : ''}
    <button data-a="viewperms">👁️ ${t('إعدادات العرض')}</button>
    <button data-a="password">🔒 ${t('تغيير كلمة المرور')}</button>
    <button data-a="logout">🚪 ${t('تسجيل الخروج')}</button>`;
  $$('button', m).forEach(b => b.onclick = () => {
    m.hidden = true;
    ({ backup: openBackupsModal, trash: openTrashModal, approvals: openApprovalsModal, users: () => openUsersModal(), viewperms: renderViewSettingsModal, exportpw: openExportPasswordModal, dq: openDataQualityModal, importx: () => openImportExtraModal(),
       password: openPasswordModal, logout: () => location.href = '/logout' })[b.dataset.a]();
  });
}
function renderViewSettingsModal() {
  const p = loadViewPerms();
  const m = openModal({
    title: t('إعدادات العرض (لهذا المتصفح)'),
    body: `<div class="notice">${t('الإعدادات دي بتتحفظ على الجهاز ده بس، وبتخفي أقسام من القائمة.')}</div>
      <h4>${t('الأقسام الظاهرة')}</h4>
      <div class="form">${VIEWS.filter(v => v.id !== 'dashboard' && viewAllowed(v.id)).map(v => `<label class="check"><input type="checkbox" data-view="${v.id}" ${p.hidden.includes(v.id) ? '' : 'checked'}> ${esc(t(v.label))}</label>`).join('')}</div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  m.el.querySelector('[data-save]').onclick = () => {
    saveViewPerms({ hidden: $$('[data-view]', m.el).filter(x => !x.checked).map(x => x.dataset.view) });
    m.close(); render();
  };
}
function openPasswordModal() {
  const m = openModal({
    title: t('تغيير كلمة المرور'), size: 'narrow',
    body: `<div class="form"><label class="full">${t('كلمة المرور الحالية')}<input type="password" name="old" autocomplete="current-password"></label>
      <label class="full">${t('كلمة المرور الجديدة')}<input type="password" name="new" autocomplete="new-password" minlength="8"></label>
      <label class="full">${t('تأكيد كلمة المرور الجديدة')}<input type="password" name="confirm" autocomplete="new-password" minlength="8"></label></div>
      <div class="small muted" style="margin-top:6px">${t('8 حروف على الأقل، ومش زي اسم المستخدم.')}</div>`,
    foot: `<button class="btn primary" data-save>${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  m.el.querySelector('[data-save]').onclick = async () => {
    const d = formValues(m.el);
    if (!d.new || d.new.length < 8) return openBlockAlert(t('كلمة المرور لازم 8 أحرف على الأقل'));
    if (d.new !== d.confirm) return openBlockAlert(t('كلمة المرور الجديدة وتأكيدها مش زي بعض'));
    try { await api('POST', '/api/me/password', { old: d.old, new: d.new }); m.close(); toast('تم تغيير كلمة المرور', 'ok'); } catch (e) { openBlockAlert(e.message); }
  };
}

/* =====================================================================
   تقرير جودة البيانات (مدير النظام) — /api/data-quality
   ===================================================================== */
const DQ_SEV = { high: ['🔴', 'مهم'], medium: ['🟠', 'متوسط'], low: ['🟡', 'بسيط'] };
async function openDataQualityModal() {
  let r;
  try { r = await api('GET', '/api/data-quality'); } catch (e) { return toast(e.message, 'err'); }
  const secs = r.sections;
  const count = sev => sum(secs.filter(x => x.severity === sev).map(x => x.items.length));
  const m = openModal({
    title: '📋 ' + t('جودة البيانات'), size: 'wide',
    body: `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">${Object.entries(DQ_SEV).map(([k, [ico, l]]) => `<span class="chip">${ico} ${t(l)} <b class="num">${count(k)}</b></span>`).join('')}
        <span class="small muted">${t('النواقص اللي بتوقف التنبيهات والنماذج والتقارير — اضغط على أي سطر عشان تفتحه وتصلّحه.')}</span></div>
      ${secs.length ? secs.map((x, i) => `<details class="dq" ${x.severity === 'high' ? 'open' : ''}><summary>${DQ_SEV[x.severity][0]} <b>${esc(t(x.title))}</b> <span class="chip">${x.items.length}</span>${x.hint ? ` <span class="small muted">— ${esc(t(x.hint))}</span>` : ''}</summary>
        <table class="data"><tbody>${x.items.slice(0, 300).map((it, j) => `<tr class="clickable" data-dq="${i}:${j}"><td>${esc(it.label)}</td><td class="small muted">${esc(it.detail || '')}</td></tr>`).join('')}
        ${x.items.length > 300 ? `<tr><td colspan="2" class="muted small">+${x.items.length - 300} ${t('في التقرير المطبوع')}</td></tr>` : ''}</tbody></table></details>`).join('')
        : `<div class="notice">✅ ${t('مفيش نواقص — البيانات كاملة')}</div>`}`,
    foot: `<button class="btn" data-print>🖨️ ${t('طباعة')}</button><button class="btn" data-refresh>🔄 ${t('فحص تاني')}</button><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  $$('[data-dq]', m.el).forEach(tr => tr.onclick = () => { const [i, j] = tr.dataset.dq.split(':').map(Number); dqOpen(secs[i].items[j]); });
  $('[data-refresh]', m.el).onclick = () => { m.close(); openDataQualityModal(); };
  $('[data-print]', m.el).onclick = () => printDataQuality(r);
}
function dqOpen(it) {
  if (it.kind === 'employee') { if (IDX.employee[it.id]) openProfileCard(it.id); else toast('الموظف ده مش ظاهر عندك', 'err'); }
  else if (it.kind === 'company') openCompanyDetails(it.id, 'info');
  else if (it.kind === 'vehicle') { closeAllModals(); setView('vehicles'); setTimeout(() => openVehicleModal(it.id), 50); }
  else if (it.kind === 'cc') { closeAllModals(); UI.co.tab = 'costcenters'; setView('companies'); setTimeout(() => openCostCenterModal(it.id), 50); }
  else if (it.kind === 'user') openUsersModal();
  else if (it.kind === 'permit') { closeAllModals(); setView('permits', { focusPermit: it.id }); }
  else if (it.id === 'exportpw') openExportPasswordModal();
}
function printDataQuality(r) {
  let body = '', n = 0;
  r.sections.forEach(x => {
    body += `<tr class="grp"><td colspan="3">${DQ_SEV[x.severity][0]} ${esc(t(x.title))}<small>${x.items.length}</small></td></tr>`
      + x.items.map((it, j) => `<tr class="${j % 2 ? 'z' : ''}"><td class="idx">${++n}</td><td class="txt">${esc(it.label)}</td><td class="txt">${esc(it.detail || '')}</td></tr>`).join('');
  });
  const count = sev => sum(r.sections.filter(x => x.severity === sev).map(x => x.items.length));
  openReportWindow({
    title: t('تقرير جودة البيانات'), landscape: false,
    summary: [[n, t('ملاحظة')], ...Object.entries(DQ_SEV).map(([k, [ico, l]]) => [count(k), `${ico} ${t(l)}`])],
    body: r.sections.length ? `<table class="rpt"><thead><tr><th>#</th><th class="txt">${t('السجل')}</th><th class="txt">${t('التفاصيل')}</th></tr></thead><tbody>${body}</tbody></table>` : `<p>✅ ${t('مفيش نواقص — البيانات كاملة')}</p>`,
    meta: [[t('عدد السجلات'), String(n)]],
  });
  printLog(t('تقرير جودة البيانات'), 'employee');
}

/* =====================================================================
   المستخدمين والأدوار والصلاحيات (لمدير النظام)
   ===================================================================== */
const PERM_ACTIONS = ['view', 'edit', 'delete'];
const PERM_LABELS = {
  modules: {
    employees: 'الإقامات والموظفين', companies: 'الشركات والمشاريع والمفوّضين', vehicles: 'السيارات', costcenters: 'مراكز التكلفة',
    recruitment: 'الاستقدام والتوظيف', contract: 'عقود العمل والقوالب', companylog: 'السجل التاريخي والتدقيق',
    custody: 'العهد والمصروفات', permits: 'التصاريح',
  },
  actions: { view: 'عرض', edit: 'إضافة وتعديل', delete: 'حذف' },
  other: {
    'sensitive.salary': 'المرتب وبدل السكن وتكلفة المعاملات', 'sensitive.bank': 'البنك والـ IBAN',
    'sensitive.documents': 'رقم الجواز والمرفقات', 'system.import': 'استيراد الموظفين من Excel/CSV', 'system.backup': 'تنزيل نسخة احتياطية كاملة',
    'contract.sign': 'توقيعات المفوّضين والموظفين',
  },
};
/** ملخص صلاحيات دور بشكل مقروء: [{label, acts:[…]}] */
function permSummary(keys, isAdmin) {
  if (isAdmin) return `<span class="chip on">${t('كل الصلاحيات + إدارة المستخدمين')}</span>`;
  const set = new Set(keys);
  const mods = Object.keys(PERM_LABELS.modules).filter(m => set.has(m + '.view')).map(m => {
    const acts = PERM_ACTIONS.filter(a => set.has(`${m}.${a}`)).map(a => t(PERM_LABELS.actions[a]));
    return `<span class="chip" title="${esc(acts.join('، '))}">${esc(t(PERM_LABELS.modules[m]))}${acts.length > 1 ? ' ✏️' : ''}${set.has(m + '.delete') ? ' 🗑️' : ''}</span>`;
  });
  const other = Object.keys(PERM_LABELS.other).filter(k => set.has(k)).map(k => `<span class="chip on">🔓 ${esc(t(PERM_LABELS.other[k]))}</span>`);
  return [...mods, ...other].join(' ') || `<span class="muted">${t('بدون صلاحيات')}</span>`;
}
let USERS_TAB = 'users';
async function openUsersModal(tab) {
  if (tab) USERS_TAB = tab;
  let users, roleData;
  try { [users, roleData] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/roles')]); }
  catch (e) { return toast(e.message, 'err'); }
  const roles = roleData.roles;
  const roleOf = id => roles.find(r => r.id === id);
  const ccName = id => (STATE.costCenters.find(c => c.id === id) || {}).name || id;
  const scopeText = u => u.allCompanies ? `<span class="chip on">${t('كل الشركات')}</span>`
    : u.companies.map(c => `<span class="chip">${esc(companyName(c) || c)}</span>`).join(' ')
      + (u.costCenters || []).map(c => `<span class="chip" title="${esc(t('مركز تكلفة'))}">💼 ${esc(ccName(c))}</span>`).join(' ');
  const usersPane = `<div class="row" style="margin-bottom:10px"><span class="muted">${users.length} ${t('مستخدم')} · ${users.filter(u => u.active).length} ${t('نشط')}</span><span class="spacer"></span>
      <button class="btn primary" data-user-add>➕ ${t('إضافة مستخدم')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('المستخدم')}</th><th>${t('الوظيفة')}</th><th>${t('الدور')}</th><th>${t('نطاق الشركات')}</th><th>${t('الحالة')}</th><th>${t('آخر دخول')}</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr class="clickable" data-uid="${u.id}" style="${u.active ? '' : 'opacity:.55'}">
      <td><b>${esc(u.displayName || u.username)}</b><div class="small muted" dir="ltr">${esc(u.username)}</div></td>
      <td>${esc(u.jobTitle || '')}${u.custodyCode ? ` <span class="chip num" title="${esc(t('رمز العهد'))}">${esc(u.custodyCode)}</span>` : ''}</td>
      <td>${roleOf(u.roleId) ? `<span class="chip ${roleOf(u.roleId).isAdmin ? 'on' : ''}">${esc(roleOf(u.roleId).name)}</span>` : '—'}</td>
      <td>${scopeText(u)}</td>
      <td>${u.active ? `<span class="chip on">${t('نشط')}</span>` : `<span class="chip" style="background:var(--red-soft);color:var(--red)">${t('موقوف')}</span>`}</td>
      <td class="small num">${u.lastLogin ? fmtDateTime(u.lastLogin) : '—'}</td>
      <td><button class="btn sm">✏️</button></td></tr>`).join('')}
    </tbody></table></div>`;
  const rolesPane = `<div class="row" style="margin-bottom:10px"><span class="muted">${t('كل مستخدم ليه دور واحد. عدّل الدور ← يتطبق على كل اللي واخدينه.')}</span><span class="spacer"></span>
      <button class="btn primary" data-role-add>➕ ${t('إضافة دور')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('الدور')}</th><th>${t('الصلاحيات')}</th><th>${t('المستخدمين')}</th><th></th></tr></thead><tbody>
    ${roles.map(r => `<tr class="clickable" data-rid="${esc(r.id)}"><td><b>${esc(r.name)}</b>${r.isAdmin ? ` <span class="small muted">🔒</span>` : ''}<div class="small muted">${esc(r.description || '')}</div></td>
      <td><div class="row" style="flex-wrap:wrap;gap:4px">${permSummary(r.permissions, r.isAdmin)}</div></td>
      <td class="num">${r.userCount}</td><td><button class="btn sm">✏️</button></td></tr>`).join('')}
    </tbody></table></div>`;
  const m = openModal({
    title: '🔑 ' + t('المستخدمين والصلاحيات'), size: 'wide',
    body: `<div class="tabs"><button data-tab="users" class="${USERS_TAB === 'users' ? 'active' : ''}">👥 ${t('المستخدمين')}</button>
      <button data-tab="roles" class="${USERS_TAB === 'roles' ? 'active' : ''}">🛡️ ${t('الأدوار والصلاحيات')}</button></div>
      <div data-pane="users" ${USERS_TAB !== 'users' ? 'hidden' : ''}>${usersPane}</div>
      <div data-pane="roles" ${USERS_TAB !== 'roles' ? 'hidden' : ''}>${rolesPane}</div>`,
    foot: `<button class="btn" data-close>إغلاق</button>`,
  });
  $$('[data-tab]', m.el).forEach(b => b.onclick = () => {
    USERS_TAB = b.dataset.tab;
    $$('[data-tab]', m.el).forEach(x => x.classList.toggle('active', x === b));
    $$('[data-pane]', m.el).forEach(p => p.hidden = p.dataset.pane !== USERS_TAB);
  });
  const again = () => { m.close(); openUsersModal(); };
  $('[data-user-add]', m.el).onclick = () => openUserEditModal(null, roles, again);
  $$('tr[data-uid]', m.el).forEach(tr => tr.onclick = () => openUserEditModal(users.find(u => u.id === +tr.dataset.uid), roles, again));
  $('[data-role-add]', m.el).onclick = () => openRoleEditModal(null, roleData.catalog, again, roles);
  $$('tr[data-rid]', m.el).forEach(tr => tr.onclick = () => openRoleEditModal(roleOf(tr.dataset.rid), roleData.catalog, again, roles));
}

function openUserEditModal(u, roles, done) {
  const isNew = !u;
  u = u || { active: true, allCompanies: true, companies: [], costCenters: [], roleId: (roles.find(r => r.id === 'viewer') || roles[0]).id };
  const v = k => esc(u[k] ?? '');
  const isSelf = !isNew && u.id === STATE.me.id;
  const roleHelp = id => { const r = roles.find(x => x.id === id); return r ? `<div class="small muted">${esc(r.description || '')}</div><div class="row" style="flex-wrap:wrap;gap:4px;margin-top:4px">${permSummary(r.permissions, r.isAdmin)}</div>` : ''; };
  const m = openModal({
    title: isNew ? t('إضافة مستخدم') : t('تعديل مستخدم') + ': ' + esc(u.username), size: 'wide',
    body: `<form class="form" id="user-form" autocomplete="off">
      <h4>${t('بيانات الحساب')}</h4>
      <label><span class="req">${t('اسم المستخدم (للدخول)')}</span><input name="username" value="${v('username')}" dir="ltr" ${isNew ? '' : 'disabled'}></label>
      <label>${t('الاسم الظاهر')}<input name="displayName" value="${v('displayName')}"></label>
      <label>${t('الوظيفة')}<input name="jobTitle" value="${v('jobTitle')}" placeholder="${t('مثلًا: مندوب حكومي')}"></label>
      <label>${t('رمز العهد')} <span class="small muted">(${t('حروف إنجليزي — أرقام عهده: AA-0001')})</span><input name="custodyCode" value="${v('custodyCode')}" dir="ltr" maxlength="6" style="text-transform:uppercase" placeholder="${t('تلقائي')}" ${u.custodyCodeLocked ? 'disabled' : ''}>
        <span class="small muted">${u.custodyCodeLocked ? '🔒 ' + t('الرمز مايتغيّرش') : t('الرمز بيتحدد مرة واحدة ومش هيتغيّر بعد الحفظ.')}</span></label>
      <label>${t('البريد')}<input name="email" value="${v('email')}" dir="ltr"></label>
      <label>${t('الهاتف')}<input name="phone" value="${v('phone')}" dir="ltr"></label>
      <label>${isNew ? `<span class="req">${t('كلمة المرور')}</span>` : t('كلمة مرور جديدة (سيبها فاضية لو مش هتغيّرها)')}<input name="password" type="password" autocomplete="new-password" minlength="8"></label>
      <label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${isSelf ? 'disabled' : ''}> ${t('الحساب نشط (يقدر يدخل)')}</label>
      <h4>${t('الدور والصلاحيات')}</h4>
      <label class="full"><span class="req">${t('الدور')}</span><select name="roleId" ${isSelf ? 'disabled' : ''}>${roles.map(r => opt(r.id, r.name, r.id === u.roleId)).join('')}</select><div id="role-help">${roleHelp(u.roleId)}</div></label>
      <h4>${t('نطاق الشركات')}</h4>
      <label class="check full"><input type="radio" name="scope" value="all" ${u.allCompanies ? 'checked' : ''}> ${t('كل الشركات')}</label>
      <label class="check full"><input type="radio" name="scope" value="some" ${u.allCompanies ? '' : 'checked'}> ${t('شركات أو مراكز تكلفة محددة بس — ومايشوفش أي حاجة تانية')}</label>
      <div class="full" id="scope-box" style="grid-column:1/-1;${u.allCompanies ? 'display:none' : ''}">
        <div class="small muted" style="margin:4px 0">🏢 ${t('الشركات: الموظفين المسجّلين على الشركة + اللي على مراكز تكلفة تابعة لها')}</div>
        <div class="form">${scopedCompanies().map(c => `<label class="check"><input type="checkbox" data-co="${c.id}" ${u.companies.includes(c.id) ? 'checked' : ''}> ${esc(companyName(c.id))}</label>`).join('')}</div>
        <div class="small muted" style="margin:10px 0 4px">💼 ${t('مراكز التكلفة: كل موظفين المركز (مفيدة لمركز من غير شركة مسجّلة)')}</div>
        <div class="form">${STATE.costCenters.slice().sort((a, b) => (a.companyId ? 1 : 0) - (b.companyId ? 1 : 0)).map(c => `<label class="check"><input type="checkbox" data-cc="${c.id}" ${(u.costCenters || []).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}
          <span class="small muted">${c.companyId ? '(' + esc(companyName(c.companyId)) + ')' : '(' + t('من غير شركة') + ')'}</span></label>`).join('')}</div></div>
      </form>
      ${isSelf ? `<div class="notice">${t('ده حسابك: مش هينفع تغيّر دورك أو توقفه من هنا.')}</div>` : ''}`,
    foot: `${!isNew && !isSelf ? `<button class="btn danger" data-del>🗑️ ${t('حذف')}</button><span class="spacer"></span>` : ''}
      <button class="btn primary" data-save>💾 ${t('حفظ')}</button><button class="btn" data-close>إلغاء</button>`,
  });
  const f = $('#user-form', m.el);
  $('[name=roleId]', f).onchange = e => { $('#role-help', f).innerHTML = roleHelp(e.target.value); translateDomText($('#role-help', f)); };
  $$('[name=scope]', f).forEach(r => r.onchange = () => { $('#scope-box', f).style.display = $('[name=scope]:checked', f).value === 'all' ? 'none' : ''; });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(f);
    delete d.scope;
    d.allCompanies = $('[name=scope]:checked', f).value === 'all';
    d.companies = $$('[data-co]', f).filter(x => x.checked).map(x => x.dataset.co);
    d.costCenters = $$('[data-cc]', f).filter(x => x.checked).map(x => x.dataset.cc);
    if (!d.password) delete d.password;
    if (u.custodyCodeLocked) delete d.custodyCode; else if (d.custodyCode) d.custodyCode = d.custodyCode.toUpperCase();
    if (isSelf) { delete d.active; delete d.roleId; }
    if (!isNew) delete d.username;
    try {
      await api(isNew ? 'POST' : 'PUT', isNew ? '/api/users' : '/api/users/' + u.id, d);
      toast('تم الحفظ', 'ok'); m.close(); done();
      if (isSelf) reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const del = $('[data-del]', m.el);
  if (del) del.onclick = async () => {
    if (!await openConfirm(`${t('حذف المستخدم')} «${esc(u.username)}»؟ ${t('لو عايز تمنعه بس من الدخول، الأفضل توقف الحساب.')}`, { danger: true, okLabel: t('حذف') })) return;
    try { await api('DELETE', '/api/users/' + u.id); m.close(); done(); } catch (e) { toast(e.message, 'err'); }
  };
}

function openRoleEditModal(r, catalog, done, allRoles = []) {
  const isNew = !r;
  r = r || { name: '', description: '', permissions: [], isAdmin: false, isSystem: false, userCount: 0 };
  const has = new Set(r.permissions);
  const box = (key, extra = '') => `<input type="checkbox" data-perm="${key}" ${r.isAdmin || has.has(key) ? 'checked' : ''} ${r.isAdmin ? 'disabled' : ''} ${extra}>`;
  const m = openModal({
    title: isNew ? t('إضافة دور') : t('تعديل دور') + ': ' + esc(r.name), size: 'wide',
    body: `<form class="form" id="role-form">
      <label><span class="req">${t('اسم الدور')}</span><input name="name" value="${esc(r.name)}" placeholder="${t('مثلًا: مسؤول شؤون الموظفين')}"></label>
      <label class="full">${t('الوصف')}<input name="description" value="${esc(r.description || '')}"></label></form>
      ${r.isAdmin ? `<div class="notice">${t('مدير النظام عنده كل الصلاحيات دايمًا على كل الشركات، ومعاها إدارة المستخدمين والاستعادة.')}</div>` : ''}
      <h4>${t('الأقسام')}</h4>
      <div class="table-wrap"><table class="data" id="perm-matrix"><thead><tr><th>${t('القسم')}</th>${PERM_ACTIONS.map(a => `<th style="text-align:center">${t(PERM_LABELS.actions[a])}</th>`).join('')}</tr></thead><tbody>
      ${catalog.modules.map(mod => `<tr><td>${esc(t(mod.label))}</td>${PERM_ACTIONS.map(a => `<td style="text-align:center">${mod.actions.includes(a) ? box(`${mod.key}.${a}`) : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <h4>🔒 ${t('البيانات الحساسة')} <span class="small muted">${t('(من غيرها البيانات دي مابتوصلش لجهاز المستخدم أصلًا)')}</span></h4>
      <div class="form">${catalog.sensitive.map(s => `<label class="check">${box(s.key)} ${esc(t(s.label))}</label>`).join('')}</div>
      <p class="small muted">${t('إنشاء عقد العمل محتاج «المرتب» كمان، لأن العقد فيه الراتب.')}</p>
      <h4>⚙️ ${t('النظام')}</h4>
      <div class="form">${catalog.system.map(s => `<label class="check">${box(s.key)} ${esc(t(s.label))}</label>`).join('')}</div>
      <p class="small muted">${t('الاستيراد والنسخة الاحتياطية محتاجين كمان كل البيانات الحساسة ونطاق كل الشركات.')}</p>
      ${!isNew && r.userCount ? `<div class="notice warn">${t('التعديل هيتطبق فورًا على')} ${r.userCount} ${t('مستخدم')}.</div>` : ''}`,
    foot: `${!isNew && !r.isAdmin ? `<button class="btn danger" data-del>🗑️ ${t('حذف')}</button><span class="spacer"></span>` : ''}
      <button class="btn primary" data-save>💾 ${t('حفظ')}</button><button class="btn" data-close>إلغاء</button>`,
  });
  // تعديل/حذف ← لازم «عرض»، وشيل «عرض» ← يشيل الباقي
  $$('[data-perm]', m.el).forEach(cb => cb.onchange = () => {
    const [mod, act] = cb.dataset.perm.split('.');
    const peer = a => $(`[data-perm="${mod}.${a}"]`, m.el);
    if (cb.checked && (act === 'edit' || act === 'delete') && peer('view')) peer('view').checked = true;
    if (!cb.checked && act === 'view') ['edit', 'delete'].forEach(a => { if (peer(a)) peer(a).checked = false; });
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues($('#role-form', m.el));
    d.permissions = $$('[data-perm]', m.el).filter(x => x.checked).map(x => x.dataset.perm);
    try {
      await api(isNew ? 'POST' : 'PUT', isNew ? '/api/roles' : '/api/roles/' + encodeURIComponent(r.id), d);
      toast('تم الحفظ', 'ok'); m.close(); USERS_TAB = 'roles'; done();
      if (!isNew && r.id === STATE.me.roleId) reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const del = $('[data-del]', m.el);
  if (del) del.onclick = () => openRoleDeleteModal(r, allRoles, () => { m.close(); USERS_TAB = 'roles'; done(); });
}

/** حذف دور: لو عليه مستخدمين لازم تختار دور ينتقلوا له */
function openRoleDeleteModal(r, allRoles, done) {
  const others = allRoles.filter(x => x.id !== r.id);
  const def = others.find(x => x.id === 'viewer') || others.find(x => !x.isAdmin) || others[0];
  const m = openModal({
    title: '🗑️ ' + t('حذف الدور') + ': ' + esc(r.name), size: 'narrow',
    body: r.userCount
      ? `<div class="notice warn">${t('الدور ده عليه')} ${r.userCount} ${t('مستخدم')}. ${t('اختار الدور اللي هينتقلوا له:')}</div>
        <div class="form"><label class="full">${t('ينتقلوا لدور')}<select id="role-move">${others.map(x => opt(x.id, x.name, def && x.id === def.id)).join('')}</select></label></div>`
      : `<div>${t('حذف الدور ده نهائيًا؟')}</div>`,
    foot: `<button class="btn danger solid" data-ok>🗑️ ${t('حذف')}</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-ok]', m.el).onclick = async () => {
    const mv = $('#role-move', m.el);
    const q = mv ? '?moveTo=' + encodeURIComponent(mv.value) : '';
    try {
      const res = await api('DELETE', '/api/roles/' + encodeURIComponent(r.id) + q);
      toast(res.moved ? `${t('تم الحذف')} — ${res.moved} ${t('مستخدم اتنقلوا')}` : 'تم الحذف', 'ok');
      m.close(); done();
      if (res.moved) reload();
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* =====================================================================
   التشغيل — initCapabilities
   ===================================================================== */
async function initCapabilities() {
  applyStaticTranslations();
  $('#btn-theme').onclick = toggleTheme;
  $('#btn-lang').onclick = toggleLang;
  $('#btn-alerts').onclick = () => $('#alert-panel') ? closeSidePanel() : renderAlertCenterPanel();
  $('#btn-user').onclick = (e) => { e.stopPropagation(); const m = $('#user-menu'); renderUserMenu(); translateDomText(m); m.hidden = !m.hidden; };
  document.addEventListener('click', (e) => { if (!e.target.closest('#user-menu')) $('#user-menu').hidden = true; });
  const gs = $('#global-search');
  gs.addEventListener('input', debounce(() => renderGlobalSearchResults(gs.value), 150));
  gs.addEventListener('blur', () => setTimeout(() => $('#search-results').hidden = true, 150));
  gs.addEventListener('focus', () => gs.value && renderGlobalSearchResults(gs.value));
  gs.addEventListener('keydown', (e) => {
    const items = $$('#search-results .item');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      SEARCH_ACTIVE = Math.max(0, Math.min(items.length - 1, SEARCH_ACTIVE + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((x, i) => x.classList.toggle('active', i === SEARCH_ACTIVE));
    } else if (e.key === 'Enter') pickSearch(SEARCH_ACTIVE < 0 ? 0 : SEARCH_ACTIVE);
    else if (e.key === 'Escape') { $('#search-results').hidden = true; gs.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const ov = $$('#modal-root .overlay').pop(); if (ov) ov.remove(); else closeSidePanel(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); gs.focus(); }
  });
  // تحديث البيانات عند الرجوع للتبويب (لو مستخدم تاني عدّل) — بدون مقاطعة نافذة مفتوحة
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('#modal-root .overlay')) reload().catch(() => {});
  });
  try { await reload(); } catch (e) { $('#content').innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}
document.addEventListener('DOMContentLoaded', initCapabilities);
