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

/* ---------- الصلاحيات حسب المتصفح (VIEW PERMISSIONS) ---------- */
function loadViewPerms() { return lsJson('mv_viewPerms', { hidden: [], companies: [] }); }
function saveViewPerms(p) { lsSet('mv_viewPerms', JSON.stringify(p)); }
function companyInScope(cid) { const p = loadViewPerms(); return !p.companies.length || p.companies.includes(cid); }
function scopedEmployees() {
  const p = loadViewPerms();
  if (!p.companies.length) return STATE.employees;
  return STATE.employees.filter(e => (e.affiliations || []).some(a => p.companies.includes(a.companyId)));
}
function scopedCompanies() { return STATE.companies.filter(c => companyInScope(c.id)); }
function applyNavVisibility() {
  const hidden = loadViewPerms().hidden || [];
  $$('#navrail button[data-view]').forEach(b => { b.hidden = hidden.includes(b.dataset.view); });
  if (hidden.includes(VIEW)) setView('dashboard');
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
  document.body.classList.toggle('readonly', isReadOnly());
  $('#ro-badge').hidden = !isReadOnly();
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
  return opt('', t(blank), !sel) + STATE.projects.filter(p => !companyId || p.companyId === companyId).map(p => opt(p.id, projectName(p.id), p.id === sel)).join('');
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
async function restoreBackup() {
  if (STATE.me.role !== 'admin') return openBlockAlert(t('الاستعادة لمدير النظام فقط'));
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
  emp: { q: '', company: '', project: '', status: '', stage: '', nationality: '', costCenter: '', tier: '', tierField: 'any', driver: false, sort: 'name', dir: 1, page: 1, perPage: 50 },
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
  ];
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
  const items = [];
  const push = (o) => { const d = daysUntil(o.date); if (d !== null && d <= maxDays) items.push({ ...o, days: d, tier: tierOf(o.date) }); };
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
  for (const p of STATE.projects) if ([p.nameAr, p.nameEn, p.fileNumber].some(v => norm(v).includes(n)))
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
  if (days > 7 && !dismissed && !isReadOnly()) {
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
  const role = { admin: 'مدير النظام', editor: 'محرر', viewer: 'مشاهد (قراءة فقط)' }[me.role];
  m.innerHTML = `<div class="info">${esc(me.displayName || me.username)}<br>${esc(t(role))}</div>
    <button data-a="backup">💾 ${t('تنزيل نسخة احتياطية')}</button>
    ${me.role === 'admin' ? `<button data-a="restore">♻️ ${t('استعادة نسخة احتياطية')}</button><button data-a="users">🔑 ${t('إدارة المستخدمين')}</button>` : ''}
    <button data-a="viewperms">👁️ ${t('إعدادات العرض')}</button>
    <button data-a="password">🔒 ${t('تغيير كلمة المرور')}</button>
    <button data-a="logout">🚪 ${t('تسجيل الخروج')}</button>`;
  $$('button', m).forEach(b => b.onclick = () => {
    m.hidden = true;
    ({ backup: takeBackup, restore: restoreBackup, users: openUsersModal, viewperms: renderViewSettingsModal,
       password: openPasswordModal, logout: () => location.href = '/logout' })[b.dataset.a]();
  });
}
function renderViewSettingsModal() {
  const p = loadViewPerms();
  const m = openModal({
    title: t('إعدادات العرض (لهذا المتصفح)'),
    body: `<div class="notice">${t('الإعدادات دي بتتحفظ على الجهاز ده بس، وبتخفي أقسام أو تحدد الشركات اللي تظهر بياناتها.')}</div>
      <h4>${t('الأقسام الظاهرة')}</h4>
      <div class="form">${VIEWS.filter(v => v.id !== 'dashboard').map(v => `<label class="check"><input type="checkbox" data-view="${v.id}" ${p.hidden.includes(v.id) ? '' : 'checked'}> ${esc(t(v.label))}</label>`).join('')}</div>
      <h4>${t('نطاق الشركات')} <span class="muted small">(${t('لو ما اخترتش حاجة = كل الشركات')})</span></h4>
      <div class="form">${STATE.companies.map(c => `<label class="check"><input type="checkbox" data-co="${c.id}" ${p.companies.includes(c.id) ? 'checked' : ''}> ${esc(companyName(c.id))}</label>`).join('')}</div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  m.el.querySelector('[data-save]').onclick = () => {
    saveViewPerms({
      hidden: $$('[data-view]', m.el).filter(x => !x.checked).map(x => x.dataset.view),
      companies: $$('[data-co]', m.el).filter(x => x.checked).map(x => x.dataset.co),
    });
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
async function openUsersModal() {
  const users = await api('GET', '/api/users');
  const roleSel = (r) => ['admin', 'editor', 'viewer'].map(x => opt(x, t({ admin: 'مدير النظام', editor: 'محرر', viewer: 'مشاهد (قراءة فقط)' }[x]), x === r)).join('');
  const m = openModal({
    title: t('إدارة المستخدمين'), size: 'wide',
    body: `<div class="table-wrap"><table class="data"><thead><tr><th>اسم المستخدم</th><th>الاسم الظاهر</th><th>الصلاحية</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr data-id="${u.id}"><td>${esc(u.username)}</td><td>${esc(u.display_name || '')}</td>
        <td><select data-role>${roleSel(u.role)}</select></td>
        <td class="row"><button class="btn sm" data-pw>كلمة مرور جديدة</button><button class="btn sm danger" data-del>حذف</button></td></tr>`).join('')}
      </tbody></table></div>
      <h4>${t('إضافة مستخدم')}</h4>
      <div class="form" id="new-user"><label>اسم المستخدم<input name="username"></label><label>الاسم الظاهر<input name="displayName"></label>
      <label>كلمة المرور<input name="password" type="password"></label><label>الصلاحية<select name="role">${roleSel('editor')}</select></label></div>`,
    foot: `<button class="btn primary" data-add>إضافة</button><button class="btn" data-close>إغلاق</button>`,
  });
  $$('tr[data-id]', m.el).forEach(tr => {
    const id = tr.dataset.id;
    $('[data-role]', tr).onchange = async (e) => { try { await api('PUT', '/api/users/' + id, { role: e.target.value }); toast('تم الحفظ', 'ok'); } catch (er) { toast(er.message, 'err'); } };
    $('[data-pw]', tr).onclick = async () => { const p = prompt(t('كلمة المرور الجديدة')); if (p) { await api('PUT', '/api/users/' + id, { password: p }); toast('تم الحفظ', 'ok'); } };
    $('[data-del]', tr).onclick = async () => { if (await openConfirm(t('حذف المستخدم؟'), { danger: true })) { try { await api('DELETE', '/api/users/' + id); m.close(); openUsersModal(); } catch (er) { toast(er.message, 'err'); } } };
  });
  m.el.querySelector('[data-add]').onclick = async () => {
    try { await api('POST', '/api/users', formValues($('#new-user', m.el))); m.close(); openUsersModal(); toast('تمت الإضافة', 'ok'); } catch (e) { toast(e.message, 'err'); }
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
