/* =====================================================================
   PERMIT FORMS — نماذج التصاريح: السيارات والموظفين (permit_forms.py على السيرفر، القوالب في forms/permits/)
   نافذة واحدة: فوق البيانات المشتركة — **كلها ظاهرة ومتملّية من البرنامج وتتعدّل** — وتحت قايمة النماذج مرقّمة،
   كل نموذج بزرار «معاينة وطباعة» لوحده (وزرار للكل):
     السيارات — KOC:               1) شهادة الفحص (نسخة لكل مركبة — بتتقدّم الأول)  2) قايمة المستندات  3) التعهد  4) نموذج الطلب
     السيارات — الرتقة والعبدلي:   1) قايمة المستندات  2) التعهد  3) نموذج طلب الرتقة والعبدلي
     الموظفين — KOC:               1) قايمة المستندات (Personnel Gate Pass — 4 أسماء في الورقة)
     الموظفين — الرتقة والعبدلي:   1) قايمة المستندات  2) نموذج طلب المنطقة الحدودية (10 أفراد في الورقة)
   التعديل في النافذة بيتطبّق على الطباعة على طول، و«حفظ التعديلات في البيانات» بيحفظ بيانات السيارة (اللون، الشكل،
   الشاصي، الكود…) والعقد والمقاول وتليفون المندوب في مكانها علشان ماتتكتبش تاني (بيانات الموظف بتتعدّل من مركزه).
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
// نماذج الموظفين (PEOPLE_FORMS على السيرفر)
const PERMIT_FORM_KINDS_EMP = {
  koc: { label: 'تصريح KOC', typeId: 'pt_koc',
    forms: [['p_checklist', 'قائمة المستندات المطلوبة — أفراد']],
    cols: ['name', 'nationality', 'profession', 'idNo', 'oldPermitNo'] },
  ratqa: { label: 'تصريح الرتقة والعبدلي', typeId: 'pt_ratqa',
    forms: [['p_checklist', 'قائمة المستندات المطلوبة — أفراد'], ['p_ratqa', 'نموذج طلب تصاريح الرتقة والعبدلي — أفراد']],
    cols: ['oldPermitNo', 'name', 'nationality', 'profession', 'idNo', 'residencyExp', 'area', 'action'] },
};
const PERMIT_FORM_ROWS = { clearance: 10, checklist: 12, undertaking: 10, request: 10, ratqa: 8 };     // أقصى عدد سيارات في النموذج
const PERMIT_FORM_SHEET = { p_checklist: 4, p_ratqa: 10 };       // نماذج الموظفين: كام اسم في الورقة (الزيادة ← ورقة تانية)
const PERMIT_REQUEST_TYPES = { renew: 'تجديد', first: 'أول مرة', lost: 'بدل فاقد', damaged: 'بدل تالف' };
const PERMIT_AREAS = { both: 'الرتقة والعبدلي', ratqa: 'الرتقة', abdali: 'العبدلي' };
// أعمدة الجدول: [العنوان، نوع الخانة، العرض]
const PERMIT_FORM_COLS = {
  plate: ['رقم اللوحة', 'text', 96], shape: ['شكل المركبة', 'shape', 92], shapeEn: ['الشكل (إنجليزي)', 'text', 110], color: ['اللون', 'text', 80], color2: ['اللون الثاني', 'text', 80],
  modelYear: ['الموديل (السنة)', 'text', 76], modelEn: ['النوع / السنة (إنجليزي)', 'text', 120], chassis: ['رقم الشاصي', 'text', 150], permitCode: ['الكود', 'text', 64],
  oldPermitNo: ['رقم التصريح القديم', 'text', 104], oldPermitExpiry: ['انتهاء التصريح القديم', 'date', 136], licenseExpiry: ['انتهاء دفتر المركبة', 'date', 136],
  checked: ['تاريخ الفحص', 'date', 136], valid: ['صالحة حتى', 'date', 136], ref: ['رقم شهادة الفحص', 'text', 190],
  name: ['الاسم', 'text', 230], nationality: ['الجنسية', 'text', 90], profession: ['المهنة', 'text', 150], idNo: ['رقم الجواز / المدني', 'text', 130],
  residencyExp: ['انتهاء الإقامة', 'date', 136], area: ['المنطقة', PERMIT_AREAS, 130], action: ['نوع الإجراء', PERMIT_REQUEST_TYPES, 110],
};
// الشكل (زي نموذج الجهة) ← اسمه بالإنجليزي في شهادة الفحص
const VEHICLE_SHAPES = { 'قاطرة': 'TRUCK HEAD', 'وانيت': 'PICKUP', 'جيب': 'JEEP', 'صالون': 'SALOON', 'بوكس': 'BOX', 'حافلة': 'BUS', 'باص': 'MINI BUS',
  'سوبر بان': 'SUBURBAN', 'فان': 'VAN', 'شاحنة': 'TRUCK', 'تريلا': 'TRAILER', 'تنكر': 'TANKER', 'كرين': 'CRANE' };
// الجنسية في النماذج صفة («مصري») والبرنامج مسجّل البلد («مصر»)
const NATIONALITY_ADJ = { 'مصر': 'مصري', 'الهند': 'هندي', 'باكستان': 'باكستاني', 'بنغلاديش': 'بنغلاديشي', 'بنجلاديش': 'بنغلاديشي', 'الفلبين': 'فلبيني', 'نيبال': 'نيبالي',
  'سوريا': 'سوري', 'الأردن': 'أردني', 'الاردن': 'أردني', 'لبنان': 'لبناني', 'الكويت': 'كويتي', 'السعودية': 'سعودي', 'سريلانكا': 'سريلانكي', 'السودان': 'سوداني', 'اليمن': 'يمني', 'إيران': 'إيراني', 'ايران': 'إيراني' };
const permitFormPlate = p => String(p || '').replace(/-/g, '/');          // «91-57023» ← «91/57023» زي النماذج
// تاريخ تقديم الطلب = يوم العمل اللي بعد النهارده (الجمعة والسبت إجازة — getDay)
const PERMIT_WEEKEND = [5, 6];
function permitNextWorkDay(iso) {
  let d = addDays(iso, 1);
  while (PERMIT_WEEKEND.includes(new Date(d + 'T00:00:00').getDay())) d = addDays(d, 1);
  return d;
}
/** آخر تصريح لصاحبه من نوع النماذج (رقمه بيتكتب «التصريح القديم») */
function permitFormOld(holder, id, typeId) {
  return permitsOf(holder, id).filter(p => p.typeId === typeId).sort((a, b) => (b.expiryDate || '').localeCompare(a.expiryDate || ''))[0] || {};
}
/** سطر سيارة في النافذة: بياناتها من قسم السيارات + تصريحها القديم من نفس النوع */
function permitFormVehicleRow(v, kind) {
  const old = permitFormOld('vehicle', v.id, PERMIT_FORM_KINDS[kind].typeId);
  const year = v.modelYear || (/(19|20)\d{2}/.exec(v.model || '') || [''])[0];
  return { id: v.id, plate: permitFormPlate(v.plate), shape: v.shape || '', shapeEn: v.shapeEn || VEHICLE_SHAPES[v.shape] || '', color: v.color || '', color2: v.color2 || '',
    modelYear: year, modelEn: v.modelEn || '', chassis: v.chassisNo || '', permitCode: v.permitCode || '',
    oldPermitNo: old.permitNo || '', oldPermitExpiry: old.expiryDate || '', licenseExpiry: v.insuranceExpiry || '', checked: '', valid: '', ref: '', refAuto: true };
}
/** سطر موظف: بياناته من مركز الموظفين + تصريحه القديم من نفس النوع (له تصريح قديم ← «تجديد»، وإلا «أول مرة») */
function permitFormEmployeeRow(h, kind) {
  const old = permitFormOld('employee', h.id, PERMIT_FORM_KINDS_EMP[kind].typeId);
  return { id: h.id, name: h.name || '', nationality: NATIONALITY_ADJ[h.nationality] || h.nationality || '', profession: h.profession || '', idNo: h.id,
    residencyExp: h.residencyExp || '', oldPermitNo: old.permitNo || '', area: 'both', action: old.permitNo ? 'renew' : 'first' };
}

function openVehiclePermitForms(pre = {}) { return openPermitForms('vehicle', pre); }
function openEmployeePermitForms(pre = {}) { return openPermitForms('employee', pre); }

/** holder = vehicle | employee؛ pre = { vehicleIds | employeeIds, kind, projectId, part } */
function openPermitForms(holder, pre = {}) {
  if (!STATE.permitFormsAvailable) return openBlockAlert(t('قوالب نماذج التصاريح مش موجودة على السيرفر.'));
  const emp = holder === 'employee', KINDS = emp ? PERMIT_FORM_KINDS_EMP : PERMIT_FORM_KINDS;
  const holders = emp ? ((STATE.permitHolders || {}).employees || []).filter(e => !empEnded(e)) : STATE.vehicles;
  const byId = id => (emp ? holderOf('employee', id) : IDX.vehicle[id]);
  const rowOf = (x, kind) => (emp ? permitFormEmployeeRow(x, kind) : permitFormVehicleRow(x, kind));
  // الجزء اللي النماذج بتطلع له (من قسم التصاريح): عقوده بس، ولو شركة داخلة من الباطن ← اسمها في «المقاول من الباطن»
  const part = pre.part && pre.part !== 'all' ? pre.part : '', partX = permitPart(part), subX = partX && partX.sub ? partX : null;
  const projects = scopedProjects().filter(p => ['gov', 'sub'].includes(p.kind) && permitProjectInPart(p, part)).sort((a, b) => projectName(a.id).localeCompare(projectName(b.id), 'ar'));
  if (!projects.length) return openBlockAlert(t('مفيش عقود حكومية أو من الباطن — التصاريح بتطلع على عقد.'));
  // العقد الافتراضي: عقد السيارة / الموظف المختار، وإلا آخر عقد اشتغلت عليه على الجهاز ده، وإلا أول عقد
  const preIds = (emp ? pre.employeeIds : pre.vehicleIds) || [];
  const first = byId(preIds[0]) || {}, known = id => projects.some(p => p.id === id);
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('lunx.permitForms.' + k) || ''; localStorage.setItem('lunx.permitForms.' + k, v); } catch (e) { /* التخزين مقفول */ } return ''; };
  // المقاول من الباطن: بعلامة، ومن الشركات المتسجّلة باطن (في جزء شركة الباطن متعلّم وثابت)
  const subs = permitSubParts();
  const S = { kind: KINDS[pre.kind] ? pre.kind : 'koc', rows: [], mandoubId: '', subId: subX ? subX.id : '', unlock: false,
    projectId: [pre.projectId, first.projectId, first.affairsProjectId, store('project')].find(known) || projects[0].id };
  const sub = () => (S.subId ? permitPart('co:' + S.subId) : null);
  const workDay = permitNextWorkDay(todayISO());
  // بيانات العقد: اسم المقاول ثابت (من الوكالة)، والباقي مقفول لحد «تعديل بيانات العقد»
  const FIXED = ['contractorAr', 'contractorEn'], CONTRACT = ['startDate', 'endDate', 'extDate', 'team', 'teamEn', 'teamCode', 'clearancePrefix'];
  const field = (f, label, type = 'text', cls = '') => `<label class="${cls}">${t(label)}<input ${type === 'date' ? 'type="date"' : ''} data-f="${f}"${type === 'ltr' ? ' dir="ltr"' : ''}></label>`;
  const m = openModal({
    title: '📄 ' + t(emp ? 'نماذج تصاريح الموظفين' : 'نماذج تصاريح السيارات') + (partX ? ' — ' + esc(permitPartName(part)) : ''), size: 'wide',
    body: `<div class="form" id="pf-top">
        <label>${t('نوع التصريح')}<select id="pf-kind">${Object.entries(KINDS).map(([k, v]) => opt(k, t(v.label), k === S.kind)).join('')}</select></label>
        <label>${t('رقم العقد')}<select id="pf-project" dir="ltr">${projects.map(p => opt(p.id, p.contractNo || projectName(p.id), p.id === S.projectId)).join('')}</select><span class="small muted" id="pf-project-name"></span></label>
        ${field('from', 'المدة المطلوبة — من', 'date')}${field('to', 'إلى', 'date')}
        <label title="${esc(t('يوم العمل اللي بعد النهارده — الجمعة والسبت إجازة (وتقدر تغيّره)'))}">${t('تاريخ الطلب')}<input type="date" data-f="requestDate"></label></div>
      <div class="notice small" style="margin-top:8px">${t(emp ? 'البيانات متملّية من البرنامج. بيانات الموظفين والمندوب والتواريخ تتعدّل للطباعة دي بس — بيانات الموظف نفسها بتتعدّل من مركز الموظفين. بيانات العقد مقفولة.'
        : 'البيانات متملّية من البرنامج. بيانات السيارات والمندوب والتواريخ تتعدّل قبل الطباعة، ولو عايز تعديل السيارة يتحفظ اضغط «حفظ التعديلات في البيانات». بيانات العقد مقفولة.')}</div>
      <h4 class="cu-h">🏢 ${t('بيانات العقد')} <span class="small muted">— ${t('من بيانات العقد والوكالة')}</span>
        ${can('permits.edit') && can('companies.edit') ? `<button type="button" class="btn sm" id="pf-unlock" style="margin-inline-start:8px">✏️ ${t('تعديل بيانات العقد')}</button>` : ''}</h4>
      <div class="form" id="pf-contract">${field('contractorAr', 'اسم المقاول الرئيسي (عربي)', 'text', 'full')}${field('contractorEn', 'اسم المقاول الرئيسي (إنجليزي)', 'ltr', 'full')}
        ${field('startDate', 'تاريخ بدء العقد', 'date')}${field('endDate', 'تاريخ انتهاء العقد', 'date')}
        ${field('extDate', 'تمديد العقد حتى', 'date')}${field('team', 'فريق العمل المسؤول')}${field('teamEn', 'فريق العمل (إنجليزي)', 'ltr')}${field('teamCode', 'رمز فريق العمل', 'ltr')}
        ${emp ? '' : field('clearancePrefix', 'الجزء الثابت من رقم شهادة الفحص', 'ltr')}</div>
      <div id="pf-missing"></div>
      ${subs.length ? `<div class="row" style="gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap"><label class="check"><input type="checkbox" id="pf-sub-on" ${S.subId ? 'checked' : ''} ${subX ? 'disabled' : ''}> ${t('داخل مقاول من الباطن')}</label>
        <select id="pf-sub" ${subX ? 'disabled' : ''} ${S.subId ? '' : 'hidden'}>${subs.map(x => opt(x.id, permitPartName(x.key), x.id === S.subId)).join('')}</select></div>` : ''}
      <h4 class="cu-h">👤 ${t('المندوب والمعتمد')}</h4>
      <div class="form"><label>${t('المندوب')}<select id="pf-mandoub"></select></label>${field('mandoubName', 'اسم المندوب في النموذج')}${field('mandoubNationality', 'الجنسية')}
        ${field('mandoubCivil', 'الرقم المدني', 'ltr')}${field('mandoubPhone', 'التليفون', 'ltr')}
        <label>${t('معتمد الشركة')}<input data-f="signatory" list="pf-signs"><datalist id="pf-signs"></datalist></label></div>
      <h4 class="cu-h">${emp ? '👥' : '🚗'} ${t(emp ? 'الموظفين' : 'السيارات')} <span class="small muted" id="pf-count"></span></h4>
      <div class="row" style="gap:8px;margin-bottom:6px"><input type="search" id="pf-add" list="pf-vehicles" placeholder="${esc(t(emp ? 'أضف موظف: اكتب الاسم أو الرقم المدني واختار…' : 'أضف سيارة: اكتب رقم اللوحة واختار…'))}" style="flex:1;min-width:220px" autocomplete="off">
        <datalist id="pf-vehicles"></datalist></div>
      <div class="table-wrap"><table class="data pf-veh" id="pf-veh"></table></div>
      <datalist id="pf-shapes">${Object.keys(VEHICLE_SHAPES).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <h4 class="cu-h">🖨️ ${t('النماذج')}</h4><div id="pf-forms"></div>`,
    foot: `<button class="btn primary" data-all>🖨️ ${t('معاينة وطباعة الكل')}</button>
      <button class="btn write-only" data-p="permits.edit" data-store>💾 ${t('حفظ التعديلات في البيانات')}</button>
      <span class="small muted">${t('معاينة وطباعة بس — التنزيل مقفول')}</span><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const E = m.el, F = f => $(`[data-f="${f}"]`, E), val = f => (F(f) ? F(f).value || '' : '').trim(), set = (f, v) => { if (F(f)) F(f).value = v || ''; };
  const project = () => IDX.project[S.projectId] || {};
  const agency = () => agencyById(project().agencyId) || {};
  const lock = () => {
    FIXED.forEach(f => { if (F(f)) F(f).readOnly = true; });
    CONTRACT.forEach(f => { if (F(f)) F(f).readOnly = !S.unlock; });
  };
  /** الخانات الفاضية في بيانات العقد ← تنبيه (هتطلع فاضية في النماذج) */
  const missing = () => {
    const need = [['contractorEn', 'اسم المقاول الرئيسي (إنجليزي)'], ['team', 'فريق العمل المسؤول'], ['teamEn', 'فريق العمل (إنجليزي)'], ['teamCode', 'رمز فريق العمل'],
      ...(!emp && S.kind === 'koc' ? [['clearancePrefix', 'الجزء الثابت من رقم شهادة الفحص']] : [])].filter(([f]) => !val(f)).map(([, l]) => t(l));
    $('#pf-missing', E).innerHTML = need.length ? `<div class="notice warn small" style="margin-top:6px">⚠️ ${t('بيانات العقد ناقصة')}: ${need.map(esc).join('، ')} — ${t('هتطلع فاضية في النماذج.')}</div>` : '';
  };
  // ---- المندوب والمعتمد: بتوع المقاول من الباطن الأول (لو متعلّم)، وبعدهم بتوع وكالة العقد
  const fillPeople = () => {
    const a = agency(), sx = sub();
    const ids = uniq([...(sx ? sx.mandoubs || [] : []), ...(a.mandoubs || [])]).filter(id => IDX.employee[id]);
    S.mandoubId = ids[0] || '';
    $('#pf-mandoub', E).innerHTML = ids.map((id, i) => opt(id, IDX.employee[id].name + (i ? '' : ` (${t('الأساسي')})`), id === S.mandoubId)).join('') + opt('', t('— مندوب تاني (اكتب بياناته) —'), !S.mandoubId);
    fillMandoub();
    const signs = uniq([...(sx ? sx.signatories || [] : []), ...(a.signatories || [])]);
    $('#pf-signs', E).innerHTML = signs.map(x => `<option value="${esc(x)}">`).join('');
    set('signatory', signs[0]);
  };
  // ---- بيانات العقد والمقاول من العقد ووكالته
  const fillContract = () => {
    const p = project(), a = agency(), end = p.clientExtDate || p.clientEndDate || p.expiryDate || '';
    $('#pf-project-name', E).textContent = projectName(p.id);
    set('contractorAr', a.contractorAr || companyName(p.companyId)); set('contractorEn', a.contractorEn || (IDX.company[p.companyId] || {}).nameEn);
    set('startDate', p.clientStartDate || p.startDate); set('endDate', p.clientEndDate || p.expiryDate);
    set('extDate', p.clientExtDate); set('team', p.clientTeam); set('teamEn', p.clientTeamEn); set('teamCode', p.clientTeamCode); set('clearancePrefix', p.clearancePrefix);
    set('from', workDay); set('to', end); set('requestDate', workDay);      // الطلب بيتقدّم يوم العمل اللي بعده، والمدة بتبدأ منه
    lock(); missing(); fillPeople();
  };
  const fillMandoub = () => {
    const e = IDX.employee[S.mandoubId];
    // في نماذج الموظفين الاسم بيتكتب ثلاثي («اسم مقدم الطلب»)، وفي السيارات أول اسمين زي نماذجها
    set('mandoubName', e ? e.name.trim().split(/\s+/).slice(0, emp ? 3 : 2).join(' ') : ''); set('mandoubNationality', e ? NATIONALITY_ADJ[e.nationality] || e.nationality : '');
    set('mandoubCivil', e ? e.id : ''); set('mandoubPhone', e ? e.phone : '');
  };
  // ---- الجدول (كل خانة تتعدّل)
  const refOf = r => (val('clearancePrefix') + (r.permitCode || '')).trim();
  const syncAuto = () => { if (!emp) S.rows.forEach(r => { if (r.refAuto) r.ref = refOf(r); if (!r.valid) r.valid = val('to'); }); };
  const cell = (r, i, c) => {
    const [, type, w] = PERMIT_FORM_COLS[c], at = `data-vf="${i}|${c}" style="width:${w}px"`;
    if (typeof type === 'object') return `<select ${at}>${Object.entries(type).map(([k, l]) => opt(k, t(l), k === r[c])).join('')}</select>`;
    return `<input ${at} value="${esc(r[c] || '')}" ${type === 'date' ? 'type="date"' : ''} ${type === 'shape' ? 'list="pf-shapes"' : ''} ${/^(shapeEn|modelEn|chassis|permitCode|ref|idNo)$/.test(c) ? 'dir="ltr"' : ''}>`;
  };
  // أصحاب العقد المختار (أو شركة الباطن) أول القايمة
  const mine = x => ((S.subId ? x.companyId === S.subId || x.ownerCompanyId === S.subId : x.projectId === S.projectId || x.affairsProjectId === S.projectId) ? 0 : 1);
  const pickLabel = x => (emp ? `${x.id} — ${x.name}` : permitFormPlate(x.plate));
  const drawRows = () => {
    const cols = KINDS[S.kind].cols;
    syncAuto();
    $('#pf-count', E).textContent = `(${S.rows.length})`;
    $('#pf-veh', E).innerHTML = `<thead><tr><th style="width:34px">#</th>${cols.map(c => `<th>${t(PERMIT_FORM_COLS[c][0])}</th>`).join('')}<th></th></tr></thead><tbody>
      ${S.rows.map((r, i) => `<tr><td class="num">${i + 1}</td>${cols.map(c => `<td>${cell(r, i, c)}</td>`).join('')}
        <td><button type="button" class="btn sm danger" data-vrm="${i}">✕</button></td></tr>`).join('')
        || `<tr><td colspan="${cols.length + 2}" class="empty">${t(emp ? 'أضف موظف من الخانة اللي فوق' : 'أضف سيارة من الخانة اللي فوق')}</td></tr>`}</tbody>`;
    const used = new Set(S.rows.map(r => r.id));
    $('#pf-vehicles', E).innerHTML = holders.filter(x => !used.has(x.id)).sort((a, b) => mine(a) - mine(b) || pickLabel(a).localeCompare(pickLabel(b), 'ar'))
      .map(x => `<option value="${esc(pickLabel(x))}">${esc([emp ? x.profession : x.model, mine(x) ? '' : S.subId ? permitPartName('co:' + S.subId) : projectName(S.projectId)].filter(Boolean).join(' · '))}</option>`).join('');
    $$('[data-vrm]', E).forEach(b => b.onclick = () => { S.rows.splice(Number(b.dataset.vrm), 1); drawRows(); drawForms(); });
  };
  const drawForms = () => {
    const K = KINDS[S.kind], n = S.rows.length;
    const dates = `<label class="small">${t('تحت Permanent')} <input type="date" data-f="permanent"></label><label class="small">${t('تحت Temporary')} <input type="date" data-f="temporary"></label>`;
    const extra = { checklist: dates, p_checklist: dates,
      ratqa: `<label class="small"><input type="checkbox" data-f="areaRatqa" checked> ${t('الرتقة')}</label><label class="small"><input type="checkbox" data-f="areaAbdali" checked> ${t('العبدلي')}</label>
        <label class="small">${t('نوع الطلب')} <select data-f="requestType">${Object.entries(PERMIT_REQUEST_TYPES).map(([k, l]) => opt(k, t(l), k === (S.rows.some(r => r.oldPermitNo) ? 'renew' : 'first'))).join('')}</select></label>`,
      p_ratqa: `<label class="small" title="${esc(t('الحروف اللي بتتكتب في ركن النموذج تحت (اللي جهّز الطلب) — اختياري'))}">${t('حروف مُعِدّ الطلب')} <input data-f="initials" dir="ltr" maxlength="8" style="width:70px"></label>` };
    const sheets = key => (PERMIT_FORM_SHEET[key] && n > PERMIT_FORM_SHEET[key] ? `<div class="small muted">${Math.ceil(n / PERMIT_FORM_SHEET[key])} ${t('ورق')} — ${PERMIT_FORM_SHEET[key]} ${t('أسماء في الورقة')}</div>` : '');
    const keep = Object.fromEntries(['permanent', 'temporary', 'initials'].map(f => [f, F(f) ? F(f).value : null]));
    $('#pf-forms', E).innerHTML = K.forms.map(([key, label, hint], i) => `<div class="pf-form"><b class="num">${i + 1}</b><div><b>${t(label)}</b>${hint ? ` <span class="small muted">— ${t(hint)}</span>` : ''}
        ${n > PERMIT_FORM_ROWS[key] ? `<div class="small" style="color:var(--red)">${t('النموذج بيشيل')} ${PERMIT_FORM_ROWS[key]} ${t('سيارات بالكتير — قسّم الطلب')}</div>` : ''}${sheets(key)}
        ${extra[key] ? `<div class="row" style="gap:10px;margin-top:4px">${extra[key]}</div>` : ''}</div>
      <span class="spacer"></span><button class="btn" data-form="${key}">🖨️ ${t('معاينة وطباعة')}</button></div>`).join('');
    if (F('permanent')) { set('permanent', keep.permanent ?? val('to')); set('temporary', keep.temporary ?? val('from')); }
    if (F('initials')) set('initials', keep.initials ?? store('initials'));
    $$('[data-form]', E).forEach(b => b.onclick = () => print([b.dataset.form]));
  };
  const addRow = x => { if (!x || S.rows.some(r => r.id === x.id)) return; S.rows.push(rowOf(x, S.kind)); };
  // ---- جمع البيانات اللي ظاهرة
  const collect = () => ({
    contractorAr: val('contractorAr'), contractorEn: val('contractorEn'), subcontractor: (sub() || {}).nameAr || '', subcontractorEn: (sub() || {}).nameEn || '', contractNo: project().contractNo || '',     // رقم العقد من العقد المختار (مش بيتكتب)
    startDate: val('startDate'), endDate: val('endDate'), extDate: val('extDate'), team: val('team'), teamEn: val('teamEn'), teamCode: val('teamCode'),
    from: val('from'), to: val('to'), requestDate: val('requestDate'), signatory: val('signatory'),
    mandoub: { name: val('mandoubName'), nationality: val('mandoubNationality'), civilId: val('mandoubCivil'), phone: val('mandoubPhone') },
    permanent: F('permanent') ? F('permanent').value : '', temporary: F('temporary') ? F('temporary').value : '', initials: val('initials'),
    requestType: F('requestType') ? F('requestType').value : '', areas: { ratqa: !F('areaRatqa') || F('areaRatqa').checked, abdali: !F('areaAbdali') || F('areaAbdali').checked },
    ...(emp ? { people: S.rows.map(r => ({ ...r })) } : { vehicles: S.rows.map(r => ({ ...r, valid: r.valid || val('to') })) }),
  });
  const print = async forms => {
    if (!S.rows.length) return openBlockAlert(t(emp ? 'أضف موظف واحد على الأقل' : 'أضف سيارة واحدة على الأقل'));
    const K = KINDS[S.kind], over = forms.find(f => S.rows.length > PERMIT_FORM_ROWS[f]);
    if (over) return openBlockAlert(`«${t(K.forms.find(x => x[0] === over)[1])}» ${t('بيشيل')} ${PERMIT_FORM_ROWS[over]} ${t('سيارات بالكتير — قسّم الطلب')}`);
    if (F('initials')) store('initials', val('initials'));
    toast(t('جاري تجهيز المعاينة…'));
    try {
      const r = await postForBlob(`/api/permit-forms/${S.kind}/pdf`, { holder, forms, data: collect(), part: S.subId ? 'co:' + S.subId : part || permitPartKey('', S.projectId) });
      const name = forms.length === 1 ? t(K.forms.find(x => x[0] === forms[0])[1]) : `${t('نماذج')} ${t(K.label)}`;
      openPdfPreviewModal(r.blob, name + '.pdf', 1, 'permit');
    } catch (e) { openBlockAlert(esc(e.message)); }
  };
  // ---- الأحداث
  const edit = ev => {
    const el = ev.target;
    if (el.dataset.vf) {
      const [i, c] = el.dataset.vf.split('|'), r = S.rows[Number(i)];
      r[c] = el.value;
      if (c === 'ref') r.refAuto = false;
      if (c === 'shape' && VEHICLE_SHAPES[el.value]) { r.shapeEn = VEHICLE_SHAPES[el.value]; const x = $(`[data-vf="${i}|shapeEn"]`, E); if (x) x.value = r.shapeEn; }
      if (c === 'permitCode' && r.refAuto) { r.ref = refOf(r); const x = $(`[data-vf="${i}|ref"]`, E); if (x) x.value = r.ref; }
    } else if (el.dataset.f === 'clearancePrefix') { syncAuto(); S.rows.forEach((r, i) => { const x = $(`[data-vf="${i}|ref"]`, E); if (x) x.value = r.ref; }); }
    if (CONTRACT.includes(el.dataset.f)) missing();
  };
  E.addEventListener('input', edit);
  E.addEventListener('change', ev => { if (ev.target.tagName === 'SELECT' && ev.target.dataset.vf) edit(ev); });
  $('#pf-add', E).addEventListener('change', ev => {
    const q = ev.target.value.trim(), x = holders.find(h => pickLabel(h) === q || (emp ? h.id === q.split(' — ')[0].trim() : h.plate === q));
    if (!x) return;
    ev.target.value = '';
    addRow(x); drawRows(); drawForms();
  });
  $('#pf-kind', E).onchange = ev => {
    S.kind = ev.target.value;
    // التصريح القديم بيختلف بالنوع (ومعاه نوع الإجراء للموظف) ← من البرنامج تاني
    S.rows = S.rows.map(r => { const x = byId(r.id), fresh = x ? rowOf(x, S.kind) : {};
      return { ...r, oldPermitNo: fresh.oldPermitNo || '', oldPermitExpiry: fresh.oldPermitExpiry || '', ...(emp ? { action: fresh.action || 'first' } : {}) }; });
    drawRows(); drawForms(); missing();
  };
  const subOn = $('#pf-sub-on', E), subSel = $('#pf-sub', E);
  if (subOn) {
    const pick = () => { subSel.hidden = !subOn.checked; S.subId = subOn.checked ? subSel.value : ''; fillPeople(); drawRows(); };
    subOn.onchange = pick; subSel.onchange = pick;
  }
  const un = $('#pf-unlock', E);
  if (un) un.onclick = () => { S.unlock = true; lock(); un.hidden = true; toast(t('بيانات العقد اتفتحت للتعديل — اضغط «حفظ التعديلات في البيانات» عشان تتسجّل.')); const x = F('team'); if (x) x.focus(); };
  $('#pf-project', E).onchange = ev => { S.projectId = ev.target.value; store('project', S.projectId); fillContract(); drawRows(); drawForms(); };
  $('#pf-mandoub', E).onchange = ev => { S.mandoubId = ev.target.value; fillMandoub(); };
  $('[data-all]', E).onclick = () => print(KINDS[S.kind].forms.map(x => x[0]));
  $('[data-store]', E).onclick = async () => {
    const p = project();
    // تاريخ العقد عند الجهة: لو الخانة لسه على البديل (تاريخ الترخيص) ومتسجّلش قبل كده ← مايتسجّلش
    const own = (f, saved, fallback) => (saved || val(f) !== (fallback || '') ? val(f) : '');
    const body = { vehicles: emp ? [] : S.rows.filter(r => IDX.vehicle[r.id]).map(r => ({ id: r.id, color: r.color, color2: r.color2, shape: r.shape, shapeEn: r.shapeEn, chassisNo: r.chassis,
        modelYear: r.modelYear, modelEn: r.modelEn, permitCode: r.permitCode })),
      project: p.id ? { id: p.id, clientStartDate: own('startDate', p.clientStartDate, p.startDate), clientEndDate: own('endDate', p.clientEndDate, p.expiryDate), clientExtDate: val('extDate'), clientTeam: val('team'), clientTeamEn: val('teamEn'),
        clientTeamCode: val('teamCode'), ...(emp ? {} : { clearancePrefix: val('clearancePrefix') }) } : null,
      agency: null,                               // اسم المقاول ثابت هنا — بيتعدّل من بيانات الوكالة
      mandoub: S.mandoubId ? { id: S.mandoubId, phone: val('mandoubPhone') } : null };
    if (!await openConfirm(t(emp ? 'حفظ بيانات العقد وتليفون المندوب اللي في النافذة؟ (بيانات الموظفين بتتعدّل من مركز الموظفين، وتواريخ الطلب مابتتحفظش)'
      : 'حفظ اللي في النافذة في بيانات السيارات والعقد وتليفون المندوب؟ (رقم التصريح القديم وتواريخ الطلب مابتتحفظش)'), { okLabel: t('حفظ') })) return;
    try {
      const r = await persist('PUT', '/api/permit-forms/data', body);
      toast(r.saved && r.saved.length ? `${t('اتحفظ')}: ${r.saved.join('، ')}` : t('مفيش تعديلات جديدة تتحفظ'), 'ok');
    } catch (e) { /* ظاهر */ }
  };
  fillContract();
  preIds.forEach(id => addRow(byId(id)));
  drawRows(); drawForms();
  translateDomText(E);
}
