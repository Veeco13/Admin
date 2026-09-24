/* =====================================================================
   COMPANIES & PROJECTS — مركز إدارة الشركات والمشاريع
   ===================================================================== */
'use strict';

const COMPANY_DOC_KINDS = [
  { key: 'commercialLicense', label: 'الرخصة التجارية', exp: 'commercialLicenseExpiry' },
  { key: 'trafficAuth', label: 'تفويض المرور', exp: 'trafficAuthExpiry' },
  { key: 'civilAffairs', label: 'تفويض الشؤون المدنية', exp: 'civilAffairsAuthExpiry' },
];

function renderCompanies() {
  const focus = VIEW_ARGS.focusCompany;
  const emps = STATE.employees.filter(e => e.employmentStatus !== 'terminated');
  const cards = scopedCompanies().map(c => {
    const ce = emps.filter(e => (e.affiliations || []).some(a => a.companyId === c.id));
    const projs = STATE.projects.filter(p => p.companyId === c.id);
    return `<div class="card" id="co-${c.id}" style="${focus === c.id ? 'outline:2px solid var(--primary)' : ''}">
      <div class="row" style="align-items:flex-start">
        ${c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="" style="width:48px;height:48px;object-fit:contain;border-radius:8px;background:#fff">` : `<div class="avatar" style="width:48px;height:48px;font-size:16px">🏢</div>`}
        <div style="flex:1;min-width:0"><h3 style="margin:0">${esc(c.nameAr)}</h3><div class="muted small" dir="ltr" style="text-align:start">${esc(c.nameEn || '')}</div>
          <div class="row small" style="margin-top:4px"><span class="chip">👥 ${ce.length} ${t('موظف')}</span><span class="chip">📁 ${projs.length} ${t('مشروع')}</span>
          ${c.mainFileNumber ? `<span class="chip">${t('رقم الملف')}: ${esc(c.mainFileNumber)}</span>` : ''}${c.laborOffice ? `<span class="chip">${esc(c.laborOffice)}</span>` : ''}</div></div>
        <div class="actions"><button class="btn sm" data-emps="${c.id}">👥</button><button class="btn sm write-only" data-edit="${c.id}">✏️</button><button class="btn sm danger write-only" data-del="${c.id}">🗑️</button></div>
      </div>
      <hr class="sep">
      <div class="kv small">
        <div><span>${t('رقم الرخصة التجارية')}</span>${esc(c.commercialLicenseNo || '—')}</div>
        <div><span>${t('الرقم المدني للرخصة')}</span>${esc(c.licenseCivilNo || '—')}</div>
        ${COMPANY_DOC_KINDS.map(k => {
          const d = c.docs && c.docs[k.key];
          return `<div><span>${esc(t(k.label))}</span>${datePill(c[k.exp])}
            <div class="row" style="margin-top:3px">${d ? `<a class="btn sm" href="${esc(d.url)}" target="_blank" title="${esc(d.name)}">📄 ${t('عرض')}</a>` : ''}
            <button class="btn sm write-only" data-doc="${c.id}|${k.key}">${d ? '♻️' : '📎 ' + t('رفع')}</button></div></div>`;
        }).join('')}
      </div>
      <h4 style="margin:12px 0 6px">✍️ ${t('المفوّضين بالتوقيع')} <button class="btn sm write-only" data-sig-add="${c.id}">➕</button></h4>
      ${(c.signatories || []).map(s => {
        const sd = s.civilId && STATE.signatoryDocs[s.civilId];
        return `<div class="row small" style="padding:4px 0;border-bottom:1px dashed var(--border)"><b>${esc(s.nameAr)}</b><span class="muted">${esc(s.nameEn || '')}</span><span class="num">${esc(s.civilId || '')}</span>
          <span class="spacer"></span>${sd ? `${datePill(sd.expiryDate)} ${sd.url && sd.name ? `<a class="btn sm" href="${esc(sd.url)}" target="_blank">🪪</a>` : ''}` : ''}
          <button class="btn sm write-only" data-sig-doc="${esc(s.civilId || '')}">🪪 ${t('البطاقة')}</button>
          <button class="btn sm write-only" data-sig-edit="${s.id}">✏️</button><button class="btn sm danger write-only" data-sig-del="${s.id}">✕</button></div>`;
      }).join('') || `<div class="muted small">—</div>`}
      <h4 style="margin:12px 0 6px">📁 ${t('المشاريع')} <button class="btn sm write-only" data-proj-add="${c.id}">➕</button></h4>
      ${projs.length ? `<table class="data"><thead><tr><th>${t('المشروع')}</th><th>${t('رقم الملف')}</th><th>${t('إدارة العمل')}</th><th>${t('الانتهاء')}</th><th>${t('الموظفين')}</th><th></th></tr></thead><tbody>
        ${projs.map(p => `<tr><td>${esc(projectName(p.id))}</td><td class="num">${esc(p.fileNumber || '')}</td><td>${esc(p.laborOffice || '')}</td><td>${datePill(p.expiryDate)}</td>
          <td><a href="#" data-proj-emps="${p.id}">${ce.filter(e => (e.affiliations || []).some(a => a.projectId === p.id)).length}</a></td>
          <td class="row"><button class="btn sm write-only" data-proj-edit="${p.id}">✏️</button><button class="btn sm danger write-only" data-proj-del="${p.id}">✕</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="muted small">—</div>'}
    </div>`;
  }).join('');
  viewRoot().innerHTML = `<div class="page-head"><div><h1>مركز إدارة الشركات والمشاريع</h1><div class="sub">${scopedCompanies().length} ${t('شركة')} · ${STATE.projects.length} ${t('مشروع')}</div></div>
    <div class="actions"><button class="btn primary write-only" id="co-add">➕ إضافة شركة</button><button class="btn" id="co-org">🏗️ الهيكل التنظيمي</button></div></div>
    <div class="grid two">${cards || '<div class="empty">لا توجد شركات</div>'}</div>`;
  const R = viewRoot();
  $('#co-add').onclick = () => openCompanyModal(null);
  $('#co-org').onclick = renderOrgChartModal;
  $$('[data-edit]', R).forEach(b => b.onclick = () => openCompanyModal(b.dataset.edit));
  $$('[data-emps]', R).forEach(b => b.onclick = () => goEmployees({ company: b.dataset.emps }));
  $$('[data-proj-emps]', R).forEach(b => b.onclick = (e) => { e.preventDefault(); const p = IDX.project[b.dataset.projEmps]; goEmployees({ company: p.companyId, project: p.id }); });
  $$('[data-del]', R).forEach(b => b.onclick = async () => {
    if (await openConfirm(t('حذف الشركة وكل مشاريعها ومفوّضيها؟'), { danger: true, okLabel: t('حذف') })) await persist('DELETE', '/api/companies/' + b.dataset.del, undefined, 'تم الحذف');
  });
  $$('[data-doc]', R).forEach(b => b.onclick = () => { const [cid, kind] = b.dataset.doc.split('|'); openCompanyDocModal(cid, kind); });
  $$('[data-sig-add]', R).forEach(b => b.onclick = () => openSignatoryModal(b.dataset.sigAdd, null));
  $$('[data-sig-edit]', R).forEach(b => b.onclick = () => { const s = STATE.companies.flatMap(c => c.signatories).find(x => x.id === b.dataset.sigEdit); openSignatoryModal(s.companyId, s); });
  $$('[data-sig-del]', R).forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف المفوّض؟'), { danger: true })) await persist('DELETE', '/api/signatories/' + b.dataset.sigDel, undefined, 'تم الحذف'); });
  $$('[data-sig-doc]', R).forEach(b => b.onclick = () => openCivilIdDocModal(b.dataset.sigDoc));
  $$('[data-proj-add]', R).forEach(b => b.onclick = () => openProjectModal(b.dataset.projAdd, null));
  $$('[data-proj-edit]', R).forEach(b => b.onclick = () => { const p = IDX.project[b.dataset.projEdit]; openProjectModal(p.companyId, p); });
  $$('[data-proj-del]', R).forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف المشروع؟ (الموظفين هيفضلوا في الشركة بدون مشروع)'), { danger: true })) await persist('DELETE', '/api/projects/' + b.dataset.projDel, undefined, 'تم الحذف'); });
  if (focus) setTimeout(() => { const el = $('#co-' + focus); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
}

function openCompanyModal(id) {
  const c = id ? IDX.company[id] : {};
  const v = k => esc(c[k] ?? '');
  const m = openModal({
    title: id ? t('تعديل شركة') : t('إضافة شركة'), size: 'wide',
    body: `<form class="form">
      <label><span class="req">${t('اسم الشركة (عربي)')}</span><input name="nameAr" value="${v('nameAr')}"></label>
      <label>${t('اسم الشركة (إنجليزي)')}<input name="nameEn" value="${v('nameEn')}" dir="ltr"></label>
      <label>${t('مجال النشاط')}<input name="activity" value="${v('activity')}"></label>
      <label>${t('إدارة العمل')}<input name="laborOffice" value="${v('laborOffice')}"></label>
      <label>${t('رقم الملف الرئيسي')}<input name="mainFileNumber" value="${v('mainFileNumber')}"></label>
      <label>${t('رقم الرخصة التجارية')}<input name="commercialLicenseNo" value="${v('commercialLicenseNo')}"></label>
      <label>${t('الرقم المدني للرخصة')}<input name="licenseCivilNo" value="${v('licenseCivilNo')}"></label>
      <label>${t('انتهاء الرخصة التجارية')}<input type="date" name="commercialLicenseExpiry" value="${v('commercialLicenseExpiry')}"></label>
      <label>${t('انتهاء تفويض المرور')}<input type="date" name="trafficAuthExpiry" value="${v('trafficAuthExpiry')}"></label>
      <label>${t('انتهاء تفويض الشؤون المدنية')}<input type="date" name="civilAffairsAuthExpiry" value="${v('civilAffairsAuthExpiry')}"></label>
      <label>${t('الشعار')}<input type="file" id="co-logo" accept="image/*"></label>
      </form>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues($('form', m.el));
    if (!d.nameAr) return openBlockAlert(t('اسم الشركة مطلوب'));
    const res = await persist(id ? 'PUT' : 'POST', id ? '/api/companies/' + id : '/api/companies', d, 'تم الحفظ');
    const logo = $('#co-logo', m.el).files[0];
    if (logo) { const fd = new FormData(); fd.append('file', logo); await persist('POST', `/api/companies/${id || res.id}/docs/logo`, fd); }
    m.close();
  };
}
function openCompanyDocModal(cid, kind) {
  const k = COMPANY_DOC_KINDS.find(x => x.key === kind);
  const c = IDX.company[cid];
  const m = openModal({
    title: esc(t(k.label)) + ' — ' + esc(c.nameAr), size: 'narrow',
    body: `<div class="form"><label class="full">${t('تاريخ الانتهاء')}<input type="date" name="exp" value="${esc(c[k.exp] || '')}"></label>
      <label class="full">${t('الملف (PDF أو صورة)')}<input type="file" id="doc-file" accept=".pdf,image/*"></label></div>`,
    foot: `${c.docs[kind] ? '<button class="btn danger" data-rm>حذف الملف</button>' : ''}<span class="spacer"></span><button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const exp = $('[name="exp"]', m.el).value || null;
    const f = $('#doc-file', m.el).files[0];
    if (f) { const fd = new FormData(); fd.append('file', f); await api('POST', `/api/companies/${cid}/docs/${kind}`, fd); }
    if (exp !== (c[k.exp] || null)) await api('PUT', '/api/companies/' + cid, { [k.exp]: exp });
    await reload(); toast('تم الحفظ', 'ok'); m.close();
  };
  const rm = $('[data-rm]', m.el);
  if (rm) rm.onclick = async () => { await persist('DELETE', `/api/companies/${cid}/docs/${kind}`, undefined, 'تم الحذف'); m.close(); };
}
// اختصارات بأسماء الوثيقة
function openTrafficAuthModal(cid) { openCompanyDocModal(cid, 'trafficAuth'); }
function openCivilAffairsAuthModal(cid) { openCompanyDocModal(cid, 'civilAffairs'); }

function openSignatoryModal(companyId, s) {
  s = s || {};
  const m = openModal({
    title: s.id ? t('تعديل مفوّض') : t('إضافة مفوّض بالتوقيع'), size: 'narrow',
    body: `<div class="form"><label class="full"><span class="req">${t('الاسم (عربي)')}</span><input name="nameAr" value="${esc(s.nameAr || '')}"></label>
      <label class="full">${t('الاسم (إنجليزي)')}<input name="nameEn" value="${esc(s.nameEn || '')}" dir="ltr"></label>
      <label class="full">${t('الرقم المدني')}<input name="civilId" value="${esc(s.civilId || '')}" inputmode="numeric"></label></div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el); d.companyId = companyId;
    if (!d.nameAr) return openBlockAlert(t('الاسم مطلوب'));
    await persist(s.id ? 'PUT' : 'POST', s.id ? '/api/signatories/' + s.id : '/api/signatories', d, 'تم الحفظ');
    m.close();
  };
}
function openCivilIdDocModal(civilId) {
  if (!civilId) return openBlockAlert(t('سجّل الرقم المدني للمفوّض أولاً'));
  const d = STATE.signatoryDocs[civilId] || {};
  const m = openModal({
    title: '🪪 ' + t('البطاقة المدنية للمفوّض') + ' ' + esc(civilId), size: 'narrow',
    body: `<div class="notice">${t('صورة البطاقة بتتحفظ مرة واحدة لكل شخص، وبتظهر في كل الشركات اللي هو مفوّض فيها.')}</div>
      <div class="form"><label class="full">${t('تاريخ انتهاء البطاقة')}<input type="date" name="expiryDate" value="${esc(d.expiryDate || '')}"></label>
      <label class="full">${t('صورة البطاقة')}<input type="file" id="cid-file" accept=".pdf,image/*"></label>
      ${d.name ? `<div class="full small">📄 <a href="${esc(d.url)}" target="_blank">${esc(d.name)}</a></div>` : ''}</div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const fd = new FormData();
    fd.append('expiryDate', $('[name="expiryDate"]', m.el).value);
    const f = $('#cid-file', m.el).files[0]; if (f) fd.append('file', f);
    await persist('POST', '/api/signatory-docs/' + encodeURIComponent(civilId), fd, 'تم الحفظ');
    m.close();
  };
}
function openProjectModal(companyId, p) {
  p = p || {};
  const m = openModal({
    title: p.id ? t('تعديل مشروع') : t('إضافة مشروع'),
    body: `<div class="form"><label><span class="req">${t('اسم المشروع (عربي)')}</span><input name="nameAr" value="${esc(p.nameAr || '')}"></label>
      <label>${t('اسم المشروع (إنجليزي)')}<input name="nameEn" value="${esc(p.nameEn || '')}" dir="ltr"></label>
      <label>${t('الشركة')}<select name="companyId">${companyOptions(companyId)}</select></label>
      <label>${t('رقم الملف')}<input name="fileNumber" value="${esc(p.fileNumber || '')}"></label>
      <label>${t('إدارة العمل')}<input name="laborOffice" value="${esc(p.laborOffice || '')}"></label>
      <label>${t('تاريخ الانتهاء')}<input type="date" name="expiryDate" value="${esc(p.expiryDate || '')}"></label></div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (!d.nameAr || !d.companyId) return openBlockAlert(t('اسم المشروع والشركة مطلوبين'));
    await persist(p.id ? 'PUT' : 'POST', p.id ? '/api/projects/' + p.id : '/api/projects', d, 'تم الحفظ');
    m.close();
  };
}

/* =====================================================================
   VEHICLES — مركز إدارة السيارات
   ===================================================================== */
function renderVehicles() {
  const q = norm(UI.vehicles.q);
  const list = STATE.vehicles.filter(v => companyInScope(v.companyId) || !v.companyId)
    .filter(v => !q || [v.plate, v.model, companyName(v.companyId), empName(IDX.employee[v.driverId])].some(x => norm(x).includes(q)));
  viewRoot().innerHTML = `<div class="page-head"><div><h1>مركز إدارة السيارات</h1><div class="sub">${STATE.vehicles.length} ${t('سيارة')}</div></div>
    <div class="actions"><button class="btn primary write-only" id="v-add">➕ إضافة سيارة</button><button class="btn" id="v-export">📤 تصدير CSV</button></div></div>
    <div class="filters"><input type="search" id="v-q" placeholder="بحث باللوحة أو السائق…" value="${esc(UI.vehicles.q)}"></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('رقم اللوحة')}</th><th>${t('النوع / الموديل')}</th><th>${t('الشركة')}</th><th>${t('السائق')}</th><th>${t('انتهاء التأمين')}</th><th>${t('انتهاء الدفتر')}</th></tr></thead>
    <tbody>${list.map(v => {
      const d = IDX.employee[v.driverId];
      return `<tr class="clickable" data-id="${v.id}"><td><b class="num">${esc(v.plate)}</b></td><td>${esc(v.model || '')}</td><td>${esc(companyName(v.companyId))}</td>
      <td>${d ? esc(empName(d)) + (d.drivingLicenseExp ? ' ' + datePill(d.drivingLicenseExp) : '') : '<span class="muted">—</span>'}</td><td>${datePill(v.insuranceExpiry)}</td><td>${datePill(v.govLicenseExpiry)}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="empty">${t('لا توجد سيارات')}</td></tr>`}</tbody></table></div>`;
  $('#v-add').onclick = () => openVehicleModal(null);
  $('#v-q').addEventListener('input', debounce(e => { UI.vehicles.q = e.target.value; saveUiStateToLocalStorage(); render(); const i = $('#v-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  $$('tr[data-id]', viewRoot()).forEach(tr => tr.onclick = () => openVehicleModal(tr.dataset.id));
  $('#v-export').onclick = () => downloadBlob(toCsv([[t('رقم اللوحة'), t('النوع / الموديل'), t('الشركة'), t('السائق'), t('انتهاء التأمين'), t('انتهاء الدفتر')],
    ...list.map(v => [v.plate, v.model, companyName(v.companyId), empName(IDX.employee[v.driverId]), v.insuranceExpiry, v.govLicenseExpiry])]), `vehicles-${todayISO()}.csv`, 'text/csv');
}
function openVehicleModal(id) {
  const v = id ? IDX.vehicle[id] : {};
  const drivers = STATE.employees.filter(e => e.isDriver || e.id === v.driverId).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const m = openModal({
    title: id ? t('تعديل سيارة') + ' ' + esc(v.plate) : t('إضافة سيارة'),
    body: `<div class="form"><label><span class="req">${t('رقم اللوحة')}</span><input name="plate" value="${esc(v.plate || '')}"></label>
      <label>${t('النوع / الموديل')}<input name="model" value="${esc(v.model || '')}"></label>
      <label>${t('الشركة')}<select name="companyId">${companyOptions(v.companyId)}</select></label>
      <label>${t('السائق')}<select name="driverId">${opt('', '—', !v.driverId)}${drivers.map(e => opt(e.id, e.name + ' — ' + e.id, e.id === v.driverId)).join('')}</select></label>
      <label>${t('انتهاء التأمين')}<input type="date" name="insuranceExpiry" value="${esc(v.insuranceExpiry || '')}"></label>
      <label>${t('انتهاء الدفتر')}<input type="date" name="govLicenseExpiry" value="${esc(v.govLicenseExpiry || '')}"></label>
      <label class="full">${t('ملاحظات')}<input name="notes" value="${esc(v.notes || '')}"></label></div>
      <div class="small muted">${t('قائمة السائقين بتعرض الموظفين المعلَّم عليهم «سائق» فقط.')}</div>`,
    foot: `${id ? '<button class="btn danger write-only" data-del>🗑️ حذف</button><span class="spacer"></span>' : ''}<button class="btn primary write-only" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (!d.plate) return openBlockAlert(t('رقم اللوحة مطلوب'));
    const dup = STATE.vehicles.find(x => x.plate === d.plate && x.id !== id);
    if (dup) return openBlockAlert(t('رقم اللوحة مسجّل بالفعل'));
    try { await persist(id ? 'PUT' : 'POST', id ? '/api/vehicles/' + id : '/api/vehicles', d, 'تم الحفظ'); m.close(); } catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); }
  };
  const del = $('[data-del]', m.el);
  if (del) del.onclick = async () => { if (await openConfirm(t('حذف السيارة؟'), { danger: true })) { m.close(); await persist('DELETE', '/api/vehicles/' + id, undefined, 'تم الحذف'); } };
}

/* =====================================================================
   COST CENTERS — مراكز التكلفة
   ===================================================================== */
function renderCostCenters() {
  const emps = scopedEmployees().filter(e => e.employmentStatus !== 'terminated');
  const rows = STATE.costCenters.map(c => {
    const ce = emps.filter(e => e.costCenter === c.name);
    return { c, n: ce.length, sal: sum(ce.map(e => e.salary)), gov: sum(ce.map(e => e.govTransactionCost)) };
  });
  const unassigned = emps.filter(e => !e.costCenter);
  viewRoot().innerHTML = `<div class="page-head"><div><h1>مراكز التكلفة</h1><div class="sub">${STATE.costCenters.length} ${t('مركز')}</div></div>
    <div class="actions"><button class="btn primary write-only" id="cc-add">➕ إضافة مركز تكلفة</button></div></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('الاسم')}</th><th>${t('الاسم (إنجليزي)')}</th><th>${t('الموظفين')}</th><th>${t('إجمالي الرواتب')}</th><th>${t('تكلفة المعاملات')}</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.c.name)}</b></td><td>${esc(r.c.nameEn || '')}</td><td><a href="#" data-go="${esc(r.c.name)}">${r.n}</a></td><td class="num">${fmtMoney(r.sal)}</td><td class="num">${fmtMoney(r.gov)}</td>
      <td class="row"><button class="btn sm write-only" data-edit="${r.c.id}">✏️</button><button class="btn sm danger write-only" data-del="${r.c.id}">✕</button></td></tr>`).join('')}
    <tr><td class="muted">${t('بدون مركز تكلفة')}</td><td></td><td>${unassigned.length}</td><td class="num">${fmtMoney(sum(unassigned.map(e => e.salary)))}</td><td></td><td></td></tr>
    </tbody></table></div>
    <p class="small muted">${t('لتعيين مركز تكلفة لمجموعة موظفين: حددهم في شاشة الموظفين ثم «تعيين جماعي».')}</p>`;
  $('#cc-add').onclick = () => openCostCenterModal(null);
  $$('[data-edit]', viewRoot()).forEach(b => b.onclick = () => openCostCenterModal(STATE.costCenters.find(c => c.id === b.dataset.edit)));
  $$('[data-del]', viewRoot()).forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف مركز التكلفة؟'), { danger: true })) await persist('DELETE', '/api/cost-centers/' + b.dataset.del, undefined, 'تم الحذف'); });
  $$('[data-go]', viewRoot()).forEach(a => a.onclick = (e) => { e.preventDefault(); goEmployees({ costCenter: a.dataset.go }); });
}
function openCostCenterModal(c) {
  c = c || {};
  const m = openModal({
    title: c.id ? t('تعديل مركز تكلفة') : t('إضافة مركز تكلفة'), size: 'narrow',
    body: `<div class="form"><label class="full"><span class="req">${t('الاسم')}</span><input name="name" value="${esc(c.name || '')}"></label>
      <label class="full">${t('الاسم (إنجليزي)')}<input name="nameEn" value="${esc(c.nameEn || '')}" dir="ltr"></label></div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (!d.name) return openBlockAlert(t('الاسم مطلوب'));
    await persist(c.id ? 'PUT' : 'POST', c.id ? '/api/cost-centers/' + c.id : '/api/cost-centers', d, 'تم الحفظ');
    m.close();
  };
}
