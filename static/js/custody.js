/* =====================================================================
   CUSTODY — العهد والمصروفات (custody.py على السيرفر)
   طلب (بيتطبع ويتعتمد ورقي من المسؤول والإدارة المالية) ← «تم الصرف» (المبلغ وتاريخه) ← البنود بتتعلّم «تم»
   لوحدها مع مراحل المعاملة / التسجيل (والمبلغ الفعلي بيتعدّل) ← التقفيل لكل مركز تكلفة (المرحلة التانية)
   ===================================================================== */
'use strict';

// نفس custody.TX_TYPES على السيرفر
const CUSTODY_TYPES = {
  renewal:         { label: 'تجديد إقامة',           kind: 'employee',  flow: 'gov' },
  transfer_in:     { label: 'تحويل إقامة من الداخل', kind: 'employee',  flow: 'gov' },
  transfer_out:    { label: 'تحويل إقامة من الخارج', kind: 'candidate', flow: 'internal', source: 'internal' },
  visa:            { label: 'إصدار تأشيرة عمل',      kind: 'candidate', flow: 'outside',  source: 'outside' },
  first_residency: { label: 'إصدار إقامة أول مرة',   kind: 'candidate', flow: 'outside',  source: 'outside' },
};
const CUSTODY_STATUS = { requested: ['مطلوبة', 'orange'], disbursed: ['تم الصرف', 'blue'], closed: ['مقفولة', 'green'], cancelled: ['ملغاة', 'grey'] };

function custodyNo(c) { return 'ع-' + String(c.no).padStart(4, '0'); }
function custodyTypeLabel(tx) { return t((CUSTODY_TYPES[tx] || { label: tx }).label); }
function custodyStatusChip(st) {
  const [l, col] = CUSTODY_STATUS[st] || [st, 'grey'];
  return `<span class="chip" style="background:var(--${col}-soft);color:var(--${col})">${esc(t(l))}</span>`;
}
/** مراحل نوع الطلب (للبند في جدول الرسوم) */
function custodyFlowStages(flow) {
  return flow === 'gov' ? GOV_STAGES.filter(g => g.id !== 'awaiting_cancellation') : recruitStagesForSource(flow).filter(s => !s.rejected);
}
const custodyLineAmount = l => l.actual ?? l.planned ?? 0;
/** الأشخاص في العهدة وبنود كل واحد */
function custodyPersons(c) {
  const m = new Map();
  (c.lines || []).forEach(l => {
    const k = l.personKind + ':' + l.personId;
    if (!m.has(k)) m.set(k, { key: k, kind: l.personKind, id: l.personId, name: l.personName, civilId: l.civilId, costCenter: l.costCenter, companyId: l.companyId, lines: [] });
    m.get(k).lines.push(l);
  });
  return [...m.values()];
}
/** المطلوب، المصروف للمستلم، المنفّذ فعلًا (البنود «تم»)، الرصيد، والجاهزين للتقفيل */
function custodyTotals(c) {
  const ls = c.lines || [], people = custodyPersons(c);
  const spent = sum(ls.filter(l => l.done).map(custodyLineAmount));
  const received = ['disbursed', 'closed'].includes(c.status) ? (c.disbursedAmount || 0) : 0;
  return { planned: c.requestedAmount ?? sum(ls.map(l => l.planned)), received, spent, remaining: received - spent,
    persons: people.length, ready: people.filter(p => p.lines.every(l => l.done)).length, itemsDone: ls.filter(l => l.done).length, items: ls.length };
}
/** أرصدة المستلمين: اتصرف له كام، ونفّذ كام، والباقي معاه (العهد اللي اتصرفت بس) */
function custodianBalances() {
  const by = {};
  (STATE.custodies || []).filter(c => c.status !== 'cancelled').forEach(c => {
    const tt = custodyTotals(c), b = by[c.custodian] || (by[c.custodian] = { name: c.custodian, received: 0, spent: 0, open: 0, requested: 0 });
    b.received += tt.received;
    if (c.status !== 'requested') b.spent += tt.spent;
    if (c.status === 'disbursed') b.open++;
    if (c.status === 'requested') b.requested++;
  });
  return Object.values(by).map(b => ({ ...b, remaining: b.received - b.spent })).sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, 'ar'));
}

/* ---------- الشاشة ---------- */
function renderCustody() {
  const U = UI.custody = Object.assign({ tab: 'list', q: '', status: '', type: '', custodian: '' }, UI.custody || {});
  const all = STATE.custodies || [];
  const open = all.filter(c => c.status === 'disbursed').map(custodyTotals);
  const kpi = [[all.filter(c => c.status === 'requested').length, 'طلبات لسه ماتصرفتش', 'orange'], [open.length, 'عهد مفتوحة', 'blue'],
    [fmtMoney(sum(open.map(x => x.received))), 'اتصرف للمستلمين', ''], [fmtMoney(sum(open.map(x => x.spent))), 'اتنفّذ فعلًا', ''],
    [fmtMoney(sum(open.map(x => x.remaining))), 'الرصيد مع المستلمين', 'purple'], [sum(open.map(x => x.ready)), 'شخص جاهز للتقفيل', 'green']];
  viewRoot().innerHTML = `<div class="page-head"><div><h1>${t('العهد والمصروفات')}</h1><div class="sub">${all.length} ${t('عهدة')}</div></div>
    <div class="actions"><button class="btn primary write-only" data-p="custody.edit" id="cu-add">➕ ${t('طلب عهدة')}</button>
      <button class="btn" data-p="custody.fees" id="cu-fees">⚙️ ${t('جدول الرسوم')}</button></div></div>
    <div class="cu-kpis">${kpi.map(([v, l, c]) => `<div class="card cu-kpi"${c ? ` style="border-top:3px solid var(--${c})"` : ''}><b class="num">${esc(v)}</b><span>${esc(t(l))}</span></div>`).join('')}</div>
    <div class="tabs" style="margin:14px 0 10px">${[['list', 'العهد'], ['balances', 'أرصدة المستلمين']].map(([k, l]) => `<button data-cutab="${k}" class="${U.tab === k ? 'active' : ''}">${esc(t(l))}</button>`).join('')}</div>
    <div id="cu-pane">${U.tab === 'balances' ? custodyBalancesHtml() : custodyListHtml()}</div>`;
  const upd = p => { Object.assign(UI.custody, p); saveUiStateToLocalStorage(); render(); };
  $$('[data-cutab]').forEach(b => b.onclick = () => upd({ tab: b.dataset.cutab }));
  const add = $('#cu-add'); if (add) add.onclick = () => openCustodyRequestModal();
  const fees = $('#cu-fees'); if (fees) fees.onclick = () => openFeeItemsModal();
  if (U.tab === 'balances') {
    $$('[data-cust]').forEach(tr => tr.onclick = () => upd({ tab: 'list', custodian: tr.dataset.cust, status: '' }));
    return;
  }
  const q = $('#cuf-q');
  q.addEventListener('input', debounce(e => { UI.custody.q = e.target.value; render(); const i = $('#cuf-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
  $('#cuf-status').onchange = e => upd({ status: e.target.value });
  $('#cuf-type').onchange = e => upd({ type: e.target.value });
  $('#cuf-cust').onchange = e => upd({ custodian: e.target.value });
  $('#cuf-clear').onclick = () => upd({ q: '', status: '', type: '', custodian: '' });
  $$('tr[data-cu]').forEach(tr => tr.onclick = () => openCustodyDetails(tr.dataset.cu));
}
function custodyListHtml() {
  const U = UI.custody, q = norm(U.q);
  const list = (STATE.custodies || []).filter(c => (!U.status || c.status === U.status) && (!U.type || c.txType === U.type)
    && (!U.custodian || c.custodian === U.custodian)
    && (!q || [c.custodian, custodyNo(c), String(c.no), c.notes, ...(c.lines || []).flatMap(l => [l.personName, l.civilId])].some(v => norm(v).includes(q))));
  return `<div class="filters"><input type="search" id="cuf-q" placeholder="${esc(t('بحث بالرقم أو المستلم أو اسم موظف…'))}" value="${esc(U.q)}">
      <select id="cuf-status">${opt('', t('— كل الحالات —'), !U.status)}${Object.entries(CUSTODY_STATUS).map(([k, [l]]) => opt(k, t(l), k === U.status)).join('')}</select>
      <select id="cuf-type">${opt('', t('— كل الأنواع —'), !U.type)}${Object.entries(CUSTODY_TYPES).map(([k, v]) => opt(k, t(v.label), k === U.type)).join('')}</select>
      <select id="cuf-cust">${opt('', t('— كل المستلمين —'), !U.custodian)}${uniq((STATE.custodies || []).map(c => c.custodian)).sort().map(x => opt(x, x, x === U.custodian)).join('')}</select>
      <button class="btn sm ghost" id="cuf-clear">✕ ${t('مسح الفلاتر')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('الرقم')}</th><th>${t('النوع')}</th><th>${t('المستلم')}</th><th>${t('الأشخاص')}</th>
      <th>${t('المطلوب')}</th><th>${t('اتصرف')}</th><th>${t('اتنفّذ')}</th><th>${t('الرصيد')}</th><th>${t('البنود')}</th><th>${t('الحالة')}</th><th>${t('تاريخ الطلب')}</th></tr></thead><tbody>
    ${list.map(c => { const tt = custodyTotals(c); return `<tr class="clickable" data-cu="${c.id}"><td class="num"><b>${esc(custodyNo(c))}</b></td><td>${esc(custodyTypeLabel(c.txType))}</td>
      <td>${esc(c.custodian)}</td><td class="num">${tt.persons}${tt.ready ? ` <span class="small" style="color:var(--green)">(✓ ${tt.ready})</span>` : ''}</td>
      <td class="num">${fmtMoney(tt.planned)}</td><td class="num">${tt.received ? fmtMoney(tt.received) : '—'}</td><td class="num">${fmtMoney(tt.spent)}</td>
      <td class="num" style="${tt.remaining < 0 ? 'color:var(--red)' : ''}">${tt.received ? fmtMoney(tt.remaining) : '—'}</td>
      <td><div class="small">${tt.itemsDone}/${tt.items}</div><div class="progress" style="width:80px"><i style="width:${tt.items ? 100 * tt.itemsDone / tt.items : 0}%"></i></div></td>
      <td>${custodyStatusChip(c.status)}</td><td class="num small">${fmtDate(c.requestDate)}</td></tr>`; }).join('') || `<tr><td colspan="11" class="empty">${t('لا توجد عهد')}</td></tr>`}
    </tbody></table></div>`;
}
function custodyBalancesHtml() {
  const rows = custodianBalances();
  return `<div class="notice small" style="margin-bottom:8px">${t('الرصيد = اللي اتصرف للمستلم − اللي اتنفّذ فعلًا (البنود اللي «تم»). الطلبات اللي لسه ماتصرفتش مش محسوبة.')}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('المستلم')}</th><th>${t('اتصرف له')}</th><th>${t('اتنفّذ')}</th><th>${t('الرصيد معاه')}</th><th>${t('عهد مفتوحة')}</th><th>${t('طلبات لسه ماتصرفتش')}</th></tr></thead><tbody>
    ${rows.map(b => `<tr class="clickable" data-cust="${esc(b.name)}"><td><b>${esc(b.name)}</b></td><td class="num">${fmtMoney(b.received)}</td><td class="num">${fmtMoney(b.spent)}</td>
      <td class="num" style="font-weight:700;${b.remaining < 0 ? 'color:var(--red)' : ''}">${fmtMoney(b.remaining)}</td><td class="num">${b.open}</td><td class="num">${b.requested}</td></tr>`).join('')
      || `<tr><td colspan="6" class="empty">${t('لا توجد عهد')}</td></tr>`}
    </tbody>${rows.length ? `<tfoot><tr><td>${t('الإجمالي')}</td><td class="num">${fmtMoney(sum(rows.map(b => b.received)))}</td><td class="num">${fmtMoney(sum(rows.map(b => b.spent)))}</td>
      <td class="num"><b>${fmtMoney(sum(rows.map(b => b.remaining)))}</b></td><td class="num">${sum(rows.map(b => b.open))}</td><td class="num">${sum(rows.map(b => b.requested))}</td></tr></tfoot>` : ''}</table></div>`;
}

/* ---------- طلب عهدة (جديد أو تعديل قبل الصرف) ---------- */
function openCustodyRequestModal(id = null) {
  const old = id ? (STATE.custodies || []).find(c => c.id === id) : null;
  const S = { tx: old ? old.txType : 'renewal', persons: new Map(), quick: '' };    // id ← {items: {رقم البند: المبلغ}}
  const snap = {};                                                                  // بيانات الشخص من العهدة القديمة
  if (old) custodyPersons(old).forEach(p => { snap[p.id] = p; S.persons.set(p.id, { items: Object.fromEntries(p.lines.map(l => [l.feeItemId, l.planned])) }); });
  const fees = () => (STATE.feeItems || []).filter(f => f.txType === S.tx && f.active);
  const defaults = () => Object.fromEntries(fees().map(f => [f.id, f.amount ?? null]));
  const m = openModal({
    title: old ? `✏️ ${t('تعديل طلب العهدة')} ${esc(custodyNo(old))}` : '➕ ' + t('طلب عهدة'), size: 'wide',
    body: `<div class="form" id="cu-form">
        <label>${t('نوع المعاملة')}<select name="txType">${Object.entries(CUSTODY_TYPES).map(([k, v]) => opt(k, t(v.label), k === S.tx)).join('')}</select></label>
        <label><span class="req">${t('المستلم')}</span><input name="custodian" list="dl-custodians" value="${esc(old ? old.custodian : '')}" placeholder="${esc(t('اسم المندوب'))}"></label>
        <label>${t('تاريخ الطلب')}<input type="date" name="requestDate" value="${esc(old ? old.requestDate || '' : todayISO())}"></label>
        <label>${t('الشركة (رأس الطباعة)')}<select name="companyId">${companyOptions(old ? old.companyId || '' : '', '— تلقائي —')}</select></label>
        <label class="full">${t('ملاحظات')}<input name="notes" value="${esc(old ? old.notes || '' : '')}"></label></div>
      <datalist id="dl-custodians">${uniq((STATE.custodies || []).map(c => c.custodian)).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <h4 class="cu-h">${t('الأشخاص')} <span class="small muted" id="cu-kind"></span></h4>
      <div class="row" style="gap:8px;flex-wrap:wrap"><input type="search" id="cu-q" placeholder="${esc(t('بحث بالاسم أو الرقم المدني…'))}" style="flex:1;min-width:200px">
        <span id="cu-quick"></span><span class="small muted" id="cu-sel-n"></span></div>
      <div class="cu-pick-list" id="cu-pick"></div>
      <h4 class="cu-h">${t('البنود والمبالغ')} <span class="small muted">(${t('شيل علامة البند اللي الشخص مش محتاجه')})</span></h4>
      <div id="cu-matrix"></div>`,
    foot: `<button class="btn primary" data-save="print">🖨️ ${t('حفظ وطباعة الطلب')}</button><button class="btn" data-save="">💾 ${t('حفظ')}</button>
      <span class="spacer"></span><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const kind = () => CUSTODY_TYPES[S.tx].kind;
  const eligible = () => {
    const ty = CUSTODY_TYPES[S.tx];
    if (ty.kind === 'employee') return STATE.employees.filter(e => (e.employmentStatus || 'active') !== 'terminated')
      .map(e => ({ id: e.id, name: e.name, sub: `${e.id} · ${companyName(empCompanyId(e)) || '—'}${e.costCenter ? ' · ' + e.costCenter : ''}`, exp: e.residencyExp,
        tag: e.residencyExp ? `${t('الإقامة')}: ${datePill(e.residencyExp)}` : '' }));
    return STATE.candidates.filter(c => (c.source || 'outside') === ty.source && !['rejected', 'all_completed'].includes(c.stage))
      .map(c => ({ id: c.id, name: c.name, sub: `${c.civilId || c.passportNo || '—'} · ${companyName(c.targetCompanyId) || '—'}`,
        tag: esc(t((recruitStageInfo(c.source || 'outside', c.stage) || {}).label || '')) }));
  };
  const info = pid => {
    const x = eligible().find(p => p.id === pid);
    if (x) return x;
    const p = snap[pid];                                   // مش في القائمة دلوقتي (اتحوّل / اتنقل) ← من العهدة
    return p ? { id: pid, name: p.name, sub: `${p.civilId || '—'} · ${p.costCenter || '—'}` } : { id: pid, name: pid, sub: '' };
  };
  const drawPick = () => {
    const q = norm($('#cu-q', E).value), soon = addDays(todayISO(), 90);
    $('#cu-kind', E).textContent = `(${t(kind() === 'employee' ? 'موظفين' : 'مترشّحين')} — ${t(CUSTODY_TYPES[S.tx].kind === 'employee' ? 'الإقامات والموظفين' : 'تسجيل موظف جديد')})`;
    $('#cu-quick', E).innerHTML = S.tx === 'renewal' ? `<span class="chip clickable ${S.quick === 'soon' ? 'on' : ''}" data-quick="soon">${t('الإقامة بتنتهي خلال 90 يوم')}</span>` : '';
    const list = eligible().filter(p => (!q || norm(p.name + ' ' + p.sub).includes(q)) && (S.quick !== 'soon' || (p.exp && p.exp <= soon)))
      .sort((a, b) => (S.persons.has(b.id) - S.persons.has(a.id)) || (a.exp && b.exp ? a.exp.localeCompare(b.exp) : 0) || a.name.localeCompare(b.name, 'ar'));
    $('#cu-pick', E).innerHTML = list.slice(0, 300).map(p => `<label class="${S.persons.has(p.id) ? 'on' : ''}"><input type="checkbox" data-pick="${esc(p.id)}" ${S.persons.has(p.id) ? 'checked' : ''}>
        <b>${esc(p.name)}</b><span class="small muted">${esc(p.sub)}</span><span class="spacer"></span><span class="small">${p.tag || ''}</span></label>`).join('')
      + (list.length > 300 ? `<div class="small muted" style="padding:6px 10px">${t('فيه نتائج أكتر — ضيّق البحث')}</div>` : '')
      || `<div class="empty">${t(kind() === 'employee' ? 'مفيش موظفين' : 'مفيش مترشّحين في المراحل دي')}</div>`;
    $('#cu-sel-n', E).textContent = `${t('المحددين')}: ${S.persons.size}`;
    $$('[data-pick]', E).forEach(cb => cb.onchange = () => {
      if (cb.checked) S.persons.set(cb.dataset.pick, { items: defaults() }); else S.persons.delete(cb.dataset.pick);
      drawPick(); drawMatrix();
    });
    const qk = $('[data-quick]', E); if (qk) qk.onclick = () => { S.quick = S.quick ? '' : 'soon'; drawPick(); };
  };
  const drawMatrix = () => {
    const fs = fees(), box = $('#cu-matrix', E);
    if (!fs.length) { box.innerHTML = `<div class="notice warn">${t('مفيش بنود مفعّلة للنوع ده في جدول الرسوم')}</div>`; return; }
    if (!S.persons.size) { box.innerHTML = `<div class="empty">${t('اختار الأشخاص من القائمة فوق')}</div>`; return; }
    const cell = (pid, f) => {
      const it = S.persons.get(pid).items, on = f.id in it, v = it[f.id];
      const input = f.options
        ? `<select data-amt="${esc(pid)}|${f.id}" ${on ? '' : 'disabled'}>${f.options.split(',').map(o => opt(o, o, Number(o) === Number(v))).join('')}</select>`
        : `<input type="number" step="0.001" min="0" data-amt="${esc(pid)}|${f.id}" value="${v ?? ''}" ${f.amount == null ? `placeholder="${esc(t('المبلغ'))}"` : ''} ${on ? '' : 'disabled'}>`;
      return `<td class="cu-cell ${on ? '' : 'off'}"><input type="checkbox" data-inc="${esc(pid)}|${f.id}" ${on ? 'checked' : ''}>${input}</td>`;
    };
    box.innerHTML = `<div class="table-wrap"><table class="data cu-matrix"><thead><tr><th>${t('الاسم')}</th>
        ${fs.map(f => `<th>${esc(f.name)}<div class="small muted">${f.options ? `<select data-all="${f.id}">${opt('', t('للكل…'), true)}${f.options.split(',').map(o => opt(o, o, false)).join('')}</select>` : f.amount != null ? rptNum(f.amount) : t('مفتوح')}</div></th>`).join('')}
        <th>${t('الإجمالي')}</th><th></th></tr></thead>
      <tbody>${[...S.persons.keys()].map(pid => { const p = info(pid); return `<tr><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.sub)}</div></td>
        ${fs.map(f => cell(pid, f)).join('')}<td class="num"><b data-rowtot="${esc(pid)}"></b></td><td><button type="button" class="btn sm danger" data-rm="${esc(pid)}">✕</button></td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td>${t('الإجمالي')} (${S.persons.size})</td>${fs.map(f => `<td class="num" data-coltot="${f.id}"></td>`).join('')}<td class="num"><b id="cu-grand"></b></td><td></td></tr></tfoot></table></div>`;
    translateDomText(box);
    const totals = () => {
      const val = v => (v === null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
      S.persons.forEach((p, pid) => { const el = $(`[data-rowtot="${CSS.escape(pid)}"]`, E); if (el) el.textContent = rptNum(sum(Object.values(p.items).map(val))); });
      fs.forEach(f => { $(`[data-coltot="${f.id}"]`, E).textContent = rptNum(sum([...S.persons.values()].map(p => (f.id in p.items ? val(p.items[f.id]) : 0)))); });
      $('#cu-grand', E).textContent = rptNum(sum([...S.persons.values()].flatMap(p => Object.values(p.items).map(val))));
    };
    $$('[data-inc]', box).forEach(cb => cb.onchange = () => {
      const [pid, fid] = cb.dataset.inc.split('|'), it = S.persons.get(pid).items;
      if (cb.checked) it[fid] = (fs.find(f => f.id === fid) || {}).amount ?? null; else delete it[fid];
      drawMatrix();
    });
    $$('[data-amt]', box).forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const [pid, fid] = inp.dataset.amt.split('|');
      S.persons.get(pid).items[fid] = inp.value === '' ? null : Number(inp.value);
      totals();
    }));
    $$('[data-all]', box).forEach(sel => sel.onchange = () => {
      if (!sel.value) return;
      S.persons.forEach(p => { if (sel.dataset.all in p.items) p.items[sel.dataset.all] = Number(sel.value); });
      drawMatrix();
    });
    $$('[data-rm]', box).forEach(b => b.onclick = () => { S.persons.delete(b.dataset.rm); drawPick(); drawMatrix(); });
    totals();
  };
  $('[name="txType"]', E).onchange = async (ev) => {
    if (S.persons.size && !await openConfirm(t('تغيير نوع المعاملة هيشيل الأشخاص والبنود اللي اخترتهم. تكمل؟'))) { ev.target.value = S.tx; return; }
    S.tx = ev.target.value; S.persons.clear(); S.quick = ''; drawPick(); drawMatrix();
  };
  $('#cu-q', E).addEventListener('input', debounce(drawPick, 200));
  drawPick(); drawMatrix();
  $$('[data-save]', E).forEach(b => b.onclick = async () => {
    const d = formValues($('#cu-form', E));
    if (!d.custodian) return openBlockAlert(t('اسم المستلم مطلوب'));
    const persons = [...S.persons.entries()].map(([pid, p]) => ({ id: pid, items: p.items })).filter(p => Object.keys(p.items).length);
    if (!persons.length) return openBlockAlert(t('اختار موظف واحد على الأقل وبند واحد على الأقل'));
    const open = persons.filter(p => Object.values(p.items).some(v => v === null || v === '')).length;
    if (open && !await openConfirm(`${t('فيه بنود من غير مبلغ (زي التصديقات) عند')} ${open} ${t('شخص — هتتحسب صفر في الطلب لحد ما تتكتب. تكمل؟')}`)) return;
    try {
      const res = await persist(old ? 'PUT' : 'POST', old ? `/api/custodies/${old.id}` : '/api/custodies', { ...d, txType: S.tx, persons }, 'تم الحفظ');
      m.close();
      const c = (STATE.custodies || []).find(x => x.id === (old ? old.id : res.id));
      if (!c) return;
      if (b.dataset.save === 'print') printCustodyRequest(c);
      openCustodyDetails(c.id);
    } catch (e) { /* persist عرض الخطأ */ }
  });
}

/* ---------- تفاصيل العهدة: الصرف والبنود ---------- */
function openCustodyDetails(id) {
  const m = openModal({ title: '💰', size: 'wide', body: '<div id="cu-d"></div>', foot: '<div id="cu-df" class="row" style="width:100%;gap:8px;flex-wrap:wrap"></div>' });
  const E = m.el;
  const draw = () => {
    const c = (STATE.custodies || []).find(x => x.id === id);
    if (!c) { m.close(); return; }
    const tt = custodyTotals(c), open = ['requested', 'disbursed'].includes(c.status), edit = open && can('custody.edit');
    $('.modal-head h2', E).innerHTML = `💰 ${t('عهدة')} ${esc(custodyNo(c))} — ${esc(custodyTypeLabel(c.txType))}`;
    const kv = (l, v) => `<div><span>${esc(t(l))}</span>${v || '<span class="muted">—</span>'}</div>`;
    const chip = (l, v, col) => `<span class="chip" style="font-size:13px;padding:4px 10px${col ? `;background:var(--${col}-soft);color:var(--${col})` : ''}">${esc(t(l))}: <b class="num">${v}</b></span>`;
    $('#cu-d', E).innerHTML = `<div class="kv">${kv('المستلم', `<b>${esc(c.custodian)}</b>`)}${kv('الحالة', custodyStatusChip(c.status))}${kv('تاريخ الطلب', fmtDate(c.requestDate))}
        ${kv('تاريخ الصرف', fmtDate(c.disbursedDate))}${kv('الشركة', esc(companyName(c.companyId)))}${kv('أعده', esc(c.createdBy))}${c.notes ? kv('ملاحظات', esc(c.notes)) : ''}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0">${chip('المطلوب', fmtMoney(tt.planned))}${chip('اتصرف', tt.received ? fmtMoney(tt.received) : '—', 'blue')}
        ${chip('اتنفّذ', fmtMoney(tt.spent))}${tt.received ? chip('الرصيد مع المستلم', fmtMoney(tt.remaining), tt.remaining < 0 ? 'red' : 'purple') : ''}${chip('جاهز للتقفيل', `${tt.ready}/${tt.persons}`, 'green')}</div>
      ${c.status === 'requested' ? `<div class="notice small">${t('اطبع الطلب واعتمده من المسؤول والإدارة المالية، وبعد الصرف اضغط «💵 تم الصرف» وسجّل المبلغ.')}</div>` : ''}
      <div class="small muted" style="margin:6px 0">${t('البند بيتعلّم «تم» لوحده لما مرحلة الشخص تعدّيه، وتقدر تعلّمه وتعدّل المبلغ الفعلي ورقم الإيصال بإيدك.')}</div>
      <div class="table-wrap"><table class="data cu-lines"><thead><tr><th style="width:34px">✓</th><th>${t('البند')}</th><th>${t('الجهة')}</th><th>${t('المحدد')}</th><th>${t('الفعلي')}</th><th>${t('رقم الإيصال')}</th><th>${t('تاريخ التنفيذ')}</th></tr></thead><tbody>
      ${custodyPersons(c).map(p => { const done = p.lines.every(l => l.done); return `<tr class="cu-person"><td colspan="7">${done ? '✅' : '⏳'} ${esc(p.name)}
          <span class="small muted">${esc(p.civilId || '')}${p.costCenter ? ' · ' + esc(p.costCenter) : ''}${p.companyId ? ' · ' + esc(companyName(p.companyId)) : ''}</span>
          <span class="small" style="float:inline-end">${p.lines.filter(l => l.done).length}/${p.lines.length} · ${fmtMoney(sum(p.lines.map(l => (l.done ? custodyLineAmount(l) : l.planned || 0))))}</span></td></tr>
        ${p.lines.map(l => `<tr><td><input type="checkbox" data-done="${l.id}" ${l.done ? 'checked' : ''} ${edit ? '' : 'disabled'}></td><td>${esc(l.itemName)}</td><td class="small muted">${esc(l.authority || '')}</td>
          <td class="num">${l.planned == null ? '<span class="muted">—</span>' : rptNum(l.planned)}</td>
          <td>${edit ? `<input type="number" step="0.001" min="0" data-actual="${l.id}" value="${l.actual ?? ''}" placeholder="${l.planned ?? ''}">` : (l.actual == null ? '—' : rptNum(l.actual))}</td>
          <td>${edit ? `<input class="cu-receipt" data-receipt="${l.id}" value="${esc(l.receiptNo || '')}">` : esc(l.receiptNo || '')}</td><td class="small num">${fmtDate(l.doneDate)}</td></tr>`).join('')}`; }).join('')}
      </tbody></table></div>`;
    const f = $('#cu-df', E);
    f.innerHTML = `<button class="btn" data-a="print">🖨️ ${t('طباعة طلب الصرف')}</button>
      ${edit ? `<button class="btn primary" data-a="disburse">💵 ${t(c.status === 'requested' ? 'تم الصرف' : 'تعديل الصرف')}</button>` : ''}
      ${edit && c.status === 'requested' ? `<button class="btn" data-a="edit">✏️ ${t('تعديل الطلب')}</button>` : ''}
      <span class="spacer"></span>
      ${c.status === 'requested' && can('custody.delete') ? `<button class="btn danger" data-a="cancel">🚫 ${t('إلغاء الطلب')}</button>` : ''}
      <button class="btn" data-close>${t('إغلاق')}</button>`;
    $('[data-close]', f).onclick = () => m.close();
    $$('[data-a]', f).forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'print') printCustodyRequest(c);
      else if (a === 'disburse') openCustodyDisburseModal(c, draw);
      else if (a === 'edit') { m.close(); openCustodyRequestModal(c.id); }
      else if (a === 'cancel' && await openConfirm(`${t('إلغاء طلب العهدة')} ${custodyNo(c)}؟`, { danger: true, okLabel: t('إلغاء الطلب') })) {
        await persist('POST', `/api/custodies/${c.id}/cancel`, {}, 'تم الإلغاء'); draw();
      }
    });
    translateDomText(E);
  };
  // تعديل البنود: كل تغيير بيتحفظ على طول، وبعدين الأرقام بتتحدّث
  const saveLine = async (lid, body) => { try { await persist('PUT', `/api/custodies/${id}/lines/${lid}`, body); } catch (e) { /* ظاهر */ } draw(); };
  E.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.done) saveLine(el.dataset.done, { done: el.checked });
    else if (el.dataset.actual) saveLine(el.dataset.actual, { actual: el.value === '' ? null : Number(el.value) });
    else if (el.dataset.receipt) saveLine(el.dataset.receipt, { receiptNo: el.value });
  });
  draw();
}
function openCustodyDisburseModal(c, after) {
  const m = openModal({
    title: `💵 ${t('تم الصرف')} — ${esc(custodyNo(c))}`, size: 'narrow',
    body: `<div class="form"><label class="full">${t('المبلغ اللي اتصرف (د.ك)')}<input type="number" step="0.001" min="0" name="amount" value="${c.disbursedAmount ?? c.requestedAmount ?? ''}"></label>
        <label class="full">${t('تاريخ الصرف')}<input type="date" name="date" value="${esc(c.disbursedDate || todayISO())}"></label></div>
      <div class="small muted" style="margin-top:6px">${t('المطلوب في الطلب')}: ${fmtMoney(c.requestedAmount)} — ${t('المستلم')}: ${esc(c.custodian)}</div>`,
    foot: `<button class="btn primary" data-save>💾 ${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues(m.el);
    if (d.amount === '' || d.amount == null) return openBlockAlert(t('اكتب المبلغ اللي اتصرف'));
    try { await persist('POST', `/api/custodies/${c.id}/disburse`, d, 'تم الحفظ'); m.close(); if (after) after(); } catch (e) { /* ظاهر */ }
  };
}

/* ---------- طباعة طلب صرف العهدة (نفس شكل التقارير) ---------- */
function printCustodyRequest(c) {
  const people = custodyPersons(c);
  const cols = [];
  (c.lines || []).forEach(l => { const k = l.feeItemId || l.itemName; if (!cols.some(x => x.key === k)) cols.push({ key: k, name: l.itemName, pos: l.position }); });
  cols.sort((a, b) => a.pos - b.pos);
  const amount = (p, col) => { const l = p.lines.find(x => (x.feeItemId || x.itemName) === col.key); return l ? (l.planned || 0) : null; };
  const cell = (p, col) => { const v = amount(p, col); return v === null ? '<td class="num muted">—</td>' : `<td class="num">${rptNum(v)}</td>`; };
  const total = p => sum(cols.map(col => amount(p, col) || 0));
  const groups = new Map();
  people.sort((a, b) => (a.costCenter || '').localeCompare(b.costCenter || '', 'ar') || (a.name || '').localeCompare(b.name || '', 'ar'))
    .forEach(p => { const k = p.costCenter || t('بدون مركز تكلفة'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  const totRow = (cls, label, ps) => `<tr class="${cls}"><td></td><td class="txt" colspan="2">${label}</td>${cols.map(col => `<td class="num">${rptNum(sum(ps.map(p => amount(p, col) || 0)))}</td>`).join('')}<td class="num">${rptNum(sum(ps.map(total)))}</td></tr>`;
  let n = 0, body = '';
  groups.forEach((ps, cc) => {
    if (groups.size > 1) body += `<tr class="grp"><td colspan="${cols.length + 4}">${esc(cc)}<small>${ps.length} ${t('شخص')}</small></td></tr>`;
    body += ps.map((p, i) => `<tr class="${i % 2 ? 'z' : ''}"><td class="idx">${++n}</td><td class="txt">${esc(p.name)}</td><td class="num">${esc(p.civilId || '')}</td>${cols.map(col => cell(p, col)).join('')}<td class="num"><b>${rptNum(total(p))}</b></td></tr>`).join('');
    if (groups.size > 1) body += totRow('sub', `${t('إجمالي')} ${esc(cc)}`, ps);
  });
  const table = `<table class="rpt"><thead><tr><th>#</th><th class="txt">${t('الاسم')}</th><th>${t('الرقم المدني')}</th>${cols.map(col => `<th class="num">${esc(col.name)}</th>`).join('')}<th class="num">${t('الإجمالي')} (${t('د.ك')})</th></tr></thead>
    <tbody>${body}</tbody><tfoot>${totRow('', `${t('الإجمالي العام')} (${people.length})`, people)}</tfoot></table>`;
  const coIds = uniq(people.map(p => p.companyId));
  const company = (c.companyId && IDX.company[c.companyId]) || (coIds.length === 1 ? IDX.company[coIds[0]] : null);
  openReportWindow({
    title: t('طلب صرف عهدة'), subtitle: custodyTypeLabel(c.txType), company, landscape: cols.length > 4,
    meta: [[t('رقم العهدة'), custodyNo(c)], [t('تاريخ الطلب'), fmtDate(c.requestDate)], [t('المستلم'), c.custodian]],
    criteria: `${t('نوع المعاملة')}: ${esc(custodyTypeLabel(c.txType))} · ${t('المستلم')}: ${esc(c.custodian)}${c.notes ? ' · ' + esc(c.notes) : ''}`,
    summary: [[people.length, t('عدد الأشخاص')], [groups.size, t('مراكز التكلفة')], [rptNum(sum(people.map(total))), t('إجمالي المطلوب (د.ك)')]],
    body: table, sign: [t('المستلم'), t('المسؤول'), t('الإدارة المالية')],
  });
}

/* ---------- جدول رسوم المعاملات ---------- */
function openFeeItemsModal(tx = 'renewal') {
  let cur = tx, rows = [], dirty = false;
  const m = openModal({ title: '⚙️ ' + t('جدول رسوم المعاملات'), size: 'wide', body: '<div id="fee-body"></div>',
    foot: `<button class="btn primary" data-save>💾 ${t('حفظ')}</button><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>` });
  const E = m.el;
  const load = () => { rows = (STATE.feeItems || []).filter(f => f.txType === cur).map(f => ({ ...f })); dirty = false; draw(); };
  const collect = () => $$('tr[data-i]', E).forEach(tr => {
    const r = rows[tr.dataset.i], g = k => $(`[data-f="${k}"]`, tr);
    Object.assign(r, { name: g('name').value, authority: g('authority').value, amount: g('amount').value === '' ? null : Number(g('amount').value),
      options: g('options').value, stage: g('stage').value, active: g('active').checked });
  });
  const draw = () => {
    const stages = custodyFlowStages(CUSTODY_TYPES[cur].flow);
    $('#fee-body', E).innerHTML = `<div class="tabs">${Object.entries(CUSTODY_TYPES).map(([k, v]) => `<button data-fee-tx="${k}" class="${k === cur ? 'active' : ''}">${esc(t(v.label))}</button>`).join('')}</div>
      <div class="notice small" style="margin:8px 0">${t('المبلغ الفاضي = مبلغ مفتوح بيتكتب لكل شخص (زي التصديقات). الاختيارات = مبالغ بيتختار منها (زي إذن العمل 60، 260، 360، 460). المرحلة = لما الشخص يعدّيها البند بيتعلّم «تم» لوحده. التعديل مابيأثرش على العهد القديمة.')}</div>
      <div class="table-wrap"><table class="data fee-tbl"><thead><tr><th>${t('البند')}</th><th>${t('الجهة')}</th><th>${t('المبلغ (د.ك)')}</th><th>${t('الاختيارات')}</th><th>${t('المرحلة')}</th><th>${t('مفعّل')}</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-i="${i}"><td><input data-f="name" value="${esc(r.name || '')}"></td><td><input data-f="authority" value="${esc(r.authority || '')}"></td>
        <td><input type="number" step="0.001" min="0" data-f="amount" value="${r.amount ?? ''}" placeholder="${esc(t('مفتوح'))}"></td>
        <td><input data-f="options" value="${esc(r.options || '')}" placeholder="60,260" dir="ltr"></td>
        <td><select data-f="stage">${opt('', '—', !r.stage)}${stages.map(s => opt(s.id, t(s.label), s.id === r.stage)).join('')}</select></td>
        <td><input type="checkbox" data-f="active" ${r.active !== false ? 'checked' : ''}></td><td><button type="button" class="btn sm danger" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="fee-add">➕ ${t('بند')}</button><span class="spacer"></span>
        <span class="small muted">${t('الإجمالي الافتراضي')}: <b>${rptNum(sum(rows.filter(r => r.active !== false).map(r => r.amount)))}</b> ${t('د.ك')}</span></div>`;
    translateDomText($('#fee-body', E));
    $$('[data-fee-tx]', E).forEach(b => b.onclick = async () => {
      collect();
      if (dirty && !await openConfirm(t('فيه تعديلات ماتحفظتش في الجدول ده. تسيبها وتفتح التاني؟'))) return;
      cur = b.dataset.feeTx; load();
    });
    $('#fee-add', E).onclick = () => { collect(); rows.push({ name: '', authority: '', amount: null, options: '', stage: '', active: true }); dirty = true; draw(); };
    $$('[data-del]', E).forEach(b => b.onclick = () => { collect(); rows.splice(Number(b.dataset.del), 1); dirty = true; draw(); });
    $('#fee-body', E).addEventListener('input', () => { dirty = true; }, { once: true });
  };
  $('[data-save]', E).onclick = async () => {
    collect();
    try { await persist('PUT', `/api/fee-items/${cur}`, { items: rows }, 'تم الحفظ'); load(); } catch (e) { /* ظاهر */ }
  };
  load();
}

/** بطاقة الموظف: عهده (المستندات والتواريخ) */
function custodyPersonHtml(kind, id) {
  if (!can('custody.view')) return '';
  const rows = (STATE.custodies || []).filter(c => c.status !== 'cancelled')
    .map(c => ({ c, ls: (c.lines || []).filter(l => l.personKind === kind && l.personId === id) })).filter(x => x.ls.length);
  if (!rows.length) return '';
  return `<h4>💰 ${t('العهد')}</h4><table class="data"><thead><tr><th>${t('العهدة')}</th><th>${t('النوع')}</th><th>${t('المستلم')}</th><th>${t('البنود')}</th><th>${t('المبلغ')}</th><th>${t('الحالة')}</th></tr></thead><tbody>
    ${rows.map(({ c, ls }) => `<tr class="clickable" data-cu="${c.id}"><td class="num">${esc(custodyNo(c))}</td><td>${esc(custodyTypeLabel(c.txType))}</td><td>${esc(c.custodian)}</td>
      <td>${ls.filter(l => l.done).length}/${ls.length}</td><td class="num">${fmtMoney(sum(ls.map(l => (l.done ? custodyLineAmount(l) : l.planned || 0))))}</td><td>${custodyStatusChip(c.status)}</td></tr>`).join('')}</tbody></table>`;
}
