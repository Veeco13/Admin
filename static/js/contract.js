/* =====================================================================
   CONTRACT GENERATOR — شاشة عقد العمل والمعاينة
   ⚠️ محرك العقود مُجمَّد (docx_engine.py) — الشاشة دي بتستدعيه بس.
   ===================================================================== */
'use strict';

const CONTRACT_FIELDS_HELP = [
  ['employee_name', 'اسم الموظف'], ['employee_name_en', 'الاسم بالإنجليزي'], ['civil_id', 'الرقم المدني'],
  ['nationality', 'الجنسية'], ['nationality_en', 'الجنسية بالإنجليزي'], ['profession', 'المهنة'], ['profession_en', 'المهنة بالإنجليزي'],
  ['salary', 'الراتب'], ['housing_amount', 'بدل السكن'], ['start_date', 'تاريخ العقد'], ['day_name', 'اليوم'], ['day_name_en', 'اليوم بالإنجليزي'],
  ['company_name', 'اسم الشركة'], ['company_name_en', 'اسم الشركة بالإنجليزي'], ['labor_office', 'إدارة العمل'], ['file_number', 'رقم الملف'],
  ['project_name', 'المشروع'], ['auth_name', 'المفوّض بالتوقيع'], ['auth_name_en', 'المفوّض بالإنجليزي'], ['auth_civil_id', 'الرقم المدني للمفوّض'],
  ['passport_no', 'رقم الجواز'], ['residency_exp', 'انتهاء الإقامة'],
];
let CONTRACT = { emp: '', tpl: '', company: '', sig: '', date: '', salary: '' };

function contractQuery(extra = {}) {
  const p = new URLSearchParams();
  Object.entries(Object.assign({}, CONTRACT, extra)).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString();
}

function renderContractView() {
  if (VIEW_ARGS.emp) { CONTRACT = { emp: VIEW_ARGS.emp, tpl: CONTRACT.tpl, company: '', sig: '', date: '', salary: '' }; VIEW_ARGS = {}; }
  const e = IDX.employee[CONTRACT.emp];
  const defTpl = STATE.templates.find(x => x.isDefault) || STATE.templates[0];
  if (!CONTRACT.tpl || !IDX.template[CONTRACT.tpl]) CONTRACT.tpl = defTpl ? defTpl.id : '';
  const coId = CONTRACT.company || (e ? empCompanyId(e) : '');
  const sigs = coId && IDX.company[coId] ? IDX.company[coId].signatories : STATE.companies.flatMap(c => c.signatories);
  if (CONTRACT.sig && !sigs.find(s => s.id === CONTRACT.sig)) CONTRACT.sig = '';
  const empList = scopedEmployees().filter(x => x.employmentStatus !== 'terminated');

  viewRoot().innerHTML = `<div class="page-head"><div><h1>عقد العمل</h1><div class="sub">${t('ملف Word بنفس تنسيق القالب الأصلي')}</div></div></div>
    <div class="contract-layout">
      <div class="card no-print">
        <div class="form" style="grid-template-columns:1fr">
          <label><span class="req">${t('الموظف')}</span><input id="c-emp" list="c-emp-list" placeholder="اكتب الاسم أو الرقم المدني…" value="${e ? esc(e.name + ' — ' + e.id) : ''}"></label>
          <datalist id="c-emp-list">${empList.map(x => `<option value="${esc(x.name + ' — ' + x.id)}">`).join('')}</datalist>
          <label>${t('القالب')}<select id="c-tpl">${STATE.templates.map(x => opt(x.id, (x.isDefault ? '★ ' : '') + x.name, x.id === CONTRACT.tpl)).join('')}</select></label>
          <label>${t('الشركة (الطرف الأول)')}<select id="c-co">${companyOptions(coId, '— شركة الموظف —')}</select></label>
          <label>${t('المفوّض بالتوقيع')}<select id="c-sig">${opt('', t('— أول مفوّض في الشركة —'), !CONTRACT.sig)}${sigs.map(s => opt(s.id, s.nameAr + (s.civilId ? ' (' + s.civilId + ')' : ''), s.id === CONTRACT.sig)).join('')}</select></label>
          <label>${t('تاريخ العقد')}<input type="date" id="c-date" value="${esc(CONTRACT.date || (e && e.dateOfHire) || '')}"></label>
          <label>${t('الراتب في العقد (اختياري)')}<input type="number" step="0.001" id="c-salary" placeholder="${e && e.salary ? esc(e.salary) : ''}" value="${esc(CONTRACT.salary)}"></label>
        </div>
        ${e ? contractWarnings(e, coId) : ''}
        <div class="row" style="margin-top:12px">
          <a class="btn primary ${e ? '' : 'disabled'}" id="c-docx" ${e ? `href="/api/contract/docx?${contractQuery()}"` : ''}>⬇️ Word</a>
          ${STATE.pdfAvailable ? `<a class="btn ${e ? '' : 'disabled'}" id="c-pdf" ${e ? `href="/api/contract/pdf?${contractQuery({ dl: 1 })}"` : ''}>⬇️ PDF</a>` : ''}
          <button class="btn" id="c-print" ${e ? '' : 'disabled'}>🖨️ ${t('طباعة')}</button>
        </div>
        ${!STATE.pdfAvailable ? `<div class="small muted" style="margin-top:6px">${t('تحويل PDF محتاج LibreOffice على السيرفر.')}</div>` : ''}
        <hr class="sep">
        <h3>📑 ${t('قوالب العقود')}</h3>
        ${STATE.templates.map(x => `<div class="row small" style="padding:4px 0;border-bottom:1px dashed var(--border)">
          <span style="flex:1">${x.isDefault ? '★ ' : ''}${esc(x.name)}</span>
          <a class="btn sm" href="/api/templates/${x.id}/file" title="تنزيل القالب">⬇️</a>
          ${!x.isDefault ? `<button class="btn sm write-only" data-tdef="${x.id}" title="جعله الافتراضي">★</button><button class="btn sm danger write-only" data-tdel="${x.id}">✕</button>` : ''}</div>`).join('')}
        <button class="btn write-only" id="t-upload" style="margin-top:8px">➕ ${t('رفع قالب جديد')}</button>
        <details style="margin-top:10px"><summary class="small">${t('الحقول المتاحة في القوالب')}</summary>
          <div class="small" data-no-i18n style="direction:ltr;text-align:left">${CONTRACT_FIELDS_HELP.map(([k, l]) => `<div><code>{{ ${k} }}</code> <span class="muted">${esc(t(l))}</span></div>`).join('')}</div></details>
      </div>
      <div><div class="contract-paper" id="c-preview" dir="rtl">${e ? `<div class="empty">${t('جاري تجهيز المعاينة…')}</div>` : `<div class="empty">${t('اختر موظف لعرض معاينة العقد')}</div>`}</div></div>
    </div>`;

  const set = (patch) => { Object.assign(CONTRACT, patch); render(); };
  $('#c-emp').addEventListener('change', ev => {
    const m = ev.target.value.match(/(\d{6,14})\s*$/);
    if (m && IDX.employee[m[1]]) set({ emp: m[1], company: '', sig: '', date: '', salary: '' });
  });
  $('#c-tpl').onchange = ev => set({ tpl: ev.target.value });
  $('#c-co').onchange = ev => set({ company: ev.target.value, sig: '' });
  $('#c-sig').onchange = ev => set({ sig: ev.target.value });
  $('#c-date').onchange = ev => set({ date: ev.target.value });
  $('#c-salary').onchange = ev => set({ salary: ev.target.value });
  $('#c-print').onclick = () => printHtml(t('عقد عمل'), `<style>td{width:50%;vertical-align:top;padding:8px}p{margin:0 0 3px}body{font-family:"Times New Roman",serif;line-height:1.7}@page{size:A4 portrait}</style>` + $('#c-preview').innerHTML);
  $('#t-upload').onclick = openTemplateUploadModal;
  $$('[data-tdef]').forEach(b => b.onclick = () => persist('POST', `/api/templates/${b.dataset.tdef}/default`, {}, 'تم'));
  $$('[data-tdel]').forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف القالب؟'), { danger: true })) persist('DELETE', '/api/templates/' + b.dataset.tdel, undefined, 'تم الحذف'); });
  if (e) buildContractHtml();
}

function contractWarnings(e, coId) {
  const w = [];
  if (!e.nameEn) w.push('الاسم بالإنجليزي');
  if (!e.salary && !CONTRACT.salary) w.push('الراتب');
  if (!e.nationalityEn && !e.nationality) w.push('الجنسية');
  if (!e.professionEn) w.push('المهنة بالإنجليزي');
  if (!coId) w.push('الشركة');
  else if (!(IDX.company[coId].signatories || []).length) w.push('مفوّض بالتوقيع للشركة');
  if (!CONTRACT.date && !e.dateOfHire) w.push('تاريخ العقد');
  return w.length ? `<div class="notice warn" style="margin-top:10px">${t('بيانات ناقصة في العقد')}: ${w.map(x => esc(t(x))).join('، ')}</div>` : '';
}

async function buildContractHtml() {
  const box = $('#c-preview');
  try {
    const r = await api('GET', '/api/contract/preview?' + contractQuery());
    if ($('#c-preview') === box) box.innerHTML = r.html;
  } catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

function openTemplateUploadModal() {
  const m = openModal({
    title: t('رفع قالب عقد جديد'), size: 'narrow',
    body: `<div class="form"><label class="full"><span class="req">${t('اسم القالب')}</span><input name="name" placeholder="مثال: عقد حكومي، عقد أهلي…"></label>
      <label class="full"><span class="req">${t('ملف القالب (Word .docx)')}</span><input type="file" id="tpl-file" accept=".docx"></label></div>
      <div class="small muted" data-no-i18n>${t('اكتب الحقول داخل الملف بين قوسين مزدوجين، مثال:')} <code dir="ltr">{{ employee_name }}</code></div>`,
    foot: `<button class="btn primary" data-save>رفع</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const f = $('#tpl-file', m.el).files[0];
    const name = $('[name="name"]', m.el).value.trim();
    if (!f || !name) return toast('اسم القالب وملف Word (.docx) مطلوبين', 'err');
    const fd = new FormData(); fd.append('file', f); fd.append('name', name);
    const r = await persist('POST', '/api/templates', fd, 'تم رفع القالب');
    m.close();
    if (r && r.fields) toast(t('الحقول المكتشفة') + ': ' + (r.fields.join(', ') || '—'), 'ok');
  };
}

/* =====================================================================
   COMPANY LOG / AUDIT LOG — السجل التاريخي وسجل التدقيق
   ===================================================================== */
const COMPANY_HISTORY_TYPES = {
  company_created: '🏢 إنشاء الشركة', license_renewed: '📜 تجديد الرخصة', traffic_auth: '🚦 تفويض المرور',
  civil_affairs_auth: '🪪 تفويض الشؤون المدنية', signatory_added: '✍️ إضافة مفوّض', project_added: '📁 إضافة مشروع',
  project_renewed: '🔄 تجديد مشروع', residency_renewed: '🛂 تجديد إقامة',
};
const AUDIT_CATEGORIES = { employee: 'الموظفين', candidate: 'المترشّحين', company: 'الشركات', vehicle: 'السيارات', backup: 'النسخ الاحتياطي' };

function renderCompanyLog() {
  const L = UI.log;
  const q = norm(L.q);
  let body;
  if (L.tab === 'history') {
    const list = STATE.companyHistory.filter(h => (!L.company || h.companyId === L.company) && companyInScope(h.companyId) && (!q || norm(h.label).includes(q)));
    body = `<div class="filters"><select id="l-co">${companyOptions(L.company, '— كل الشركات —')}</select><input type="search" id="l-q" placeholder="بحث…" value="${esc(L.q)}"></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('التاريخ')}</th><th>${t('الشركة')}</th><th>${t('النوع')}</th><th>${t('التفاصيل')}</th><th>${t('بواسطة')}</th></tr></thead><tbody>
      ${list.map(h => `<tr><td class="num small">${fmtDateTime(h.date)}</td><td>${esc(companyName(h.companyId))}</td><td>${esc(t(COMPANY_HISTORY_TYPES[h.type] || h.type))}</td><td>${esc(h.label)}</td><td class="small muted">${esc(h.user || '')}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">—</td></tr>`}
      </tbody></table></div>`;
  } else {
    const list = STATE.auditLog.filter(a => (!L.category || a.category === L.category) && (!q || norm(a.label + ' ' + (a.user || '')).includes(q)));
    body = `<div class="filters"><select id="l-cat">${opt('', t('— كل الأنواع —'), !L.category)}${Object.entries(AUDIT_CATEGORIES).map(([k, v]) => opt(k, t(v), k === L.category)).join('')}</select>
      <input type="search" id="l-q" placeholder="بحث…" value="${esc(L.q)}"><button class="btn sm" id="l-export">📤 CSV</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('التاريخ')}</th><th>${t('النوع')}</th><th>${t('التفاصيل')}</th><th>${t('المستخدم')}</th></tr></thead><tbody>
      ${list.map(a => `<tr><td class="num small">${fmtDateTime(a.date)}</td><td><span class="chip">${esc(a.type)}</span></td><td>${esc(a.label)}</td><td class="small muted">${esc(a.user || '')}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">—</td></tr>`}
      </tbody></table></div>`;
    setTimeout(() => { const b = $('#l-export'); if (b) b.onclick = () => downloadBlob(toCsv([['date', 'type', 'label', 'user'], ...list.map(a => [a.date, a.type, a.label, a.user])]), `audit-${todayISO()}.csv`, 'text/csv'); });
  }
  viewRoot().innerHTML = `<div class="page-head"><h1>السجل التاريخي والتدقيق</h1></div>
    <div class="tabs"><button data-t="history" class="${L.tab === 'history' ? 'active' : ''}">سجل الشركات التاريخي (${STATE.companyHistory.length})</button>
      <button data-t="audit" class="${L.tab === 'audit' ? 'active' : ''}">سجل التدقيق (${STATE.auditLog.length})</button></div>${body}`;
  $$('[data-t]', viewRoot()).forEach(b => b.onclick = () => { UI.log.tab = b.dataset.t; UI.log.q = ''; saveUiStateToLocalStorage(); render(); });
  const co = $('#l-co'); if (co) co.onchange = e => { UI.log.company = e.target.value; saveUiStateToLocalStorage(); render(); };
  const cat = $('#l-cat'); if (cat) cat.onchange = e => { UI.log.category = e.target.value; saveUiStateToLocalStorage(); render(); };
  $('#l-q').addEventListener('input', debounce(e => { UI.log.q = e.target.value; render(); const i = $('#l-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
}
