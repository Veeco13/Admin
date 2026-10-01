/* =====================================================================
   PERMITS — قسم التصاريح (القسم 24)
   قسم مستقل بصلاحية لوحده (permits.*): قايمة «تصاريح الموظفين» وقايمة «تصاريح السيارات»، وكل قايمة ليها
   عرض «قايمة» وعرض «مين معاه إيه» (مصفوفة: صاحب التصريح × نوع التصريح).
   بيانات الموظف / العربية بتيجي من مركز الإقامات والموظفين ومركز السيارات (STATE.permitHolders) للعرض بس.
   كل نوع تصريح (KOC، الرتقة والعبدلي، الوفرة…) بيتسجّل لوحده برقمه وتواريخه، و«🔄 تجديد» بيعمل تصريح جديد
   والقديم بيفضل تاريخ (مالوش تنبيه). العقد مطلوب (حكومي أو من الباطن) وهو اللي بيحد التاريخ مع الإقامة /
   التأمين / الدفتر. النوع المعتمد على نوع تاني (الرتقة ← KOC) مايطلعش غير مع أساسي ساري وبينتهي معاه وعلى
   عقده. الأنواع والأماكن لمدير النظام.
   ===================================================================== */
const PERMIT_HOLDERS = {
  employee: { l: 'موظف', ico: '👤', tab: 'تصاريح الموظفين', report: 'تقرير تصاريح الموظفين', csv: 'employee-permits' },
  vehicle:  { l: 'سيارة', ico: '🚗', tab: 'تصاريح السيارات', report: 'تقرير تصاريح السيارات', csv: 'vehicle-permits' },
};
const PERMIT_APPLIES = { '': 'الموظفين والسيارات', employee: 'الموظفين بس', vehicle: 'السيارات بس' };
const PERMIT_GROUPS = { '': 'بدون تجميع', type: 'النوع', project: 'العقد', place: 'المكان', company: 'الشركة', issuer: 'الجهة المانحة' };
const PERMIT_FILTER_DEFAULT = { q: '', type: '', place: '', company: '', tier: '', status: '', ended: false, old: false, view: 'list', mType: '', mState: '', mAll: false };
// ملخص فوق كل قايمة (بالضغط بيفلتر)
const PERMIT_STATUS = {
  valid:   { l: 'ساري',          test: d => d !== null && d >= 0 },
  expired: { l: 'منتهي',         test: d => d !== null && d < 0 },
  soon:    { l: 'خلال 30 يوم',   test: d => d !== null && d >= 0 && d <= 30 },
  // الرتقة اللي الـ KOC بتاعه اتجدّد (فيه KOC ساري أبعد) ← مستني تجديده هو كمان
  renew:   { l: 'جاهز للتجديد مع التصريح الأساسي', fn: p => !!permitDepRenew(p) },
};
function permitStatusIs(p, st) { const x = PERMIT_STATUS[st]; return !!x && (x.fn ? x.fn(p) : x.test(daysUntil(p.expiryDate))); }
// فلتر المصفوفة على نوع واحد
const PERMIT_MSTATE = { has: 'عنده', none: 'مش عنده', expired: 'عنده ومنتهي', soon: 'عنده وبينتهي خلال 30 يوم' };

function permitTypeName(tp) { return tp ? (LANG === 'en' && tp.nameEn ? tp.nameEn : tp.nameAr) : ''; }
function permitPlaceName(pl) { return pl ? (LANG === 'en' && pl.nameEn ? pl.nameEn : pl.nameAr) : ''; }
function permitsOf(kind, id) { return (IDX.permitsOf && IDX.permitsOf[kind] && IDX.permitsOf[kind][id]) || []; }
/** ساري = لسه ماانتهاش */
function permitValid(p) { const d = daysUntil(p.expiryDate); return d !== null && d >= 0; }
function permitLabel(p) { return permitTypeName(IDX.permitType[p.typeId]) || t('تصريح'); }
function permitPlacesText(p) { return (p.placeIds || []).map(x => permitPlaceName(IDX.permitPlace[x])).filter(Boolean).join(LANG === 'en' ? ', ' : '، '); }
function permitPlaceChips(p) { return (p.placeIds || []).map(x => `<span class="chip">${esc(permitPlaceName(IDX.permitPlace[x]))}</span>`).join(' ') || '<span class="muted">—</span>'; }
/** خانة «الأماكن» بتظهر بس لو فيه أماكن متسجّلة */
function permitHasPlaces() { return (STATE.permitPlaces || []).length > 0; }
function permitHolderId(p) { return p.holderKind === 'employee' ? p.employeeId : p.vehicleId; }
/** صاحب التصريح (بياناته من مركز الموظفين / السيارات) */
function holderOf(kind, id) { return ((IDX.permitHolder || {})[kind] || {})[id] || null; }
function permitHolder(p) { return holderOf(p.holderKind, permitHolderId(p)); }
function holderName(kind, h) { return !h ? '' : kind === 'employee' ? (LANG === 'en' && h.nameEn ? h.nameEn : h.name) : h.plate; }
function permitHolderName(p) { return holderName(p.holderKind, permitHolder(p)); }
function holderDriver(h) { return LANG === 'en' && h.driverNameEn ? h.driverNameEn : h.driverName || ''; }
function permitTypesFor(kind) { return (STATE.permitTypes || []).filter(tp => !tp.appliesTo || tp.appliesTo === kind); }
// العقود اللي التصاريح بتطلع عليها (وبتحد تاريخها): العقد الحكومي والعقد من الباطن — نفس PERMIT_PROJECT_KINDS على السيرفر
const PERMIT_PROJECT_KINDS = ['gov', 'sub'];
function permitProjectOk(pr) { return !!pr && PERMIT_PROJECT_KINDS.includes(pr.kind); }
function projectEnded(pr) { return !!(pr && pr.expiryDate && pr.expiryDate < todayISO()); }
function permitProjectLabel(id, withEnd = true) {
  const pr = IDX.project[id];
  if (!pr) return '';
  return projectName(id) + (pr.contractNo ? ' · ' + pr.contractNo : '') + (pr.kind === 'sub' ? ` (${t('من الباطن')})` : '')
    + (withEnd && pr.expiryDate ? ` — ${t('لحد')} ${fmtDate(pr.expiryDate)}` : '');
}
/** قايمة العقود في التصريح: الحكومية واللي من الباطن بس، واللي خلص مايظهرش (إلا لو هو عقد التصريح نفسه) */
function permitProjectOptions(sel) {
  const list = scopedProjects().filter(pr => permitProjectOk(pr) && (!projectEnded(pr) || pr.id === sel))
    .sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b), 'ar'));
  if (sel && IDX.project[sel] && !list.some(pr => pr.id === sel)) list.unshift(IDX.project[sel]);
  return opt('', t('— اختار العقد —'), !sel) + list.map(pr => opt(pr.id, permitProjectLabel(pr.id), pr.id === sel)).join('');
}
/** العقد اللي بيتختار لوحده: العقد اللي صاحب التصريح مسجّل عليه — لو حكومي أو من الباطن ولسه ماخلصش */
function permitDefaultProject(h) { const pr = h && IDX.project[h.projectId]; return permitProjectOk(pr) && !projectEnded(pr) ? pr.id : ''; }
/** أقصى تاريخ للتصريح = أقرب تاريخ من: الموظف ← الإقامة (إذن العمل مش داخل)، والعربية ← الرخصة والتأمين (تاريخ واحد) —
    ونهاية العقد اللي التصريح طالع عليه (مش العقد اللي صاحبه مسجّل عليه). [{l, d}] الأقرب الأول (نفس permit_cap على السيرفر). */
function permitCaps(kind, h, projectId) {
  if (!h) return [];
  const out = [];
  if (kind === 'employee') { if (h.residencyExp && empNeedsResidency(h)) out.push({ l: t('الإقامة'), d: h.residencyExp, src: 'residency' }); }
  else {
    if (h.insuranceExpiry) out.push({ l: t('الرخصة والتأمين'), d: h.insuranceExpiry, src: 'insurance' });
  }
  const pr = IDX.project[projectId];
  if (permitProjectOk(pr) && pr.expiryDate) out.push({ l: `${t('العقد')} ${projectName(pr.id)}`, d: pr.expiryDate, src: 'contract' });
  return out.sort((a, b) => a.d.localeCompare(b.d));
}
/* ---------- التصريح المعتمد على تصريح تاني (الرتقة والعبدلي ← KOC) ---------- */
/** النوع اللي لازم يبقى معاه ساري قبل النوع ده */
function permitReqType(typeId) { const tp = IDX.permitType[typeId]; return tp && tp.requiresTypeId ? IDX.permitType[tp.requiresTypeId] || null : null; }
function permitParent(p) { return p && p.parentId ? IDX.permit[p.parentId] || null : null; }
function permitKids(p) { return (STATE.permits || []).filter(x => x.parentId === p.id); }
function permitNoText(p) { return p && p.permitNo ? ` ${t('رقم')} ${p.permitNo}` : ''; }
/** الأساسي الساري الأبعد انتهاءً لصاحب التصريح (نفس permit_parent_for على السيرفر) */
function holderParentPermit(kind, hid, typeId) {
  return permitsOf(kind, hid).filter(q => q.typeId === typeId && permitValid(q))
    .sort((a, b) => String(b.expiryDate).localeCompare(String(a.expiryDate)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}
/** المعتمد جاهز للتجديد: الأساسي بتاعه اتجدّد (فيه أساسي ساري أبعد من تاريخه) ← الأساسي الجديد، أو null */
function permitDepRenew(p) {
  const req = permitReqType(p.typeId);
  if (!req || !permitCurrent(p) || permitNeedsCancel(p)) return null;
  const par = permitParent(p), nw = holderParentPermit(p.holderKind, permitHolderId(p), req.id);
  return nw && (!par || nw.id !== par.id) && nw.expiryDate > (p.expiryDate || '') ? nw : null;
}
/** التصريح مربوط بأنهي تاريخ (تاريخه = تاريخ من تواريخ الحد) */
function permitTiedTo(p) { return permitCaps(p.holderKind, permitHolder(p), p.projectId).find(c => c.d === p.expiryDate) || null; }
/** الموظف مستقيل / إنهاء خدمات / في فترة إنذار وتصريحه لسه ساري ← لازم يتلغي */
function permitNeedsCancel(p) {
  const h = permitHolder(p);
  return p.holderKind === 'employee' && !!h && (empEnded(h) || h.employmentStatus === 'warning') && permitValid(p) && permitCurrent(p);
}
/** التصريح قرّب ينتهي (90 يوم) والحد بقى أبعد (الإقامة أو العقد اتجددوا) ← ممكن يتجدد لحد الحد الجديد */
function permitRenewHint(p) {
  if (!permitCurrent(p) || permitNeedsCancel(p) || permitReqType(p.typeId)) return null;     // المعتمد ← permitDepRenew
  const d = daysUntil(p.expiryDate);
  if (d === null || d > 90) return null;
  const cs = permitCaps(p.holderKind, permitHolder(p), p.projectId);
  return cs.length && cs[0].d > p.expiryDate ? cs[0] : null;
}
function permitFlagsHtml(p) {
  const req = permitReqType(p.typeId);
  if (req) {
    const par = permitParent(p), nw = permitDepRenew(p), cur = permitCurrent(p), rn = esc(permitTypeName(req));
    return `${par ? `<div class="small muted">🔗 ${t('مع')} ${rn}${esc(permitNoText(par))}</div>` : ''}
      ${cur && !par ? `<div class="small" style="color:var(--red)">⛔ ${t('من غير')} ${rn}</div>` : ''}
      ${cur && par && permitValid(p) && !permitValid(par) ? `<div class="small" style="color:var(--red)">⛔ ${rn} ${t('بتاعه منتهي')}</div>` : ''}
      ${permitNeedsCancel(p) ? `<div class="small" style="color:var(--red)">⚠️ ${t('لازم يتلغي')}</div>` : ''}
      ${nw ? `<div class="small" style="color:var(--green)">🔄 ${t('جاهز للتجديد')} — ${rn} ${t('الجديد لحد')} ${fmtDate(nw.expiryDate)}</div>` : ''}`;
  }
  const tie = permitTiedTo(p), hint = permitRenewHint(p), cap = permitCaps(p.holderKind, permitHolder(p), p.projectId)[0];
  const over = cap && permitCurrent(p) && p.expiryDate > cap.d;       // اتسجّل قبل قاعدة «أقرب تاريخ»
  return `${tie ? `<div class="small muted">🔗 ${t('مع')} ${esc(tie.l)}</div>` : ''}
    ${!p.projectId && permitCurrent(p) ? `<div class="small" style="color:var(--orange)">⚠️ ${t('من غير عقد')}</div>` : ''}
    ${over ? `<div class="small" style="color:var(--red)" title="${esc(t('تاريخ التصريح بعد أقرب تاريخ مسموح — راجعه'))}">⛔ ${t('بعد')} ${esc(cap.l)} (${fmtDate(cap.d)})</div>` : ''}
    ${permitNeedsCancel(p) ? `<div class="small" style="color:var(--red)">⚠️ ${t('لازم يتلغي')}</div>` : ''}
    ${hint ? `<div class="small" style="color:var(--green)">🔄 ${t('ممكن يتجدد لحد')} ${fmtDate(hint.d)} (${esc(hint.l)})</div>` : ''}`;
}
/** التصريح «الحالي» = الأبعد انتهاءً لنفس الشخص ونفس النوع ونفس الأماكن. اللي قبله اتجدّد: تاريخ بس، مالوش تنبيه */
let PERMIT_SUPER = { state: null, set: new Set() };
function permitSuperseded(p) {
  if (PERMIT_SUPER.state !== STATE) {
    const groups = {}, set = new Set();
    for (const q of STATE.permits || []) (groups[`${q.holderKind}|${permitHolderId(q)}|${q.typeId}|${(q.placeIds || []).slice().sort().join(',')}`] ||= []).push(q);
    Object.values(groups).forEach(list => list.sort((a, b) => String(b.expiryDate || '').localeCompare(String(a.expiryDate || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(1).forEach(q => set.add(q.id)));
    PERMIT_SUPER = { state: STATE, set };
  }
  return PERMIT_SUPER.set.has(p.id);
}
function permitCurrent(p) { return !permitSuperseded(p); }
/** التصاريح الحالية لشخص من نوع معيّن (الأقرب انتهاءً الأول) */
function holderCurrentPermits(kind, hid, typeId) {
  return permitsOf(kind, hid).filter(p => p.typeId === typeId && permitCurrent(p)).sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
}
/** كارت بيانات صاحب التصريح — للعرض بس (بيتعدّل من مركزه) */
function holderCardHtml(kind, h, extra = '') {
  if (!h) return '';
  const f = (l, v) => `<div><span>${esc(t(l))}</span>${v || '<span class="muted">—</span>'}</div>`;
  const body = kind === 'employee'
    ? f('الاسم', `<b>${esc(h.name)}</b>${h.nameEn ? `<div class="small muted" dir="ltr">${esc(h.nameEn)}</div>` : ''}`) + f('الرقم المدني', `<span class="num">${esc(h.id)}</span>`)
      + f('الجنسية', esc(personNat(h))) + f('المهنة', esc(personProf(h))) + f('الشركة', esc(companyName(h.companyId)))
      + f('مركز التكلفة', esc(ccLabel(h.costCenter))) + f('رقم الملف', esc(h.fileNo || '')) + f('الحالة الوظيفية', statusPill(h.employmentStatus))
    : f('رقم اللوحة', `<b class="num">${esc(h.plate)}</b>`) + f('نوع المركبة', esc(t(VEHICLE_TYPES[h.vehicleType] || ''))) + f('الموديل', esc(h.model || ''))
      + f('الشركة', esc(companyName(h.companyId)) + (h.ownerCompanyId && h.ownerCompanyId !== h.companyId ? `<div class="small muted">🔑 ${t('المالك الفعلي')}: ${esc(companyName(h.ownerCompanyId))}</div>` : ''))
      + f('مركز التكلفة', esc(ccLabel(h.costCenter))) + f('مع مين', esc(holderDriver(h)));
  return `<div class="kv">${body}${extra}</div>
    <div class="small muted" style="margin-top:4px">ℹ️ ${t(kind === 'employee' ? 'البيانات من مركز الإقامات والموظفين — للعرض بس' : 'البيانات من مركز السيارات — للعرض بس')}</div>`;
}

/** التصاريح الحالية اللي مع الشخص (غير exceptId) — بتتفتح بالضغط */
function holderPermitsHtml(kind, hid, exceptId) {
  const list = permitsOf(kind, hid).filter(p => p.id !== exceptId && permitCurrent(p))
    .sort((a, b) => permitLabel(a).localeCompare(permitLabel(b), 'ar'));
  if (!list.length) return '';
  return `<div class="small" style="margin:4px 0 8px"><span class="muted">${t(exceptId ? 'معاه كمان' : 'التصاريح اللي معاه')}:</span>
    ${list.map(p => { const ok = permitValid(p); return `<span class="chip clickable" data-open-permit="${p.id}" style="color:var(--${ok ? 'green' : 'red'})">${esc(permitLabel(p))}${p.permitNo ? ` <span class="num">${esc(p.permitNo)}</span>` : ''} · ${t(ok ? 'ساري لحد' : 'منتهي')} ${fmtDate(p.expiryDate)}</span>`; }).join(' ')}</div>`;
}
function bindHolderPermits(root, close) {
  $$('[data-open-permit]', root).forEach(c => c.onclick = () => { const id = c.dataset.openPermit; close(); openPermitModal(id); });
}
/** اختيار الموظف (اكتب واختار) أو السيارة — للي مش متحدد */
function permitHolderPicker(kind) {
  const hs = (STATE.permitHolders || {})[kind === 'employee' ? 'employees' : 'vehicles'] || [];
  const pickList = kind === 'employee' ? hs.filter(e => !empEnded(e)) : hs;
  return kind === 'employee'
    ? `<div class="form"><label class="full"><span class="req">${t('الموظف')}</span><input name="holderPick" list="dl-permit-holder" placeholder="${esc(t('اكتب الاسم أو الرقم المدني أو رقم الملف واختار من القايمة'))}" autocomplete="off">
        <datalist id="dl-permit-holder">${pickList.map(e => `<option value="${esc(`${e.id} — ${e.name}${e.fileNo ? ' — ' + t('ملف') + ' ' + e.fileNo : ''}`)}">`).join('')}</datalist></label></div>`
    : `<div class="form"><label class="full"><span class="req">${t('السيارة')}</span><select name="holderPick">${opt('', t('— اختار السيارة —'), true)}${pickList.map(v => opt(v.id, `${v.plate}${v.model ? ' — ' + v.model : ''}${v.companyId ? ' — ' + companyName(v.companyId) : ''}`, false)).join('')}</select></label></div>`;
}
function pickedPermitHolder(E, kind, fixed) {
  if (fixed) return fixed;
  const v = (($('[name=holderPick]', E) || {}).value || '').trim();
  const hid = kind === 'employee' ? v.split(' — ')[0].trim() : v;
  return holderOf(kind, hid) ? hid : '';
}
function permitIssuers() {
  return uniq([...(STATE.permits || []).map(q => q.issuer), ...(STATE.permitTypes || []).map(tp => tp.defaultIssuer)].filter(Boolean)).sort((a, b) => a.localeCompare(b, 'ar'));
}
function permitCapText(kind, hid, cs) {
  return !hid ? '' : cs.length
    ? `📌 ${t('أقصى تاريخ للتصريح')}: <b>${fmtDate(cs[0].d)}</b> (${esc(cs[0].l)})${cs.length > 1 ? ` <span class="muted">— ${cs.slice(1).map(c => `${esc(c.l)} ${fmtDate(c.d)}`).join(' · ')}</span>` : ''}`
    : `<span class="muted">${t(kind === 'employee' ? 'مفيش تاريخ إقامة ولا عقد متسجّل للموظف ده — مفيش حد لتاريخ التصريح.' : 'مفيش تاريخ عقد ولا رخصة وتأمين متسجّل للعربية دي — مفيش حد لتاريخ التصريح.')}</span>`;
}

/* ---------- إضافة تصريح أو أكتر لنفس الموظف / العربية ----------
   كل نوع بيتعلّم عليه بيطلع له سطر (رقمه وجهته وتواريخه ومرفقه)، والعقد والأماكن والملاحظات للكل، وبيتحفظوا مرة واحدة
   (كلهم أو ولا واحد). preset = { holderId, typeId } ← من المصفوفة أو «➕ تصريح تاني» */
function openPermitAddModal(kind, preset) {
  const pre = preset || {};
  const fixedHolder = pre.holderId || '';
  const types = permitTypesFor(kind), places = STATE.permitPlaces || [];
  const noun = kind === 'employee' ? 'للموظف' : 'للسيارة';
  const h0 = fixedHolder ? holderOf(kind, fixedHolder) : null;
  const m = openModal({
    title: `${PERMIT_HOLDERS[kind].ico} ${t('إضافة تصاريح')} — ${t(PERMIT_HOLDERS[kind].l)}`, size: 'wide',
    body: `${fixedHolder ? '' : permitHolderPicker(kind)}
      <div id="permit-holder" style="margin:8px 0 4px">${fixedHolder ? holderCardHtml(kind, h0) : ''}</div>
      <div id="pa-has"></div>
      <div class="small muted" style="margin:8px 0 4px"><span class="req">${t('التصاريح اللي طالعة')} ${t(noun)}</span> — ${t('علّم على كل الأنواع، وكل نوع هيطلع له سطر')}</div>
      <div class="row" style="flex-wrap:wrap;gap:4px 18px">${types.map(tp => `<label class="check"><input type="checkbox" data-type="${tp.id}" ${tp.id === pre.typeId ? 'checked' : ''}> <b>${esc(permitTypeName(tp))}</b> <span class="small muted" data-has="${tp.id}"></span></label>`).join('')
        || `<span class="muted">${t('مفيش أنواع — مدير النظام بيضيفها')}</span>`}</div>
      <div id="pa-table" style="margin-top:10px" hidden>
        <div class="row" style="margin-bottom:4px"><span class="small" id="pa-cap"></span><span class="spacer"></span><button type="button" class="btn sm" id="pa-same" hidden>📅 ${t('نفس التواريخ للكل')}</button></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>${t('النوع')}</th><th>${t('رقم التصريح')}</th><th>${t('الجهة المانحة')}</th><th>${t('تاريخ الإصدار')}</th><th><span class="req">${t('تاريخ الانتهاء')}</span></th><th class="pa-filecol">${t('المرفق')}</th></tr></thead>
          <tbody>${types.map(tp => `<tr data-row="${tp.id}" hidden><td style="white-space:nowrap"><b>${esc(permitTypeName(tp))}</b><div class="small muted" data-dep-note></div></td>
            <td><input data-f="permitNo" dir="ltr" style="width:100px"></td>
            <td><input data-f="issuer" list="dl-permit-issuer" value="${esc(tp.defaultIssuer || '')}" style="width:170px"></td>
            <td><input type="date" data-f="issueDate"></td><td><input type="date" data-f="expiryDate" ${permitReqType(tp.id) && tp.sameExpiry ? `readonly title="${esc(t('بيتحط لوحده بتاريخ التصريح الأساسي'))}"` : ''}></td>
            <td class="pa-filecol"><input type="file" data-f="file" accept=".pdf,image/*" style="width:150px;font-size:11px"></td></tr>`).join('')}</tbody></table></div>
        <datalist id="dl-permit-issuer">${permitIssuers().map(i => `<option value="${esc(i)}">`).join('')}</datalist></div>
      <div class="form" style="margin-top:10px">
        <label title="${esc(t('العقد اللي التصريح طالع عليه (حكومي أو من الباطن) — ممكن يختلف عن العقد اللي صاحبه مسجّل عليه، وهو اللي بيحدد أقصى تاريخ'))}"><span class="req">${t('العقد')}</span><select name="projectId">${permitProjectOptions(permitDefaultProject(h0))}</select></label>
        <label>${t('ملاحظات')}<input name="notes"></label>
        <div class="small" id="pa-proj-note" style="grid-column:1/-1"></div>
        ${places.length ? `<div style="grid-column:1/-1"><div class="small muted" style="margin-bottom:4px">${t('الأماكن')}</div>
          <div class="row" style="flex-wrap:wrap;gap:4px 14px">${places.map(pl => `<label class="check"><input type="checkbox" data-place="${pl.id}"> ${esc(permitPlaceName(pl))}</label>`).join('')}</div></div>` : ''}
        <div style="grid-column:1/-1"><label class="check"><input type="checkbox" id="pa-onefile"> 📎 ${t('مرفق واحد للكل (التصاريح متصوّرة في ملف واحد)')}</label>
          <input type="file" id="pa-file" accept=".pdf,image/*" hidden style="margin-top:4px"></div>
      </div>
      <div class="small muted" style="margin-top:8px">${t('العقد والأماكن والملاحظات بتتسجّل على كل التصاريح، وتقدر تعدّل أي تصريح لوحده بعدين. والتصريح المربوط بتصريح أساسي (زي الرتقة مع الـ KOC) بياخد تاريخه وعقده.')}</div>`,
    foot: `<button class="btn primary write-only" data-p="permits.edit" data-save>${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const rows = () => $$('tr[data-row]', E).filter(r => !r.hidden);
  const field = (r, f) => $(`[data-f="${f}"]`, r);
  const projSel = $('[name=projectId]', E);
  const box = id => $(`[data-type="${id}"]`, E);
  const holder = () => { const hid = pickedPermitHolder(E, kind, fixedHolder); return hid ? { hid, h: holderOf(kind, hid) } : null; };
  /** الأساسي للنوع المعتمد (الرتقة ← KOC): سطره في نفس الشاشة (row) أو الساري عند صاحبه (par) — أو null للنوع العادي */
  const depOf = typeId => {
    const req = permitReqType(typeId);
    if (!req) return null;
    const same = !!(IDX.permitType[typeId] || {}).sameExpiry, b = box(req.id);
    if (b && b.checked) return { req, same, row: $(`tr[data-row="${req.id}"]`, E) };
    const H = holder();
    return { req, same, par: H ? holderParentPermit(kind, H.hid, req.id) : null };
  };
  // السطور المعتمدة بتاخد تاريخ الأساسي (سطره اللي فوق وإنت بتكتبه، أو تصريحه الساري)
  const fillDeps = () => rows().forEach(r => {
    const d = depOf(r.dataset.row), note = $('[data-dep-note]', r), inp = field(r, 'expiryDate');
    if (!d) { note.textContent = ''; return; }
    const pexp = d.row ? field(d.row, 'expiryDate').value : d.par ? d.par.expiryDate : '';
    if (d.same) inp.value = pexp || '';
    else if (pexp && (!inp.max || pexp < inp.max)) inp.max = pexp;
    note.textContent = d.row ? `🔗 ${t('مع')} ${permitTypeName(d.req)} ${t(d.same ? 'اللي فوق — بنفس تاريخه وعقده' : 'اللي فوق — مايعدّيش تاريخه')}`
      : d.par ? `🔗 ${t('مع')} ${permitTypeName(d.req)}${permitNoText(d.par)} — ${permitProjectLabel(d.par.projectId, false)}` : '';
  });
  let autoExp = '', autoProj = projSel.value, lastHid = null;
  const sync = () => {
    const H = holder(), hid = H ? H.hid : '';
    if (hid !== lastHid) {             // صاحب جديد ← العقد اللي مسجّل عليه بيتختار (لو الاختيار لسه تلقائي)
      if (!fixedHolder) $('#permit-holder', E).innerHTML = hid ? holderCardHtml(kind, H.h) : '';
      $('#pa-has', E).innerHTML = hid ? holderPermitsHtml(kind, hid) : '';
      bindHolderPermits($('#pa-has', E), () => m.close());
      if (!projSel.value || projSel.value === autoProj) { autoProj = hid ? permitDefaultProject(H.h) : ''; projSel.value = autoProj; }
      lastHid = hid;
    }
    // النوع المعتمد متاح بس لو معاه أساسي ساري أو متعلّم عليه هنا
    types.forEach(tp => {
      const cur = hid ? holderCurrentPermits(kind, hid, tp.id).filter(permitValid) : [];
      const d = depOf(tp.id), ok = !d || !!d.row || !!d.par, c = box(tp.id);
      c.disabled = !ok;
      if (!ok && c.checked) c.checked = false;
      $(`[data-has="${tp.id}"]`, E).textContent = !ok ? `(${t('محتاج')} ${permitTypeName(d.req)} ${t('ساري')})`
        : cur.length ? `(${t('عنده ساري لحد')} ${fmtDate(cur[cur.length - 1].expiryDate)})` : '';
    });
    $$('[data-type]', E).forEach(c => { $(`tr[data-row="${c.dataset.type}"]`, E).hidden = !c.checked; });
    const vis = rows();
    $('#pa-table', E).hidden = !vis.length;
    $('#pa-same', E).hidden = vis.length < 2;
    // العقد مش محتاج لو كل السطور بتاخد عقد أساسي معاه بالفعل
    const needProj = !vis.length || vis.some(r => { const d = depOf(r.dataset.row); return !d || !d.same || !!d.row; });
    projSel.disabled = !needProj;
    // أقصى تاريخ = أقرب تاريخ (الإقامة / العقد المختار / التأمين / الدفتر) ← بيتحط لوحده في كل سطر، والتاريخ بعده ممنوع
    const cs = hid ? permitCaps(kind, H.h, projSel.value) : [], cap = cs.length ? cs[0].d : '';
    vis.filter(r => !(depOf(r.dataset.row) || {}).same).forEach(r => {
      const inp = field(r, 'expiryDate');
      inp.max = cap;
      if (!inp.value || inp.value === autoExp) inp.value = cap;
    });
    autoExp = cap;
    fillDeps();
    $('#pa-cap', E).innerHTML = !hid || !needProj ? '' : projSel.value ? permitCapText(kind, hid, cs)
      : `<span style="color:var(--orange)">⚠️ ${t('اختار العقد اللي التصريح طالع عليه — هو اللي بيحدد أقصى تاريخ')}</span>`;
    const reg = H && H.h.projectId && IDX.project[H.h.projectId];
    $('#pa-proj-note', E).innerHTML = needProj && reg && projSel.value && projSel.value !== reg.id
      ? `ℹ️ ${t(kind === 'employee' ? 'الموظف مسجّل على' : 'السيارة مسجّلة على')} <b>${esc(projectName(reg.id))}</b> — ${t('التصريح طالع على')} <b>${esc(projectName(projSel.value))}</b>` : '';
  };
  $$('[data-type]', E).forEach(c => c.onchange = sync);
  projSel.onchange = sync;
  E.addEventListener('input', ev => { if (ev.target.dataset && ev.target.dataset.f === 'expiryDate') fillDeps(); });
  const pick = $('[name=holderPick]', E);
  if (pick) { pick.addEventListener('change', sync); pick.addEventListener('input', sync); pick.focus(); }
  sync();
  $('#pa-same', E).onclick = () => {
    const [first, ...rest] = rows();
    rest.forEach(r => {
      field(r, 'issueDate').value = field(first, 'issueDate').value;
      if (!field(r, 'expiryDate').readOnly) field(r, 'expiryDate').value = field(first, 'expiryDate').value;
    });
    fillDeps();
  };
  const one = $('#pa-onefile', E);
  one.onchange = () => { $('#pa-file', E).hidden = !one.checked; $$('.pa-filecol', E).forEach(c => { c.hidden = one.checked; }); };
  $('[data-save]', E).onclick = async ev => {
    const H = holder();
    if (!H) return openBlockAlert(t(kind === 'employee' ? 'اختار الموظف من القايمة' : 'اختار السيارة'));
    const hid = H.hid;
    fillDeps();
    const list = rows().map(r => ({ r, typeId: r.dataset.row, permitNo: field(r, 'permitNo').value.trim(), issuer: field(r, 'issuer').value.trim(),
      issueDate: field(r, 'issueDate').value, expiryDate: field(r, 'expiryDate').value, dep: depOf(r.dataset.row) }));
    if (!list.length) return openBlockAlert(t('علّم على نوع تصريح واحد على الأقل'));
    const projectId = projSel.disabled ? '' : projSel.value;
    if (!projSel.disabled && !projectId) return openBlockAlert(t('اختار العقد اللي التصريح طالع عليه'));
    const caps = permitCaps(kind, H.h, projectId);
    for (const x of list) {
      const name = permitTypeName(IDX.permitType[x.typeId]);
      if (x.dep && !x.dep.row && !x.dep.par) return openBlockAlert(`«${name}»: ${t('محتاج')} «${permitTypeName(x.dep.req)}» ${t('ساري')}`);
      if (!x.expiryDate) return openBlockAlert(`«${name}»: ${t('تاريخ الانتهاء مطلوب')}`);
      if (x.issueDate && x.issueDate > x.expiryDate) return openBlockAlert(`«${name}»: ${t('تاريخ الإصدار بعد تاريخ الانتهاء')}`);
      if (x.dep && x.dep.same) continue;                       // تاريخه تاريخ الأساسي
      if (caps.length && x.expiryDate > caps[0].d) return openBlockAlert(`«${name}»: ${t('مش هينفع: التصريح بينتهي بعد')} ${caps[0].l} (${fmtDate(caps[0].d)}). ${t(kind === 'employee' ? 'لو اتجدد، حدّث تاريخه في مركز الإقامات والموظفين أو العقود الأول.' : 'لو اتجدد، حدّث تاريخه في مركز السيارات أو العقود الأول.')}`);
    }
    // نوع عنده منه تصريح ساري ← تأكيد واحد للكل (التجديد من «🔄 تجديد» في التصريح القديم)
    const dup = list.map(x => [x, holderCurrentPermits(kind, hid, x.typeId).filter(permitValid)]).filter(([, s]) => s.length);
    if (dup.length && !await openConfirm(`${esc(holderName(kind, H.h))} ${t('عنده بالفعل')}: ${dup.map(([x, s]) => `«${esc(permitTypeName(IDX.permitType[x.typeId]))}» ${t('ساري لحد')} ${fmtDate(s[s.length - 1].expiryDate)}`).join('، ')}.\n${t('لو ده تجديد، استخدم «🔄 تجديد» من التصريح القديم. تضيف تصريح تاني؟')}`, { okLabel: t('إضافة') })) return;
    const payload = { holderKind: kind, holderId: hid, projectId, notes: $('[name=notes]', E).value,
      placeIds: $$('[data-place]', E).filter(c => c.checked).map(c => c.dataset.place),
      permits: list.map(({ typeId, permitNo, issuer, issueDate, expiryDate, dep }) => ({ typeId, permitNo, issuer, issueDate, expiryDate,
        parentId: dep && dep.par ? dep.par.id : undefined })) };
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await api('POST', '/api/permits/batch', payload);
      // المرفقات: ملف واحد لكل التصاريح، أو ملف كل سطر لتصريحه
      const oneFile = one.checked && $('#pa-file', E).files[0];
      const failed = [];
      for (let i = 0; i < r.ids.length; i++) {
        const f = one.checked ? oneFile : field(list[i].r, 'file').files[0];
        if (!f) continue;
        const fd = new FormData(); fd.append('file', f);
        try { await api('POST', `/api/permits/${r.ids[i]}/file`, fd); } catch (e) { failed.push(`${permitTypeName(IDX.permitType[list[i].typeId])}: ${e.message}`); }
      }
      if (failed.length) toast(t('التصاريح اتحفظت، لكن المرفق ماترفعش') + ' — ' + failed.join(' · '), 'err');
      else toast(`${t('اتضاف')} ${r.ids.length} ${t('تصريح')}`, 'ok');
      m.close();
      await reload();
    } catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); else toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  };
}

/* ---------- تعديل / تجديد تصريح (الإضافة من openPermitAddModal) ----------
   preset = { holderId, typeId, issuer, placeIds, projectId, notes, renewOf } ← صاحب التصريح ثابت (من «🔄 تجديد») */
function openPermitModal(id, kind0, preset) {
  const p = id ? (STATE.permits || []).find(x => x.id === id) : null;
  if (id && !p) return toast('التصريح غير موجود', 'err');
  const kind = p ? p.holderKind : kind0 || 'employee';
  const pre = preset || {};
  const renewOf = pre.renewOf ? (STATE.permits || []).find(x => x.id === pre.renewOf) : null;
  const fixedHolder = p ? permitHolderId(p) : pre.holderId || '';
  // التصريح الجديد: عقد التصريح القديم (في التجديد) لو لسه ماخلصش، وإلا العقد اللي صاحبه مسجّل عليه
  const newProject = pre.projectId && !projectEnded(IDX.project[pre.projectId]) ? pre.projectId : permitDefaultProject(fixedHolder ? holderOf(kind, fixedHolder) : null);
  const x = p || { typeId: pre.typeId || '', issuer: pre.issuer || '', placeIds: pre.placeIds || [], projectId: newProject, notes: pre.notes || '' };
  if (!p && !x.issuer && x.typeId) x.issuer = (IDX.permitType[x.typeId] || {}).defaultIssuer || '';
  const issuers = permitIssuers();
  const places = STATE.permitPlaces || [];
  const types = permitTypesFor(kind);
  const kids = p ? permitKids(p) : [];
  const picker = fixedHolder ? '' : permitHolderPicker(kind);
  const title = p ? 'تعديل تصريح' : renewOf ? 'تجديد تصريح' : 'إضافة تصريح';
  const m = openModal({
    title: `${PERMIT_HOLDERS[kind].ico} ${t(title)} — ${t(PERMIT_HOLDERS[kind].l)}`, size: 'wide',
    body: `${renewOf ? `<div class="notice" style="margin-bottom:8px">🔄 ${t('تجديد')} «${esc(permitLabel(renewOf))}»${renewOf.permitNo ? ' ' + t('رقم') + ' ' + esc(renewOf.permitNo) : ''} — ${t('كان بينتهي')} ${fmtDate(renewOf.expiryDate)}. ${t('اكتب الرقم والتواريخ الجديدة؛ القديم هيفضل في السجل.')}</div>` : ''}
      ${picker}<div id="permit-holder" style="margin:8px 0 12px">${fixedHolder ? holderCardHtml(kind, holderOf(kind, fixedHolder)) : ''}</div>
      ${p ? holderPermitsHtml(kind, fixedHolder, p.id) : ''}
      ${p && permitSuperseded(p) ? `<div class="notice warn" style="margin-bottom:8px">${t('التصريح ده اتجدّد — فيه تصريح أحدث من نفس النوع.')}</div>` : ''}
      ${kids.length ? `<div class="notice" style="margin-bottom:8px">🔗 ${t('مربوط بيه')}: ${kids.map(k => `«${esc(permitLabel(k))}${esc(permitNoText(k))}»`).join('، ')} — ${t('تغيير التاريخ أو العقد هيتطبّق عليه كمان، ونوع التصريح مايتغيّرش.')}</div>` : ''}
      <div class="form">
        <label><span class="req">${t('نوع التصريح')}</span><select name="typeId" ${kids.length ? 'disabled' : ''}>${opt('', types.length ? t('— اختار النوع —') : t('مفيش أنواع — مدير النظام بيضيفها'), !x.typeId)}${types.map(tp => opt(tp.id, permitTypeName(tp), tp.id === x.typeId)).join('')}</select></label>
        <label>${t('رقم التصريح')}<input name="permitNo" value="${esc(x.permitNo || '')}" dir="ltr"></label>
        <label>${t('الجهة المانحة')}<input name="issuer" list="dl-permit-issuer" value="${esc(x.issuer || '')}"><datalist id="dl-permit-issuer">${issuers.map(i => `<option value="${esc(i)}">`).join('')}</datalist></label>
        <label title="${esc(t('العقد اللي التصريح طالع عليه (حكومي أو من الباطن) — ممكن يختلف عن العقد اللي صاحبه مسجّل عليه، وهو اللي بيحدد أقصى تاريخ'))}"><span class="req">${t('العقد')}</span><select name="projectId">${permitProjectOptions(x.projectId || '')}</select></label>
        <label>${t('تاريخ الإصدار')}<input type="date" name="issueDate" value="${esc(x.issueDate || '')}"></label>
        <label><span class="req">${t('تاريخ الانتهاء')}</span><input type="date" name="expiryDate" value="${esc(x.expiryDate || '')}"></label>
        <div id="pm-dep" style="grid-column:1/-1"></div>
        <div class="small" id="pm-cap" style="grid-column:1/-1"></div>
        ${places.length ? `<div class="full"><div class="small muted" style="margin-bottom:4px">${t('الأماكن')}</div>
          <div class="row" style="flex-wrap:wrap;gap:4px 14px">${places.map(pl => `<label class="check"><input type="checkbox" data-place="${pl.id}" ${(x.placeIds || []).includes(pl.id) ? 'checked' : ''}> ${esc(permitPlaceName(pl))}</label>`).join('')}</div></div>` : ''}
        <label class="full">${t('ملاحظات')}<input name="notes" value="${esc(x.notes || '')}"></label>
        <div class="full"><div class="small muted" style="margin-bottom:4px">${t('المرفق (صورة أو PDF — للعرض والطباعة بس)')}</div>
          ${p ? `<div class="row">${p.fileUrl ? `<button type="button" class="btn sm" data-file-view>📎 ${esc(p.fileName || t('عرض المرفق'))}</button>` : `<span class="muted small">${t('مفيش مرفق')}</span>`}
              <span class="write-only" data-p="permits.edit"><button type="button" class="btn sm" data-file-up>⬆️ ${p.fileUrl ? t('تغيير المرفق') : t('رفع مرفق')}</button>
              ${p.fileUrl ? `<button type="button" class="btn sm danger" data-file-del>🗑️</button>` : ''}</span></div>`
            : `<input type="file" name="file" accept=".pdf,image/*">`}</div>
      </div>
      ${p ? `<div class="small muted" style="margin-top:8px">${t('آخر تعديل')}: ${fmtDateTime(p.updatedAt)} ${esc(p.updatedBy || '')}</div>` : ''}`,
    foot: `${p ? `<button class="btn danger write-only" data-p="permits.delete" data-permit-del>🗑️ ${t('حذف')}</button><button class="btn write-only" data-p="permits.edit" data-renew>🔄 ${t('تجديد')}</button>
      <button class="btn write-only" data-p="permits.edit" data-another>➕ ${t(kind === 'employee' ? 'تصريح تاني لنفس الموظف' : 'تصريح تاني لنفس السيارة')}</button><span class="spacer"></span>` : ''}
      <button class="btn primary write-only" data-p="permits.edit" data-save>${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const pickedHolder = () => pickedPermitHolder(E, kind, fixedHolder);
  const expInp = $('[name=expiryDate]', E), projSel = $('[name=projectId]', E), typeSel = $('[name=typeId]', E), issuerInp = $('[name=issuer]', E);
  /** النوع المعتمد (الرتقة ← KOC): الأساسي بتاعه — في التعديل اللي مربوط بيه، وفي الجديد الساري الأبعد عند صاحبه */
  const depNow = () => {
    const req = permitReqType(typeSel.value), hid = pickedHolder();
    if (!req) return null;
    const par = p && p.typeId === typeSel.value && permitParent(p) ? permitParent(p) : hid ? holderParentPermit(kind, hid, req.id) : null;
    return { req, same: !!(IDX.permitType[typeSel.value] || {}).sameExpiry, par };
  };
  // التجديد: الأساسي لسه نفسه (الـ KOC ماتجددش) ← مفيش تاريخ جديد يتجدد له
  const staleRenew = dep => !!(renewOf && dep && dep.par && renewOf.parentId === dep.par.id);
  // أقصى تاريخ = أقرب تاريخ (الإقامة / العقد المختار / التأمين / الدفتر) ← بيتحط لوحده في التصريح الجديد، والتاريخ بعده ممنوع
  let autoExp = '', autoProj = projSel.value, lastHid = fixedHolder;
  const syncCap = () => {
    const hid = pickedHolder(), h = hid ? holderOf(kind, hid) : null, dep = depNow(), box = $('#pm-dep', E);
    if (!p && hid !== lastHid) {
      if (!projSel.value || projSel.value === autoProj) { autoProj = permitDefaultProject(h); projSel.value = autoProj; }
      lastHid = hid;
    }
    const tn = esc(permitTypeName(IDX.permitType[typeSel.value]));
    if (dep && dep.same) {                      // التاريخ والعقد بتوع الأساسي
      expInp.readOnly = true; projSel.disabled = true;
      if (dep.par) {
        expInp.value = dep.par.expiryDate || '';
        if (!p) autoExp = expInp.value;
        if (dep.par.projectId && !$$('option', projSel).some(o => o.value === dep.par.projectId)) projSel.innerHTML = permitProjectOptions(dep.par.projectId);
        projSel.value = dep.par.projectId || '';
      }
      const rn = esc(permitTypeName(dep.req));
      box.innerHTML = !dep.par ? `<div class="notice warn">⛔ «${tn}» ${t('مابيطلعش غير لو معاه')} «${rn}» ${t('ساري — ضيفه الأول.')}</div>`
        : staleRenew(dep) ? `<div class="notice warn">🔄 «${rn}»${esc(permitNoText(dep.par))} ${t('لسه ماتجددش (ساري لحد')} ${fmtDate(dep.par.expiryDate)}) — ${t('جدّده الأول، وبعد ما تستلمه جدّد')} «${tn}».</div>`
        : `<div class="notice">🔗 ${t('مربوط بـ')} «${rn}»${esc(permitNoText(dep.par))} — ${t('ساري لحد')} ${fmtDate(dep.par.expiryDate)} · ${t('العقد')}: ${esc(permitProjectLabel(dep.par.projectId, false))}. ${t('التاريخ والعقد بيمشوا معاه.')}</div>`;
      $('#pm-cap', E).innerHTML = '';
      return;
    }
    expInp.readOnly = false; projSel.disabled = false;
    box.innerHTML = dep && !dep.par ? `<div class="notice warn">⛔ «${tn}» ${t('مابيطلعش غير لو معاه')} «${esc(permitTypeName(dep.req))}» ${t('ساري — ضيفه الأول.')}</div>` : '';
    const cs = hid ? permitCaps(kind, h, projSel.value) : [];
    if (dep && dep.par && dep.par.expiryDate) { cs.push({ l: permitTypeName(dep.req), d: dep.par.expiryDate }); cs.sort((a, b) => a.d.localeCompare(b.d)); }
    expInp.max = cs.length ? cs[0].d : '';
    if (!p && cs.length && (!expInp.value || expInp.value === autoExp)) { expInp.value = cs[0].d; autoExp = cs[0].d; }
    const reg = h && h.projectId && IDX.project[h.projectId];
    $('#pm-cap', E).innerHTML = !hid ? '' : !projSel.value ? `<span style="color:var(--orange)">⚠️ ${t('اختار العقد اللي التصريح طالع عليه — هو اللي بيحدد أقصى تاريخ')}</span>`
      : permitCapText(kind, hid, cs) + (reg && projSel.value !== reg.id ? `<div>ℹ️ ${t(kind === 'employee' ? 'الموظف مسجّل على' : 'السيارة مسجّلة على')} <b>${esc(projectName(reg.id))}</b> — ${t('التصريح طالع على')} <b>${esc(projectName(projSel.value))}</b></div>` : '');
  };
  syncCap();
  projSel.onchange = syncCap;
  const pick = $('[name=holderPick]', E);
  if (pick) {
    const show = () => { const hid = pickedHolder(); $('#permit-holder', E).innerHTML = hid ? holderCardHtml(kind, holderOf(kind, hid)) : ''; syncCap(); };
    pick.addEventListener('change', show);
    pick.addEventListener('input', show);
    pick.focus();
  }
  // الجهة المانحة الافتراضية للنوع (لو الخانة فاضية أو فيها افتراضي نوع تاني)
  let lastDefault = (IDX.permitType[typeSel.value] || {}).defaultIssuer || '';
  typeSel.addEventListener('change', () => {
    const def = (IDX.permitType[typeSel.value] || {}).defaultIssuer || '';
    if (!issuerInp.value.trim() || issuerInp.value.trim() === lastDefault) issuerInp.value = def;
    lastDefault = def;
    syncCap();
  });
  $('[data-save]', E).onclick = async ev => {
    const d = formValues(E), hid = pickedHolder(), dep = depNow();
    if (!hid) return openBlockAlert(t(kind === 'employee' ? 'اختار الموظف من القايمة' : 'اختار السيارة'));
    if (!d.typeId) return openBlockAlert(t('اختار نوع التصريح'));
    const tn = permitTypeName(IDX.permitType[d.typeId]);
    if (dep && !dep.par) return openBlockAlert(`«${tn}» ${t('مابيطلعش غير لو معاه')} «${permitTypeName(dep.req)}» ${t('ساري — ضيفه الأول.')}`);
    if (staleRenew(dep)) return openBlockAlert(`«${permitTypeName(dep.req)}» ${t('لسه ماتجددش — جدّده الأول، وبعد ما تستلمه جدّد')} «${tn}».`);
    const same = !!(dep && dep.same), projectId = projSel.value;
    if (!same && !projectId) return openBlockAlert(t('اختار العقد اللي التصريح طالع عليه'));
    if (!d.expiryDate) return openBlockAlert(t('تاريخ الانتهاء مطلوب'));
    if (d.issueDate && d.issueDate > d.expiryDate) return openBlockAlert(t('تاريخ الإصدار بعد تاريخ الانتهاء'));
    if (!same) {
      const caps = permitCaps(kind, holderOf(kind, hid), projectId);
      if (dep && dep.par && dep.par.expiryDate) { caps.push({ l: permitTypeName(dep.req), d: dep.par.expiryDate }); caps.sort((a, b) => a.d.localeCompare(b.d)); }
      if (caps.length && d.expiryDate > caps[0].d) return openBlockAlert(`${t('مش هينفع: التصريح بينتهي بعد')} ${caps[0].l} (${fmtDate(caps[0].d)}). ${t(kind === 'employee' ? 'لو اتجدد، حدّث تاريخه في مركز الإقامات والموظفين أو العقود الأول.' : 'لو اتجدد، حدّث تاريخه في مركز السيارات أو العقود الأول.')}`);
    }
    const placeIds = $$('[data-place]', E).filter(c => c.checked).map(c => c.dataset.place);
    const payload = { holderKind: kind, holderId: hid, typeId: d.typeId, permitNo: d.permitNo, issuer: d.issuer, projectId,
      issueDate: d.issueDate, expiryDate: d.expiryDate, notes: d.notes, parentId: dep && dep.par ? dep.par.id : undefined,
      placeIds: places.length ? placeIds : (p ? p.placeIds || [] : x.placeIds || []) };
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
  $('[data-renew]', E).onclick = () => {
    m.close();
    openPermitModal(null, p.holderKind, { holderId: permitHolderId(p), typeId: p.typeId, issuer: p.issuer, placeIds: p.placeIds, projectId: p.projectId, renewOf: p.id });
  };
  $('[data-another]', E).onclick = () => { m.close(); openPermitAddModal(p.holderKind, { holderId: permitHolderId(p) }); };
  bindHolderPermits(E, () => m.close());
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
    // التصاريح المربوطة بيه (الرتقة مع الـ KOC) بتتنقل للسلة معاه وبترجع معاه
    const linked = kids.length ? `\n${t('ومعاه المربوط بيه')}: ${kids.map(k => `«${esc(permitLabel(k))}${esc(permitNoText(k))}»`).join('، ')} — ${t('هيتنقلوا للسلة مع بعض ويرجعوا مع بعض.')}` : '';
    if (!await openConfirm(`${t('حذف التصريح')} «${esc(permitLabel(p))}${p.permitNo ? ' ' + esc(p.permitNo) : ''}» — ${esc(permitHolderName(p))}؟${linked}\n${trashNote()}`, { danger: true, okLabel: t('حذف') })) return;
    try { m.close(); await persist('DELETE', `/api/permits/${p.id}${kids.length ? '?linked=1' : ''}`, undefined, 'اتنقل لسلة المحذوفات'); } catch (_) { /* */ }
  };
}

/* ---------- 🪪 بطاقة التصاريح (لكل موظف أو عربية) ----------
   بيانات صاحب التصريح (للعرض)، كارت لكل نوع بحالته و«📅 التجديد» (ينفع يتجدد إمتى، ولو اتجدد هيطلع لحد إمتى وهتكسب
   قد إيه، ومين مقصّر المدة: الإقامة / العقد / التأمين / الدفتر)، والتصاريح الحالية والقديمة والمرفقات، و«السجل»
   (permit_log)، وطباعة البطاقة، وقايمة «نماذج التصاريح» (هتتملى لما النماذج توصل). */
const RESIDENCY_RENEW_DAYS = 90;          // الإقامة بتتجدد في آخر 90 يوم قبل انتهاؤها (مش قبل كده)
const PERMIT_LOG_ICONS = { add: '➕', edit: '✏️', delete: '🗑️', file: '📎', print: '🖨️', form: '📄' };
function permitWindowDays(typeId) { const tp = IDX.permitType[typeId]; return (tp && tp.renewWindowDays) || 30; }
/** المدة بين تاريخين بالشهور والأيام («3 شهور و1 يوم») */
function permitGainText(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1), days = d2 - d1;
  if (days < 0) { months -= 1; days += new Date(y2, m2 - 1, 0).getDate(); }
  const years = Math.floor(months / 12);
  months %= 12;
  const unit = (n, ar, en) => (LANG === 'en' ? `${n} ${n === 1 ? en : en + 's'}` : `${n} ${t(ar)}`);
  return [years ? unit(years, 'سنة', 'year') : '', months ? unit(months, 'شهر', 'month') : '', days ? unit(days, 'يوم', 'day') : '']
    .filter(Boolean).join(LANG === 'en' ? ', ' : ` ${t('و')}`) || t('أقل من يوم');
}
/** التجديد لتصريح حالي: [{ico, text, tone}] — tone: ok | warn | bad | '' */
function permitRenewLines(p) {
  const kind = p.holderKind, h = permitHolder(p), req = permitReqType(p.typeId), today = todayISO(), out = [];
  const left = daysUntil(p.expiryDate);
  out.push({ ico: '⏳', text: `${t('بينتهي')} ${fmtDate(p.expiryDate)} (${daysText(left)})`, tone: left < 0 ? 'bad' : left <= 30 ? 'warn' : '' });
  if (req) {                                   // الرتقة: بيتجدد مع الـ KOC بتاعه
    const par = permitParent(p), nw = permitDepRenew(p), rn = permitTypeName(req);
    out.push(nw ? { ico: '✅', text: `${rn} ${t('اتجدد لحد')} ${fmtDate(nw.expiryDate)} — ${t('ينفع يتجدد دلوقتي على الجديد')}`, tone: 'ok' }
      : { ico: '🔗', text: `${t('بيتجدد مع')} ${rn}${par ? ` (${t('ينتهي')} ${fmtDate(par.expiryDate)})` : ''} — ${t('جدّد')} ${rn} ${t('الأول')}` });
    return out;
  }
  const win = permitWindowDays(p.typeId), from = addDays(p.expiryDate, -win);
  out.push(today >= from ? { ico: '✅', text: `${t('ينفع يتجدد دلوقتي')} (${t('آخر')} ${win} ${t('يوم')})`, tone: 'ok' }
    : { ico: '📅', text: `${t('ينفع يتجدد من')} ${fmtDate(from)} (${t('آخر')} ${win} ${t('يوم')})` });
  const cs = permitCaps(kind, h, p.projectId), cap = cs[0];
  if (cap && cap.d > p.expiryDate) out.push({ ico: '➕', text: `${t('لو اتجدد هيطلع لحد')} ${fmtDate(cap.d)} (${cap.l}) — ${t('هتكسب')} ${permitGainText(p.expiryDate, cap.d)}`, tone: 'ok' });
  else if (cap) out.push({ ico: '⚠️', text: `${t('التجديد مش هيزوّد حاجة')}: ${cap.l} ${t('لحد')} ${fmtDate(cap.d)} — ${t('جدّد')} ${cap.l} ${t('الأول')}`, tone: 'warn' });
  // الحد اللي مقصّر المدة (الإقامة / التأمين / الدفتر) والعقد بعده ← يتجدد الأول
  const contract = cs.find(c => c.src === 'contract');
  if (cap && cap.src !== 'contract' && contract && contract.d > cap.d) {
    out.push({ ico: '💡', text: `${t('المدة محدودة بـ')}${cap.l} — ${t('جدّد')} ${cap.l} ${t('الأول والتصريح يطلع لحد نهاية العقد')} ${fmtDate(contract.d)} (${t('يعني')} ${permitGainText(p.expiryDate, contract.d)})`, tone: 'warn' });
  }
  return out;
}
/** الإقامة (الموظف): بتنتهي إمتى وتتجدد من إمتى (آخر 90 يوم) — التصريح مايعدّيهاش */
function permitResidencyLines(h) {
  if (!h || !h.residencyExp) return [];
  const from = addDays(h.residencyExp, -RESIDENCY_RENEW_DAYS), left = daysUntil(h.residencyExp);
  return [{ ico: '🪪', text: `${t('الإقامة بتنتهي')} ${fmtDate(h.residencyExp)} (${daysText(left)})`, tone: left < 0 ? 'bad' : left <= 30 ? 'warn' : '' },
    todayISO() >= from ? { ico: '✅', text: `${t('الإقامة ينفع تتجدد دلوقتي')} (${t('آخر')} ${RESIDENCY_RENEW_DAYS} ${t('يوم')})`, tone: 'ok' }
      : { ico: '📅', text: `${t('الإقامة ينفع تتجدد من')} ${fmtDate(from)} (${t('آخر')} ${RESIDENCY_RENEW_DAYS} ${t('يوم')})` }];
}
function permitLinesHtml(lines) {
  return `<ul class="pc-renew">${lines.map(x => `<li class="${x.tone}"><span>${x.ico}</span>${esc(x.text)}</li>`).join('')}</ul>`;
}
/** بيانات صاحب التصريح (للعرض) + الإقامة والعقد / الرخصة والتأمين وملف الشؤون */
function permitHolderInfoHtml(kind, h) {
  const f = (l, v) => `<div><span>${esc(t(l))}</span>${v || '<span class="muted">—</span>'}</div>`;
  const extra = kind === 'employee'
    ? f('الإقامة', h.residencyExp ? datePill(h.residencyExp) : '') + f('العقد المسجّل عليه', esc(permitProjectLabel(h.projectId)))
    : f('الرخصة والتأمين', h.insuranceExpiry ? datePill(h.insuranceExpiry) : '')
      + f('ملف الشؤون', esc(projectName(h.affairsProjectId))) + f('عقد العربية', esc(permitProjectLabel(h.projectId)));
  return holderCardHtml(kind, h, extra);
}
function permitStatusChip(p) {
  const d = daysUntil(p.expiryDate);
  return permitNeedsCancel(p) ? `<span class="chip" style="background:var(--red-soft);color:var(--red)">⚠️ ${t('لازم يتلغي')}</span>`
    : d < 0 ? `<span class="chip" style="background:var(--red-soft);color:var(--red)">${t('منتهي')}</span>`
    : permitDepRenew(p) ? `<span class="chip" style="background:var(--green-soft);color:var(--green)">🔄 ${t('جاهز للتجديد')}</span>`
    : d <= 30 ? `<span class="chip" style="background:var(--orange-soft);color:var(--orange)">${t('خلال 30 يوم')}</span>`
    : `<span class="chip" style="background:var(--green-soft);color:var(--green)">${t('ساري')}</span>`;
}
/** نافذة من البطاقة (فتح تصريح، إضافة، تجديد، مرفق): لما تتقفل البطاقة بترجع — زي بطاقة الموظف */
function returnToPermitCard(kind, hid, tab) {
  returnWhenModalsClosed(`[data-pcard="${CSS.escape(kind + ':' + hid)}"]`, () => { if (holderOf(kind, hid)) openPermitHolderCard(kind, hid, tab); });
}
function openPermitHolderCard(kind, hid, tab = 'current') {
  const h = holderOf(kind, hid);
  if (!h) return toast(t(kind === 'employee' ? 'الموظف ده مش ظاهر عندك' : 'السيارة دي مش ظاهرة عندك'), 'err');
  const all = permitsOf(kind, hid), cur = all.filter(permitCurrent).sort((a, b) => permitLabel(a).localeCompare(permitLabel(b), 'ar'));
  const old = all.filter(permitSuperseded).sort((a, b) => String(b.expiryDate).localeCompare(String(a.expiryDate)));
  const files = all.filter(p => p.fileUrl), types = permitTypesFor(kind), edit = can('permits.edit');
  const tile = tp => {
    const ps = holderCurrentPermits(kind, hid, tp.id), p = ps[ps.length - 1];
    if (!p) return `<div class="pc-tile none"><div class="pc-tile-h"><b>${esc(permitTypeName(tp))}</b></div><div class="muted small">${t('مفيش تصريح')}</div>
      ${edit ? `<button class="btn sm write-only" data-p="permits.edit" data-pc-add="${tp.id}">➕ ${t('إضافة')}</button>` : ''}</div>`;
    const d = daysUntil(p.expiryDate), cls = permitNeedsCancel(p) || d < 0 ? 'bad' : d <= 30 || permitDepRenew(p) ? 'warn' : 'ok';
    return `<div class="pc-tile ${cls}"><div class="pc-tile-h"><b>${esc(permitTypeName(tp))}</b>${permitStatusChip(p)}</div>
      <div class="small"><span class="muted">${t('رقم')}</span> <b class="num" dir="ltr">${esc(p.permitNo || '—')}</b>${ps.length > 1 ? ` <span class="chip">+${ps.length - 1}</span>` : ''}</div>
      <div class="small muted">${esc(permitProjectLabel(p.projectId, false) || t('من غير عقد'))}</div>
      ${permitLinesHtml(permitRenewLines(p))}
      <div class="row" style="gap:4px;margin-top:6px"><button class="btn sm" data-pc-open="${p.id}">${t('فتح')}</button>
        ${edit ? `<button class="btn sm write-only" data-p="permits.edit" data-pc-renew="${p.id}">🔄 ${t('تجديد')}</button>` : ''}
        ${p.fileUrl ? `<button class="btn sm" data-pc-file="${p.id}" title="${esc(t('عرض المرفق'))}">📎</button>` : ''}</div></div>`;
  };
  const row = (p, oldRow) => `<tr class="clickable${oldRow ? ' muted' : ''}" data-pc-open="${p.id}"><td>${esc(permitLabel(p))}</td><td class="num" dir="ltr">${esc(p.permitNo || '')}</td>
    <td>${esc(projectName(p.projectId)) || '—'}</td><td>${esc(p.issuer || '')}</td><td>${fmtDate(p.issueDate)}</td>
    <td>${oldRow ? fmtDate(p.expiryDate) : datePill(p.expiryDate) + permitFlagsHtml(p)}</td><td>${p.fileUrl ? `<button class="btn sm" data-pc-file="${p.id}">📎</button>` : ''}</td></tr>`;
  const table = (list, oldRows) => list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>${t('النوع')}</th><th>${t('الرقم')}</th><th>${t('العقد')}</th><th>${t('الجهة المانحة')}</th><th>${t('الإصدار')}</th><th>${t('الانتهاء')}</th><th></th></tr></thead>
    <tbody>${list.map(p => row(p, oldRows)).join('')}</tbody></table></div>` : `<div class="empty">${t('لا يوجد')}</div>`;
  const m = openModal({
    title: `${PERMIT_HOLDERS[kind].ico} ${t('بطاقة التصاريح')} — ${esc(holderName(kind, h))}`, size: 'wide',
    body: `<div class="pc-top">${permitHolderInfoHtml(kind, h)}${kind === 'employee' && h.residencyExp ? `<div class="pc-res">${permitLinesHtml(permitResidencyLines(h))}</div>` : ''}</div>
      <div class="pc-tiles">${types.map(tile).join('')}</div>
      <div class="tabs" style="margin-top:12px">${[['current', `${t('التصاريح الحالية')} (${cur.length})`], ['old', `${t('التصاريح القديمة')} (${old.length})`],
        ['files', `📎 ${t('المرفقات')} (${files.length})`], ['log', `🕘 ${t('السجل')}`]].map(([k, l]) => `<button data-pc-tab="${k}" class="${k === tab ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>
      <div data-pc-pane="current" ${tab !== 'current' ? 'hidden' : ''}>${table(cur, false)}</div>
      <div data-pc-pane="old" ${tab !== 'old' ? 'hidden' : ''}>${table(old, true)}<div class="small muted" style="margin-top:6px">${t('التصاريح اللي اتجدّدت — للتاريخ بس، مالهاش تنبيهات.')}</div></div>
      <div data-pc-pane="files" ${tab !== 'files' ? 'hidden' : ''}>${files.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${files.map(p => `<button class="btn sm" data-pc-file="${p.id}">📎 ${esc(permitLabel(p))}${p.permitNo ? ' ' + esc(p.permitNo) : ''}${permitSuperseded(p) ? ` <span class="small muted">(${t('مُجدَّد')})</span>` : ''}</button>`).join('')}</div>`
        : `<div class="empty">${t('مفيش مرفقات')}</div>`}</div>
      <div data-pc-pane="log" ${tab !== 'log' ? 'hidden' : ''}><div id="pc-log"><div class="muted">${t('جاري التحميل…')}</div></div></div>`,
    foot: `${edit ? `<button class="btn primary write-only" data-p="permits.edit" data-pc-add="">➕ ${t('إضافة تصريح')}</button>` : ''}
      <button class="btn" data-pc-print>🖨️ ${t('طباعة بطاقة التصاريح')}</button>
      <details class="ec-menu"><summary class="btn">📄 ${t('نماذج التصاريح')} ▾</summary><div><div class="small muted" style="padding:8px 10px;max-width:260px">${t('لسه مفيش نماذج — هتتضاف هنا لما تبعتها، وهتتملى من بيانات البطاقة.')}</div></div></details>
      <span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const E = m.el;
  E.dataset.pcard = `${kind}:${hid}`;
  const curTab = () => ($('[data-pc-tab].active', E) || {}).dataset?.pcTab || tab;
  const sub = fn => { const tb = curTab(); m.close(); fn(); returnToPermitCard(kind, hid, tb); };
  let logLoaded = false;
  const loadLog = async () => {
    if (logLoaded) return;
    logLoaded = true;
    try {
      const r = await api('GET', `/api/permits/log/${kind}/${encodeURIComponent(hid)}`);
      $('#pc-log', E).innerHTML = r.log.length ? `<ul class="timeline">${r.log.map(x => `<li><span class="muted small">${fmtDateTime(x.date)} · ${esc(x.user || '')}</span><br>${PERMIT_LOG_ICONS[x.action] || '•'} ${esc(x.label || '')}</li>`).join('')}</ul>`
        : `<div class="empty">${t('مفيش حاجة متسجّلة لسه')}</div>`;
    } catch (e) { $('#pc-log', E).innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
  };
  $$('[data-pc-tab]', E).forEach(b => b.onclick = () => {
    $$('[data-pc-tab]', E).forEach(x => x.classList.toggle('active', x === b));
    $$('[data-pc-pane]', E).forEach(p => { p.hidden = p.dataset.pcPane !== b.dataset.pcTab; });
    if (b.dataset.pcTab === 'log') loadLog();
  });
  if (tab === 'log') loadLog();
  E.addEventListener('click', ev => $$('details.ec-menu[open]', E).forEach(d => { if (!d.contains(ev.target)) d.open = false; }));
  $$('[data-pc-open]', E).forEach(el => el.onclick = ev => { if (ev.target.closest('[data-pc-file]')) return; sub(() => openPermitModal(el.dataset.pcOpen)); });
  $$('[data-pc-renew]', E).forEach(b => b.onclick = () => {
    const p = IDX.permit[b.dataset.pcRenew];
    sub(() => openPermitModal(null, kind, { holderId: hid, typeId: p.typeId, issuer: p.issuer, placeIds: p.placeIds, projectId: p.projectId, renewOf: p.id }));
  });
  $$('[data-pc-add]', E).forEach(b => b.onclick = () => sub(() => openPermitAddModal(kind, { holderId: hid, typeId: b.dataset.pcAdd || undefined })));
  $$('[data-pc-file]', E).forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const p = IDX.permit[b.dataset.pcFile];
    if (p && p.fileUrl) openFileViewer(p.fileUrl, p.fileName || t('مرفق التصريح'));
  });
  $('[data-pc-print]', E).onclick = () => printPermitHolderCard(kind, hid);
}
/** طباعة بطاقة التصاريح: A4 طولي زي بطاقة الموظف (شعار الشركة، من غير توقيعات) + آخر 15 سطر في السجل */
async function printPermitHolderCard(kind, hid) {
  const h = holderOf(kind, hid);
  if (!h) return;
  let log = [];
  try { log = (await api('GET', `/api/permits/log/${kind}/${encodeURIComponent(hid)}`)).log.slice(0, 15); } catch (_) { /* السجل اختياري في الطباعة */ }
  const cur = permitsOf(kind, hid).filter(permitCurrent).sort((a, b) => permitLabel(a).localeCompare(permitLabel(b), 'ar'));
  const tier = d => (TIERS[tierOf(d)] || {}).cls || '';
  const sec = (title, body) => `<section class="ec-sec"><h3>${title}</h3>${body}</section>`;
  const name = holderName(kind, h);
  const fields = kind === 'employee'
    ? [['الرقم المدني', `<span class="num">${esc(h.id)}</span>`], ['الجنسية', esc(personNat(h))], ['المهنة', esc(personProf(h))], ['الشركة', esc(companyName(h.companyId))],
       ['مركز التكلفة', esc(ccLabel(h.costCenter))], ['رقم الملف', h.fileNo ? `<span class="num">${esc(h.fileNo)}</span>` : ''],
       ['الإقامة', h.residencyExp ? `<span class="pill ${tier(h.residencyExp)}">${fmtDate(h.residencyExp)}</span>` : ''], ['العقد المسجّل عليه', esc(permitProjectLabel(h.projectId))]]
    : [['رقم اللوحة', `<span class="num">${esc(h.plate)}</span>`], ['نوع المركبة', esc(t(VEHICLE_TYPES[h.vehicleType] || ''))], ['الموديل', esc(h.model || '')],
       ['الشركة', esc(companyName(h.companyId))], ['مع مين', esc(holderDriver(h))], ['مركز التكلفة', esc(ccLabel(h.costCenter))],
       ['الرخصة والتأمين', h.insuranceExpiry ? `<span class="pill ${tier(h.insuranceExpiry)}">${fmtDate(h.insuranceExpiry)}</span>` : ''], ['ملف الشؤون', esc(projectName(h.affairsProjectId))]];
  const res = kind === 'employee' ? permitResidencyLines(h) : [];
  const body = `<style>${EMP_CARD_PRINT_CSS} .pc-renew{margin:0;padding:0;list-style:none;font-size:9.5px;line-height:1.5} .pc-renew li span{margin-inline-end:4px}</style>
    <div class="ec-id"><div class="ec-av">${esc(kind === 'employee' ? initials(h.name) : '🚗')}</div>
      <div><div class="ec-name">${esc(name)}</div>${kind === 'employee' && h.nameEn ? `<div class="ec-en">${esc(h.nameEn)}</div>` : ''}
        <div class="ec-tags">${cur.map(p => `<span class="ec-tag">${esc(permitLabel(p))} · ${fmtDate(p.expiryDate)}</span>`).join('') || `<span class="ec-tag">${t('مفيش تصاريح حالية')}</span>`}</div></div>
      <table class="ec-keys">${(kind === 'employee' ? [['الرقم المدني', h.id], ['رقم الملف', h.fileNo]] : [['رقم اللوحة', h.plate], ['الموديل', h.model]])
        .map(([l, v]) => `<tr><th>${esc(t(l))}</th><td>${esc(v || '—')}</td></tr>`).join('')}</table></div>
    ${sec(`${PERMIT_HOLDERS[kind].ico} ${esc(t(kind === 'employee' ? 'بيانات الموظف' : 'بيانات السيارة'))}`, empKvTable(fields))}
    ${res.length ? sec(`🪪 ${esc(t('الإقامة'))}`, permitLinesHtml(res)) : ''}
    ${sec(`🪪 ${esc(t('التصاريح الحالية'))}`, cur.length ? `<table class="rpt"><thead><tr><th class="txt">${t('النوع')}</th><th>${t('الرقم')}</th><th class="txt">${t('العقد')}</th><th>${t('الإصدار')}</th><th>${t('الانتهاء')}</th><th class="txt">${t('التجديد')}</th></tr></thead>
      <tbody>${cur.map(p => `<tr><td class="txt"><b>${esc(permitLabel(p))}</b></td><td class="num">${esc(p.permitNo || '—')}</td><td class="txt">${esc(projectName(p.projectId)) || '—'}</td>
        <td class="num">${fmtDate(p.issueDate) || '—'}</td><td class="num"><span class="pill ${tier(p.expiryDate)}">${fmtDate(p.expiryDate)}</span></td>
        <td class="txt">${permitLinesHtml(permitRenewLines(p).slice(1))}</td></tr>`).join('')}</tbody></table>` : `<div class="ec-none">${t('مفيش تصاريح حالية')}</div>`)}
    ${log.length ? sec(`🕘 ${esc(t('سجل التصاريح'))} (${t('آخر')} ${log.length})`, `<table class="rpt"><thead><tr><th>${t('التاريخ')}</th><th class="txt">${t('العملية')}</th><th>${t('بواسطة')}</th></tr></thead>
      <tbody>${log.map(x => `<tr><td class="num">${fmtDateTime(x.date)}</td><td class="txt">${PERMIT_LOG_ICONS[x.action] || '•'} ${esc(x.label || '')}</td><td>${esc(x.user || '')}</td></tr>`).join('')}</tbody></table>`) : ''}`;
  openReportWindow({ title: t('بطاقة التصاريح'), subtitle: name, company: IDX.company[h.companyId] || null, landscape: false,
    meta: [[t(kind === 'employee' ? 'الرقم المدني' : 'رقم اللوحة'), kind === 'employee' ? h.id : h.plate]], body });
  printLog(`${t('بطاقة التصاريح')}: ${name}`, 'permit');
  api('POST', '/api/permits/log', { holderKind: kind, holderId: hid, action: 'print', label: `طباعة بطاقة التصاريح` }).catch(() => {});
}

/* ---------- قسم التصاريح: قايمتين (الموظفين / السيارات) ---------- */
/** تصاريح نوع واحد (صاحبها ظاهر للمستخدم). الحالية بس إلا لو withOld، والموظفين اللي خدمتهم انتهت مخفيين إلا لو withEnded */
function allPermits(kind, withEnded, withOld) {
  return (STATE.permits || []).filter(p => {
    if (p.holderKind !== kind || (!withOld && permitSuperseded(p))) return false;
    const h = permitHolder(p);
    return !!h && (kind !== 'employee' || withEnded || !empEnded(h) || permitNeedsCancel(p));
  });
}
function holderMatches(kind, h, q) {
  if (!q) return true;
  const hay = kind === 'employee' ? [h.name, h.nameEn, h.id, h.fileNo, h.nationality, h.profession, h.costCenter] : [h.plate, h.model, h.driverName, h.costCenter];
  return [...hay, companyName(h.companyId)].some(v => norm(v).includes(q));
}
function permitsFiltered(kind, F) {
  const q = norm(F.q);
  return allPermits(kind, F.ended, F.old).filter(p => {
    const h = permitHolder(p);
    if (F.type && p.typeId !== F.type) return false;
    if (F.place && !(F.place === '__none' ? !(p.placeIds || []).length : (p.placeIds || []).includes(F.place))) return false;
    if (F.company && h.companyId !== F.company) return false;
    if (F.tier && !tierIn(p.expiryDate, F.tier)) return false;
    if (F.status && !permitStatusIs(p, F.status)) return false;
    return !q || holderMatches(kind, h, q) || [p.permitNo, p.issuer, permitLabel(p), permitPlacesText(p), p.notes].some(v => norm(v).includes(q));
  }).sort((a, b) => String(a.expiryDate || '').localeCompare(String(b.expiryDate || '')));
}
function permitRowHtml(kind, p, showPlaces) {
  const h = permitHolder(p), old = permitSuperseded(p);
  const holderCells = kind === 'employee'
    ? `<td><a href="#" class="pc-link" data-holder="${esc(h.id)}" title="${esc(t('بطاقة التصاريح'))}"><b>${esc(holderName(kind, h))}</b></a>${empEnded(h) ? ' ' + statusPill(h.employmentStatus) : ''}<div class="small muted num">${esc(h.id)}</div></td>
       <td>${esc(personNat(h))}<div class="small muted">${esc(personProf(h))}</div></td>
       <td>${esc(companyName(h.companyId))}<div class="small muted">${esc(ccLabel(h.costCenter))}</div></td>`
    : `<td><a href="#" class="pc-link" data-holder="${esc(h.id)}" title="${esc(t('بطاقة التصاريح'))}"><b class="num">${esc(h.plate)}</b></a><div class="small muted">${esc([t(VEHICLE_TYPES[h.vehicleType] || ''), h.model].filter(Boolean).join(' · '))}</div></td>
       <td>${esc(companyName(h.companyId))}<div class="small muted">${esc(ccLabel(h.costCenter))}</div></td>
       <td>${esc(holderDriver(h)) || '<span class="muted">—</span>'}</td>`;
  return `<tr class="clickable${old ? ' muted' : ''}" data-id="${p.id}">${holderCells}<td>${esc(permitLabel(p))}${old ? ` <span class="chip">${t('مُجدَّد')}</span>` : ''}${p.projectId ? `<div class="small muted">${esc(projectName(p.projectId))}</div>` : ''}</td><td class="num" dir="ltr" style="white-space:nowrap">${esc(p.permitNo || '')}</td>
    <td>${esc(p.issuer || '')}</td>${showPlaces ? `<td>${permitPlaceChips(p)}</td>` : ''}<td>${fmtDate(p.issueDate)}</td><td>${old ? fmtDate(p.expiryDate) : datePill(p.expiryDate) + permitFlagsHtml(p)}</td>
    <td>${p.fileUrl ? `<button class="btn sm" data-permit-file="${p.id}" title="${esc(t('عرض المرفق'))}">📎</button>` : ''}</td></tr>`;
}
/** صفوف المصفوفة: أصحاب التصاريح (أو كل الموظفين / العربيات مع mAll أو «مش عنده») × الأنواع */
function permitMatrixRows(kind, F) {
  const q = norm(F.q), types = permitTypesFor(kind);
  const hs = ((STATE.permitHolders || {})[kind === 'employee' ? 'employees' : 'vehicles'] || [])
    .filter(h => (kind !== 'employee' || F.ended || !empEnded(h) || permitsOf(kind, h.id).some(permitNeedsCancel))
      && (!F.company || h.companyId === F.company) && holderMatches(kind, h, q));
  const rows = hs.map(h => ({ h, cells: types.map(tp => holderCurrentPermits(kind, h.id, tp.id)) }));
  const showAll = F.mAll || F.mState === 'none';
  return rows.filter(r => {
    if (!showAll && !r.cells.some(c => c.length)) return false;
    if (!F.mType || !F.mState) return true;
    const c = r.cells[types.findIndex(tp => tp.id === F.mType)] || [];
    const d = c.length ? daysUntil(c[0].expiryDate) : null;
    return F.mState === 'has' ? c.length > 0 : F.mState === 'none' ? !c.length
      : F.mState === 'expired' ? c.length > 0 && PERMIT_STATUS.expired.test(d) : c.length > 0 && PERMIT_STATUS.soon.test(d);
  }).sort((a, b) => holderName(kind, a.h).localeCompare(holderName(kind, b.h), 'ar'));
}
function permitMatrixHtml(kind, rows) {
  const types = permitTypesFor(kind);
  const head = kind === 'employee' ? ['الموظف', 'الشركة / مكان الشغل'] : ['اللوحة', 'الشركة / مكان الشغل'];
  return `<div class="table-wrap"><table class="data"><thead><tr>${head.map(x => `<th>${t(x)}</th>`).join('')}${types.map(tp => `<th style="text-align:center">${esc(permitTypeName(tp))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(({ h, cells }) => `<tr><td><a href="#" class="pc-link" data-holder="${esc(h.id)}" title="${esc(t('بطاقة التصاريح'))}"><b class="${kind === 'vehicle' ? 'num' : ''}">${esc(holderName(kind, h))}</b></a>${kind === 'employee' && empEnded(h) ? ' ' + statusPill(h.employmentStatus) : ''}
        <div class="small muted num">${esc(kind === 'employee' ? h.id : [t(VEHICLE_TYPES[h.vehicleType] || ''), h.model].filter(Boolean).join(' · '))}</div></td>
      <td>${esc(companyName(h.companyId))}<div class="small muted">${esc(ccLabel(h.costCenter))}</div></td>
      ${cells.map((c, i) => c.length
        ? `<td class="clickable" style="text-align:center" data-pid="${c[0].id}" title="${esc(c.map(p => (p.permitNo || '') + ' ' + fmtDate(p.expiryDate)).join(' · '))}">${datePill(c[0].expiryDate)}${c.length > 1 ? ` <small class="muted">+${c.length - 1}</small>` : ''}${c.some(permitNeedsCancel) ? ` <span title="${esc(t('لازم يتلغي'))}">⚠️</span>` : ''}</td>`
        : `<td class="clickable muted" style="text-align:center" data-add="${esc(h.id)}|${types[i].id}" title="${esc(t('إضافة تصريح'))}">—</td>`).join('')}</tr>`).join('')
      || `<tr><td colspan="${2 + types.length}" class="empty">${t('لا توجد تصاريح')}</td></tr>`}</tbody></table></div>`;
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
  if (focus) F.view = 'list';
  const types = permitTypesFor(kind), places = STATE.permitPlaces || [], showPlaces = permitHasPlaces();
  if (F.type && !types.some(tp => tp.id === F.type)) F.type = '';
  if (F.mType && !types.some(tp => tp.id === F.mType)) F.mType = '';
  const matrix = F.view === 'matrix';
  const all = allPermits(kind, F.ended, false), list = matrix ? [] : permitsFiltered(kind, F);
  const mrows = matrix ? permitMatrixRows(kind, F) : [];
  const cos = uniq(((STATE.permitHolders || {})[kind === 'employee' ? 'employees' : 'vehicles'] || []).map(h => h.companyId)).filter(c => IDX.company[c]).sort((a, b) => companyName(a).localeCompare(companyName(b), 'ar'));
  const cnt = st => all.filter(p => permitStatusIs(p, st)).length;
  // «الرتقة محتاج يتجدد»: الـ KOC بتاعه اتجدّد (بيظهر بس لو فيه)
  const depTypes = types.filter(tp => permitReqType(tp.id)), nRenew = cnt('renew');
  const renewLabel = depTypes.length === 1 ? `${permitTypeName(depTypes[0])} ${t('محتاج يتجدد')}` : PERMIT_STATUS.renew.l;
  const chip = (st, label, n, color) => `<span class="chip clickable ${F.status === st ? 'on' : ''}" data-status="${st}"${color ? ` style="color:${color}"` : ''}>${esc(t(label))} <b class="num">${n}</b></span>`;
  const heads = kind === 'employee' ? ['الموظف', 'الجنسية / المهنة', 'الشركة / مكان الشغل'] : ['اللوحة', 'الشركة / مكان الشغل', 'مع مين'];
  const listFilters = `<select id="pm-type">${opt('', t('— كل الأنواع —'), !F.type)}${types.map(tp => opt(tp.id, permitTypeName(tp), tp.id === F.type)).join('')}</select>
      ${showPlaces ? `<select id="pm-place">${opt('', t('— كل الأماكن —'), !F.place)}${opt('__none', t('بدون مكان'), F.place === '__none')}${places.map(pl => opt(pl.id, permitPlaceName(pl), pl.id === F.place)).join('')}</select>` : ''}
      <select id="pm-tier">${opt('', t('— كل المستويات —'), !F.tier)}${TIER_FILTERS.map(k => opt(k, t(TIERS[k].label), k === F.tier)).join('')}</select>
      <label class="chip clickable ${F.old ? 'on' : ''}" title="${esc(t('التصاريح اللي اتجدّدت (القديمة)'))}"><input type="checkbox" id="pm-old" ${F.old ? 'checked' : ''} hidden>${t('مع المُجدَّدة')}</label>`;
  const matrixFilters = `<select id="pm-mtype">${opt('', t('— كل الأنواع —'), !F.mType)}${types.map(tp => opt(tp.id, permitTypeName(tp), tp.id === F.mType)).join('')}</select>
      ${F.mType ? `<select id="pm-mstate">${opt('', t('— الكل —'), !F.mState)}${Object.entries(PERMIT_MSTATE).map(([k, l]) => opt(k, t(l), k === F.mState)).join('')}</select>` : ''}
      <label class="chip clickable ${F.mAll ? 'on' : ''}" title="${esc(t('اعرض كمان اللي مالهمش أي تصريح'))}"><input type="checkbox" id="pm-mall" ${F.mAll ? 'checked' : ''} hidden>${t(kind === 'employee' ? 'كل الموظفين' : 'كل السيارات')}</label>`;
  viewRoot().innerHTML = `<div class="page-head"><div><h1>🪪 ${t('التصاريح')}</h1>
      <div class="sub">${t('قسم مستقل — بيانات الموظفين والسيارات بتيجي من مراكزها للعرض بس')}</div></div>
    <div class="actions"><button class="btn primary write-only" data-p="permits.edit" id="pm-add">➕ ${t('إضافة تصريح')} — ${t(PERMIT_HOLDERS[kind].l)}</button>
      <button class="btn" id="pm-print">🖨️ ${t(PERMIT_HOLDERS[kind].report)}</button>
      ${can('admin') ? `<button class="btn" id="pm-lists">⚙️ ${t('الأنواع والأماكن')}</button><button class="btn" id="pm-export">📤 ${t('تصدير CSV')}</button>` : ''}</div></div>
    <div class="tabs" style="margin-bottom:10px">${Object.entries(PERMIT_HOLDERS).map(([k, v]) =>
      `<button data-ptab="${k}" class="${k === kind ? 'active' : ''}">${v.ico} ${t(v.tab)} (${allPermits(k, false, false).length})</button>`).join('')}</div>
    ${!types.length ? `<div class="notice warn">${t('مفيش أنواع تصاريح — مدير النظام بيضيفها من «⚙️ الأنواع والأماكن».')}</div>` : ''}
    <div class="row no-print" style="gap:6px;margin:0 0 8px;flex-wrap:wrap">
      <span class="chip clickable ${!matrix ? 'on' : ''}" data-pview="list">☰ ${t('قايمة')}</span><span class="chip clickable ${matrix ? 'on' : ''}" data-pview="matrix">▦ ${t('مين معاه إيه')}</span>
      <span style="width:14px"></span>
      ${matrix ? '' : chip('', 'الإجمالي', all.length) + chip('valid', 'ساري', cnt('valid'), 'var(--green)') + chip('expired', 'منتهي', cnt('expired'), 'var(--red)') + chip('soon', 'خلال 30 يوم', cnt('soon'), 'var(--orange)')
        + (nRenew || F.status === 'renew' ? chip('renew', '🔄 ' + renewLabel, nRenew, 'var(--green)') : '')}</div>
    <div class="filters no-print"><input type="search" id="pm-q" placeholder="${esc(t(kind === 'employee' ? 'بحث بالاسم أو الرقم المدني أو رقم الملف أو رقم التصريح…' : 'بحث باللوحة أو السائق أو رقم التصريح…'))}" value="${esc(F.q)}">
      ${matrix ? matrixFilters : listFilters}
      <select id="pm-co">${opt('', t('— كل الشركات —'), !F.company)}${cos.map(c => opt(c, companyName(c), c === F.company)).join('')}</select>
      ${kind === 'employee' ? `<label class="chip clickable ${F.ended ? 'on' : ''}" title="${esc(t('تصاريح الموظفين اللي خدمتهم انتهت (مستقيل / إنهاء خدمات)'))}"><input type="checkbox" id="pm-ended" ${F.ended ? 'checked' : ''} hidden>${t('مع المنتهية خدمتهم')}</label>` : ''}
      <button class="btn sm ghost" id="pm-clear">✕ ${t('مسح الفلاتر')}</button></div>
    ${matrix ? `${permitMatrixHtml(kind, mrows)}<div class="small muted" style="margin-top:6px">${mrows.length} ${t(kind === 'employee' ? 'موظف' : 'سيارة')} · ${t('اضغط على التاريخ لفتح التصريح، أو على «—» لإضافة تصريح.')}</div>`
      : `<div class="table-wrap"><table class="data"><thead><tr>${heads.map(h => `<th>${t(h)}</th>`).join('')}<th>${t('نوع التصريح')}</th><th>${t('الرقم')}</th><th>${t('الجهة المانحة')}</th>
      ${showPlaces ? `<th>${t('الأماكن')}</th>` : ''}<th>${t('الإصدار')}</th><th>${t('الانتهاء')}</th><th></th></tr></thead>
    <tbody>${list.map(p => permitRowHtml(kind, p, showPlaces)).join('') || `<tr><td colspan="10" class="empty">${t('لا توجد تصاريح')}</td></tr>`}</tbody></table></div>
    <div class="small muted" style="margin-top:6px">${list.length} ${t('من')} ${all.length} ${t('تصريح')}</div>`}`;
  const upd = patch => { Object.assign(UI.permits[kind], patch); saveUiStateToLocalStorage(); render(); };
  $$('[data-ptab]', viewRoot()).forEach(b => b.onclick = () => { UI.permits.tab = b.dataset.ptab; saveUiStateToLocalStorage(); render(); });
  $$('[data-pview]', viewRoot()).forEach(b => b.onclick = () => upd({ view: b.dataset.pview }));
  $$('[data-status]', viewRoot()).forEach(c => c.onclick = () => upd({ status: F.status === c.dataset.status ? '' : c.dataset.status }));
  $('#pm-q').addEventListener('input', debounce(e => { UI.permits[kind].q = e.target.value; saveUiStateToLocalStorage(); render(); const i = $('#pm-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  [['#pm-type', 'type'], ['#pm-place', 'place'], ['#pm-co', 'company'], ['#pm-tier', 'tier'], ['#pm-mstate', 'mState']]
    .forEach(([sel, k]) => { const el = $(sel); if (el) el.onchange = e => upd({ [k]: e.target.value }); });
  const mt = $('#pm-mtype'); if (mt) mt.onchange = e => upd({ mType: e.target.value, mState: e.target.value ? F.mState : '' });
  [['#pm-ended', 'ended'], ['#pm-old', 'old'], ['#pm-mall', 'mAll']].forEach(([sel, k]) => { const el = $(sel); if (el) el.onchange = e => upd({ [k]: e.target.checked }); });
  $('#pm-clear').onclick = () => upd({ ...PERMIT_FILTER_DEFAULT, view: F.view });
  $('#pm-add').onclick = () => openPermitAddModal(kind);
  $('#pm-print').onclick = () => openPermitsReportModal(kind, F);
  const ls = $('#pm-lists'); if (ls) ls.onclick = () => openPermitListsModal('types');
  const ex = $('#pm-export'); if (ex) ex.onclick = () => { const rows = permitsFiltered(kind, F); exportGuard(`${t(PERMIT_HOLDERS[kind].tab)} (${rows.length})`, () => downloadBlob(toCsv(permitsCsvRows(kind, rows)), `${PERMIT_HOLDERS[kind].csv}-${todayISO()}.csv`, 'text/csv')); };
  $$('[data-permit-file]', viewRoot()).forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    const p = (STATE.permits || []).find(x => x.id === b.dataset.permitFile);
    if (p && p.fileUrl) openFileViewer(p.fileUrl, p.fileName || t('مرفق التصريح'));
  });
  $$('[data-holder]', viewRoot()).forEach(a => a.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); openPermitHolderCard(kind, a.dataset.holder); });
  $$('tr[data-id]', viewRoot()).forEach(tr => tr.onclick = () => openPermitModal(tr.dataset.id));
  $$('[data-pid]', viewRoot()).forEach(td => td.onclick = () => openPermitModal(td.dataset.pid));
  $$('[data-add]', viewRoot()).forEach(td => td.onclick = () => {
    if (!can('permits.edit')) return;
    const [holderId, typeId] = td.dataset.add.split('|');
    openPermitAddModal(kind, { holderId, typeId });
  });
  if (focus) setTimeout(() => openPermitModal(focus.id), 30);      // جاي من مركز التنبيهات
}
function permitsCsvRows(kind, list) {
  const tail = [t('نوع التصريح'), t('رقم التصريح'), t('الجهة المانحة'), ...(permitHasPlaces() ? [t('الأماكن')] : []), t('العقد / المشروع'), t('تاريخ الإصدار'), t('تاريخ الانتهاء'), t('ملاحظات')];
  const tailOf = p => [permitLabel(p) + (permitSuperseded(p) ? ` (${t('مُجدَّد')})` : ''), p.permitNo, p.issuer, ...(permitHasPlaces() ? [permitPlacesText(p)] : []), projectName(p.projectId), p.issueDate, p.expiryDate, p.notes];
  if (kind === 'employee') return [[t('الموظف'), t('الاسم (إنجليزي)'), t('الرقم المدني'), t('الجنسية'), t('المهنة'), t('الشركة'), t('مركز التكلفة'), ...tail],
    ...list.map(p => { const h = permitHolder(p); return [h.name, h.nameEn, h.id, personNat(h), personProf(h), companyName(h.companyId), h.costCenter, ...tailOf(p)]; })];
  return [[t('رقم اللوحة'), t('نوع المركبة'), t('الموديل'), t('الشركة'), t('مركز التكلفة'), t('مع مين'), ...tail],
    ...list.map(p => { const h = permitHolder(p); return [h.plate, t(VEHICLE_TYPES[h.vehicleType] || ''), h.model, companyName(h.companyId), h.costCenter, holderDriver(h), ...tailOf(p)]; })];
}

/* ---------- تقرير التصاريح (لكل قايمة لوحدها — قايمة أو مصفوفة، عربي أو إنجليزي) ---------- */
function openPermitsReportModal(kind, F) {
  const groups = Object.entries(PERMIT_GROUPS).filter(([k]) => k !== 'place' || permitHasPlaces());
  const m = openModal({
    title: '🖨️ ' + t(PERMIT_HOLDERS[kind].report), size: 'narrow',
    body: `<div class="form"><label class="full">${t('الشكل')}<select name="layout">${opt('list', t('قايمة التصاريح'), F.view !== 'matrix')}${opt('matrix', t('مين معاه إيه (مصفوفة)'), F.view === 'matrix')}</select></label>
      <label class="full">${t('لغة التقرير')}<select name="lang">${opt('ar', 'العربية', LANG !== 'en')}${opt('en', 'English', LANG === 'en')}</select></label>
      <label class="full" id="pr-group">${t('تجميع حسب')}<select name="group">${groups.map(([k, l]) => opt(k, t(l), k === '')).join('')}</select></label></div>
      <div class="small muted" style="margin-top:6px">${t('حسب الفلاتر اللي في الشاشة.')}</div>`,
    foot: `<button class="btn primary" data-go>🖨️ ${t('معاينة وطباعة')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const lay = $('[name=layout]', m.el), grp = $('#pr-group', m.el);
  const sync = () => { grp.hidden = lay.value === 'matrix'; };
  lay.onchange = sync; sync();
  $('[data-go]', m.el).onclick = () => {
    const lang = $('[name=lang]', m.el).value, group = $('[name=group]', m.el).value, layout = lay.value;
    m.close();
    withLang(lang, () => layout === 'matrix' ? printPermitsMatrix(kind, F) : printPermitsReport(kind, permitsFiltered(kind, F), F, group));
  };
}
function permitGroupKeys(p, by) {
  if (by === 'type') return [[p.typeId, permitLabel(p)]];
  if (by === 'project') return [[p.projectId || '', projectName(p.projectId) || t('بدون عقد')]];
  if (by === 'place') return (p.placeIds || []).length ? p.placeIds.map(x => [x, permitPlaceName(IDX.permitPlace[x])]) : [['', t('بدون مكان')]];
  if (by === 'company') { const c = permitHolder(p).companyId; return [[c || '', companyName(c) || t('بدون شركة')]]; }
  if (by === 'issuer') return [[p.issuer || '', p.issuer || t('بدون جهة')]];
  return [['', '']];
}
function permitCriteria(F) {
  const crit = [];
  if (F.status) crit.push(t(PERMIT_STATUS[F.status].l));
  if (F.type) crit.push(`${t('النوع')}: ${esc(permitTypeName(IDX.permitType[F.type]))}`);
  if (F.place) crit.push(`${t('المكان')}: ${esc(F.place === '__none' ? t('بدون مكان') : permitPlaceName(IDX.permitPlace[F.place]))}`);
  if (F.company) crit.push(`${t('الشركة')}: ${esc(companyName(F.company))}`);
  if (F.tier) crit.push(t(TIERS[F.tier].label));
  if (F.ended) crit.push(t('مع المنتهية خدمتهم'));
  if (F.old) crit.push(t('مع المُجدَّدة'));
  if (F.q) crit.push(`${t('بحث')}: ${esc(F.q)}`);
  return crit;
}
function printPermitsReport(kind, list, F, groupBy) {
  const crit = permitCriteria(F);
  const H = p => permitHolder(p);
  const holderCols = kind === 'employee'
    ? [[t('الموظف'), p => esc(holderName(kind, H(p))), 'txt'], [t('الرقم المدني'), p => esc(H(p).id), 'num'], [t('الجنسية'), p => esc(personNat(H(p))), 'txt'],
       ...(groupBy === 'company' ? [] : [[t('الشركة'), p => esc(companyName(H(p).companyId)), 'txt']])]
    : [[t('رقم اللوحة'), p => esc(H(p).plate), 'num'], [t('نوع المركبة'), p => esc(t(VEHICLE_TYPES[H(p).vehicleType] || '')), 'txt'],
       ...(groupBy === 'company' ? [] : [[t('الشركة'), p => esc(companyName(H(p).companyId)), 'txt']]), [t('مع مين'), p => esc(holderDriver(H(p))), 'txt']];
  const cols = [...holderCols,
    ...(groupBy === 'type' ? [] : [[t('نوع التصريح'), p => esc(permitLabel(p)) + (permitSuperseded(p) ? ` <small>(${t('مُجدَّد')})</small>` : ''), 'txt']]), [t('رقم التصريح'), p => esc(p.permitNo || ''), 'num'],
    ...(groupBy === 'project' ? [] : [[t('العقد'), p => esc(projectName(p.projectId)), 'txt']]),
    ...(groupBy === 'issuer' ? [] : [[t('الجهة المانحة'), p => esc(p.issuer || ''), 'txt']]), ...(permitHasPlaces() ? [[t('الأماكن'), p => esc(permitPlacesText(p)), 'txt']] : []),
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
  const n2 = st => list.filter(p => permitStatusIs(p, st)).length;
  const cos = uniq(list.map(p => H(p).companyId));
  openReportWindow({
    title: t(PERMIT_HOLDERS[kind].report), subtitle: groupBy ? `${t('تجميع حسب')}: ${t(PERMIT_GROUPS[groupBy])}` : '', landscape: true, criteria: crit.join(' · '),
    company: (F.company && IDX.company[F.company]) || (cos.length === 1 ? IDX.company[cos[0]] : null),
    summary: [[list.length, t('تصريح')], [n2('valid'), t('ساري')], [n2('expired'), t('منتهي')], [n2('soon'), t('خلال 30 يوم')]],
    body: table, meta: [[t('عدد السجلات'), String(list.length)]],
  });
  printLog(t(PERMIT_HOLDERS[kind].report), 'permit');
}
function printPermitsMatrix(kind, F) {
  const types = permitTypesFor(kind), rows = permitMatrixRows(kind, F);
  const crit = [...permitCriteria({ ...F, type: '', status: '', tier: '', old: false })];
  if (F.mType) crit.push(`${esc(permitTypeName(IDX.permitType[F.mType]))}${F.mState ? ': ' + t(PERMIT_MSTATE[F.mState]) : ''}`);
  if (F.mAll) crit.push(t(kind === 'employee' ? 'كل الموظفين' : 'كل السيارات'));
  const cell = c => {
    if (!c.length) return '<td class="num">—</td>';
    const tr = tierOf(c[0].expiryDate);
    return `<td class="num"><span class="pill ${TIERS[tr] ? TIERS[tr].cls : ''}">${fmtDate(c[0].expiryDate)}</span>${c.length > 1 ? ` +${c.length - 1}` : ''}</td>`;
  };
  let z = 0;
  const body = rows.map(({ h, cells }, i) => `<tr class="${z++ % 2 ? 'z' : ''}"><td class="idx">${i + 1}</td><td class="txt">${esc(holderName(kind, h))}</td>
    <td class="num">${esc(kind === 'employee' ? h.id : t(VEHICLE_TYPES[h.vehicleType] || ''))}</td><td class="txt">${esc(companyName(h.companyId))}</td>${cells.map(cell).join('')}</tr>`).join('');
  const table = `<table class="rpt"><thead><tr><th>#</th><th class="txt">${t(kind === 'employee' ? 'الموظف' : 'رقم اللوحة')}</th><th>${t(kind === 'employee' ? 'الرقم المدني' : 'نوع المركبة')}</th><th class="txt">${t('الشركة')}</th>
    ${types.map(tp => `<th>${esc(permitTypeName(tp))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    <div class="small" style="margin-top:4px;color:#66736f">${t('الخانة فيها تاريخ انتهاء التصريح الحالي — «—» مفيش تصريح.')}</div>`;
  const cos = uniq(rows.map(r => r.h.companyId));
  openReportWindow({
    title: t(PERMIT_HOLDERS[kind].report), subtitle: t('مين معاه إيه'), landscape: types.length > 3, criteria: crit.join(' · '),
    company: (F.company && IDX.company[F.company]) || (cos.length === 1 ? IDX.company[cos[0]] : null),
    summary: [[rows.length, t(kind === 'employee' ? 'موظف' : 'سيارة')], ...types.map((tp, i) => [rows.filter(r => r.cells[i].length).length, permitTypeName(tp)])],
    body: table, meta: [[t('عدد السجلات'), String(rows.length)]],
  });
  printLog(`${t(PERMIT_HOLDERS[kind].report)} — ${t('مين معاه إيه')}`, 'permit');
}

/* ---------- أنواع وأماكن التصاريح (مدير النظام) ---------- */
function openPermitListsModal(tab) {
  const permits = STATE.permits || [];
  const types = STATE.permitTypes || [], places = STATE.permitPlaces || [];
  const used = (kind, id) => kind === 'types' ? permits.filter(p => p.typeId === id).length : permits.filter(p => (p.placeIds || []).includes(id)).length;
  const cond = r => `${r.requiresTypeId ? `${t('محتاج')} ${esc(permitTypeName(IDX.permitType[r.requiresTypeId]))} ${t('ساري')}${r.sameExpiry ? ' · ' + t('بينتهي معاه') : ''}<br>` : ''}<span class="muted">${t('بيتجدد في آخر')} ${r.renewWindowDays || 30} ${t('يوم')}</span>`;
  const table = (kind, rows) => `<table class="data"><thead><tr><th>${t('الاسم (عربي)')}</th><th>${t('الاسم (إنجليزي)')}</th>${kind === 'types' ? `<th>${t('لمين')}</th><th>${t('الجهة المانحة الافتراضية')}</th><th>${t('الشرط')}</th>` : ''}<th>${t('التصاريح')}</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.nameAr)}</b></td><td dir="ltr">${esc(r.nameEn || '')}</td>${kind === 'types' ? `<td>${esc(t(PERMIT_APPLIES[r.appliesTo || '']))}</td><td>${esc(r.defaultIssuer || '—')}</td><td class="small">${cond(r)}</td>` : ''}<td class="num">${used(kind, r.id)}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-edit="${kind}:${r.id}">✏️</button> <button class="btn sm danger" data-del="${kind}:${r.id}">🗑️</button></td></tr>`).join('')
      || `<tr><td colspan="7" class="empty">${t('القايمة فاضية')}</td></tr>`}</tbody></table>
    <button class="btn" data-add="${kind}" style="margin-top:8px">➕ ${t(kind === 'types' ? 'إضافة نوع' : 'إضافة مكان')}</button>`;
  const m = openModal({
    title: '⚙️ ' + t('أنواع وأماكن التصاريح'), size: 'wide',
    body: `<div class="tabs"><button data-tab="types" class="${tab === 'types' ? 'active' : ''}">${t('الأنواع')} (${types.length})</button><button data-tab="places" class="${tab === 'places' ? 'active' : ''}">${t('الأماكن')} (${places.length})</button></div>
      <div data-pane="types" ${tab !== 'types' ? 'hidden' : ''}>${table('types', types)}</div><div data-pane="places" ${tab !== 'places' ? 'hidden' : ''}>${table('places', places)}
        <div class="small muted" style="margin-top:6px">${t('الأماكن اختيارية: لو القايمة فاضية، خانة «الأماكن» مابتظهرش في التصاريح.')}</div></div>
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
      ${kind === 'types' ? `<label class="full">${t('لمين')}<select name="appliesTo">${Object.entries(PERMIT_APPLIES).map(([k, l]) => opt(k, t(l), k === (r.appliesTo || ''))).join('')}</select></label>
      <label class="full">${t('الجهة المانحة الافتراضية')}<input name="defaultIssuer" value="${esc(r.defaultIssuer || '')}" placeholder="${esc(t('بتتملى لوحدها في التصريح الجديد (وتتعدّل)'))}"></label>
      <label class="full" title="${esc(t('التصريح ده مايطلعش غير لو صاحبه معاه تصريح ساري من النوع ده (زي الرتقة والعبدلي مع الـ KOC)'))}">${t('مطلوب قبله تصريح ساري من نوع')}<select name="requiresTypeId">${opt('', t('— مفيش —'), !r.requiresTypeId)}${(STATE.permitTypes || []).filter(x => x.id !== id).map(x => opt(x.id, permitTypeName(x), x.id === r.requiresTypeId)).join('')}</select></label>
      <label class="check full"><input type="checkbox" name="sameExpiry" ${r.sameExpiry ? 'checked' : ''}> ${t('بينتهي مع تاريخه وعلى نفس عقده')}</label>
      <label class="full" title="${esc(t('بطاقة التصاريح بتقول «ينفع يتجدد من…» على أساسه'))}">${t('بيتجدد قبل الانتهاء بـ (يوم)')}<input type="number" name="renewWindowDays" min="1" max="365" value="${esc(r.renewWindowDays || 30)}"></label>` : ''}</div>`,
    foot: `<button class="btn primary" data-save>${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[name=nameAr]', m.el).focus();
  const reqSel = $('[name=requiresTypeId]', m.el), same = $('[name=sameExpiry]', m.el);
  if (reqSel) { const syncReq = () => { same.disabled = !reqSel.value; if (!reqSel.value) same.checked = false; }; reqSel.onchange = syncReq; syncReq(); }
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (!d.nameAr) return openBlockAlert(t('الاسم مطلوب'));
    const base = kind === 'types' ? '/api/permit-types' : '/api/permit-places';
    try { await persist(id ? 'PUT' : 'POST', id ? `${base}/${id}` : base, d, 'تم الحفظ'); m.close(); if (after) after(); }
    catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); }
  };
}
