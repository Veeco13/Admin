/* =====================================================================
   PERMITS — التصاريح للموظفين والسيارات (القسم 24)
   التصريح تابع لموظف أو لعربية، والعقد / المشروع اللي طالع عليه اختياري (ممكن يختلف عن عقد صاحبه
   ومكان شغله — بيطلع على مشروع ويشتغل بيه في مشروع تاني). الأنواع والأماكن قايمتين
   بيتحكم فيهم مدير النظام. صلاحية التصريح = صلاحية صاحبه (employees.* / vehicles.*).
   ===================================================================== */
const PERMIT_HOLDERS = { employee: { l: 'موظف', ico: '👤', mod: 'employees' }, vehicle: { l: 'سيارة', ico: '🚗', mod: 'vehicles' } };
const PERMIT_APPLIES = { '': 'الموظفين والسيارات', employee: 'الموظفين بس', vehicle: 'السيارات بس' };
const PERMIT_GROUPS = { '': 'بدون تجميع', project: 'العقد / المشروع', type: 'النوع', place: 'المكان', holder: 'صاحب التصريح (موظف / سيارة)', agency: 'الوكالة' };

function permitTypeName(tp) { return tp ? (LANG === 'en' && tp.nameEn ? tp.nameEn : tp.nameAr) : ''; }
function permitPlaceName(pl) { return pl ? (LANG === 'en' && pl.nameEn ? pl.nameEn : pl.nameAr) : ''; }
function permitsOf(kind, id) { return (IDX.permitsOf && IDX.permitsOf[kind] && IDX.permitsOf[kind][id]) || []; }
/** ساري = لسه ماانتهاش */
function permitValid(p) { const d = daysUntil(p.expiryDate); return d !== null && d >= 0; }
function permitLabel(p) { return permitTypeName(IDX.permitType[p.typeId]) || t('تصريح'); }
function permitPlacesText(p) { return (p.placeIds || []).map(x => permitPlaceName(IDX.permitPlace[x])).filter(Boolean).join(LANG === 'en' ? ', ' : '، '); }
/** «تصريح دخول (الأحمدي) حتى 01/02/2027» */
function permitShortText(p) { const pl = permitPlacesText(p); return `${permitLabel(p)}${pl ? ` (${pl})` : ''} ${t('حتى')} ${fmtDate(p.expiryDate)}`; }
function permitHolder(p) { return p.holderKind === 'employee' ? IDX.employee[p.employeeId] : IDX.vehicle[p.vehicleId]; }
function permitHolderName(p) { const h = permitHolder(p); return !h ? '' : p.holderKind === 'employee' ? empName(h) : h.plate; }
function permitHolderSub(p) {
  const h = permitHolder(p);
  if (!h) return '';
  return p.holderKind === 'employee' ? h.id : [t(VEHICLE_TYPES[h.vehicleType] || ''), h.model].filter(Boolean).join(' ');
}
function permitHolderId(p) { return p.holderKind === 'employee' ? p.employeeId : p.vehicleId; }
function permitCan(kind, act) { return can(PERMIT_HOLDERS[kind].mod + '.' + act); }
function permitTypesFor(kind) { return (STATE.permitTypes || []).filter(tp => !tp.appliesTo || tp.appliesTo === kind); }
function permitPlaceChips(p) { return (p.placeIds || []).map(x => `<span class="chip">${esc(permitPlaceName(IDX.permitPlace[x]))}</span>`).join(' ') || '<span class="muted">—</span>'; }
function permitProjectOptions(sel) {
  return opt('', t('— بدون —'), !sel) + scopedProjects().slice().sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar'))
    .map(p => opt(p.id, projectName(p.id) + (p.contractNo ? ' · ' + p.contractNo : ''), p.id === sel)).join('');
}

/* ---------- جدول تصاريح موظف / عربية (في البطاقة) ---------- */
function permitListHtml(list, kind) {
  if (!list.length) return `<div class="empty">${t('مفيش تصاريح')}</div>`;
  const mod = PERMIT_HOLDERS[kind].mod;
  return `<div class="table-wrap"><table class="data"><thead><tr><th>${t('النوع')}</th><th>${t('الرقم')}</th><th>${t('الجهة المانحة')}</th><th>${t('الأماكن')}</th>
      <th>${t('العقد / المشروع')}</th><th>${t('الإصدار')}</th><th>${t('الانتهاء')}</th><th></th></tr></thead><tbody>
    ${list.slice().sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || ''))).map(p => `<tr>
      <td><b>${esc(permitLabel(p))}</b></td><td class="num" dir="ltr" style="white-space:nowrap">${esc(p.permitNo || '')}</td><td>${esc(p.issuer || '')}</td><td>${permitPlaceChips(p)}</td>
      <td class="small">${esc(projectName(p.projectId))}</td><td>${fmtDate(p.issueDate)}</td><td>${datePill(p.expiryDate)}</td>
      <td style="white-space:nowrap">${p.fileUrl ? `<button class="btn sm" data-permit-file="${p.id}" title="${esc(t('عرض المرفق'))}">📎</button> ` : ''}<button class="btn sm write-only" data-p="${mod}.edit" data-permit-edit="${p.id}">✏️</button></td></tr>
      ${p.notes ? `<tr><td colspan="8" class="small muted">📝 ${esc(p.notes)}</td></tr>` : ''}`).join('')}</tbody></table></div>`;
}
function bindPermitList(root, after) {
  $$('[data-permit-edit]', root).forEach(b => b.onclick = ev => { ev.stopPropagation(); openPermitModal(b.dataset.permitEdit, null, after); });
  $$('[data-permit-file]', root).forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const p = (STATE.permits || []).find(x => x.id === b.dataset.permitFile);
    if (p && p.fileUrl) openFileViewer(p.fileUrl, p.fileName || t('مرفق التصريح'));
  });
}

/* ---------- إضافة / تعديل تصريح ----------
   preset = { holderKind, holderId } ← صاحب التصريح ثابت (من بطاقة الموظف أو العربية). after = بعد الحفظ أو الحذف */
function openPermitModal(id, preset, after) {
  const p = id ? (STATE.permits || []).find(x => x.id === id) : null;
  if (id && !p) return toast('التصريح غير موجود', 'err');
  const fixed = !!(p || (preset && preset.holderId));
  const kinds = fixed ? [p ? p.holderKind : preset.holderKind] : Object.keys(PERMIT_HOLDERS).filter(k => permitCan(k, 'edit'));
  if (!kinds.length) return toast('مش مسموح', 'err');
  let kind = kinds[0];
  const holderId = p ? permitHolderId(p) : fixed ? preset.holderId : '';
  const x = p || {};
  const mod = PERMIT_HOLDERS[kind].mod;
  const emps = scopedEmployees().filter(e => !empEnded(e));
  const vehs = STATE.vehicles.filter(v => companyInScope(v.companyId) || !v.companyId);
  const issuers = uniq((STATE.permits || []).map(q => q.issuer).filter(Boolean)).sort((a, b) => a.localeCompare(b, 'ar'));
  const places = STATE.permitPlaces || [];
  const holderHtml = fixed
    ? `<div class="notice" style="margin-bottom:10px">${PERMIT_HOLDERS[kind].ico} <b>${esc(permitHolderName({ holderKind: kind, employeeId: holderId, vehicleId: holderId }))}</b>
        <span class="small muted">${esc(permitHolderSub({ holderKind: kind, employeeId: holderId, vehicleId: holderId }))}</span></div>`
    : `<div class="form" style="margin-bottom:10px">
        ${kinds.length > 1 ? `<label>${t('صاحب التصريح')}<select name="holderKind">${kinds.map(k => opt(k, PERMIT_HOLDERS[k].ico + ' ' + t(PERMIT_HOLDERS[k].l), k === kind)).join('')}</select></label>` : ''}
        <label class="full" data-holder="employee"><span class="req">${t('الموظف')}</span><input name="empPick" list="dl-permit-emp" placeholder="${esc(t('اكتب الاسم أو الرقم المدني واختار من القايمة'))}" autocomplete="off"></label>
        <label class="full" data-holder="vehicle"><span class="req">${t('السيارة')}</span><select name="vehPick">${opt('', t('— اختار السيارة —'), true)}${vehs.map(v => opt(v.id, `${v.plate}${v.model ? ' — ' + v.model : ''}`, false)).join('')}</select></label>
        <datalist id="dl-permit-emp">${emps.map(e => `<option value="${esc(e.id + ' — ' + e.name)}">`).join('')}</datalist></div>`;
  const m = openModal({
    title: p ? '🪪 ' + t('تعديل تصريح') : '🪪 ' + t('إضافة تصريح'), size: 'wide',
    body: `${holderHtml}
      <div class="form">
        <label><span class="req">${t('نوع التصريح')}</span><select name="typeId"></select></label>
        <label>${t('رقم التصريح')}<input name="permitNo" value="${esc(x.permitNo || '')}" dir="ltr"></label>
        <label>${t('الجهة المانحة')}<input name="issuer" list="dl-permit-issuer" value="${esc(x.issuer || '')}"><datalist id="dl-permit-issuer">${issuers.map(i => `<option value="${esc(i)}">`).join('')}</datalist></label>
        <label title="${esc(t('العقد أو المشروع اللي التصريح طالع عليه — ممكن يختلف عن عقد صاحبه ومكان شغله'))}">${t('العقد / المشروع (اختياري)')}<select name="projectId">${permitProjectOptions(x.projectId)}</select></label>
        <label>${t('تاريخ الإصدار')}<input type="date" name="issueDate" value="${esc(x.issueDate || '')}"></label>
        <label><span class="req">${t('تاريخ الانتهاء')}</span><input type="date" name="expiryDate" value="${esc(x.expiryDate || '')}"></label>
        <div class="full"><div class="small muted" style="margin-bottom:4px">${t('الأماكن')}</div>
          ${places.length ? `<div class="row" style="flex-wrap:wrap;gap:4px 14px">${places.map(pl => `<label class="check"><input type="checkbox" data-place="${pl.id}" ${(x.placeIds || []).includes(pl.id) ? 'checked' : ''}> ${esc(permitPlaceName(pl))}</label>`).join('')}</div>`
            : `<div class="small muted">${t('مفيش أماكن متسجّلة — مدير النظام بيضيفها من «⚙️ الأنواع والأماكن» في شاشة التصاريح.')}</div>`}</div>
        <label class="full">${t('ملاحظات')}<input name="notes" value="${esc(x.notes || '')}"></label>
        <div class="full"><div class="small muted" style="margin-bottom:4px">${t('المرفق (صورة أو PDF — للعرض والطباعة بس)')}</div>
          ${p ? `<div class="row">${p.fileUrl ? `<button type="button" class="btn sm" data-file-view>📎 ${esc(p.fileName || t('عرض المرفق'))}</button>` : `<span class="muted small">${t('مفيش مرفق')}</span>`}
              <span class="write-only" data-p="${mod}.edit"><button type="button" class="btn sm" data-file-up>⬆️ ${p.fileUrl ? t('تغيير المرفق') : t('رفع مرفق')}</button>
              ${p.fileUrl ? `<button type="button" class="btn sm danger" data-file-del>🗑️</button>` : ''}</span></div>`
            : `<input type="file" name="file" accept=".pdf,image/*">`}</div>
      </div>
      ${p ? `<div class="small muted" style="margin-top:8px">${t('آخر تعديل')}: ${fmtDateTime(p.updatedAt)} ${esc(p.updatedBy || '')}</div>` : ''}`,
    foot: `${p ? `<button class="btn danger write-only" data-p="${mod}.delete" data-permit-del>🗑️ ${t('حذف')}</button><span class="spacer"></span>` : ''}
      <button class="btn primary write-only" data-p="${mod}.edit" data-save>${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el, typeSel = $('[name=typeId]', E);
  const pickedHolder = () => {
    if (fixed) return holderId;
    if (kind === 'employee') { const id = ($('[name=empPick]', E).value || '').split(' — ')[0].trim(); return IDX.employee[id] ? id : ''; }
    return $('[name=vehPick]', E).value;
  };
  const fillTypes = () => {
    const keep = typeSel.value || x.typeId;
    const types = permitTypesFor(kind);
    typeSel.innerHTML = opt('', types.length ? t('— اختار النوع —') : t('مفيش أنواع — مدير النظام بيضيفها'), !keep) + types.map(tp => opt(tp.id, permitTypeName(tp), tp.id === keep)).join('');
  };
  const syncHolder = () => {
    if (!fixed) $$('[data-holder]', E).forEach(l => { l.hidden = l.dataset.holder !== kind; });
    fillTypes();
  };
  syncHolder();
  const hk = $('[name=holderKind]', E); if (hk) hk.onchange = () => { kind = hk.value; syncHolder(); };
  const ep = $('[name=empPick]', E); if (ep) ep.addEventListener('change', syncHolder);
  const vp = $('[name=vehPick]', E); if (vp) vp.addEventListener('change', syncHolder);
  const done = () => { m.close(); if (after) after(); };
  $('[data-save]', E).onclick = async ev => {
    const d = formValues(E), hid = pickedHolder();
    if (!hid) return openBlockAlert(t(kind === 'employee' ? 'اختار الموظف من القايمة' : 'اختار السيارة'));
    if (!d.typeId) return openBlockAlert(t('اختار نوع التصريح'));
    if (!d.expiryDate) return openBlockAlert(t('تاريخ الانتهاء مطلوب'));
    if (d.issueDate && d.issueDate > d.expiryDate) return openBlockAlert(t('تاريخ الإصدار بعد تاريخ الانتهاء'));
    const payload = { holderKind: kind, holderId: hid, typeId: d.typeId, permitNo: d.permitNo, issuer: d.issuer, projectId: d.projectId,
      issueDate: d.issueDate, expiryDate: d.expiryDate, notes: d.notes, placeIds: $$('[data-place]', E).filter(c => c.checked).map(c => c.dataset.place) };
    const fileInp = $('[name=file]', E), file = fileInp && fileInp.files[0];
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await api(p ? 'PUT' : 'POST', p ? '/api/permits/' + p.id : '/api/permits', payload);
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        try { await api('POST', `/api/permits/${r.id}/file`, fd); }
        catch (e) { toast(t('التصريح اتحفظ، لكن المرفق ماترفعش') + ': ' + e.message, 'err'); }
      }
      toast('تم الحفظ', 'ok');
      await reload();
      done();
    } catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); else toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  };
  if (!p) return;
  const reopen = () => { m.close(); if (after) after(); openPermitModal(p.id, null, after); };
  const fv = $('[data-file-view]', E); if (fv) fv.onclick = () => openFileViewer(p.fileUrl, p.fileName || t('مرفق التصريح'));
  const fu = $('[data-file-up]', E); if (fu) fu.onclick = async () => {
    const f = await pickFile('.pdf,image/*'); if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { await persist('POST', `/api/permits/${p.id}/file`, fd, 'تم رفع المرفق'); reopen(); } catch (_) { /* الرسالة ظهرت */ }
  };
  const fdl = $('[data-file-del]', E); if (fdl) fdl.onclick = async () => {
    if (!await openConfirm(t('حذف مرفق التصريح؟'), { danger: true })) return;
    try { await persist('DELETE', `/api/permits/${p.id}/file`, undefined, 'تم الحذف'); reopen(); } catch (_) { /* */ }
  };
  $('[data-permit-del]', E).onclick = async () => {
    if (!await openConfirm(`${t('حذف التصريح')} «${esc(permitLabel(p))}${p.permitNo ? ' ' + esc(p.permitNo) : ''}»؟`, { danger: true, okLabel: t('حذف') })) return;
    try { await persist('DELETE', '/api/permits/' + p.id, undefined, 'تم الحذف'); done(); } catch (_) { /* */ }
  };
}

/* ---------- شاشة التصاريح ---------- */
const PERMIT_UI_DEFAULT = { q: '', holder: '', type: '', place: '', project: '', agency: '', tier: '', ended: false };
/** كل التصاريح الظاهرة (صاحبها موجود وفي النطاق) */
function allPermits(F = {}) {
  return (STATE.permits || []).filter(p => {
    const h = permitHolder(p);
    if (!h) return false;
    if (p.holderKind === 'vehicle') return companyInScope(h.companyId) || !h.companyId;
    return F.ended || !empEnded(h);
  });
}
function permitsFiltered(F) {
  const q = norm(F.q);
  return allPermits(F).filter(p => (!F.holder || p.holderKind === F.holder) && (!F.type || p.typeId === F.type)
    && (!F.place || (F.place === '__none' ? !(p.placeIds || []).length : (p.placeIds || []).includes(F.place)))
    && (!F.project || (F.project === '__none' ? !p.projectId : p.projectId === F.project))
    && (!F.agency || (projectAgency(p.projectId) || {}).id === F.agency) && (!F.tier || tierIn(p.expiryDate, F.tier))
    && (!q || [permitHolderName(p), permitHolderSub(p), p.permitNo, p.issuer, permitLabel(p), permitPlacesText(p), projectName(p.projectId), p.notes]
      .some(v => norm(v).includes(q))));
}
function renderPermits() {
  const F = UI.permits = Object.assign({}, PERMIT_UI_DEFAULT, UI.permits || {});
  F.tier = tierFilterValue(F.tier);
  const kinds = Object.keys(PERMIT_HOLDERS).filter(k => permitCan(k, 'view'));
  if (F.holder && !kinds.includes(F.holder)) F.holder = '';
  const all = allPermits(F), list = permitsFiltered(F).sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
  const cnt = fn => all.filter(fn).length;
  const expired = cnt(p => tierOf(p.expiryDate) === 'expired'), soon = cnt(p => tierOf(p.expiryDate) === 'd30');
  const types = STATE.permitTypes || [], places = STATE.permitPlaces || [];
  const canAdd = kinds.some(k => permitCan(k, 'edit'));
  viewRoot().innerHTML = `<div class="page-head"><div><h1>${t('مركز التصاريح')}</h1>
      <div class="sub">${list.length} ${t('من')} ${all.length} ${t('تصريح')} · <span style="color:var(--red)">⛔ ${expired} ${t('منتهي')}</span> · <span style="color:var(--orange)">⏰ ${soon} ${t('خلال 30 يوم')}</span></div></div>
    <div class="actions">${canAdd ? `<button class="btn primary" id="pm-add">➕ ${t('إضافة تصريح')}</button>` : ''}
      <button class="btn" id="pm-print">🖨️ ${t('تقرير التصاريح')}</button>
      ${can('admin') ? `<button class="btn" id="pm-lists">⚙️ ${t('الأنواع والأماكن')}</button><button class="btn" id="pm-export">📤 ${t('تصدير CSV')}</button>` : ''}</div></div>
    ${!types.length ? `<div class="notice warn">${t('مفيش أنواع تصاريح — مدير النظام بيضيفها من «⚙️ الأنواع والأماكن».')}</div>` : ''}
    <div class="filters no-print"><input type="search" id="pm-q" placeholder="${esc(t('بحث بالاسم أو الرقم المدني أو اللوحة أو رقم التصريح…'))}" value="${esc(F.q)}">
      ${kinds.length > 1 ? `<select id="pm-holder">${opt('', t('— الموظفين والسيارات —'), !F.holder)}${kinds.map(k => opt(k, PERMIT_HOLDERS[k].ico + ' ' + t(k === 'employee' ? 'الموظفين' : 'السيارات'), k === F.holder)).join('')}</select>` : ''}
      <select id="pm-type">${opt('', t('— كل الأنواع —'), !F.type)}${types.map(tp => opt(tp.id, permitTypeName(tp), tp.id === F.type)).join('')}</select>
      <select id="pm-place">${opt('', t('— كل الأماكن —'), !F.place)}${opt('__none', t('بدون مكان'), F.place === '__none')}${places.map(pl => opt(pl.id, permitPlaceName(pl), pl.id === F.place)).join('')}</select>
      <select id="pm-proj">${opt('', t('— كل العقود والمشاريع —'), !F.project)}${opt('__none', t('بدون عقد / مشروع'), F.project === '__none')}${scopedProjects().slice().sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar')).map(p => opt(p.id, projectName(p.id), p.id === F.project)).join('')}</select>
      ${(STATE.agencies || []).length ? `<select id="pm-ag">${opt('', t('— كل الوكالات —'), !F.agency)}${STATE.agencies.map(a => opt(a.id, agencyName(a), a.id === F.agency)).join('')}</select>` : ''}
      <select id="pm-tier">${opt('', t('— كل المستويات —'), !F.tier)}${TIER_FILTERS.map(k => opt(k, t(TIERS[k].label), k === F.tier)).join('')}</select>
      <label class="chip clickable ${F.ended ? 'on' : ''}" title="${esc(t('تصاريح الموظفين اللي خدمتهم انتهت (مستقيل / إنهاء خدمات)'))}"><input type="checkbox" id="pm-ended" ${F.ended ? 'checked' : ''} hidden>${t('مع المنتهية خدمتهم')}</label>
      <button class="btn sm ghost" id="pm-clear">✕ ${t('مسح الفلاتر')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('صاحب التصريح')}</th><th>${t('النوع')}</th><th>${t('الرقم')}</th><th>${t('الجهة المانحة')}</th><th>${t('الأماكن')}</th>
      <th>${t('العقد / المشروع')}</th><th>${t('الإصدار')}</th><th>${t('الانتهاء')}</th><th></th></tr></thead>
    <tbody>${list.map(p => {
      const h = permitHolder(p), ended = p.holderKind === 'employee' && empEnded(h);
      return `<tr class="clickable" data-id="${p.id}"><td>${PERMIT_HOLDERS[p.holderKind].ico} <b>${esc(permitHolderName(p))}</b>${ended ? ` ${statusPill(h.employmentStatus)}` : ''}<div class="small muted num">${esc(permitHolderSub(p))}</div></td>
        <td>${esc(permitLabel(p))}</td><td class="num" dir="ltr" style="white-space:nowrap">${esc(p.permitNo || '')}</td><td>${esc(p.issuer || '')}</td><td>${permitPlaceChips(p)}</td>
        <td>${p.projectId ? `${esc(projectName(p.projectId))}<div class="small muted">${esc(projectSummary(IDX.project[p.projectId]))}</div>` : '<span class="muted">—</span>'}</td>
        <td>${fmtDate(p.issueDate)}</td><td>${datePill(p.expiryDate)}</td>
        <td>${p.fileUrl ? `<button class="btn sm" data-permit-file="${p.id}" title="${esc(t('عرض المرفق'))}">📎</button>` : ''}</td></tr>`;
    }).join('') || `<tr><td colspan="9" class="empty">${t('لا توجد تصاريح')}</td></tr>`}</tbody></table></div>`;
  const upd = patch => { Object.assign(UI.permits, patch); saveUiStateToLocalStorage(); render(); };
  $('#pm-q').addEventListener('input', debounce(e => { UI.permits.q = e.target.value; saveUiStateToLocalStorage(); render(); const i = $('#pm-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  [['#pm-holder', 'holder'], ['#pm-type', 'type'], ['#pm-place', 'place'], ['#pm-proj', 'project'], ['#pm-ag', 'agency'], ['#pm-tier', 'tier']]
    .forEach(([sel, k]) => { const el = $(sel); if (el) el.onchange = e => upd({ [k]: e.target.value }); });
  $('#pm-ended').onchange = e => upd({ ended: e.target.checked });
  $('#pm-clear').onclick = () => upd({ ...PERMIT_UI_DEFAULT });
  const add = $('#pm-add'); if (add) add.onclick = () => openPermitModal(null, null, null);
  $('#pm-print').onclick = () => openPermitsReportModal(list, F);
  const ls = $('#pm-lists'); if (ls) ls.onclick = () => openPermitListsModal('types');
  const ex = $('#pm-export'); if (ex) ex.onclick = () => exportGuard(`${t('التصاريح')} (${list.length})`, () => downloadBlob(toCsv([
    [t('صاحب التصريح'), t('النوع'), t('الرقم المدني / اللوحة'), t('نوع التصريح'), t('رقم التصريح'), t('الجهة المانحة'), t('الأماكن'), t('العقد / المشروع'), t('رقم العقد'), t('الوكالة'), t('تاريخ الإصدار'), t('تاريخ الانتهاء'), t('ملاحظات')],
    ...list.map(p => [permitHolderName(p), t(PERMIT_HOLDERS[p.holderKind].l), p.holderKind === 'employee' ? p.employeeId : (permitHolder(p) || {}).plate, permitLabel(p), p.permitNo, p.issuer,
      permitPlacesText(p), projectName(p.projectId), (IDX.project[p.projectId] || {}).contractNo, agencyName(projectAgency(p.projectId)), p.issueDate, p.expiryDate, p.notes])]), `permits-${todayISO()}.csv`, 'text/csv'));
  bindPermitList(viewRoot(), null);
  $$('tr[data-id]', viewRoot()).forEach(tr => tr.onclick = () => openPermitModal(tr.dataset.id, null, null));
}

/* ---------- تقرير التصاريح (عربي أو إنجليزي، مجمّع بالعقد / النوع / المكان …) ---------- */
function openPermitsReportModal(list, F) {
  const m = openModal({
    title: '🖨️ ' + t('تقرير التصاريح'), size: 'narrow',
    body: `<div class="form"><label class="full">${t('لغة التقرير')}<select name="lang">${opt('ar', 'العربية', LANG !== 'en')}${opt('en', 'English', LANG === 'en')}</select></label>
      <label class="full">${t('تجميع حسب')}<select name="group">${Object.entries(PERMIT_GROUPS).map(([k, l]) => opt(k, t(l), k === 'project')).join('')}</select></label></div>
      <div class="small muted" style="margin-top:6px">${list.length} ${t('تصريح')} — ${t('حسب الفلاتر اللي في الشاشة.')}</div>`,
    foot: `<button class="btn primary" data-go>🖨️ ${t('معاينة وطباعة')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-go]', m.el).onclick = () => {
    const lang = $('[name=lang]', m.el).value, group = $('[name=group]', m.el).value;
    m.close();
    withLang(lang, () => printPermitsReport(list, F, group));
  };
}
function permitGroupKeys(p, by) {
  if (by === 'project') return [[p.projectId || '', p.projectId ? projectName(p.projectId) + (IDX.project[p.projectId].contractNo ? ' · ' + IDX.project[p.projectId].contractNo : '') : t('بدون عقد / مشروع')]];
  if (by === 'type') return [[p.typeId, permitLabel(p)]];
  if (by === 'place') return (p.placeIds || []).length ? p.placeIds.map(x => [x, permitPlaceName(IDX.permitPlace[x])]) : [['', t('بدون مكان')]];
  if (by === 'holder') return [[p.holderKind, t(p.holderKind === 'employee' ? 'الموظفين' : 'السيارات')]];
  if (by === 'agency') { const a = projectAgency(p.projectId); return [[a ? a.id : '', a ? agencyName(a) : t('بدون وكالة')]]; }
  return [['', '']];
}
function printPermitsReport(list, F, groupBy) {
  const sep = LANG === 'en' ? ', ' : '، ';
  const crit = [];
  if (F.holder) crit.push(t(F.holder === 'employee' ? 'الموظفين' : 'السيارات'));
  if (F.type) crit.push(`${t('النوع')}: ${esc(permitTypeName(IDX.permitType[F.type]))}`);
  if (F.place) crit.push(`${t('المكان')}: ${esc(F.place === '__none' ? t('بدون مكان') : permitPlaceName(IDX.permitPlace[F.place]))}`);
  if (F.project) crit.push(`${t('العقد / المشروع')}: ${esc(F.project === '__none' ? t('بدون عقد / مشروع') : projectName(F.project))}`);
  if (F.agency) crit.push(`${t('الوكالة')}: ${esc(agencyName(agencyById(F.agency)))}`);
  if (F.tier) crit.push(t(TIERS[F.tier].label));
  if (F.ended) crit.push(t('مع المنتهية خدمتهم'));
  if (F.q) crit.push(`${t('بحث')}: ${esc(F.q)}`);
  const cols = [
    [t('صاحب التصريح'), p => esc(permitHolderName(p)), 'txt'], [t('الرقم المدني / اللوحة'), p => esc(p.holderKind === 'employee' ? p.employeeId : permitHolderSub(p)), 'num'],
    [t('النوع'), p => esc(permitLabel(p)), 'txt'], [t('رقم التصريح'), p => esc(p.permitNo || ''), 'num'], [t('الجهة المانحة'), p => esc(p.issuer || ''), 'txt'],
    [t('الأماكن'), p => esc(permitPlacesText(p)), 'txt'], ...(groupBy === 'project' ? [] : [[t('العقد / المشروع'), p => esc(projectName(p.projectId)), 'txt']]),
    [t('الإصدار'), p => fmtDate(p.issueDate), 'num'],
    [t('الانتهاء'), p => { const tr = tierOf(p.expiryDate); return `<span class="pill ${TIERS[tr] ? TIERS[tr].cls : ''}">${fmtDate(p.expiryDate)}</span>`; }, 'num'],
    [t('المتبقي'), p => esc(daysText(daysUntil(p.expiryDate))), 'num'],
  ];
  const sorted = list.slice().sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
  let z = 0, n = 0, body = '';
  const row = p => `<tr class="${z++ % 2 ? 'z' : ''}"><td class="idx">${++n}</td>${cols.map(([, fn, cls]) => `<td class="${cls}">${fn(p)}</td>`).join('')}</tr>`;
  if (groupBy) {
    const groups = new Map();
    sorted.forEach(p => permitGroupKeys(p, groupBy).forEach(([k, l]) => { if (!groups.has(k)) groups.set(k, { l, rows: [] }); groups.get(k).rows.push(p); }));
    [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || String(a.l).localeCompare(String(b.l), 'ar')).forEach(g => {
      z = 0;
      body += `<tr class="grp"><td colspan="${cols.length + 1}">${esc(g.l)}<small>${g.rows.length} ${t('تصريح')}</small></td></tr>` + g.rows.map(row).join('');
    });
  } else body = sorted.map(row).join('');
  const table = `<table class="rpt"><thead><tr><th>#</th>${cols.map(([l, , cls]) => `<th class="${cls === 'txt' ? 'txt' : ''}">${esc(l)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    ${groupBy === 'place' ? `<div class="small" style="margin-top:4px;color:#66736f">${t('التصريح اللي بيغطي أكتر من مكان بيظهر تحت كل مكان.')}</div>` : ''}`;
  const tierN = k => list.filter(p => tierOf(p.expiryDate) === k).length;
  openReportWindow({
    title: t('تقرير التصاريح'), subtitle: groupBy ? `${t('تجميع حسب')}: ${t(PERMIT_GROUPS[groupBy])}` : '', landscape: true, criteria: crit.join(' · '),
    summary: [[list.length, t('تصريح')], [list.filter(p => p.holderKind === 'employee').length, t('للموظفين')], [list.filter(p => p.holderKind === 'vehicle').length, t('للسيارات')],
      [tierN('expired'), t('منتهي')], [tierN('d30'), t('خلال 30 يوم')]],
    body: table, meta: [[t('عدد السجلات'), String(list.length)]],
  });
  printLog(t('تقرير التصاريح'), 'employee');
}

/* ---------- أنواع وأماكن التصاريح (مدير النظام) ---------- */
function openPermitListsModal(tab) {
  const permits = STATE.permits || [];
  const types = STATE.permitTypes || [], places = STATE.permitPlaces || [];
  const used = (kind, id) => kind === 'types' ? permits.filter(p => p.typeId === id).length : permits.filter(p => (p.placeIds || []).includes(id)).length;
  const table = (kind, rows) => `<table class="data"><thead><tr><th>${t('الاسم (عربي)')}</th><th>${t('الاسم (إنجليزي)')}</th>${kind === 'types' ? `<th>${t('لمين')}</th>` : ''}<th>${t('التصاريح')}</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.nameAr)}</b></td><td dir="ltr">${esc(r.nameEn || '')}</td>${kind === 'types' ? `<td>${esc(t(PERMIT_APPLIES[r.appliesTo || '']))}</td>` : ''}<td class="num">${used(kind, r.id)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-edit="${kind}:${r.id}">✏️</button> <button class="btn sm danger" data-del="${kind}:${r.id}">🗑️</button></td></tr>`).join('')
      || `<tr><td colspan="5" class="empty">${t('القايمة فاضية')}</td></tr>`}</tbody></table>
    <button class="btn" data-add="${kind}" style="margin-top:8px">➕ ${t(kind === 'types' ? 'إضافة نوع' : 'إضافة مكان')}</button>`;
  const m = openModal({
    title: '⚙️ ' + t('أنواع وأماكن التصاريح'), size: 'wide',
    body: `<div class="tabs"><button data-tab="types" class="${tab === 'types' ? 'active' : ''}">${t('الأنواع')} (${types.length})</button><button data-tab="places" class="${tab === 'places' ? 'active' : ''}">${t('الأماكن')} (${places.length})</button></div>
      <div data-pane="types" ${tab !== 'types' ? 'hidden' : ''}>${table('types', types)}</div><div data-pane="places" ${tab !== 'places' ? 'hidden' : ''}>${table('places', places)}</div>
      <div class="small muted" style="margin-top:8px">${t('النوع أو المكان اللي عليه تصاريح مايتحذفش — عدّل اسمه بس.')}</div>`,
    foot: `<button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  let cur = tab;
  $$('[data-tab]', m.el).forEach(b => b.onclick = () => { cur = b.dataset.tab; $$('[data-tab]', m.el).forEach(x => x.classList.toggle('active', x === b)); $$('[data-pane]', m.el).forEach(p => p.hidden = p.dataset.pane !== cur); });
  const again = () => { m.close(); openPermitListsModal(cur); };
  $$('[data-add]', m.el).forEach(b => b.onclick = () => openPermitListItemModal(b.dataset.add, null, again));
  $$('[data-edit]', m.el).forEach(b => b.onclick = () => { const [k, id] = b.dataset.edit.split(':'); openPermitListItemModal(k, id, again); });
  $$('[data-del]', m.el).forEach(b => b.onclick = async () => {
    const [k, id] = b.dataset.del.split(':');
    const r = (k === 'types' ? types : places).find(x => x.id === id);
    if (!await openConfirm(`${t('حذف')} «${esc(r ? r.nameAr : '')}»؟`, { danger: true, okLabel: t('حذف') })) return;
    try { await persist('DELETE', `/api/${k === 'types' ? 'permit-types' : 'permit-places'}/${id}`, undefined, 'تم الحذف'); again(); }
    catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); }
  });
}
function openPermitListItemModal(kind, id, after) {
  const r = id ? (kind === 'types' ? STATE.permitTypes : STATE.permitPlaces).find(x => x.id === id) || {} : {};
  const m = openModal({
    title: t(id ? (kind === 'types' ? 'تعديل نوع تصريح' : 'تعديل مكان') : (kind === 'types' ? 'إضافة نوع تصريح' : 'إضافة مكان')), size: 'narrow',
    body: `<div class="form"><label class="full"><span class="req">${t('الاسم (عربي)')}</span><input name="nameAr" value="${esc(r.nameAr || '')}"></label>
      <label class="full">${t('الاسم (إنجليزي)')}<input name="nameEn" dir="ltr" value="${esc(r.nameEn || '')}"></label>
      ${kind === 'types' ? `<label class="full">${t('لمين')}<select name="appliesTo">${Object.entries(PERMIT_APPLIES).map(([k, l]) => opt(k, t(l), k === (r.appliesTo || ''))).join('')}</select></label>` : ''}</div>`,
    foot: `<button class="btn primary" data-save>${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[name=nameAr]', m.el).focus();
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (!d.nameAr) return openBlockAlert(t('الاسم مطلوب'));
    const base = kind === 'types' ? '/api/permit-types' : '/api/permit-places';
    try { await persist(id ? 'PUT' : 'POST', id ? `${base}/${id}` : base, d, 'تم الحفظ'); m.close(); if (after) after(); }
    catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); }
  };
}
