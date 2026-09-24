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

function filteredEmployees() {
  const f = UI.emp;
  const q = norm(f.q);
  return scopedEmployees().filter(e => {
    if (q && ![e.name, e.nameEn, e.id, e.passportNo, e.fileNo, e.profession, e.phone, e.nationality].some(v => norm(v).includes(q))) return false;
    if (f.company && !(e.affiliations || []).some(a => a.companyId === f.company)) return false;
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
  EMP_SELECTED = new Set([...EMP_SELECTED].filter(id => IDX.employee[id]));
  const sel = EMP_SELECTED.size;
  const sortIco = k => f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : '';

  viewRoot().innerHTML = `
    <div class="page-head"><div><h1>مركز إدارة الإقامات والموظفين</h1><div class="sub">${list.length} ${t('من')} ${scopedEmployees().length} ${t('موظف')}</div></div>
      <div class="actions">
        <button class="btn primary write-only" id="e-add">➕ إضافة موظف</button>
        <button class="btn write-only" id="e-import">📥 استيراد Excel/CSV</button>
        <button class="btn" id="e-export">📤 تصدير CSV</button>
        <button class="btn" id="e-print">🖨️ تقرير</button>
        <button class="btn" id="e-cal">📅 تقويم التجديدات</button>
      </div></div>
    <div class="filters no-print">
      <input type="search" id="f-q" placeholder="بحث بالاسم، الرقم المدني، الجواز، رقم الملف…" value="${esc(f.q)}">
      <select id="f-company">${companyOptions(f.company, '— كل الشركات —')}</select>
      <select id="f-project">${opt('', t('— كل المشاريع —'), !f.project)}${opt('__none', t('بدون مشروع'), f.project === '__none')}${STATE.projects.filter(p => !f.company || p.companyId === f.company).map(p => opt(p.id, projectName(p.id), p.id === f.project)).join('')}</select>
      <select id="f-status">${opt('', t('— كل الحالات —'), !f.status)}${Object.entries(EMP_STATUS_LABELS).map(([k, v]) => opt(k, LANG === 'en' ? v.en : v.ar, k === f.status)).join('')}</select>
      <select id="f-stage">${opt('', t('— كل مراحل المعاملات —'), !f.stage)}${opt('__none', t('بدون معاملة'), f.stage === '__none')}${opt('__note', t('عليها ملاحظة تعطّل'), f.stage === '__note')}${GOV_STAGES.map(g => opt(g.id, g.dot + ' ' + t(g.label), g.id === f.stage)).join('')}</select>
      <select id="f-nat">${opt('', t('— كل الجنسيات —'), !f.nationality)}${nats.map(n => opt(n, n, n === f.nationality)).join('')}</select>
      <select id="f-cc">${costCenterOptions(f.costCenter, '— كل مراكز التكلفة —')}</select>
      <select id="f-tierfield">${opt('any', t('أي مستند'), f.tierField === 'any')}${EMP_DATE_FIELDS.map(x => opt(x.key, t(x.label), x.key === f.tierField)).join('')}</select>
      <select id="f-tier">${opt('', t('— كل المستويات —'), !f.tier)}${opt('soon', t('منتهي أو خلال 30 يوم'), f.tier === 'soon')}${Object.entries(TIERS).map(([k, v]) => opt(k, t(v.label), k === f.tier)).join('')}</select>
      <label class="chip clickable ${f.driver ? 'on' : ''}"><input type="checkbox" id="f-driver" ${f.driver ? 'checked' : ''} hidden>🚚 ${t('السائقين فقط')}</label>
      <button class="btn sm ghost" id="f-clear">✕ ${t('مسح الفلاتر')}</button>
    </div>
    ${sel ? `<div class="bulkbar no-print"><b>${sel} ${t('محدد')}</b>
      <button class="btn sm write-only" id="b-assign">🏢 تعيين جماعي</button>
      <button class="btn sm write-only" id="b-renew">🔄 تجديد جماعي</button>
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
        return `<tr class="clickable ${EMP_SELECTED.has(e.id) ? 'sel' : ''}" data-id="${esc(e.id)}">
          <td data-nosel><input type="checkbox" data-sel="${esc(e.id)}" ${EMP_SELECTED.has(e.id) ? 'checked' : ''}></td>
          <td><b>${esc(empName(e))}</b>${e.isDriver ? ' 🚚' : ''}${e.govStageNote ? ` <span title="${esc(e.govStageNote)}">⚠️</span>` : ''}${LANG !== 'en' && e.nameEn ? `<div class="small muted" dir="ltr" style="text-align:start">${esc(e.nameEn)}</div>` : ''}</td>
          <td class="num">${esc(e.id)}</td>
          <td>${esc(e.nationality || '—')}</td>
          <td>${esc(e.profession || '—')}</td>
          <td><div style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(companyName(a.companyId))}">${esc(companyName(a.companyId) || '—')}</div><div class="small muted">${esc(projectName(a.projectId))}</div></td>
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
  $('#f-project').onchange = e => upd({ project: e.target.value });
  $('#f-status').onchange = e => upd({ status: e.target.value });
  $('#f-stage').onchange = e => upd({ stage: e.target.value });
  $('#f-nat').onchange = e => upd({ nationality: e.target.value });
  $('#f-cc').onchange = e => upd({ costCenter: e.target.value });
  $('#f-tierfield').onchange = e => upd({ tierField: e.target.value });
  $('#f-tier').onchange = e => upd({ tier: e.target.value });
  $('#f-driver').onchange = e => upd({ driver: e.target.checked });
  $('#f-clear').onclick = () => upd({ q: '', company: '', project: '', status: '', stage: '', nationality: '', costCenter: '', tier: '', tierField: 'any', driver: false });
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
  $('#e-print').onclick = () => printEmployeeReport(list);
  $('#e-cal').onclick = () => renderRenewalCalendarModal();
  if (sel) {
    const selected = () => list.filter(e => EMP_SELECTED.has(e.id)).concat([...EMP_SELECTED].filter(id => !list.find(e => e.id === id)).map(id => IDX.employee[id]).filter(Boolean));
    $('#b-assign').onclick = () => openBulkAssignModal([...EMP_SELECTED]);
    $('#b-renew').onclick = () => openBulkRenewModal([...EMP_SELECTED]);
    $('#b-export').onclick = () => exportEmployeesCsv(selected());
    $('#b-print').onclick = () => printEmployeeReport(selected());
    $('#b-clear').onclick = () => { EMP_SELECTED.clear(); render(); };
  }
}

/* ---------- التصدير والتقارير ---------- */
function exportEmployeesCsv(list) {
  const head = ['الرقم المدني', 'الاسم', 'English name', 'الجنسية', 'المهنة', 'الشركة', 'المشروع', 'مركز التكلفة', 'الراتب', 'بدل السكن',
    'الحالة الوظيفية', 'تاريخ التعيين', 'انتهاء الإقامة', 'انتهاء إذن العمل', 'رقم الجواز', 'انتهاء الجواز', 'انتهاء البطاقة الصحية',
    'سائق', 'انتهاء رخصة القيادة', 'مرحلة المعاملة', 'ملاحظة المعاملة', 'رقم الملف', 'نوع العقد', 'آخر تعديل', 'بواسطة'];
  const rows = list.map(e => [e.id, e.name, e.nameEn, e.nationality, e.profession, companyName(empCompanyId(e)), projectName(primaryAff(e).projectId), e.costCenter,
    e.salary, e.housingIncluded ? (e.housingAmount || 'نعم') : '', (EMP_STATUS_LABELS[e.employmentStatus] || {}).ar, e.dateOfHire, e.residencyExp, e.workPermitExp,
    e.passportNo, e.passportExp, e.healthCardExp, e.isDriver ? 'نعم' : '', e.drivingLicenseExp, (govStageInfo(e.govStage) || {}).label, e.govStageNote,
    e.fileNo, e.contractType, e.lastUpdated, e.lastUpdatedBy]);
  downloadBlob(toCsv([head.map(t), ...rows]), `employees-${todayISO()}.csv`, 'text/csv;charset=utf-8');
}
function printEmployeeReport(list) {
  const f = UI.emp;
  const filt = [f.company && companyName(f.company), f.project && projectName(f.project), f.status && (EMP_STATUS_LABELS[f.status] || {}).ar,
    f.stage && (govStageInfo(f.stage) || {}).label, f.nationality, f.costCenter, f.q && '«' + f.q + '»'].filter(Boolean).join(' · ');
  printHtml(t('تقرير الموظفين'), `<h1>${t('تقرير الموظفين')}</h1><div class="muted">${fmtDate(todayISO())} · ${list.length} ${t('موظف')}${filt ? ' · ' + esc(filt) : ''}</div>
    <table><thead><tr><th>#</th><th>${t('الاسم')}</th><th>${t('الرقم المدني')}</th><th>${t('الجنسية')}</th><th>${t('المهنة')}</th><th>${t('الشركة')}</th><th>${t('الإقامة')}</th><th>${t('إذن العمل')}</th><th>${t('الجواز')}</th><th>${t('المعاملة')}</th></tr></thead>
    <tbody>${list.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(empName(e))}</td><td>${esc(e.id)}</td><td>${esc(e.nationality || '')}</td><td>${esc(e.profession || '')}</td>
      <td>${esc(companyName(empCompanyId(e)))}</td><td>${datePill(e.residencyExp)}</td><td>${datePill(e.workPermitExp)}</td><td>${datePill(e.passportExp)}</td>
      <td>${esc(t((govStageInfo(e.govStage) || {}).label || ''))}${e.govStageNote ? ' — ' + esc(e.govStageNote) : ''}</td></tr>`).join('')}</tbody></table>`);
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
        <button data-tab="files" class="${tab === 'files' ? 'active' : ''}">المرفقات</button>
        <button data-tab="timeline" class="${tab === 'timeline' ? 'active' : ''}">السجل (${tl.length})</button>
      </div>
      <div data-pane="info" ${tab !== 'info' ? 'hidden' : ''}><div class="kv">
        ${field('الرقم المدني', `<b class="num">${esc(e.id)}</b>`)}${field('الجنسية', esc(e.nationality))}${field('المهنة', esc(e.profession) + (e.professionEn ? `<div class="small muted">${esc(e.professionEn)}</div>` : ''))}
        ${field('تاريخ الميلاد', fmtDate(e.dateOfBirth))}${field('تاريخ التعيين', fmtDate(e.dateOfHire))}${field('الراتب', fmtMoney(e.salary))}
        ${field('بدل السكن', e.housingIncluded ? (e.housingAmount ? fmtMoney(e.housingAmount) : t('مشمول')) : t('غير مشمول'))}
        ${field('نوع العقد', esc(e.contractType))}${field('رقم الملف', esc(e.fileNo))}${field('مركز التكلفة', esc(e.costCenter))}
        ${field('مكان العمل الفعلي', esc(e.actualWorkplace))}${field('الهاتف', esc(e.phone))}${field('البنك', esc(e.bank) + (e.iban ? `<div class="small muted">${esc(e.iban)}</div>` : ''))}
        ${field('مرجع إضافي', esc(e.dpId))}
      </div>
      <h4>${t('الشركات والمشاريع')}</h4>
      ${(e.affiliations || []).map((a, i) => `<div class="row" style="padding:4px 0">${i === 0 ? '<span class="chip on">' + t('أساسي') + '</span>' : '<span class="chip">' + t('إضافي') + '</span>'} <b>${esc(companyName(a.companyId) || '—')}</b> <span class="muted">${esc(projectName(a.projectId))}</span></div>`).join('') || '<div class="muted">—</div>'}
      ${vehicles.length ? `<h4>${t('السيارات')}</h4>` + vehicles.map(v => `<div>🚗 ${esc(v.plate)} ${esc(v.model || '')}</div>`).join('') : ''}
      ${e.notes ? `<h4>${t('ملاحظات')}</h4><div style="white-space:pre-line">${esc(e.notes)}</div>` : ''}
      </div>
      <div data-pane="docs" ${tab !== 'docs' ? 'hidden' : ''}>
        <table class="data"><thead><tr><th>المستند</th><th>الرقم</th><th>تاريخ الانتهاء</th><th>المتبقي</th><th class="write-only"></th></tr></thead><tbody>
        ${EMP_DATE_FIELDS.filter(f => !f.driverOnly || e.isDriver).map(f => `<tr><td>${esc(t(f.label))}</td><td>${f.key === 'passportExp' ? esc(e.passportNo || '') : ''}</td><td>${datePill(e[f.key])}</td><td class="small">${esc(daysText(daysUntil(e[f.key])))}</td>
          <td class="write-only"><button class="btn sm" data-renew="${f.key}">🔄 ${t('تجديد سريع')}</button></td></tr>`).join('')}
        </tbody></table>
        <h4>${t('المعاملة الحكومية')}</h4>
        <div class="kv">${field('المرحلة', govStagePill(e.govStage))}${field('المسؤول', esc(e.govStageResponsible))}${field('تاريخ البدء', fmtDate(e.govStageStartDate))}${field('التكلفة', fmtMoney(e.govTransactionCost))}</div>
        ${comp.missing.length ? `<div class="notice warn" style="margin-top:10px">${t('بيانات ناقصة')}: ${comp.missing.map(x => esc(t(x))).join('، ')}</div>` : ''}
      </div>
      <div data-pane="files" ${tab !== 'files' ? 'hidden' : ''}><div id="emp-files"><div class="muted">${t('جاري التحميل…')}</div></div>
        <button class="btn write-only" id="emp-upload" style="margin-top:10px">📎 ${t('رفع مرفق')}</button></div>
      <div data-pane="timeline" ${tab !== 'timeline' ? 'hidden' : ''}><ul class="timeline">${tl.map(x => `<li><span class="muted small">${fmtDateTime(x.date)} · ${esc(x.user || '')}</span><br>${esc(x.label)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>`,
    foot: `<button class="btn primary write-only" data-a="edit">✏️ تعديل</button>
      <button class="btn write-only" data-a="stage">🏛️ مرحلة المعاملة</button>
      <button class="btn" data-a="contract">📄 عقد العمل</button>
      <button class="btn" data-a="print">🖨️ طباعة</button>
      <span class="spacer"></span>
      <button class="btn danger write-only" data-a="delete">🗑️ حذف</button>`,
  });
  $$('[data-tab]', m.el).forEach(b => b.onclick = () => {
    $$('[data-tab]', m.el).forEach(x => x.classList.toggle('active', x === b));
    $$('[data-pane]', m.el).forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
    if (b.dataset.tab === 'files') loadDriveFiles(e.id, m.el);
  });
  if (tab === 'files') loadDriveFiles(e.id, m.el);
  $$('[data-renew]', m.el).forEach(b => b.onclick = () => { m.close(); openQuickRenewModal(e.id, b.dataset.renew); });
  const up = $('#emp-upload', m.el); if (up) up.onclick = () => uploadFileForEmployee(e.id, m.el);
  $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'edit') { m.close(); openEmployeeModal(e.id); }
    else if (a === 'stage') { m.close(); openGovStageModal(e.id); }
    else if (a === 'contract') { m.close(); VIEW_ARGS = { emp: e.id }; setView('contract'); }
    else if (a === 'print') printHtml(e.name, `<h1>${esc(e.name)}</h1><div class="muted">${esc(e.nameEn || '')} · ${esc(e.id)}</div>` + $('[data-pane="info"]', m.el).innerHTML + $('[data-pane="docs"]', m.el).innerHTML);
    else if (a === 'delete') {
      if (await openConfirm(`${t('حذف الموظف')} «${esc(e.name)}» ${t('نهائيًا؟')}`, { danger: true, okLabel: t('حذف') })) {
        m.close(); await persist('DELETE', '/api/employees/' + encodeURIComponent(e.id), undefined, 'تم الحذف');
      }
    }
  });
}

/* ---------- المرفقات (بديل Google Drive: التخزين على السيرفر) ---------- */
async function loadDriveFiles(empId, root) {
  const box = $('#emp-files', root);
  try {
    const files = await api('GET', `/api/employees/${encodeURIComponent(empId)}/files`);
    box.innerHTML = files.length ? `<table class="data"><tbody>${files.map(f => `<tr><td>📄 <a href="/files/emp/${f.id}" target="_blank">${esc(f.name)}</a></td>
      <td class="small muted">${(f.size / 1024).toFixed(0)} KB</td><td class="small muted">${fmtDateTime(f.uploaded_at)} ${esc(f.uploaded_by || '')}</td>
      <td><a class="btn sm" href="/files/emp/${f.id}?dl=1">⬇️</a> <button class="btn sm danger write-only" data-del="${f.id}">🗑️</button></td></tr>`).join('')}</tbody></table>`
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
  return affs.map((a, i) => `<div class="row aff-row" style="margin-bottom:6px">
    <span class="chip ${i === 0 ? 'on' : ''}">${i === 0 ? t('أساسي') : t('إضافي')}</span>
    <select data-aff="company">${companyOptions(a.companyId)}</select>
    <select data-aff="project">${projectOptions(a.companyId, a.projectId)}</select>
    ${i > 0 ? '<button type="button" class="btn sm danger" data-aff-del>✕</button>' : ''}</div>`).join('');
}
function collectAffRows(root) {
  return $$('.aff-row', root).map(r => ({ companyId: $('[data-aff="company"]', r).value || null, projectId: $('[data-aff="project"]', r).value || null }))
    .filter(a => a.companyId || a.projectId);
}
function bindAffRows(root) {
  $$('.aff-row', root).forEach(r => {
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
  const inp = (k, l, type = 'text', extra = '') => `<label>${esc(t(l))}<input name="${k}" type="${type}" value="${v(k)}" ${extra}></label>`;
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
      ${dt('dateOfBirth', 'تاريخ الميلاد')}${dt('dateOfHire', 'تاريخ التعيين')}
      ${inp('phone', 'الهاتف')}
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
      ${inp('passportNo', 'رقم الجواز', 'text', 'dir="ltr"')}${dt('passportExp', 'انتهاء الجواز')}${dt('healthCardExp', 'انتهاء البطاقة الصحية')}
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
