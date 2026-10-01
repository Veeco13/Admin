/* =====================================================================
   PERMIT FORMS — نماذج تصاريح السيارات (permit_forms.py على السيرفر، القوالب في forms/permits/)
   نافذة واحدة: فوق البيانات المشتركة — **كلها ظاهرة ومتملّية من البرنامج وتتعدّل** — وتحت قايمة النماذج مرقّمة،
   كل نموذج بزرار «معاينة وطباعة» لوحده (وزرار للكل):
     KOC:               1) شهادة الفحص (نسخة لكل مركبة — بتتقدّم الأول)  2) قايمة المستندات  3) التعهد  4) نموذج الطلب
     الرتقة والعبدلي:   1) قايمة المستندات  2) التعهد  3) نموذج طلب الرتقة والعبدلي
   التعديل في النافذة بيتطبّق على الطباعة على طول، و«حفظ التعديلات في البيانات» بيحفظ بيانات السيارة (اللون، الشكل،
   الشاصي، الكود…) والعقد والمقاول وتليفون المندوب في مكانها علشان ماتتكتبش تاني.
   المعتمدين والمناديب واسم المقاول على **الوكالة**، وتواريخ العقد وفريق العمل ورمزه على **العقد**.
   ===================================================================== */
'use strict';

const PERMIT_FORM_KINDS = {
  koc: { label: 'تصريح KOC', typeId: 'pt_koc',
    forms: [['clearance', 'شهادة الفحص (Clearance Certificate)', 'نسخة لكل مركبة — بتتقدّم للفحص الأول'], ['checklist', 'قائمة المستندات المطلوبة'],
      ['undertaking', 'تعهد المركبات'], ['request', 'نموذج طلب تصاريح المركبات الثقيلة']],
    cols: ['plate', 'shape', 'shapeEn', 'color', 'modelEn', 'chassis', 'permitCode', 'oldPermitNo', 'checked', 'valid', 'ref'] },
  ratqa: { label: 'تصريح الرتقة والعبدلي', typeId: 'pt_ratqa',
    forms: [['checklist', 'قائمة المستندات المطلوبة'], ['undertaking', 'تعهد المركبات'], ['ratqa', 'نموذج طلب تصاريح الرتقة والعبدلي']],
    cols: ['plate', 'shape', 'modelYear', 'color', 'color2', 'oldPermitNo', 'oldPermitExpiry', 'licenseExpiry'] },
};
const PERMIT_FORM_ROWS = { clearance: 10, checklist: 12, undertaking: 10, request: 10, ratqa: 8 };     // أقصى عدد سيارات في النموذج
// أعمدة جدول السيارات: [العنوان، نوع الخانة، العرض]
const PERMIT_FORM_COLS = {
  plate: ['رقم اللوحة', 'text', 96], shape: ['شكل المركبة', 'shape', 92], shapeEn: ['الشكل (إنجليزي)', 'text', 110], color: ['اللون', 'text', 80], color2: ['اللون الثاني', 'text', 80],
  modelYear: ['الموديل (السنة)', 'text', 76], modelEn: ['النوع / السنة (إنجليزي)', 'text', 120], chassis: ['رقم الشاصي', 'text', 150], permitCode: ['الكود', 'text', 64],
  oldPermitNo: ['رقم التصريح القديم', 'text', 104], oldPermitExpiry: ['انتهاء التصريح القديم', 'date', 136], licenseExpiry: ['انتهاء دفتر المركبة', 'date', 136],
  checked: ['تاريخ الفحص', 'date', 136], valid: ['صالحة حتى', 'date', 136], ref: ['رقم شهادة الفحص', 'text', 190],
};
// الشكل (زي نموذج الجهة) ← اسمه بالإنجليزي في شهادة الفحص
const VEHICLE_SHAPES = { 'قاطرة': 'TRUCK HEAD', 'وانيت': 'PICKUP', 'جيب': 'JEEP', 'صالون': 'SALOON', 'بوكس': 'BOX', 'حافلة': 'BUS', 'باص': 'MINI BUS',
  'سوبر بان': 'SUBURBAN', 'فان': 'VAN', 'شاحنة': 'TRUCK', 'تريلا': 'TRAILER', 'تنكر': 'TANKER', 'كرين': 'CRANE' };
const PERMIT_REQUEST_TYPES = { renew: 'تجديد', first: 'أول مرة', lost: 'بدل فاقد', damaged: 'بدل تالف' };
// الجنسية في النماذج صفة («مصري») والبرنامج مسجّل البلد («مصر»)
const NATIONALITY_ADJ = { 'مصر': 'مصري', 'الهند': 'هندي', 'باكستان': 'باكستاني', 'بنغلاديش': 'بنغلاديشي', 'بنجلاديش': 'بنغلاديشي', 'الفلبين': 'فلبيني', 'نيبال': 'نيبالي',
  'سوريا': 'سوري', 'الأردن': 'أردني', 'الاردن': 'أردني', 'لبنان': 'لبناني', 'الكويت': 'كويتي', 'السعودية': 'سعودي', 'سريلانكا': 'سريلانكي', 'السودان': 'سوداني', 'اليمن': 'يمني', 'إيران': 'إيراني', 'ايران': 'إيراني' };
const permitFormPlate = p => String(p || '').replace(/-/g, '/');          // «91-57023» ← «91/57023» زي النماذج

/** سطر سيارة في النافذة: بياناتها من قسم السيارات + تصريحها القديم من نفس النوع */
function permitFormVehicleRow(v, kind) {
  const typeId = PERMIT_FORM_KINDS[kind].typeId;
  const old = permitsOf('vehicle', v.id).filter(p => p.typeId === typeId).sort((a, b) => (b.expiryDate || '').localeCompare(a.expiryDate || ''))[0] || {};
  const year = v.modelYear || (/(19|20)\d{2}/.exec(v.model || '') || [''])[0];
  return { id: v.id, plate: permitFormPlate(v.plate), shape: v.shape || '', shapeEn: v.shapeEn || VEHICLE_SHAPES[v.shape] || '', color: v.color || '', color2: v.color2 || '',
    modelYear: year, modelEn: v.modelEn || '', chassis: v.chassisNo || '', permitCode: v.permitCode || '',
    oldPermitNo: old.permitNo || '', oldPermitExpiry: old.expiryDate || '', licenseExpiry: v.insuranceExpiry || '', checked: '', valid: '', ref: '', refAuto: true };
}

function openVehiclePermitForms(pre = {}) {
  if (!STATE.permitFormsAvailable) return openBlockAlert(t('قوالب نماذج التصاريح مش موجودة على السيرفر.'));
  const projects = scopedProjects().filter(p => ['gov', 'sub'].includes(p.kind)).sort((a, b) => projectName(a.id).localeCompare(projectName(b.id), 'ar'));
  if (!projects.length) return openBlockAlert(t('مفيش عقود حكومية أو من الباطن — التصاريح بتطلع على عقد.'));
  // العقد الافتراضي: عقد السيارة المختارة، وإلا آخر عقد اشتغلت عليه على الجهاز ده، وإلا أول عقد
  const firstVeh = IDX.vehicle[(pre.vehicleIds || [])[0]] || {}, known = id => projects.some(p => p.id === id);
  let last = ''; try { last = localStorage.getItem('lunx.permitForms.project') || ''; } catch (e) { /* التخزين مقفول */ }
  const S = { kind: PERMIT_FORM_KINDS[pre.kind] ? pre.kind : 'koc', rows: [], mandoubId: '',
    projectId: [pre.projectId, firstVeh.projectId, firstVeh.affairsProjectId, last].find(known) || projects[0].id };
  const today = todayISO();
  const field = (f, label, type = 'text', cls = '') => `<label class="${cls}">${t(label)}<input ${type === 'date' ? 'type="date"' : ''} data-f="${f}"${type === 'ltr' ? ' dir="ltr"' : ''}></label>`;
  const m = openModal({
    title: '📄 ' + t('نماذج تصاريح السيارات'), size: 'wide',
    body: `<div class="form" id="pf-top">
        <label>${t('نوع التصريح')}<select id="pf-kind">${Object.entries(PERMIT_FORM_KINDS).map(([k, v]) => opt(k, t(v.label), k === S.kind)).join('')}</select></label>
        <label>${t('العقد')}<select id="pf-project">${projects.map(p => opt(p.id, projectName(p.id) + (p.contractNo ? ' · ' + p.contractNo : ''), p.id === S.projectId)).join('')}</select></label>
        ${field('from', 'المدة المطلوبة — من', 'date')}${field('to', 'إلى', 'date')}${field('requestDate', 'تاريخ الطلب', 'date')}</div>
      <div class="notice small" style="margin-top:8px">${t('كل البيانات تحت متملّية من البرنامج وتقدر تعدّل أي خانة قبل الطباعة. التعديل بيتطبّق على الطباعة دي — ولو عايزه يتحفظ في بيانات السيارة والعقد اضغط «حفظ التعديلات في البيانات».')}</div>
      <h4 class="cu-h">🏢 ${t('بيانات العقد')}</h4>
      <div class="form">${field('contractorAr', 'اسم المقاول الرئيسي (عربي)', 'text', 'full')}${field('contractorEn', 'اسم المقاول الرئيسي (إنجليزي)', 'ltr', 'full')}
        ${field('subcontractor', 'المقاول من الباطن')}${field('contractNo', 'رقم العقد')}${field('startDate', 'تاريخ بدء العقد', 'date')}${field('endDate', 'تاريخ انتهاء العقد', 'date')}
        ${field('extDate', 'تمديد العقد حتى', 'date')}${field('team', 'فريق العمل المسؤول')}${field('teamEn', 'فريق العمل (إنجليزي)', 'ltr')}${field('teamCode', 'رمز فريق العمل', 'ltr')}
        ${field('clearancePrefix', 'الجزء الثابت من رقم شهادة الفحص', 'ltr')}</div>
      <h4 class="cu-h">👤 ${t('المندوب والمعتمد')}</h4>
      <div class="form"><label>${t('المندوب')}<select id="pf-mandoub"></select></label>${field('mandoubName', 'اسم المندوب في النموذج')}${field('mandoubNationality', 'الجنسية')}
        ${field('mandoubCivil', 'الرقم المدني', 'ltr')}${field('mandoubPhone', 'التليفون', 'ltr')}
        <label>${t('معتمد الشركة')}<input data-f="signatory" list="pf-signs"><datalist id="pf-signs"></datalist></label></div>
      <h4 class="cu-h">🚗 ${t('السيارات')} <span class="small muted" id="pf-count"></span></h4>
      <div class="row" style="gap:8px;margin-bottom:6px"><input type="search" id="pf-add" list="pf-vehicles" placeholder="${esc(t('أضف سيارة: اكتب رقم اللوحة واختار…'))}" style="flex:1;min-width:220px" autocomplete="off">
        <datalist id="pf-vehicles"></datalist></div>
      <div class="table-wrap"><table class="data pf-veh" id="pf-veh"></table></div>
      <datalist id="pf-shapes">${Object.keys(VEHICLE_SHAPES).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <h4 class="cu-h">🖨️ ${t('النماذج')}</h4><div id="pf-forms"></div>`,
    foot: `<button class="btn primary" data-all>🖨️ ${t('معاينة وطباعة الكل')}</button>
      <button class="btn write-only" data-p="permits.edit" data-store>💾 ${t('حفظ التعديلات في البيانات')}</button>
      <span class="small muted">${t('معاينة وطباعة بس — التنزيل مقفول')}</span><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const E = m.el, F = f => $(`[data-f="${f}"]`, E), val = f => (F(f).value || '').trim(), set = (f, v) => { F(f).value = v || ''; };
  const project = () => IDX.project[S.projectId] || {};
  const agency = () => agencyById(project().agencyId) || {};
  // ---- بيانات العقد والمقاول من العقد ووكالته
  const fillContract = () => {
    const p = project(), a = agency(), end = p.clientExtDate || p.clientEndDate || p.expiryDate || '';
    set('contractorAr', a.contractorAr || companyName(p.companyId)); set('contractorEn', a.contractorEn || (IDX.company[p.companyId] || {}).nameEn);
    set('subcontractor', ''); set('contractNo', p.contractNo); set('startDate', p.clientStartDate || p.startDate); set('endDate', p.clientEndDate || p.expiryDate);
    set('extDate', p.clientExtDate); set('team', p.clientTeam); set('teamEn', p.clientTeamEn); set('teamCode', p.clientTeamCode); set('clearancePrefix', p.clearancePrefix);
    set('from', today); set('to', end); set('requestDate', today);
    const ids = (a.mandoubs || []).filter(id => IDX.employee[id]);
    S.mandoubId = ids[0] || '';
    $('#pf-mandoub', E).innerHTML = ids.map((id, i) => opt(id, IDX.employee[id].name + (i ? '' : ` (${t('الأساسي')})`), id === S.mandoubId)).join('') + opt('', t('— مندوب تاني (اكتب بياناته) —'), !S.mandoubId);
    fillMandoub();
    $('#pf-signs', E).innerHTML = (a.signatories || []).map(x => `<option value="${esc(x)}">`).join('');
    set('signatory', (a.signatories || [])[0]);
  };
  const fillMandoub = () => {
    const e = IDX.employee[S.mandoubId];
    set('mandoubName', e ? e.name.trim().split(/\s+/).slice(0, 2).join(' ') : ''); set('mandoubNationality', e ? NATIONALITY_ADJ[e.nationality] || e.nationality : '');
    set('mandoubCivil', e ? e.id : ''); set('mandoubPhone', e ? e.phone : '');
  };
  // ---- جدول السيارات (كل خانة تتعدّل)
  const refOf = r => (val('clearancePrefix') + (r.permitCode || '')).trim();
  const syncAuto = () => S.rows.forEach(r => { if (r.refAuto) r.ref = refOf(r); if (!r.valid) r.valid = val('to'); });
  const drawVehicles = () => {
    const K = PERMIT_FORM_KINDS[S.kind], cols = K.cols;
    syncAuto();
    $('#pf-count', E).textContent = `(${S.rows.length})`;
    $('#pf-veh', E).innerHTML = `<thead><tr><th style="width:34px">#</th>${cols.map(c => `<th>${t(PERMIT_FORM_COLS[c][0])}</th>`).join('')}<th></th></tr></thead><tbody>
      ${S.rows.map((r, i) => `<tr><td class="num">${i + 1}</td>${cols.map(c => { const [, type, w] = PERMIT_FORM_COLS[c];
        return `<td><input data-vf="${i}|${c}" value="${esc(r[c] || '')}" style="width:${w}px" ${type === 'date' ? 'type="date"' : ''} ${type === 'shape' ? 'list="pf-shapes"' : ''} ${/^(shapeEn|modelEn|chassis|permitCode|ref)$/.test(c) ? 'dir="ltr"' : ''}></td>`; }).join('')}
        <td><button type="button" class="btn sm danger" data-vrm="${i}">✕</button></td></tr>`).join('')
        || `<tr><td colspan="${cols.length + 2}" class="empty">${t('أضف سيارة من الخانة اللي فوق')}</td></tr>`}</tbody>`;
    // سيارات العقد المختار أول القايمة
    const used = new Set(S.rows.map(r => r.id)), mine = v => (v.projectId === S.projectId || v.affairsProjectId === S.projectId ? 0 : 1);
    $('#pf-vehicles', E).innerHTML = STATE.vehicles.filter(v => !used.has(v.id)).sort((a, b) => mine(a) - mine(b) || String(a.plate).localeCompare(String(b.plate)))
      .map(v => `<option value="${esc(permitFormPlate(v.plate))}">${esc([v.model, mine(v) ? '' : projectName(S.projectId)].filter(Boolean).join(' · '))}</option>`).join('');
    $$('[data-vrm]', E).forEach(b => b.onclick = () => { S.rows.splice(Number(b.dataset.vrm), 1); drawVehicles(); drawForms(); });
  };
  const drawForms = () => {
    const K = PERMIT_FORM_KINDS[S.kind], n = S.rows.length;
    const extra = { checklist: `<label class="small">${t('تحت Permanent')} <input type="date" data-f="permanent"></label><label class="small">${t('تحت Temporary')} <input type="date" data-f="temporary"></label>`,
      ratqa: `<label class="small"><input type="checkbox" data-f="areaRatqa" checked> ${t('الرتقة')}</label><label class="small"><input type="checkbox" data-f="areaAbdali" checked> ${t('العبدلي')}</label>
        <label class="small">${t('نوع الطلب')} <select data-f="requestType">${Object.entries(PERMIT_REQUEST_TYPES).map(([k, l]) => opt(k, t(l), k === (S.rows.some(r => r.oldPermitNo) ? 'renew' : 'first'))).join('')}</select></label>` };
    const keep = Object.fromEntries(['permanent', 'temporary'].map(f => [f, F(f) ? F(f).value : null]));
    $('#pf-forms', E).innerHTML = K.forms.map(([key, label, hint], i) => `<div class="pf-form"><b class="num">${i + 1}</b><div><b>${t(label)}</b>${hint ? ` <span class="small muted">— ${t(hint)}</span>` : ''}
        ${n > PERMIT_FORM_ROWS[key] ? `<div class="small" style="color:var(--red)">${t('النموذج بيشيل')} ${PERMIT_FORM_ROWS[key]} ${t('سيارات بالكتير — قسّم الطلب')}</div>` : ''}
        ${extra[key] ? `<div class="row" style="gap:10px;margin-top:4px">${extra[key]}</div>` : ''}</div>
      <span class="spacer"></span><button class="btn" data-form="${key}">🖨️ ${t('معاينة وطباعة')}</button></div>`).join('');
    if (F('permanent')) { set('permanent', keep.permanent ?? val('to')); set('temporary', keep.temporary ?? val('from')); }
    $$('[data-form]', E).forEach(b => b.onclick = () => print([b.dataset.form]));
  };
  const addVehicle = v => { if (!v || S.rows.some(r => r.id === v.id)) return; S.rows.push(permitFormVehicleRow(v, S.kind)); };
  // ---- جمع البيانات اللي ظاهرة
  const collect = () => ({
    contractorAr: val('contractorAr'), contractorEn: val('contractorEn'), subcontractor: val('subcontractor'), contractNo: val('contractNo'),
    startDate: val('startDate'), endDate: val('endDate'), extDate: val('extDate'), team: val('team'), teamEn: val('teamEn'), teamCode: val('teamCode'),
    from: val('from'), to: val('to'), requestDate: val('requestDate'), signatory: val('signatory'),
    mandoub: { name: val('mandoubName'), nationality: val('mandoubNationality'), civilId: val('mandoubCivil'), phone: val('mandoubPhone') },
    permanent: F('permanent') ? F('permanent').value : '', temporary: F('temporary') ? F('temporary').value : '',
    requestType: F('requestType') ? F('requestType').value : '', areas: { ratqa: !F('areaRatqa') || F('areaRatqa').checked, abdali: !F('areaAbdali') || F('areaAbdali').checked },
    vehicles: S.rows.map(r => ({ ...r, valid: r.valid || val('to') })),
  });
  const print = async forms => {
    if (!S.rows.length) return openBlockAlert(t('أضف سيارة واحدة على الأقل'));
    const K = PERMIT_FORM_KINDS[S.kind], over = forms.find(f => S.rows.length > PERMIT_FORM_ROWS[f]);
    if (over) return openBlockAlert(`«${t(K.forms.find(x => x[0] === over)[1])}» ${t('بيشيل')} ${PERMIT_FORM_ROWS[over]} ${t('سيارات بالكتير — قسّم الطلب')}`);
    toast(t('جاري تجهيز المعاينة…'));
    try {
      const r = await postForBlob(`/api/permit-forms/${S.kind}/pdf`, { forms, data: collect() });
      const name = forms.length === 1 ? t(K.forms.find(x => x[0] === forms[0])[1]) : `${t('نماذج')} ${t(K.label)}`;
      openPdfPreviewModal(r.blob, name + '.pdf', 1, 'permit');
    } catch (e) { openBlockAlert(esc(e.message)); }
  };
  // ---- الأحداث
  E.addEventListener('input', ev => {
    const el = ev.target;
    if (el.dataset.vf) {
      const [i, c] = el.dataset.vf.split('|'), r = S.rows[Number(i)];
      r[c] = el.value;
      if (c === 'ref') r.refAuto = false;
      if (c === 'shape' && VEHICLE_SHAPES[el.value]) { r.shapeEn = VEHICLE_SHAPES[el.value]; const x = $(`[data-vf="${i}|shapeEn"]`, E); if (x) x.value = r.shapeEn; }
      if (c === 'permitCode' && r.refAuto) { r.ref = refOf(r); const x = $(`[data-vf="${i}|ref"]`, E); if (x) x.value = r.ref; }
    } else if (el.dataset.f === 'clearancePrefix') { syncAuto(); S.rows.forEach((r, i) => { const x = $(`[data-vf="${i}|ref"]`, E); if (x) x.value = r.ref; }); }
  });
  $('#pf-add', E).addEventListener('change', ev => {
    const q = ev.target.value.trim(), v = STATE.vehicles.find(x => permitFormPlate(x.plate) === q || x.plate === q);
    if (!v) return;
    ev.target.value = '';
    addVehicle(v); drawVehicles(); drawForms();
  });
  $('#pf-kind', E).onchange = ev => {
    S.kind = ev.target.value;
    S.rows = S.rows.map(r => { const v = IDX.vehicle[r.id], fresh = v ? permitFormVehicleRow(v, S.kind) : {}; return { ...r, oldPermitNo: fresh.oldPermitNo || '', oldPermitExpiry: fresh.oldPermitExpiry || '' }; });
    drawVehicles(); drawForms();
  };
  $('#pf-project', E).onchange = async ev => {
    S.projectId = ev.target.value; remember(); fillContract(); drawVehicles(); drawForms();
  };
  const remember = () => { try { localStorage.setItem('lunx.permitForms.project', S.projectId); } catch (e) { /* التخزين مقفول */ } };
  $('#pf-mandoub', E).onchange = ev => { S.mandoubId = ev.target.value; fillMandoub(); };
  $('[data-all]', E).onclick = () => print(PERMIT_FORM_KINDS[S.kind].forms.map(x => x[0]));
  $('[data-store]', E).onclick = async () => {
    const p = project(), a = agency();
    // تاريخ العقد عند الجهة: لو الخانة لسه على البديل (تاريخ الترخيص) ومتسجّلش قبل كده ← مايتسجّلش
    const own = (f, saved, fallback) => (saved || val(f) !== (fallback || '') ? val(f) : '');
    const body = { vehicles: S.rows.filter(r => IDX.vehicle[r.id]).map(r => ({ id: r.id, color: r.color, color2: r.color2, shape: r.shape, shapeEn: r.shapeEn, chassisNo: r.chassis,
        modelYear: r.modelYear, modelEn: r.modelEn, permitCode: r.permitCode })),
      project: p.id ? { id: p.id, clientStartDate: own('startDate', p.clientStartDate, p.startDate), clientEndDate: own('endDate', p.clientEndDate, p.expiryDate), clientExtDate: val('extDate'), clientTeam: val('team'), clientTeamEn: val('teamEn'),
        clientTeamCode: val('teamCode'), clearancePrefix: val('clearancePrefix') } : null,
      agency: a.id ? { id: a.id, contractorAr: own('contractorAr', a.contractorAr, companyName(p.companyId)),
        contractorEn: own('contractorEn', a.contractorEn, (IDX.company[p.companyId] || {}).nameEn) } : null,
      mandoub: S.mandoubId ? { id: S.mandoubId, phone: val('mandoubPhone') } : null };
    if (!await openConfirm(t('حفظ اللي في النافذة في بيانات السيارات والعقد والمقاول وتليفون المندوب؟ (رقم التصريح القديم وتواريخ الطلب مابتتحفظش)'), { okLabel: t('حفظ') })) return;
    try {
      const r = await persist('PUT', '/api/permit-forms/data', body);
      toast(r.saved && r.saved.length ? `${t('اتحفظ')}: ${r.saved.join('، ')}` : t('مفيش تعديلات جديدة تتحفظ'), 'ok');
    } catch (e) { /* ظاهر */ }
  };
  fillContract();
  (pre.vehicleIds || []).forEach(id => addVehicle(IDX.vehicle[id]));
  drawVehicles(); drawForms();
  translateDomText(E);
}
