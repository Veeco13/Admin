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
  { id: 'employees',   label: 'الإقامات والموظفين',      ico: '👥', render: () => renderEmployees() },
  { id: 'companies',   label: 'الشركات والمشاريع',       ico: '🏢', render: () => renderCompanies() },
  { id: 'vehicles',    label: 'السيارات',               ico: '🚗', render: () => renderVehicles() },
  { id: 'costcenters', label: 'مراكز التكلفة',           ico: '💼', render: () => renderCostCenters() },
  { id: 'contract',    label: 'عقد العمل',              ico: '📄', render: () => renderContractView() },
  { id: 'recruitment', label: 'الاستقدام والتوظيف',      ico: '🧭', render: () => renderRecruitment() },
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
const EMP_STATUS_LABELS = {
  active:             { ar: 'في الخدمة',       en: 'In Service' },
  warning:            { ar: 'في فترة الإنذار',  en: 'Warning Period' },
  terminated:         { ar: 'منتهي خدمته',     en: 'Terminated' },
  pending_completion: { ar: 'قيد الاستكمال',    en: 'Pending Completion' },
};
const RECRUIT_STAGES_OUTSIDE = [
  { id: 'work_permit',           label: 'استخراج تصريح العمل' },
  { id: 'work_visa',             label: 'إصدار تأشيرة العمل' },
  { id: 'medical_exam',          label: 'الفحص الطبي ونتيجته' },
  { id: 'foreign_ministry_auth', label: 'تصديق الأوراق من الخارجية' },
  { id: 'work_license',          label: 'إصدار إذن العمل' },
  { id: 'health_insurance',      label: 'إصدار الضمان الصحي' },
  { id: 'residency_issue',       label: 'إصدار الإقامة' },
  { id: 'civil_id_issue',        label: 'إصدار البطاقة المدنية' },
  { id: 'all_completed',         label: '✅ تم إنجاز جميع الإجراءات', final: true },
];
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
const TIERS = {
  expired: { label: 'منتهي',          cls: 't-expired' },
  d30:     { label: 'خلال 30 يوم',    cls: 't-d30' },
  d60:     { label: 'خلال 60 يوم',    cls: 't-d60' },
  d90:     { label: 'خلال 90 يوم',    cls: 't-d90' },
  ok:      { label: 'سارية',          cls: 't-ok' },
  none:    { label: 'بدون تاريخ',     cls: 't-none' },
};
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
  };
}
function companyName(id) { const c = IDX.company[id]; return c ? (LANG === 'en' && c.nameEn ? c.nameEn : c.nameAr) : ''; }
function projectName(id) { const p = IDX.project[id]; return p ? (LANG === 'en' && p.nameEn ? p.nameEn : p.nameAr) : ''; }
function empName(e) { return e ? (LANG === 'en' && e.nameEn ? e.nameEn : e.name) : ''; }
function primaryAff(e) { return (e.affiliations && e.affiliations[0]) || {}; }
function empCompanyId(e) { return primaryAff(e).companyId || null; }
function isReadOnly() { return !!(STATE && STATE.me && STATE.me.readOnly); }

/* ---------- الصلاحيات (من السيرفر — هو اللي بيفرضها، والواجهة بتخفي بس) ----------
   can('employees.edit') · أي عنصر عليه data-p="مفتاح [مفتاح…]" بيختفي لو أي مفتاح منهم مش مسموح.
   scope.all = نطاق كل الشركات. */
const PERM_KEYS = [
  ...['employees', 'companies', 'vehicles', 'costcenters', 'recruitment'].flatMap(m => ['view', 'edit', 'delete'].map(a => `${m}.${a}`)),
  'contract.view', 'contract.edit', 'companylog.view',
  'sensitive.salary', 'sensitive.bank', 'sensitive.documents', 'system.import', 'system.backup', 'contract.sign', 'scope.all', 'admin',
];
const VIEW_PERM = { employees: 'employees.view', companies: 'companies.view', vehicles: 'vehicles.view', costcenters: 'costcenters.view',
  contract: 'contract.view employees.view sensitive.salary', recruitment: 'recruitment.view', companylog: 'companylog.view' };
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
function viewAllowed(id) { return !VIEW_PERM[id] || canAll(VIEW_PERM[id]); }
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
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.data = j; e.status = r.status; throw e; }
  return j;
}
/** persist(): تنفيذ تعديل على السيرفر ثم إعادة تحميل الحالة وإعادة العرض */
async function persist(method, url, body, okMsg) {
  try {
    const res = await api(method, url, body);
    await reload();
    if (okMsg) toast(okMsg, 'ok');
    return res;
  } catch (e) {
    if (e.status === 409 && e.data && e.data.warn) throw e;
    toast(e.message, 'err');
    throw e;
  }
}
async function reload(noRender) {
  STATE = await api('GET', '/api/state');
  buildIndex();
  applyPermStyles();
  document.body.classList.toggle('readonly', isReadOnly());
  $('#user-name').textContent = STATE.me.displayName || STATE.me.username;
  if (!noRender) render();
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
function markBackupTaken() { lsSet('mv_last_backup', new Date().toISOString()); }
function daysSinceLastBackup() {
  const s = lsGet('mv_last_backup');
  if (!s) return Infinity;
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
}
function takeBackup() {
  markBackupTaken();
  const a = document.createElement('a'); a.href = '/api/backup'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(render, 500);
}
const BACKUP_PERMS = 'system.backup sensitive.salary sensitive.bank sensitive.documents scope.all';
async function restoreBackup() {
  if (!can('admin')) return openBlockAlert(t('الاستعادة لمدير النظام فقط'));
  const f = await pickFile('.json,application/json');
  if (!f) return;
  if (!await openConfirm(t('سيتم استبدال كل البيانات الحالية بمحتوى النسخة الاحتياطية. متابعة؟'), { danger: true, okLabel: t('استعادة') })) return;
  const fd = new FormData(); fd.append('file', f);
  await persist('POST', '/api/restore', fd, 'تمت الاستعادة بنجاح');
}

/* =====================================================================
   UI STATE — حفظ الفلاتر والصفحة
   ===================================================================== */
let UI = Object.assign({
  emp: { q: '', company: '', link: '', project: '', status: '', stage: '', nationality: '', costCenter: '', tier: '', tierField: 'any', driver: false, sort: 'name', dir: 1, page: 1, perPage: 50 },
  cand: { q: '', source: '', stage: '', company: '' },
  log: { tab: 'history', company: '', category: '', q: '' },
  vehicles: { q: '' },
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
function trackedAlertItems(maxDays = 90) {
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
    if (e.employmentStatus === 'terminated') continue;
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
  for (const p of STATE.projects) if (companyInScope(p.companyId)) push({ kind: 'project', refId: p.companyId, name: projectName(p.id), what: 'المشروع', date: p.expiryDate });
  for (const v of STATE.vehicles) if (companyInScope(v.companyId)) {
    push({ kind: 'vehicle', refId: v.id, name: v.plate, what: 'تأمين السيارة', date: v.insuranceExpiry });
    push({ kind: 'vehicle', refId: v.id, name: v.plate, what: 'دفتر السيارة', date: v.govLicenseExpiry });
  }
  for (const c of STATE.candidates) {
    if (c.stage === 'rejected' || c.stage === 'all_completed') continue;
    if (c.source !== 'internal') {
      push({ kind: 'candidate', refId: c.id, name: c.name, what: 'تأشيرة المترشّح', date: c.visaExp });
      if (c.entryDate) push({ kind: 'candidate', refId: c.id, name: c.name, what: 'مهلة 60 يوم من الدخول', date: addDays(c.entryDate, 60) });
    } else {
      push({ kind: 'candidate', refId: c.id, name: c.name, what: 'إقامة الكفيل القديم', date: c.oldSponsorResidencyExp });
    }
  }
  return items.sort((a, b) => a.days - b.days);
}
function openAlertTarget(it) {
  closeSidePanel();
  if (it.kind === 'employee') openProfileCard(it.refId);
  else if (it.kind === 'company' || it.kind === 'project') { VIEW_ARGS = { focusCompany: it.refId }; setView('companies'); }
  else if (it.kind === 'vehicle') { setView('vehicles'); setTimeout(() => openVehicleModal(it.refId), 50); }
  else if (it.kind === 'candidate') { setView('recruitment'); setTimeout(() => openCandidateModal(it.refId), 50); }
}
function renderAlertCenterPanel(filter = 'all') {
  const items = trackedAlertItems();
  const counts = { all: items.length };
  for (const k of ['expired', 'd30', 'd60', 'd90']) counts[k] = items.filter(i => i.tier === k).length;
  const shown = filter === 'all' ? items : items.filter(i => i.tier === filter);
  const root = $('#side-root');
  root.innerHTML = `<div class="side-panel" id="alert-panel">
    <div class="modal-head"><h2>🔔 مركز التنبيهات</h2><button class="btn ghost" id="close-side">✕</button></div>
    <div style="padding:8px 14px" class="row">
      ${['all', 'expired', 'd30', 'd60', 'd90'].map(k => `<span class="chip clickable ${filter === k ? 'on' : ''}" data-f="${k}">${k === 'all' ? t('الكل') : t(TIERS[k].label)} (${counts[k]})</span>`).join('')}
    </div>
    <div class="body">${shown.length ? shown.map((it, i) => `
      <div class="alert-item" data-i="${i}">
        <div><b>${esc(it.name)}</b><div class="small muted">${esc(t(it.what))} · ${esc(t({ employee: 'موظف', company: 'شركة', project: 'مشروع', vehicle: 'سيارة', candidate: 'مترشّح' }[it.kind]))}</div></div>
        <div style="text-align:end">${datePill(it.date)}<div class="small muted">${esc(daysText(it.days))}</div></div>
      </div>`).join('') : '<div class="empty">لا توجد تنبيهات 🎉</div>'}</div></div>`;
  translateDomText(root);
  $('#close-side').onclick = closeSidePanel;
  $$('#alert-panel [data-f]').forEach(c => c.onclick = () => renderAlertCenterPanel(c.dataset.f));
  $$('#alert-panel .alert-item').forEach(el => el.onclick = () => openAlertTarget(shown[+el.dataset.i]));
}
function closeSidePanel() { $('#side-root').innerHTML = ''; }
function updateAlertCount() {
  const n = trackedAlertItems().filter(i => i.days <= 30).length;
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
    add('الشركات', companyName(c.id), c.mainFileNumber || '', () => { VIEW_ARGS = { focusCompany: c.id }; setView('companies'); });
  for (const p of scopedProjects()) if ([p.nameAr, p.nameEn, p.fileNumber].some(v => norm(v).includes(n)))
    add('المشاريع', projectName(p.id), companyName(p.companyId), () => { VIEW_ARGS = { focusCompany: p.companyId }; setView('companies'); });
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
  const stuck = scopedEmployees().filter(e => e.govStageNote && e.employmentStatus !== 'terminated').length;
  let html = '';
  if (expired || week || stuck) {
    const parts = [];
    if (expired) parts.push(`⛔ ${expired} ${t('تاريخ منتهي')}`);
    if (week) parts.push(`⏰ ${week} ${t('ينتهي خلال 7 أيام')}`);
    if (stuck) parts.push(`⚠️ ${stuck} ${t('معاملة عليها ملاحظة تعطّل')}`);
    html += `<div class="alertbar no-print" id="alertbar"><b>${t('تنبيه')}:</b> ${parts.join(' · ')} <span class="spacer"></span><u>${t('عرض التفاصيل')}</u></div>`;
  }
  const days = daysSinceLastBackup();
  const dismissed = lsGet('mv_backup_reminder_dismiss') === todayISO();
  if (days > 7 && !dismissed && canAll(BACKUP_PERMS)) {
    html += `<div class="alertbar backup no-print">💾 ${days === Infinity ? t('لم يتم أخذ نسخة احتياطية من هذا المتصفح بعد') : t('آخر نسخة احتياطية منذ') + ' ' + days + ' ' + t('يوم')}
      <span class="spacer"></span><button class="btn sm" id="bk-now">${t('نسخ احتياطي الآن')}</button><button class="btn sm ghost" id="bk-dismiss">${t('إخفاء اليوم')}</button></div>`;
  }
  return html;
}
function bindAlertBar() {
  const ab = $('#alertbar'); if (ab) ab.onclick = () => renderAlertCenterPanel();
  const b1 = $('#bk-now'); if (b1) b1.onclick = takeBackup;
  const b2 = $('#bk-dismiss'); if (b2) b2.onclick = () => { lsSet('mv_backup_reminder_dismiss', todayISO()); render(); };
}
function render() {
  if (!STATE) return;
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
    ${canAll(BACKUP_PERMS) ? `<button data-a="backup">💾 ${t('تنزيل نسخة احتياطية')}</button>` : ''}
    ${me.isAdmin ? `<button data-a="restore">♻️ ${t('استعادة نسخة احتياطية')}</button><button data-a="users">🔑 ${t('المستخدمين والصلاحيات')}</button>` : ''}
    <button data-a="viewperms">👁️ ${t('إعدادات العرض')}</button>
    <button data-a="password">🔒 ${t('تغيير كلمة المرور')}</button>
    <button data-a="logout">🚪 ${t('تسجيل الخروج')}</button>`;
  $$('button', m).forEach(b => b.onclick = () => {
    m.hidden = true;
    ({ backup: takeBackup, restore: restoreBackup, users: () => openUsersModal(), viewperms: renderViewSettingsModal,
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
    body: `<div class="form"><label class="full">كلمة المرور الحالية<input type="password" name="old"></label><label class="full">كلمة المرور الجديدة<input type="password" name="new"></label></div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  m.el.querySelector('[data-save]').onclick = async () => {
    try { await api('POST', '/api/me/password', formValues(m.el)); m.close(); toast('تم تغيير كلمة المرور', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
}

/* =====================================================================
   المستخدمين والأدوار والصلاحيات (لمدير النظام)
   ===================================================================== */
const PERM_ACTIONS = ['view', 'edit', 'delete'];
const PERM_LABELS = {
  modules: {
    employees: 'الإقامات والموظفين', companies: 'الشركات والمشاريع والمفوّضين', vehicles: 'السيارات', costcenters: 'مراكز التكلفة',
    recruitment: 'الاستقدام والتوظيف', contract: 'عقود العمل والقوالب', companylog: 'السجل التاريخي والتدقيق',
  },
  actions: { view: 'عرض', edit: 'إضافة وتعديل', delete: 'حذف' },
  other: {
    'sensitive.salary': 'المرتب وبدل السكن وتكلفة المعاملات', 'sensitive.bank': 'البنك والـ IBAN',
    'sensitive.documents': 'رقم الجواز والمرفقات', 'system.import': 'استيراد الموظفين من Excel/CSV', 'system.backup': 'تنزيل نسخة احتياطية كاملة',
    'contract.sign': 'طباعة العقود بالتوقيعات المرفوعة (المفوّض والموظف)',
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
      <td>${esc(u.jobTitle || '')}</td>
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
      <label>${t('البريد')}<input name="email" value="${v('email')}" dir="ltr"></label>
      <label>${t('الهاتف')}<input name="phone" value="${v('phone')}" dir="ltr"></label>
      <label>${isNew ? `<span class="req">${t('كلمة المرور')}</span>` : t('كلمة مرور جديدة (سيبها فاضية لو مش هتغيّرها)')}<input name="password" type="password" autocomplete="new-password" minlength="6"></label>
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
