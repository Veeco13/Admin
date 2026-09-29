/* =====================================================================
   PERMITS — قسم التصاريح (القسم 24)
   قسم مستقل بصلاحية لوحده (permits.*): قايمة «تصاريح الموظفين» وقايمة «تصاريح السيارات».
   بيانات الموظف / العربية بتيجي من مركز الإقامات والموظفين ومركز السيارات (STATE.permitHolders) للعرض بس.
   العقد / المشروع اختياري (ممكن التصريح يطلع على مشروع ويشتغل بيه صاحبه في مشروع تاني).
   الأنواع والأماكن قايمتين بيتحكم فيهم مدير النظام.
   ===================================================================== */
const PERMIT_HOLDERS = {
  employee: { l: 'موظف', ico: '👤', tab: 'تصاريح الموظفين', report: 'تقرير تصاريح الموظفين', csv: 'employee-permits' },
  vehicle:  { l: 'سيارة', ico: '🚗', tab: 'تصاريح السيارات', report: 'تقرير تصاريح السيارات', csv: 'vehicle-permits' },
};
const PERMIT_APPLIES = { '': 'الموظفين والسيارات', employee: 'الموظفين بس', vehicle: 'السيارات بس' };
const PERMIT_GROUPS = { '': 'بدون تجميع', type: 'النوع', place: 'المكان', company: 'الشركة', issuer: 'الجهة المانحة' };
const PERMIT_FILTER_DEFAULT = { q: '', type: '', place: '', company: '', tier: '', status: '', ended: false };
// ملخص فوق كل قايمة (بالضغط بيفلتر)
const PERMIT_STATUS = {
  valid:   { l: 'ساري',          test: d => d !== null && d >= 0 },
  expired: { l: 'منتهي',         test: d => d !== null && d < 0 },
  soon:    { l: 'خلال 30 يوم',   test: d => d !== null && d >= 0 && d <= 30 },
};

function permitTypeName(tp) { return tp ? (LANG === 'en' && tp.nameEn ? tp.nameEn : tp.nameAr) : ''; }
function permitPlaceName(pl) { return pl ? (LANG === 'en' && pl.nameEn ? pl.nameEn : pl.nameAr) : ''; }
function permitsOf(kind, id) { return (IDX.permitsOf && IDX.permitsOf[kind] && IDX.permitsOf[kind][id]) || []; }
/** ساري = لسه ماانتهاش */
function permitValid(p) { const d = daysUntil(p.expiryDate); return d !== null && d >= 0; }
function permitLabel(p) { return permitTypeName(IDX.permitType[p.typeId]) || t('تصريح'); }
function permitPlacesText(p) { return (p.placeIds || []).map(x => permitPlaceName(IDX.permitPlace[x])).filter(Boolean).join(LANG === 'en' ? ', ' : '، '); }
function permitPlaceChips(p) { return (p.placeIds || []).map(x => `<span class="chip">${esc(permitPlaceName(IDX.permitPlace[x]))}</span>`).join(' ') || '<span class="muted">—</span>'; }
function permitHolderId(p) { return p.holderKind === 'employee' ? p.employeeId : p.vehicleId; }
/** صاحب التصريح (بياناته من مركز الموظفين / السيارات) */
function holderOf(kind, id) { return ((IDX.permitHolder || {})[kind] || {})[id] || null; }
function permitHolder(p) { return holderOf(p.holderKind, permitHolderId(p)); }
function holderName(kind, h) { return !h ? '' : kind === 'employee' ? (LANG === 'en' && h.nameEn ? h.nameEn : h.name) : h.plate; }
function permitHolderName(p) { return holderName(p.holderKind, permitHolder(p)); }
function holderDriver(h) { return LANG === 'en' && h.driverNameEn ? h.driverNameEn : h.driverName || ''; }
function permitTypesFor(kind) { return (STATE.permitTypes || []).filter(tp => !tp.appliesTo || tp.appliesTo === kind); }
function permitProjectOptions(sel) {
  return opt('', t('— بدون —'), !sel) + scopedProjects().slice().sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar'))
    .map(p => opt(p.id, projectName(p.id) + (p.contractNo ? ' · ' + p.contractNo : ''), p.id === sel)).join('');
}
/** كارت بيانات صاحب التصريح — للعرض بس (بيتعدّل من مركزه) */
function holderCardHtml(kind, h) {
  if (!h) return '';
  const f = (l, v) => `<div><span>${esc(t(l))}</span>${v || '<span class="muted">—</span>'}</div>`;
  const body = kind === 'employee'
    ? f('الاسم', `<b>${esc(h.name)}</b>${h.nameEn ? `<div class="small muted" dir="ltr">${esc(h.nameEn)}</div>` : ''}`) + f('الرقم المدني', `<span class="num">${esc(h.id)}</span>`)
      + f('الجنسية', esc(personNat(h))) + f('المهنة', esc(personProf(h))) + f('الشركة', esc(companyName(h.companyId)))
      + f('مركز التكلفة', esc(ccLabel(h.costCenter))) + f('رقم الملف', esc(h.fileNo || '')) + f('الحالة الوظيفية', statusPill(h.employmentStatus))
    : f('رقم اللوحة', `<b class="num">${esc(h.plate)}</b>`) + f('نوع المركبة', esc(t(VEHICLE_TYPES[h.vehicleType] || ''))) + f('الموديل', esc(h.model || ''))
      + f('الشركة', esc(companyName(h.companyId)) + (h.ownerCompanyId && h.ownerCompanyId !== h.companyId ? `<div class="small muted">🔑 ${t('المالك الفعلي')}: ${esc(companyName(h.ownerCompanyId))}</div>` : ''))
      + f('مركز التكلفة', esc(ccLabel(h.costCenter))) + f('السائق', esc(holderDriver(h)));
  return `<div class="kv">${body}</div>
    <div class="small muted" style="margin-top:4px">ℹ️ ${t(kind === 'employee' ? 'البيانات من مركز الإقامات والموظفين — للعرض بس' : 'البيانات من مركز السيارات — للعرض بس')}</div>`;
}

/* ---------- إضافة / تعديل تصريح ---------- */
function openPermitModal(id, kind0) {
  const p = id ? (STATE.permits || []).find(x => x.id === id) : null;
  if (id && !p) return toast('التصريح غير موجود', 'err');
  const kind = p ? p.holderKind : kind0 || 'employee';
  const x = p || {};
  const hs = (STATE.permitHolders || {})[kind === 'employee' ? 'employees' : 'vehicles'] || [];
  const pickList = kind === 'employee' ? hs.filter(e => !empEnded(e)) : hs;
  const issuers = uniq((STATE.permits || []).map(q => q.issuer).filter(Boolean)).sort((a, b) => a.localeCompare(b, 'ar'));
  const places = STATE.permitPlaces || [];
  const types = permitTypesFor(kind);
  const picker = p ? '' : kind === 'employee'
    ? `<div class="form"><label class="full"><span class="req">${t('الموظف')}</span><input name="holderPick" list="dl-permit-holder" placeholder="${esc(t('اكتب الاسم أو الرقم المدني أو رقم الملف واختار من القايمة'))}" autocomplete="off">
        <datalist id="dl-permit-holder">${pickList.map(e => `<option value="${esc(`${e.id} — ${e.name}${e.fileNo ? ' — ' + t('ملف') + ' ' + e.fileNo : ''}`)}">`).join('')}</datalist></label></div>`
    : `<div class="form"><label class="full"><span class="req">${t('السيارة')}</span><select name="holderPick">${opt('', t('— اختار السيارة —'), true)}${pickList.map(v => opt(v.id, `${v.plate}${v.model ? ' — ' + v.model : ''}${v.companyId ? ' — ' + companyName(v.companyId) : ''}`, false)).join('')}</select></label></div>`;
  const m = openModal({
    title: `${PERMIT_HOLDERS[kind].ico} ${t(p ? 'تعديل تصريح' : 'إضافة تصريح')} — ${t(PERMIT_HOLDERS[kind].l)}`, size: 'wide',
    body: `${picker}<div id="permit-holder" style="margin:8px 0 12px">${p ? holderCardHtml(kind, permitHolder(p)) : ''}</div>
      <div class="form">
        <label><span class="req">${t('نوع التصريح')}</span><select name="typeId">${opt('', types.length ? t('— اختار النوع —') : t('مفيش أنواع — مدير النظام بيضيفها'), !x.typeId)}${types.map(tp => opt(tp.id, permitTypeName(tp), tp.id === x.typeId)).join('')}</select></label>
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
              <span class="write-only" data-p="permits.edit"><button type="button" class="btn sm" data-file-up>⬆️ ${p.fileUrl ? t('تغيير المرفق') : t('رفع مرفق')}</button>
              ${p.fileUrl ? `<button type="button" class="btn sm danger" data-file-del>🗑️</button>` : ''}</span></div>`
            : `<input type="file" name="file" accept=".pdf,image/*">`}</div>
      </div>
      ${p ? `<div class="small muted" style="margin-top:8px">${t('آخر تعديل')}: ${fmtDateTime(p.updatedAt)} ${esc(p.updatedBy || '')}</div>` : ''}`,
    foot: `${p ? `<button class="btn danger write-only" data-p="permits.delete" data-permit-del>🗑️ ${t('حذف')}</button><span class="spacer"></span>` : ''}
      <button class="btn primary write-only" data-p="permits.edit" data-save>${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const pickedHolder = () => {
    if (p) return permitHolderId(p);
    const v = ($('[name=holderPick]', E).value || '').trim();
    const hid = kind === 'employee' ? v.split(' — ')[0].trim() : v;
    return holderOf(kind, hid) ? hid : '';
  };
  const pick = $('[name=holderPick]', E);
  if (pick) {
    const show = () => { const hid = pickedHolder(); $('#permit-holder', E).innerHTML = hid ? holderCardHtml(kind, holderOf(kind, hid)) : ''; };
    pick.addEventListener('change', show);
    pick.addEventListener('input', show);
    pick.focus();
  }
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
      m.close();
      await reload();
    } catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); else toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  };
  if (!p) return;
  const reopen = () => { m.close(); openPermitModal(p.id); };
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
    if (!await openConfirm(`${t('حذف التصريح')} «${esc(permitLabel(p))}${p.permitNo ? ' ' + esc(p.permitNo) : ''}» — ${esc(permitHolderName(p))}؟`, { danger: true, okLabel: t('حذف') })) return;
    try { m.close(); await persist('DELETE', '/api/permits/' + p.id, undefined, 'تم الحذف'); } catch (_) { /* */ }
  };
}

/* ---------- قسم التصاريح: قايمتين (الموظفين / السيارات) ---------- */
/** تصاريح نوع واحد (صاحبها ظاهر للمستخدم). الموظفين اللي خدمتهم انتهت مخفيين إلا لو withEnded */
function allPermits(kind, withEnded) {
  return (STATE.permits || []).filter(p => {
    if (p.holderKind !== kind) return false;
    const h = permitHolder(p);
    return !!h && (kind !== 'employee' || withEnded || !empEnded(h));
  });
}
function permitsFiltered(kind, F) {
  const q = norm(F.q);
  return allPermits(kind, F.ended).filter(p => {
    const h = permitHolder(p), d = daysUntil(p.expiryDate);
    if (F.type && p.typeId !== F.type) return false;
    if (F.place && !(F.place === '__none' ? !(p.placeIds || []).length : (p.placeIds || []).includes(F.place))) return false;
    if (F.company && h.companyId !== F.company) return false;
    if (F.tier && !tierIn(p.expiryDate, F.tier)) return false;
    if (F.status && !PERMIT_STATUS[F.status].test(d)) return false;
    if (!q) return true;
    const hay = kind === 'employee' ? [h.name, h.nameEn, h.id, h.fileNo, h.nationality, h.profession, h.costCenter] : [h.plate, h.model, h.driverName, h.costCenter];
    return [...hay, companyName(h.companyId), p.permitNo, p.issuer, permitLabel(p), permitPlacesText(p), p.notes].some(v => norm(v).includes(q));
  }).sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
}
function permitRowHtml(kind, p) {
  const h = permitHolder(p);
  const holderCells = kind === 'employee'
    ? `<td><b>${esc(holderName(kind, h))}</b>${empEnded(h) ? ' ' + statusPill(h.employmentStatus) : ''}<div class="small muted num">${esc(h.id)}</div></td>
       <td>${esc(personNat(h))}<div class="small muted">${esc(personProf(h))}</div></td>
       <td>${esc(companyName(h.companyId))}<div class="small muted">${esc(ccLabel(h.costCenter))}</div></td>`
    : `<td><b class="num">${esc(h.plate)}</b><div class="small muted">${esc([t(VEHICLE_TYPES[h.vehicleType] || ''), h.model].filter(Boolean).join(' · '))}</div></td>
       <td>${esc(companyName(h.companyId))}<div class="small muted">${esc(ccLabel(h.costCenter))}</div></td>
       <td>${esc(holderDriver(h)) || '<span class="muted">—</span>'}</td>`;
  return `<tr class="clickable" data-id="${p.id}">${holderCells}<td>${esc(permitLabel(p))}</td><td class="num" dir="ltr" style="white-space:nowrap">${esc(p.permitNo || '')}</td>
    <td>${esc(p.issuer || '')}</td><td>${permitPlaceChips(p)}</td><td>${fmtDate(p.issueDate)}</td><td>${datePill(p.expiryDate)}</td>
    <td>${p.fileUrl ? `<button class="btn sm" data-permit-file="${p.id}" title="${esc(t('عرض المرفق'))}">📎</button>` : ''}</td></tr>`;
}
function renderPermits() {
  const U = UI.permits = Object.assign({ tab: 'employee' }, UI.permits || {});
  const focus = VIEW_ARGS && VIEW_ARGS.focusPermit ? (STATE.permits || []).find(p => p.id === VIEW_ARGS.focusPermit) : null;
  if (VIEW_ARGS) VIEW_ARGS.focusPermit = null;
  if (focus) U.tab = focus.holderKind;
  if (!PERMIT_HOLDERS[U.tab]) U.tab = 'employee';
  const kind = U.tab;
  const F = U[kind] = Object.assign({}, PERMIT_FILTER_DEFAULT, U[kind] || {});
  F.tier = tierFilterValue(F.tier);
  if (F.status && !PERMIT_STATUS[F.status]) F.status = '';
  const all = allPermits(kind, F.ended), list = permitsFiltered(kind, F);
  const types = permitTypesFor(kind), places = STATE.permitPlaces || [];
  const cos = uniq(all.map(p => permitHolder(p).companyId)).filter(c => IDX.company[c]).sort((a, b) => companyName(a).localeCompare(companyName(b), 'ar'));
  const cnt = st => all.filter(p => PERMIT_STATUS[st].test(daysUntil(p.expiryDate))).length;
  const chip = (st, label, n, color) => `<span class="chip clickable ${F.status === st ? 'on' : ''}" data-status="${st}"${color ? ` style="color:${color}"` : ''}>${esc(t(label))} <b class="num">${n}</b></span>`;
  const heads = kind === 'employee' ? ['الموظف', 'الجنسية / المهنة', 'الشركة / مكان الشغل'] : ['اللوحة', 'الشركة / مكان الشغل', 'السائق'];
  viewRoot().innerHTML = `<div class="page-head"><div><h1>🪪 ${t('التصاريح')}</h1>
      <div class="sub">${t('قسم مستقل — بيانات الموظفين والسيارات بتيجي من مراكزها للعرض بس')}</div></div>
    <div class="actions"><button class="btn primary write-only" data-p="permits.edit" id="pm-add">➕ ${t('إضافة تصريح')} — ${t(PERMIT_HOLDERS[kind].l)}</button>
      <button class="btn" id="pm-print">🖨️ ${t(PERMIT_HOLDERS[kind].report)}</button>
      ${can('admin') ? `<button class="btn" id="pm-lists">⚙️ ${t('الأنواع والأماكن')}</button><button class="btn" id="pm-export">📤 ${t('تصدير CSV')}</button>` : ''}</div></div>
    <div class="tabs" style="margin-bottom:10px">${Object.entries(PERMIT_HOLDERS).map(([k, v]) =>
      `<button data-ptab="${k}" class="${k === kind ? 'active' : ''}">${v.ico} ${t(v.tab)} (${allPermits(k, false).length})</button>`).join('')}</div>
    ${!types.length ? `<div class="notice warn">${t('مفيش أنواع تصاريح — مدير النظام بيضيفها من «⚙️ الأنواع والأماكن».')}</div>` : ''}
    <div class="row no-print" style="gap:6px;margin:0 0 8px;flex-wrap:wrap">${chip('', 'الإجمالي', all.length)}${chip('valid', 'ساري', cnt('valid'), 'var(--green)')}
      ${chip('expired', 'منتهي', cnt('expired'), 'var(--red)')}${chip('soon', 'خلال 30 يوم', cnt('soon'), 'var(--orange)')}</div>
    <div class="filters no-print"><input type="search" id="pm-q" placeholder="${esc(t(kind === 'employee' ? 'بحث بالاسم أو الرقم المدني أو رقم الملف أو رقم التصريح…' : 'بحث باللوحة أو السائق أو رقم التصريح…'))}" value="${esc(F.q)}">
      <select id="pm-type">${opt('', t('— كل الأنواع —'), !F.type)}${types.map(tp => opt(tp.id, permitTypeName(tp), tp.id === F.type)).join('')}</select>
      <select id="pm-place">${opt('', t('— كل الأماكن —'), !F.place)}${opt('__none', t('بدون مكان'), F.place === '__none')}${places.map(pl => opt(pl.id, permitPlaceName(pl), pl.id === F.place)).join('')}</select>
      <select id="pm-co">${opt('', t('— كل الشركات —'), !F.company)}${cos.map(c => opt(c, companyName(c), c === F.company)).join('')}</select>
      <select id="pm-tier">${opt('', t('— كل المستويات —'), !F.tier)}${TIER_FILTERS.map(k => opt(k, t(TIERS[k].label), k === F.tier)).join('')}</select>
      ${kind === 'employee' ? `<label class="chip clickable ${F.ended ? 'on' : ''}" title="${esc(t('تصاريح الموظفين اللي خدمتهم انتهت (مستقيل / إنهاء خدمات)'))}"><input type="checkbox" id="pm-ended" ${F.ended ? 'checked' : ''} hidden>${t('مع المنتهية خدمتهم')}</label>` : ''}
      <button class="btn sm ghost" id="pm-clear">✕ ${t('مسح الفلاتر')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr>${heads.map(h => `<th>${t(h)}</th>`).join('')}<th>${t('نوع التصريح')}</th><th>${t('الرقم')}</th><th>${t('الجهة المانحة')}</th>
      <th>${t('الأماكن')}</th><th>${t('الإصدار')}</th><th>${t('الانتهاء')}</th><th></th></tr></thead>
    <tbody>${list.map(p => permitRowHtml(kind, p)).join('') || `<tr><td colspan="10" class="empty">${t('لا توجد تصاريح')}</td></tr>`}</tbody></table></div>
    <div class="small muted" style="margin-top:6px">${list.length} ${t('من')} ${all.length} ${t('تصريح')}</div>`;
  const upd = patch => { Object.assign(UI.permits[kind], patch); saveUiStateToLocalStorage(); render(); };
  $$('[data-ptab]', viewRoot()).forEach(b => b.onclick = () => { UI.permits.tab = b.dataset.ptab; saveUiStateToLocalStorage(); render(); });
  $$('[data-status]', viewRoot()).forEach(c => c.onclick = () => upd({ status: F.status === c.dataset.status ? '' : c.dataset.status }));
  $('#pm-q').addEventListener('input', debounce(e => { UI.permits[kind].q = e.target.value; saveUiStateToLocalStorage(); render(); const i = $('#pm-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  [['#pm-type', 'type'], ['#pm-place', 'place'], ['#pm-co', 'company'], ['#pm-tier', 'tier']].forEach(([sel, k]) => { $(sel).onchange = e => upd({ [k]: e.target.value }); });
  const en = $('#pm-ended'); if (en) en.onchange = e => upd({ ended: e.target.checked });
  $('#pm-clear').onclick = () => upd({ ...PERMIT_FILTER_DEFAULT });
  $('#pm-add').onclick = () => openPermitModal(null, kind);
  $('#pm-print').onclick = () => openPermitsReportModal(kind, list, F);
  const ls = $('#pm-lists'); if (ls) ls.onclick = () => openPermitListsModal('types');
  const ex = $('#pm-export'); if (ex) ex.onclick = () => exportGuard(`${t(PERMIT_HOLDERS[kind].tab)} (${list.length})`, () => downloadBlob(toCsv(permitsCsvRows(kind, list)), `${PERMIT_HOLDERS[kind].csv}-${todayISO()}.csv`, 'text/csv'));
  $$('[data-permit-file]', viewRoot()).forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const p = (STATE.permits || []).find(x => x.id === b.dataset.permitFile);
    if (p && p.fileUrl) openFileViewer(p.fileUrl, p.fileName || t('مرفق التصريح'));
  });
  $$('tr[data-id]', viewRoot()).forEach(tr => tr.onclick = () => openPermitModal(tr.dataset.id));
  if (focus) setTimeout(() => openPermitModal(focus.id), 30);      // جاي من مركز التنبيهات
}
function permitsCsvRows(kind, list) {
  const tail = [t('نوع التصريح'), t('رقم التصريح'), t('الجهة المانحة'), t('الأماكن'), t('العقد / المشروع'), t('تاريخ الإصدار'), t('تاريخ الانتهاء'), t('ملاحظات')];
  const tailOf = p => [permitLabel(p), p.permitNo, p.issuer, permitPlacesText(p), projectName(p.projectId), p.issueDate, p.expiryDate, p.notes];
  if (kind === 'employee') return [[t('الموظف'), t('الاسم (إنجليزي)'), t('الرقم المدني'), t('الجنسية'), t('المهنة'), t('الشركة'), t('مركز التكلفة'), ...tail],
    ...list.map(p => { const h = permitHolder(p); return [h.name, h.nameEn, h.id, personNat(h), personProf(h), companyName(h.companyId), h.costCenter, ...tailOf(p)]; })];
  return [[t('رقم اللوحة'), t('نوع المركبة'), t('الموديل'), t('الشركة'), t('مركز التكلفة'), t('السائق'), ...tail],
    ...list.map(p => { const h = permitHolder(p); return [h.plate, t(VEHICLE_TYPES[h.vehicleType] || ''), h.model, companyName(h.companyId), h.costCenter, holderDriver(h), ...tailOf(p)]; })];
}

/* ---------- تقرير التصاريح (لكل قايمة لوحدها — عربي أو إنجليزي) ---------- */
function openPermitsReportModal(kind, list, F) {
  const m = openModal({
    title: '🖨️ ' + t(PERMIT_HOLDERS[kind].report), size: 'narrow',
    body: `<div class="form"><label class="full">${t('لغة التقرير')}<select name="lang">${opt('ar', 'العربية', LANG !== 'en')}${opt('en', 'English', LANG === 'en')}</select></label>
      <label class="full">${t('تجميع حسب')}<select name="group">${Object.entries(PERMIT_GROUPS).map(([k, l]) => opt(k, t(l), k === '')).join('')}</select></label></div>
      <div class="small muted" style="margin-top:6px">${list.length} ${t('تصريح')} — ${t('حسب الفلاتر اللي في الشاشة.')}</div>`,
    foot: `<button class="btn primary" data-go>🖨️ ${t('معاينة وطباعة')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-go]', m.el).onclick = () => {
    const lang = $('[name=lang]', m.el).value, group = $('[name=group]', m.el).value;
    m.close();
    withLang(lang, () => printPermitsReport(kind, list, F, group));
  };
}
function permitGroupKeys(p, by) {
  if (by === 'type') return [[p.typeId, permitLabel(p)]];
  if (by === 'place') return (p.placeIds || []).length ? p.placeIds.map(x => [x, permitPlaceName(IDX.permitPlace[x])]) : [['', t('بدون مكان')]];
  if (by === 'company') { const c = permitHolder(p).companyId; return [[c || '', companyName(c) || t('بدون شركة')]]; }
  if (by === 'issuer') return [[p.issuer || '', p.issuer || t('بدون جهة')]];
  return [['', '']];
}
function printPermitsReport(kind, list, F, groupBy) {
  const crit = [];
  if (F.status) crit.push(t(PERMIT_STATUS[F.status].l));
  if (F.type) crit.push(`${t('النوع')}: ${esc(permitTypeName(IDX.permitType[F.type]))}`);
  if (F.place) crit.push(`${t('المكان')}: ${esc(F.place === '__none' ? t('بدون مكان') : permitPlaceName(IDX.permitPlace[F.place]))}`);
  if (F.company) crit.push(`${t('الشركة')}: ${esc(companyName(F.company))}`);
  if (F.tier) crit.push(t(TIERS[F.tier].label));
  if (F.ended) crit.push(t('مع المنتهية خدمتهم'));
  if (F.q) crit.push(`${t('بحث')}: ${esc(F.q)}`);
  const H = p => permitHolder(p);
  const holderCols = kind === 'employee'
    ? [[t('الموظف'), p => esc(holderName(kind, H(p))), 'txt'], [t('الرقم المدني'), p => esc(H(p).id), 'num'], [t('الجنسية'), p => esc(personNat(H(p))), 'txt'],
       ...(groupBy === 'company' ? [] : [[t('الشركة'), p => esc(companyName(H(p).companyId)), 'txt']])]
    : [[t('رقم اللوحة'), p => esc(H(p).plate), 'num'], [t('نوع المركبة'), p => esc(t(VEHICLE_TYPES[H(p).vehicleType] || '')), 'txt'],
       ...(groupBy === 'company' ? [] : [[t('الشركة'), p => esc(companyName(H(p).companyId)), 'txt']]), [t('السائق'), p => esc(holderDriver(H(p))), 'txt']];
  const cols = [...holderCols,
    ...(groupBy === 'type' ? [] : [[t('نوع التصريح'), p => esc(permitLabel(p)), 'txt']]), [t('رقم التصريح'), p => esc(p.permitNo || ''), 'num'],
    ...(groupBy === 'issuer' ? [] : [[t('الجهة المانحة'), p => esc(p.issuer || ''), 'txt']]), [t('الأماكن'), p => esc(permitPlacesText(p)), 'txt'],
    [t('الإصدار'), p => fmtDate(p.issueDate), 'num'],
    [t('الانتهاء'), p => { const tr = tierOf(p.expiryDate); return `<span class="pill ${TIERS[tr] ? TIERS[tr].cls : ''}">${fmtDate(p.expiryDate)}</span>`; }, 'num'],
    [t('المتبقي'), p => esc(daysText(daysUntil(p.expiryDate))), 'num'],
  ];
  let z = 0, n = 0, body = '';
  const row = p => `<tr class="${z++ % 2 ? 'z' : ''}"><td class="idx">${++n}</td>${cols.map(([, fn, cls]) => `<td class="${cls}">${fn(p)}</td>`).join('')}</tr>`;
  if (groupBy) {
    const groups = new Map();
    list.forEach(p => permitGroupKeys(p, groupBy).forEach(([k, l]) => { if (!groups.has(k)) groups.set(k, { l, rows: [] }); groups.get(k).rows.push(p); }));
    [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || String(a.l).localeCompare(String(b.l), 'ar')).forEach(g => {
      z = 0;
      body += `<tr class="grp"><td colspan="${cols.length + 1}">${esc(g.l)}<small>${g.rows.length} ${t('تصريح')}</small></td></tr>` + g.rows.map(row).join('');
    });
  } else body = list.map(row).join('');
  const table = `<table class="rpt"><thead><tr><th>#</th>${cols.map(([l, , cls]) => `<th class="${cls === 'txt' ? 'txt' : ''}">${esc(l)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    ${groupBy === 'place' ? `<div class="small" style="margin-top:4px;color:#66736f">${t('التصريح اللي بيغطي أكتر من مكان بيظهر تحت كل مكان.')}</div>` : ''}`;
  const n2 = st => list.filter(p => PERMIT_STATUS[st].test(daysUntil(p.expiryDate))).length;
  const cos = uniq(list.map(p => H(p).companyId));
  openReportWindow({
    title: t(PERMIT_HOLDERS[kind].report), subtitle: groupBy ? `${t('تجميع حسب')}: ${t(PERMIT_GROUPS[groupBy])}` : '', landscape: true, criteria: crit.join(' · '),
    company: (F.company && IDX.company[F.company]) || (cos.length === 1 ? IDX.company[cos[0]] : null),
    summary: [[list.length, t('تصريح')], [n2('valid'), t('ساري')], [n2('expired'), t('منتهي')], [n2('soon'), t('خلال 30 يوم')]],
    body: table, meta: [[t('عدد السجلات'), String(list.length)]],
  });
  printLog(t(PERMIT_HOLDERS[kind].report), 'permit');
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
