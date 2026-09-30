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

// الفلاتر اللي بتاخد أكتر من اختيار (الموظف بيظهر لو طابق أي اختيار في الفلتر الواحد، ولازم يطابق كل الفلاتر)
const EMP_MULTI = ['company', 'project', 'agency', 'status', 'stage', 'nationality', 'costCenter', 'profession'];
// فلاتر تقرير الموظفين (الجنسية ليها اختيار خاص في التقرير)
const EMP_RB_MULTI = ['company', 'project', 'agency', 'status', 'costCenter', 'stage', 'profession'];
function filteredEmployees(f = UI.emp) {
  const q = norm(f.q);
  const L = Object.fromEntries(EMP_MULTI.map(k => [k, asList(f[k])]));
  return scopedEmployees().filter(e => {
    if (q && ![e.name, e.nameEn, e.id, e.passportNo, e.fileNo, e.profession, e.phone, e.nationality].some(v => norm(v).includes(q))) return false;
    if (L.company.length && !L.company.some(c => empInCompany(e, c))) return false;
    if (f.link && empLinkIn(e, L.company) !== f.link) return false;
    if (L.project.length && !L.project.some(p => p === '__none' ? !primaryAff(e).projectId : (e.affiliations || []).some(a => a.projectId === p))) return false;
    if (L.agency.length && !L.agency.includes((projectAgency(empProjectId(e)) || {}).id || '__none')) return false;
    if (f.outside && !empOutsideAgency(e)) return false;
    if (L.status.length && !L.status.includes(e.employmentStatus || 'active')) return false;
    if (L.stage.length && !L.stage.some(x => x === '__none' ? !e.govStage : x === '__note' ? !!e.govStageNote : e.govStage === x)) return false;
    if (L.nationality.length && !L.nationality.includes(e.nationality || '—')) return false;
    if (L.profession.length && !L.profession.includes(e.profession || '—')) return false;
    // تقرير الموظفين: جنسيات محددة فقط (in) أو كل الجنسيات ماعدا المحددة (out)
    if ((f.natMode === 'in' || f.natMode === 'out') && f.nats && f.nats.length
        && f.nats.includes(e.nationality || '—') !== (f.natMode === 'in')) return false;
    // تقرير الموظفين: تاريخ انتهاء مستند (الإقامة افتراضيًا) في فترة من/إلى
    if (f.dFrom || f.dTo) {
      const [a, b] = f.dFrom && f.dTo && f.dFrom > f.dTo ? [f.dTo, f.dFrom] : [f.dFrom, f.dTo];
      const d = e[f.dField || 'residencyExp'];
      if (!d || (a && d < a) || (b && d > b)) return false;
    }
    if (L.costCenter.length && !L.costCenter.includes(e.costCenter || '')) return false;
    if (f.driver && !e.isDriver) return false;
    if (f.tier) {                                      // «خلال 60 يوم» = من النهارده لحد 60 يوم (TIER_WITHIN)
      const fields = f.tierField === 'any' ? EMP_DATE_FIELDS.filter(x => !x.driverOnly || e.isDriver).map(x => x.key) : [f.tierField];
      if (!fields.some(k => tierIn(e[k], f.tier))) return false;
    }
    return true;
  });
}
/** ارتباط الموظف بالشركات المختارة: مسجّل على واحدة منهم ('company')، أو تابع لها بمركز التكلفة بس ('cc') */
function empLinkIn(e, cids) {
  if (!cids.length) return empLink(e, '');
  const ls = cids.map(c => empLink(e, c));
  return ls.includes('company') ? 'company' : ls.includes('cc') ? 'cc' : null;
}
/** اختيارات فلتر (للشاشة والتقرير) — الجنسيات والمهن بعددهم، والأكتر الأول */
function empMsOptions(key, companies = []) {
  const counted = (fn, label) => {
    const m = {};
    scopedEmployees().forEach(e => { const k = fn(e) || '—'; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b, 'ar')).map(k => ({ v: k, l: label(k), n: m[k] }));
  };
  if (key === 'company') return scopedCompanies().map(c => ({ v: c.id, l: companyName(c.id) }));
  if (key === 'project') return [{ v: '__none', l: t('بدون مشروع') }, ...scopedProjects().filter(p => !companies.length || companies.includes(p.companyId))
    .map(p => ({ v: p.id, l: projectName(p.id) + (companies.length === 1 ? '' : ' — ' + companyName(p.companyId)) }))];
  if (key === 'agency') return [{ v: '__none', l: t('بدون وكالة') }, ...(STATE.agencies || []).map(a => ({ v: a.id, l: agencyName(a) }))];
  if (key === 'status') return Object.entries(EMP_STATUS_LABELS).map(([k, v]) => ({ v: k, l: LANG === 'en' ? v.en : v.ar }));
  if (key === 'stage') return [{ v: '__none', l: t('بدون معاملة') }, { v: '__note', l: t('عليها ملاحظة تعطّل') }, ...GOV_STAGES.map(g => ({ v: g.id, l: g.dot + ' ' + t(g.label) }))];
  if (key === 'nationality') return counted(e => e.nationality, natLabel);
  if (key === 'profession') return counted(e => e.profession, profLabel);
  if (key === 'costCenter') return (STATE.costCenters || []).map(c => ({ v: c.name, l: ccLabel(c.name) }));
  return [];
}
const EMP_MS_LABELS = { company: ['الشركة', '— كل الشركات —'], project: ['العقد / المشروع', '— كل العقود والمشاريع —'], agency: ['الوكالة', '— كل الوكالات —'], status: ['الحالة', '— كل الحالات —'],
  stage: ['المعاملة', '— كل مراحل المعاملات —'], nationality: ['الجنسية', '— كل الجنسيات —'], costCenter: ['مركز التكلفة', '— كل مراكز التكلفة —'],
  profession: ['المهنة', '— كل المهن —'] };
function empMsField(prefix, key, sel, companies) { const [title, all] = EMP_MS_LABELS[key]; return msField(prefix + key, title, all, empMsOptions(key, companies), sel); }
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
  EMP_MULTI.forEach(k => { f[k] = asList(f[k]); });     // فلاتر قديمة محفوظة كنص ← قائمة
  f.tier = tierFilterValue(f.tier);                      // مستويات اتشالت (منتهي / سارية / بدون تاريخ)
  const all = filteredEmployees();
  const list = sortEmployees(all);
  const pages = Math.max(1, Math.ceil(list.length / f.perPage));
  if (f.page > pages) f.page = pages;
  const pageList = list.slice((f.page - 1) * f.perPage, f.page * f.perPage);
  // عدادات «على الشركة / على مركز التكلفة» بكل الفلاتر ماعدا فلتر الارتباط نفسه
  const linkBase = f.link ? filteredEmployees({ ...f, link: '' }) : all;
  const linkCount = k => linkBase.filter(e => empLinkIn(e, f.company) === k).length;
  const linkBar = `<div class="row no-print" style="gap:6px;margin:0 0 8px;flex-wrap:wrap">
      <span class="small muted">${f.company.length === 1 ? esc(companyName(f.company[0])) + ':' : f.company.length ? t('الشركات المحددة') + ':' : t('الارتباط بالشركة') + ':'}</span>
      ${['company', 'cc'].map(k => `<span class="chip clickable ${f.link === k ? 'on' : ''}" data-link="${k}">${EMP_LINKS[k].ico} ${esc(t(EMP_LINKS[k].label))} <b class="num">${linkCount(k)}</b></span>`).join('')}
      ${f.link ? `<span class="chip clickable" data-link="">✕ ${t('الكل')}</span>` : ''}
      ${!f.company.length ? `<span class="small muted">${t('(🏭 = شغال في شركة غير المسجّل عليها — اختار شركة من الفلتر للتفاصيل)')}</span>` : ''}</div>`;
  EMP_SELECTED = new Set([...EMP_SELECTED].filter(id => IDX.employee[id]));
  const sel = EMP_SELECTED.size;
  const sortIco = k => f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : '';

  viewRoot().innerHTML = `
    <div class="page-head"><div><h1>مركز إدارة الإقامات والموظفين</h1><div class="sub">${list.length} ${t('من')} ${scopedEmployees().length} ${t('موظف')}</div></div>
      <div class="actions">

        <button class="btn write-only" data-p="employees.edit system.import sensitive.salary sensitive.bank sensitive.documents scope.all" id="e-import">📥 استيراد Excel/CSV</button>
        ${can('admin') ? `<button class="btn" id="e-export">📤 ${t('تصدير CSV')}</button>` : ''}
        <button class="btn" id="e-print">🖨️ تقرير</button>
        <button class="btn" id="e-cal">📅 تقويم التجديدات</button>
        <button class="btn" id="e-letters">📨 ${t('سجل الخطابات')}</button>
      </div></div>
    <div class="filters no-print">
      <input type="search" id="f-q" placeholder="بحث بالاسم، الرقم المدني، الجواز، رقم الملف…" value="${esc(f.q)}">
      ${EMP_MULTI.map(k => empMsField('emp.', k, f[k], f.company)).join('')}
      <select id="f-tierfield">${opt('any', t('أي مستند'), f.tierField === 'any')}${EMP_DATE_FIELDS.map(x => opt(x.key, t(x.label), x.key === f.tierField)).join('')}</select>
      <select id="f-tier">${opt('', t('— كل المستويات —'), !f.tier)}${TIER_FILTERS.map(k => opt(k, t(TIERS[k].label), k === f.tier)).join('')}</select>
      <label class="chip clickable ${f.driver ? 'on' : ''}"><input type="checkbox" id="f-driver" ${f.driver ? 'checked' : ''} hidden>🚚 ${t('السائقين فقط')}</label>
      <button class="btn sm ghost" id="f-clear">✕ ${t('مسح الفلاتر')}</button>
    </div>
    ${linkBar}
    ${sel ? `<div class="bulkbar no-print"><b>${sel} ${t('محدد')}</b>
      <button class="btn sm write-only" data-p="employees.edit" id="b-assign">🏢 تعيين جماعي</button>
      <button class="btn sm write-only" data-p="employees.edit" id="b-renew">🔄 تجديد جماعي</button>
      <button class="btn sm" data-p="contract.view sensitive.salary" id="b-contracts">📄 عقود المحدد (PDF)</button>
      ${can('admin') ? `<button class="btn sm" id="b-export">📤 ${t('تصدير المحدد')}</button>` : ''}
      <button class="btn sm" id="b-print">🖨️ طباعة المحدد</button>
      <span class="spacer"></span><button class="btn sm ghost" id="b-clear">${t('إلغاء التحديد')}</button></div>` : ''}
    <div class="table-wrap"><table class="data" id="emp-table"><thead><tr>
      <th style="width:30px"><input type="checkbox" id="sel-all" ${pageList.length && pageList.every(e => EMP_SELECTED.has(e.id)) ? 'checked' : ''}></th>
      ${EMP_COLUMNS.filter(c => c.key !== 'urgency').map(c => `<th data-sort="${c.key}">${esc(t(c.label))}${sortIco(c.key)}</th>`).join('')}
      <th data-sort="urgency">${t('الاكتمال')}${sortIco('urgency')}</th></tr></thead>
      <tbody>${pageList.map(e => {
        const comp = empDocCompleteness(e);
        const a = primaryAff(e);
        const link = empLinkIn(e, f.company), ccCo = costCenterCompanyId(e.costCenter);
        return `<tr class="clickable ${EMP_SELECTED.has(e.id) ? 'sel' : ''}" data-id="${esc(e.id)}">
          <td data-nosel><input type="checkbox" data-sel="${esc(e.id)}" ${EMP_SELECTED.has(e.id) ? 'checked' : ''}></td>
          <td><b>${esc(empName(e))}</b>${e.isDriver ? ' 🚚' : ''}${e.govStageNote ? ` <span title="${esc(e.govStageNote)}">⚠️</span>` : ''}${LANG !== 'en' && e.nameEn ? `<div class="small muted" dir="ltr" style="text-align:start">${esc(e.nameEn)}</div>` : ''}</td>
          <td class="num">${esc(e.id)}</td>
          <td>${esc(personNat(e) || '—')}</td>
          <td>${esc(personProf(e) || '—')}</td>
          <td><div style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(companyName(a.companyId))}">${esc(companyName(a.companyId) || '—')}</div><div class="small muted">${esc(projectName(a.projectId))}</div>
            ${link === 'cc' ? `<div class="small" style="color:var(--orange)" title="${esc(t('مركز التكلفة') + ': ' + (e.costCenter || ''))}">🏭 ${esc(companyName(ccCo) || e.costCenter || '')}</div>` : ''}
            ${f.company.length ? empLinkChip(link) : ''}</td>
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
  // الشركات اتغيّرت ← المشاريع اللي مش تبعها بتتشال
  msBind(viewRoot(), (key, vals) => {
    const k = key.slice(4), patch = { [k]: vals };
    if (k === 'company' && vals.length) patch.project = f.project.filter(p => p === '__none' || vals.includes((IDX.project[p] || {}).companyId));
    upd(patch);
  });
  $$('[data-link]', viewRoot()).forEach(c => c.onclick = () => upd({ link: UI.emp.link === c.dataset.link ? '' : c.dataset.link }));
  $('#f-tierfield').onchange = e => upd({ tierField: e.target.value });
  $('#f-tier').onchange = e => upd({ tier: e.target.value });
  $('#f-driver').onchange = e => upd({ driver: e.target.checked });
  $('#f-clear').onclick = () => { msClose(); upd({ q: '', company: [], link: '', project: [], agency: [], status: [], stage: [], nationality: [], costCenter: [], profession: [], tier: '', tierField: 'any', driver: false }); };
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
  $('#e-import').onclick = handleImportCsv;
  const ex = $('#e-export'); if (ex) ex.onclick = () => exportGuard(`${t('الموظفين')} (${list.length})`, () => exportEmployeesCsv(list));
  $('#e-print').onclick = () => openEmployeeReportModal();
  $('#e-cal').onclick = () => renderRenewalCalendarModal();
  $('#e-letters').onclick = () => openLettersLog();
  if (sel) {
    const selected = () => list.filter(e => EMP_SELECTED.has(e.id)).concat([...EMP_SELECTED].filter(id => !list.find(e => e.id === id)).map(id => IDX.employee[id]).filter(Boolean));
    $('#b-assign').onclick = () => openBulkAssignModal([...EMP_SELECTED]);
    $('#b-renew').onclick = () => openBulkRenewModal([...EMP_SELECTED]);
    $('#b-contracts').onclick = () => openBatchContractModal(selected().map(e => e.id));
    const bx = $('#b-export'); if (bx) bx.onclick = () => exportGuard(`${t('الموظفين المحددين')} (${selected().length})`, () => exportEmployeesCsv(selected()));
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
    companyName(costCenterCompanyId(e.costCenter)), t(EMP_LINKS[empLinkIn(e, asList(UI.emp.company))]?.label || '')]);
  const drop = [[8, 'salary'], [14, 'passportNo']].filter(([, f]) => hiddenField('employee', f)).map(([i]) => i);
  const keep = r => r.filter((_, i) => !drop.includes(i));
  downloadBlob(toCsv([keep(head).map(t), ...rows.map(keep)]), `employees-${todayISO()}.csv`, 'text/csv;charset=utf-8');
}
/* ---------- تقرير الموظفين: اختيار الأعمدة والفلاتر والتجميع ← openReportWindow ----------
   الأعمدة: v = القيمة (نص)، date = تاريخ (شارة ملوّنة حسب المستوى)، money = مبلغ (بيتجمع)، perm = صلاحية لازمة */
const EMP_REPORT_GROUPS = [['basic', 'البيانات الأساسية'], ['work', 'العمل'], ['docs', 'المستندات'], ['gov', 'المعاملة الحكومية'], ['contact', 'الاتصال والبنك']];
const EMP_REPORT_COLS = [
  { k: 'name', g: 'basic', l: 'الاسم', v: e => empName(e), txt: true },
  { k: 'nameEn', g: 'basic', l: 'الاسم (إنجليزي)', v: e => e.nameEn, ltr: true },
  { k: 'id', g: 'basic', l: 'الرقم المدني', v: e => e.id, num: true },
  { k: 'unifiedNumber', g: 'basic', l: 'الرقم الموحد', v: e => e.unifiedNumber, num: true },
  { k: 'nationality', g: 'basic', l: 'الجنسية', v: e => personNat(e) },
  { k: 'gender', g: 'basic', l: 'الجنس', v: e => t(GENDER_LABELS[e.gender] || '') },
  { k: 'dateOfBirth', g: 'basic', l: 'تاريخ الميلاد', date: true },
  { k: 'profession', g: 'basic', l: 'المهنة', v: e => personProf(e) },
  { k: 'maritalStatus', g: 'basic', l: 'الحالة الاجتماعية', v: e => maritalLabel(e) },
  { k: 'qualification', g: 'basic', l: 'المؤهل الدراسي', v: e => e.qualification },
  { k: 'specialization', g: 'basic', l: 'التخصص', v: e => e.specialization },
  { k: 'university', g: 'basic', l: 'الجامعة / جهة التخرج', v: e => e.university },
  { k: 'childrenCount', g: 'basic', l: 'عدد الأبناء', v: e => (e.children || []).length || '', num: true },
  { k: 'company', g: 'work', l: 'الشركة', v: e => companyName(empCompanyId(e)) },
  { k: 'project', g: 'work', l: 'المشروع', v: e => projectName(primaryAff(e).projectId) },
  { k: 'costCenter', g: 'work', l: 'مركز التكلفة', v: e => ccLabel(e.costCenter) },
  { k: 'status', g: 'work', l: 'الحالة الوظيفية', v: e => { const s = EMP_STATUS_LABELS[e.employmentStatus || 'active'] || {}; return LANG === 'en' ? s.en : s.ar; } },
  { k: 'dpId', g: 'work', l: 'الرقم الوظيفي', v: e => e.dpId, num: true },
  { k: 'dateOfHire', g: 'work', l: 'تاريخ التعيين', date: true, plain: true },
  { k: 'kuwaitEntryDate', g: 'work', l: 'تاريخ دخول الكويت', date: true, plain: true },
  { k: 'serviceEndDate', g: 'work', l: 'تاريخ انتهاء الخدمة', date: true, plain: true },
  { k: 'serviceEndReason', g: 'work', l: 'سبب انتهاء الخدمة', v: e => t(e.serviceEndReason) },
  { k: 'contractType', g: 'work', l: 'نوع العقد', v: e => t(e.contractType) },
  { k: 'agency', g: 'work', l: 'الوكالة', v: e => agencyName(projectAgency(empProjectId(e))) },
  { k: 'contractNo', g: 'work', l: 'رقم العقد', v: e => (IDX.project[empProjectId(e)] || {}).contractNo, num: true },
  { k: 'licenseEnd', g: 'work', l: 'نهاية العقد / الترخيص', v: e => fmtDate((IDX.project[empProjectId(e)] || {}).expiryDate), num: true },
  { k: 'actualCompany', g: 'work', l: 'شغال فعليًا في', v: e => companyName(costCenterCompanyId(e.costCenter)) },
  { k: 'outsideAgency', g: 'work', l: 'برّه وكالة عقده', v: e => (empOutsideAgency(e) ? '⚠️' : '') },
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
  { k: 'govStageNote', g: 'gov', l: 'ملاحظة التعطّل', v: e => e.govStageNote, txt: true },
  { k: 'govStageResponsible', g: 'gov', l: 'المسؤول', v: e => e.govStageResponsible },
  { k: 'govStageStartDate', g: 'gov', l: 'تاريخ بدء المعاملة', date: true, plain: true },
  { k: 'govTransactionCost', g: 'gov', l: 'تكلفة المعاملة', money: true, perm: 'sensitive.salary' },
  { k: 'phone', g: 'contact', l: 'الهاتف', v: e => e.phone, num: true },
  { k: 'homePhone', g: 'contact', l: 'هاتف المنزل', v: e => e.homePhone, num: true },
  { k: 'email', g: 'contact', l: 'البريد الإلكتروني', v: e => e.email, ltr: true },
  { k: 'address', g: 'contact', l: 'عنوان السكن', v: e => addressText(e), txt: true },
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
const EMP_REPORT_GROUPBY = [['', 'بدون تجميع'], ['company', 'الشركة'], ['project', 'العقد / المشروع'], ['agency', 'الوكالة'], ['costCenter', 'مركز التكلفة'], ['nationality', 'الجنسية'], ['status', 'الحالة الوظيفية'], ['govStage', 'مرحلة المعاملة']];
const EMP_REPORT_SORTS = ['name', 'id', 'company', 'nationality', 'residencyExp', 'workPermitExp', 'passportExp', 'dateOfHire', 'salary', 'urgency'];

/** مبلغ من غير العملة (العملة في عنوان العمود) */
function rptNum(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 }); }
/** محاذاة الخلية: الأرقام والمبالغ في الوسط بأرقام متساوية العرض، الأسماء والنصوص الطويلة من اليمين، والإنجليزي من الشمال */
function empReportCls(c) { return c.num || c.money ? 'num' : c.txt ? 'txt' : c.ltr ? 'ltr' : ''; }
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
  if (by === 'agency') { const a = projectAgency(empProjectId(e)); return [a ? a.id : '', a ? agencyName(a) : t('بدون وكالة')]; }
  if (by === 'costCenter') return [e.costCenter || '', ccLabel(e.costCenter) || t('بدون مركز تكلفة')];
  if (by === 'nationality') return [e.nationality || '', personNat(e) || '—'];
  if (by === 'status') { const s = e.employmentStatus || 'active'; return [s, EMP_REPORT_COLS.find(c => c.k === 'status').v(e)]; }
  if (by === 'govStage') return [e.govStage || '', e.govStage ? t((govStageInfo(e.govStage) || {}).label) : t('بدون معاملة')];
  return ['', ''];
}

/** نافذة إعداد التقرير. selected = الموظفين المحددين (لو فيه) */
function openEmployeeReportModal(selected = []) {
  const R = UI.report = Object.assign({ preset: 'general', cols: EMP_REPORT_PRESETS[0].cols, groupBy: '', sort: 'name', orientation: 'auto', summary: true, sign: false, colors: true, lang: LANG }, UI.report || {});
  const F = { ...UI.emp, tier: tierFilterValue(UI.emp.tier) };   // الفلاتر: نسخة من فلاتر الشاشة (مابتغيّرهاش)
  const RF = Object.fromEntries(EMP_RB_MULTI.map(k => [k, asList(F[k])]));
  let scope = selected.length ? 'selected' : 'filters';
  const cols = empReportCols();
  const presets = EMP_REPORT_PRESETS.filter(p => !p.perm || can(p.perm));
  const natCount = {};
  scopedEmployees().forEach(e => { const n = e.nationality || '—'; natCount[n] = (natCount[n] || 0) + 1; });
  const nats = Object.keys(natCount).sort((a, b) => natCount[b] - natCount[a] || a.localeCompare(b, 'ar'));
  // الجنسيات: '' = الكل، in = المحددة فقط، out = الكل ماعدا المحددة (فلتر الجنسية في الشاشة بيبدأ كـ «المحددة فقط»)
  const NAT = asList(F.nationality).length ? { mode: 'in', list: asList(F.nationality) } : { mode: '', list: [] };
  const today = todayISO(), nm = new Date();
  nm.setDate(1); nm.setMonth(nm.getMonth() + 1);
  const RANGES = [['30', 'خلال 30 يوم', '', addDays(today, 30)],             // «خلال X يوم» = المنتهي + لحد X يوم
    ['60', 'خلال 60 يوم', '', addDays(today, 60)], ['90', 'خلال 90 يوم', '', addDays(today, 90)],
    ['next', 'الشهر القادم', toISO(nm), toISO(new Date(nm.getFullYear(), nm.getMonth() + 1, 0))]];
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
          ${EMP_RB_MULTI.map(k => `<label>${t(EMP_MS_LABELS[k][0])}${empMsField('rb.', k, RF[k])}</label>`).join('')}
          <label>${t('المستند')}<select name="tierField">${opt('any', t('أي مستند'), F.tierField === 'any')}${EMP_DATE_FIELDS.map(x => opt(x.key, t(x.label), x.key === F.tierField)).join('')}</select></label>
          <label>${t('المستوى')}<select name="tier">${opt('', t('— كل المستويات —'), !F.tier)}${TIER_FILTERS.map(k => opt(k, t(TIERS[k].label), k === F.tier)).join('')}</select></label>
          <label>${t('بحث')}<input name="q" value="${esc(F.q || '')}" placeholder="${esc(t('الاسم، الرقم المدني، الجواز…'))}"></label>
          <label class="check"><input type="checkbox" name="driver" ${F.driver ? 'checked' : ''}> 🚚 ${t('السائقين فقط')}</label>
          <label class="check"><input type="checkbox" name="outside" ${F.outside ? 'checked' : ''}> ⚠️ ${t('برّه وكالة عقده')}</label>
          <div class="full rb-nat">
            <div class="rb-nat-head">${t('الجنسيات')}:
              ${[['', 'كل الجنسيات'], ['in', '✓ المحددة فقط'], ['out', '✕ كل الجنسيات ماعدا المحددة']].map(([k, l]) => `<span class="chip clickable" data-natmode="${k}">${t(l)}</span>`).join('')}
              <span id="rb-nat-hint"></span></div>
            <div class="rb-nat-list">${nats.map(n => `<span class="chip clickable" data-nat="${esc(n)}">${esc(natLabel(n))} <b class="num">${natCount[n]}</b></span>`).join('')}</div>
          </div>
          <div class="full rb-range">
            <label>${t('تاريخ انتهاء')}<select name="dField">${EMP_DATE_FIELDS.map(x => opt(x.key, t(x.label), x.key === 'residencyExp')).join('')}</select></label>
            <label>${t('من تاريخ')}<input type="date" name="dFrom"></label>
            <label>${t('إلى تاريخ')}<input type="date" name="dTo"></label>
            <div class="rb-quick">${RANGES.map(([k, l]) => `<span class="chip clickable" data-range="${k}">${t(l)}</span>`).join('')}<span class="chip clickable" data-range="">✕ ${t('مسح الفترة')}</span></div>
          </div>
        </div></div>
      <div class="rb-sec"><h4>${t('التنسيق')}</h4><div class="form">
          <label class="full">${t('عنوان التقرير')}<input id="rb-title" value="${esc(withLang(R.lang, () => t('تقرير الموظفين')))}"></label>
          <label>${t('لغة التقرير')}<select id="rb-lang">${opt('ar', 'العربية', R.lang !== 'en')}${opt('en', 'English', R.lang === 'en')}</select></label>
          <div class="rb-lang-note" id="rb-lang-note"></div>
          <label>${t('تجميع حسب')}<select id="rb-group">${EMP_REPORT_GROUPBY.map(([k, l]) => opt(k, t(l), k === R.groupBy)).join('')}</select></label>
          <label>${t('ترتيب حسب')}<select id="rb-sort">${EMP_REPORT_SORTS.filter(k => cols.some(c => c.k === k)).map(k => opt(k, t(EMP_REPORT_COLS.find(c => c.k === k).l), k === R.sort)).join('')}</select></label>
          <label>${t('اتجاه الصفحة')}<select id="rb-orient">${opt('auto', t('تلقائي حسب عدد الأعمدة'), R.orientation === 'auto')}${opt('landscape', t('عرضي'), R.orientation === 'landscape')}${opt('portrait', t('طولي'), R.orientation === 'portrait')}</select></label>
          <label class="check"><input type="checkbox" id="rb-summary" ${R.summary ? 'checked' : ''}> ${t('ملخص في أول التقرير')}</label>
          <label class="check"><input type="checkbox" id="rb-colors" ${R.colors ? 'checked' : ''}> ${t('تلوين التواريخ حسب الانتهاء')}</label>
          <label class="check"><input type="checkbox" id="rb-sign" ${R.sign ? 'checked' : ''}> ${t('خانات التوقيع (أعده / راجعه / اعتمده)')}</label>
        </div></div>
      </div>`,
    foot: `<button class="btn primary" data-go="print">🖨️ ${t('معاينة وطباعة')}</button>${can('admin') ? `<button class="btn" data-go="csv">📤 ${t('Excel (CSV) بنفس الأعمدة')}</button>` : ''}
      <span class="spacer"></span><button class="btn" data-close>إلغاء</button>`,
  });
  const E = m.el;
  const chosen = () => cols.filter(c => R.cols.includes(c.k));
  const filters = () => ({ ...F, ...formValues($('#rb-filters', E)), ...RF, nationality: [], natMode: NAT.mode, nats: NAT.list.slice(), link: '', page: 1 });
  const rows = () => scope === 'selected' ? selected.map(id => IDX.employee[id]).filter(Boolean) : filteredEmployees(filters());
  const sync = () => {
    $$('[data-preset]', E).forEach(c => c.classList.toggle('on', c.dataset.preset === R.preset));
    $$('[data-col]', E).forEach(cb => { cb.checked = R.cols.includes(cb.dataset.col); });
    $('#rb-ncols', E).textContent = `(${chosen().length})`;
    $('#rb-count', E).textContent = `${rows().length} ${t('موظف')}`;
    $('#rb-filters', E).style.opacity = scope === 'selected' ? .45 : 1;
    $('#rb-filters', E).style.pointerEvents = scope === 'selected' ? 'none' : '';
    $$('#rb-filters select, #rb-filters input', E).forEach(x => { x.disabled = scope === 'selected'; });
    $$('[data-natmode]', E).forEach(c => c.classList.toggle('on', c.dataset.natmode === NAT.mode));
    $$('[data-nat]', E).forEach(c => {
      const on = NAT.list.includes(c.dataset.nat);
      c.classList.toggle('on', on && NAT.mode === 'in'); c.classList.toggle('x', on && NAT.mode === 'out');
    });
    $('#rb-nat-hint', E).textContent = NAT.mode && !NAT.list.length ? t('اختار الجنسيات من القائمة') : NAT.mode ? `(${NAT.list.length})` : '';
    const fv = formValues($('#rb-filters', E));
    $$('[data-range]', E).forEach(c => { const r = RANGES.find(x => x[0] === c.dataset.range); c.classList.toggle('on', !!r && (fv.dFrom || '') === r[2] && (fv.dTo || '') === r[3]); });
    // تقرير إنجليزي: الجنسيات والمهن اللي مالهاش ترجمة هتطلع بالعربي
    const note = $('#rb-lang-note', E), en = $('#rb-lang', E).value === 'en';
    const miss = en ? empMissingTranslations(rows()) : [];
    note.innerHTML = en ? `${miss.length ? `<span style="color:var(--orange)">⚠️ ${miss.length} ${t('جنسية / مهنة من غير ترجمة هتظهر بالعربي')}</span>` : `<span style="color:var(--green)">✓ ${t('كل الجنسيات والمهن ليها ترجمة')}</span>`}
      <button type="button" class="btn sm write-only" data-p="employees.edit" id="rb-vt">🌐 ${t('ترجمة الجنسيات والمهن')}</button>` : '';
    const vtb = $('#rb-vt', E); if (vtb) vtb.onclick = () => openValueTranslationsModal(sync);
  };
  msBind(E, (key, vals) => { RF[key.slice(3)] = vals; sync(); });
  $('#rb-lang', E).onchange = ev => {                    // العنوان الافتراضي بيتغيّر مع اللغة
    const ti = $('#rb-title', E), was = withLang(R.lang, () => t('تقرير الموظفين'));
    R.lang = ev.target.value;
    if (ti.value.trim() === was) ti.value = withLang(R.lang, () => t('تقرير الموظفين'));
    sync();
  };
  $$('[data-natmode]', E).forEach(c => c.onclick = () => { NAT.mode = c.dataset.natmode; if (!NAT.mode) NAT.list = []; sync(); });
  $$('[data-nat]', E).forEach(c => c.onclick = () => {
    const n = c.dataset.nat;
    NAT.list = NAT.list.includes(n) ? NAT.list.filter(x => x !== n) : [...NAT.list, n];
    if (!NAT.mode) NAT.mode = 'in';           // أول اختيار من «الكل» = المحددة فقط
    sync();
  });
  // فترة الانتهاء: عمود التاريخ بيتضاف للتقرير والترتيب بيبقى عليه (من غيرهم التقرير مالوش معنى)
  const rangeChanged = () => {
    const v = formValues($('#rb-filters', E));
    if (v.dFrom || v.dTo) {
      if (cols.some(c => c.k === v.dField) && !R.cols.includes(v.dField)) {
        R.cols = cols.map(c => c.k).filter(k => k === v.dField || R.cols.includes(k)); R.preset = 'custom';
      }
      if (EMP_REPORT_SORTS.includes(v.dField) && $(`#rb-sort option[value="${v.dField}"]`, E)) { R.sort = v.dField; $('#rb-sort', E).value = v.dField; }
    }
    sync();
  };
  $$('[name="dField"], [name="dFrom"], [name="dTo"]', E).forEach(x => x.addEventListener('change', rangeChanged));
  $$('[data-range]', E).forEach(c => c.onclick = () => {
    const r = RANGES.find(x => x[0] === c.dataset.range) || ['', '', '', ''];
    $('[name="dFrom"]', E).value = r[2]; $('[name="dTo"]', E).value = r[3];
    rangeChanged();
  });
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
      summary: $('#rb-summary', E).checked, colors: $('#rb-colors', E).checked, sign: $('#rb-sign', E).checked, lang: $('#rb-lang', E).value });
    saveUiStateToLocalStorage();
    if (!chosen().length) return toast('اختار عمود واحد على الأقل', 'err');
    const list = rows();
    if (!list.length) return toast('مفيش موظفين بالفلاتر دي', 'err');
    const f = filters();
    msClose();
    if (b.dataset.go === 'csv') return exportGuard(`${t('تقرير الموظفين')} (${list.length})`, () => withLang(R.lang, () => exportEmployeeReportCsv(list, chosen())));
    withLang(R.lang, () => {                             // التقرير بلغة التقرير حتى لو البرنامج شغال بلغة تانية
      printEmployeeReport(list, chosen(), { title: $('#rb-title', E).value.trim() || t('تقرير الموظفين'), filters: scope === 'selected' ? null : f,
        selectedCount: scope === 'selected' ? list.length : 0 });
    });
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
  const fcos = filters ? asList(filters.company) : [];
  const company = (fcos.length === 1 && IDX.company[fcos[0]]) || (coIds.length === 1 ? IDX.company[coIds[0]] : null);
  // المعايير المطبّقة
  const crit = [];
  if (selectedCount) crit.push(`${t('موظفين محددين')}: ${selectedCount}`);
  if (filters) {
    const f = filters, sep = LANG === 'en' ? ', ' : '، ';
    const list = (k, label, fn) => { const v = asList(f[k]); if (v.length) crit.push(`${t(label)}: ${esc(v.map(fn).join(sep))}`); };
    list('company', 'الشركة', companyName);
    list('project', 'العقد / المشروع', p => p === '__none' ? t('بدون مشروع') : projectName(p));
    list('agency', 'الوكالة', a => a === '__none' ? t('بدون وكالة') : agencyName(agencyById(a)));
    if (f.outside) crit.push(t('برّه وكالة عقده'));
    list('status', 'الحالة', x => (EMP_STATUS_LABELS[x] || {})[LANG === 'en' ? 'en' : 'ar'] || x);
    list('nationality', 'الجنسية', natLabel);
    if ((f.natMode === 'in' || f.natMode === 'out') && f.nats && f.nats.length)
      crit.push(`${t(f.natMode === 'in' ? 'الجنسيات' : 'كل الجنسيات ماعدا')}: ${esc(f.nats.map(natLabel).join(sep))}`);
    list('profession', 'المهنة', profLabel);
    if (f.dFrom || f.dTo) {
      const [a, b] = f.dFrom && f.dTo && f.dFrom > f.dTo ? [f.dTo, f.dFrom] : [f.dFrom, f.dTo];
      const col = EMP_REPORT_COLS.find(c => c.k === (f.dField || 'residencyExp'));
      crit.push(`${esc(t(col.l))}: ` + (a && b ? `${fmtDate(a)} — ${fmtDate(b)}` : a ? `${t('ابتداءً من')} ${fmtDate(a)}` : `${t('حتى')} ${fmtDate(b)}`));
    }
    list('costCenter', 'مركز التكلفة', ccLabel);
    list('stage', 'المعاملة', x => x === '__none' ? t('بدون معاملة') : x === '__note' ? t('عليها ملاحظة تعطّل') : t((govStageInfo(x) || {}).label || ''));
    if (f.tier) crit.push(`${esc(f.tierField === 'any' ? t('أي مستند') : t((EMP_DATE_FIELDS.find(x => x.key === f.tierField) || {}).label || ''))}: ${esc(t(TIERS[f.tier].label))} (${esc(t('والمنتهي'))})`);
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
  const totalsRow = (cls, label, rs) => money.length ? `<tr class="${cls}"><td></td>${cols.map((c, i) => c.money ? `<td class="num">${rptNum(sum(rs.map(e => e[c.k])))}</td>` : i === 0 ? `<td class="${c.txt ? 'txt' : ''}">${label}</td>` : '<td></td>').join('')}</tr>` : '';
  let z = 0;
  const rowHtml = (e, i) => `<tr class="${z++ % 2 ? 'z' : ''}"><td class="idx">${i}</td>${cols.map(c => `<td class="${empReportCls(c)}">${empReportCell(c, e, R.colors)}</td>`).join('')}</tr>`;
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
  const table = `<table class="rpt"><thead><tr><th>#</th>${cols.map(c => `<th class="${c.txt ? 'txt' : ''}">${esc(t(c.l))}${c.money ? ` (${t('د.ك')})` : ''}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>${money.length ? `<tfoot>${totalsRow('', `${t('الإجمالي العام')} (${list.length})`, list)}</tfoot>` : ''}</table>`;
  const landscape = R.orientation === 'landscape' || (R.orientation === 'auto' && cols.length > 6);
  const preset = EMP_REPORT_PRESETS.find(p => p.id === R.preset);
  openReportWindow({ title, subtitle: preset ? t(preset.l) : '', company, criteria: crit.join(' · '), summary, body: table, sign: R.sign, landscape,
    meta: [[t('عدد السجلات'), String(list.length)], [t('رقم التقرير'), 'EMP-' + todayISO().replace(/-/g, '') + '-' + new Date().toTimeString().slice(0, 5).replace(':', '')]] });
}

/* ---------- ترجمة الجنسيات والمهن (للتقارير والشاشات بالإنجليزي) ---------- */
/** الجنسيات والمهن في الموظفين دول اللي مالهاش ترجمة إنجليزية */
function empMissingTranslations(list) {
  return [...uniq(list.filter(e => !e.nationalityEn).map(e => e.nationality)).filter(v => !vtFind('nationality', v)).map(v => ['nationality', v]),
    ...uniq(list.filter(e => !e.professionEn).map(e => e.profession)).filter(v => !vtFind('profession', v)).map(v => ['profession', v])];
}
/** القاموس: كل الجنسيات والمهن اللي في الموظفين والمترشّحين، والترجمة قدام كل واحدة (الجاهزة أو المعدّلة) */
function openValueTranslationsModal(after) {
  const people = [...scopedEmployees(), ...(STATE.candidates || [])];
  const KINDS = [['nationality', 'الجنسيات'], ['profession', 'المهن']];
  const values = Object.fromEntries(KINDS.map(([k]) => {
    const m = {};
    people.forEach(p => { const v = (p[k] || '').trim(); if (v) m[v] = (m[v] || 0) + 1; });
    return [k, Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b, 'ar')).map(v => ({ v, n: m[v] }))];
  }));
  const edits = { nationality: {}, profession: {} };
  let kind = 'nationality', onlyMissing = false;
  const m = openModal({ title: '🌐 ' + t('ترجمة الجنسيات والمهن'), size: 'wide', body: '<div id="vt-body"></div>',
    foot: `<button class="btn primary" data-save>💾 ${t('حفظ')}</button><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>` });
  const E = m.el;
  const cur = (k, v) => (v in edits[k] ? edits[k][v] : vtFind(k, v) || '');
  const draw = () => {
    const list = values[kind].filter(x => !onlyMissing || !cur(kind, x.v));
    const missing = k => values[k].filter(x => !cur(k, x.v)).length;
    $('#vt-body', E).innerHTML = `<div class="tabs">${KINDS.map(([k, l]) => `<button data-vt-kind="${k}" class="${k === kind ? 'active' : ''}">${esc(t(l))} (${values[k].length})${missing(k) ? ` <span class="cu-badge">${missing(k)}</span>` : ''}</button>`).join('')}</div>
      <div class="notice small" style="margin:8px 0">${t('البيانات بتتسجّل بالعربي زي ما هي في الإقامة. الترجمة دي بتظهر في التقارير الإنجليزية وفي البرنامج لما يبقى إنجليزي. اللي من غير ترجمة بيظهر بالعربي.')}</div>
      <label class="check" style="margin-bottom:6px"><input type="checkbox" id="vt-miss" ${onlyMissing ? 'checked' : ''}> ${t('اللي من غير ترجمة بس')} (${missing(kind)})</label>
      <div class="table-wrap" style="max-height:52vh"><table class="data vt-tbl"><thead><tr><th>${t('بالعربي')}</th><th>${t('العدد')}</th><th>English</th></tr></thead><tbody>
      ${list.map(x => `<tr><td>${esc(x.v)}</td><td class="num small">${x.n}</td><td><input dir="ltr" data-vt="${esc(x.v)}" value="${esc(cur(kind, x.v))}" class="${cur(kind, x.v) ? '' : 'vt-miss'}"></td></tr>`).join('')
        || `<tr><td colspan="3" class="empty">${t('كله متترجم ✓')}</td></tr>`}</tbody></table></div>`;
    $$('[data-vt-kind]', E).forEach(b => b.onclick = () => { kind = b.dataset.vtKind; draw(); });
    $('#vt-miss', E).onchange = ev => { onlyMissing = ev.target.checked; draw(); };
    $$('[data-vt]', E).forEach(inp => inp.addEventListener('input', () => { edits[kind][inp.dataset.vt] = inp.value.trim(); inp.classList.toggle('vt-miss', !inp.value.trim()); }));
  };
  draw();
  $('[data-save]', E).onclick = async () => {
    try { await persist('PUT', '/api/value-translations', edits, 'تم الحفظ'); m.close(); if (after) after(); } catch (e) { /* ظاهر */ }
  };
}

/* ---------- الاستيراد ---------- */
/* استيراد Excel/CSV: معاينة الأول (مفيش حاجة بتتحفظ) ← «تطبيق». تحديث الموظفين الموجودين بس، والإضافة لمدير النظام */
async function handleImportCsv() {
  const admin = can('admin');
  const m = openModal({
    title: '📥 ' + t('استيراد الموظفين'), size: 'wide',
    body: `<div class="notice">${t('الملف ممكن يكون Excel أو CSV. أول صف لازم يكون عناوين الأعمدة (زي: الرقم المدني، الاسم، english name، المهنة، الجنسية، تاريخ الانتهاء، نوع العقد، رقم الملف)، أو ملف القوى العاملة بدون عناوين.')}</div>
      <p class="small muted">${t('التحديث بالرقم المدني: الموظفين الموجودين بس هتتحدّث بياناتهم، والخانات الفاضية في الملف مش هتمسح الموجود.')}
        ${t('الموظف الجديد بيتسجّل من «تسجيل موظف جديد»، والأرقام المدنية اللي مش مسجّلة هتظهرلك في الآخر.')}</p>
      <div class="row" style="gap:14px;flex-wrap:wrap"><input type="file" id="imp-file" accept=".xlsx,.xls,.csv">
        ${admin ? `<label class="check"><input type="checkbox" id="imp-add"> ➕ ${t('السماح بإضافة موظفين جدد')} <span class="small muted">(${t('لمدير النظام بس، وبيتسجّل في سجل التدقيق')})</span></label>` : ''}</div>
      <div id="imp-res" style="margin-top:10px"></div>`,
    foot: `<button class="btn primary" id="imp-preview">🔍 ${t('معاينة')}</button><button class="btn primary" id="imp-apply" hidden>✅ ${t('تطبيق')}</button>
      <span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const res = $('#imp-res', m.el), pv = $('#imp-preview', m.el), ap = $('#imp-apply', m.el), addCb = $('#imp-add', m.el);
  let token = null, fileName = '';
  const reset = () => { token = null; ap.hidden = true; pv.hidden = false; res.innerHTML = ''; };
  $('#imp-file', m.el).onchange = reset;
  if (addCb) addCb.onchange = reset;                     // المعاينة لازم تتعاد بنفس الاختيار
  const form = mode => {
    const fd = new FormData();
    fd.append('mode', mode);
    if (addCb && addCb.checked) fd.append('allowAdd', '1');
    if (mode === 'apply') { fd.append('token', token); fd.append('name', fileName); return fd; }
    const file = $('#imp-file', m.el).files[0];
    if (!file) return null;
    fileName = file.name; fd.append('file', file);
    return fd;
  };
  pv.onclick = async () => {
    const fd = form('preview');
    if (!fd) return toast('اختر ملف أولاً', 'err');
    pv.disabled = true;
    try {
      const r = await api('POST', '/api/employees/import', fd);
      token = r.token;
      res.innerHTML = importResultHtml(r, true);
      bindImportResult(m, r);
      const nothing = !r.updated && !r.added;
      ap.hidden = nothing; pv.hidden = !nothing;
      if (nothing) res.insertAdjacentHTML('beforeend', `<div class="notice" style="margin-top:8px">${t('مفيش حاجة هتتغيّر من الملف ده.')}</div>`);
    } catch (e) { res.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
    pv.disabled = false;
  };
  ap.onclick = async () => {
    try {
      const r = await persist('POST', '/api/employees/import', form('apply'));
      res.innerHTML = importResultHtml(r, false);
      bindImportResult(m, r);
      ap.hidden = true; token = null;
    } catch (e) { res.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
  };
}
/** نتيجة المعاينة (preview = true) أو التطبيق: الأعداد، التغييرات حقل حقل، الجدد، واللي اتخطّى */
function importResultHtml(r, preview) {
  const miss = r.notRegistered || [], added = r.addedList || [], changes = r.changes || [];
  const w = (p, d) => t(preview ? p : d);
  const val = v => v === null || v === undefined ? '<span class="muted">—</span>' : esc(v);
  return `${preview ? `<div class="notice">🔍 ${t('معاينة: لسه مفيش حاجة اتحفظت. راجع التغييرات وبعدين اضغط «تطبيق».')}</div>`
      : `<div class="notice">✅ ${t('تم التطبيق')}</div>`}
    <div class="row" style="gap:6px;margin:8px 0;flex-wrap:wrap">
      <span class="chip on">✏️ ${w('هيتحدّث', 'اتحدّث')}: <b>${r.updated}</b></span>
      ${r.allowAdd ? `<span class="chip on">➕ ${w('هيتضاف', 'اتضاف')}: <b>${r.added}</b></span>` : ''}
      <span class="chip">${t('من غير تغيير')}: <b>${r.unchanged || 0}</b></span>
      ${miss.length ? `<span class="chip x">⚠️ ${w('هيتخطّى', 'اتخطّى')}: <b>${miss.length}</b></span>` : ''}
      ${r.skipped ? `<span class="chip">${t('صفوف من غير رقم مدني أو اسم')}: <b>${r.skipped}</b></span>` : ''}</div>
    ${changes.length ? `<details ${changes.length <= 20 ? 'open' : ''}><summary><b>✏️ ${t('التغييرات')}</b> (${changes.length} ${t('موظف')})</summary>
      <div class="imp-list">${changes.map(c => `<div class="imp-emp"><b>${esc(c.name)}</b> <span class="num small muted">${esc(c.id)}</span><ul>
        ${c.fields.map(f => `<li>${esc(t(f.label))}: <span class="imp-old">${val(f.old)}</span> ← <span class="imp-new">${val(f.new)}</span></li>`).join('')}
        ${(c.moves || []).map(x => `<li>🏢 ${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div></details>` : ''}
    ${added.length ? `<details open><summary><b>➕ ${w('موظفين هيتضافوا', 'موظفين اتضافوا')}</b> (${added.length})</summary>
      <ul class="imp-miss">${added.map(x => `<li><b>${esc(x.name || '—')}</b> — <span class="num">${esc(x.id)}</span></li>`).join('')}</ul></details>` : ''}
    ${miss.length ? `<div class="notice warn" style="margin-top:8px">⚠️ ${w('هيتخطّى', 'تم تخطّي')} <b>${miss.length}</b> ${t('صف، لأن الرقم المدني مش مسجّل في السيستم')}:
      <ul class="imp-miss">${miss.map(x => `<li><b>${esc(x.name || '—')}</b> — <span class="num">${esc(x.id)}</span>${x.candidate ? ` <span class="small muted">(${t('موجود كمترشّح في «تسجيل موظف جديد»')})</span>` : ''}</li>`).join('')}</ul>
      <div>${t('لو ده موظف جديد، سجّله من «تسجيل موظف جديد».')}</div>
      <div class="row" style="margin-top:6px">${can('admin') ? `<button class="btn sm" data-imp-csv>📤 ${t('تنزيل القائمة')}</button>` : ''}
        ${viewAllowed('recruitment') ? `<button class="btn sm" data-imp-rec>🧭 ${t('فتح تسجيل موظف جديد')}</button>` : ''}</div></div>` : ''}`;
}
function bindImportResult(m, r) {
  const miss = r.notRegistered || [];
  const csv = $('[data-imp-csv]', m.el);
  if (csv) csv.onclick = () => exportGuard(t('قائمة الاستيراد'), () => downloadBlob(toCsv([[t('الرقم المدني'), t('الاسم'), t('ملاحظة')],
    ...miss.map(x => [x.id, x.name, x.candidate ? t('موجود كمترشّح في «تسجيل موظف جديد»') : ''])]), `import-not-registered-${todayISO()}.csv`, 'text/csv;charset=utf-8'));
  const go = $('[data-imp-rec]', m.el);
  if (go) go.onclick = () => { m.close(); setView('recruitment'); };
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
      ${empEndNotice(e)}
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
        ${field('تاريخ إصدار الجواز', fmtDate(e.passportIssueDate))}${field('تاريخ التعيين', fmtDate(e.dateOfHire))}${field('تاريخ دخول الكويت', fmtDate(e.kuwaitEntryDate))}${field('تاريخ انتهاء الخدمة', fmtDate(e.serviceEndDate))}${e.serviceEndReason ? field('سبب انتهاء الخدمة', esc(t(e.serviceEndReason))) : ''}
        ${field('الرقم الموحد', e.unifiedNumber ? `<span class="num">${esc(e.unifiedNumber)}</span>` : '')}${field('فصيلة الدم', esc(e.bloodType))}
        ${field('عنوان السكن', esc(addressText(e)))}${field('هاتف المنزل', esc(e.homePhone))}${can('sensitive.salary') ? field('الراتب', fmtMoney(e.salary)) : ''}
        ${field('بدل السكن', e.housingIncluded ? (e.housingAmount ? fmtMoney(e.housingAmount) : t('مشمول')) : t('غير مشمول'))}
        ${field('نوع العقد', esc(e.contractType))}${field('رقم الملف', esc(e.fileNo))}${field('مركز التكلفة', esc(e.costCenter))}
        ${field('مكان العمل الفعلي', esc(e.actualWorkplace))}${field('الهاتف', esc(e.phone))}${field('البريد الإلكتروني', esc(e.email))}${can('sensitive.bank') ? field('البنك', esc(e.bank) + (e.iban ? `<div class="small muted">${esc(e.iban)}</div>` : '')) : ''}
        ${field('الرقم الوظيفي', e.dpId ? `<span class="num">${esc(e.dpId)}</span>` : '')}
        ${field('المؤهل الدراسي', esc(e.qualification))}${field('التخصص', esc(e.specialization))}${field('الجامعة / جهة التخرج', esc(e.university))}
      </div>
      ${isKuwaitiStaff(e) ? kuwaitiInfoHtml(e, field) : ''}
      <h4>${t('الكفالة والعقد ومكان الشغل')}</h4>
      ${empContractBlock(e)}
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
      <button class="btn write-only" data-p="employees.edit" data-a="status">🔄 ${t('الحالة الوظيفية')}</button>
      <button class="btn write-only" data-p="employees.edit" data-a="stage">🏛️ مرحلة المعاملة</button>
      <button class="btn" data-p="contract.view employees.view sensitive.salary" data-a="contract">📄 عقد العمل</button>
      ${empNeedsResidency(e) ? '<button class="btn" data-p="sensitive.documents" data-a="residency">🪪 نموذج الإقامة</button>' : ''}
      <button class="btn" data-a="driving">🚗 نموذج رخصة القيادة</button>
      ${isKuwaitiStaff(e) ? `<button class="btn" data-a="kw">🇰🇼 ${t('نماذج العمالة الوطنية')}</button>` : ''}
      <button class="btn" data-a="clearance">🧾 إقرار مخالصة</button>
      <button class="btn" data-a="letters">📨 ${t('الخطابات والشهادات')}${lettersOf(e.id).length ? ` (${lettersOf(e.id).length})` : ''}</button>
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
    else if (a === 'status') { m.close(); openEmployeeStatusModal(e.id); }
    else if (a === 'signature') { m.close(); openSignatureModal(e.id, e.name, canAll('employees.edit sensitive.documents')); }
    else if (a === 'contract') { m.close(); VIEW_ARGS = { emp: e.id }; setView('contract'); }
    else if (a === 'residency') openOfficialFormModal('residency', 'employee', e.id);
    else if (a === 'driving') openOfficialFormModal('driving', 'employee', e.id);
    else if (a === 'kw') openKuwaitiFormsChooser(e.id);
    else if (a === 'clearance') openClearanceModal(e.id);
    else if (a === 'letters') { m.close(); openLettersModal(e.id); }
    else if (a === 'print') printHtml(e.name, `<h1>${esc(e.name)}</h1><div class="muted">${esc(e.nameEn || '')} · ${esc(e.id)}</div>` + $('[data-pane="info"]', m.el).innerHTML + $('[data-pane="docs"]', m.el).innerHTML);
    else if (a === 'delete') {
      const np = permitsOf('employee', e.id).length;
      if (await openConfirm(`${t('حذف الموظف')} «${esc(e.name)}»؟${np ? `\n${t('تصاريحه هتتنقل معاه')} (${np}).` : ''}\n${trashNote()}`, { danger: true, okLabel: t('حذف') })) {
        m.close(); await persist('DELETE', '/api/employees/' + encodeURIComponent(e.id), undefined, 'اتنقل لسلة المحذوفات');
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
  // العمالة الوطنية
  pifss103: { title: '🇰🇼 استمارة 103 — التأمينات الاجتماعية', action: 'تسجيل أول مرة', extras: 'pifss',
    actions: ['تسجيل أول مرة', 'سبق تسجيله', 'إنهاء خدمة'],
    fields: ['dateOfBirth', 'phone', 'email', 'addressArea', 'addressBlock', 'addressStreet', 'addressHouse', 'nationalityNo',
      'citizenshipArticle', 'profession', 'dateOfHire', 'company.pifssNo'] },
  social: { title: '🇰🇼 استمارة العلاوة الاجتماعية وعلاوة الأولاد', action: 'طلب صرف', extras: 'social', actions: ['طلب صرف'],
    fields: ['phone', 'maritalStatus', 'qualification'] },
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
  email: ['البريد الإلكتروني', 'email', 'dir="ltr"'], maritalStatus: ['الحالة الاجتماعية', 'marital'],
  qualification: ['المؤهل الدراسي', 'text', 'list="dl-qual"'], specialization: ['التخصص'], nationalityNo: ['رقم الجنسية'],
  citizenshipArticle: ['المادة (الجنسية)', 'text', 'list="dl-article"'], naturalizationDate: ['تاريخ التجنس', 'date'],
  'company.pifssNo': ['رقم التسجيل في التأمينات (الشركة)'],
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
    if (type === 'marital') return `<label>${lab}<select name="${k}">${opt('', '—', true)}${Object.entries(MARITAL_LABELS).map(([v, x]) => opt(v, t(x), false)).join('')}</select></label>`;
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
/** form = residency | driving | pifss103 | social، kind = employee | candidate */
function openOfficialFormModal(form, kind, id) {
  const spec = OFFICIAL_FORMS[form];
  const rec = kind === 'employee' ? IDX.employee[id] : IDX.candidate[id];
  if (!rec) return toast('غير موجود', 'err');
  const kit = missingDataKit(spec.fields, kind, rec);
  const extras = spec.extras === 'pifss' ? pifssExtrasHtml(kit, rec, kind) : spec.extras === 'social' ? socialExtrasHtml(rec) : '';
  const m = openModal({
    title: esc(t(spec.title)) + ': ' + esc(rec.name), size: kit.missing.length > 3 || spec.extras ? '' : 'narrow',
    body: `<div class="form" id="of-form">
        <label class="full">${t('نوع الإجراء')}<select name="__action">${spec.actions.map(x => opt(x, t(x), x === spec.action)).join('')}</select></label>
        ${extras}${kit.html()}</div>${kit.notice()}${KUWAITI_DATALISTS}
      <div class="small muted" style="margin-top:6px">${t('أي خانة تانية فاضية تقدر تكتبها في النموذج نفسه قبل الطباعة.')}</div>`,
    foot: `<button class="btn primary" data-go>📄 ${t('حفظ وعرض النموذج')}</button><span class="spacer"></span><button class="btn" data-close>إلغاء</button>`,
  });
  const endBox = $('#of-end', m.el), act = $('[name="__action"]', m.el);
  if (endBox) { const upd = () => { endBox.style.display = act.value === 'إنهاء خدمة' ? '' : 'none'; }; act.addEventListener('change', upd); upd(); }
  // «غيّر الحالة الوظيفية»: السبب ← مستقيل / إنهاء خدمات، ولو آخر يوم عمل لسه ماجاش ← في فترة الإنذار لحد اليوم ده
  const stPrev = $('#of-st-preview', m.el);
  if (stPrev) {
    const upd = () => {
      const d = formValues($('#of-form', m.el)), reason = d.__x_endReason, end = d.serviceEndDate;
      const fin = t(EMP_STATUS_LABELS[endTypeForReason(reason)].ar);
      stPrev.textContent = !reason || !end ? `— ${t('اكتب تاريخ انتهاء الخدمة وسببه')}`
        : end >= todayISO() ? `← ${t('في فترة الإنذار')} ${t('حتى')} ${fmtDate(end)}، ${t('وبعدها')} «${fin}»` : `← «${fin}»`;
    };
    $('#of-form', m.el).addEventListener('input', upd); $('#of-form', m.el).addEventListener('change', upd); upd();
  }
  $('[data-go]', m.el).onclick = async (ev) => {
    const b = ev.currentTarget;
    const d = formValues($('#of-form', m.el)), action = d.__action, extra = {};
    if (action === 'إنهاء خدمة' && d.__x_setStatus && (!d.serviceEndDate || !d.__x_endReason))
      return openBlockAlert(t('علشان الحالة الوظيفية تتغيّر: اكتب تاريخ انتهاء الخدمة وسببه (أو شيل علامة «غيّر الحالة الوظيفية»).'));
    Object.keys(d).filter(k => k.startsWith('__')).forEach(k => { if (k.startsWith('__x_') && d[k] !== '' && d[k] != null) extra[k.slice(4)] = d[k]; delete d[k]; });
    if ('serviceEndDate' in d && (d.serviceEndDate || '') === (rec.serviceEndDate || '')) delete d.serviceEndDate;   // مااتغيّرش
    b.disabled = true;
    const data = await kit.save(d);
    if (!data) { b.disabled = false; return; }
    try {
      const res = await fetchBlob(`/api/${kind === 'employee' ? 'employees' : 'candidates'}/${encodeURIComponent(rec.id)}/forms/${form}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra, ...data }) });
      m.close();
      openPdfPreviewModal(res.blob, res.name, 1);
      if (action === 'إنهاء خدمة' && extra.setStatus) reload().catch(() => {});   // الحالة الوظيفية اتغيّرت على السيرفر
    } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  };
}

/* ---------- بطاقة الموظف: الكفيل · العقد / المشروع المسجّل عليه (ووكالته) · مكان الشغل الفعلي ---------- */
function empContractBlock(e) {
  const pid = empProjectId(e), p = IDX.project[pid], ccCo = costCenterCompanyId(e.costCenter);
  const beyond = beyondLicense(e, pid, ['residencyExp', 'workPermitExp']);
  return `<div class="emp-license">
      <div><span>${t('الكفيل')}</span><b>${esc(companyName(empCompanyId(e)) || '—')}</b></div>
      <div><span>${t('العقد / المشروع')}</span><b>${p ? esc(projectName(p.id)) : '—'}</b>
        ${p ? `<div class="small muted">${esc(projectSummary(p))}</div>${p.expiryDate ? `<div class="small">${t('ينتهي')} ${datePill(p.expiryDate)}</div>` : ''}` : ''}</div>
      <div><span>${t('شغال فعليًا')}</span><b>${esc(e.costCenter || '—')}</b>${ccCo ? `<div class="small muted">${esc(companyName(ccCo))}</div>` : ''}
        ${empOutsideAgency(e) ? `<div class="small" style="color:var(--orange)">⚠️ ${t('برّه وكالة عقده')}</div>` : ''}</div></div>
    ${beyond.length ? `<div class="notice warn" style="margin-top:8px">⚠️ ${beyond.map(k => t(k === 'residencyExp' ? 'الإقامة' : 'إذن العمل')).join(' / ')} ${t('بعد نهاية العقد اللي عليه')} (${fmtDate(p.expiryDate)}) — ${t('لازم العقد يتجدّد قبلها.')}</div>` : ''}`;
}

/* ---------- الحالة الوظيفية: في الخدمة / في فترة الإنذار / مستقيل / إنهاء خدمات / قيد الاستكمال ---------- */
/** شريط في بطاقة الموظف: فترة الإنذار (فاضل كام يوم وبعدها إيه) أو آخر يوم عمل والسبب */
function empEndNotice(e) {
  const st = e.employmentStatus, fin = e.serviceEndType && EMP_STATUS_LABELS[e.serviceEndType];
  if (st === 'warning' && e.serviceEndDate) {
    const then = fin ? `${LANG === 'en' ? ', ' : '، '}${t('وبعدها')} «${esc(LANG === 'en' ? fin.en : fin.ar)}»` : '';
    return `<div class="notice warn" style="margin-top:10px">⏳ ${t('في فترة الإنذار')} — ${t('آخر يوم عمل')} ${fmtDate(e.serviceEndDate)} (${esc(daysText(daysUntil(e.serviceEndDate)))})${then}${e.serviceEndReason ? ` — ${esc(t(e.serviceEndReason))}` : ''}</div>`;
  }
  if (empEnded(e)) {
    return `<div class="notice" style="margin-top:10px">🚪 ${esc(LANG === 'en' ? EMP_STATUS_LABELS[st].en : EMP_STATUS_LABELS[st].ar)}${e.serviceEndDate ? ` — ${t('آخر يوم عمل')} ${fmtDate(e.serviceEndDate)}` : ''}${e.serviceEndReason ? ` — ${esc(t(e.serviceEndReason))}` : ''}</div>`;
  }
  return '';
}
function openEmployeeStatusModal(id) {
  const e = IDX.employee[id];
  if (!e) return;
  const cur = e.employmentStatus || 'active', label = k => LANG === 'en' ? EMP_STATUS_LABELS[k].en : EMP_STATUS_LABELS[k].ar;
  const m = openModal({
    title: `🔄 ${t('الحالة الوظيفية')}: ${esc(empName(e))}`, size: 'narrow',
    body: `<div class="form" id="st-form">
        <label class="full">${t('الحالة')}<select name="status">${Object.keys(EMP_STATUS_LABELS).map(k => opt(k, label(k), k === cur)).join('')}</select></label>
        <label class="full" data-st="warning">${t('بعد فترة الإنذار')}<select name="endType">${EMP_ENDED.map(k => opt(k, k === 'resigned' ? t('استقالة') + ' ← ' + label(k) : label(k), k === (e.serviceEndType || 'resigned'))).join('')}</select></label>
        <label class="full" data-st="end"><span class="req" id="st-date-l"></span><input type="date" name="date" value="${esc(e.serviceEndDate || todayISO())}"></label>
        <label class="full" data-st="end">${t('السبب')}<input name="reason" list="dl-st-reason" value="${esc(e.serviceEndReason || '')}" placeholder="${esc(t('اختار أو اكتب'))}"></label>
        <label class="full">${t('ملاحظة')} <span class="small muted">(${t('بتتسجّل في سجل الموظف')})</span><input name="note"></label></div>
      <datalist id="dl-st-reason">${END_REASONS.map(x => `<option value="${esc(t(x))}">`).join('')}</datalist>
      <div class="notice small" id="st-hint" style="margin-top:8px"></div>`,
    foot: `<button class="btn primary" data-save>💾 ${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el, get = n => $(`[name="${n}"]`, E);
  const sync = () => {
    const st = get('status').value, ending = st === 'warning' || EMP_ENDED.includes(st);
    $$('[data-st="end"]', E).forEach(x => { x.style.display = ending ? '' : 'none'; });
    $('[data-st="warning"]', E).style.display = st === 'warning' ? '' : 'none';
    $('#st-date-l', E).textContent = t(st === 'warning' ? 'آخر يوم عمل (نهاية فترة الإنذار)' : 'آخر يوم عمل');
    const date = get('date').value, hint = $('#st-hint', E);
    hint.textContent = st === 'warning' ? `${t('بعد')} ${fmtDate(date) || '…'} ${t('الموظف هيتحوّل لوحده لـ')} «${label(get('endType').value)}».`
      : ending ? t('الموظف هيطلع من التنبيهات ولوحة المعلومات وقوايم العهد والعقود، ويفضل في الأرشيف والتقارير.')
      : EMP_ENDED.includes(cur) || cur === 'warning' ? t('تاريخ ونوع وسبب انتهاء الخدمة هيتمسحوا من البطاقة (بيفضلوا في سجل الموظف).') : '';
    hint.style.display = hint.textContent ? '' : 'none';
  };
  // السبب بيحدّد النوع: «استقالة» ← مستقيل، والباقي ← إنهاء خدمات
  get('reason').addEventListener('change', () => {
    const r = get('reason').value.trim(), st = get('status').value;
    if (!r) return;
    if (st === 'warning') get('endType').value = endTypeForReason(r);
    else if (EMP_ENDED.includes(st)) get('status').value = endTypeForReason(r);
    sync();
  });
  E.addEventListener('change', sync); E.addEventListener('input', sync);
  sync();
  $('[data-save]', E).onclick = async () => {
    const d = formValues($('#st-form', E));
    if ((d.status === 'warning' || EMP_ENDED.includes(d.status)) && !d.date) return openBlockAlert(t('آخر يوم عمل مطلوب'));
    try { await persist('POST', `/api/employees/${encodeURIComponent(id)}/status`, d, 'تم الحفظ'); m.close(); openProfileCard(id); } catch (err) { /* ظاهر */ }
  };
}

/* ---------- العمالة الوطنية: استمارة 103 (التأمينات) واستمارة العلاوة الاجتماعية وعلاوة الأولاد ---------- */
const PIFSS_END_REASONS = ['استقالة', 'إنهاء خدمات من صاحب العمل', 'انتهاء العقد', 'التقاعد', 'الوفاة'];
const KUWAITI_DATALISTS = `<datalist id="dl-qual">${['ابتدائي', 'متوسط', 'ثانوي', 'دبلوم', 'بكالوريوس', 'ماجستير', 'دكتوراه'].map(x => `<option value="${x}">`).join('')}</datalist>
  <datalist id="dl-article">${['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السابعة', 'الثامنة'].map(x => `<option value="${x}">`).join('')}</datalist>`;
/** اختيارات استمارة 103 اللي مش في بيانات الموظف (المبالغ للي معاه صلاحية الرواتب بس) */
function pifssExtrasHtml(kit, e, kind = 'employee') {
  const money = (k, l) => `<label>${t(l)}<input type="number" step="0.001" min="0" name="__x_${k}"></label>`;
  return `<label>${t('المفوّض بالتوقيع')}<select name="__x_sig">${batchSigOptions(kit.cid)}</select></label>
    <label>${t('تاريخ التوقيع')}<input type="date" name="__x_signDate" value="${todayISO()}"></label>
    ${can('sensitive.salary') ? money('socialAllowance', 'العلاوة الاجتماعية (د.ك)') + money('allowances', 'البدلات الخاضعة للتأمين التكميلي (د.ك)') : ''}
    <label>${t('تاريخ بدء المرتب الأخير')}<input type="date" name="__x_lastSalaryDate"></label>
    <label>${t('يوجد نظام صرف مكافأة')}<select name="__x_reward">${opt('', '—', true)}${opt('yes', t('نعم'), false)}${opt('no', t('لا'), false)}</select></label>
    <label>${t('صرف مكافأة سابقًا')}<select name="__x_rewardPaid">${opt('', '—', true)}${opt('before', t('قبل تطبيق قانون 2014/110'), false)}${opt('after', t('بعد تطبيق قانون 2014/110'), false)}${opt('none', t('لم يتم الصرف'), false)}</select></label>
    <div class="form" id="of-end" style="grid-column:1/-1;display:none"><h4>${t('انتهاء الخدمة')}</h4>
      <label>${t('تاريخ انتهاء الخدمة')}<input type="date" name="serviceEndDate" value="${esc(e.serviceEndDate || '')}"></label>
      <label>${t('سبب انتهاء الخدمة')}<input name="__x_endReason" list="dl-end-reason"></label>
      <datalist id="dl-end-reason">${PIFSS_END_REASONS.map(x => `<option value="${esc(t(x))}">`).join('')}</datalist>
      ${kind === 'employee' && can('employees.edit') ? `<label class="check" style="grid-column:1/-1"><input type="checkbox" name="__x_setStatus" checked> ${t('غيّر الحالة الوظيفية')}
        <b class="small" id="of-st-preview" style="color:var(--primary)"></b></label>` : ''}</div>`;
}
function socialExtrasHtml(e) {
  const kids = e.children || [];
  return `<div class="notice" style="grid-column:1/-1">👨‍👩‍👧 ${t('الأبناء المسجّلين')}: <b>${kids.length}</b>${kids.length > 7 ? ' — ' + t('الاستمارة فيها 7 صفوف بس') : ''}
    ${kids.length ? '<br>' + kids.map(c => esc(c.name)).join('، ') : ''}
    <div class="small muted">${t('الأبناء والدراسة الحالية بيتعدّلوا من «تعديل» الموظف (بيانات العمالة الوطنية).')}</div></div>`;
}
function openKuwaitiFormsChooser(id) {
  const m = openModal({
    title: '🇰🇼 ' + t('نماذج العمالة الوطنية'), size: 'narrow',
    body: ['pifss103', 'social'].map(f => `<button class="btn" data-f="${f}" style="width:100%;justify-content:flex-start;margin-bottom:8px">${esc(t(OFFICIAL_FORMS[f].title))}</button>`).join(''),
    foot: `<span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  $$('[data-f]', m.el).forEach(b => b.onclick = () => { m.close(); openOfficialFormModal(b.dataset.f, 'employee', id); });
}
/** بطاقة الموظف: بيانات العمالة الوطنية + الأبناء */
function kuwaitiInfoHtml(e, field) {
  const kids = e.children || [];
  const study = e.studyInstitution ? esc(e.studyInstitution) + ` <span class="small muted">(${t(e.studyAbroad ? 'خارج الكويت' : 'داخل الكويت')}${e.studyStartDate ? ' · ' + fmtDate(e.studyStartDate) : ''})</span>` : '';
  return `<h4>🇰🇼 ${t('بيانات العمالة الوطنية')}</h4><div class="kv">
      ${field('الحالة الاجتماعية', esc(maritalLabel(e)))}
      ${field('رقم الجنسية', esc(e.nationalityNo))}${field('المادة (الجنسية)', esc(e.citizenshipArticle))}${field('تاريخ التجنس', fmtDate(e.naturalizationDate))}
      ${field('الدراسة الحالية', study)}</div>
    <h4>${t('الأبناء')} (${kids.length})</h4>
    ${kids.length ? `<table class="data"><thead><tr><th>${t('الاسم')}</th><th>${t('تاريخ الميلاد')}</th><th>${t('العمر')}</th><th>${t('الحالة الصحية')}</th><th>${t('يعمل')}</th><th>${t('متزوج')}</th></tr></thead><tbody>
      ${kids.map(c => `<tr><td>${esc(c.name)}</td><td>${fmtDate(c.dateOfBirth)}</td><td class="num">${ageYears(c.dateOfBirth) ?? ''}</td>
        <td>${c.disabled ? t('معاق') + (c.disabilityDegree ? ` (${esc(c.disabilityDegree)})` : '') : t('سليم')}</td><td>${c.working ? t('نعم') : t('لا')}</td><td>${c.married ? t('نعم') : t('لا')}</td></tr>`).join('')}
      </tbody></table>` : '<div class="muted">—</div>'}`;
}
/** نافذة الموظف / المترشّح: قسم العمالة الوطنية (بيظهر للكويتي ومعاملة كويتية بس).
    withStudy = المؤهل والتخصص جوّه القسم (المترشّح) — الموظف ليه قسم «المؤهل الدراسي» للكل */
function kuwaitiInputs(e, withStudy = true) {
  const v = k => esc(e[k] ?? '');
  const inp = (k, l, type = 'text', extra = '') => `<label>${t(l)}<input name="${k}" type="${type}" value="${v(k)}" ${extra}></label>`;
  return `<div class="form" id="kw-box" style="grid-column:1/-1;${isKuwaitiStaff(e) ? '' : 'display:none'}">
    <h4>🇰🇼 ${t('بيانات العمالة الوطنية')} <span class="small muted">(${t('لاستمارة 103 واستمارة العلاوة الاجتماعية')})</span></h4>
    <label>${t('الحالة الاجتماعية')}<select name="maritalStatus">${opt('', '—', !e.maritalStatus)}${Object.entries(MARITAL_LABELS).map(([k, l]) => opt(k, t(l), k === e.maritalStatus)).join('')}</select></label>
    ${withStudy ? inp('qualification', 'المؤهل الدراسي', 'text', 'list="dl-qual"') + inp('specialization', 'التخصص') : ''}
    ${inp('nationalityNo', 'رقم الجنسية')}${inp('citizenshipArticle', 'المادة (الجنسية)', 'text', 'list="dl-article"')}${inp('naturalizationDate', 'تاريخ التجنس', 'date')}
    ${inp('studyInstitution', 'جهة الدراسة الحالية')}
    <label>${t('مكان الدراسة')}<select name="studyAbroad">${opt('', '—', e.studyAbroad == null)}${opt('0', t('داخل الكويت'), e.studyAbroad === false)}${opt('1', t('خارج الكويت'), e.studyAbroad === true)}</select></label>
    ${inp('studyStartDate', 'بداية القيد في الدراسة', 'date')}
    <h4>${t('الأبناء')} <button type="button" class="btn sm" id="kid-add">➕ ${t('إضافة ابن')}</button></h4>
    <div id="kids-box" style="grid-column:1/-1">${renderKidRows(e.children || [])}</div>
    ${KUWAITI_DATALISTS}</div>`;
}
function renderKidRows(kids) {
  return `<table class="data kids"><thead><tr><th>${t('الاسم')}</th><th>${t('تاريخ الميلاد')}</th><th>${t('الحالة الصحية')}</th><th>${t('درجة الإعاقة')}</th><th>${t('يعمل')}</th><th>${t('متزوج')}</th><th></th></tr></thead><tbody>
    ${kids.map(c => `<tr data-kid><td><input data-k="name" value="${esc(c.name || '')}"></td><td><input type="date" data-k="dateOfBirth" value="${esc(c.dateOfBirth || '')}"></td>
      <td><select data-k="disabled">${opt('0', t('سليم'), !c.disabled)}${opt('1', t('معاق'), !!c.disabled)}</select></td><td><input data-k="disabilityDegree" value="${esc(c.disabilityDegree || '')}"></td>
      <td><input type="checkbox" data-k="working" ${c.working ? 'checked' : ''}></td><td><input type="checkbox" data-k="married" ${c.married ? 'checked' : ''}></td>
      <td><button type="button" class="btn sm danger" data-kid-del>✕</button></td></tr>`).join('') || `<tr><td colspan="7" class="muted">${t('مفيش أبناء مسجّلين')}</td></tr>`}</tbody></table>`;
}
/** keepEmpty = الصفوف اللي لسه من غير اسم (وقت إضافة صف) */
function collectKidRows(root, keepEmpty = false) {
  return $$('[data-kid]', root).map(tr => {
    const g = k => $(`[data-k="${k}"]`, tr);
    return { name: g('name').value.trim(), dateOfBirth: g('dateOfBirth').value || null, disabled: g('disabled').value === '1',
      disabilityDegree: g('disabilityDegree').value.trim() || null, working: g('working').checked, married: g('married').checked };
  }).filter(c => keepEmpty || c.name);
}
function bindKidRows(root) { $$('[data-kid-del]', root).forEach(b => b.onclick = () => b.closest('tr').remove()); }

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
    foot: `${STATE.pdfAvailable ? `<button class="btn primary" data-go="pdf">📄 ${t('حفظ وعرض الإقرار')}</button>`
        : `<span class="small muted">${t('عرض الإقرار محتاج Microsoft Word أو LibreOffice على السيرفر.')}</span>`}
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
      m.close(); openPdfPreviewModal(res.blob, res.name, 1);
    } catch (err) { toast(err.message, 'err'); b.disabled = false; }
  });
}

/* ---------- المرفقات (بديل Google Drive: التخزين على السيرفر) ---------- */
async function loadDriveFiles(empId, root) {
  const box = $('#emp-files', root);
  try {
    const files = await api('GET', `/api/employees/${encodeURIComponent(empId)}/files`);
    box.innerHTML = files.length ? `<table class="data"><tbody>${files.map(f => `<tr><td>📄 <a href="#" data-view="${f.id}" data-name="${esc(f.name)}">${esc(f.name)}</a></td>
      <td class="small muted">${(f.size / 1024).toFixed(0)} KB</td><td class="small muted">${fmtDateTime(f.uploaded_at)} ${esc(f.uploaded_by || '')}</td>
      <td><button class="btn sm" data-view="${f.id}" data-name="${esc(f.name)}">👁️</button> <button class="btn sm danger write-only" data-p="employees.edit" data-del="${f.id}">🗑️</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${t('لا توجد مرفقات')}</div>`;
    $$('[data-view]', box).forEach(b => b.onclick = ev => { ev.preventDefault(); openFileViewer(`/files/emp/${b.dataset.view}`, b.dataset.name); });
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
      ${inp('placeOfBirth', 'مكان الميلاد')}${dt('dateOfHire', 'تاريخ التعيين')}${dt('kuwaitEntryDate', 'تاريخ دخول الكويت')}${dt('serviceEndDate', 'تاريخ انتهاء الخدمة')}
      ${inp('phone', 'الهاتف')}${inp('email', 'البريد الإلكتروني', 'email', 'dir="ltr"')}
      ${personExtraInputs(e)}
      <h4>${t('المؤهل الدراسي')}</h4>
      ${inp('qualification', 'المؤهل الدراسي', 'text', 'list="dl-qual"')}${inp('specialization', 'التخصص')}${inp('university', 'الجامعة / جهة التخرج')}
      ${kuwaitiInputs(e, false)}
      <h4>العمل والراتب</h4>
      <label>${t('الحالة الوظيفية')}<select name="employmentStatus">${Object.entries(EMP_STATUS_LABELS).map(([k, s]) => opt(k, LANG === 'en' ? s.en : s.ar, k === (e.employmentStatus || 'active'))).join('')}</select></label>
      ${inp('salary', 'الراتب (د.ك)', 'number', 'step="0.001" min="0"')}
      <label class="check"><input type="checkbox" name="housingIncluded" ${e.housingIncluded ? 'checked' : ''}> ${t('بدل السكن مشمول')}</label>
      ${inp('housingAmount', 'مبلغ بدل السكن', 'number', 'step="0.001" min="0"')}
      <label>${t('نوع العقد')}<select name="contractType">${opt('', '—', !e.contractType)}${['عقد حكومي', 'عقد اهلي'].map(x => opt(x, t(x), x === e.contractType)).join('')}</select></label>
      <label>${t('مركز التكلفة')}<select name="costCenter">${costCenterOptions(e.costCenter)}</select></label>
      ${inp('actualWorkplace', 'مكان العمل الفعلي')}${inp('fileNo', 'رقم الملف')}
      ${inp('bank', 'البنك')}${inp('iban', 'IBAN', 'text', 'dir="ltr"')}${inp('dpId', 'الرقم الوظيفي')}
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
  const collect = () => Object.assign(formValues(form), { affiliations: collectAffRows(form), children: collectKidRows(form) });
  bindKidRows(form);
  $('#kid-add', m.el).onclick = () => {
    const kids = collectKidRows(form, true); kids.push({});
    $('#kids-box', m.el).innerHTML = renderKidRows(kids); bindKidRows(form); translateDomText($('#kids-box', m.el));
  };
  if (isNew) attachDraftAutosave('employee', form, collect);
  // ترجمة الجنسية تلقائيًا
  const natIn = form.querySelector('[name="nationality"]');
  natIn.addEventListener('input', () => { $('#kw-box', m.el).style.display = isKuwaitiStaff({ nationality: natIn.value }) ? '' : 'none'; });
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
