/* =====================================================================
   RECRUITMENT — تسجيل موظف جديد (الاستقدام والتوظيف): الموظف الجديد بيتضاف من هنا بس
   المصادر: استقدام من الخارج / نقل داخلي / عمالة وطنية (بتتختار تلقائيًا للجنسية الكويتية)
   ===================================================================== */
'use strict';

function recruitStagesForSource(source) {
  return ({ internal: RECRUIT_STAGES_INTERNAL, kuwaiti: RECRUIT_STAGES_KUWAITI }[source] || RECRUIT_STAGES_OUTSIDE).concat([REJECTED_STAGE]);
}
function recruitStageInfo(source, stage) {
  return recruitStagesForSource(source).find(s => s.id === stage) || null;
}
function recruitStageIndex(c) {
  const st = recruitStagesForSource(c.source);
  const i = st.findIndex(s => s.id === c.stage);
  return i < 0 ? 0 : i;
}
/** يصحّح أي مرحلة قديمة/غير صالحة للمصدر (Migration بالواجهة) */
function migrateRecruitStages(c) {
  if (!recruitStageInfo(c.source || 'outside', c.stage)) c.stage = recruitStagesForSource(c.source || 'outside')[0].id;
  return c;
}
/* ---------- عقد العمل (بيظهر في مرحلة «عقد العمل» بس) ---------- */
const CANDIDATE_CONTRACT_STAGE = 'employment_contract';
const CANDIDATE_KW_FORMS_STAGE = 'kw_forms';        // العمالة الوطنية: العقد + استمارة 103 + استمارة العلاوة
function candidateContractStage(stage) { return stage === CANDIDATE_CONTRACT_STAGE || stage === CANDIDATE_KW_FORMS_STAGE; }
// بيانات المترشّح اللي العقد محتاجها — الباقي (الشركة بالإنجليزي، المفوّض، …) بيتفحص في نافذة العقد
const CANDIDATE_CONTRACT_FIELDS = [['civilId', 'الرقم المدني'], ['name', 'الاسم'], ['nameEn', 'الاسم بالإنجليزي'], ['nationality', 'الجنسية'],
  ['profession', 'المهنة'], ['salary', 'الراتب'], ['targetCompanyId', 'الشركة المستهدفة']];
function canCandidateContract() { return canAll('contract.view sensitive.salary'); }
function candidateContractMissing(d) { return CANDIDATE_CONTRACT_FIELDS.filter(([k]) => d[k] === null || d[k] === undefined || d[k] === '').map(([, l]) => l); }
function candidateContractBlockMsg(miss) {
  return (miss.includes('الرقم المدني') ? t('أدخل الرقم المدني للمترشّح عشان تعمل العقد.') + ' ' : '')
    + t('لازم تكمّل البيانات دي عشان تعمل عقد العمل') + ': ' + miss.map(t).join('، ');
}

function candidateDeadline(c) {
  // مهلة 60 يوم من تاريخ الدخول (استقدام من الخارج)
  if (c.source === 'internal' || c.source === 'kuwaiti' || !c.entryDate) return null;
  return addDays(c.entryDate, 60);
}

function renderRecruitFunnelCard() {
  const block = (source, title) => {
    const list = STATE.candidates.filter(c => (c.source || 'outside') === source);
    return `<div style="flex:1;min-width:220px"><div class="small muted" style="margin-bottom:4px">${esc(t(title))} (${list.length})</div><div class="funnel">
      ${recruitStagesForSource(source).map(s => { const n = list.filter(c => c.stage === s.id).length; return `<div class="st ${s.final ? 'done' : ''} ${s.rejected ? 'rej' : ''}" data-funnel="${source}|${s.id}"><span>${esc(t(s.label))}</span><b>${n}</b></div>`; }).join('')}
    </div></div>`;
  };
  return `<div class="card"><h3>🧭 ${t('مراحل التسجيل')}</h3><div class="row" style="align-items:flex-start;gap:14px">${Object.keys(RECRUIT_SOURCES).map(k => block(k, RECRUIT_SOURCES[k][0])).join('')}</div></div>`;
}
function bindRecruitFunnel() {
  $$('[data-funnel]').forEach(el => el.onclick = () => {
    const [source, stage] = el.dataset.funnel.split('|');
    UI.cand.source = source; UI.cand.stage = stage; saveUiStateToLocalStorage(); setView('recruitment');
  });
}

function filteredCandidates() {
  const f = UI.cand, q = norm(f.q);
  return STATE.candidates.filter(c => {
    if (f.source && (c.source || 'outside') !== f.source) return false;
    if (f.stage && c.stage !== f.stage) return false;
    if (f.company && c.targetCompanyId !== f.company) return false;
    if (q && ![c.name, c.nameEn, c.passportNo, c.civilId, c.phone, c.profession, c.nationality].some(v => norm(v).includes(q))) return false;
    return true;
  });
}

function renderRecruitment() {
  const f = UI.cand;
  const list = filteredCandidates().sort((a, b) => (b.appliedDate || '').localeCompare(a.appliedDate || ''));
  const allStages = [...RECRUIT_STAGES_OUTSIDE, ...RECRUIT_STAGES_INTERNAL, ...RECRUIT_STAGES_KUWAITI, REJECTED_STAGE];
  const stageOpts = f.source ? recruitStagesForSource(f.source) : uniq(allStages.map(s => s.id)).map(id => allStages.find(s => s.id === id));
  viewRoot().innerHTML = `<div class="page-head"><div><h1>${t('تسجيل موظف جديد')}</h1><div class="sub">${STATE.candidates.length} ${t('مترشّح')}</div></div>
    <div class="actions"><button class="btn primary write-only" data-p="recruitment.edit" id="c-add">➕ إضافة مترشّح</button><button class="btn" id="c-report">📊 تقرير المترشّحين</button></div></div>
    <div class="grid" style="margin-bottom:12px">${renderRecruitFunnelCard()}</div>
    <div class="filters"><input type="search" id="cf-q" placeholder="بحث بالاسم أو الجواز أو الهاتف…" value="${esc(f.q)}">
      <select id="cf-source">${opt('', t('— كل المصادر —'), !f.source)}${Object.keys(RECRUIT_SOURCES).map(k => opt(k, recruitSourceLabel(k), f.source === k)).join('')}</select>
      <select id="cf-stage">${opt('', t('— كل المراحل —'), !f.stage)}${stageOpts.map(s => opt(s.id, t(s.label), s.id === f.stage)).join('')}</select>
      <select id="cf-co">${companyOptions(f.company, '— كل الشركات —')}</select>
      <button class="btn sm ghost" id="cf-clear">✕ ${t('مسح الفلاتر')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('الاسم')}</th><th>${t('الجنسية')}</th><th>${t('المهنة')}</th><th>${t('المصدر')}</th><th>${t('المرحلة')}</th><th>${t('الشركة المستهدفة')}</th><th data-p="sensitive.salary">${t('الراتب')}</th><th>${t('تاريخ التقديم')}</th><th>${t('المهلة / التأشيرة')}</th></tr></thead><tbody>
    ${list.map(c => {
      const st = recruitStageInfo(c.source || 'outside', c.stage);
      const steps = recruitStagesForSource(c.source).filter(s => !s.rejected).length;
      const idx = recruitStageIndex(c) + 1;
      const dl = candidateDeadline(c);
      return `<tr class="clickable" data-id="${c.id}"><td><b>${esc(c.name)}</b>${c.nameEn ? `<div class="small muted">${esc(c.nameEn)}</div>` : ''}</td><td>${esc(personNat(c) || '')}</td><td>${esc(personProf(c) || '')}</td>
        <td><span class="chip">${recruitSourceLabel(c.source, true)}</span></td>
        <td>${st ? `<span class="chip ${st.final ? 'on' : ''}" style="${st.rejected ? 'background:var(--red-soft);color:var(--red)' : ''}">${esc(t(st.label))}</span>${candidateContractStage(c.stage) && canCandidateContract() ? ` <button class="btn sm ghost" data-contract="${c.id}" title="${esc(t('طباعة عقد العمل'))}">📄</button>` : ''}${!st.rejected ? `<div class="progress" style="width:90px;margin-top:3px"><i style="width:${100 * idx / steps}%"></i></div>` : ''}` : '—'}</td>
        <td>${esc(companyName(c.targetCompanyId))}</td><td class="num" data-p="sensitive.salary">${c.salary ? fmtMoney(c.salary) : '—'}${c.housingAllowance ? ' 🏠' : ''}</td><td class="num small">${fmtDate(c.appliedDate)}</td>
        <td>${c.source === 'kuwaiti' ? '<span class="muted">—</span>' : c.source === 'internal' ? datePill(c.oldSponsorResidencyExp) : (dl ? datePill(dl) : datePill(c.visaExp))}</td></tr>`;
    }).join('') || `<tr><td colspan="9" class="empty">${t('لا يوجد مترشّحين')}</td></tr>`}</tbody></table></div>`;
  bindRecruitFunnel();
  const upd = p => { Object.assign(UI.cand, p); saveUiStateToLocalStorage(); render(); };
  $('#cf-q').addEventListener('input', debounce(e => { UI.cand.q = e.target.value; render(); const i = $('#cf-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  $('#cf-source').onchange = e => upd({ source: e.target.value, stage: '' });
  $('#cf-stage').onchange = e => upd({ stage: e.target.value });
  $('#cf-co').onchange = e => upd({ company: e.target.value });
  $('#cf-clear').onclick = () => upd({ q: '', source: '', stage: '', company: '' });
  $('#c-add').onclick = () => openCandidateModal(null);
  $('#c-report').onclick = renderCandidatesReportModal;
  $$('tr[data-id]', viewRoot()).forEach(tr => tr.onclick = () => openCandidateModal(tr.dataset.id));
  $$('[data-contract]', viewRoot()).forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    const c = IDX.candidate[b.dataset.contract], miss = candidateContractMissing(c || {});
    if (miss.length) return openBlockAlert(candidateContractBlockMsg(miss));
    openCandidateContractModal(b.dataset.contract);
  });
}

/* ---------- تقرير المترشّحين ---------- */
function candidatesReportRows(list) {
  return list.map(c => {
    const st = recruitStageInfo(c.source || 'outside', c.stage);
    return { c, st: st ? t(st.label) : '—', deadline: c.source === 'kuwaiti' ? null : c.source === 'internal' ? c.oldSponsorResidencyExp : (candidateDeadline(c) || c.visaExp) };
  });
}
function renderCandidatesReportModal() {
  const list = filteredCandidates();
  const rows = candidatesReportRows(list);
  const bySource = k => list.filter(c => (c.source || 'outside') === k).length;
  const m = openModal({
    title: '📊 ' + t('تقرير المترشّحين'), size: 'wide',
    body: `<div class="row" style="margin-bottom:10px"><span class="chip">${t('الإجمالي')}: ${list.length}</span>${Object.keys(RECRUIT_SOURCES).map(k => `<span class="chip">${recruitSourceLabel(k, true)}: ${bySource(k)}</span>`).join('')}
      <span class="chip" data-p="sensitive.salary">${t('إجمالي الرواتب المتفق عليها')}: ${fmtMoney(sum(list.filter(c => c.stage !== 'rejected').map(c => c.salary)))}</span></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>${t('الاسم')}</th><th>${t('الجنسية')}</th><th>${t('المهنة')}</th><th>${t('المصدر')}</th><th>${t('المرحلة')}</th><th>${t('الشركة المستهدفة')}</th><th data-p="sensitive.salary">${t('الراتب')}</th><th>${t('بدل السكن')}</th><th>${t('المهلة')}</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.c.name)}</td><td>${esc(natLabel(r.c.nationality) || '')}</td><td>${esc(profLabel(r.c.profession) || '')}</td><td>${recruitSourceLabel(r.c.source, true)}</td><td>${esc(r.st)}</td><td>${esc(companyName(r.c.targetCompanyId))}</td><td class="num" data-p="sensitive.salary">${r.c.salary ? fmtMoney(r.c.salary) : '—'}</td><td>${r.c.housingAllowance ? '✓' : ''}</td><td>${datePill(r.deadline)}</td></tr>`).join('')}
      </tbody></table></div>`,
    foot: `<label class="row small" style="gap:6px">${t('لغة التقرير')}<select id="cr-lang">${opt('ar', 'العربية', LANG !== 'en')}${opt('en', 'English', LANG === 'en')}</select></label>
      <button class="btn primary" data-print>🖨️ طباعة</button>${can('admin') ? '<button class="btn" data-csv>📤 CSV</button>' : ''}<button class="btn" data-close>إغلاق</button>`,
  });
  // التقرير بلغة التقرير حتى لو البرنامج شغال بلغة تانية (المراحل والجنسيات والمهن بتتترجم وقت الطباعة)
  $('[data-print]', m.el).onclick = () => withLang($('#cr-lang', m.el).value, () => printCandidatesReport(candidatesReportRows(list)));
  const csvBtn = $('[data-csv]', m.el);
  if (csvBtn) csvBtn.onclick = () => exportGuard(`${t('تقرير المترشّحين')} (${rows.length})`, () => downloadBlob(toCsv([[t('الاسم'), 'Name', t('الجنسية'), t('المهنة'), t('المصدر'), t('المرحلة'), t('الشركة المستهدفة'), t('الراتب'), t('بدل السكن'), t('رقم الجواز'), t('تاريخ التقديم'), t('المهلة')],
    ...rows.map(r => [r.c.name, r.c.nameEn, r.c.nationality, r.c.profession, r.c.source, r.st, companyName(r.c.targetCompanyId), r.c.salary, r.c.housingAllowance ? 'yes' : '', r.c.passportNo, r.c.appliedDate, r.deadline])]), `candidates-${todayISO()}.csv`, 'text/csv'));
}
function printCandidatesReport(rows) {
  // نفس شكل تقارير الموظفين (openReportWindow): شعار الشركة لو كل المترشّحين على شركة واحدة
  const f = UI.cand, coIds = uniq(rows.map(r => r.c.targetCompanyId));
  const company = (f.company && IDX.company[f.company]) || (coIds.length === 1 ? IDX.company[coIds[0]] : null);
  const sal = can('sensitive.salary');
  const crit = [f.source && `${t('المصدر')}: ${recruitSourceLabel(f.source)}`,
    f.stage && `${t('المرحلة')}: ${esc(t((recruitStageInfo(f.source || 'outside', f.stage) || recruitStageInfo('internal', f.stage) || recruitStageInfo('kuwaiti', f.stage) || {}).label || f.stage))}`,
    f.company && `${t('الشركة المستهدفة')}: ${esc(companyName(f.company))}`, f.q && `${t('بحث')}: «${esc(f.q)}»`].filter(Boolean).join(' · ');
  const active = rows.filter(r => r.c.stage !== 'rejected');
  const table = `<table class="rpt"><thead><tr><th>#</th><th class="txt">${t('الاسم')}</th><th>${t('الجنسية')}</th><th>${t('المهنة')}</th><th>${t('المصدر')}</th><th>${t('المرحلة')}</th><th>${t('الشركة المستهدفة')}</th>
      ${sal ? `<th class="num">${t('الراتب')} (${t('د.ك')})</th>` : ''}<th>${t('بدل السكن')}</th><th>${t('المهلة')}</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${i % 2 ? 'z' : ''}"><td class="idx">${i + 1}</td><td class="txt">${esc(empName(r.c))}</td><td>${esc(natLabel(r.c.nationality) || '')}</td><td>${esc(profLabel(r.c.profession) || '')}</td>
      <td>${recruitSourceLabel(r.c.source, true)}</td><td>${esc(r.st)}</td><td>${esc(companyName(r.c.targetCompanyId))}</td>
      ${sal ? `<td class="num">${r.c.salary ? rptNum(r.c.salary) : ''}</td>` : ''}<td>${r.c.housingAllowance ? '✓' : ''}</td><td>${r.deadline ? datePill(r.deadline) : ''}</td></tr>`).join('')}</tbody>
    ${sal ? `<tfoot><tr><td></td><td colspan="6">${t('إجمالي الرواتب المتفق عليها')} (${active.length})</td><td class="num">${rptNum(sum(active.map(r => r.c.salary)))}</td><td></td><td></td></tr></tfoot>` : ''}</table>`;
  openReportWindow({ title: t('تقرير المترشّحين'), company, criteria: crit, body: table, landscape: true,
    summary: [[rows.length, t('الإجمالي')], ...Object.keys(RECRUIT_SOURCES).map(k => [rows.filter(r => (r.c.source || 'outside') === k).length, recruitSourceLabel(k, true)]),
      [rows.filter(r => r.c.stage === 'rejected').length, t('مرفوض')]],
    meta: [[t('عدد السجلات'), String(rows.length)]] });
}

/* ---------- نموذج المترشّح ---------- */
function openCandidateModal(id) {
  const isNew = !id;
  let c = isNew ? { source: 'outside', stage: 'work_permit', appliedDate: todayISO() } : migrateRecruitStages(JSON.parse(JSON.stringify(IDX.candidate[id] || {})));
  if (!isNew && !IDX.candidate[id]) return toast('المترشّح غير موجود', 'err');
  let draftNote = '';
  if (isNew) { const d = loadDraft('candidate'); if (d && d.data) { c = Object.assign(c, d.data); draftNote = `<div class="notice">📝 ${t('تم استرجاع مسودة محفوظة من')} ${fmtDateTime(d.at.slice(0, 19))} <button type="button" class="btn sm" id="drop-draft">${t('تجاهل المسودة')}</button></div>`; } }
  const v = k => esc(c[k] ?? '');
  const m = openModal({
    title: isNew ? t('إضافة مترشّح') : t('تعديل مترشّح') + ': ' + esc(c.name), size: 'wide',
    body: `${draftNote}<form class="form" id="cand-form" autocomplete="off">
      <h4>المصدر والمرحلة</h4>
      <label>${t('المصدر')}<select name="source">${Object.keys(RECRUIT_SOURCES).map(k => opt(k, recruitSourceLabel(k), (c.source || 'outside') === k)).join('')}</select></label>
      <label>${t('مرحلة الإجراءات')}<select name="stage" id="cand-stage"></select></label>
      <div class="notice" id="cand-contract" style="grid-column:1/-1" hidden>
        <div class="row" id="cand-contract-row"><b>📄 ${t('عقد العمل')}</b><span class="spacer"></span><button type="button" class="btn primary sm" id="cand-contract-go">🖨️ ${t('طباعة عقد العمل')}</button></div>
        <div class="small" id="cand-contract-miss" style="margin-top:4px"></div>
        <div class="row" id="cand-kw-forms" style="margin-top:8px" hidden><b>🇰🇼 ${t('نماذج العمالة الوطنية')}</b><span class="spacer"></span>
          <button type="button" class="btn sm" data-kwform="pifss103">${t('استمارة 103 (التأمينات)')}</button>
          <button type="button" class="btn sm" data-kwform="social">${t('استمارة العلاوة الاجتماعية')}</button></div></div>
      <label>${t('تاريخ التقديم')}<input type="date" name="appliedDate" value="${v('appliedDate')}"></label>
      <label>${t('الشركة المستهدفة')}<select name="targetCompanyId">${companyOptions(c.targetCompanyId)}</select></label>
      <label>${t('مركز التكلفة')}<select name="costCenter">${costCenterOptions(c.costCenter)}</select></label>
      <h4>البيانات الشخصية</h4>
      <label><span class="req">${t('الاسم (عربي)')}</span><input name="name" value="${v('name')}"></label>
      <label>${t('الاسم (إنجليزي)')}<input name="nameEn" value="${v('nameEn')}" dir="ltr"></label>
      <label>${t('الجنسية')}<input name="nationality" value="${v('nationality')}" list="dl-nat2"></label>
      <label>${t('تاريخ الميلاد')}<input type="date" name="dateOfBirth" value="${v('dateOfBirth')}"></label>
      <label>${t('الجنس')}<select name="gender">${opt('', '—', !c.gender)}${Object.entries(GENDER_LABELS).map(([k, l]) => opt(k, t(l), k === c.gender)).join('')}</select></label>
      <label>${t('المهنة')}<input name="profession" value="${v('profession')}" list="dl-prof2"></label>
      <label>${t('الهاتف')}<input name="phone" value="${v('phone')}" dir="ltr"></label>
      <label>${t('البريد الإلكتروني')}<input type="email" name="email" value="${v('email')}" dir="ltr"></label>
      ${personExtraInputs(c)}
      <div data-src="kuwaiti" style="grid-column:1/-1">${kuwaitiInputs(c)}</div>
      ${hiddenField('candidate', 'salary') ? '' : `<label>${t('الراتب المتفق عليه (د.ك)')}<input type="number" step="0.001" min="0" name="salary" value="${v('salary')}"></label>`}
      <label class="check"><input type="checkbox" name="housingAllowance" ${c.housingAllowance ? 'checked' : ''}> 🏠 ${t('بدل السكن')}</label>
      <h4>الجواز</h4>
      ${hiddenField('candidate', 'passportNo') ? '' : `<label>${t('رقم الجواز')}<input name="passportNo" value="${v('passportNo')}" dir="ltr"></label>`}
      <label>${t('تاريخ إصدار الجواز')}<input type="date" name="passportIssueDate" value="${v('passportIssueDate')}"></label>
      <label>${t('انتهاء الجواز')}<input type="date" name="passportExp" value="${v('passportExp')}"></label>
      <h4 data-src="outside">${t('التأشيرة والدخول')}</h4>
      <label data-src="outside">${t('تاريخ إصدار التأشيرة')}<input type="date" name="visaIssueDate" value="${v('visaIssueDate')}"></label>
      <label data-src="outside">${t('انتهاء التأشيرة')}<input type="date" name="visaExp" value="${v('visaExp')}"></label>
      <label data-src="outside">${t('تاريخ الدخول')} <span class="small">(${t('مهلة 60 يومًا')})</span><input type="date" name="entryDate" value="${v('entryDate')}"></label>
      <div data-src="outside" class="small" id="deadline-box"></div>
      <h4 data-src="internal">${t('النقل الداخلي')}</h4>
      <label data-src="internal">${t('انتهاء الإقامة عند الكفيل القديم')}<input type="date" name="oldSponsorResidencyExp" value="${v('oldSponsorResidencyExp')}"></label>
      <h4>الرقم المدني</h4>
      <label>${t('الرقم المدني')} <span class="small muted">(${t('يُترك فارغًا لحد ما يصدر')})</span><input name="civilId" value="${v('civilId')}" inputmode="numeric"></label>
      <label class="full">${t('ملاحظات')}<textarea name="notes" rows="2">${v('notes')}</textarea></label>
      </form>
      <datalist id="dl-nat2">${uniq(STATE.employees.map(x => x.nationality)).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-prof2">${uniq(STATE.employees.map(x => x.profession)).slice(0, 400).map(x => `<option value="${esc(x)}">`).join('')}</datalist>`,
    foot: `${!isNew ? '<button class="btn danger write-only" data-p="recruitment.delete" data-del>🗑️ حذف</button><button class="btn" data-driving>🚗 نموذج رخصة القيادة</button><span class="spacer"></span>' : ''}<button class="btn primary write-only" data-p="recruitment.edit" data-save>💾 حفظ</button><button class="btn" data-close>إلغاء</button>`,
  });
  const form = $('#cand-form', m.el);
  const srcSel = $('[name="source"]', form), stSel = $('#cand-stage', form), natIn = $('[name="nationality"]', form);
  const values = () => Object.assign(formValues(form), { children: collectKidRows(form) });
  const syncSource = () => {
    const src = srcSel.value;
    const cur = stSel.value || c.stage;
    const kwOk = isKuwaitiStaff({ nationality: natIn.value });
    srcSel.querySelector('option[value="kuwaiti"]').disabled = !kwOk && src !== 'kuwaiti';
    stSel.innerHTML = recruitStagesForSource(src).filter(s => s.id !== 'all_completed' || can('employees.edit') || s.id === cur).map((s, i) => opt(s.id, `${s.rejected ? '' : (i + 1) + '. '}${t(s.label)}`, s.id === cur)).join('');
    $$('[data-src]', form).forEach(el => el.hidden = el.dataset.src !== src);
    updDeadline();
    syncContract();
  };
  // صندوق عقد العمل: بيظهر أول ما تختار المرحلة، وبيقول الناقص وإنت بتكتب
  const contractBox = $('#cand-contract', form);
  const syncContract = () => {
    const kwForms = stSel.value === CANDIDATE_KW_FORMS_STAGE;
    contractBox.hidden = !((canCandidateContract() && candidateContractStage(stSel.value)) || kwForms);
    $('#cand-kw-forms', form).hidden = !kwForms;
    $('#cand-contract-row', form).hidden = $('#cand-contract-miss', form).hidden = !canCandidateContract();
    if (contractBox.hidden || !canCandidateContract()) return;
    const miss = candidateContractMissing(formValues(form));
    $('#cand-contract-miss', form).innerHTML = miss.length
      ? `<span style="color:var(--red)">⚠️ ${esc(candidateContractBlockMsg(miss))}</span>`
      : `<span style="color:var(--green)">✓ ${t('بيانات العقد كاملة')}</span>`;
  };
  stSel.onchange = syncContract;
  form.addEventListener('input', syncContract);
  const updDeadline = () => {
    const ed = $('[name="entryDate"]', form).value;
    $('#deadline-box', form).innerHTML = ed ? `${t('آخر موعد لإنهاء الإجراءات')}: ${datePill(addDays(ed, 60))} <span class="muted">${esc(daysText(daysUntil(addDays(ed, 60))))}</span>` : '';
  };
  srcSel.onchange = syncSource;
  // الجنسية الكويتية ← المصدر «عمالة وطنية» بمراحله، وغيرها ← يرجع «استقدام من الخارج»
  natIn.addEventListener('input', () => {
    const kw = isKuwaitiStaff({ nationality: natIn.value });
    if (kw !== (srcSel.value === 'kuwaiti')) { srcSel.value = kw ? 'kuwaiti' : 'outside'; syncSource(); }
  });
  $('#kw-box', form).style.display = '';          // القسم ظاهر/مخفي مع المصدر (data-src)
  bindKidRows(form);
  $('#kid-add', form).onclick = () => {
    const kids = collectKidRows(form, true); kids.push({});
    $('#kids-box', form).innerHTML = renderKidRows(kids); bindKidRows(form); translateDomText($('#kids-box', form));
  };
  $('[name="entryDate"]', form).onchange = updDeadline;
  syncSource();
  const dd = $('#drop-draft', m.el); if (dd) dd.onclick = () => { clearDraft('candidate'); m.close(); openCandidateModal(null); };
  if (isNew) attachDraftAutosave('candidate', form, values);

  // الحفظ ← رقم المترشّح، أو قيمة فاضية لو اتمنع (والتحويل لموظف بيقفل النافذة بنفسه)
  const save = async () => {
    const d = values();
    if (!d.name) return openBlockAlert(t('الاسم مطلوب'));
    // منع التكرار (القسم 8.2): كله منع عند إضافة مترشّح
    if (d.civilId) { const x = findDuplicateCivilId(d.civilId, null); const own = STATE.candidates.find(k => k.civilId === d.civilId && k.id === id); if (x && !own) return openBlockAlert(t('الرقم المدني مسجّل بالفعل لـ') + ' ' + x); }
    const px = findDuplicatePassport(d.passportNo, null, id); if (px) return openBlockAlert(t('رقم الجواز مسجّل بالفعل لـ') + ' ' + px);
    if (isNew) { const nx = findDuplicateNameNationality(d.name, d.nationality, { withCandidates: true }); if (nx) return openBlockAlert(t('يوجد شخص مسجّل بنفس الاسم والجنسية') + ': ' + nx.name); }
    // التحويل لموظف (القسم 8.1)
    if (d.stage === 'all_completed') {
      if (!d.civilId) return openBlockAlert(t('لا يمكن اختيار «تم إنجاز جميع الإجراءات» قبل تسجيل الرقم المدني'));
      if (!await openConfirm(`✅ ${t('تم إنجاز جميع الإجراءات')}\n\n${t('سيتم تحويل')} «${esc(d.name)}» ${t('إلى موظف بحالة «قيد الاستكمال» ونقل بياناته (الاسم، الجنسية، المهنة، الراتب، بدل السكن، الجواز، الشركة، مركز التكلفة)، وحذفه من قائمة المترشّحين.')}`, { okLabel: t('تحويل إلى موظف') })) return;
      try {
        const res = await api(id ? 'PUT' : 'POST', id ? '/api/candidates/' + id : '/api/candidates', d);
        const cid = id || res.id;
        const conv = await api('POST', `/api/candidates/${cid}/convert`, {});
        clearDraft('candidate'); m.close(); await reload();
        toast('تم التحويل إلى موظف', 'ok');
        openProfileCard(conv.employeeId);
      } catch (e) { e.data && e.data.block ? openBlockAlert(e.message) : toast(e.message, 'err'); await reload(); }
      return;
    }
    try {
      const res = await persist(id ? 'PUT' : 'POST', id ? '/api/candidates/' + id : '/api/candidates', d, 'تم الحفظ');
      if (isNew) clearDraft('candidate');
      return id || res.id;
    } catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); }
  };
  $('[data-save]', m.el).onclick = async () => { if (await save()) m.close(); };
  $('#cand-contract-go', form).onclick = async () => {
    const miss = candidateContractMissing(formValues(form));
    if (miss.length) return openBlockAlert(candidateContractBlockMsg(miss));
    const cid = can('recruitment.edit') ? await save() : id;     // العقد بيطلع بآخر تعديلات في النافذة
    if (!cid) return;
    m.close();
    openCandidateContractModal(cid);
  };
  $$('[data-kwform]', form).forEach(b => b.onclick = async () => {
    const cid = can('recruitment.edit') ? await save() : id;     // النموذج بيطلع بآخر تعديلات في النافذة
    if (!cid) return;
    m.close();
    openOfficialFormModal(b.dataset.kwform, 'candidate', cid);
  });
  const drv = $('[data-driving]', m.el);
  if (drv) drv.onclick = async () => {
    const cid = can('recruitment.edit') ? await save() : id;     // النموذج بيطلع بآخر تعديلات في النافذة
    if (!cid) return;
    m.close();
    openOfficialFormModal('driving', 'candidate', cid);
  };
  const del = $('[data-del]', m.el);
  if (del) del.onclick = async () => { if (await openConfirm(t('حذف المترشّح؟'), { danger: true })) { m.close(); await persist('DELETE', '/api/candidates/' + id, undefined, 'تم الحذف'); } };
}
function convertCandidateToEmployee(id) { return api('POST', `/api/candidates/${id}/convert`, {}).then(() => reload()); }
