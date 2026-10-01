/* =====================================================================
   LETTERS — 📨 الخطابات والشهادات (القسم 26)
   شهادة راتب / استمرارية راتب (قالب الشركة ← PDF معاينة وطباعة)، وطلب إجازة ونموذج عودة من إجازة (بيتطبعوا من المتصفح).
   كل خطاب ليه رقم ونسخة من بياناته، فإعادة الطباعة بتطلع نفس الخطاب بنفس الرقم.
   ===================================================================== */
const LETTER_KINDS = { salary: ['💵', 'شهادة راتب'], continuity: ['💵', 'شهادة استمرارية راتب'], leave: ['🏖️', 'طلب إجازة'], return: ['↩️', 'عودة من إجازة'] };
const LEAVE_TYPES = {
  paid: ['مدفوعة', 'Paid Leave'], unpaid: ['بدون راتب', 'Unpaid Leave'], advance: ['مدفوعة مقدمًا', 'Paid in Advance'],
  with_salary: ['مع الراتب', 'Paid with Salary'], rotation: ['إجازة تناوب', 'Rotation Leave'], compassionate: ['إجازة ظرف خاص', 'Compassionate Leave'],
};
const LEAVE_STATUS = { submitted: ['مقدَّم', 'orange'], approved: ['معتمد', 'green'], rejected: ['مرفوض', 'red'] };
const FORM_INK = { green: '#1e7a4c', red: '#b3261e', orange: '#b35c00' };

function lettersOf(empId) { return (STATE.letters || []).filter(x => x.employeeId === empId); }
function letterName(x) { return (x.data && x.data.nameAr) || empName(IDX.employee[x.employeeId]) || ''; }
/** نموذج العودة المسجّل لطلب الإجازة ده (لو فيه) */
function returnOfLeave(leaveId) { return (STATE.letters || []).find(y => y.kind === 'return' && y.data && y.data.leaveId === leaveId); }
/** التأخير عن تاريخ العودة المقرر ← [عربي، إنجليزي، لون] */
function returnDelay(delay) {
  if (delay > 0) return [`متأخر ${delay} يوم`, `${delay} day(s) late`, 'red'];
  if (delay < 0) return [`قبل الموعد بـ ${-delay} يوم`, `${-delay} day(s) early`, 'green'];
  return ['في الموعد', 'On time', 'green'];
}
/** نفس التأخير بلغة الواجهة (للشاشات — النموذج المطبوع بالاتنين) */
function returnDelayUi(delay) {
  const [, , col] = returnDelay(delay);
  if (delay > 0) return [`${t('متأخر')} ${delay} ${t('يوم')}`, col];
  if (delay < 0) return [`${t('قبل الموعد بـ')} ${-delay} ${t('يوم')}`, col];
  return [t('في الموعد'), col];
}
function statusChip(label, col) {
  return `<span class="chip" style="background:var(--${col}-soft);color:var(--${col})">${esc(t(label))}</span>`;
}
function leaveStatusChip(st) {
  const [l, col] = LEAVE_STATUS[st] || [st, 'grey'];
  return statusChip(l, col);
}
function letterDetails(x) {
  const d = x.data || {};
  if (x.kind === 'leave') {
    const back = returnOfLeave(x.id);
    return `${esc(t((LEAVE_TYPES[d.leaveType] || [''])[0]))} · ${fmtDate(d.from)} ← ${fmtDate(d.to)} (${d.days} ${t('يوم')})`
      + (back ? `<div class="small muted">↩️ ${t('رجع')} ${fmtDate(back.data.actualDate)} · ${esc(back.number)}</div>` : '');
  }
  if (x.kind === 'return') return `${t('رجع')} ${fmtDate(d.actualDate)} · ${d.leaveNumber ? esc(d.leaveNumber) : `${esc(t((LEAVE_TYPES[d.leaveType] || [''])[0]))} ${fmtDate(d.from)} ← ${fmtDate(d.to)}`}`;
  const to = d.toAr || d.toEn;
  return to ? `${t('للسادة')}: ${esc(to)}` : `<span class="muted">${t('إلى من يهمه الأمر')}</span>`;
}
/** إعادة الطباعة بنفس الرقم والبيانات */
async function reprintLetter(x) {
  if (x.kind === 'leave') return printLeaveForm(x);
  if (x.kind === 'return') return printReturnForm(x);
  if (!STATE.sheetPdfAvailable) return openBlockAlert(t('الشهادة محتاجة Microsoft Excel أو LibreOffice على السيرفر.'));
  toast(t('جاري تجهيز المعاينة…'));
  // الشركة ليها ورق رسمي مرفوع ← المعاينة عليه، والطباعة من غيره (على الورق المطبوع نفسه)
  const paper = !!(IDX.company[x.companyId] || {}).letterheadUrl;
  try {
    const r = await fetchBlob(`/api/letters/${x.id}/pdf`);
    const view = paper ? await fetchBlob(`/api/letters/${x.id}/pdf?paper=1`) : r;
    openPdfPreviewModal(view.blob, `${x.number}.pdf`, 1, 'employee', paper ? { printBlob: r.blob } : null);
  } catch (e) { toast(e.message, 'err'); }
}
async function setLeaveStatus(x, status, after) {
  try { await persist('PUT', `/api/letters/${x.id}/status`, { status }, 'تم الحفظ'); if (after) after(); } catch (_) { /* ظاهر */ }
}
function letterStatusHtml(x) {
  if (x.kind === 'leave') return leaveStatusChip(x.status);
  if (x.kind === 'return') return statusChip(...returnDelayUi((x.data || {}).delay || 0));
  return '';
}
function letterRowsHtml(list, withEmployee) {
  return list.map(x => `<tr><td class="num"><b>${esc(x.number)}</b></td><td>${LETTER_KINDS[x.kind][0]} ${esc(t(LETTER_KINDS[x.kind][1]))}</td>
      ${withEmployee ? `<td><a href="#" data-emp="${esc(x.employeeId || '')}">${esc(letterName(x))}</a><div class="small muted num">${esc(x.employeeId || '')}</div></td>` : ''}
      <td class="small">${letterDetails(x)}</td><td>${letterStatusHtml(x)}</td>
      <td class="small muted">${fmtDateTime(x.createdAt)}<br>${esc(x.createdBy || '')}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-reprint="${x.id}" title="${esc(t('إعادة الطباعة بنفس الرقم'))}">🖨️</button>
        ${x.kind === 'leave' && x.status === 'submitted' ? `<span class="write-only" data-p="employees.edit"><button class="btn sm" data-approve="${x.id}" title="${esc(t('اعتماد'))}">✅</button>${returnOfLeave(x.id) ? '' : ` <button class="btn sm danger" data-reject="${x.id}" title="${esc(t('رفض'))}">✖</button>`}</span>` : ''}
        ${x.kind === 'leave' && x.status !== 'rejected' && !returnOfLeave(x.id) ? `<span class="write-only" data-p="employees.edit"><button class="btn sm" data-back="${x.id}" title="${esc(t('عودة من الإجازة'))}">↩️</button></span>` : ''}</td></tr>`).join('');
}
function bindLetterRows(root, after) {
  const byId = id => (STATE.letters || []).find(x => x.id === id);
  $$('[data-reprint]', root).forEach(b => b.onclick = () => reprintLetter(byId(b.dataset.reprint)));
  $$('[data-approve]', root).forEach(b => b.onclick = () => setLeaveStatus(byId(b.dataset.approve), 'approved', after));
  $$('[data-reject]', root).forEach(b => b.onclick = async () => { if (await openConfirm(t('رفض طلب الإجازة؟'), { danger: true })) setLeaveStatus(byId(b.dataset.reject), 'rejected', after); });
  $$('[data-back]', root).forEach(b => b.onclick = () => { const x = byId(b.dataset.back); openReturnModal(x.employeeId, x.id, after); });
  $$('[data-emp]', root).forEach(a => a.onclick = ev => { ev.preventDefault(); if (IDX.employee[a.dataset.emp]) openProfileCard(a.dataset.emp); });
}

/* ---------- خطابات الموظف (من بطاقته) ---------- */
function openLettersModal(empId) {
  const e = IDX.employee[empId];
  if (!e) return;
  const list = lettersOf(empId);
  const m = openModal({
    title: `📨 ${t('الخطابات والشهادات')} — ${esc(e.name)}`, size: 'wide',
    body: `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn primary" data-p="sensitive.salary" data-new="salary">💵 ${t('شهادة راتب')}</button>
        <button class="btn" data-p="sensitive.salary" data-new="continuity">💵 ${t('شهادة استمرارية راتب')}</button>
        <button class="btn write-only" data-p="employees.edit" data-new="leave">🏖️ ${t('طلب إجازة')}</button>
        <button class="btn write-only" data-p="employees.edit" data-new="return">↩️ ${t('عودة من إجازة')}</button></div>
      <h4>${t('الخطابات اللي طلعت')} (${list.length})</h4>
      ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>${t('الرقم')}</th><th>${t('النوع')}</th><th>${t('التفاصيل')}</th><th>${t('الحالة')}</th><th>${t('طلع بواسطة')}</th><th></th></tr></thead>
        <tbody>${letterRowsHtml(list, false)}</tbody></table></div>` : `<div class="empty">${t('مفيش خطابات لسه')}</div>`}`,
    foot: `<button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const again = () => { m.close(); openLettersModal(empId); };
  const starters = { leave: () => openLeaveRequestModal(empId, again), return: () => openReturnModal(empId, null, again) };
  $$('[data-new]', m.el).forEach(b => b.onclick = () => (starters[b.dataset.new] || (() => openSalaryCertModal(empId, b.dataset.new, again)))());
  bindLetterRows(m.el, again);
}

/* ---------- شهادة راتب / استمرارية راتب ---------- */
async function openSalaryCertModal(empId, kind, after) {
  if (!STATE.sheetPdfAvailable) return openBlockAlert(t('الشهادة محتاجة Microsoft Excel أو LibreOffice على السيرفر.'));
  let d;
  try { d = await api('GET', `/api/employees/${encodeURIComponent(empId)}/letter-defaults`); } catch (e) { return toast(e.message, 'err'); }
  const bank = can('sensitive.bank');
  const kv = (l, v) => `<div><span>${esc(t(l))}</span>${v || '<span class="muted">—</span>'}</div>`;
  const m = openModal({
    title: `${LETTER_KINDS[kind][0]} ${t(LETTER_KINDS[kind][1])} — ${esc(d.nameAr)}`, size: 'wide',
    body: `<div class="notice small" style="margin-bottom:10px">${t('بتطلع على قالب الشركة نفسه (للطباعة على الورق الرسمي) — البيانات الوظيفية بس بتتملى. الرقم المرجعي بيتسجّل في سجل الخطابات.')}</div>
      <div class="kv">${kv('الشركة', `${esc(d.companyAr)}<div class="small muted" dir="ltr">${esc(d.companyEn)}</div>`)}${kv('الاسم', `${esc(d.nameAr)}<div class="small muted" dir="ltr">${esc(d.nameEn)}</div>`)}
        ${kv('الجنسية', `${esc(d.nationalityAr)} · <span dir="ltr">${esc(d.nationalityEn)}</span>`)}${kv('الرقم المدني', `<span class="num">${esc(d.civilId)}</span>`)}
        ${kv('تاريخ التعيين', fmtDate(d.hireDate))}${kv('الراتب', `<b>${fmtMoney(d.salary)}</b><div class="small muted">${esc(d.wordsAr)}</div><div class="small muted" dir="ltr">${esc(d.wordsEn)}</div>`)}
        ${bank ? kv('رقم الحساب', `<span class="num" dir="ltr">${esc(d.account)}</span>`) : ''}</div>
      ${!d.companyEn || !d.nameEn || !d.hireDate ? `<div class="notice warn small" style="margin-top:8px">${t('فيه بيانات ناقصة (الاسم الإنجليزي أو تاريخ التعيين أو اسم الشركة الإنجليزي) — هتطلع فاضية في الشهادة. صلّحها من بطاقة الموظف أو الشركة.')}</div>` : ''}
      <div class="form" style="margin-top:12px">
        <label>${t('السادة (عربي)')}<input name="toAr" placeholder="${esc(t('مثلًا: بنك الكويت الوطني'))}"></label>
        <label>${t('TO (إنجليزي)')}<input name="toEn" dir="ltr" placeholder="National Bank of Kuwait"></label>
        <label>${t('الوظيفة (عربي)')}<input name="jobAr" value="${esc(d.jobAr)}"></label>
        <label>${t('الوظيفة (إنجليزي)')}<input name="jobEn" dir="ltr" value="${esc(d.jobEn)}"></label>
        ${bank ? `<label>${t('البنك (عربي)')}<input name="bankAr" value="${esc(d.bankAr)}"></label><label>${t('البنك (إنجليزي)')}<input name="bankEn" dir="ltr" value="${esc(d.bankEn)}"></label>` : ''}
        <label>${t('التاريخ')}<input type="date" name="date" value="${esc(d.date)}"></label></div>`,
    foot: `<button class="btn primary" data-go>${LETTER_KINDS[kind][0]} ${t('إصدار ومعاينة')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-go]', m.el).onclick = async ev => {
    const f = formValues(m.el), btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await api('POST', `/api/employees/${encodeURIComponent(empId)}/letters`, { kind, ...f });
      m.close();
      await reload();
      toast(`${t('اتسجّلت برقم')} ${r.number}`, 'ok');
      await reprintLetter((STATE.letters || []).find(x => x.id === r.id) || { id: r.id, kind, number: r.number });
      if (after) after();
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; }
  };
}

/* ---------- حفظ نموذج (إجازة / عودة) وطباعته ---------- */
function leaveTypeRadios(sel) {
  return `<div class="row" style="flex-wrap:wrap;gap:6px 16px">${Object.entries(LEAVE_TYPES).map(([k, [ar, en]], i) => `<label class="check"><input type="radio" name="leaveType" value="${k}" ${(sel ? k === sel : i === 0) ? 'checked' : ''}> ${esc(t(ar))} <span class="small muted" dir="ltr">${en}</span></label>`).join('')}</div>`;
}
async function saveAndPrintForm(E, empId, kind, f, after, close) {
  const w = window.open('', '_blank');         // قبل الانتظار عشان المتصفح مايمنعش النافذة
  const btn = $('[data-go]', E); btn.disabled = true;
  try {
    const r = await api('POST', `/api/employees/${encodeURIComponent(empId)}/letters`, { kind, ...f });
    close();
    await reload();
    toast(`${t('اتسجّل برقم')} ${r.number}`, 'ok');
    const x = (STATE.letters || []).find(y => y.id === r.id);
    if (x) reprintForm(x, w); else if (w) w.close();
    if (after) after();
  } catch (err) { if (w) w.close(); toast(err.message, 'err'); }
  finally { btn.disabled = false; }
}
function reprintForm(x, w) { return x.kind === 'return' ? printReturnForm(x, w) : printLeaveForm(x, w); }

/* ---------- طلب إجازة ---------- */
function openLeaveRequestModal(empId, after) {
  const e = IDX.employee[empId];
  const m = openModal({
    title: `🏖️ ${t('طلب إجازة')} — ${esc(e.name)}`, size: 'wide',
    body: `<div class="form">
        <div style="grid-column:1/-1"><div class="small muted" style="margin-bottom:4px"><span class="req">${t('نوع الإجازة')}</span></div>${leaveTypeRadios()}</div>
        <label><span class="req">${t('من')}</span><input type="date" name="from"></label>
        <label><span class="req">${t('إلى')}</span><input type="date" name="to"></label>
        <div class="small" id="lv-days" style="grid-column:1/-1"></div>
        <label>${t('التليفون أثناء الإجازة')}<input name="phone" dir="ltr" value="${esc(e.phone || '')}"></label>
        <label>${t('العنوان أثناء الإجازة')}<input name="address"></label>
        <label class="full">${t('ملاحظات')}<input name="notes"></label></div>
      <div class="small muted" style="margin-top:8px">${t('الطلب بيتسجّل «مقدَّم» ويتطبع للتوقيعات. رصيد الإجازات بيتكتب بالقلم في خانة الموارد البشرية لحد مرحلة الإجازات.')}</div>`,
    foot: `<button class="btn primary" data-go>🏖️ ${t('حفظ وطباعة')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const days = () => {
    const a = $('[name=from]', E).value, b = $('[name=to]', E).value;
    if (!a || !b) return $('#lv-days', E).innerHTML = '';
    const n = Math.round((new Date(b) - new Date(a)) / 864e5) + 1;
    $('#lv-days', E).innerHTML = n > 0 ? `📅 <b>${n}</b> ${t('يوم')} · ${t('تاريخ العودة')}: <b>${fmtDate(addDays(b, 1))}</b>` : `<span style="color:var(--red)">${t('نهاية الإجازة قبل بدايتها')}</span>`;
  };
  E.addEventListener('change', days);
  $('[data-go]', E).onclick = () => {
    const f = formValues(E);
    f.leaveType = ($('[name=leaveType]:checked', E) || {}).value;
    if (!f.from || !f.to) return openBlockAlert(t('تاريخ بداية ونهاية الإجازة مطلوبين'));
    if (f.to < f.from) return openBlockAlert(t('نهاية الإجازة قبل بدايتها'));
    saveAndPrintForm(E, empId, 'leave', f, after, () => m.close());
  };
}

/* ---------- عودة من إجازة ---------- */
function openReturnModal(empId, leaveId, after) {
  const e = IDX.employee[empId];
  const pending = lettersOf(empId).filter(x => x.kind === 'leave' && x.status !== 'rejected' && !returnOfLeave(x.id));
  const today = todayISO();
  const m = openModal({
    title: `↩️ ${t('عودة من إجازة')} — ${esc(e.name)}`, size: 'wide',
    body: `<div class="form">
        <label style="grid-column:1/-1"><span class="req">${t('طلب الإجازة')}</span><select name="leaveId">
          ${pending.map(x => opt(x.id, `${x.number} — ${t(LEAVE_TYPES[x.data.leaveType][0])} · ${fmtDate(x.data.from)} ← ${fmtDate(x.data.to)} (${t(LEAVE_STATUS[x.status][0])})`, x.id === leaveId)).join('')}
          ${opt('', t('إجازة مش متسجّلة في السيستم (طلب ورقي)'), !pending.length)}</select></label>
        <div id="rt-manual" class="form" style="grid-column:1/-1" hidden>
          <div style="grid-column:1/-1"><div class="small muted" style="margin-bottom:4px"><span class="req">${t('نوع الإجازة')}</span></div>${leaveTypeRadios()}</div>
          <label><span class="req">${t('من')}</span><input type="date" name="from"></label>
          <label><span class="req">${t('إلى')}</span><input type="date" name="to"></label></div>
        <label><span class="req">${t('تاريخ العودة الفعلي')}</span><input type="date" name="actualDate" value="${today}" max="${today}"></label>
        <div class="small" id="rt-info" style="grid-column:1/-1"></div>
        <label class="full" id="rt-reason" hidden>${t('سبب التأخير')}<input name="reason"></label>
        <label class="full">${t('ملاحظات')}<input name="notes"></label></div>
      <div class="small muted" style="margin-top:8px">${t('بيتحسب التأخير عن تاريخ العودة المقرر (اليوم اللي بعد آخر يوم إجازة). قرار أيام التأخير بيتكتب في خانة الموارد البشرية.')}</div>`,
    foot: `<button class="btn primary" data-go>↩️ ${t('حفظ وطباعة')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const leaveEnd = () => {
    const id = $('[name=leaveId]', E).value;
    if (id) { const x = pending.find(y => y.id === id); return x && x.data.to; }
    return $('[name=to]', E).value;
  };
  const refresh = () => {
    $('#rt-manual', E).hidden = !!$('[name=leaveId]', E).value;
    const end = leaveEnd(), actual = $('[name=actualDate]', E).value;
    let late = 0;
    if (end && actual) {
      const due = addDays(end, 1), delay = Math.round((new Date(actual) - new Date(due)) / 864e5), [label, col] = returnDelayUi(delay);
      late = delay;
      $('#rt-info', E).innerHTML = `📅 ${t('تاريخ العودة المقرر')}: <b>${fmtDate(due)}</b> · <b style="color:var(--${col})">${esc(label)}</b>`;
    } else $('#rt-info', E).innerHTML = '';
    $('#rt-reason', E).hidden = late <= 0;
  };
  E.addEventListener('change', refresh);
  refresh();
  $('[data-go]', E).onclick = () => {
    const f = formValues(E);
    if (f.leaveId) { delete f.from; delete f.to; delete f.leaveType; }
    else {
      f.leaveType = ($('[name=leaveType]:checked', E) || {}).value;
      if (!f.from || !f.to) return openBlockAlert(t('تاريخ بداية ونهاية الإجازة مطلوبين'));
      if (f.to < f.from) return openBlockAlert(t('نهاية الإجازة قبل بدايتها'));
    }
    if (!f.actualDate) return openBlockAlert(t('تاريخ العودة الفعلي مطلوب'));
    if (f.actualDate > today) return openBlockAlert(t('تاريخ العودة الفعلي لسه ماجاش'));
    saveAndPrintForm(E, empId, 'return', f, after, () => m.close());
  };
}

/* ---------- النماذج المطبوعة (A4 عربي وإنجليزي، بشعار واسم شركة الموظف) ---------- */
const fBox = on => on ? '☑' : '☐';
const fL = (ar, en) => `<span class="ar">${ar}</span><span class="en">${en}</span>`;
const fRow = (ar, en, v) => `<tr><th>${fL(ar, en)}</th><td>${v || '&nbsp;'}</td></tr>`;
const fSec = (ar, en) => `<div class="sec">${fL(ar, en)}</div>`;
const fSub = v => `<div style="direction:ltr;text-align:right;color:#5a6b67">${esc(v)}</div>`;
/** عهد الشركة (سيارة الموظف بأرقامها، مفاتيح، تصاريح…) — التسليم قبل الإجازة والاستلام بعد العودة */
function formItemsHtml(d, ar, en) {
  return `<div class="line"><span>${ar} / ${en}:</span>
        <span>${fBox(false)} سيارة / Car${(d.plates || []).length ? ` (${esc(d.plates.join('، '))})` : ''}</span><span>${fBox(false)} مفاتيح / Keys</span><span>${fBox(false)} تصريح دخول / Gate Pass</span>
        <span>${fBox(false)} تصاريح Hot/Cold Permits</span><span>${fBox(false)} أخرى / Others <span class="blank" style="min-width:70px"></span></span></div>`;
}
/** الغلاف المشترك: الهيدر وبيانات الموظف والفوتر — المحتوى الخاص بكل نموذج في content */
function printFormSheet(x, win, o) {
  const d = x.data || {}, co = IDX.company[x.companyId] || {};
  const w = win || window.open('', '_blank');
  if (!w) return toast('المتصفح منع نافذة الطباعة', 'err');
  const logo = co.logoUrl ? `<img src="${esc(location.origin + co.logoUrl)}" alt="">` : '';
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(x.number)}</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">
    <style>
      @page{size:A4;margin:10mm 11mm}
      *{box-sizing:border-box}body{margin:0;font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;color:#1b2a27;font-size:9.5pt;line-height:1.35;background:#e9eeec}
      .toolbar{position:sticky;top:0;display:flex;gap:8px;align-items:center;padding:8px 14px;background:#1d4b40;color:#fff}
      .toolbar button{font:inherit;padding:5px 14px;border-radius:6px;border:1px solid #fff5;background:#fff;color:#1d4b40;cursor:pointer}
      .sheet{width:188mm;margin:10px auto;background:#fff;padding:8mm 9mm;box-shadow:0 1px 8px #0002}
      header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;border-bottom:3px solid #1d4b40;padding-bottom:8px}
      header .co{display:flex;gap:8px;align-items:center}header img{max-height:48px;max-width:90px}
      header .co b{display:block;font-size:11pt}header .co small{display:block;color:#5a6b67;direction:ltr;text-align:right}
      header h1{margin:0;text-align:center;font-size:17pt;color:#1d4b40;line-height:1.2}header h1 small{display:block;font-size:10pt;color:#5a6b67;letter-spacing:.5px}
      header .meta{justify-self:end;text-align:left;font-size:9pt}header .meta div{white-space:nowrap}header .meta b{font-size:10.5pt;color:#1d4b40}
      .sec{margin:8px 0 3px;background:#1d4b40;color:#fff;padding:3px 8px;border-radius:3px;display:flex;justify-content:space-between;font-weight:600}
      .sec .en,.ar+.en{direction:ltr}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #c9d3d0;padding:3px 6px;vertical-align:middle}
      th{width:20%;background:#f1f5f4;font-weight:600;text-align:right;line-height:1.2}th .en{display:block;font-size:7.5pt;font-weight:400;color:#5a6b67;direction:ltr;text-align:right}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0}.grid2 table th{width:40%}.grid2+table{border-top:0}
      .types{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid #c9d3d0;border-bottom:0}
      .types div{padding:4px 6px;border-bottom:1px solid #c9d3d0;border-left:1px solid #c9d3d0;line-height:1.2}.types .on{background:#e5f1ec;font-weight:600}
      .types .en{display:block;font-size:7.5pt;color:#5a6b67;direction:ltr;text-align:right;font-weight:400}
      .sig{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px}.sig div{border:1px solid #c9d3d0;min-height:80px;padding:4px 6px;font-size:8.5pt}
      .sig.three{grid-template-columns:repeat(3,1fr)}.sig.three div{min-height:66px}
      .sig div b{display:block}.sig .en{display:block;color:#5a6b67;direction:ltr;text-align:right}
      .line{display:flex;gap:10px 16px;flex-wrap:wrap;padding:7px 2px}.line span{white-space:nowrap}
      .line.g2{display:grid;grid-template-columns:1fr 1fr}
      .blank{display:inline-block;min-width:90px;border-bottom:1px solid #1b2a27;margin:0 4px}
      .decl{margin-top:8px;border:1px solid #c9d3d0;border-right:4px solid #1d4b40;background:#f7faf9;padding:7px 10px;line-height:1.6}
      .decl .en{display:block;direction:ltr;text-align:left;color:#5a6b67;font-size:8.5pt}
      footer{margin-top:10px;display:flex;justify-content:space-between;font-size:8pt;color:#5a6b67;border-top:1px solid #c9d3d0;padding-top:4px}
      .stamp{font-weight:700;color:${FORM_INK[o.color] || FORM_INK.orange}}
      @media print{body{background:#fff}.toolbar{display:none}.sheet{box-shadow:none;margin:0;width:auto;padding:0}}
    </style></head><body>
    <div class="toolbar"><button onclick="print()">🖨️ ${esc(t('طباعة'))}</button><button onclick="close()">${esc(t('إغلاق'))}</button><span style="flex:1"></span><small>${esc(x.number)}</small></div>
    <div class="sheet">
      <header><div class="co">${logo}<div><b>${esc(co.nameAr || d.companyAr || '')}</b><small>${esc(co.nameEn || d.companyEn || '')}</small></div></div>
        <h1>${o.titleAr}<small>${o.titleEn}</small></h1>
        <div class="meta"><div>No. / الرقم: <b>${esc(x.number)}</b></div><div>Date / التاريخ: ${fmtDate(d.date || (x.createdAt || '').slice(0, 10))}</div><div class="stamp">${esc(o.stamp || '')}</div></div></header>
      ${fSec('بيانات الموظف', 'EMPLOYEE DETAILS')}
      <div class="grid2"><table>${fRow('الاسم', 'Name', `${esc(d.nameAr)}${fSub(d.nameEn)}`)}${fRow('الوظيفة', 'Title', `${esc(d.jobAr)}${fSub(d.jobEn)}`)}${fRow('الإدارة / مكان الشغل', 'Division / Department', esc(d.department))}${fRow('الشركة', 'Company', esc(d.companyAr))}</table>
        <table>${fRow('الرقم الوظيفي', 'Employee Code', esc(d.employeeCode))}${fRow('الرقم المدني', 'Civil ID No.', esc(d.civilId))}${fRow('انتهاء الإقامة', 'Residency Expiry', fmtDate(d.residencyExp))}${fRow('التليفون', 'Tel. No.', `<span dir="ltr">${esc(d.phone)}</span>`)}</table></div>
      ${o.content}
      <footer><span>${esc(x.number)} · ${esc(x.createdBy || '')} · ${fmtDateTime(x.createdAt)}</span><span>${esc(t('طُبع بواسطة'))}: ${esc((STATE.me && (STATE.me.displayName || STATE.me.username)) || '')} · ${fmtDate(todayISO())}</span></footer>
    </div></body></html>`);
  w.document.close();
  printLog(`${t(LETTER_KINDS[x.kind][1])} ${x.number}`, 'employee');
}

/** نموذج طلب الإجازة المطبوع (التصميم المعتمد) */
function printLeaveForm(x, win) {
  const d = x.data || {}, status = LEAVE_STATUS[x.status] || ['', ''];
  printFormSheet(x, win, {
    titleAr: 'طلب إجازة', titleEn: 'LEAVE REQUEST', stamp: status[0], color: status[1], content: `
      ${fSec('تفاصيل الإجازة', 'LEAVE DETAILS')}
      <div class="types">${Object.entries(LEAVE_TYPES).map(([k, [ar, en]]) => `<div class="${k === d.leaveType ? 'on' : ''}">${fBox(k === d.leaveType)} ${ar}<span class="en">${en}</span></div>`).join('')}</div>
      <div class="grid2"><table>${fRow('من تاريخ', 'Start Date', `<b>${fmtDate(d.from)}</b>`)}${fRow('إلى تاريخ', 'End Date', `<b>${fmtDate(d.to)}</b>`)}</table>
        <table>${fRow('عدد الأيام', 'No. of Days', `<b>${d.days}</b>`)}${fRow('تاريخ العودة للعمل', 'Return to Work', `<b>${fmtDate(d.returnDate)}</b>`)}</table></div>
      <table>${fRow('للتواصل أثناء الإجازة', 'Contact during Vacation', `<span dir="ltr">${esc(d.phone)}</span>${d.address ? ' — ' + esc(d.address) : ''}`)}${d.notes ? fRow('ملاحظات', 'Notes', esc(d.notes)) : ''}</table>
      <div class="line"><span>توقيع الموظف / Employee Signature: <span class="blank"></span></span><span>التاريخ / Date: <span class="blank" style="min-width:80px"></span></span></div>
      ${fSec('مدير القسم', 'DEPARTMENT HEAD USE')}
      ${formItemsHtml(d, 'تم تسليم عهد الشركة', 'Company items returned')}
      <div class="line"><span>الاسم / Name: <span class="blank"></span></span><span>التوقيع / Signature: <span class="blank"></span></span><span>التاريخ / Date: <span class="blank" style="min-width:80px"></span></span></div>
      ${fSec('موافقة مدير الإدارة', 'DIVISION MANAGER APPROVAL')}
      <div class="line"><span>${fBox(x.status === 'approved')} موافق / Approved</span><span>${fBox(x.status === 'rejected')} غير موافق / Not Approved</span>
        <span>الاسم / Name: <span class="blank"></span></span><span>التوقيع / Signature: <span class="blank"></span></span></div>
      ${fSec('للموارد البشرية', 'HR USE')}
      <div class="line g2"><span>أيام مدفوعة / Paid days: <span class="blank" style="min-width:60px"></span></span><span>بدون راتب / Unpaid days: <span class="blank" style="min-width:60px"></span></span>
        <span>رصيد الإجازات حتى تاريخه / Leave balance till date: <span class="blank" style="min-width:60px"></span></span><span>إجمالي الأيام المستحقة / Total days available: <span class="blank" style="min-width:60px"></span></span></div>
      <div class="sig"><div><b>أعده</b><span class="en">Prepared by</span></div><div><b>راجعه</b><span class="en">Checked by</span></div>
        <div><b>اعتماد المدير</b><span class="en">Approved by (Manager)</span></div><div><b>اعتماد المدير التنفيذي</b><span class="en">Approved by (CEO)</span></div></div>`,
  });
}

/** نموذج العودة من الإجازة المطبوع — نفس تصميم طلب الإجازة */
function printReturnForm(x, win) {
  const d = x.data || {}, [ar, en, col] = returnDelay(d.delay || 0), lt = LEAVE_TYPES[d.leaveType] || ['', ''];
  const late = d.delay > 0;
  printFormSheet(x, win, {
    titleAr: 'عودة من إجازة', titleEn: 'RETURN FROM LEAVE', stamp: ar, color: col, content: `
      ${fSec('تفاصيل الإجازة', 'LEAVE DETAILS')}
      <div class="grid2"><table>${fRow('رقم طلب الإجازة', 'Leave Request No.', d.leaveNumber ? `<b>${esc(d.leaveNumber)}</b>` : '<span style="color:#5a6b67">طلب ورقي / Paper request</span>')}${fRow('نوع الإجازة', 'Leave Type', `${esc(lt[0])}${fSub(lt[1])}`)}${fRow('عدد الأيام', 'No. of Days', `<b>${d.days}</b>`)}</table>
        <table>${fRow('من تاريخ', 'Start Date', `<b>${fmtDate(d.from)}</b>`)}${fRow('إلى تاريخ', 'End Date', `<b>${fmtDate(d.to)}</b>`)}${fRow('تاريخ العودة المقرر', 'Scheduled Return', `<b>${fmtDate(d.returnDate)}</b>`)}</table></div>
      ${fSec('بيانات العودة', 'RETURN DETAILS')}
      <div class="grid2"><table>${fRow('تاريخ العودة الفعلي', 'Actual Return Date', `<b style="font-size:11pt">${fmtDate(d.actualDate)}</b>`)}</table>
        <table>${fRow('الالتزام بالموعد', 'Punctuality', `<b style="color:${FORM_INK[col]}">${esc(ar)}</b>${fSub(en)}`)}</table></div>
      ${late || d.reason || d.notes ? `<table>${late || d.reason ? fRow('سبب التأخير', 'Reason for Delay', esc(d.reason)) : ''}${d.notes ? fRow('ملاحظات', 'Notes', esc(d.notes)) : ''}</table>` : ''}
      <div class="decl">أقر أنا الموظف المذكور أعلاه بأنني عدت من الإجازة وباشرت عملي بتاريخ <b>${fmtDate(d.actualDate)}</b>.
        <span class="en">I, the above-mentioned employee, confirm that I have returned from leave and resumed my duties on <b>${fmtDate(d.actualDate)}</b>.</span></div>
      <div class="line"><span>توقيع الموظف / Employee Signature: <span class="blank"></span></span><span>التاريخ / Date: <span class="blank" style="min-width:80px"></span></span></div>
      ${fSec('المدير المباشر', 'DIRECT SUPERVISOR')}
      <div class="line"><span>${fBox(false)} أؤكد مباشرة الموظف للعمل في التاريخ المذكور / Resumption of duty confirmed on the above date</span></div>
      ${formItemsHtml(d, 'تم استلام عهد الشركة', 'Company items received back')}
      <div class="line"><span>الاسم / Name: <span class="blank"></span></span><span>التوقيع / Signature: <span class="blank"></span></span><span>التاريخ / Date: <span class="blank" style="min-width:80px"></span></span></div>
      ${fSec('للموارد البشرية', 'HR USE')}
      ${late ? `<div class="line"><span>أيام التأخير / Delay days: <b>${d.delay}</b></span><span>${fBox(false)} بعذر مقبول / Excused</span>
        <span>${fBox(false)} من رصيد الإجازات / From leave balance</span><span>${fBox(false)} بدون راتب / Unpaid</span></div>` : ''}
      <div class="line g2"><span>رصيد الإجازات بعد العودة / Leave balance after return: <span class="blank" style="min-width:60px"></span></span><span>${fBox(false)} تم تحديث السجلات / Records updated</span></div>
      <div class="sig three"><div><b>أعده</b><span class="en">Prepared by</span></div><div><b>راجعه</b><span class="en">Checked by</span></div>
        <div><b>اعتماد المدير</b><span class="en">Approved by (Manager)</span></div></div>`,
  });
}

/* ---------- سجل الخطابات (كل الموظفين) ---------- */
function openLettersLog() {
  const F = { q: '', kind: '', status: '' };
  const m = openModal({ title: `📨 ${t('سجل الخطابات')}`, size: 'wide', body: '<div id="lt-body"></div>', foot: `<button class="btn" data-close>${t('إغلاق')}</button>` });
  const draw = () => {
    const q = norm(F.q);
    const list = (STATE.letters || []).filter(x => (!F.kind || x.kind === F.kind) && (!F.status || x.status === F.status)
      && (!q || [x.number, letterName(x), x.employeeId, (x.data || {}).nameEn, (x.data || {}).toAr, (x.data || {}).toEn, (x.data || {}).leaveNumber, x.createdBy].some(v => norm(v).includes(q))));
    $('#lt-body', m.el).innerHTML = `<div class="filters"><input type="search" id="lt-q" placeholder="${esc(t('بحث بالرقم أو الاسم أو الرقم المدني أو الجهة…'))}" value="${esc(F.q)}">
        <select id="lt-kind">${opt('', t('— كل الأنواع —'), !F.kind)}${Object.entries(LETTER_KINDS).map(([k, [, l]]) => opt(k, t(l), k === F.kind)).join('')}</select>
        <select id="lt-status">${opt('', t('— كل الحالات —'), !F.status)}${Object.entries(LEAVE_STATUS).map(([k, [l]]) => opt(k, t(l), k === F.status)).join('')}</select></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('الرقم')}</th><th>${t('النوع')}</th><th>${t('الموظف')}</th><th>${t('التفاصيل')}</th><th>${t('الحالة')}</th><th>${t('طلع بواسطة')}</th><th></th></tr></thead>
      <tbody>${letterRowsHtml(list, true) || `<tr><td colspan="7" class="empty">${t('مفيش خطابات')}</td></tr>`}</tbody></table></div>
      <div class="small muted" style="margin-top:6px">${list.length} ${t('خطاب')}</div>`;
    translateDomText(m.el);
    const qi = $('#lt-q', m.el);
    qi.oninput = debounce(() => { F.q = qi.value; draw(); const i = $('#lt-q', m.el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
    $('#lt-kind', m.el).onchange = ev => { F.kind = ev.target.value; draw(); };
    $('#lt-status', m.el).onchange = ev => { F.status = ev.target.value; draw(); };
    bindLetterRows(m.el, draw);
  };
  draw();
}
