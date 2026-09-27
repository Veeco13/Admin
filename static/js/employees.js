/* =====================================================================
   EMPLOYEES VIEW — مركز إدارة الإقامات والموظفين
   ===================================================================== */
'use strict';

let EMP_SELECTED = new Set();

const EMP_COLUMNS = [
  { key: 'name', label: 'الاسم', get: e => empName(e) },
  { key: 'id', label: 'الرقم المدني', get: e => e.id },
  { key: 'nationality', label: 'الجنسية', get: e => e.nationality || '' },
  { key: 'profession', label: 'المهنة', get: e => e.profession || '' },
  { key: 'company', label: 'الشركة / المشروع', get: e => companyName(empCompanyId(e)) + ' ' + projectName(primaryAff(e).projectId) },
  { key: 'residencyExp', label: 'الإقامة', get: e => e.residencyExp || '9999' },
  { key: 'workPermitExp', label: 'إذن العمل', get: e => e.workPermitExp || '9999' },
  { key: 'passportExp', label: 'الجواز', get: e => e.passportExp || '9999' },
  { key: 'govStage', label: 'المعاملة', get: e => GOV_STAGES.findIndex(g => g.id === e.govStage) },
  { key: 'employmentStatus', label: 'الحالة', get: e => e.employmentStatus || 'active' },
  { key: 'urgency', label: 'الأقرب انتهاءً', get: e => { const u = empUrgency(e); return u === null ? 99999 : u; } },
];

function filteredEmployees(f = UI.emp) {
  const q = norm(f.q);
  return scopedEmployees().filter(e => {
    if (q && ![e.name, e.nameEn, e.id, e.passportNo, e.fileNo, e.profession, e.phone, e.nationality].some(v => norm(v).includes(q))) return false;
    if (f.company && !empInCompany(e, f.company)) return false;
    if (f.link && empLink(e, f.company) !== f.link) return false;
    if (f.project === '__none') { if (primaryAff(e).projectId) return false; }
    else if (f.project && !(e.affiliations || []).some(a => a.projectId === f.project)) return false;
    if (f.status && (e.employmentStatus || 'active') !== f.status) return false;
    if (f.stage === '__none') { if (e.govStage) return false; }
    else if (f.stage === '__note') { if (!e.govStageNote) return false; }
    else if (f.stage && e.govStage !== f.stage) return false;
    if (f.nationality && (e.nationality || '—') !== f.nationality) return false;
    if (f.costCenter && e.costCenter !== f.costCenter) return false;
    if (f.driver && !e.isDriver) return false;
    if (f.tier) {
      const fields = f.tierField === 'any' ? EMP_DATE_FIELDS.filter(x => !x.driverOnly || e.isDriver).map(x => x.key) : [f.tierField];
      const tiers = fields.map(k => tierOf(e[k]));
      const want = f.tier === 'soon' ? ['expired', 'd30'] : [f.tier];
      if (!tiers.some(x => want.includes(x))) return false;
    }
    return true;
  });
}
function sortEmployees(list) {
  const col = EMP_COLUMNS.find(c => c.key === UI.emp.sort) || EMP_COLUMNS[0];
  const dir = UI.emp.dir || 1;
  return list.slice().sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar')) * dir;
  });
}

function renderEmployees() {
  const f = UI.emp;
  const all = filteredEmployees();
  const list = sortEmployees(all);
  const pages = Math.max(1, Math.ceil(list.length / f.perPage));
  if (f.page > pages) f.page = pages;
  const pageList = list.slice((f.page - 1) * f.perPage, f.page * f.perPage);
  const nats = uniq(scopedEmployees().map(e => e.nationality || '—')).sort();
  // عدادات «على الشركة / على مركز التكلفة» بكل الفلاتر ماعدا فلتر الارتباط نفسه
  const linkBase = f.link ? filteredEmployees({ ...f, link: '' }) : all;
  const linkCount = k => linkBase.filter(e => empLink(e, f.company) === k).length;
  const linkBar = `<div class="row no-print" style="gap:6px;margin:0 0 8px;flex-wrap:wrap">
      <span class="small muted">${f.company ? esc(companyName(f.company)) + ':' : t('الارتباط بالشركة') + ':'}</span>
      ${['company', 'cc'].map(k => `<span class="chip clickable ${f.link === k ? 'on' : ''}" data-link="${k}">${EMP_LINKS[k].ico} ${esc(t(EMP_LINKS[k].label))} <b class="num">${linkCount(k)}</b></span>`).join('')}
      ${f.link ? `<span class="chip clickable" data-link="">✕ ${t('الكل')}</span>` : ''}
      ${!f.company ? `<span class="small muted">${t('(🏭 = شغال في شركة غير المسجّل عليها — اختار شركة من الفلتر للتفاصيل)')}</span>` : ''}</div>`;
  EMP_SELECTED = new Set([...EMP_SELECTED].filter(id => IDX.employee[id]));
  const sel = EMP_SELECTED.size;
  const sortIco = k => f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : '';

  viewRoot().innerHTML = `
    <div class="page-head"><div><h1>مركز إدارة الإقامات والموظفين</h1><div class="sub">${list.length} ${t('من')} ${scopedEmployees().length} ${t('موظف')}</div></div>
      <div class="actions">
        <button class="btn primary write-only" data-p="employees.edit" id="e-add">➕ إضافة موظف</button>
        <button class="btn write-only" data-p="employees.edit system.import sensitive.salary sensitive.bank sensitive.documents scope.all" id="e-import">📥 استيراد Excel/CSV</button>
        <button class="btn" id="e-export">📤 تصدير CSV</button>
        <button class="btn" id="e-print">🖨️ تقرير</button>
        <button class="btn" id="e-cal">📅 تقويم التجديدات</button>
      </div></div>
    <div class="filters no-print">
      <input type="search" id="f-q" placeholder="بحث بالاسم، الرقم المدني، الجواز، رقم الملف…" value="${esc(f.q)}">
      <select id="f-company">${companyOptions(f.company, '— كل الشركات —')}</select>
      <select id="f-project">${opt('', t('— كل المشاريع —'), !f.project)}${opt('__none', t('بدون مشروع'), f.project === '__none')}${scopedProjects().filter(p => !f.company || p.companyId === f.company).map(p => opt(p.id, projectName(p.id), p.id === f.project)).join('')}</select>
      <select id="f-status">${opt('', t('— كل الحالات —'), !f.status)}${Object.entries(EMP_STATUS_LABELS).map(([k, v]) => opt(k, LANG === 'en' ? v.en : v.ar, k === f.status)).join('')}</select>
      <select id="f-stage">${opt('', t('— كل مراحل المعاملات —'), !f.stage)}${opt('__none', t('بدون معاملة'), f.stage === '__none')}${opt('__note', t('عليها ملاحظة تعطّل'), f.stage === '__note')}${GOV_STAGES.map(g => opt(g.id, g.dot + ' ' + t(g.label), g.id === f.stage)).join('')}</select>
      <select id="f-nat">${opt('', t('— كل الجنسيات —'), !f.nationality)}${nats.map(n => opt(n, n, n === f.nationality)).join('')}</select>
      <select id="f-cc">${costCenterOptions(f.costCenter, '— كل مراكز التكلفة —')}</select>
      <select id="f-tierfield">${opt('any', t('أي مستند'), f.tierField === 'any')}${EMP_DATE_FIELDS.map(x => opt(x.key, t(x.label), x.key === f.tierField)).join('')}</select>
      <select id="f-tier">${opt('', t('— كل المستويات —'), !f.tier)}${opt('soon', t('منتهي أو خلال 30 يوم'), f.tier === 'soon')}${Object.entries(TIERS).map(([k, v]) => opt(k, t(v.label), k === f.tier)).join('')}</select>
      <label class="chip clickable ${f.driver ? 'on' : ''}"><input type="checkbox" id="f-driver" ${f.driver ? 'checked' : ''} hidden>🚚 ${t('السائقين فقط')}</label>
      <button class="btn sm ghost" id="f-clear">✕ ${t('مسح الفلاتر')}</button>
    </div>
    ${linkBar}
    ${sel ? `<div class="bulkbar no-print"><b>${sel} ${t('محدد')}</b>
      <button class="btn sm write-only" data-p="employees.edit" id="b-assign">🏢 تعيين جماعي</button>
      <button class="btn sm write-only" data-p="employees.edit" id="b-renew">🔄 تجديد جماعي</button>
      <button class="btn sm" data-p="contract.view sensitive.salary" id="b-contracts">📄 عقود المحدد (PDF)</button>
      <button class="btn sm" id="b-export">📤 تصدير المحدد</button>
      <button class="btn sm" id="b-print">🖨️ طباعة المحدد</button>
      <span class="spacer"></span><button class="btn sm ghost" id="b-clear">${t('إلغاء التحديد')}</button></div>` : ''}
    <div class="table-wrap"><table class="data" id="emp-table"><thead><tr>
      <th style="width:30px"><input type="checkbox" id="sel-all" ${pageList.length && pageList.every(e => EMP_SELECTED.has(e.id)) ? 'checked' : ''}></th>
      ${EMP_COLUMNS.filter(c => c.key !== 'urgency').map(c => `<th data-sort="${c.key}">${esc(t(c.label))}${sortIco(c.key)}</th>`).join('')}
      <th data-sort="urgency">${t('الاكتمال')}${sortIco('urgency')}</th></tr></thead>
      <tbody>${pageList.map(e => {
        const comp = empDocCompleteness(e);
        const a = primaryAff(e);
        const link = empLink(e, f.company), ccCo = costCenterCompanyId(e.costCenter);
        return `<tr class="clickable ${EMP_SELECTED.has(e.id) ? 'sel' : ''}" data-id="${esc(e.id)}">
          <td data-nosel><input type="checkbox" data-sel="${esc(e.id)}" ${EMP_SELECTED.has(e.id) ? 'checked' : ''}></td>
          <td><b>${esc(empName(e))}</b>${e.isDriver ? ' 🚚' : ''}${e.govStageNote ? ` <span title="${esc(e.govStageNote)}">⚠️</span>` : ''}${LANG !== 'en' && e.nameEn ? `<div class="small muted" dir="ltr" style="text-align:start">${esc(e.nameEn)}</div>` : ''}</td>
          <td class="num">${esc(e.id)}</td>
          <td>${esc(e.nationality || '—')}</td>
          <td>${esc(e.profession || '—')}</td>
          <td><div style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(companyName(a.companyId))}">${esc(companyName(a.companyId) || '—')}</div><div class="small muted">${esc(projectName(a.projectId))}</div>
            ${link === 'cc' ? `<div class="small" style="color:var(--orange)" title="${esc(t('مركز التكلفة') + ': ' + (e.costCenter || ''))}">🏭 ${esc(companyName(ccCo) || e.costCenter || '')}</div>` : ''}
            ${f.company ? empLinkChip(link) : ''}</td>
          <td>${datePill(e.residencyExp)}</td><td>${datePill(e.workPermitExp)}</td><td>${datePill(e.passportExp)}</td>
          <td>${govStagePill(e.govStage)}</td>
          <td>${statusPill(e.employmentStatus)}</td>
          <td title="${esc(comp.missing.map(t).join('، '))}"><div class="progress" style="width:60px"><i style="width:${comp.pct}%"></i></div><span class="small muted">${comp.pct}%</span></td>
        </tr>`;
      }).join('') || `<tr><td colspan="13" class="empty">${t('لا توجد نتائج')}</td></tr>`}</tbody></table></div>
    <div class="pager no-print">
      <button class="btn sm" id="pg-prev" ${f.page <= 1 ? 'disabled' : ''}>‹</button>
      <span>${t('صفحة')} ${f.page} / ${pages}</span>
      <button class="btn sm" id="pg-next" ${f.page >= pages ? 'disabled' : ''}>›</button>
      <select id="pg-size">${[25, 50, 100, 250].map(n => opt(n, n + ' / ' + t('صفحة'), n === f.perPage)).join('')}</select>
    </div>`;

  const upd = (patch) => { Object.assign(UI.emp, patch, { page: patch.page || 1 }); saveUiStateToLocalStorage(); render(); };
  $('#f-q').addEventListener('input', debounce(e => { UI.emp.q = e.target.value; UI.emp.page = 1; saveUiStateToLocalStorage(); render(); const i = $('#f-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  $('#f-company').onchange = e => upd({ company: e.target.value, project: '' });
  $$('[data-link]', viewRoot()).forEach(c => c.onclick = () => upd({ link: UI.emp.link === c.dataset.link ? '' : c.dataset.link }));
  $('#f-project').onchange = e => upd({ project: e.target.value });
  $('#f-status').onchange = e => upd({ status: e.target.value });
  $('#f-stage').onchange = e => upd({ stage: e.target.value });
  $('#f-nat').onchange = e => upd({ nationality: e.target.value });
  $('#f-cc').onchange = e => upd({ costCenter: e.target.value });
  $('#f-tierfield').onchange = e => upd({ tierField: e.target.value });
  $('#f-tier').onchange = e => upd({ tier: e.target.value });
  $('#f-driver').onchange = e => upd({ driver: e.target.checked });
  $('#f-clear').onclick = () => upd({ q: '', company: '', link: '', project: '', status: '', stage: '', nationality: '', costCenter: '', tier: '', tierField: 'any', driver: false });
  $$('#emp-table th[data-sort]').forEach(th => th.onclick = () => { const k = th.dataset.sort; UI.emp.dir = UI.emp.sort === k ? -UI.emp.dir : 1; UI.emp.sort = k; saveUiStateToLocalStorage(); render(); });
  $('#pg-prev').onclick = () => upd({ page: f.page - 1 });
  $('#pg-next').onclick = () => upd({ page: f.page + 1 });
  $('#pg-size').onchange = e => upd({ perPage: +e.target.value });
  $('#sel-all').onchange = e => { pageList.forEach(x => e.target.checked ? EMP_SELECTED.add(x.id) : EMP_SELECTED.delete(x.id)); render(); };
  $$('#emp-table tbody tr[data-id]').forEach(tr => tr.onclick = (ev) => {
    if (ev.target.closest('[data-nosel]')) {
      const id = tr.dataset.id;
      if (ev.target.type !== 'checkbox') return;
      ev.target.checked ? EMP_SELECTED.add(id) : EMP_SELECTED.delete(id);
      render(); return;
    }
    openProfileCard(tr.dataset.id);
  });
  $('#e-add').onclick = () => openEmployeeModal(null);
  $('#e-import').onclick = handleImportCsv;
  $('#e-export').onclick = () => exportEmployeesCsv(list);
  $('#e-print').onclick = () => openEmployeeReportModal();
  $('#e-cal').onclick = () => renderRenewalCalendarModal();
  if (sel) {
    const selected = () => list.filter(e => EMP_SELECTED.has(e.id)).concat([...EMP_SELECTED].filter(id => !list.find(e => e.id === id)).map(id => IDX.employee[id]).filter(Boolean));
    $('#b-assign').onclick = () => openBulkAssignModal([...EMP_SELECTED]);
    $('#b-renew').onclick = () => openBulkRenewModal([...EMP_SELECTED]);
    $('#b-contracts').onclick = () => openBatchContractModal(selected().map(e => e.id));
    $('#b-export').onclick = () => exportEmployeesCsv(selected());
    $('#b-print').onclick = () => openEmployeeReportModal(selected().map(e => e.id));
    $('#b-clear').onclick = () => { EMP_SELECTED.clear(); render(); };
  }
}

/* ---------- التصدير والتقارير ---------- */
function exportEmployeesCsv(list) {
  const head = ['الرقم المدني', 'الاسم', 'English name', 'الجنسية', 'المهنة', 'الشركة', 'المشروع', 'مركز التكلفة', 'الراتب', 'بدل السكن',
    'الحالة الوظيفية', 'تاريخ التعيين', 'انتهاء الإقامة', 'انتهاء إذن العمل', 'رقم الجواز', 'انتهاء الجواز', 'انتهاء البطاقة الصحية',
    'سائق', 'انتهاء رخصة القيادة', 'مرحلة المعاملة', 'ملاحظة المعاملة', 'رقم الملف', 'نوع العقد', 'آخر تعديل', 'بواسطة',
    'شركة مركز التكلفة', 'الارتباط'];
  const rows = list.map(e => [e.id, e.name, e.nameEn, e.nationality, e.profession, companyName(empCompanyId(e)), projectName(primaryAff(e).projectId), e.costCenter,
    e.salary, e.housingIncluded ? (e.housingAmount || 'نعم') : '', (EMP_STATUS_LABELS[e.employmentStatus] || {}).ar, e.dateOfHire, e.residencyExp, e.workPermitExp,
    e.passportNo, e.passportExp, e.healthCardExp, e.isDriver ? 'نعم' : '', e.drivingLicenseExp, (govStageInfo(e.govStage) || {}).label, e.govStageNote,
    e.fileNo, e.contractType, e.lastUpdated, e.lastUpdatedBy,
    companyName(costCenterCompanyId(e.costCenter)), t(EMP_LINKS[empLink(e, UI.emp.company)]?.label || '')]);
  const drop = [[8, 'salary'], [14, 'passportNo']].filter(([, f]) => hiddenField('employee', f)).map(([i]) => i);
  const keep = r => r.filter((_, i) => !drop.includes(i));
  downloadBlob(toCsv([keep(head).map(t), ...rows.map(keep)]), `employees-${todayISO()}.csv`, 'text/csv;charset=utf-8');
}
/* ---------- تقرير الموظفين: اختيار الأعمدة والفلاتر والتجميع ← openReportWindow ----------
   الأعمدة: v = القيمة (نص)، date = تاريخ (شارة ملوّنة حسب المستوى)، money = مبلغ (بيتجمع)، perm = صلاحية لازمة */
const EMP_REPORT_GROUPS = [['basic', 'البيانات الأساسية'], ['work', 'العمل'], ['docs', 'المستندات'], ['gov', 'المعاملة الحكومية'], ['contact', 'الاتصال والبنك']];
const EMP_REPORT_COLS = [
  { k: 'name', g: 'basic', l: 'الاسم', v: e => empName(e) },
  { k: 'nameEn', g: 'basic', l: 'الاسم (إنجليزي)', v: e => e.nameEn },
  { k: 'id', g: 'basic', l: 'الرقم المدني', v: e => e.id, num: true },
  { k: 'unifiedNumber', g: 'basic', l: 'الرقم الموحد', v: e => e.unifiedNumber, num: true },
  { k: 'nationality', g: 'basic', l: 'الجنسية', v: e => e.nationality },
  { k: 'gender', g: 'basic', l: 'الجنس', v: e => t(GENDER_LABELS[e.gender] || '') },
  { k: 'dateOfBirth', g: 'basic', l: 'تاريخ الميلاد', date: true },
  { k: 'profession', g: 'basic', l: 'المهنة', v: e => e.profession },
  { k: 'company', g: 'work', l: 'الشركة', v: e => companyName(empCompanyId(e)) },
  { k: 'project', g: 'work', l: 'المشروع', v: e => projectName(primaryAff(e).projectId) },
  { k: 'costCenter', g: 'work', l: 'مركز التكلفة', v: e => e.costCenter },
  { k: 'status', g: 'work', l: 'الحالة الوظيفية', v: e => { const s = EMP_STATUS_LABELS[e.employmentStatus || 'active'] || {}; return LANG === 'en' ? s.en : s.ar; } },
  { k: 'dateOfHire', g: 'work', l: 'تاريخ التعيين', date: true, plain: true },
  { k: 'serviceEndDate', g: 'work', l: 'تاريخ انتهاء الخدمة', date: true, plain: true },
  { k: 'contractType', g: 'work', l: 'نوع العقد', v: e => e.contractType },
  { k: 'fileNo', g: 'work', l: 'رقم الملف', v: e => e.fileNo, num: true },
  { k: 'actualWorkplace', g: 'work', l: 'مكان العمل الفعلي', v: e => e.actualWorkplace },
  { k: 'salary', g: 'work', l: 'الراتب', money: true, perm: 'sensitive.salary' },
  { k: 'housingAmount', g: 'work', l: 'بدل السكن', money: true, perm: 'sensitive.salary' },
  { k: 'residencyExp', g: 'docs', l: 'انتهاء الإقامة', date: true },
  { k: 'workPermitExp', g: 'docs', l: 'انتهاء إذن العمل', date: true },
  { k: 'passportNo', g: 'docs', l: 'رقم الجواز', v: e => e.passportNo, perm: 'sensitive.documents' },
  { k: 'passportExp', g: 'docs', l: 'انتهاء الجواز', date: true },
  { k: 'healthCardExp', g: 'docs', l: 'انتهاء البطاقة الصحية', date: true },
  { k: 'drivingLicenseExp', g: 'docs', l: 'انتهاء رخصة القيادة', date: true },
  { k: 'urgency', g: 'docs', l: 'الأقرب انتهاءً', v: e => { const u = empUrgency(e); return u === null ? '' : daysText(u); } },
  { k: 'govStage', g: 'gov', l: 'مرحلة المعاملة', v: e => t((govStageInfo(e.govStage) || {}).label || '') },
  { k: 'govStageNote', g: 'gov', l: 'ملاحظة التعطّل', v: e => e.govStageNote },
  { k: 'govStageResponsible', g: 'gov', l: 'المسؤول', v: e => e.govStageResponsible },
  { k: 'govStageStartDate', g: 'gov', l: 'تاريخ بدء المعاملة', date: true, plain: true },
  { k: 'govTransactionCost', g: 'gov', l: 'تكلفة المعاملة', money: true, perm: 'sensitive.salary' },
  { k: 'phone', g: 'contact', l: 'الهاتف', v: e => e.phone, num: true },
  { k: 'homePhone', g: 'contact', l: 'هاتف المنزل', v: e => e.homePhone, num: true },
  { k: 'address', g: 'contact', l: 'عنوان السكن', v: e => addressText(e) },
  { k: 'bank', g: 'contact', l: 'البنك', v: e => e.bank, perm: 'sensitive.bank' },
  { k: 'iban', g: 'contact', l: 'IBAN', v: e => e.iban, perm: 'sensitive.bank' },
];
const EMP_REPORT_PRESETS = [
  { id: 'general', l: 'عام', cols: ['name', 'id', 'nationality', 'profession', 'company', 'status', 'residencyExp', 'workPermitExp', 'passportExp'] },
  { id: 'docs', l: 'المستندات والتواريخ', cols: ['name', 'id', 'company', 'residencyExp', 'workPermitExp', 'passportNo', 'passportExp', 'healthCardExp', 'urgency'], sort: 'urgency' },
  { id: 'payroll', l: 'الرواتب', cols: ['name', 'id', 'company', 'costCenter', 'profession', 'dateOfHire', 'salary', 'housingAmount'], group: 'company', perm: 'sensitive.salary' },
  { id: 'gov', l: 'المعاملات الحكومية', cols: ['name', 'id', 'company', 'govStage', 'govStageNote', 'govStageResponsible', 'govStageStartDate', 'residencyExp'], group: 'govStage' },
  { id: 'contact', l: 'بيانات الاتصال', cols: ['name', 'id', 'company', 'phone', 'homePhone', 'address'] },
];
const EMP_REPORT_GROUPBY = [['', 'بدون تجميع'], ['company', 'الشركة'], ['project', 'المشروع'], ['costCenter', 'مركز التكلفة'], ['nationality', 'الجنسية'], ['status', 'الحالة الوظيفية'], ['govStage', 'مرحلة المعاملة']];
const EMP_REPORT_SORTS = ['name', 'id', 'company', 'nationality', 'residencyExp', 'workPermitExp', 'passportExp', 'dateOfHire', 'salary', 'urgency'];

/** مبلغ من غير العملة (العملة في عنوان العمود) */
function rptNum(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 }); }
function empReportCols() { return EMP_REPORT_COLS.filter(c => !c.perm || can(c.perm)); }
function empReportCell(c, e, colors) {
  if (c.date) return c.plain || !colors ? esc(fmtDate(e[c.k]) || '') : (e[c.k] ? datePill(e[c.k]) : '');
  if (c.money) return e[c.k] ? rptNum(e[c.k]) : '';
  return esc(c.v(e) || '');
}
function empReportRaw(c, e) { return c.date || c.money ? (e[c.k] ?? '') : (c.v(e) ?? ''); }
function empReportSortVal(k, e) {
  if (k === 'urgency') { const u = empUrgency(e); return u === null ? 1e9 : u; }
  if (k === 'salary') return -(e.salary || 0);
  const c = EMP_REPORT_COLS.find(x => x.k === k);
  return c.date ? (e[k] || '9999') : String(c.v(e) || '');
}
function empGroupKey(by, e) {
  if (by === 'company') return [empCompanyId(e) || '', companyName(empCompanyId(e)) || t('بدون شركة')];
  if (by === 'project') {   // مشاريع كتير بنفس الاسم ← رقم الملف بيفرّق بينها
    const p = primaryAff(e).projectId, pr = IDX.project[p];
    return [p || '', p ? projectName(p) + (pr && pr.fileNumber ? ` — ${t('رقم الملف')} ${pr.fileNumber}` : '') : t('بدون مشروع')];
  }
  if (by === 'costCenter') return [e.costCenter || '', e.costCenter || t('بدون مركز تكلفة')];
  if (by === 'nationality') return [e.nationality || '', e.nationality || '—'];
  if (by === 'status') { const s = e.employmentStatus || 'active'; return [s, EMP_REPORT_COLS.find(c => c.k === 'status').v(e)]; }
  if (by === 'govStage') return [e.govStage || '', e.govStage ? t((govStageInfo(e.govStage) || {}).label) : t('بدون معاملة')];
  return ['', ''];
}

/** نافذة إعداد التقرير. selected = الموظفين المحددين (لو فيه) */
function openEmployeeReportModal(selected = []) {
  const R = UI.report = Object.assign({ preset: 'general', cols: EMP_REPORT_PRESETS[0].cols, groupBy: '', sort: 'name', orientation: 'auto', summary: true, sign: false, colors: true }, UI.report || {});
  const F = { ...UI.emp };                               // الفلاتر: نسخة من فلاتر الشاشة (مابتغيّرهاش)
  let scope = selected.length ? 'selected' : 'filters';
  const cols = empReportCols();
  const presets = EMP_REPORT_PRESETS.filter(p => !p.perm || can(p.perm));
  const nats = uniq(scopedEmployees().map(e => e.nationality || '—')).sort();
  const m = openModal({
    title: '📊 ' + t('تقرير الموظفين'), size: 'wide',
    body: `<div class="rb">
      <div class="rb-sec"><h4>${t('القالب')}</h4><div class="row" id="rb-presets">${presets.map(p => `<span class="chip clickable" data-preset="${p.id}">${esc(t(p.l))}</span>`).join('')}<span class="chip clickable" data-preset="custom">${t('مخصص')}</span></div></div>
      <div class="rb-sec"><h4>${t('الأعمدة')} <span class="muted small" id="rb-ncols"></span></h4>
        <div class="rb-cols">${EMP_REPORT_GROUPS.map(([g, gl]) => { const list = cols.filter(c => c.g === g); return list.length ? `<div><b>${esc(t(gl))}</b>${list.map(c => `<label class="check"><input type="checkbox" data-col="${c.k}"> ${esc(t(c.l))}</label>`).join('')}</div>` : ''; }).join('')}</div></div>
      <div class="rb-sec"><h4>${t('الموظفين')} <span class="chip on" id="rb-count"></span></h4>
        ${selected.length ? `<div class="row" style="margin-bottom:8px"><label class="check"><input type="radio" name="rb-scope" value="selected" checked> ${t('المحددين فقط')} (${selected.length})</label>
          <label class="check"><input type="radio" name="rb-scope" value="filters"> ${t('حسب الفلاتر')}</label></div>` : ''}
        <div class="form" id="rb-filters">
          <label>${t('الشركة')}<select name="company">${companyOptions(F.company, '— كل الشركات —')}</select></label>
          <label>${t('المشروع')}<select name="project">${opt('', t('— كل المشاريع —'), !F.project)}${opt('__none', t('بدون مشروع'), F.project === '__none')}${scopedProjects().map(p => opt(p.id, `${projectName(p.id)} — ${companyName(p.companyId)}`, p.id === F.project)).join('')}</select></label>
          <label>${t('الحالة الوظيفية')}<select name="status">${opt('', t('— كل الحالات —'), !F.status)}${Object.entries(EMP_STATUS_LABELS).map(([k, v]) => opt(k, LANG === 'en' ? v.en : v.ar, k === F.status)).join('')}</select></label>
          <label>${t('الجنسية')}<select name="nationality">${opt('', t('— كل الجنسيات —'), !F.nationality)}${nats.map(n => opt(n, n, n === F.nationality)).join('')}</select></label>
          <label>${t('مركز التكلفة')}<select name="costCenter">${costCenterOptions(F.costCenter, '— كل مراكز التكلفة —')}</select></label>
          <label>${t('مرحلة المعاملة')}<select name="stage">${opt('', t('— كل مراحل المعاملات —'), !F.stage)}${opt('__none', t('بدون معاملة'), F.stage === '__none')}${opt('__note', t('عليها ملاحظة تعطّل'), F.stage === '__note')}${GOV_STAGES.map(g => opt(g.id, g.dot + ' ' + t(g.label), g.id === F.stage)).join('')}</select></label>
          <label>${t('المستند')}<select name="tierField">${opt('any', t('أي مستند'), F.tierField === 'any')}${EMP_DATE_FIELDS.map(x => opt(x.key, t(x.label), x.key === F.tierField)).join('')}</select></label>
          <label>${t('المستوى')}<select name="tier">${opt('', t('— كل المستويات —'), !F.tier)}${opt('soon', t('منتهي أو خلال 30 يوم'), F.tier === 'soon')}${Object.entries(TIERS).map(([k, v]) => opt(k, t(v.label), k === F.tier)).join('')}</select></label>
          <label>${t('بحث')}<input name="q" value="${esc(F.q || '')}" placeholder="${esc(t('الاسم، الرقم المدني، الجواز…'))}"></label>
          <label class="check"><input type="checkbox" name="driver" ${F.driver ? 'checked' : ''}> 🚚 ${t('السائقين فقط')}</label>
        </div></div>
      <div class="rb-sec"><h4>${t('التنسيق')}</h4><div class="form">
          <label class="full">${t('عنوان التقرير')}<input id="rb-title" value="${esc(t('تقرير الموظفين'))}"></label>
          <label>${t('تجميع حسب')}<select id="rb-group">${EMP_REPORT_GROUPBY.map(([k, l]) => opt(k, t(l), k === R.groupBy)).join('')}</select></label>
          <label>${t('ترتيب حسب')}<select id="rb-sort">${EMP_REPORT_SORTS.filter(k => cols.some(c => c.k === k)).map(k => opt(k, t(EMP_REPORT_COLS.find(c => c.k === k).l), k === R.sort)).join('')}</select></label>
          <label>${t('اتجاه الصفحة')}<select id="rb-orient">${opt('auto', t('تلقائي حسب عدد الأعمدة'), R.orientation === 'auto')}${opt('landscape', t('عرضي'), R.orientation === 'landscape')}${opt('portrait', t('طولي'), R.orientation === 'portrait')}</select></label>
          <label class="check"><input type="checkbox" id="rb-summary" ${R.summary ? 'checked' : ''}> ${t('ملخص في أول التقرير')}</label>
          <label class="check"><input type="checkbox" id="rb-colors" ${R.colors ? 'checked' : ''}> ${t('تلوين التواريخ حسب الانتهاء')}</label>
          <label class="check"><input type="checkbox" id="rb-sign" ${R.sign ? 'checked' : ''}> ${t('خانات التوقيع (أعده / راجعه / اعتمده)')}</label>
        </div></div>
      </div>`,
    foot: `<button class="btn primary" data-go="print">🖨️ ${t('معاينة وطباعة')}</button><button class="btn" data-go="csv">📤 ${t('Excel (CSV) بنفس الأعمدة')}</button>
      <span class="spacer"></span><button class="btn" data-close>إلغاء</button>`,
  });
  const E = m.el;
  const chosen = () => cols.filter(c => R.cols.includes(c.k));
  const filters = () => ({ ...F, ...formValues($('#rb-filters', E)), link: '', page: 1 });
  const rows = () => scope === 'selected' ? selected.map(id => IDX.employee[id]).filter(Boolean) : filteredEmployees(filters());
  const sync = () => {
    $$('[data-preset]', E).forEach(c => c.classList.toggle('on', c.dataset.preset === R.preset));
    $$('[data-col]', E).forEach(cb => { cb.checked = R.cols.includes(cb.dataset.col); });
    $('#rb-ncols', E).textContent = `(${chosen().length})`;
    $('#rb-count', E).textContent = `${rows().length} ${t('موظف')}`;
    $('#rb-filters', E).style.opacity = scope === 'selected' ? .45 : 1;
    $$('#rb-filters select, #rb-filters input', E).forEach(x => { x.disabled = scope === 'selected'; });
  };
  $$('[data-preset]', E).forEach(c => c.onclick = () => {
    const p = presets.find(x => x.id === c.dataset.preset);
    R.preset = c.dataset.preset;
    if (p) {
      R.cols = p.cols.filter(k => cols.some(x => x.k === k));
      if (p.group !== undefined) { R.groupBy = p.group; $('#rb-group', E).value = p.group; }
      if (p.sort) { R.sort = p.sort; $('#rb-sort', E).value = p.sort; }
    }
    sync();
  });
  $$('[data-col]', E).forEach(cb => cb.onchange = () => {
    R.cols = cb.checked ? [...R.cols, cb.dataset.col] : R.cols.filter(k => k !== cb.dataset.col);
    R.cols = cols.map(c => c.k).filter(k => R.cols.includes(k));     // بترتيب الكتالوج
    R.preset = 'custom'; sync();
  });
  $$('input[name="rb-scope"]', E).forEach(r => r.onchange = () => { scope = r.value; sync(); });
  $('#rb-filters', E).addEventListener('change', sync);
  $('#rb-filters', E).addEventListener('input', debounce(sync, 250));
  sync();
  $$('[data-go]', E).forEach(b => b.onclick = () => {
    Object.assign(R, { groupBy: $('#rb-group', E).value, sort: $('#rb-sort', E).value, orientation: $('#rb-orient', E).value,
      summary: $('#rb-summary', E).checked, colors: $('#rb-colors', E).checked, sign: $('#rb-sign', E).checked });
    saveUiStateToLocalStorage();
    if (!chosen().length) return toast('اختار عمود واحد على الأقل', 'err');
    const list = rows();
    if (!list.length) return toast('مفيش موظفين بالفلاتر دي', 'err');
    const f = filters();
    if (b.dataset.go === 'csv') return exportEmployeeReportCsv(list, chosen());
    printEmployeeReport(list, chosen(), { title: $('#rb-title', E).value.trim() || t('تقرير الموظفين'), filters: scope === 'selected' ? null : f,
      selectedCount: scope === 'selected' ? list.length : 0 });
  });
}

function exportEmployeeReportCsv(list, cols) {
  const sorted = list.slice().sort((a, b) => { const x = empReportSortVal(UI.report.sort, a), y = empReportSortVal(UI.report.sort, b); return typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ar'); });
  downloadBlob(toCsv([cols.map(c => t(c.l)), ...sorted.map(e => cols.map(c => empReportRaw(c, e)))]), `employees-report-${todayISO()}.csv`, 'text/csv;charset=utf-8');
}

/** التقرير نفسه: رأس الشركة، المعايير، الملخص، الجدول (مجمّع بإجماليات لو فيه مبالغ) */
function printEmployeeReport(list, cols, { title, filters, selectedCount }) {
  const R = UI.report;
  const cmp = (a, b) => { const x = empReportSortVal(R.sort, a), y = empReportSortVal(R.sort, b); return typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ar'); };
  // الشعار: شركة الفلتر، أو لو كل الموظفين على شركة واحدة
  const coIds = uniq(list.map(empCompanyId));
  const company = (filters && filters.company && IDX.company[filters.company]) || (coIds.length === 1 ? IDX.company[coIds[0]] : null);
  // المعايير المطبّقة
  const crit = [];
  if (selectedCount) crit.push(`${t('موظفين محددين')}: ${selectedCount}`);
  if (filters) {
    const f = filters;
    if (f.company) crit.push(`${t('الشركة')}: ${esc(companyName(f.company))}`);
    if (f.project) crit.push(`${t('المشروع')}: ${esc(f.project === '__none' ? t('بدون مشروع') : projectName(f.project))}`);
    if (f.status) crit.push(`${t('الحالة')}: ${esc((EMP_STATUS_LABELS[f.status] || {})[LANG === 'en' ? 'en' : 'ar'] || f.status)}`);
    if (f.nationality) crit.push(`${t('الجنسية')}: ${esc(f.nationality)}`);
    if (f.costCenter) crit.push(`${t('مركز التكلفة')}: ${esc(f.costCenter)}`);
    if (f.stage) crit.push(`${t('المعاملة')}: ${esc(f.stage === '__none' ? t('بدون معاملة') : f.stage === '__note' ? t('عليها ملاحظة تعطّل') : t((govStageInfo(f.stage) || {}).label || ''))}`);
    if (f.tier) crit.push(`${esc(f.tierField === 'any' ? t('أي مستند') : t((EMP_DATE_FIELDS.find(x => x.key === f.tierField) || {}).label || ''))}: ${esc(f.tier === 'soon' ? t('منتهي أو خلال 30 يوم') : t(TIERS[f.tier].label))}`);
    if (f.driver) crit.push(t('السائقين فقط'));
    if (f.q) crit.push(`${t('بحث')}: «${esc(f.q)}»`);
  }
  const groupLabel = (EMP_REPORT_GROUPBY.find(g => g[0] === R.groupBy) || [])[1];
  if (R.groupBy) crit.push(`${t('تجميع حسب')}: ${esc(t(groupLabel))}`);
  crit.push(`${t('ترتيب حسب')}: ${esc(t(EMP_REPORT_COLS.find(c => c.k === R.sort).l))}`);
  // الملخص
  const expired = list.filter(e => EMP_DATE_FIELDS.some(f => (!f.driverOnly || e.isDriver) && tierOf(e[f.key]) === 'expired')).length;
  const soon = list.filter(e => EMP_DATE_FIELDS.some(f => (!f.driverOnly || e.isDriver) && tierOf(e[f.key]) === 'd30')).length;
  const summary = R.summary ? [[list.length, t('إجمالي الموظفين')], [list.filter(e => (e.employmentStatus || 'active') === 'active').length, t('في الخدمة')],
    [expired, t('عندهم مستند منتهي')], [soon, t('مستند بينتهي خلال 30 يوم')],
    ...(can('sensitive.salary') && cols.some(c => c.k === 'salary') ? [[fmtMoney(sum(list.map(e => e.salary))), t('إجمالي الرواتب')]] : [])] : [];
  // الجدول
  const money = cols.filter(c => c.money);
  const totalsRow = (cls, label, rs) => money.length ? `<tr class="${cls}"><td></td>${cols.map((c, i) => c.money ? `<td class="num">${rptNum(sum(rs.map(e => e[c.k])))}</td>` : i === 0 ? `<td>${label}</td>` : '<td></td>').join('')}</tr>` : '';
  let z = 0;
  const rowHtml = (e, i) => `<tr class="${z++ % 2 ? 'z' : ''}"><td class="idx">${i}</td>${cols.map(c => `<td class="${c.num || c.money ? 'num' : ''}">${empReportCell(c, e, R.colors)}</td>`).join('')}</tr>`;
  let body = '', n = 0;
  if (R.groupBy) {
    const groups = new Map();
    list.slice().sort(cmp).forEach(e => { const [k, l] = empGroupKey(R.groupBy, e); if (!groups.has(k)) groups.set(k, { l, rows: [] }); groups.get(k).rows.push(e); });
    [...groups.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length || String(a[1].l).localeCompare(String(b[1].l), 'ar')).forEach(([k, g]) => {
      const logo = R.groupBy === 'company' && IDX.company[k] && IDX.company[k].logoUrl ? `<img src="${esc(location.origin + IDX.company[k].logoUrl)}" alt="">` : '';
      z = 0;
      body += `<tr class="grp"><td colspan="${cols.length + 1}">${logo}${esc(g.l)}<small>${g.rows.length} ${t('موظف')}</small></td></tr>`;
      body += g.rows.map(e => rowHtml(e, ++n)).join('');
      body += totalsRow('sub', `${t('إجمالي')} ${esc(g.l)}`, g.rows);
    });
  } else {
    body = list.slice().sort(cmp).map(e => rowHtml(e, ++n)).join('');
  }
  const table = `<table class="rpt"><thead><tr><th>#</th>${cols.map(c => `<th class="${c.num || c.money ? 'num' : ''}">${esc(t(c.l))}${c.money ? ` (${t('د.ك')})` : ''}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>${money.length ? `<tfoot>${totalsRow('', `${t('الإجمالي العام')} (${list.length})`, list)}</tfoot>` : ''}</table>`;
  const landscape = R.orientation === 'landscape' || (R.orientation === 'auto' && cols.length > 6);
  const preset = EMP_REPORT_PRESETS.find(p => p.id === R.preset);
  openReportWindow({ title, subtitle: preset ? t(preset.l) : '', company, criteria: crit.join(' · '), summary, body: table, sign: R.sign, landscape,
    meta: [[t('عدد السجلات'), String(list.length)], [t('رقم التقرير'), 'EMP-' + todayISO().replace(/-/g, '') + '-' + new Date().toTimeString().slice(0, 5).replace(':', '')]] });
}

/* ---------- الاستيراد ---------- */
async function handleImportCsv() {
  const m = openModal({
    title: '📥 ' + t('استيراد الموظفين'),
    body: `<div class="notice">${t('الملف ممكن يكون Excel أو CSV. أول صف لازم يكون عناوين الأعمدة (زي: الرقم المدني، الاسم، english name، المهنة، الجنسية، تاريخ الانتهاء، نوع العقد، رقم الملف)، أو ملف القوى العاملة بدون عناوين.')}</div>
      <p class="small muted">${t('التحديث بالرقم المدني: لو الموظف موجود هتتحدّث بياناته، والخانات الفاضية في الملف مش هتمسح الموجود.')}</p>
      <input type="file" id="imp-file" accept=".xlsx,.xls,.csv"><div id="imp-res" style="margin-top:10px"></div>`,
    foot: `<button class="btn primary" id="imp-go">استيراد</button><button class="btn" data-close>إغلاق</button>`,
  });
  $('#imp-go', m.el).onclick = async () => {
    const file = $('#imp-file', m.el).files[0];
    if (!file) return toast('اختر ملف أولاً', 'err');
    const fd = new FormData(); fd.append('file', file);
    $('#imp-go', m.el).disabled = true;
    try {
      const r = await persist('POST', '/api/employees/import', fd);
      $('#imp-res', m.el).innerHTML = `<div class="notice">✅ ${t('تمت إضافة')} <b>${r.added}</b> · ${t('تحديث')} <b>${r.updated}</b> · ${t('تخطي')} <b>${r.skipped}</b></div>`;
    } catch (e) { $('#imp-res', m.el).innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
    $('#imp-go', m.el).disabled = false;
  };
}

/* =====================================================================
   بطاقة الموظف (Profile Card)
   ===================================================================== */
async function openProfileCard(id, tab = 'info') {
  const e = IDX.employee[id];
  if (!e) return toast('الموظف غير موجود', 'err');
  const comp = empDocCompleteness(e);
  const tl = (STATE.employeeTimeline[e.id] || []).slice().reverse();
  const moves = tl.filter(x => MOVE_ICONS[x.type]);
  const ccCo = costCenterCompanyId(e.costCenter);
  const vehicles = STATE.vehicles.filter(v => v.driverId === e.id);
  const field = (l, v) => `<div><span>${esc(t(l))}</span>${v || '<span class="muted">—</span>'}</div>`;
  const m = openModal({
    title: esc(t('بطاقة الموظف')), size: 'wide',
    body: `<div class="profile-head"><div class="avatar">${esc(initials(e.name))}</div>
        <div style="flex:1"><h2 style="margin:0">${esc(e.name)} ${e.isDriver ? '🚚' : ''}</h2><div class="muted" dir="ltr" style="text-align:start">${esc(e.nameEn || '')}</div>
        <div class="row small">${statusPill(e.employmentStatus)} ${govStagePill(e.govStage)} <span class="muted">${t('آخر تعديل')}: ${fmtDateTime(e.lastUpdated)} ${esc(e.lastUpdatedBy || '')}</span></div></div>
        <div style="width:150px"><div class="small muted">${t('اكتمال المستندات')} ${comp.pct}%</div><div class="progress"><i style="width:${comp.pct}%"></i></div></div></div>
      ${e.govStageNote ? `<div class="notice warn" style="margin-top:10px">⚠️ ${esc(e.govStageNote)}</div>` : ''}
      ${e.transferNote ? `<div class="notice" style="margin-top:10px">ℹ️ ${esc(e.transferNote)}</div>` : ''}
      <div class="tabs" style="margin-top:12px">
        <button data-tab="info" class="${tab === 'info' ? 'active' : ''}">البيانات</button>
        <button data-tab="docs" class="${tab === 'docs' ? 'active' : ''}">المستندات والتواريخ</button>
        <button data-tab="files" data-p="sensitive.documents" class="${tab === 'files' ? 'active' : ''}">المرفقات</button>
        <button data-tab="moves" class="${tab === 'moves' ? 'active' : ''}">🏢 ${t('التحركات')} (${moves.length})</button>
        <button data-tab="timeline" class="${tab === 'timeline' ? 'active' : ''}">السجل (${tl.length})</button>
      </div>
      <div data-pane="info" ${tab !== 'info' ? 'hidden' : ''}><div class="kv">
        ${field('الرقم المدني', `<b class="num">${esc(e.id)}</b>`)}${field('الجنسية', esc(e.nationality))}${field('المهنة', esc(e.profession) + (e.professionEn ? `<div class="small muted">${esc(e.professionEn)}</div>` : ''))}
        ${field('تاريخ الميلاد', fmtDate(e.dateOfBirth))}${field('الجنس', esc(t(GENDER_LABELS[e.gender] || '')))}${field('مكان الميلاد', esc(e.placeOfBirth))}
        ${field('تاريخ إصدار الجواز', fmtDate(e.passportIssueDate))}${field('تاريخ التعيين', fmtDate(e.dateOfHire))}${field('تاريخ انتهاء الخدمة', fmtDate(e.serviceEndDate))}
        ${field('الرقم الموحد', e.unifiedNumber ? `<span class="num">${esc(e.unifiedNumber)}</span>` : '')}${field('فصيلة الدم', esc(e.bloodType))}
        ${field('عنوان السكن', esc(addressText(e)))}${field('هاتف المنزل', esc(e.homePhone))}${can('sensitive.salary') ? field('الراتب', fmtMoney(e.salary)) : ''}
        ${field('بدل السكن', e.housingIncluded ? (e.housingAmount ? fmtMoney(e.housingAmount) : t('مشمول')) : t('غير مشمول'))}
        ${field('نوع العقد', esc(e.contractType))}${field('رقم الملف', esc(e.fileNo))}${field('مركز التكلفة', esc(e.costCenter))}
        ${field('مكان العمل الفعلي', esc(e.actualWorkplace))}${field('الهاتف', esc(e.phone))}${can('sensitive.bank') ? field('البنك', esc(e.bank) + (e.iban ? `<div class="small muted">${esc(e.iban)}</div>` : '')) : ''}
        ${field('مرجع إضافي', esc(e.dpId))}
      </div>
      <h4>${t('الشركات والمشاريع')}</h4>
      ${costCenterCompanyId(e.costCenter) && !(e.affiliations || []).some(a => a.companyId === costCenterCompanyId(e.costCenter))
        ? `<div class="notice" style="margin:4px 0">🏭 ${t('شغال فعليًا في')}: <b>${esc(companyName(costCenterCompanyId(e.costCenter)) || '—')}</b> <span class="small">(${t('مركز التكلفة')}: ${esc(e.costCenter)})</span></div>` : ''}
      ${(e.affiliations || []).map((a, i) => `<div class="row" style="padding:4px 0">${i === 0 ? '<span class="chip on">' + t('أساسي') + '</span>' : '<span class="chip">' + t('إضافي') + '</span>'} <b>${esc(companyName(a.companyId) || '—')}</b> <span class="muted">${esc(projectName(a.projectId))}</span></div>`).join('') || '<div class="muted">—</div>'}
      ${vehicles.length ? `<h4>${t('السيارات')}</h4>` + vehicles.map(v => `<div>🚗 ${esc(v.plate)} ${esc(v.model || '')}</div>`).join('') : ''}
      ${e.notes ? `<h4>${t('ملاحظات')}</h4><div style="white-space:pre-line">${esc(e.notes)}</div>` : ''}
      </div>
      <div data-pane="docs" ${tab !== 'docs' ? 'hidden' : ''}>
        <table class="data"><thead><tr><th>المستند</th><th>الرقم</th><th>تاريخ الانتهاء</th><th>المتبقي</th><th class="write-only" data-p="employees.edit"></th></tr></thead><tbody>
        ${EMP_DATE_FIELDS.filter(f => !f.driverOnly || e.isDriver).map(f => `<tr><td>${esc(t(f.label))}</td><td>${f.key === 'passportExp' ? esc(e.passportNo || '') : ''}</td><td>${datePill(e[f.key])}</td><td class="small">${esc(daysText(daysUntil(e[f.key])))}</td>
          <td class="write-only" data-p="employees.edit"><button class="btn sm" data-renew="${f.key}">🔄 ${t('تجديد سريع')}</button></td></tr>`).join('')}
        </tbody></table>
        <div data-p="sensitive.documents"><h4>✍️ ${t('التوقيع')}</h4>
          <div class="row">${hasSignature(e.id) ? `<img src="${esc(STATE.signatures[e.id].url)}?t=${encodeURIComponent(STATE.signatures[e.id].uploadedAt || '')}" alt="" style="max-height:60px;background:#fff;border:1px solid var(--border);border-radius:6px;padding:4px">` : `<span class="muted">${t('مفيش توقيع مرفوع')}</span>`}
            <span class="spacer"></span><button class="btn sm" data-a="signature">✍️ ${hasSignature(e.id) ? t('عرض / تغيير') : t('رفع التوقيع')}</button></div></div>
        <h4>${t('المعاملة الحكومية')}</h4>
        <div class="kv">${field('المرحلة', govStagePill(e.govStage))}${field('المسؤول', esc(e.govStageResponsible))}${field('تاريخ البدء', fmtDate(e.govStageStartDate))}${can('sensitive.salary') ? field('التكلفة', fmtMoney(e.govTransactionCost)) : ''}</div>
        ${comp.missing.length ? `<div class="notice warn" style="margin-top:10px">${t('بيانات ناقصة')}: ${comp.missing.map(x => esc(t(x))).join('، ')}</div>` : ''}
      </div>
      <div data-pane="files" ${tab !== 'files' ? 'hidden' : ''}><div id="emp-files"><div class="muted">${t('جاري التحميل…')}</div></div>
        <button class="btn write-only" data-p="employees.edit sensitive.documents" id="emp-upload" style="margin-top:10px">📎 ${t('رفع مرفق')}</button></div>
      <div data-pane="moves" ${tab !== 'moves' ? 'hidden' : ''}>
        <div class="kv">${field('مسجّل على', (e.affiliations || []).map((a, i) => `${esc(companyName(a.companyId) || '—')}${a.projectId ? ` <span class="small muted">(${esc(projectName(a.projectId))})</span>` : ''}${i ? ` <span class="chip">${t('إضافي')}</span>` : ''}`).join('<br>'))}
          ${field('مركز التكلفة', esc(e.costCenter))}${field('شغال فعليًا في', esc(companyName(ccCo) || (e.costCenter ? t('غير محددة') : '')))}</div>
        <h4>${t('التحركات')}</h4>
        <ul class="timeline">${moves.map(x => `<li><span class="muted small">${fmtDateTime(x.date)} · ${esc(x.user || '')}</span><br>${MOVE_ICONS[x.type]} ${esc(x.label)}</li>`).join('') || `<li class="muted">${t('مفيش تحركات مسجّلة')}</li>`}</ul>
      </div>
      <div data-pane="timeline" ${tab !== 'timeline' ? 'hidden' : ''}><ul class="timeline">${tl.map(x => `<li><span class="muted small">${fmtDateTime(x.date)} · ${esc(x.user || '')}</span><br>${esc(x.label)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>`,
    foot: `<button class="btn primary write-only" data-p="employees.edit" data-a="edit">✏️ تعديل</button>
      <button class="btn write-only" data-p="employees.edit" data-a="stage">🏛️ مرحلة المعاملة</button>
      <button class="btn" data-p="contract.view employees.view sensitive.salary" data-a="contract">📄 عقد العمل</button>
      ${empNeedsResidency(e) ? '<button class="btn" data-p="sensitive.documents" data-a="residency">🪪 نموذج الإقامة</button>' : ''}
      <button class="btn" data-a="driving">🚗 نموذج رخصة القيادة</button>
      <button class="btn" data-a="clearance">🧾 إقرار مخالصة</button>
      <button class="btn" data-a="print">🖨️ طباعة</button>
      <span class="spacer"></span>
      <button class="btn danger write-only" data-p="employees.delete" data-a="delete">🗑️ حذف</button>`,
  });
  $$('[data-tab]', m.el).forEach(b => b.onclick = () => {
    $$('[data-tab]', m.el).forEach(x => x.classList.toggle('active', x === b));
    $$('[data-pane]', m.el).forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
    if (b.dataset.tab === 'files') loadDriveFiles(e.id, m.el);
  });
  if (tab === 'files' && can('sensitive.documents')) loadDriveFiles(e.id, m.el);
  $$('[data-renew]', m.el).forEach(b => b.onclick = () => { m.close(); openQuickRenewModal(e.id, b.dataset.renew); });
  const up = $('#emp-upload', m.el); if (up) up.onclick = () => uploadFileForEmployee(e.id, m.el);
  $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'edit') { m.close(); openEmployeeModal(e.id); }
    else if (a === 'stage') { m.close(); openGovStageModal(e.id); }
    else if (a === 'signature') { m.close(); openSignatureModal(e.id, e.name, canAll('employees.edit sensitive.documents')); }
    else if (a === 'contract') { m.close(); VIEW_ARGS = { emp: e.id }; setView('contract'); }
    else if (a === 'residency') openOfficialFormModal('residency', 'employee', e.id);
    else if (a === 'driving') openOfficialFormModal('driving', 'employee', e.id);
    else if (a === 'clearance') openClearanceModal(e.id);
    else if (a === 'print') printHtml(e.name, `<h1>${esc(e.name)}</h1><div class="muted">${esc(e.nameEn || '')} · ${esc(e.id)}</div>` + $('[data-pane="info"]', m.el).innerHTML + $('[data-pane="docs"]', m.el).innerHTML);
    else if (a === 'delete') {
      if (await openConfirm(`${t('حذف الموظف')} «${esc(e.name)}» ${t('نهائيًا؟')}`, { danger: true, okLabel: t('حذف') })) {
        m.close(); await persist('DELETE', '/api/employees/' + encodeURIComponent(e.id), undefined, 'تم الحذف');
      }
    }
  });
}

/* ---------- النماذج الرسمية: الإقامة + رخصة القيادة (pdf_forms.py على السيرفر) ----------
   النافذة بتعرض البيانات الناقصة كخانات. اللي بيتكتب فيها بيتحفظ في مكانه (الموظف / المترشّح / الشركة)
   بالـ PUT العادي لو المستخدم يقدر يعدّل، وبيتبعت للنموذج كمان عشان يطلع فيه في كل الأحوال. */
// مواطنين الكويت والخليج مالهمش إقامة (نفس pdf_forms.NO_RESIDENCY)
const NO_RESIDENCY_NATIONALITIES = ['الكويت', 'كويتي', 'معاملة كويتية', 'السعودية', 'الامارات', 'قطر', 'البحرين', 'عمان', 'سلطنة عمان'];
function empNeedsResidency(e) { return !NO_RESIDENCY_NATIONALITIES.map(norm).includes(norm(e.nationality)); }
const OFFICIAL_FORMS = {
  residency: { title: '🪪 نموذج الإقامة', action: 'تجديد',
    actions: ['إصدار', 'إضافة', 'إلغاء', 'تجديد', 'تعديل بيانات', 'حذف', 'نقل كفالة', 'نقل معلومات'],
    fields: ['nameEn', 'unifiedNumber', 'dateOfBirth', 'gender', 'placeOfBirth', 'passportNo', 'passportIssueDate', 'passportExp', 'profession',
      'company.licenseCivilNo', 'company.unifiedNumber'] },
  driving: { title: '🚗 نموذج رخصة القيادة', action: 'إصدار رخصة سوق خاصة',
    actions: ['إصدار رخصة سوق خاصة', 'إصدار رخصة سوق عامة', 'إصدار رخصة سوق دراجة', 'إصدار رخصة سوق إنشائية'],
    fields: ['civilId', 'unifiedNumber', 'nationality', 'dateOfBirth', 'gender', 'bloodType', 'profession', 'actualWorkplace',
      'addressArea', 'addressBlock', 'addressStreet', 'addressHouse', 'addressApartment', 'phone', 'homePhone'] },
};
// [العنوان، النوع، خصائص]
const OFFICIAL_FIELDS = {
  nameEn: ['الاسم (إنجليزي)', 'text', 'dir="ltr"'], unifiedNumber: ['الرقم الموحد', 'text', 'inputmode="numeric" maxlength="9"'],
  civilId: ['الرقم المدني', 'text', 'inputmode="numeric"'], nationality: ['الجنسية'], profession: ['المهنة'],
  dateOfBirth: ['تاريخ الميلاد', 'date'], gender: ['الجنس', 'gender'], placeOfBirth: ['مكان الميلاد'],
  passportNo: ['رقم الجواز', 'text', 'dir="ltr"'], passportIssueDate: ['تاريخ إصدار الجواز', 'date'], passportExp: ['انتهاء الجواز', 'date'],
  bloodType: ['فصيلة الدم', 'blood'], actualWorkplace: ['عنوان العمل'], addressArea: ['المنطقة'], addressBlock: ['القطعة'],
  addressStreet: ['الشارع'], addressHouse: ['المنزل'], addressApartment: ['الشقة'], phone: ['الهاتف النقال', 'text', 'dir="ltr"'],
  homePhone: ['هاتف المنزل', 'text', 'dir="ltr"'],
  'company.licenseCivilNo': ['الرقم المدني للرخصة (الشركة)'], 'company.unifiedNumber': ['الرقم الموحد للشركة', 'text', 'inputmode="numeric"'],
  'company.nameEn': ['اسم الشركة بالإنجليزي', 'text', 'dir="ltr"'],
  dateOfHire: ['تاريخ التعيين', 'date'], serviceEndDate: ['تاريخ انتهاء الخدمة', 'date'],
};
/** البيانات الناقصة لشخص (موظف / مترشّح) وشركته — بتتعرض كخانات، واللي يتكتب فيها بيتحفظ في مكانه.
    fields = مفاتيح OFFICIAL_FIELDS (بتاعة الشركة: company.xxx) */
function missingDataKit(fields, kind, rec) {
  const cid = kind === 'employee' ? empCompanyId(rec) : rec.targetCompanyId;
  const co = cid && IDX.company[cid] && !IDX.company[cid].outOfScope ? IDX.company[cid] : null;
  const get = k => k.startsWith('company.') ? (co || {})[k.slice(8)] : (kind === 'employee' && k === 'civilId' ? rec.id : rec[k]);
  // بيتحفظ لو الخانة ليها مكان عند الشخص/الشركة والمستخدم يقدر يعدّل (غير كده بيتكتب في النموذج بس)
  const savable = k => k.startsWith('company.') ? !!co && can('companies.edit')
    : k in rec && can(kind === 'employee' ? 'employees.edit' : 'recruitment.edit');
  const missing = fields.filter(k => [null, undefined, ''].includes(get(k)) && !(k.startsWith('company.') && !co));
  const input = k => {
    const [l, type = 'text', extra = ''] = OFFICIAL_FIELDS[k];
    const lab = t(l) + (savable(k) ? '' : ` <span class="small muted">(${t('للنموذج بس')})</span>`);
    if (type === 'gender') return `<label>${lab}<select name="${k}">${opt('', '—', true)}${Object.entries(GENDER_LABELS).map(([v, x]) => opt(v, t(x), false)).join('')}</select></label>`;
    if (type === 'blood') return `<label>${lab}<select name="${k}">${opt('', '—', true)}${BLOOD_TYPES.map(x => opt(x, x, false)).join('')}</select></label>`;
    return `<label>${lab}<input name="${k}" type="${type}" ${extra}></label>`;
  };
  const where = kind === 'employee' ? t('ملف الموظف') : t('بيانات المترشّح');
  return {
    cid, co, missing,
    html: () => missing.length ? `<h4>${t('بيانات ناقصة')} (${missing.length})</h4>${missing.map(input).join('')}` : '',
    notice: () => missing.length
      ? `<div class="notice" style="margin-top:10px">💾 ${t('اللي هتكتبه هنا بيتحفظ في')} ${esc(where)}${missing.some(k => k.startsWith('company.')) ? ' ' + t('وبيانات الشركة') : ''}، ${t('وبيطلع في النموذج. اللي تسيبه فاضي بيفضل فاضي في النموذج.')}</div>`
      : `<div class="notice" style="margin-top:10px">✓ ${t('كل البيانات اللي النموذج بياخدها من النظام موجودة')}</div>`,
    /** values = قيم الخانات ← بيتحفظوا في مكانهم. بيرجّع {person, company} عشان يتبعتوا للنموذج، أو null لو الحفظ اتمنع */
    async save(values) {
      const person = {}, company = {};
      Object.entries(values).forEach(([k, v]) => { if (v !== null && v !== '') (k.startsWith('company.') ? company : person)[k.replace('company.', '')] = v; });
      const pSave = Object.fromEntries(Object.entries(person).filter(([k]) => savable(k)));
      const cSave = Object.fromEntries(Object.entries(company).filter(([k]) => savable('company.' + k)));
      try {
        if (Object.keys(pSave).length) {
          await api('PUT', (kind === 'employee' ? '/api/employees/' : '/api/candidates/') + encodeURIComponent(rec.id),
            kind === 'employee' ? { id: rec.id, name: rec.name, ...pSave } : { name: rec.name, ...pSave });
        }
        if (Object.keys(cSave).length) await api('PUT', '/api/companies/' + encodeURIComponent(cid), cSave);
        if (Object.keys(pSave).length || Object.keys(cSave).length) { await reload(); toast('تم حفظ البيانات', 'ok'); }
      } catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); else toast(e.message, 'err'); return null; }
      return { person, company };
    },
  };
}
/** form = residency | driving، kind = employee | candidate */
function openOfficialFormModal(form, kind, id) {
  const spec = OFFICIAL_FORMS[form];
  const rec = kind === 'employee' ? IDX.employee[id] : IDX.candidate[id];
  if (!rec) return toast('غير موجود', 'err');
  const kit = missingDataKit(spec.fields, kind, rec);
  const m = openModal({
    title: spec.title + ': ' + esc(rec.name), size: kit.missing.length > 3 ? '' : 'narrow',
    body: `<div class="form" id="of-form">
        <label class="full">${t('نوع الإجراء')}<select name="__action">${spec.actions.map(x => opt(x, t(x), x === spec.action)).join('')}</select></label>
        ${kit.html()}</div>${kit.notice()}
      <div class="small muted" style="margin-top:6px">${t('أي خانة تانية فاضية تقدر تكتبها في النموذج نفسه قبل الطباعة.')}</div>`,
    foot: `<button class="btn primary" data-go>📄 ${t('حفظ وعرض النموذج')}</button><span class="spacer"></span><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-go]', m.el).onclick = async (ev) => {
    const b = ev.currentTarget;
    const d = formValues($('#of-form', m.el)), action = d.__action;
    delete d.__action;
    b.disabled = true;
    const data = await kit.save(d);
    if (!data) { b.disabled = false; return; }
    try {
      const res = await fetchBlob(`/api/${kind === 'employee' ? 'employees' : 'candidates'}/${encodeURIComponent(rec.id)}/forms/${form}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
      m.close();
      openPdfPreviewModal(res.blob, res.name, 1);
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  };
}

/* ---------- إقرار مخالصة عمالية نهائية (استلام المستحقات) — forms/clearance.docx بمحرك العقود ---------- */
const CLEARANCE_FIELDS = ['nameEn', 'nationality', 'dateOfHire', 'serviceEndDate', 'company.nameEn'];
function openClearanceModal(id) {
  const e = IDX.employee[id];
  if (!e) return toast('غير موجود', 'err');
  const kit = missingDataKit(CLEARANCE_FIELDS, 'employee', e);
  const m = openModal({
    title: '🧾 ' + t('إقرار مخالصة عمالية نهائية') + ': ' + esc(e.name), size: kit.missing.length > 3 ? '' : 'narrow',
    body: `<div class="form" id="cl-form">
        <label class="full">${t('نوع الإجراء')}<select name="__procedure">${opt('transfer', t('الإلغاء والتحويل خارج القطاع'), true)}${opt('travel', t('الإلغاء النهائي للسفر'), false)}${opt('', t('— من غير تحديد —'), false)}</select></label>
        <label>${t('تاريخ الإقرار')}<input type="date" name="__date" value="${todayISO()}"></label>
        <label>${t('المفوّض بالتوقيع')}<select name="__sig">${batchSigOptions(kit.cid)}</select></label>
        <label class="check" data-p="contract.sign"><input type="checkbox" name="__signFirst"> ✍️ ${t('بتوقيع المفوّض')}</label>
        <label class="check" data-p="contract.sign"><input type="checkbox" name="__signSecond"> ✍️ ${t('بتوقيع الموظف')}</label>
        ${kit.html()}</div>${kit.notice()}`,
    foot: `${STATE.pdfAvailable ? `<button class="btn primary" data-go="pdf">📄 ${t('حفظ وعرض الإقرار')}</button>` : ''}
      <button class="btn ${STATE.pdfAvailable ? '' : 'primary'}" data-go="docx">⬇️ Word</button>
      <span class="spacer"></span><button class="btn" data-close>إلغاء</button>`,
  });
  $$('[data-go]', m.el).forEach(b => b.onclick = async () => {
    const d = formValues($('#cl-form', m.el));
    const opts = { procedure: d.__procedure || '', date: d.__date, sig: d.__sig || '', signFirst: !!d.__signFirst, signSecond: !!d.__signSecond };
    Object.keys(d).filter(k => k.startsWith('__')).forEach(k => delete d[k]);
    b.disabled = true;
    const data = await kit.save(d);
    if (!data) { b.disabled = false; return; }
    try {
      const res = await fetchBlob(`/api/employees/${encodeURIComponent(e.id)}/clearance/${b.dataset.go}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...opts, ...data }) });
      if (b.dataset.go === 'pdf') { m.close(); openPdfPreviewModal(res.blob, res.name, 1); }
      else { downloadBlob(res.blob, res.name); toast('تم التنزيل', 'ok'); b.disabled = false; }
    } catch (err) { toast(err.message, 'err'); b.disabled = false; }
  });
}

/* ---------- المرفقات (بديل Google Drive: التخزين على السيرفر) ---------- */
async function loadDriveFiles(empId, root) {
  const box = $('#emp-files', root);
  try {
    const files = await api('GET', `/api/employees/${encodeURIComponent(empId)}/files`);
    box.innerHTML = files.length ? `<table class="data"><tbody>${files.map(f => `<tr><td>📄 <a href="/files/emp/${f.id}" target="_blank">${esc(f.name)}</a></td>
      <td class="small muted">${(f.size / 1024).toFixed(0)} KB</td><td class="small muted">${fmtDateTime(f.uploaded_at)} ${esc(f.uploaded_by || '')}</td>
      <td><a class="btn sm" href="/files/emp/${f.id}?dl=1">⬇️</a> <button class="btn sm danger write-only" data-p="employees.edit" data-del="${f.id}">🗑️</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${t('لا توجد مرفقات')}</div>`;
    $$('[data-del]', box).forEach(b => b.onclick = async () => {
      if (!await openConfirm(t('حذف المرفق؟'), { danger: true })) return;
      await api('DELETE', '/api/files/' + b.dataset.del); loadDriveFiles(empId, root);
    });
  } catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}
async function uploadFileForEmployee(empId, root) {
  const f = await pickFile('');
  if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  try { await api('POST', `/api/employees/${encodeURIComponent(empId)}/files`, fd); toast('تم رفع المرفق', 'ok'); loadDriveFiles(empId, root); }
  catch (e) { toast(e.message, 'err'); }
}

/* =====================================================================
   EMPLOYEE MODAL — إضافة وتعديل موظف
   ===================================================================== */
function renderAffRows(affs) {
  if (!affs.length) affs = [{ companyId: '', projectId: '' }];
  return affs.map((a, i) => companyInScope(a.companyId) ? `<div class="row aff-row" style="margin-bottom:6px">
    <span class="chip ${i === 0 ? 'on' : ''}">${i === 0 ? t('أساسي') : t('إضافي')}</span>
    <select data-aff="company">${companyOptions(a.companyId)}</select>
    <select data-aff="project">${projectOptions(a.companyId, a.projectId)}</select>
    ${i > 0 ? '<button type="button" class="btn sm danger" data-aff-del>✕</button>' : ''}</div>`
    : `<div class="row aff-row" data-locked="${esc(a.companyId)}|${esc(a.projectId || '')}" style="margin-bottom:6px">
    <span class="chip ${i === 0 ? 'on' : ''}">${i === 0 ? t('أساسي') : t('إضافي')}</span>
    📄 <b>${esc(companyName(a.companyId))}</b> <span class="muted">${esc(projectName(a.projectId))}</span>
    <span class="small muted">(${t('للعرض بس')})</span></div>`).join('');
}
function collectAffRows(root) {
  return $$('.aff-row', root).map(r => {
    if (r.dataset.locked) { const [companyId, projectId] = r.dataset.locked.split('|'); return { companyId, projectId: projectId || null }; }
    return { companyId: $('[data-aff="company"]', r).value || null, projectId: $('[data-aff="project"]', r).value || null };
  }).filter(a => a.companyId || a.projectId);
}
function bindAffRows(root) {
  $$('.aff-row', root).forEach(r => {
    if (r.dataset.locked) return;
    $('[data-aff="company"]', r).onchange = (ev) => { $('[data-aff="project"]', r).innerHTML = projectOptions(ev.target.value, ''); translateDomText(r); };
    const d = $('[data-aff-del]', r); if (d) d.onclick = () => { r.remove(); };
  });
}

function openEmployeeModal(id) {
  const isNew = !id;
  let e = isNew ? { employmentStatus: 'active', affiliations: [] } : JSON.parse(JSON.stringify(IDX.employee[id]));
  let draftNote = '';
  if (isNew) {
    const d = loadDraft('employee');
    if (d && d.data) { e = Object.assign(e, d.data); draftNote = `<div class="notice">📝 ${t('تم استرجاع مسودة محفوظة من')} ${fmtDateTime(d.at.slice(0, 19))} <button type="button" class="btn sm" id="drop-draft">${t('تجاهل المسودة')}</button></div>`; }
  }
  const v = k => esc(e[k] ?? '');
  const inp = (k, l, type = 'text', extra = '') => hiddenField('employee', k) ? ''
    : `<label>${esc(t(l))}<input name="${k}" type="${type}" value="${v(k)}" ${extra}></label>`;
  const dt = (k, l) => inp(k, l, 'date');
  const m = openModal({
    title: isNew ? t('إضافة موظف') : t('تعديل موظف') + ': ' + esc(e.name), size: 'wide',
    body: `${draftNote}<form class="form" id="emp-form" autocomplete="off">
      <h4>البيانات الأساسية</h4>
      <label><span class="req">${t('الرقم المدني')}</span><input name="id" value="${v('id')}" inputmode="numeric" required></label>
      <label><span class="req">${t('الاسم (عربي)')}</span><input name="name" value="${v('name')}" required></label>
      ${inp('nameEn', 'الاسم (إنجليزي)', 'text', 'dir="ltr"')}
      <label>${t('الجنسية')}<input name="nationality" value="${v('nationality')}" list="dl-nat"></label>
      ${inp('nationalityEn', 'الجنسية (إنجليزي)', 'text', 'dir="ltr"')}
      <label>${t('المهنة')}<input name="profession" value="${v('profession')}" list="dl-prof"></label>
      ${inp('professionEn', 'المهنة (إنجليزي)', 'text', 'dir="ltr"')}
      ${dt('dateOfBirth', 'تاريخ الميلاد')}
      <label>${t('الجنس')}<select name="gender">${opt('', '—', !e.gender)}${Object.entries(GENDER_LABELS).map(([k, l]) => opt(k, t(l), k === e.gender)).join('')}</select></label>
      ${inp('placeOfBirth', 'مكان الميلاد')}${dt('dateOfHire', 'تاريخ التعيين')}${dt('serviceEndDate', 'تاريخ انتهاء الخدمة')}
      ${inp('phone', 'الهاتف')}
      ${personExtraInputs(e)}
      <h4>العمل والراتب</h4>
      <label>${t('الحالة الوظيفية')}<select name="employmentStatus">${Object.entries(EMP_STATUS_LABELS).map(([k, s]) => opt(k, LANG === 'en' ? s.en : s.ar, k === (e.employmentStatus || 'active'))).join('')}</select></label>
      ${inp('salary', 'الراتب (د.ك)', 'number', 'step="0.001" min="0"')}
      <label class="check"><input type="checkbox" name="housingIncluded" ${e.housingIncluded ? 'checked' : ''}> ${t('بدل السكن مشمول')}</label>
      ${inp('housingAmount', 'مبلغ بدل السكن', 'number', 'step="0.001" min="0"')}
      <label>${t('نوع العقد')}<select name="contractType">${opt('', '—', !e.contractType)}${['عقد حكومي', 'عقد اهلي'].map(x => opt(x, t(x), x === e.contractType)).join('')}</select></label>
      <label>${t('مركز التكلفة')}<select name="costCenter">${costCenterOptions(e.costCenter)}</select></label>
      ${inp('actualWorkplace', 'مكان العمل الفعلي')}${inp('fileNo', 'رقم الملف')}
      ${inp('bank', 'البنك')}${inp('iban', 'IBAN', 'text', 'dir="ltr"')}${inp('dpId', 'مرجع إضافي')}
      <h4>الشركة والمشروع <button type="button" class="btn sm" id="aff-add">➕ ${t('انتماء إضافي')}</button></h4>
      <div class="full" id="aff-box" style="grid-column:1/-1">${renderAffRows(e.affiliations || [])}</div>
      <h4>المستندات</h4>
      ${dt('residencyExp', 'انتهاء الإقامة')}${dt('workPermitIssue', 'إصدار إذن العمل')}${dt('workPermitExp', 'انتهاء إذن العمل')}
      ${inp('passportNo', 'رقم الجواز', 'text', 'dir="ltr"')}${dt('passportIssueDate', 'تاريخ إصدار الجواز')}${dt('passportExp', 'انتهاء الجواز')}${dt('healthCardExp', 'انتهاء البطاقة الصحية')}
      <label class="check"><input type="checkbox" name="isDriver" ${e.isDriver ? 'checked' : ''}> 🚚 ${t('سائق')}</label>
      ${dt('drivingLicenseExp', 'انتهاء رخصة القيادة')}
      <h4>المعاملة الحكومية</h4>
      <label>${t('المرحلة')}<select name="govStage">${opt('', '—', !e.govStage)}${GOV_STAGES.map(g => opt(g.id, g.dot + ' ' + t(g.label), g.id === e.govStage)).join('')}</select></label>
      ${inp('govStageResponsible', 'المسؤول')}${dt('govStageStartDate', 'تاريخ بدء المعاملة')}${inp('govTransactionCost', 'تكلفة المعاملة', 'number', 'step="0.001" min="0"')}
      <label class="full">${t('ملاحظة تعطّل على المعاملة')}<input name="govStageNote" value="${v('govStageNote')}"></label>
      <label class="full">${t('حالة التحويل')}<input name="transferNote" value="${v('transferNote')}"></label>
      <label class="full">${t('ملاحظات')}<textarea name="notes" rows="2">${v('notes')}</textarea></label>
      </form>
      <datalist id="dl-nat">${uniq(STATE.employees.map(x => x.nationality)).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-prof">${uniq(STATE.employees.map(x => x.profession)).slice(0, 400).map(x => `<option value="${esc(x)}">`).join('')}</datalist>`,
    foot: `<button class="btn primary" data-save>💾 حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  const form = $('#emp-form', m.el);
  bindAffRows(form);
  $('#aff-add', m.el).onclick = () => {
    const affs = collectAffRows(form); affs.push({ companyId: '', projectId: '' });
    if (!affs[0].companyId && affs.length === 1) affs.push({});
    $('#aff-box', m.el).innerHTML = renderAffRows(affs); bindAffRows(form); translateDomText($('#aff-box', m.el));
  };
  const dd = $('#drop-draft', m.el); if (dd) dd.onclick = () => { clearDraft('employee'); m.close(); openEmployeeModal(null); };
  const collect = () => Object.assign(formValues(form), { affiliations: collectAffRows(form) });
  if (isNew) attachDraftAutosave('employee', form, collect);
  // ترجمة الجنسية تلقائيًا
  const natIn = form.querySelector('[name="nationality"]');
  natIn.addEventListener('change', () => {
    const en = form.querySelector('[name="nationalityEn"]');
    if (!en.value) { const ex = STATE.employees.find(x => x.nationality === natIn.value && x.nationalityEn); if (ex) en.value = ex.nationalityEn; }
  });
  const profIn = form.querySelector('[name="profession"]');
  profIn.addEventListener('change', () => {
    const en = form.querySelector('[name="professionEn"]');
    if (!en.value) { const ex = STATE.employees.find(x => x.profession === profIn.value && x.professionEn); if (ex) en.value = ex.professionEn; }
  });
  $('[data-save]', m.el).onclick = () => saveEmployee(isNew ? null : id, collect(), m);
}

/* ---------- منع التكرار (القسم 8.2) — فحص محلي سريع قبل السيرفر ---------- */
function findDuplicateCivilId(civil, exceptEmp) {
  const e = STATE.employees.find(x => x.id === civil && x.id !== exceptEmp); if (e) return e.name;
  const c = STATE.candidates.find(x => x.civilId && x.civilId === civil); return c ? c.name : null;
}
function findDuplicatePassport(p, exceptEmp, exceptCand) {
  if (!p) return null;
  const e = STATE.employees.find(x => x.passportNo === p && x.id !== exceptEmp); if (e) return e.name;
  const c = STATE.candidates.find(x => x.passportNo === p && x.id !== exceptCand); return c ? c.name : null;
}
function findDuplicateNameNationality(name, nat, { exceptEmp, exceptCand, withCandidates } = {}) {
  const n = norm(name), nt = norm(nat);
  const e = STATE.employees.find(x => x.id !== exceptEmp && norm(x.name) === n && norm(x.nationality) === nt); if (e) return e;
  if (withCandidates) return STATE.candidates.find(x => x.id !== exceptCand && norm(x.name) === n && norm(x.nationality) === nt) || null;
  return null;
}

async function saveEmployee(origId, data, modal) {
  if (!data.id || !/^\d{6,14}$/.test(data.id)) return openBlockAlert(t('الرقم المدني مطلوب (أرقام فقط)'));
  if (!data.name) return openBlockAlert(t('الاسم مطلوب'));
  let d = findDuplicateCivilId(data.id, origId);
  if (d) return openBlockAlert(t('الرقم المدني مسجّل بالفعل لـ') + ' ' + d);
  d = findDuplicatePassport(data.passportNo, origId);
  if (d) return openBlockAlert(t('رقم الجواز مسجّل بالفعل لـ') + ' ' + d);
  if (!origId) {
    const dup = findDuplicateNameNationality(data.name, data.nationality);
    if (dup && !await openConfirm(`⚠️ ${t('يوجد موظف بنفس الاسم والجنسية')}:\n${esc(dup.name)} (${esc(dup.id)})\n\n${t('هل تريد المتابعة والحفظ؟')}`, { okLabel: t('متابعة الحفظ') })) return;
    data.force = true;
  }
  try {
    await persist(origId ? 'PUT' : 'POST', origId ? '/api/employees/' + encodeURIComponent(origId) : '/api/employees', data, 'تم الحفظ');
    if (!origId) clearDraft('employee');
    modal.close();
  } catch (e) {
    if (e.data && e.data.block) openBlockAlert(e.message);
  }
}

/* =====================================================================
   BULK ASSIGN / RENEW / QUICK RENEW / GOV STAGE
   ===================================================================== */
function openBulkAssignModal(ids) {
  const m = openModal({
    title: t('تعيين جماعي') + ` (${ids.length})`,
    body: `<div class="form"><label>${t('الشركة')}<select name="companyId">${companyOptions('', '— بدون تغيير —')}</select></label>
      <label>${t('المشروع')}<select name="projectId">${projectOptions('', '')}</select></label>
      <label>${t('طريقة التعيين')}<select name="mode">${opt('replace', t('استبدال الانتماء الأساسي'), true)}${opt('add', t('إضافة كانتماء إضافي'))}</select></label>
      <label>${t('مركز التكلفة')}<select name="costCenter">${opt('__keep', t('— بدون تغيير —'), true)}${costCenterOptions('', '— إزالة —')}</select></label></div>`,
    foot: `<button class="btn primary" data-save>تطبيق</button><button class="btn" data-close>إلغاء</button>`,
  });
  const cs = $('[name="companyId"]', m.el);
  cs.onchange = () => { $('[name="projectId"]', m.el).innerHTML = projectOptions(cs.value, ''); };
  $('[data-save]', m.el).onclick = async () => {
    const v = formValues(m.el);
    const body = { ids, companyId: v.companyId, projectId: v.projectId, mode: v.mode };
    if (v.costCenter !== '__keep') body.costCenter = v.costCenter || '';
    if (!body.companyId && !body.projectId && body.costCenter === undefined) return toast('لم يتم اختيار أي تغيير', 'err');
    await persist('POST', '/api/employees/bulk-assign', body, 'تم التعيين');
    EMP_SELECTED.clear(); m.close(); render();
  };
}
function renewFieldOptions(sel) { return EMP_DATE_FIELDS.map(f => opt(f.key, t(f.label), f.key === sel)).join(''); }
function openBulkRenewModal(ids) {
  const m = openModal({
    title: t('تجديد جماعي') + ` (${ids.length})`, size: 'narrow',
    body: `<div class="form"><label class="full">${t('المستند')}<select name="field">${renewFieldOptions('residencyExp')}</select></label>
      <label class="full">${t('تاريخ الانتهاء الجديد')}<input type="date" name="date" value="${addYears(todayISO(), 1)}"></label>
      <label class="check full"><input type="checkbox" name="setRenewedStage"> ${t('تحويل مرحلة المعاملة إلى «تم التجديد»')}</label></div>`,
    foot: `<button class="btn primary" data-save>تجديد</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const v = formValues(m.el);
    if (!v.date) return toast('اختر التاريخ', 'err');
    await persist('POST', '/api/employees/renew', { ids, ...v }, 'تم التجديد');
    EMP_SELECTED.clear(); m.close(); render();
  };
}
function openQuickRenewModal(id, field = 'residencyExp') {
  const e = IDX.employee[id];
  const base = e[field] && daysUntil(e[field]) > -365 ? e[field] : todayISO();
  const m = openModal({
    title: '🔄 ' + t('تجديد سريع') + ' — ' + esc(e.name), size: 'narrow',
    body: `<div class="form"><label class="full">${t('المستند')}<select name="field">${renewFieldOptions(field)}</select></label>
      <div class="full small muted">${t('التاريخ الحالي')}: <span id="qr-cur">${datePill(e[field])}</span></div>
      <label class="full">${t('تاريخ الانتهاء الجديد')}<input type="date" name="date" value="${addYears(base, 1)}"></label>
      <div class="full row">${[1, 2, 3].map(y => `<button type="button" class="btn sm" data-y="${y}">+${y} ${t('سنة')}</button>`).join('')}</div>
      <label class="check full"><input type="checkbox" name="setRenewedStage" ${e.govStage && e.govStage !== 'renewed' ? 'checked' : ''}> ${t('تحويل مرحلة المعاملة إلى «تم التجديد»')}</label></div>`,
    foot: `<button class="btn primary" data-save>تجديد</button><button class="btn" data-close>إلغاء</button>`,
  });
  const fs = $('[name="field"]', m.el);
  fs.onchange = () => { $('#qr-cur', m.el).innerHTML = datePill(e[fs.value]); };
  $$('[data-y]', m.el).forEach(b => b.onclick = () => { const cur = e[fs.value] && daysUntil(e[fs.value]) > -365 ? e[fs.value] : todayISO(); $('[name="date"]', m.el).value = addYears(cur, +b.dataset.y); });
  $('[data-save]', m.el).onclick = async () => {
    const v = formValues(m.el);
    await persist('POST', '/api/employees/renew', { ids: [id], ...v }, 'تم التجديد');
    m.close(); openProfileCard(id, 'docs');
  };
}
function openGovStageModal(id) {
  const e = IDX.employee[id];
  const m = openModal({
    title: '🏛️ ' + t('مرحلة المعاملة الحكومية') + ' — ' + esc(e.name),
    body: `<div class="row" style="margin-bottom:12px;gap:6px">${GOV_STAGES.map(g => `<span class="chip clickable ${e.govStage === g.id ? 'on' : ''}" data-g="${g.id}">${g.dot} ${esc(t(g.label))}</span>`).join('')}</div>
      <div class="form"><input type="hidden" name="govStage" value="${esc(e.govStage || '')}">
      <label>${t('المسؤول')}<input name="govStageResponsible" value="${esc(e.govStageResponsible || '')}"></label>
      <label>${t('تاريخ البدء')}<input type="date" name="govStageStartDate" value="${esc(e.govStageStartDate || todayISO())}"></label>
      <label>${t('التكلفة (د.ك)')}<input type="number" step="0.001" name="govTransactionCost" value="${esc(e.govTransactionCost ?? '')}"></label>
      <label class="full">${t('ملاحظة تعطّل (تظهر في شريط التنبيه)')}<input name="govStageNote" value="${esc(e.govStageNote || '')}"></label></div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $$('[data-g]', m.el).forEach(c => c.onclick = () => { $$('[data-g]', m.el).forEach(x => x.classList.toggle('on', x === c)); $('[name="govStage"]', m.el).value = c.dataset.g; });
  $('[data-save]', m.el).onclick = async () => {
    const v = formValues(m.el);
    await persist('POST', `/api/employees/${encodeURIComponent(id)}/gov-stage`, v, 'تم الحفظ');
    m.close(); openProfileCard(id, 'docs');
  };
}
