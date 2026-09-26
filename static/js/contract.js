/* =====================================================================
   CONTRACT GENERATOR — شاشة عقد العمل والمعاينة
   ⚠️ محرك العقود مُجمَّد (docx_engine.py) — الشاشة دي بتستدعيه بس.
   ===================================================================== */
'use strict';

const CONTRACT_FIELDS_HELP = [
  ['employee_name', 'اسم الموظف'], ['employee_name_en', 'الاسم بالإنجليزي'], ['civil_id', 'الرقم المدني'],
  ['nationality', 'الجنسية'], ['nationality_en', 'الجنسية بالإنجليزي'], ['profession', 'المهنة'], ['profession_en', 'المهنة بالإنجليزي'],
  ['salary', 'الراتب'], ['housing_amount', 'بدل السكن'], ['start_date', 'تاريخ العقد'], ['day_name', 'اليوم'], ['day_name_en', 'اليوم بالإنجليزي'],
  ['company_name', 'اسم الشركة'], ['company_name_en', 'اسم الشركة بالإنجليزي'], ['labor_office', 'إدارة العمل'], ['labor_office_en', 'إدارة العمل بالإنجليزي'], ['file_number', 'رقم الملف'],
  ['project_name', 'المشروع'], ['auth_name', 'المفوّض بالتوقيع'], ['auth_name_en', 'المفوّض بالإنجليزي'], ['auth_civil_id', 'الرقم المدني للمفوّض'],
  ['passport_no', 'رقم الجواز'], ['residency_exp', 'انتهاء الإقامة'],
  ['housing_clause', 'بند بدل السكن (أو «لايوجد»)'], ['housing_clause_en', 'بند بدل السكن بالإنجليزي (أو NONE)'],
];
let CONTRACT = { emp: '', tpl: '', company: '', sig: '', date: '', salary: '', housing: '1', signFirst: '', signSecond: '' };
let CONTRACT_PREVIEW = 'pdf';          // pdf | quick

function contractQuery(extra = {}) {
  const p = new URLSearchParams();
  Object.entries(Object.assign({}, CONTRACT, extra)).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString();
}

function renderContractView() {
  if (!canAll('employees.view sensitive.salary')) {
    viewRoot().innerHTML = `<div class="page-head"><div><h1>عقد العمل</h1></div></div>
      <div class="notice warn">${t('إنشاء العقود محتاج صلاحية عرض الموظفين وصلاحية «المرتب» لأن العقد فيه الراتب. كلّم مدير النظام.')}</div>`;
    return;
  }
  if (VIEW_ARGS.emp) { CONTRACT = { emp: VIEW_ARGS.emp, tpl: CONTRACT.tpl, company: '', sig: '', date: '', salary: '', housing: CONTRACT.housing, signFirst: CONTRACT.signFirst, signSecond: CONTRACT.signSecond }; VIEW_ARGS = {}; }
  const e = IDX.employee[CONTRACT.emp];
  const defTpl = STATE.templates.find(x => x.isDefault) || STATE.templates[0];
  if (!CONTRACT.tpl || !IDX.template[CONTRACT.tpl]) CONTRACT.tpl = defTpl ? defTpl.id : '';
  const coId = CONTRACT.company || (e ? empCompanyId(e) : '');
  const sigs = coId && IDX.company[coId] ? IDX.company[coId].signatories : STATE.companies.flatMap(c => c.signatories);
  if (CONTRACT.sig && !sigs.find(s => s.id === CONTRACT.sig)) CONTRACT.sig = '';
  const empList = scopedEmployees().filter(x => x.employmentStatus !== 'terminated');
  const selSig = CONTRACT.sig ? sigs.find(s => s.id === CONTRACT.sig) : (coId && IDX.company[coId] ? (IDX.company[coId].signatories || [])[0] : null);
  const pdfMode = STATE.pdfAvailable && CONTRACT_PREVIEW === 'pdf';

  viewRoot().innerHTML = `<div class="page-head"><div><h1>عقد العمل</h1><div class="sub">${t('ملف Word أو PDF بنفس تنسيق القالب')}</div></div>
      <div class="actions"><button class="btn primary" id="c-batch">📚 ${t('عقود متعددة (PDF واحد)')}</button></div></div>
    <div class="contract-layout">
      <div class="card no-print">
        <div class="form" style="grid-template-columns:1fr">
          <label><span class="req">${t('الموظف')}</span><input id="c-emp" list="c-emp-list" placeholder="اكتب الاسم أو الرقم المدني…" value="${e ? esc(e.name + ' — ' + e.id) : ''}"></label>
          <datalist id="c-emp-list">${empList.map(x => `<option value="${esc(x.name + ' — ' + x.id)}">`).join('')}</datalist>
          <label>${t('القالب')}<select id="c-tpl">${STATE.templates.map(x => opt(x.id, (x.isDefault ? '★ ' : '') + x.name, x.id === CONTRACT.tpl)).join('')}</select></label>
          <label>${t('الشركة (الطرف الأول)')}<select id="c-co">${companyOptions(coId, '— الشركة المسجّل عليها —')}</select></label>
          <label>${t('المفوّض بالتوقيع')}<select id="c-sig">${opt('', t('— أول مفوّض في الشركة —'), !CONTRACT.sig)}${sigs.map(s => opt(s.id, s.nameAr + (s.civilId ? ' (' + s.civilId + ')' : ''), s.id === CONTRACT.sig)).join('')}</select></label>
          <label>${t('تاريخ العقد')}<input type="date" id="c-date" value="${esc(CONTRACT.date || (e && e.dateOfHire) || '')}"></label>
          <label>${t('الراتب في العقد (اختياري)')}<input type="number" step="0.001" id="c-salary" placeholder="${e && e.salary ? esc(e.salary) : ''}" value="${esc(CONTRACT.salary)}"></label>
          <label class="check"><input type="checkbox" id="c-housing" ${CONTRACT.housing !== '0' ? 'checked' : ''}> ${t('إضافة بند بدل السكن (البند الثالث عشر)')}</label>
          <label class="check" data-p="contract.sign"><input type="checkbox" id="c-sign1" ${CONTRACT.signFirst ? 'checked' : ''}> ✍️ ${t('بتوقيع المفوّض')}
            ${selSig ? (hasSignature(selSig.civilId) ? '<span class="small" style="color:var(--green,#1f7a4d)">✓</span>' : `<span class="small" style="color:var(--orange)">(${t('مفيش توقيع مرفوع')})</span>`) : ''}</label>
          <label class="check" data-p="contract.sign"><input type="checkbox" id="c-sign2" ${CONTRACT.signSecond ? 'checked' : ''}> ✍️ ${t('بتوقيع الموظف')}
            ${e ? (hasSignature(e.id) ? '<span class="small" style="color:var(--green,#1f7a4d)">✓</span>' : `<span class="small" style="color:var(--orange)">(${t('مفيش توقيع مرفوع')})</span>`) : ''}</label>
        </div>
        <div id="c-warn"></div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap">
          <a class="btn primary ${e ? '' : 'disabled'}" ${e ? `href="/api/contract/docx?${contractQuery()}"` : ''}>⬇️ Word</a>
          ${STATE.pdfAvailable ? `<a class="btn ${e ? '' : 'disabled'}" ${e ? `href="/api/contract/pdf?${contractQuery({ dl: 1 })}"` : ''}>⬇️ PDF</a>` : ''}
          <button class="btn" id="c-print" ${e ? '' : 'disabled'}>🖨️ ${t('طباعة')}</button>
        </div>
        ${!STATE.pdfAvailable ? `<div class="small muted" style="margin-top:6px">${t('تحويل PDF محتاج LibreOffice أو Microsoft Word على السيرفر.')}</div>` : ''}
        <hr class="sep">
        <h3>📑 ${t('قوالب العقود')}</h3>
        ${STATE.templates.map(x => `<div class="row small" style="padding:4px 0;border-bottom:1px dashed var(--border)">
          <span style="flex:1">${x.isDefault ? '★ ' : ''}${esc(x.name)}</span>
          <a class="btn sm" href="/api/templates/${x.id}/file" title="تنزيل القالب">⬇️</a>
          ${!x.isDefault ? `<button class="btn sm write-only" data-p="contract.edit" data-tdef="${x.id}" title="جعله الافتراضي">★</button><button class="btn sm danger write-only" data-p="contract.edit" data-tdel="${x.id}">✕</button>` : ''}</div>`).join('')}
        <button class="btn write-only" data-p="contract.edit" id="t-upload" style="margin-top:8px">➕ ${t('رفع قالب جديد')}</button>
        <details style="margin-top:10px"><summary class="small">${t('الحقول المتاحة في القوالب')}</summary>
          <div class="small" data-no-i18n style="direction:ltr;text-align:left">${CONTRACT_FIELDS_HELP.map(([k, l]) => `<div><code>{{ ${k} }}</code> <span class="muted">${esc(t(l))}</span></div>`).join('')}</div></details>
      </div>
      <div>
        ${STATE.pdfAvailable ? `<div class="tabs no-print" style="margin-bottom:8px">
          <button data-pv="pdf" class="${pdfMode ? 'active' : ''}">📄 ${t('معاينة PDF')}</button>
          <button data-pv="quick" class="${pdfMode ? '' : 'active'}">⚡ ${t('معاينة سريعة')}</button></div>` : ''}
        ${pdfMode && e
          ? `<iframe id="c-pdf-frame" class="pdf-frame" src="/api/contract/pdf?${contractQuery()}" title="PDF"></iframe>`
          : `<div class="contract-paper" id="c-preview" dir="rtl">${e ? `<div class="empty">${t('جاري تجهيز المعاينة…')}</div>` : `<div class="empty">${t('اختر موظف لعرض معاينة العقد')}</div>`}</div>`}
      </div>
    </div>`;

  const set = (patch) => { Object.assign(CONTRACT, patch); render(); };
  $('#c-emp').addEventListener('change', ev => {
    const m = ev.target.value.match(/(\d{6,14})\s*$/);
    if (m && IDX.employee[m[1]]) set({ emp: m[1], company: '', sig: '', date: '', salary: '' });
  });
  $('#c-tpl').onchange = ev => set({ tpl: ev.target.value });
  $('#c-co').onchange = ev => set({ company: ev.target.value, sig: '' });
  $('#c-sig').onchange = ev => set({ sig: ev.target.value });
  $('#c-date').onchange = ev => set({ date: ev.target.value });
  $('#c-salary').onchange = ev => set({ salary: ev.target.value });
  $('#c-housing').onchange = ev => set({ housing: ev.target.checked ? '1' : '0' });
  $('#c-sign1').onchange = ev => set({ signFirst: ev.target.checked ? '1' : '' });
  $('#c-sign2').onchange = ev => set({ signSecond: ev.target.checked ? '1' : '' });
  $$('[data-pv]').forEach(b => b.onclick = () => { CONTRACT_PREVIEW = b.dataset.pv; render(); });
  $('#c-batch').onclick = () => openBatchContractModal(CONTRACT.emp ? [CONTRACT.emp] : []);
  $('#c-print').onclick = () => {
    const fr = $('#c-pdf-frame');
    if (fr) { try { fr.contentWindow.focus(); fr.contentWindow.print(); return; } catch (_) { window.open(fr.src, '_blank'); return; } }
    printHtml(t('عقد عمل'), `<style>td{width:50%;vertical-align:top;padding:8px}p{margin:0 0 3px}body{font-family:"Times New Roman",serif;line-height:1.7}@page{size:A4 portrait}</style>` + $('#c-preview').innerHTML);
  };
  $('#t-upload').onclick = openTemplateUploadModal;
  $$('[data-tdef]').forEach(b => b.onclick = () => persist('POST', `/api/templates/${b.dataset.tdef}/default`, {}, 'تم'));
  $$('[data-tdel]').forEach(b => b.onclick = async () => { if (await openConfirm(t('حذف القالب؟'), { danger: true })) persist('DELETE', '/api/templates/' + b.dataset.tdel, undefined, 'تم الحذف'); });
  if (e) buildContractHtml(!pdfMode);
}

/** المعاينة السريعة (HTML) + البيانات الناقصة من السيرفر (بعد الترجمات والمفوّض الافتراضي) */
async function buildContractHtml(showHtml = true) {
  const box = $('#c-preview'), warn = $('#c-warn');
  try {
    const r = await api('GET', '/api/contract/preview?' + contractQuery());
    if (showHtml && box && $('#c-preview') === box) box.innerHTML = r.html;
    if (warn && $('#c-warn') === warn) warn.innerHTML = (r.missing || []).length
      ? `<div class="notice warn" style="margin-top:10px">${t('بيانات ناقصة في العقد')}: ${r.missing.map(x => esc(t(x))).join('، ')}</div>` : '';
  } catch (e) { if (box) box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
}

/* =====================================================================
   عقود متعددة — اختيار موظفين ← ملف PDF واحد (معاينة / طباعة / تنزيل)
   ===================================================================== */
async function postForBlob(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
  const cd = r.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  return { blob: await r.blob(), name: m ? decodeURIComponent(m[1]) : 'contracts.pdf' };
}

function openBatchContractModal(preselected = []) {
  const max = STATE.contractBatchMax || 300;
  const sel = new Set(preselected.filter(id => IDX.employee[id]));
  const F = { q: '', company: '', status: 'active_only' };
  const defTpl = STATE.templates.find(x => x.isDefault) || STATE.templates[0];
  const m = openModal({
    title: '📚 ' + t('عقود متعددة'), size: 'wide',
    body: `<div class="form" id="bc-opts">
        <label>${t('القالب')}<select name="tpl">${STATE.templates.map(x => opt(x.id, (x.isDefault ? '★ ' : '') + x.name, defTpl && x.id === defTpl.id)).join('')}</select></label>
        <label>${t('الشركة (الطرف الأول)')}<select name="company">${companyOptions('', '— الشركة المسجّل عليها كل موظف —')}</select></label>
        <label>${t('المفوّض بالتوقيع')}<select name="sig">${batchSigOptions('')}</select></label>
        <label>${t('بند بدل السكن (البند الثالث عشر)')}<select name="housing">${opt('1', t('يُضاف لكل العقود'), true)}${opt('0', t('لا يُضاف («لايوجد»)'), false)}${opt('auto', t('حسب «بدل السكن مشمول» عند كل موظف'), false)}</select></label>
        <label>${t('تاريخ العقد')}<input type="date" name="date" value="${todayISO()}"></label>
        <label class="check" data-p="contract.sign"><input type="checkbox" name="signFirst"> ✍️ ${t('بتوقيع المفوّض (المرفوع)')}</label>
        <label class="check" data-p="contract.sign"><input type="checkbox" name="signSecond"> ✍️ ${t('بتوقيع الموظف (المرفوع)')}</label>
        <label class="check"><input type="checkbox" name="useHireDate"> ${t('استخدم تاريخ تعيين كل موظف (واللي مالوش ← التاريخ ده)')}</label>
      </div>
      <div class="small muted" id="bc-hint" style="margin:6px 0"></div>
      <h4>${t('الموظفين')} <span class="chip on" id="bc-count"></span></h4>
      <div class="filters">
        <input type="search" id="bc-q" placeholder="${t('بحث بالاسم أو الرقم المدني…')}">
        <select id="bc-co">${companyOptions('', '— كل الشركات —')}</select>
        <select id="bc-st">${opt('active_only', t('غير المنتهية خدماتهم'), true)}${opt('', t('— كل الحالات —'), false)}</select>
        <button class="btn sm" id="bc-all">☑️ ${t('تحديد الظاهرين')}</button>
        <button class="btn sm ghost" id="bc-none">✕ ${t('إلغاء التحديد')}</button>
      </div>
      <div class="table-wrap" style="max-height:42vh;overflow:auto"><table class="data"><tbody id="bc-list"></tbody></table></div>
      <div id="bc-msg" style="margin-top:8px"></div>`,
    foot: `<button class="btn primary" data-go="preview">👁️ ${t('معاينة PDF')}</button>
      <button class="btn" data-go="pdf">⬇️ ${t('تنزيل PDF')}</button>
      <button class="btn" data-go="zip">⬇️ ${t('Word (ZIP)')}</button>
      <span class="spacer"></span><button class="btn" data-close>إغلاق</button>`,
  });
  const el = m.el;
  const coSel = $('[name=company]', el), sigSel = $('[name=sig]', el);
  const hint = () => {
    const co = coSel.value, sg = sigSel.value && batchSigById(sigSel.value);
    const parts = [co ? `🏢 ${t('كل العقود باسم')} <b>${esc(companyName(co))}</b>` : `🏢 ${t('كل عقد بالشركة المسجّل عليها الموظف')}`,
      sg ? `✍️ ${t('المفوّض في كل العقود')}: <b>${esc(sg.nameAr)}</b>` : `✍️ ${t('أول مفوّض بالتوقيع في شركة كل عقد')}`];
    if (sg && co && sg.companyId !== co && !(IDX.company[co].signatories || []).some(x => sameSigPerson(x, sg)))
      parts.push(`<span style="color:var(--orange)">⚠️ ${t('المفوّض ده مش مسجّل كمفوّض للشركة دي')}</span>`);
    $('#bc-hint', el).innerHTML = parts.join(' · ');
  };
  coSel.onchange = () => {
    const keep = sigSel.value && batchSigById(sigSel.value);
    sigSel.innerHTML = batchSigOptions(coSel.value);
    // نفس الشخص لو ليه تسجيل في الشركة الجديدة ← نختاره هناك، وإلا نسيبه زي ما هو (حرية الاختيار)
    if (keep) {
      const own = (IDX.company[coSel.value] ? IDX.company[coSel.value].signatories || [] : []).find(x => sameSigPerson(x, keep));
      sigSel.value = own ? own.id : keep.id;
    }
    hint(); translateDomText(el);
  };
  sigSel.onchange = hint;
  hint();
  const visible = () => scopedEmployees().filter(e => {
    if (F.status === 'active_only' && e.employmentStatus === 'terminated') return false;
    if (F.company && !empInCompany(e, F.company)) return false;
    const q = norm(F.q);
    return !q || norm(e.name).includes(q) || norm(e.nameEn).includes(q) || String(e.id).includes(q);
  });
  const draw = () => {
    const list = visible();
    $('#bc-list', el).innerHTML = list.slice(0, 600).map(e => `<tr><td style="width:30px"><input type="checkbox" data-id="${esc(e.id)}" ${sel.has(e.id) ? 'checked' : ''}></td>
      <td><b>${esc(e.name)}</b> <span class="small muted num">${esc(e.id)}</span></td>
      <td class="small">${esc(companyName(empCompanyId(e)) || '—')}</td><td class="small muted">${esc(e.profession || '')}</td></tr>`).join('')
      || `<tr><td class="empty">${t('لا توجد نتائج')}</td></tr>`;
    $$('#bc-list [data-id]', el).forEach(cb => cb.onchange = () => { cb.checked ? sel.add(cb.dataset.id) : sel.delete(cb.dataset.id); count(); });
    count();
    translateDomText($('#bc-list', el));
  };
  const count = () => {
    const n = sel.size;
    $('#bc-count', el).textContent = `${n} ${t('محدد')}`;
    $('#bc-count', el).style.background = n > max ? 'var(--red-soft)' : '';
  };
  $('#bc-q', el).addEventListener('input', debounce(ev => { F.q = ev.target.value; draw(); }, 200));
  $('#bc-co', el).onchange = ev => { F.company = ev.target.value; draw(); };
  $('#bc-st', el).onchange = ev => { F.status = ev.target.value; draw(); };
  $('#bc-all', el).onclick = () => { visible().forEach(e => sel.add(e.id)); draw(); };
  $('#bc-none', el).onclick = () => { sel.clear(); draw(); };
  draw();

  const msg = (html) => { $('#bc-msg', el).innerHTML = html; };
  const payload = () => {
    const o = formValues($('#bc-opts', el));
    // الترتيب: زي ترتيب القائمة (بالاسم)
    const order = scopedEmployees().map(e => e.id).filter(id => sel.has(id));
    return { emps: order, tpl: o.tpl, date: o.date, useHireDate: !!o.useHireDate, company: o.company || '', sig: o.sig || '', housing: o.housing || '1',
      signFirst: can('contract.sign') && !!o.signFirst, signSecond: can('contract.sign') && !!o.signSecond };
  };
  $$('[data-go]', el).forEach(b => b.onclick = async () => {
    const go = b.dataset.go, p = payload();
    if (!p.emps.length) return toast('اختار موظف واحد على الأقل', 'err');
    if (p.emps.length > max) return openBlockAlert(`${t('الحد الأقصى')} ${max} ${t('عقد في المرة')}`);
    if (go !== 'zip' && !STATE.pdfAvailable) return openBlockAlert(t('تحويل PDF محتاج LibreOffice أو Microsoft Word على السيرفر.'));
    if (!p.date && !p.useHireDate) return toast('اختار تاريخ العقد', 'err');
    const btns = $$('[data-go]', el);
    btns.forEach(x => x.disabled = true);
    try {
      msg(`<div class="notice">${t('جاري فحص البيانات…')}</div>`);
      const chk = await api('POST', '/api/contract/batch/check', p);
      const sigWarn = chk.sigNotRegistered || [];
      const noSigE = chk.noSignatureEmployees || [], noSigF = chk.noSignatureSignatories || [];
      if (chk.incomplete.length || sigWarn.length || noSigE.length || noSigF.length) {
        const list = chk.incomplete.slice(0, 15).map(x => `<li><b>${esc(x.name)}</b>: ${x.missing.map(y => esc(t(y))).join('، ')}</li>`).join('');
        const sw = sigWarn.map(x => `<li>${esc(x.company)} (${x.count} ${t('عقد')})</li>`).join('');
        const ok = await openConfirm(
          (chk.incomplete.length ? `${chk.incomplete.length} ${t('عقد فيه بيانات ناقصة وهيطلع فيه خانات فاضية')}:<ul style="margin:6px 0">${list}</ul>${chk.incomplete.length > 15 ? '…' : ''}` : '')
          + (sw ? `⚠️ ${t('المفوّض المختار مش مسجّل كمفوّض بالتوقيع في')}:<ul style="margin:6px 0">${sw}</ul>` : '')
          + (noSigF.length ? `✍️ ${t('مفيش توقيع مرفوع للمفوّض (الخانة هتفضل فاضية)')}:<ul style="margin:6px 0">${noSigF.map(x => `<li>${esc(x.name)} (${x.count} ${t('عقد')})</li>`).join('')}</ul>` : '')
          + (noSigE.length ? `✍️ ${noSigE.length} ${t('موظف مالهمش توقيع مرفوع (الخانة هتفضل فاضية)')}${noSigE.length <= 10 ? ': ' + noSigE.map(esc).join('، ') : ''}<br>` : '')
          + t('تكمّل؟'), { okLabel: t('كمّل') });
        if (!ok) { msg(''); return; }
      }
      const secs = Math.max(5, Math.round(p.emps.length * (chk.engine === 'word' ? 1.1 : 0.7)));
      msg(`<div class="notice">⏳ ${t('جاري تجهيز')} ${p.emps.length} ${t('عقد')}… ${t('حوالي')} ${secs} ${t('ثانية')}</div>`);
      const res = await postForBlob('/api/contract/batch', { ...p, format: go === 'zip' ? 'zip' : 'pdf', dl: go !== 'preview' });
      msg('');
      if (go === 'preview') openPdfPreviewModal(res.blob, res.name, p.emps.length);
      else { downloadBlob(res.blob, res.name); toast('تم التنزيل', 'ok'); }
    } catch (e) { msg(`<div class="notice err">${esc(e.message)}</div>`); }
    finally { btns.forEach(x => x.disabled = false); }
  });
}

/* ---------- المفوّضين (عقود متعددة) ---------- */
function allSignatories() { return scopedCompanies().flatMap(c => (c.signatories || []).map(s => ({ ...s, companyId: s.companyId || c.id }))); }
function batchSigById(id) { return allSignatories().find(s => s.id === id); }
function sameSigPerson(a, b) { return a.civilId && b.civilId ? a.civilId === b.civilId : norm(a.nameAr) === norm(b.nameAr); }
function uniqSigPeople(list) { const out = []; list.forEach(s => { if (!out.some(x => sameSigPerson(x, s))) out.push(s); }); return out; }
/** شركة محددة: مفوّضينها الأول + مفوّضين شركات تانية. من غير شركة: كل الأشخاص مرة واحدة. */
function batchSigOptions(companyId) {
  const all = allSignatories();
  const label = s => s.nameAr + (s.civilId ? ' (' + s.civilId + ')' : '');
  if (!companyId) {
    return opt('', t('— أول مفوّض في شركة كل عقد —'), true) + uniqSigPeople(all).map(s => opt(s.id, label(s), false)).join('');
  }
  const own = all.filter(s => s.companyId === companyId);
  const others = uniqSigPeople(all.filter(s => s.companyId !== companyId && !own.some(o => sameSigPerson(o, s))));
  return opt('', t('— أول مفوّض في الشركة —'), true) + own.map(s => opt(s.id, label(s), false)).join('')
    + (others.length ? `<optgroup label="${esc(t('مفوّضين في شركات تانية'))}">${others.map(s => opt(s.id, label(s), false)).join('')}</optgroup>` : '');
}

function openPdfPreviewModal(blob, name, n) {
  const url = URL.createObjectURL(blob);
  const m = openModal({
    title: `📄 ${esc(name)}`, size: 'wide',
    body: `<iframe class="pdf-frame" src="${url}" title="PDF"></iframe>`,
    foot: `<button class="btn primary" data-print>🖨️ ${t('طباعة')} (${n})</button>
      <button class="btn" data-dl>⬇️ ${t('تنزيل PDF')}</button>
      <a class="btn" href="${url}" target="_blank" rel="noopener">↗️ ${t('فتح في تبويب')}</a>
      <span class="spacer"></span><button class="btn" data-close>إغلاق</button>`,
    onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000),
  });
  $('[data-dl]', m.el).onclick = () => downloadBlob(blob, name);
  $('[data-print]', m.el).onclick = () => {
    const fr = $('iframe', m.el);
    try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (_) { window.open(url, '_blank'); }
  };
}

function openTemplateUploadModal() {
  const m = openModal({
    title: t('رفع قالب عقد جديد'), size: 'narrow',
    body: `<div class="form"><label class="full"><span class="req">${t('اسم القالب')}</span><input name="name" placeholder="مثال: عقد حكومي، عقد أهلي…"></label>
      <label class="full"><span class="req">${t('ملف القالب (Word .docx)')}</span><input type="file" id="tpl-file" accept=".docx"></label></div>
      <div class="small muted" data-no-i18n>${t('اكتب الحقول داخل الملف بين قوسين مزدوجين، مثال:')} <code dir="ltr">{{ employee_name }}</code></div>`,
    foot: `<button class="btn primary" data-save>رفع</button><button class="btn" data-close>إلغاء</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const f = $('#tpl-file', m.el).files[0];
    const name = $('[name="name"]', m.el).value.trim();
    if (!f || !name) return toast('اسم القالب وملف Word (.docx) مطلوبين', 'err');
    const fd = new FormData(); fd.append('file', f); fd.append('name', name);
    const r = await persist('POST', '/api/templates', fd, 'تم رفع القالب');
    m.close();
    if (r && r.fields) toast(t('الحقول المكتشفة') + ': ' + (r.fields.join(', ') || '—'), 'ok');
  };
}

/* =====================================================================
   COMPANY LOG / AUDIT LOG — السجل التاريخي وسجل التدقيق
   ===================================================================== */
const COMPANY_HISTORY_TYPES = {
  company_created: '🏢 إنشاء الشركة', license_renewed: '📜 تجديد الرخصة', traffic_auth: '🚦 تفويض المرور',
  civil_affairs_auth: '🪪 تفويض الشؤون المدنية', signatory_added: '✍️ إضافة مفوّض', project_added: '📁 إضافة مشروع',
  project_renewed: '🔄 تجديد مشروع', residency_renewed: '🛂 تجديد إقامة',
};
const AUDIT_CATEGORIES = { employee: 'الموظفين', candidate: 'المترشّحين', company: 'الشركات', vehicle: 'السيارات', backup: 'النسخ الاحتياطي' };

function renderCompanyLog() {
  const L = UI.log;
  const q = norm(L.q);
  let body;
  if (L.tab === 'history') {
    const list = STATE.companyHistory.filter(h => (!L.company || h.companyId === L.company) && companyInScope(h.companyId) && (!q || norm(h.label).includes(q)));
    body = `<div class="filters"><select id="l-co">${companyOptions(L.company, '— كل الشركات —')}</select><input type="search" id="l-q" placeholder="بحث…" value="${esc(L.q)}"></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('التاريخ')}</th><th>${t('الشركة')}</th><th>${t('النوع')}</th><th>${t('التفاصيل')}</th><th>${t('بواسطة')}</th></tr></thead><tbody>
      ${list.map(h => `<tr><td class="num small">${fmtDateTime(h.date)}</td><td>${esc(companyName(h.companyId))}</td><td>${esc(t(COMPANY_HISTORY_TYPES[h.type] || h.type))}</td><td>${esc(h.label)}</td><td class="small muted">${esc(h.user || '')}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">—</td></tr>`}
      </tbody></table></div>`;
  } else {
    const list = STATE.auditLog.filter(a => (!L.category || a.category === L.category) && (!q || norm(a.label + ' ' + (a.user || '')).includes(q)));
    body = `<div class="filters"><select id="l-cat">${opt('', t('— كل الأنواع —'), !L.category)}${Object.entries(AUDIT_CATEGORIES).map(([k, v]) => opt(k, t(v), k === L.category)).join('')}</select>
      <input type="search" id="l-q" placeholder="بحث…" value="${esc(L.q)}"><button class="btn sm" id="l-export">📤 CSV</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('التاريخ')}</th><th>${t('النوع')}</th><th>${t('التفاصيل')}</th><th>${t('المستخدم')}</th></tr></thead><tbody>
      ${list.map(a => `<tr><td class="num small">${fmtDateTime(a.date)}</td><td><span class="chip">${esc(a.type)}</span></td><td>${esc(a.label)}</td><td class="small muted">${esc(a.user || '')}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">—</td></tr>`}
      </tbody></table></div>`;
    setTimeout(() => { const b = $('#l-export'); if (b) b.onclick = () => downloadBlob(toCsv([['date', 'type', 'label', 'user'], ...list.map(a => [a.date, a.type, a.label, a.user])]), `audit-${todayISO()}.csv`, 'text/csv'); });
  }
  viewRoot().innerHTML = `<div class="page-head"><h1>السجل التاريخي والتدقيق</h1></div>
    <div class="tabs"><button data-t="history" class="${L.tab === 'history' ? 'active' : ''}">سجل الشركات التاريخي (${STATE.companyHistory.length})</button>
      <button data-t="audit" class="${L.tab === 'audit' ? 'active' : ''}">سجل التدقيق (${STATE.auditLog.length})</button></div>${body}`;
  $$('[data-t]', viewRoot()).forEach(b => b.onclick = () => { UI.log.tab = b.dataset.t; UI.log.q = ''; saveUiStateToLocalStorage(); render(); });
  const co = $('#l-co'); if (co) co.onchange = e => { UI.log.company = e.target.value; saveUiStateToLocalStorage(); render(); };
  const cat = $('#l-cat'); if (cat) cat.onchange = e => { UI.log.category = e.target.value; saveUiStateToLocalStorage(); render(); };
  $('#l-q').addEventListener('input', debounce(e => { UI.log.q = e.target.value; render(); const i = $('#l-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
}
