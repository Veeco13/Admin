/* =====================================================================
   COMPANIES — مركز إدارة الشركات (الشركات | العقود والمشاريع الحكومية | مراكز التكلفة)
   ===================================================================== */
'use strict';

const COMPANY_DOC_KINDS = [
  { key: 'commercialLicense', label: 'الرخصة التجارية', exp: 'commercialLicenseExpiry' },
  { key: 'trafficAuth', label: 'تفويض المرور', exp: 'trafficAuthExpiry' },
  { key: 'civilAffairs', label: 'تفويض الشؤون المدنية', exp: 'civilAffairsAuthExpiry' },
];

/* ---------- مركز إدارة الشركات: تبويبات الشركات | المشاريع | مراكز التكلفة ---------- */
const CO_TABS = [
  { id: 'companies', label: 'الشركات', ico: '🏢', perm: 'companies.view' },
  { id: 'projects', label: 'العقود والمشاريع الحكومية', ico: '🏛️', perm: 'companies.view' },
  { id: 'costcenters', label: 'مراكز التكلفة', ico: '💼', perm: 'costcenters.view' },
];
const CO_TIER_RANK = { expired: 0, d30: 1, d60: 2, d90: 3 };
let CO_DETAIL = null;          // نافذة تفاصيل الشركة المفتوحة: {id, tab, m} — بتتحدّث بعد أي حفظ

/** تنبيهات الشركة: مستنداتها وبطاقات مفوّضيها ومشاريعها (نفس مصدر مركز التنبيهات)، الأقرب الأول */
function companyAlerts(cid) {
  return trackedAlertItems().filter(i => (i.kind === 'company' || i.kind === 'project') && i.refId === cid);
}
/** سطر الحالة في كارت الشركة */
function companyStatusLine(c, alerts) {
  if (alerts.length) {
    const w = alerts[0];
    const what = w.kind === 'project' ? `${t('المشروع')} ${w.name}` : (w.name !== companyName(c.id) ? `${t(w.what)} (${w.name})` : t(w.what));
    return `<div class="co-status"><i class="db-dot" style="background:${DB_TIER_COLORS[w.tier]}"></i><span>${esc(what)}: ${esc(daysText(w.days))}</span>${alerts.length > 1 ? `<b>+${alerts.length - 1}</b>` : ''}</div>`;
  }
  const missing = COMPANY_DOC_KINDS.filter(k => !c[k.exp]).map(k => t(k.label));
  return missing.length ? `<div class="co-status muted"><i class="db-dot" style="background:${DB_TIER_COLORS.none}"></i><span>${t('من غير تاريخ')}: ${esc(missing.join(LANG === 'en' ? ', ' : '، '))}</span></div>`
    : `<div class="co-status"><i class="db-dot" style="background:var(--green)"></i><span>${t('كل المستندات سارية')}</span></div>`;
}

function renderCompanies() {
  const tabs = CO_TABS.filter(x => can(x.perm));
  if (!tabs.some(x => x.id === UI.co.tab)) UI.co.tab = tabs.length ? tabs[0].id : 'companies';
  const focus = VIEW_ARGS.focusCompany, focusTab = VIEW_ARGS.focusTab;
  if (focus) { UI.co.tab = 'companies'; VIEW_ARGS = {}; }
  const tab = UI.co.tab;
  const counts = [can('companies.view') && `${scopedCompanies().length} ${t('شركة')}`, can('companies.view') && `${scopedProjects().length} ${t('مشروع')}`,
    can('costcenters.view') && `${STATE.costCenters.length} ${t('مركز تكلفة')}`].filter(Boolean).join(' · ');
  const actions = {
    companies: `<button class="btn primary write-only" data-p="companies.edit scope.all" id="co-add">➕ إضافة شركة</button><button class="btn" id="co-org">🏗️ الهيكل التنظيمي</button>`,
    projects: `<button class="btn primary write-only" data-p="companies.edit" id="pr-add">➕ ${t('إضافة عقد / مشروع')}</button><button class="btn" id="pr-dist">📊 ${t('توزيع العمالة والمركبات')}</button>`,
    costcenters: `<button class="btn primary write-only" data-p="costcenters.edit" id="cc-add">➕ إضافة مركز تكلفة</button>`,
  }[tab];
  viewRoot().innerHTML = `<div class="page-head"><div><h1>مركز إدارة الشركات</h1><div class="sub">${counts}</div></div><div class="actions">${actions}</div></div>
    ${tabs.length > 1 ? `<div class="tabs co-tabs">${tabs.map(x => `<button data-cotab="${x.id}" class="${x.id === tab ? 'active' : ''}">${x.ico} ${esc(t(x.label))}</button>`).join('')}</div>` : ''}
    <div id="co-body"></div>`;
  $$('[data-cotab]').forEach(b => b.onclick = () => { UI.co.tab = b.dataset.cotab; saveUiStateToLocalStorage(); render(); });
  if (tab === 'projects') renderProjectsTab($('#co-body'));
  else if (tab === 'costcenters') renderCostCentersTab($('#co-body'));
  else renderCompaniesTab($('#co-body'));
  // نافذة التفاصيل: من البحث / التنبيهات، أو بتتحدّث بعد أي حفظ وهي مفتوحة
  if (focus) openCompanyDetails(focus, focusTab);
  else if (CO_DETAIL) fillCompanyDetails();
}

function renderCompaniesTab(root) {
  const emps = STATE.employees.filter(e => !empEnded(e));
  // الترتيب: الأقرب ينتهي ← اللي ناقصه تواريخ ← الباقي بالاسم
  const rank = x => x.alerts.length ? CO_TIER_RANK[x.alerts[0].tier] : COMPANY_DOC_KINDS.some(k => !x.c[k.exp]) ? 4 : 5;
  const list = scopedCompanies().map(c => ({ c, alerts: companyAlerts(c.id) }))
    .sort((a, b) => (rank(a) - rank(b))
      || ((a.alerts[0] || {}).days ?? 1e9) - ((b.alerts[0] || {}).days ?? 1e9) || companyName(a.c.id).localeCompare(companyName(b.c.id), 'ar'));
  root.innerHTML = list.length ? `<div class="co-grid">${list.map(({ c, alerts }) => {
    const n = emps.filter(e => (e.affiliations || []).some(a => a.companyId === c.id)).length;
    return `<div class="card co-card ${alerts.length && CO_TIER_RANK[alerts[0].tier] <= 1 ? 'hot' : ''}" data-open="${c.id}" tabindex="0" role="button">
      <div class="co-card-h">${c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="" class="co-logo">` : '<div class="co-logo">🏢</div>'}
        <div class="co-card-t"><b>${esc(c.nameAr)}</b><span dir="ltr">${esc(c.nameEn || '')}</span></div></div>
      <div class="co-stats"><span>👥 <b>${n}</b> ${t('موظف')}</span><span>📁 <b>${STATE.projects.filter(p => p.companyId === c.id).length}</b> ${t('مشروع')}</span><span>✍️ <b>${(c.signatories || []).length}</b> ${t('مفوّض')}</span></div>
      ${companyStatusLine(c, alerts)}</div>`;
  }).join('')}</div>` : `<div class="empty">${t('لا توجد شركات')}</div>`;
  $$('[data-open]', root).forEach(el => {
    el.onclick = () => openCompanyDetails(el.dataset.open);
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } };
  });
  const add = $('#co-add'); if (add) add.onclick = () => openCompanyModal(null);
  const org = $('#co-org'); if (org) org.onclick = renderOrgChartModal;
}

/* ---------- نافذة تفاصيل الشركة: البيانات والمستندات | المفوّضين | المشاريع ---------- */
function openCompanyDetails(cid, tab = 'info') {
  if (!IDX.company[cid]) return toast('الشركة غير موجودة', 'err');
  if (CO_DETAIL) CO_DETAIL.m.close();
  const m = openModal({ title: '', size: 'wide', body: '<div id="cod-body"></div>', foot: '<div id="cod-foot" class="row" style="flex:1"></div>', onClose: () => { CO_DETAIL = null; } });
  CO_DETAIL = { id: cid, tab: tab || 'info', m };
  fillCompanyDetails();
}
function fillCompanyDetails() {
  const { id, tab, m } = CO_DETAIL;
  const c = IDX.company[id];
  if (!c || !document.body.contains(m.el)) { if (CO_DETAIL) CO_DETAIL.m.close(); return; }
  const emps = STATE.employees.filter(e => !empEnded(e) && (e.affiliations || []).some(a => a.companyId === id));
  const projs = STATE.projects.filter(p => p.companyId === id);
  const agencies = (STATE.agencies || []).filter(a => a.companyId === id);
  const sigs = c.signatories || [];
  const kv = (l, v) => `<div><span>${esc(t(l))}</span>${v ? esc(v) : '<span class="muted">—</span>'}</div>`;
  $('.modal-head h2', m.el).innerHTML = `🏢 ${esc(c.nameAr)}`;
  const panes = {
    info: `<div class="kv">${kv('الاسم (إنجليزي)', c.nameEn)}${kv('مجال النشاط', c.activity)}${kv('إدارة العمل', c.laborOffice)}${kv('رقم الملف الرئيسي', c.mainFileNumber)}
        ${kv('رقم الرخصة التجارية', c.commercialLicenseNo)}${kv('الرقم المدني للرخصة', c.licenseCivilNo)}${kv('الرقم الموحد', c.unifiedNumber)}${kv('رقم التسجيل في التأمينات', c.pifssNo)}</div>
      <h4>${t('المستندات')}</h4>
      <table class="data"><thead><tr><th>${t('المستند')}</th><th>${t('الانتهاء')}</th><th>${t('المتبقي')}</th><th>${t('الملف')}</th></tr></thead><tbody>
      ${COMPANY_DOC_KINDS.map(k => { const d = c.docs && c.docs[k.key]; return `<tr><td>${esc(t(k.label))}</td><td>${datePill(c[k.exp])}</td><td class="small muted">${c[k.exp] ? esc(daysText(daysUntil(c[k.exp]))) : ''}</td>
        <td class="row">${d ? `<a class="btn sm" href="${esc(d.url)}" target="_blank" title="${esc(d.name)}">📄 ${t('عرض')}</a>` : ''}<button class="btn sm write-only" data-p="companies.edit" data-doc="${k.key}">${d ? '♻️ ' + t('تغيير') : '📎 ' + t('رفع')}</button></td></tr>`; }).join('')}
      </tbody></table>`,
    sigs: `<div class="row" style="margin-bottom:8px"><span class="spacer"></span><button class="btn sm write-only" data-p="companies.edit" data-sig-add>➕ ${t('إضافة مفوّض')}</button></div>
      ${sigs.length ? `<table class="data"><thead><tr><th>${t('الاسم')}</th><th>${t('الرقم المدني')}</th><th>${t('انتهاء البطاقة')}</th><th></th></tr></thead><tbody>
      ${sigs.map(s => { const sd = s.civilId && STATE.signatoryDocs[s.civilId]; return `<tr><td><b>${esc(s.nameAr)}</b>${s.title ? `<div class="small muted">${esc(s.title)}</div>` : ''}<div class="small muted" dir="ltr" style="text-align:start">${esc(s.nameEn || '')}</div></td>
        <td class="num">${esc(s.civilId || '')}</td><td>${sd ? datePill(sd.expiryDate) : '<span class="muted">—</span>'}</td>
        <td class="row">${sd && sd.url && sd.name ? `<a class="btn sm" href="${esc(sd.url)}" target="_blank" title="${t('عرض البطاقة')}">🪪</a>` : ''}
          <button class="btn sm write-only" data-p="companies.edit" data-sig-doc="${esc(s.civilId || '')}">🪪 ${t('البطاقة')}</button>
          <button class="btn sm" data-sig-sign="${esc(s.civilId || '')}" data-sig-name="${esc(s.nameAr)}">${hasSignature(s.civilId) ? '✍️ ✓' : '✍️'} ${t('التوقيع')}</button>
          <button class="btn sm write-only" data-p="companies.edit" data-sig-edit="${s.id}">✏️</button><button class="btn sm danger write-only" data-p="companies.delete" data-sig-del="${s.id}">✕</button></td></tr>`; }).join('')}
      </tbody></table>` : `<div class="empty">${t('مفيش مفوّضين')}</div>`}`,
    projects: `<div class="row" style="margin-bottom:8px"><span class="spacer"></span><button class="btn sm write-only" data-p="companies.edit" data-proj-add>➕ ${t('إضافة عقد / مشروع')}</button></div>
      ${projectsTable(projs, false)}`,
    agencies: `<div class="row" style="margin-bottom:8px"><span class="small muted">${t('العقود الحكومية بتتبع الوكالة، ومراكز التكلفة التابعة ليها بتحدد مين «برّه وكالة عقده» (للمقارنة والتقارير بس — مراكز التكلفة مابتتغيّرش).')}</span>
        <span class="spacer"></span><button class="btn sm write-only" data-p="companies.edit" data-ag-add>➕ ${t('إضافة وكالة')}</button></div>
      ${agencies.length ? `<table class="data"><thead><tr><th>${t('الوكالة')}</th><th>${t('مراكز التكلفة التابعة')}</th><th>${t('العقود')}</th><th>${t('الموظفين')}</th><th></th></tr></thead><tbody>
      ${agencies.map(a => { const ap = projs.filter(p => p.agencyId === a.id); return `<tr><td><b>${esc(a.nameAr)}</b><div class="small muted" dir="ltr" style="text-align:start">${esc(a.nameEn || '')}</div></td>
        <td>${agencyCcNames(a).map(n => `<span class="chip">${esc(((STATE.costCenters.find(c => c.name === n) || {}).code || '') + ' ' + ccLabel(n))}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td>${ap.map(p => `<span class="chip on">${esc(p.contractNo || projectName(p.id))}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td class="num">${emps.filter(e => ap.some(p => p.id === empProjectId(e))).length}</td>
        <td class="row"><button class="btn sm write-only" data-p="companies.edit" data-ag-edit="${a.id}">✏️</button><button class="btn sm danger write-only" data-p="companies.delete" data-ag-del="${a.id}">✕</button></td></tr>`; }).join('')}
      </tbody></table>` : `<div class="empty">${t('مفيش وكالات')}</div>`}`,
  };
  const status = companyStatusLine(c, companyAlerts(id));
  $('#cod-body', m.el).innerHTML = `<div class="co-detail-h">${c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="" class="co-logo">` : '<div class="co-logo">🏢</div>'}
      <div style="flex:1;min-width:0"><div class="muted small" dir="ltr" style="text-align:start">${esc(c.nameEn || '')}</div>
        <div class="co-stats"><span>👥 <b>${emps.length}</b> ${t('موظف')}</span>${c.mainFileNumber ? `<span>${t('رقم الملف')}: <b>${esc(c.mainFileNumber)}</b></span>` : ''}${c.laborOffice ? `<span>${esc(c.laborOffice)}</span>` : ''}</div>${status}</div></div>
    <div class="tabs" style="margin-top:12px">
      ${[['info', 'البيانات والمستندات'], ['sigs', `${t('المفوّضين بالتوقيع')} (${sigs.length})`], ['projects', `${t('العقود والمشاريع الحكومية')} (${projs.length})`], ['agencies', `${t('الوكالات')} (${agencies.length})`]]
        .map(([k, l]) => `<button data-codtab="${k}" class="${k === tab ? 'active' : ''}">${esc(t(l))}</button>`).join('')}</div>
    <div class="co-pane">${panes[tab] || panes.info}</div>`;
  $('#cod-foot', m.el).innerHTML = `<button class="btn primary write-only" data-p="companies.edit" data-co-edit>✏️ ${t('تعديل بيانات الشركة')}</button>
    <button class="btn" data-co-emps>👥 ${t('الموظفين')} (${emps.length})</button><span class="spacer"></span>
    <button class="btn danger write-only" data-p="companies.delete scope.all" data-co-del>🗑️ ${t('حذف')}</button><button class="btn" data-close-cod>${t('إغلاق')}</button>`;
  translateDomText(m.el);
  const E = m.el;
  $$('[data-codtab]', E).forEach(b => b.onclick = () => { CO_DETAIL.tab = b.dataset.codtab; fillCompanyDetails(); });
  $('[data-close-cod]', E).onclick = () => m.close();
  $('[data-co-edit]', E).onclick = () => openCompanyModal(id);
  $('[data-co-emps]', E).onclick = () => { m.close(); goEmployees({ company: id }); };
  $('[data-co-del]', E).onclick = async () => {
    if (await openConfirm(t('حذف الشركة وكل مشاريعها ومفوّضيها؟'), { danger: true, okLabel: t('حذف') })) { m.close(); await persist('DELETE', '/api/companies/' + id, undefined, 'تم الحذف'); }
  };
  $$('[data-doc]', E).forEach(b => b.onclick = () => openCompanyDocModal(id, b.dataset.doc));
  const sa = $('[data-sig-add]', E); if (sa) sa.onclick = () => openSignatoryModal(id, null);
  $$('[data-sig-edit]', E).forEach(b => b.onclick = () => openSignatoryModal(id, sigs.find(x => x.id === b.dataset.sigEdit)));
  $$('[data-sig-del]', E).forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف المفوّض؟'), { danger: true })) await persist('DELETE', '/api/signatories/' + b.dataset.sigDel, undefined, 'تم الحذف'); });
  $$('[data-sig-doc]', E).forEach(b => b.onclick = () => openCivilIdDocModal(b.dataset.sigDoc));
  $$('[data-sig-sign]', E).forEach(b => b.onclick = () => openSignatureModal(b.dataset.sigSign, b.dataset.sigName, can('companies.edit')));
  const pa = $('[data-proj-add]', E); if (pa) pa.onclick = () => openProjectModal(id, null);
  bindProjectsTable(E, () => m.close());
  const aa = $('[data-ag-add]', E); if (aa) aa.onclick = () => openAgencyModal(id, null);
  $$('[data-ag-edit]', E).forEach(b => b.onclick = () => openAgencyModal(id, agencyById(b.dataset.agEdit)));
  $$('[data-ag-del]', E).forEach(b => b.onclick = async () => {
    if (await openConfirm(t('حذف الوكالة؟ (العقود هتفضل من غير وكالة)'), { danger: true })) await persist('DELETE', '/api/agencies/' + b.dataset.agDel, undefined, 'تم الحذف');
  });
}

/* ---------- العقود والمشاريع الحكومية: جدول واحد (في التبويب وفي تفاصيل الشركة) ----------
   لكل ترخيص: النوع، الوكالة، الرقم المدني، رقم العقد، البداية والنهاية، الموظفين والسيارات المسجّلين عليه،
   واللي شغالين برّه وكالته، واللي إقامتهم بعد نهايته. */
function projectsTable(projs, withCompany) {
  const emps = STATE.employees.filter(e => !empEnded(e));
  if (!projs.length) return `<div class="empty">${t('لا توجد عقود أو مشاريع')}</div>`;
  const rows = projs.slice().sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar')).map(p => {
    const pe = emps.filter(e => empProjectId(e) === p.id), pv = STATE.vehicles.filter(v => v.projectId === p.id);
    const out = pe.filter(empOutsideAgency).length + pv.filter(v => outsideAgency(v.projectId, v.costCenter)).length;
    const beyond = pe.filter(e => beyondLicense(e, p.id, ['residencyExp', 'workPermitExp']).length).length;
    const a = p.agencyId && agencyById(p.agencyId), dl = daysUntil(p.expiryDate);
    return `<tr><td><b>${esc(projectName(p.id))}</b><div class="small muted">${esc(p.laborOffice || '')}</div></td>${withCompany ? `<td><a href="#" data-proj-co="${p.companyId}">${esc(companyName(p.companyId))}</a></td>` : ''}
      <td><span class="chip ${p.kind === 'gov' ? 'on' : ''}">${esc(projectKindLabel(p))}</span></td><td>${a ? esc(agencyName(a)) : '<span class="muted">—</span>'}</td>
      <td class="num">${esc(p.fileNumber || '')}</td><td class="num">${esc(p.contractNo || '')}</td>
      <td class="num small">${fmtDate(p.startDate)}</td><td class="nowrap">${datePill(p.expiryDate)}${dl !== null ? `<div class="small muted">${esc(daysText(dl))}</div>` : ''}</td>
      <td class="num"><a href="#" data-proj-emps="${p.id}">${pe.length}</a></td><td class="num"><a href="#" data-proj-veh="${p.id}">${pv.length}</a></td>
      <td class="num ${out ? 'warn-cell' : ''}">${out ? `<a href="#" data-proj-out="${p.id}">⚠️ ${out}</a>` : '<span class="muted">—</span>'}</td>
      <td class="num ${beyond ? 'warn-cell' : ''}" title="${esc(t('إقامة أو إذن عمل بعد نهاية العقد'))}">${beyond || '<span class="muted">—</span>'}</td>
      <td class="row"><button class="btn sm write-only" data-p="companies.edit" data-proj-edit="${p.id}">✏️</button><button class="btn sm danger write-only" data-p="companies.delete" data-proj-del="${p.id}">✕</button></td></tr>`;
  });
  return `<div class="table-wrap"><table class="data"><thead><tr><th>${t('العقد / المشروع')}</th>${withCompany ? `<th>${t('الشركة')}</th>` : ''}<th>${t('النوع')}</th><th>${t('الوكالة')}</th>
      <th>${t('الرقم المدني')}</th><th>${t('رقم العقد')}</th><th>${t('البداية')}</th><th>${t('النهاية')}</th><th>${t('الموظفين')}</th><th>${t('السيارات')}</th>
      <th title="${esc(t('موظفين وسيارات شغالين برّه وكالة العقد'))}">${t('برّه الوكالة')}</th><th title="${esc(t('إقامة أو إذن عمل بعد نهاية العقد'))}">${t('بعد النهاية')}</th><th></th></tr></thead><tbody>
    ${rows.join('')}</tbody></table></div>`;
}
function goVehicles(filters) { UI.vehicles = Object.assign({ q: '', project: '', agency: '', type: '', cc: '' }, filters); saveUiStateToLocalStorage(); setView('vehicles'); }
function bindProjectsTable(root, beforeLeave = () => {}) {
  $$('[data-proj-emps]', root).forEach(b => b.onclick = (e) => { e.preventDefault(); const p = IDX.project[b.dataset.projEmps]; beforeLeave(); goEmployees({ company: p.companyId, project: p.id }); });
  $$('[data-proj-out]', root).forEach(b => b.onclick = (e) => { e.preventDefault(); const p = IDX.project[b.dataset.projOut]; beforeLeave(); goEmployees({ company: p.companyId, project: p.id, outside: true }); });
  $$('[data-proj-veh]', root).forEach(b => b.onclick = (e) => { e.preventDefault(); beforeLeave(); goVehicles({ project: b.dataset.projVeh }); });
  $$('[data-proj-co]', root).forEach(b => b.onclick = (e) => { e.preventDefault(); openCompanyDetails(b.dataset.projCo, 'projects'); });
  $$('[data-proj-edit]', root).forEach(b => b.onclick = () => { const p = IDX.project[b.dataset.projEdit]; openProjectModal(p.companyId, p); });
  $$('[data-proj-del]', root).forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف المشروع؟ (الموظفين هيفضلوا في الشركة بدون مشروع)'), { danger: true })) await persist('DELETE', '/api/projects/' + b.dataset.projDel, undefined, 'تم الحذف'); });
}
function renderProjectsTab(root) {
  const f = UI.co, q = norm(f.projQ);
  const list = scopedProjects().filter(p => (!f.projCompany || p.companyId === f.projCompany) && (!f.projAgency || (f.projAgency === '__none' ? !p.agencyId : p.agencyId === f.projAgency))
      && (!q || [p.nameAr, p.nameEn, p.fileNumber, p.contractNo, p.laborOffice].some(v => norm(v).includes(q))))
    .sort((a, b) => companyName(a.companyId).localeCompare(companyName(b.companyId), 'ar') || projectName(a.id).localeCompare(projectName(b.id), 'ar'));
  root.innerHTML = `<div class="filters"><input type="search" id="pr-q" placeholder="${esc(t('بحث بالاسم أو الرقم المدني أو رقم العقد…'))}" value="${esc(f.projQ)}">
      <select id="pr-co">${companyOptions(f.projCompany, '— كل الشركات —')}</select>
      <select id="pr-ag">${opt('', t('— كل الوكالات —'), !f.projAgency)}${opt('__none', t('بدون وكالة'), f.projAgency === '__none')}${(STATE.agencies || []).map(a => opt(a.id, agencyName(a), a.id === f.projAgency)).join('')}</select></div>
    ${projectsTable(list, true)}`;
  const upd = p => { Object.assign(UI.co, p); saveUiStateToLocalStorage(); render(); };
  $('#pr-q').addEventListener('input', debounce(e => { UI.co.projQ = e.target.value; render(); const i = $('#pr-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  $('#pr-co').onchange = e => upd({ projCompany: e.target.value });
  $('#pr-ag').onchange = e => upd({ projAgency: e.target.value });
  const add = $('#pr-add'); if (add) add.onclick = () => openProjectModal(f.projCompany || '', null);
  const dist = $('#pr-dist'); if (dist) dist.onclick = () => openDistributionReport();
  bindProjectsTable(root);
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
      <label>${t('الرقم الموحد')}<input name="unifiedNumber" value="${v('unifiedNumber')}" inputmode="numeric"></label>
      <label>${t('رقم التسجيل في التأمينات الاجتماعية')}<input name="pifssNo" value="${v('pifssNo')}"></label>
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
      <label class="full">${t('الرقم المدني')}<input name="civilId" value="${esc(s.civilId || '')}" inputmode="numeric"></label>
      <label class="full">${t('المسمى الوظيفي')}<input name="title" value="${esc(s.title || '')}" placeholder="${esc(t('المفوض بالتوقيع'))}"></label></div>`,
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
  const agencyOpts = cid => opt('', t('— بدون وكالة —'), !p.agencyId) + (STATE.agencies || []).filter(a => a.companyId === cid).map(a => opt(a.id, agencyName(a), a.id === p.agencyId)).join('');
  const m = openModal({
    title: p.id ? t('تعديل عقد / مشروع') : t('إضافة عقد / مشروع'),
    body: `<div class="form"><label><span class="req">${t('الاسم (عربي)')}</span><input name="nameAr" value="${esc(p.nameAr || '')}"></label>
      <label>${t('الاسم (إنجليزي)')}<input name="nameEn" value="${esc(p.nameEn || '')}" dir="ltr"></label>
      <label>${t('الشركة (صاحبة الترخيص)')}<select name="companyId">${companyOptions(companyId)}</select></label>
      <label>${t('النوع')}<select name="kind">${opt('', t('مشروع'), !p.kind)}${Object.entries(PROJECT_KINDS).map(([k, l]) => opt(k, t(l), k === p.kind)).join('')}</select></label>
      <label data-gov>${t('الوكالة')}<select name="agencyId">${agencyOpts(companyId || p.companyId)}</select></label>
      <label data-gov>${t('رقم العقد')}<input name="contractNo" value="${esc(p.contractNo || '')}" inputmode="numeric"></label>
      <label>${t('الرقم المدني للترخيص')}<input name="fileNumber" value="${esc(p.fileNumber || '')}" inputmode="numeric"></label>
      <label>${t('إدارة العمل')}<input name="laborOffice" value="${esc(p.laborOffice || '')}"></label>
      <label>${t('تاريخ البداية')}<input type="date" name="startDate" value="${esc(p.startDate || '')}"></label>
      <label>${t('تاريخ النهاية')}<input type="date" name="expiryDate" value="${esc(p.expiryDate || '')}"></label></div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  const kind = $('[name=kind]', m.el), co = $('[name=companyId]', m.el);
  const sync = () => $$('[data-gov]', m.el).forEach(x => { x.style.display = kind.value === 'gov' ? '' : 'none'; });
  kind.onchange = sync; sync();
  co.onchange = () => { $('[name=agencyId]', m.el).innerHTML = agencyOpts(co.value); };
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (!d.nameAr || !d.companyId) return openBlockAlert(t('الاسم والشركة مطلوبين'));
    if (d.kind !== 'gov') { d.agencyId = null; d.contractNo = null; }
    await persist(p.id ? 'PUT' : 'POST', p.id ? '/api/projects/' + p.id : '/api/projects', d, 'تم الحفظ');
    m.close();
  };
}
/** وكالة: الاسم، ومراكز التكلفة التابعة ليها (للمقارنة والتقارير بس) */
function openAgencyModal(companyId, a) {
  a = a || {};
  const sel = new Set(a.costCenterIds || []);
  const m = openModal({
    title: a.id ? t('تعديل وكالة') : t('إضافة وكالة'), size: 'narrow',
    body: `<div class="form"><label class="full"><span class="req">${t('اسم الوكالة (عربي)')}</span><input name="nameAr" value="${esc(a.nameAr || '')}"></label>
      <label class="full">${t('اسم الوكالة (إنجليزي)')}<input name="nameEn" value="${esc(a.nameEn || '')}" dir="ltr"></label></div>
      <h4 class="cu-h">${t('مراكز التكلفة التابعة للوكالة')}</h4>
      <div class="cu-pick-list" style="max-height:240px">${STATE.costCenters.map(c => `<label class="${sel.has(c.id) ? 'on' : ''}"><input type="checkbox" data-agcc="${c.id}" ${sel.has(c.id) ? 'checked' : ''}>
        <b>${esc(c.code || '')}</b> ${esc(c.name)} <span class="small muted">${esc(c.nameEn || '')}</span></label>`).join('')}</div>
      <div class="small muted" style="margin-top:6px">${t('الموظف أو العربية على عقد الوكالة دي وشغال في مركز تكلفة مش من دول ← «برّه وكالة عقده». مراكز التكلفة نفسها مش بتتغيّر.')}</div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $$('[data-agcc]', m.el).forEach(cb => cb.onchange = () => cb.closest('label').classList.toggle('on', cb.checked));
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues($('.form', m.el));
    if (!d.nameAr) return openBlockAlert(t('اسم الوكالة مطلوب'));
    d.companyId = companyId;
    d.costCenterIds = $$('[data-agcc]', m.el).filter(x => x.checked).map(x => x.dataset.agcc);
    await persist(a.id ? 'PUT' : 'POST', a.id ? '/api/agencies/' + a.id : '/api/agencies', d, 'تم الحفظ');
    m.close();
  };
}

/* ---------- تقرير توزيع العمالة والمركبات: العقود (صفوف) × مكان الشغل الفعلي (أعمدة) ---------- */
function openDistributionReport() {
  const m = openModal({
    title: '📊 ' + t('توزيع العمالة والمركبات'), size: 'narrow',
    body: `<div class="form"><label class="full">${t('لغة التقرير')}<select name="lang">${opt('ar', 'العربية', LANG !== 'en')}${opt('en', 'English', LANG === 'en')}</select></label></div>
      <div class="small muted" style="margin-top:6px">${t('لكل عقد / مشروع: عدد الموظفين والسيارات المسجّلين عليه موزّعين على مكان الشغل الفعلي (مركز التكلفة). الخانات البرتقالي = برّه وكالة العقد.')}</div>`,
    foot: `<button class="btn primary" data-go>🖨️ ${t('معاينة وطباعة')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-go]', m.el).onclick = () => { const lang = $('[name=lang]', m.el).value; m.close(); withLang(lang, printDistributionReport); };
}
function printDistributionReport() {
  const projs = scopedProjects().slice().sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar'));
  const matrix = (items, pidOf, title) => {
    const ccs = uniq(items.map(x => x.costCenter || '—')).sort((a, b) => a.localeCompare(b, 'ar'));
    const rows = [...projs.map(p => ({ p, items: items.filter(x => pidOf(x) === p.id) })), { p: null, items: items.filter(x => !pidOf(x) || !IDX.project[pidOf(x)]) }].filter(r => r.items.length);
    const code = n => (STATE.costCenters.find(c => c.name === n) || {}).code || n;
    const cell = (r, cc) => {
      const n = r.items.filter(x => (x.costCenter || '—') === cc).length;
      const out = n && r.p && r.p.agencyId && cc !== '—' && !agencyCcNames(agencyById(r.p.agencyId) || {}).includes(cc);
      return `<td class="num"${out ? ' style="background:#fdeede;color:#b35c00;font-weight:600"' : ''}>${n || ''}</td>`;
    };
    return `<h3 style="margin:14px 0 6px">${esc(title)}</h3><table class="rpt"><thead><tr><th class="txt">${t('العقد / المشروع')}</th><th>${t('الوكالة')}</th><th>${t('رقم العقد')}</th>
        ${ccs.map(cc => `<th title="${esc(ccLabel(cc))}">${esc(code(cc))}</th>`).join('')}<th>${t('الإجمالي')}</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${i % 2 ? 'z' : ''}"><td class="txt">${r.p ? esc(projectName(r.p.id)) : esc(t('بدون عقد / مشروع'))}</td><td>${r.p && r.p.agencyId ? esc(agencyName(agencyById(r.p.agencyId))) : ''}</td>
        <td class="num">${r.p ? esc(r.p.contractNo || '') : ''}</td>${ccs.map(cc => cell(r, cc)).join('')}<td class="num"><b>${r.items.length}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">${t('الإجمالي')}</td>${ccs.map(cc => `<td class="num">${items.filter(x => (x.costCenter || '—') === cc).length || ''}</td>`).join('')}<td class="num"><b>${items.length}</b></td></tr></tfoot></table>
      <div class="small" style="margin-top:4px;color:#66736f">${ccs.filter(cc => cc !== '—').map(cc => `${esc(code(cc))} = ${esc(ccLabel(cc))}`).join(' · ')}</div>`;
  };
  const emps = scopedEmployees().filter(e => !empEnded(e)), vehs = STATE.vehicles.filter(v => companyInScope(v.companyId) || !v.companyId);
  const outE = emps.filter(empOutsideAgency).length, outV = vehs.filter(v => outsideAgency(v.projectId, v.costCenter)).length;
  openReportWindow({
    title: t('توزيع العمالة والمركبات'), subtitle: t('العقود والمشاريع الحكومية × مكان الشغل الفعلي'), landscape: true,
    summary: [[projs.length, t('عقد / مشروع')], [emps.length, t('موظف')], [outE, t('موظف برّه وكالة عقده')], [vehs.length, t('سيارة')], [outV, t('سيارة برّه وكالة عقدها')]],
    body: matrix(emps.map(e => ({ costCenter: e.costCenter, pid: empProjectId(e) })), x => x.pid, t('الموظفين'))
      + (vehs.length ? matrix(vehs.map(v => ({ costCenter: v.costCenter, pid: v.projectId })), x => x.pid, t('السيارات')) : ''),
    meta: [[t('عدد السجلات'), String(emps.length + vehs.length)]],
  });
  printLog(t('توزيع العمالة والمركبات'), 'employee');
}

/* =====================================================================
   VEHICLES — مركز إدارة السيارات
   ===================================================================== */
function renderVehicles() {
  const V = UI.vehicles = Object.assign({ q: '', project: '', agency: '', type: '', cc: '' }, UI.vehicles || {});
  const q = norm(V.q);
  const list = STATE.vehicles.filter(v => companyInScope(v.companyId) || !v.companyId)
    .filter(v => (!V.project || (V.project === '__none' ? !v.projectId : v.projectId === V.project))
      && (!V.agency || (projectAgency(v.projectId) || {}).id === V.agency) && (!V.type || v.vehicleType === V.type)
      && (!V.cc || (V.cc === '__out' ? outsideAgency(v.projectId, v.costCenter) : v.costCenter === V.cc)))
    .filter(v => !q || [v.plate, v.model, companyName(v.companyId), empName(IDX.employee[v.driverId]), projectName(v.projectId), v.costCenter].some(x => norm(x).includes(q)));
  viewRoot().innerHTML = `<div class="page-head"><div><h1>مركز إدارة السيارات</h1><div class="sub">${STATE.vehicles.length} ${t('سيارة')}</div></div>
    <div class="actions"><button class="btn primary write-only" data-p="vehicles.edit" id="v-add">➕ إضافة سيارة</button>${can('admin') ? '<button class="btn" id="v-export">📤 تصدير CSV</button>' : ''}</div></div>
    <div class="filters"><input type="search" id="v-q" placeholder="${esc(t('بحث باللوحة أو السائق أو العقد…'))}" value="${esc(V.q)}">
      <select id="v-proj">${opt('', t('— كل العقود والمشاريع —'), !V.project)}${opt('__none', t('بدون عقد / مشروع'), V.project === '__none')}${scopedProjects().slice().sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar')).map(p => opt(p.id, projectName(p.id), p.id === V.project)).join('')}</select>
      <select id="v-ag">${opt('', t('— كل الوكالات —'), !V.agency)}${(STATE.agencies || []).map(a => opt(a.id, agencyName(a), a.id === V.agency)).join('')}</select>
      <select id="v-type">${opt('', t('— كل الأنواع —'), !V.type)}${Object.entries(VEHICLE_TYPES).map(([k, l]) => opt(k, t(l), k === V.type)).join('')}</select>
      <select id="v-cc">${opt('', t('— كل مراكز التكلفة —'), !V.cc)}${opt('__out', '⚠️ ' + t('برّه وكالة عقدها'), V.cc === '__out')}${STATE.costCenters.map(c => opt(c.name, `${c.code || ''} ${ccLabel(c.name)}`, c.name === V.cc)).join('')}</select>
      <button class="btn sm ghost" id="v-clear">✕ ${t('مسح الفلاتر')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('رقم اللوحة')}</th><th>${t('النوع / الموديل')}</th><th>${t('الشركة')}</th><th>${t('العقد / المشروع')}</th><th>${t('مركز التكلفة')}</th><th>${t('السائق')}</th><th>${t('انتهاء التأمين')}</th><th>${t('انتهاء الدفتر')}</th></tr></thead>
    <tbody>${list.map(v => {
      const d = IDX.employee[v.driverId], p = IDX.project[v.projectId], out = outsideAgency(v.projectId, v.costCenter);
      return `<tr class="clickable" data-id="${v.id}"><td><b class="num">${esc(v.plate)}</b></td><td>${v.vehicleType ? `<span class="chip">${esc(t(VEHICLE_TYPES[v.vehicleType]))}</span> ` : ''}${esc(v.model || '')}</td><td>${esc(companyName(v.companyId))}</td>
      <td>${p ? `${esc(projectName(p.id))}<div class="small muted">${esc(projectSummary(p))}</div>` : '<span class="muted">—</span>'}</td>
      <td>${esc(v.costCenter || '—')}${out ? `<div class="small" style="color:var(--orange)">⚠️ ${t('برّه وكالة عقدها')}</div>` : ''}</td>
      <td>${d ? esc(empName(d)) + (d.drivingLicenseExp ? ' ' + datePill(d.drivingLicenseExp) : '') : '<span class="muted">—</span>'}</td><td>${datePill(v.insuranceExpiry)}</td><td>${datePill(v.govLicenseExpiry)}</td></tr>`;
    }).join('') || `<tr><td colspan="8" class="empty">${t('لا توجد سيارات')}</td></tr>`}</tbody></table></div>`;
  $('#v-add').onclick = () => openVehicleModal(null);
  $('#v-q').addEventListener('input', debounce(e => { UI.vehicles.q = e.target.value; saveUiStateToLocalStorage(); render(); const i = $('#v-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  const vupd = p => { Object.assign(UI.vehicles, p); saveUiStateToLocalStorage(); render(); };
  $('#v-proj').onchange = e => vupd({ project: e.target.value });
  $('#v-ag').onchange = e => vupd({ agency: e.target.value });
  $('#v-type').onchange = e => vupd({ type: e.target.value });
  $('#v-cc').onchange = e => vupd({ cc: e.target.value });
  $('#v-clear').onclick = () => vupd({ q: '', project: '', agency: '', type: '', cc: '' });
  $$('tr[data-id]', viewRoot()).forEach(tr => tr.onclick = () => openVehicleModal(tr.dataset.id));
  const vx = $('#v-export'); if (vx) vx.onclick = () => exportGuard(t('السيارات'), () => downloadBlob(toCsv([[t('رقم اللوحة'), t('النوع'), t('الموديل'), t('الشركة'), t('العقد / المشروع'), t('رقم العقد'), t('الوكالة'), t('مركز التكلفة'), t('السائق'), t('انتهاء التأمين'), t('انتهاء الدفتر')],
    ...list.map(v => [v.plate, t(VEHICLE_TYPES[v.vehicleType] || ''), v.model, companyName(v.companyId), projectName(v.projectId), (IDX.project[v.projectId] || {}).contractNo, agencyName(projectAgency(v.projectId)), v.costCenter, empName(IDX.employee[v.driverId]), v.insuranceExpiry, v.govLicenseExpiry])]), `vehicles-${todayISO()}.csv`, 'text/csv'));
}
function openVehicleModal(id) {
  const v = id ? IDX.vehicle[id] : {};
  const drivers = STATE.employees.filter(e => e.isDriver || e.id === v.driverId).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const m = openModal({
    title: id ? t('تعديل سيارة') + ' ' + esc(v.plate) : t('إضافة سيارة'),
    body: `${v.projectId ? `<div class="emp-license" style="margin-bottom:10px">
        <div><span>${t('مسجّلة باسم')}</span><b>${esc(companyName(v.companyId) || '—')}</b></div>
        <div><span>${t('العقد / المشروع')}</span><b>${esc(projectName(v.projectId))}</b><div class="small muted">${esc(projectSummary(IDX.project[v.projectId]))}</div>
          ${(IDX.project[v.projectId] || {}).expiryDate ? `<div class="small">${t('ينتهي')} ${datePill(IDX.project[v.projectId].expiryDate)}</div>` : ''}</div>
        <div><span>${t('شغالة فعليًا')}</span><b>${esc(v.costCenter || '—')}</b>${outsideAgency(v.projectId, v.costCenter) ? `<div class="small" style="color:var(--orange)">⚠️ ${t('برّه وكالة عقدها')}</div>` : ''}</div></div>` : ''}
      <div class="form"><label><span class="req">${t('رقم اللوحة')}</span><input name="plate" value="${esc(v.plate || '')}"></label>
      <label>${t('نوع المركبة')}<select name="vehicleType">${opt('', '—', !v.vehicleType)}${Object.entries(VEHICLE_TYPES).map(([k, l]) => opt(k, t(l), k === v.vehicleType)).join('')}</select></label>
      <label>${t('الموديل')}<input name="model" value="${esc(v.model || '')}"></label>
      <label>${t('الشركة (مسجّلة باسم)')}<select name="companyId">${companyOptions(v.companyId)}</select></label>
      <label>${t('العقد / المشروع')}<select name="projectId"></select></label>
      <label>${t('مركز التكلفة (مكان الشغل الفعلي)')}<select name="costCenter">${costCenterOptions(v.costCenter)}</select></label>
      <label>${t('السائق')}<select name="driverId">${opt('', '—', !v.driverId)}${drivers.map(e => opt(e.id, e.name + ' — ' + e.id, e.id === v.driverId)).join('')}</select></label>
      <label>${t('انتهاء التأمين')}<input type="date" name="insuranceExpiry" value="${esc(v.insuranceExpiry || '')}"></label>
      <label>${t('انتهاء الدفتر')}<input type="date" name="govLicenseExpiry" value="${esc(v.govLicenseExpiry || '')}"></label>
      <label class="full">${t('ملاحظات')}<input name="notes" value="${esc(v.notes || '')}"></label></div>
      <div class="small muted">${t('قائمة السائقين بتعرض الموظفين المعلَّم عليهم «سائق» فقط.')}</div>`,
    foot: `${id ? '<button class="btn danger write-only" data-p="vehicles.delete" data-del>🗑️ حذف</button><span class="spacer"></span>' : ''}<button class="btn primary write-only" data-p="vehicles.edit" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  // العقود / المشاريع بتاعة الشركة اللي العربية مسجّلة باسمها بس
  const coSel = $('[name=companyId]', m.el), prSel = $('[name=projectId]', m.el);
  const fillProjects = () => {
    const keep = prSel.value || v.projectId;
    prSel.innerHTML = opt('', '—', !keep) + scopedProjects().filter(p => p.companyId === coSel.value)
      .sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar'))
      .map(p => opt(p.id, projectName(p.id) + (p.contractNo ? ' · ' + p.contractNo : ''), p.id === keep)).join('');
  };
  fillProjects();
  coSel.onchange = fillProjects;
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
function renderCostCentersTab(root) {
  const emps = scopedEmployees().filter(e => !empEnded(e));
  const rows = STATE.costCenters.map(c => {
    const ce = emps.filter(e => e.costCenter === c.name);
    return { c, n: ce.length, sal: sum(ce.map(e => e.salary)), gov: sum(ce.map(e => e.govTransactionCost)) };
  });
  const unassigned = emps.filter(e => !e.costCenter);
  root.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>${t('الرمز')}</th><th>${t('الاسم')}</th><th>${t('الاسم (إنجليزي)')}</th><th>${t('الشركة الفعلية')}</th><th>${t('الموظفين')}</th><th data-p="sensitive.salary">${t('إجمالي الرواتب')}</th><th data-p="sensitive.salary">${t('تكلفة المعاملات')}</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="num nowrap">${r.c.code ? `<span class="chip on" title="${esc(t('رمز المركز في أرقام الفواتير — مايتغيّرش'))}">${esc(r.c.code)}${r.c.codeLocked ? ' 🔒' : ''}</span>` : '—'}</td><td><b>${esc(r.c.name)}</b></td><td>${esc(r.c.nameEn || '')}</td><td>${r.c.companyId ? esc(companyName(r.c.companyId) || '—') : `<span class="muted">${t('غير محددة')}</span>`}</td><td><a href="#" data-go="${esc(r.c.name)}">${r.n}</a></td><td class="num" data-p="sensitive.salary">${fmtMoney(r.sal)}</td><td class="num" data-p="sensitive.salary">${fmtMoney(r.gov)}</td>
      <td class="row"><button class="btn sm write-only" data-p="costcenters.edit" data-edit="${r.c.id}">✏️</button><button class="btn sm danger write-only" data-p="costcenters.delete" data-del="${r.c.id}">✕</button></td></tr>`).join('')}
    <tr><td class="num"><span class="chip">GEN</span></td><td class="muted">${t('بدون مركز تكلفة')}</td><td></td><td></td><td>${unassigned.length}</td><td class="num" data-p="sensitive.salary">${fmtMoney(sum(unassigned.map(e => e.salary)))}</td><td data-p="sensitive.salary"></td><td></td></tr>
    </tbody></table></div>
    <p class="small muted">${t('لتعيين مركز تكلفة لمجموعة موظفين: حددهم في شاشة الموظفين ثم «تعيين جماعي».')}</p>`;
  const add = $('#cc-add'); if (add) add.onclick = () => openCostCenterModal(null);
  $$('[data-edit]', root).forEach(b => b.onclick = () => openCostCenterModal(STATE.costCenters.find(c => c.id === b.dataset.edit)));
  $$('[data-del]', root).forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف مركز التكلفة؟'), { danger: true })) await persist('DELETE', '/api/cost-centers/' + b.dataset.del, undefined, 'تم الحذف'); });
  $$('[data-go]', root).forEach(a => a.onclick = (e) => { e.preventDefault(); goEmployees({ costCenter: a.dataset.go }); });
}
function openCostCenterModal(c) {
  c = c || {};
  const m = openModal({
    title: c.id ? t('تعديل مركز تكلفة') : t('إضافة مركز تكلفة'), size: 'narrow',
    body: `<div class="form"><label class="full"><span class="req">${t('الاسم')}</span><input name="name" value="${esc(c.name || '')}"></label>
      <label class="full">${t('الاسم (إنجليزي)')}<input name="nameEn" value="${esc(c.nameEn || '')}" dir="ltr"></label>
      <label class="full">${t('الرمز')} <span class="small muted">(${t('حروف إنجليزي — أرقام فواتيره: INV-SUP-2026-0001')})</span>
        <input name="code" value="${esc(c.code || '')}" dir="ltr" maxlength="5" style="text-transform:uppercase" placeholder="${esc(t('تلقائي من الاسم الإنجليزي'))}" ${c.codeLocked ? 'disabled' : ''}>
        ${c.codeLocked ? `<span class="small muted">🔒 ${t('الرمز مايتغيّرش')}</span>` : `<span class="small muted">${t('الرمز بيتحدد مرة واحدة ومش هيتغيّر بعد الحفظ.')}</span>`}</label>
      <label class="full">${t('الشركة الفعلية (اللي الموظفين شغالين فيها)')}<select name="companyId" ${can('scope.all') ? '' : 'disabled'}>${companyOptions(c.companyId, '— غير محددة —')}</select>
        <span class="small muted">${t('المستخدم المحصور في الشركة دي هيشوف موظفين المركز ده حتى لو مسجّلين على شركة تانية.')}</span></label></div>`,
    foot: `<button class="btn primary" data-save>حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (!d.name) return openBlockAlert(t('الاسم مطلوب'));
    if (!can('scope.all')) delete d.companyId;
    if (c.codeLocked) delete d.code;
    else if (d.code) d.code = d.code.toUpperCase();
    await persist(c.id ? 'PUT' : 'POST', c.id ? '/api/cost-centers/' + c.id : '/api/cost-centers', d, 'تم الحفظ');
    m.close();
  };
}
