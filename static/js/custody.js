/* =====================================================================
   CUSTODY — العهد والمصروفات (custody.py على السيرفر)
   الفلوس من الشركة المُصدِرة (أبراج انرجي — «إعدادات الفواتير»):
   طلب (بيتطبع ويتعتمد ورقي من المسؤول والإدارة المالية) ← «تم الصرف» (المبلغ وتاريخه) ← البنود بتتعلّم «تم»
   لوحدها مع مراحل المعاملة / التسجيل (والمبلغ الفعلي بيتعدّل) ← التقفيل ← فاتورة لكل مركز تكلفة (الرسوم + الدعم
   الإداري) ← «اعتمدتها الحسابات» (بعدها التقفيل مايتلغيش)
   ===================================================================== */
'use strict';

// نفس custody.TX_TYPES على السيرفر
// kuwaiti: true = العمالة الوطنية بس (الكويتيين ومعاملة كويتية)، false = من غيرهم
const CUSTODY_TYPES = {
  renewal:           { label: 'تجديد إقامة',                   kind: 'employee',  flow: 'gov',      kuwaiti: false },
  transfer_in:       { label: 'تحويل إقامة من الداخل',         kind: 'employee',  flow: 'gov',      kuwaiti: false },
  transfer_out:      { label: 'تحويل إقامة من الخارج',         kind: 'candidate', flow: 'internal', source: 'internal' },
  visa:              { label: 'إصدار تأشيرة عمل',              kind: 'candidate', flow: 'outside',  source: 'outside' },
  first_residency:   { label: 'إصدار إقامة أول مرة',           kind: 'candidate', flow: 'outside',  source: 'outside' },
  kw_permit_new:     { label: 'إصدار إذن عمل — عمالة وطنية',   kind: 'candidate', flow: 'kuwaiti',  source: 'kuwaiti', kuwaiti: true },
  kw_permit_renewal: { label: 'تجديد إذن عمل — عمالة وطنية',   kind: 'employee',  flow: 'gov',      kuwaiti: true },
  // بعد تجديد الجواز: رسوم البطاقة المدنية (بند من غير مرحلة ← «تم» يدوي). doc = التاريخ اللي بيظهر جنب الموظف
  passport_transfer: { label: 'نقل بيانات الجواز',             kind: 'employee',  flow: 'gov',      kuwaiti: false, doc: 'passportExp' },
};
const INVOICE_STATUS = { pending: ['بانتظار الحسابات', 'orange'], approved: ['اعتمدتها الحسابات', 'green'] };
// بند التجديد بيحدّث تاريخ في بيانات الموظف (نفس custody.EXPIRY_FIELDS) ← الانتهاء الجديد بيتسجّل عليه قبل التقفيل
const CUSTODY_EXPIRY_FIELDS = { residencyExp: 'الإقامة', workPermitExp: 'إذن العمل', healthCardExp: 'البطاقة الصحية' };
function isoLocal(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
function addYearsISO(iso, n) { const [y, m, d] = String(iso).split('-').map(Number); return isoLocal(new Date(y + n, m - 1, d)); }
/** الأساس لـ «+1 سنة»: التاريخ وقت الطلب، وإلا اللي في بيانات الموظف دلوقتي */
function custodyExpiryBase(l) { return l.oldExpiry || ((IDX.employee[l.personId] || {})[l.updatesField]) || ''; }
function invoiceStatusChip(inv) {
  const [l, col] = INVOICE_STATUS[inv.status] || [inv.status, 'grey'];
  return `<span class="chip" style="background:var(--${col}-soft);color:var(--${col})">${esc(t(l))}${inv.status === 'approved' && inv.approvedDate ? ' · ' + fmtDate(inv.approvedDate) : ''}</span>`;
}
/** إعدادات الفواتير: الشركة المُصدِرة، الدعم الإداري الافتراضي، ومراكز التكلفة اللي مالهاش دعم */
function custodySettings() { return STATE.custodySettings || { issuerCompanyId: null, supportFee: 20, noSupportCostCenters: [] }; }
const custodyNoSupport = cc => (custodySettings().noSupportCostCenters || []).includes(cc || '');
const CUSTODY_STATUS = { requested: ['مطلوبة', 'orange'], disbursed: ['تم الصرف', 'blue'], closed: ['مقفولة', 'green'], cancelled: ['ملغاة', 'grey'] };
/* ⚡ التقفيل المباشر (c.direct): إجراء اتصرف عليه من فلوس عهدة مع المستلم لشخص مش في أي طلب — اتسجّل واتقفل في خطوة
   واحدة من غير صرف. مبلغه (c.dueAmount) مستحق للمستلم لحد ما يتضاف على طلب عهدة له (c.carryToId / carryToNumber)
   والطلب ده يتصرف (c.carryFunded). والطلب نفسه شايل c.carried = [{id, number, amount}] و c.carriedAmount. */
const custodyDirectTag = c => (c.carryToNumber
  ? `<span class="small muted">↪ ${t('اتضاف لطلب')} <b class="num">${esc(c.carryToNumber)}</b>${c.carryFunded ? ' ✓' : ''}</span>`
  : c.status === 'cancelled' ? '' : `<span class="small" style="color:var(--orange)">⏳ ${t('لسه مااتضافش لطلب')}</span>`);

/** رقم العهدة: رمز صاحبها وقت الطلب + مسلسله «AA-0001» (custody.custody_no على السيرفر) */
function custodyNo(c) { return c.number || 'CUS-' + String(c.no).padStart(4, '0'); }
/** العهد اللي ظاهرة في الشاشة: السيرفر بيبعت عهد المستخدم بس، وصاحب «عرض عهد كل المستخدمين» بيختار (عهدي / الكل / مستخدم) */
function custodySeeAll() { return can('custody.all'); }
function custodiesInView() {
  const all = STATE.custodies || [], o = UI.custody.owner || 'me';
  if (!custodySeeAll() || o === 'all') return all;
  const uid = String(o === 'me' ? STATE.me.id : o);
  return all.filter(c => String(c.ownerId) === uid);
}
function invoicesInView() { const ids = new Set(custodiesInView().map(c => c.id)); return (STATE.invoices || []).filter(i => ids.has(i.custodyId)); }
/** لغة ملفات العهد (الفواتير، الملخص، طلب الصرف): آخر اختيار، وإلا الافتراضي من «إعدادات الفواتير» */
const CUSTODY_LANGS = [['ar', 'عربي'], ['en', 'English'], ['both', 'ثنائي اللغة']];
function custodyDocLang() { const v = lsGet('mv_cuDocLang'); return ['ar', 'en', 'both'].includes(v) ? v : custodySettings().docLang || 'both'; }
function custodyLangSelect() {
  return `<label class="row small cu-lang" style="gap:6px">📄 ${t('لغة الملفات')}<select data-cu-lang>${CUSTODY_LANGS.map(([k, l]) => opt(k, t(l), k === custodyDocLang())).join('')}</select></label>`;
}
function bindCustodyLang(root) { $$('[data-cu-lang]', root).forEach(s => s.onchange = () => { lsSet('mv_cuDocLang', s.value); $$('[data-cu-lang]').forEach(x => { x.value = s.value; }); }); }
/** معاينة كشف عهدة PDF بلغة الملفات (مابيتنزّلش) */
async function custodyPreview(url) {
  if (!STATE.sheetPdfAvailable) return openBlockAlert(t('معاينة كشوف العهد محتاجة Microsoft Excel أو LibreOffice على السيرفر.'));
  toast(t('جاري تجهيز المعاينة…'));
  try {
    const r = await fetchBlob(url + (url.includes('?') ? '&' : '?') + 'lang=' + custodyDocLang());
    openPdfPreviewModal(r.blob, r.name, 1, 'custody');
  } catch (e) { toast(e.message, 'err'); }
}
function custodyTypeLabel(tx) { return t((CUSTODY_TYPES[tx] || { label: tx }).label); }
function custodyStatusChip(st) {
  const [l, col] = CUSTODY_STATUS[st] || [st, 'grey'];
  return `<span class="chip" style="background:var(--${col}-soft);color:var(--${col})">${esc(t(l))}</span>`;
}
/** حالة العهدة — التقفيل المباشر اللي تقفيله اتلغى مالوش «تم الصرف» */
function custodyChip(c) {
  return c.direct && c.status === 'disbursed' ? `<span class="chip" style="background:var(--orange-soft);color:var(--orange)">${esc(t('تقفيله اتلغى'))}</span>` : custodyStatusChip(c.status);
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
/** المطلوب، المصروف للمستلم، المنفّذ فعلًا (البنود «تم»)، الرصيد، والإجراءات الجاهزة للتقفيل («تم» ولسه ماتقفلتش) */
function custodyTotals(c) {
  const ls = c.lines || [], people = custodyPersons(c);
  const spent = sum(ls.filter(l => l.done).map(custodyLineAmount));
  const funded = ['disbursed', 'closed'].includes(c.status);
  // gross = اللي اتصرف فعلًا. received = اللي يخص العهدة دي: الطلب ناقص مستحقات التقفيل المباشر المضافة عليه، والتقفيل
  // المباشر مابياخدش حاجة لحد ما الطلب اللي اتضاف عليه يتصرف (قبلها مبلغه بالسالب = مستحق للمستلم)
  const gross = !c.direct && funded ? (c.disbursedAmount || 0) : 0;
  const received = c.direct ? (funded && c.carryFunded ? spent : 0) : funded ? gross - (c.carriedAmount || 0) : 0;
  const closed = people.filter(p => p.lines.every(l => l.closedDate));
  return { planned: (c.direct ? c.dueAmount : null) ?? c.requestedAmount ?? sum(ls.map(l => l.planned)), received, gross, spent, remaining: received - spent,
    due: c.direct && funded && !c.carryFunded ? spent : 0,
    persons: people.length, ready: ls.filter(l => l.done && !l.closedDate).length,
    closed: closed.length, itemsDone: ls.filter(l => l.done).length, items: ls.length, itemsClosed: ls.filter(l => l.closedDate).length };
}
/** أرصدة المستلمين: اتصرف له كام، ونفّذ كام، والباقي معاه (العهد اللي اتصرفت بس) */
function custodianBalances() {
  const by = {};
  custodiesInView().filter(c => c.status !== 'cancelled').forEach(c => {
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
  const U = UI.custody = Object.assign({ tab: 'list', q: '', status: '', type: '', custodian: '', iq: '', istatus: '', icc: '', owner: 'me' }, UI.custody || {});
  if (U.tab === 'expenses' && !can('custody.expenses')) U.tab = 'list';
  const exTab = U.tab === 'expenses';            // 📊 لوحة المصروفات (expenses.js): كل العهد في النطاق — ليها مؤشراتها
  const all = custodiesInView();
  const open = all.filter(c => c.status === 'disbursed').map(custodyTotals);
  // تقفيل مباشر مقفول ولسه مااتعوّضش ← المستلم صرفه من فلوس عهدة مفتوحة معاه
  const dues = sum(all.filter(c => c.direct && c.status === 'closed').map(c => custodyTotals(c).due));
  const pending = invoicesInView().filter(i => i.status === 'pending');
  const owners = STATE.custodyUsers || [];
  const kpi = [[all.filter(c => c.status === 'requested').length, 'طلبات لسه ماتصرفتش', 'orange'], [open.length, 'عهد مفتوحة', 'blue'],
    [fmtMoney(sum(open.map(x => x.received))), 'اتصرف للمستلمين', ''], [fmtMoney(sum(open.map(x => x.spent))), 'اتنفّذ فعلًا', ''],
    [fmtMoney(sum(open.map(x => x.remaining)) - dues), 'الرصيد مع المستلمين', 'purple'], [sum(open.map(x => x.ready)), 'إجراء جاهز للتقفيل', 'green'],
    [`${pending.length} · ${fmtMoney(sum(pending.map(i => i.total)))}`, 'فواتير بانتظار الحسابات', 'orange']];
  viewRoot().innerHTML = `<div class="page-head"><div><h1>${t('العهد والمصروفات')}</h1><div class="sub">${all.length} ${t('عهدة')}</div></div>
    <div class="actions">${custodySeeAll() ? `<select id="cu-owner" title="${esc(t('عهد مين'))}">${opt('me', '👤 ' + t('عهدي أنا'), U.owner === 'me')}${opt('all', '👥 ' + t('كل المستخدمين'), U.owner === 'all')}
        ${owners.filter(u => String(u.id) !== String(STATE.me.id)).map(u => opt(String(u.id), `${u.name}${u.code ? ' · ' + u.code : ''}`, String(U.owner) === String(u.id))).join('')}</select>` : ''}
      <button class="btn primary write-only" data-p="custody.edit" id="cu-add">➕ ${t('طلب عهدة')}</button>
      <button class="btn write-only" data-p="custody.edit custody.direct" id="cu-direct" title="${esc(t('إجراء اتصرف عليه من فلوس عهدة لشخص مش في أي طلب'))}">🔒 ${t('تقفيل عهدة')}</button>
      <button class="btn" id="cu-plan">📅 ${t('خطة التجديدات')}</button>
      <button class="btn" data-p="custody.fees" id="cu-fees">⚙️ ${t('جدول الرسوم')}</button>
      <button class="btn" data-p="custody.fees" id="cu-set">🧾 ${t('إعدادات الفواتير')}</button></div></div>
    ${exTab ? '' : `<div class="cu-kpis">${kpi.map(([v, l, c]) => `<div class="card cu-kpi"${c ? ` style="border-top:3px solid var(--${c})"` : ''}><b class="num">${esc(v)}</b><span>${esc(t(l))}</span></div>`).join('')}</div>`}
    <div class="tabs" style="margin:14px 0 10px">${[['list', 'العهد'], ['invoices', 'الفواتير'], ['balances', 'أرصدة المستلمين'], ...(can('custody.expenses') ? [['expenses', '📊 المصروفات']] : [])].map(([k, l]) => `<button data-cutab="${k}" class="${U.tab === k ? 'active' : ''}">${esc(t(l))}${k === 'invoices' && pending.length ? ` <span class="cu-badge">${pending.length}</span>` : ''}</button>`).join('')}</div>
    <div id="cu-pane">${exTab ? expensesHtml() : U.tab === 'balances' ? custodyBalancesHtml() : U.tab === 'invoices' ? custodyInvoicesHtml() : custodyListHtml()}</div>`;
  const upd = p => { Object.assign(UI.custody, p); saveUiStateToLocalStorage(); render(); };
  $$('[data-cutab]').forEach(b => b.onclick = () => upd({ tab: b.dataset.cutab }));
  const add = $('#cu-add'); if (add) add.onclick = () => openCustodyRequestModal();
  const dir = $('#cu-direct'); if (dir) dir.onclick = () => openCustodyRequestModal(null, { direct: true });
  $('#cu-plan').onclick = () => openRenewalPlanModal();
  const fees = $('#cu-fees'); if (fees) fees.onclick = () => openFeeItemsModal();
  const set = $('#cu-set'); if (set) set.onclick = () => openCustodySettingsModal();
  const own = $('#cu-owner'); if (own) own.onchange = e => upd({ owner: e.target.value, custodian: '' });
  bindCustodyLang(viewRoot());
  if (exTab) return bindExpenses();
  if (U.tab === 'invoices') {
    const iq = $('#cif-q');
    iq.addEventListener('input', debounce(e => { UI.custody.iq = e.target.value; render(); const i = $('#cif-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250));
    $('#cif-status').onchange = e => upd({ istatus: e.target.value });
    $('#cif-cc').onchange = e => upd({ icc: e.target.value });
    $('#cif-clear').onclick = () => upd({ iq: '', istatus: '', icc: '' });
    bindInvoiceActions(viewRoot(), render);
    $$('tr[data-inv-cu]').forEach(tr => tr.onclick = ev => { if (!ev.target.closest('button')) openCustodyDetails(tr.dataset.invCu); });
    return;
  }
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
  const showOwner = custodySeeAll() && U.owner !== 'me';
  const list = custodiesInView().filter(c => (!U.status || (U.status === 'direct' ? c.direct : c.status === U.status)) && (!U.type || c.txType === U.type)
    && (!U.custodian || c.custodian === U.custodian)
    && (!q || [c.custodian, custodyNo(c), c.ownerName, c.notes, ...(c.lines || []).flatMap(l => [l.personName, l.civilId])].some(v => norm(v).includes(q))));
  return `<div class="filters"><input type="search" id="cuf-q" placeholder="${esc(t('بحث بالرقم أو المستلم أو اسم موظف…'))}" value="${esc(U.q)}">
      <select id="cuf-status">${opt('', t('— كل الحالات —'), !U.status)}${Object.entries(CUSTODY_STATUS).map(([k, [l]]) => opt(k, t(l), k === U.status)).join('')}${opt('direct', '⚡ ' + t('تقفيل مباشر'), U.status === 'direct')}</select>
      <select id="cuf-type">${opt('', t('— كل الأنواع —'), !U.type)}${Object.entries(CUSTODY_TYPES).map(([k, v]) => opt(k, t(v.label), k === U.type)).join('')}</select>
      <select id="cuf-cust">${opt('', t('— كل المستلمين —'), !U.custodian)}${uniq(custodiesInView().map(c => c.custodian)).sort().map(x => opt(x, x, x === U.custodian)).join('')}</select>
      <button class="btn sm ghost" id="cuf-clear">✕ ${t('مسح الفلاتر')}</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('الرقم')}</th>${showOwner ? `<th>${t('صاحب العهدة')}</th>` : ''}<th>${t('النوع')}</th><th>${t('المستلم')}</th><th>${t('الأشخاص')}</th>
      <th>${t('المطلوب')}</th><th>${t('اتصرف')}</th><th>${t('اتنفّذ')}</th><th>${t('الرصيد')}</th><th>${t('البنود')}</th><th>${t('الحالة')}</th><th>${t('تاريخ الطلب')}</th></tr></thead><tbody>
    ${list.map(c => { const tt = custodyTotals(c); return `<tr class="clickable" data-cu="${c.id}"><td class="nowrap"><b class="num">${esc(custodyNo(c))}</b>${c.direct ? `<div class="small"><span class="chip">⚡ ${t('تقفيل مباشر')}</span></div><div>${custodyDirectTag(c)}</div>`
        : (c.carried || []).length ? `<div class="small muted" title="${esc(t('مستحقات تقفيل مباشر مضافة على الطلب'))}">⚡ + ${esc(c.carried.map(x => x.number).join('، '))}</div>` : ''}</td>${showOwner ? `<td class="small">${esc(c.ownerName || '—')}</td>` : ''}<td>${esc(custodyTypeLabel(c.txType))}</td>
      <td>${esc(c.custodian)}</td><td class="num">${tt.persons}${tt.ready ? ` <span class="small" style="color:var(--green)" title="${esc(t('إجراء جاهز للتقفيل'))}">(✓ ${tt.ready})</span>` : ''}</td>
      <td class="num">${fmtMoney(tt.planned)}</td><td class="num">${tt.gross ? fmtMoney(tt.gross) : '—'}</td><td class="num">${fmtMoney(tt.spent)}</td>
      <td class="num" style="${tt.remaining < 0 ? 'color:var(--red)' : ''}"${tt.due ? ` title="${esc(t('مستحق للمستلم — بيتضاف على أقرب طلب عهدة له'))}"` : ''}>${tt.gross || tt.due ? fmtMoney(tt.remaining) : '—'}</td>
      <td><div class="small">${tt.itemsDone}/${tt.items}</div><div class="progress" style="width:80px"><i style="width:${tt.items ? 100 * tt.itemsDone / tt.items : 0}%"></i></div></td>
      <td>${custodyChip(c)}</td><td class="num small">${fmtDate(c.requestDate)}</td></tr>`; }).join('') || `<tr><td colspan="12" class="empty">${t('لا توجد عهد')}</td></tr>`}
    </tbody></table></div>`;
}
function custodyBalancesHtml() {
  const rows = custodianBalances();
  return `<div class="notice small" style="margin-bottom:8px">${t('الرصيد = اللي اتصرف للمستلم − اللي اتنفّذ فعلًا (البنود اللي «تم»). الطلبات اللي لسه ماتصرفتش مش محسوبة.')} ${t('التقفيل المباشر بينقّص رصيد المستلم لحد ما الطلب اللي اتضاف عليه مبلغه يتصرف.')}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('المستلم')}</th><th>${t('اتصرف له')}</th><th>${t('اتنفّذ')}</th><th>${t('الرصيد معاه')}</th><th>${t('عهد مفتوحة')}</th><th>${t('طلبات لسه ماتصرفتش')}</th></tr></thead><tbody>
    ${rows.map(b => `<tr class="clickable" data-cust="${esc(b.name)}"><td><b>${esc(b.name)}</b></td><td class="num">${fmtMoney(b.received)}</td><td class="num">${fmtMoney(b.spent)}</td>
      <td class="num" style="font-weight:700;${b.remaining < 0 ? 'color:var(--red)' : ''}">${fmtMoney(b.remaining)}</td><td class="num">${b.open}</td><td class="num">${b.requested}</td></tr>`).join('')
      || `<tr><td colspan="6" class="empty">${t('لا توجد عهد')}</td></tr>`}
    </tbody>${rows.length ? `<tfoot><tr><td>${t('الإجمالي')}</td><td class="num">${fmtMoney(sum(rows.map(b => b.received)))}</td><td class="num">${fmtMoney(sum(rows.map(b => b.spent)))}</td>
      <td class="num"><b>${fmtMoney(sum(rows.map(b => b.remaining)))}</b></td><td class="num">${sum(rows.map(b => b.open))}</td><td class="num">${sum(rows.map(b => b.requested))}</td></tr></tfoot>` : ''}</table></div>`;
}

/* ---------- الفواتير: فاتورة لكل مركز تكلفة في كل تقفيل ---------- */
function custodyInvoicesHtml() {
  const U = UI.custody, q = norm(U.iq), all = invoicesInView();
  const cus = Object.fromEntries((STATE.custodies || []).map(c => [c.id, c]));
  const list = all.filter(i => (!U.istatus || i.status === U.istatus) && (!U.icc || (i.costCenter || '') === U.icc)
    && (!q || [i.number, i.ccCode, i.closingRef, i.createdBy, i.costCenter, companyName(i.billCompanyId), cus[i.custodyId] && custodyNo(cus[i.custodyId]), cus[i.custodyId] && cus[i.custodyId].custodian].some(v => norm(v).includes(q))));
  return `<div class="filters"><input type="search" id="cif-q" placeholder="${esc(t('بحث برقم الفاتورة أو مركز التكلفة أو العهدة…'))}" value="${esc(U.iq)}">
      <select id="cif-status">${opt('', t('— كل الحالات —'), !U.istatus)}${Object.entries(INVOICE_STATUS).map(([k, [l]]) => opt(k, t(l), k === U.istatus)).join('')}</select>
      <select id="cif-cc">${opt('', t('— كل مراكز التكلفة —'), !U.icc)}${uniq(all.map(i => i.costCenter || '')).sort().map(x => opt(x, x || t('بدون مركز تكلفة'), x === U.icc)).join('')}</select>
      <button class="btn sm ghost" id="cif-clear">✕ ${t('مسح الفلاتر')}</button><span class="spacer"></span>${custodyLangSelect()}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>${t('رقم الفاتورة')}</th><th>${t('التاريخ')}</th><th>${t('فاتورة إلى')}</th><th>${t('العهدة')}</th><th>${t('التقفيل')}</th><th>${t('الموظفين')}</th>
      <th>${t('الرسوم الحكومية')}</th><th>${t('الدعم الإداري')}</th><th>${t('الإجمالي')}</th><th>${t('الحالة')}</th><th></th></tr></thead><tbody>
    ${list.map(i => { const c = cus[i.custodyId]; return `<tr class="clickable" data-inv-cu="${esc(i.custodyId)}"><td class="num nowrap"><b>${esc(i.number)}</b></td><td class="num small nowrap">${fmtDate(i.closingDate)}</td>
      <td>${i.ccCode ? `<span class="chip on num">${esc(i.ccCode)}</span> ` : ''}${esc(i.costCenter || t('بدون مركز تكلفة'))}<div class="small muted">${esc(companyName(i.billCompanyId) || '')}</div></td>
      <td class="small">${c ? `${esc(custodyNo(c))} · ${esc(custodyTypeLabel(c.txType))}<div class="muted">${esc(c.custodian)}</div>` : '—'}</td>
      <td class="small nowrap"><b class="num">${esc(i.closingRef || '—')}</b><div class="muted">${esc(i.createdBy || '')}</div></td>
      <td class="num">${i.employees}</td><td class="num">${fmtMoney(i.govAmount)}</td><td class="num">${i.supportAmount ? fmtMoney(i.supportAmount) : '<span class="muted">—</span>'}</td>
      <td class="num nowrap"><b>${fmtMoney(i.total)}</b></td><td>${invoiceStatusChip(i)}</td><td class="nowrap">${invoiceButtons(i)}</td></tr>`; }).join('')
      || `<tr><td colspan="11" class="empty">${t('لا توجد فواتير — الفواتير بتطلع لما تقفل عهدة')}</td></tr>`}
    </tbody>${list.length ? `<tfoot><tr><td colspan="5">${t('الإجمالي')} (${list.length})</td><td class="num">${sum(list.map(i => i.employees))}</td><td class="num">${fmtMoney(sum(list.map(i => i.govAmount)))}</td>
      <td class="num">${fmtMoney(sum(list.map(i => i.supportAmount)))}</td><td class="num"><b>${fmtMoney(sum(list.map(i => i.total)))}</b></td><td colspan="2"></td></tr></tfoot>` : ''}</table></div>`;
}
/** أزرار الفاتورة: معاينة وطباعة، «اعتمدتها الحسابات» أو الرجوع عنها */
function invoiceButtons(i) {
  return `<button class="btn sm" data-inv-dl="${i.id}" title="${esc(t('معاينة وطباعة'))} — ${esc(i.number)}">📄 ${t('معاينة')}</button>
    ${i.status === 'pending' && can('custody.edit') ? `<button class="btn sm primary" data-inv-ok="${i.id}">✅ ${t('اعتمدتها الحسابات')}</button>` : ''}
    ${i.status === 'approved' && can('custody.delete') ? `<button class="btn sm ghost" data-inv-undo="${i.id}" title="${esc(t('إلغاء اعتماد الحسابات'))}">↩️</button>` : ''}`;
}
function bindInvoiceActions(root, after) {
  const find = id => (STATE.invoices || []).find(i => i.id === id);
  $$('[data-inv-dl]', root).forEach(b => b.onclick = ev => { ev.stopPropagation(); custodyPreview(`/api/invoices/${b.dataset.invDl}.pdf`); });
  $$('[data-inv-ok]', root).forEach(b => b.onclick = ev => { ev.stopPropagation(); openInvoiceApproveModal(find(b.dataset.invOk), after); });
  $$('[data-inv-undo]', root).forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    const i = find(b.dataset.invUndo);
    if (!i || !await openConfirm(`${t('إلغاء اعتماد الحسابات للفاتورة')} ${i.number}؟ ${t('هترجع «بانتظار الحسابات».')}`, { danger: true, okLabel: t('إلغاء الاعتماد') })) return;
    try { await persist('POST', `/api/invoices/${i.id}/unapprove`, {}, 'تم'); } catch (e) { /* ظاهر */ }
    after();
  });
}
function openInvoiceApproveModal(i, after) {
  if (!i) return;
  const m = openModal({
    title: `✅ ${t('اعتمدتها الحسابات')} — ${esc(i.number)}`, size: 'narrow',
    body: `<div class="kv">${[['فاتورة إلى', esc(i.costCenter || t('بدون مركز تكلفة'))], ['الإجمالي', `<b>${fmtMoney(i.total)}</b>`], ['تاريخ الفاتورة', fmtDate(i.closingDate)]]
        .map(([l, v]) => `<div><span>${esc(t(l))}</span>${v}</div>`).join('')}</div>
      <div class="form" style="margin-top:10px"><label class="full">${t('تاريخ الاعتماد')}<input type="date" name="date" value="${todayISO()}"></label></div>
      <div class="notice warn small" style="margin-top:8px">${t('بعد اعتماد الحسابات الفاتورة بتبقى نهائية، والتقفيل اللي طلعت منه مايتلغيش.')}</div>`,
    foot: `<button class="btn primary" data-save>✅ ${t('اعتماد')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    try { await persist('POST', `/api/invoices/${i.id}/approve`, formValues(m.el), 'تم الاعتماد'); m.close(); after(); } catch (e) { /* ظاهر */ }
  };
}
function openCustodySettingsModal() {
  const st = custodySettings(), ccs = (STATE.costCenters || []).map(c => c.name).sort((a, b) => a.localeCompare(b, 'ar'));
  const m = openModal({
    title: '🧾 ' + t('إعدادات الفواتير'),
    body: `<div class="form" id="cs-form">
        <label class="full">${t('الشركة المُصدِرة (شعارها واسمها على طلب الصرف والفواتير)')}<select name="issuerCompanyId">${companyOptions(st.issuerCompanyId || '')}</select></label>
        <label>${t('الدعم الإداري لكل موظف (د.ك)')}<input type="number" step="0.001" min="0" name="supportFee" value="${esc(st.supportFee ?? 20)}"></label>
        <label>${t('لغة ملفات العهد (الافتراضي)')}<select name="docLang">${CUSTODY_LANGS.map(([k, l]) => opt(k, t(l), k === (st.docLang || 'both'))).join('')}</select></label></div>
      <h4 class="cu-h">${t('مراكز تكلفة من غير دعم إداري')} <span class="small muted">(${t('موظفين الشركة المُصدِرة نفسها')})</span></h4>
      <div class="cu-pick-list" style="max-height:260px">${ccs.map(cc => `<label class="${st.noSupportCostCenters.includes(cc) ? 'on' : ''}"><input type="checkbox" data-nosup="${esc(cc)}" ${st.noSupportCostCenters.includes(cc) ? 'checked' : ''}><b>${esc(cc)}</b>
        <span class="small muted">${esc(((STATE.costCenters || []).find(c => c.name === cc) || {}).nameEn || '')}</span></label>`).join('') || `<div class="empty">${t('لا توجد مراكز تكلفة')}</div>`}</div>
      <div class="notice small" style="margin-top:8px">${t('الدعم الإداري بيتحسب مرة لكل موظف في الفاتورة، وبيتعدّل وقت التقفيل. التعديل مابيأثرش على الفواتير اللي طلعت.')}</div>`,
    foot: `<button class="btn primary" data-save>💾 ${t('حفظ')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $$('[data-nosup]', m.el).forEach(cb => cb.onchange = () => cb.closest('label').classList.toggle('on', cb.checked));
  $('[data-save]', m.el).onclick = async () => {
    const d = formValues($('#cs-form', m.el));
    try {
      await persist('PUT', '/api/custody-settings', { ...d, noSupportCostCenters: $$('[data-nosup]', m.el).filter(x => x.checked).map(x => x.dataset.nosup) }, 'تم الحفظ');
      m.close();
    } catch (e) { /* ظاهر */ }
  };
}

/* ---------- طلب عهدة (جديد أو تعديل قبل الصرف) ---------- */
function openCustodyRequestModal(id = null, preset = null) {
  const old = id ? (STATE.custodies || []).find(c => c.id === id) : null;
  // 🔒 تقفيل عهدة مباشر (preset.direct): نفس النافذة — الإجراءات اللي اتعملت بمبالغها الفعلية ← بتتقفل وتطلع فواتيرها على طول
  const direct = !old && !!(preset && preset.direct);
  // id ← {items: {رقم البند: المبلغ}، وللتقفيل المباشر: receipts: {البند: رقم الإيصال}، expiries: {البند: الانتهاء الجديد}}
  const S = { tx: old ? old.txType : (preset && preset.tx) || 'renewal', persons: new Map(), quick: '', dues: new Map() };
  const extra = (pid, k) => { const p = S.persons.get(pid); return p[k] || (p[k] = {}); };
  const snap = {};                                                                  // بيانات الشخص من العهدة القديمة
  if (old) custodyPersons(old).forEach(p => { snap[p.id] = p; S.persons.set(p.id, { items: Object.fromEntries(p.lines.map(l => [l.feeItemId, l.planned])) }); });
  if (!old && preset) (preset.persons || []).forEach(p => S.persons.set(p.id, { items: { ...p.items } }));   // من خطة التجديدات
  const fees = () => (STATE.feeItems || []).filter(f => f.txType === S.tx && f.active);
  const defaults = () => Object.fromEntries(fees().map(f => [f.id, f.amount ?? null]));
  const m = openModal({
    title: direct ? '🔒 ' + t('تقفيل عهدة مباشر') : old ? `✏️ ${t('تعديل طلب العهدة')} ${esc(custodyNo(old))}` : '➕ ' + t('طلب عهدة'), size: 'wide',
    body: `<div class="form" id="cu-form">
        <label>${t('نوع المعاملة')}<select name="txType">${Object.entries(CUSTODY_TYPES).map(([k, v]) => opt(k, t(v.label), k === S.tx)).join('')}</select></label>
        <label><span class="req">${t('المستلم')}</span><input name="custodian" list="dl-custodians" value="${esc(old ? old.custodian : '')}" placeholder="${esc(t('اسم المندوب'))}"></label>
        ${direct ? `<label><span class="req">${t('تاريخ التقفيل')}</span><input type="date" name="date" value="${todayISO()}" max="${todayISO()}"></label>
        <label>${t('الدعم الإداري لكل موظف (د.ك)')}<input type="number" step="0.001" min="0" name="adminFee" value="${esc(custodySettings().supportFee ?? 20)}"></label>`
          : `<label>${t('تاريخ الطلب')}<input type="date" name="requestDate" value="${esc(old ? old.requestDate || '' : todayISO())}"></label>`}
        <label class="full">${t('ملاحظات')}<input name="notes" value="${esc(old ? old.notes || '' : '')}"></label></div>
      ${direct ? `<div class="notice small" style="margin-top:8px">${t('للإجراء اللي المستلم صرف عليه من فلوس عهدة معاه لشخص مش في أي طلب: بيتسجّل ويتقفل على طول وتطلع فواتيره، ورصيد المستلم بينقص بالمبلغ — والمبلغ بيتضاف على أقرب طلب عهدة له.')}</div>` : ''}
      <datalist id="dl-custodians">${uniq(custodiesInView().map(c => c.custodian)).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <h4 class="cu-h">${t('الأشخاص')} <span class="small muted" id="cu-kind"></span></h4>
      <div class="row" style="gap:8px;flex-wrap:wrap"><input type="search" id="cu-q" placeholder="${esc(t('بحث بالاسم أو الرقم المدني…'))}" style="flex:1;min-width:200px">
        <span id="cu-quick"></span><span class="small muted" id="cu-sel-n"></span></div>
      <div class="cu-pick-list" id="cu-pick"></div>
      <h4 class="cu-h">${direct ? `${t('الإجراءات والمبالغ الفعلية')} <span class="small muted">(${t('علّم الإجراءات اللي اتعملت واكتب مبلغها الفعلي')})</span>`
        : `${t('البنود والمبالغ')} <span class="small muted">(${t('شيل علامة البند اللي الشخص مش محتاجه')})</span>`}</h4>
      <div id="cu-matrix"></div><div id="cu-exp" style="margin-top:10px"></div><div id="cu-dues"></div><div class="row cu-cl-sum" id="cu-sum"></div>`,
    foot: `${direct ? `<button class="btn primary" data-go>🔒 ${t('تقفيل وإصدار الفواتير')}</button>`
        : `<button class="btn primary" data-save="print">🖨️ ${t('حفظ ومعاينة الطلب')}</button><button class="btn" data-save="">💾 ${t('حفظ')}</button>`}
      <span class="spacer"></span><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const kind = () => CUSTODY_TYPES[S.tx].kind;
  // منع التكرار (من كل المستخدمين): الشخص في عهدة مفتوحة من نفس النوع ← مقفول، واتقفل له خلال 90 يوم ← تنبيه
  const busy = (pid, state) => (STATE.custodyBusy || []).find(b => b.txType === S.tx && b.kind === kind() && b.personId === pid
    && b.state === state && (!old || b.custodyId !== old.id));
  const eligible = () => {
    const ty = CUSTODY_TYPES[S.tx];
    if (ty.kind === 'employee') return STATE.employees.filter(e => !empEnded(e) && isKuwaitiStaff(e) === ty.kuwaiti)
      .map(e => { const doc = ty.doc || 'residencyExp'; return { id: e.id, name: e.name, sub: `${e.id} · ${companyName(empCompanyId(e)) || '—'}${e.costCenter ? ' · ' + e.costCenter : ''}`, exp: ty.kuwaiti ? null : e[doc],
        tag: e[doc] && !ty.kuwaiti ? `${t(doc === 'passportExp' ? 'الجواز' : 'الإقامة')}: ${datePill(e[doc])}` : esc(t(e.govStage ? (GOV_STAGES.find(g => g.id === e.govStage) || {}).label || '' : '')) }; });
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
    $('#cu-kind', E).textContent = `(${t(kind() === 'employee' ? 'موظفين' : 'مترشّحين')}${CUSTODY_TYPES[S.tx].kuwaiti ? ' ' + t('كويتيين ومعاملة كويتية') : ''} — ${t(CUSTODY_TYPES[S.tx].kind === 'employee' ? 'الإقامات والموظفين' : 'تسجيل موظف جديد')})`;
    $('#cu-quick', E).innerHTML = S.tx === 'renewal' ? `<span class="chip clickable ${S.quick === 'soon' ? 'on' : ''}" data-quick="soon">${t('الإقامة بتنتهي خلال 90 يوم')}</span>` : '';
    const list = eligible().filter(p => (!q || norm(p.name + ' ' + p.sub).includes(q)) && (S.quick !== 'soon' || (p.exp && p.exp <= soon)))
      .sort((a, b) => (S.persons.has(b.id) - S.persons.has(a.id)) || (a.exp && b.exp ? a.exp.localeCompare(b.exp) : 0) || a.name.localeCompare(b.name, 'ar'));
    $('#cu-pick', E).innerHTML = list.slice(0, 300).map(p => { const bo = busy(p.id, 'open'), br = busy(p.id, 'recent'); return `<label class="${S.persons.has(p.id) ? 'on' : ''} ${bo ? 'cu-busy' : ''}"><input type="checkbox" data-pick="${esc(p.id)}" ${S.persons.has(p.id) ? 'checked' : ''} ${bo && !S.persons.has(p.id) ? 'disabled' : ''}>
        <b>${esc(p.name)}</b><span class="small muted">${esc(p.sub)}</span><span class="spacer"></span>
        ${bo ? `<span class="chip" style="background:var(--red-soft);color:var(--red)">🔒 ${t('موجود في')} ${esc(bo.number)}${bo.owner ? ' · ' + esc(bo.owner) : ''}</span>`
          : br ? `<span class="chip" style="background:var(--orange-soft);color:var(--orange)">↩️ ${t('اتقفل في')} ${esc(br.number)} · ${fmtDate(br.closedDate)}</span>` : ''}
        <span class="small">${p.tag || ''}</span></label>`; }).join('')
      + (list.length > 300 ? `<div class="small muted" style="padding:6px 10px">${t('فيه نتائج أكتر — ضيّق البحث')}</div>` : '')
      || `<div class="empty">${t(kind() === 'employee' ? 'مفيش موظفين' : 'مفيش مترشّحين في المراحل دي')}</div>`;
    if (CUSTODY_TYPES[S.tx].kuwaiti === false && !CUSTODY_TYPES[S.tx].doc) $('#cu-pick', E).insertAdjacentHTML('beforeend', `<div class="small muted" style="padding:6px 10px">🇰🇼 ${t('العمالة الوطنية ليها «تجديد إذن عمل — عمالة وطنية»')}</div>`);
    $('#cu-sel-n', E).textContent = `${t('المحددين')}: ${S.persons.size}`;
    $$('[data-pick]', E).forEach(cb => cb.onchange = () => {
      // الطلب: كل البنود متعلّمة (الشخص محتاجها كلها غالبًا). التقفيل المباشر: المستخدم بيعلّم اللي اتعمل بس
      if (cb.checked) S.persons.set(cb.dataset.pick, { items: direct ? {} : defaults() }); else S.persons.delete(cb.dataset.pick);
      drawPick(); drawMatrix();
    });
    const qk = $('[data-quick]', E); if (qk) qk.onclick = () => { S.quick = S.quick ? '' : 'soon'; drawPick(); };
  };
  const val = v => (v === null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const grand = () => sum([...S.persons.values()].flatMap(p => Object.values(p.items).map(val)));
  // الطلب: التقفيلات المباشرة المقفولة لنفس المستلم اللي لسه مااتضافتش لطلب (أو مضافة على الطلب ده) ← مبلغها بيتضاف عليه
  const dueList = () => {
    const who = ($('[name="custodian"]', E).value || '').trim();
    return direct || !who ? [] : (STATE.custodies || []).filter(x => x.direct && x.status === 'closed' && (x.custodian || '').trim() === who
      && (!x.carryToId || (old && x.carryToId === old.id)));
  };
  const duesOn = () => dueList().filter(x => S.dues.get(x.id));
  const drawSum = () => {
    const box = $('#cu-sum', E), g = grand(), chip = (l, v, on) => `<span class="chip${on ? ' on' : ''}">${esc(t(l))}: <b>${v}</b></span>`;
    if (!direct) {
      const d = sum(duesOn().map(x => x.dueAmount || 0));
      box.innerHTML = dueList().length ? chip('بنود الطلب', fmtMoney(g)) + chip('مستحقات تقفيل مباشر', fmtMoney(d)) + chip('إجمالي المطلوب', fmtMoney(g + d), true) : '';
      return;
    }
    const ps = [...S.persons.entries()].filter(([, p]) => Object.keys(p.items).length);
    const cc = pid => (kind() === 'employee' ? IDX.employee[pid] : (STATE.candidates || []).find(c => c.id === pid) || {}).costCenter || '';
    const sup = (Number($('[name="adminFee"]', E).value) || 0) * ps.filter(([pid]) => !custodyNoSupport(cc(pid))).length;
    const who = ($('[name="custodian"]', E).value || '').trim(), bal = (custodianBalances().find(b => b.name === who) || { remaining: 0 }).remaining;
    box.innerHTML = !ps.length ? '' : chip('الإجراءات', sum(ps.map(([, p]) => Object.keys(p.items).length))) + chip('الأشخاص', ps.length)
      + chip('الفواتير', uniq(ps.map(([pid]) => cc(pid))).length) + chip('الرسوم الحكومية', fmtMoney(g)) + chip('الدعم الإداري', fmtMoney(sup))
      + chip('إجمالي الفواتير', fmtMoney(g + sup), true)
      + (who ? `<span class="chip" style="background:var(--purple-soft);color:var(--purple)">${esc(t('الرصيد مع المستلم'))}: <b>${fmtMoney(bal)}</b> ← <b${bal - g < 0 ? ' style="color:var(--red)"' : ''}>${fmtMoney(bal - g)}</b></span>` : '');
  };
  const drawDues = () => {
    const box = $('#cu-dues', E), list = dueList();
    list.forEach(x => { if (!S.dues.has(x.id)) S.dues.set(x.id, old ? x.carryToId === old.id : true); });   // طلب جديد ← متعلّمة
    box.innerHTML = !list.length ? '' : `<h4 class="cu-h">⚡ ${t('إجراءات اتقفلت مباشر — مستحقة للمستلم')} <span class="small muted">(${t('مبلغها بيتضاف على الطلب ده — شيل العلامة لو هتتضاف على طلب تاني')})</span></h4>
      <div class="cu-pick-list" style="max-height:180px">${list.map(x => `<label class="${S.dues.get(x.id) ? 'on' : ''}"><input type="checkbox" data-due="${esc(x.id)}" ${S.dues.get(x.id) ? 'checked' : ''}>
        <b class="num">${esc(custodyNo(x))}</b><span class="small muted">${esc(custodyTypeLabel(x.txType))} · ${fmtDate(x.closedDate || x.requestDate)} · ${esc(uniq((x.lines || []).map(l => l.personName)).join('، '))}</span>
        <span class="spacer"></span><b class="num">${fmtMoney(x.dueAmount)}</b></label>`).join('')}</div>`;
    $$('[data-due]', box).forEach(cb => cb.onchange = () => { S.dues.set(cb.dataset.due, cb.checked); cb.closest('label').classList.toggle('on', cb.checked); drawSum(); });
    drawSum();
  };
  // التقفيل المباشر: بند التجديد بيحدّث بيانات الموظف ← الانتهاء الجديد مطلوب (زي نافذة التقفيل)
  const expRows = () => {
    const out = [];
    if (direct && kind() === 'employee') S.persons.forEach((p, pid) => fees().forEach(f => { if (f.id in p.items && CUSTODY_EXPIRY_FIELDS[f.updatesField]) out.push({ pid, f, old: (IDX.employee[pid] || {})[f.updatesField] || '' }); }));
    return out;
  };
  const drawExp = () => {
    const box = $('#cu-exp', E), rows = expRows();
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<h4 class="cu-h">📅 ${t('تواريخ الانتهاء الجديدة')} (${rows.length})</h4>
      <div class="small muted" style="margin-bottom:6px">${t('التقفيل بيحدّث بيانات الموظف — التاريخ الجديد مطلوب لكل بند تجديد.')}</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('الموظف')}</th><th>${t('البند')}</th><th>${t('كان')}</th><th><span class="req">${t('الانتهاء الجديد')}</span></th></tr></thead><tbody>
      ${rows.map(({ pid, f, old: was }) => `<tr><td><b>${esc(info(pid).name)}</b></td><td>${esc(f.name)} <span class="small muted">(${esc(t(CUSTODY_EXPIRY_FIELDS[f.updatesField]))})</span></td>
        <td class="num">${fmtDate(was) || '—'}</td><td><div class="row" style="gap:4px;flex-wrap:nowrap"><input type="date" data-dexp="${esc(pid)}|${f.id}" value="${esc(extra(pid, 'expiries')[f.id] || '')}">
          ${was ? `<button type="button" class="btn sm ghost" data-dplus="${esc(pid)}|${f.id}|1" title="${esc(t('سنة من التاريخ القديم'))}">+1</button><button type="button" class="btn sm ghost" data-dplus="${esc(pid)}|${f.id}|2" title="${esc(t('سنتين من التاريخ القديم'))}">+2</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-dexp]', box).forEach(i => i.oninput = () => { const [pid, fid] = i.dataset.dexp.split('|'); extra(pid, 'expiries')[fid] = i.value; });
    $$('[data-dplus]', box).forEach(b => b.onclick = () => {
      const [pid, fid, n] = b.dataset.dplus.split('|'), row = rows.find(r => r.pid === pid && r.f.id === fid);
      const i = $$('[data-dexp]', box).find(x => x.dataset.dexp === `${pid}|${fid}`);
      i.value = extra(pid, 'expiries')[fid] = addYearsISO(row.old, Number(n));
    });
  };
  const drawMatrix = () => {
    const fs = fees(), box = $('#cu-matrix', E);
    drawExp();
    if (!fs.length) { box.innerHTML = `<div class="notice warn">${t('مفيش بنود مفعّلة للنوع ده في جدول الرسوم')}</div>`; drawSum(); return; }
    if (!S.persons.size) { box.innerHTML = `<div class="empty">${t('اختار الأشخاص من القائمة فوق')}</div>`; drawSum(); return; }
    const cell = (pid, f) => {
      const it = S.persons.get(pid).items, on = f.id in it, v = it[f.id];
      const input = f.options
        ? `<select data-amt="${esc(pid)}|${f.id}" ${on ? '' : 'disabled'}>${f.options.split(',').map(o => opt(o, o, Number(o) === Number(v))).join('')}</select>`
        : `<input type="number" step="0.001" min="0" data-amt="${esc(pid)}|${f.id}" value="${v ?? ''}" ${f.amount == null ? `placeholder="${esc(t('المبلغ'))}"` : ''} ${on ? '' : 'disabled'}>`;
      const rc = direct && on ? `<div><input class="cu-receipt" data-rc="${esc(pid)}|${f.id}" value="${esc(extra(pid, 'receipts')[f.id] || '')}" placeholder="${esc(t('رقم الإيصال'))}"></div>` : '';
      return `<td class="cu-cell ${on ? '' : 'off'}"><input type="checkbox" data-inc="${esc(pid)}|${f.id}" ${on ? 'checked' : ''}>${input}${rc}</td>`;
    };
    box.innerHTML = `<div class="table-wrap"><table class="data cu-matrix"><thead><tr><th>${t('الاسم')}</th>
        ${fs.map(f => `<th>${esc(f.name)}<div class="small muted">${f.options ? `<select data-all="${f.id}">${opt('', t('للكل…'), true)}${f.options.split(',').map(o => opt(o, o, false)).join('')}</select>` : f.amount != null ? rptNum(f.amount) : t('مفتوح')}</div></th>`).join('')}
        <th>${t('الإجمالي')}</th><th></th></tr></thead>
      <tbody>${[...S.persons.keys()].map(pid => { const p = info(pid); return `<tr><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.sub)}</div></td>
        ${fs.map(f => cell(pid, f)).join('')}<td class="num"><b data-rowtot="${esc(pid)}"></b></td><td><button type="button" class="btn sm danger" data-rm="${esc(pid)}">✕</button></td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td>${t('الإجمالي')} (${S.persons.size})</td>${fs.map(f => `<td class="num" data-coltot="${f.id}"></td>`).join('')}<td class="num"><b id="cu-grand"></b></td><td></td></tr></tfoot></table></div>`;
    translateDomText(box);
    const totals = () => {
      drawSum();
      S.persons.forEach((p, pid) => { const el = $(`[data-rowtot="${CSS.escape(pid)}"]`, E); if (el) el.textContent = rptNum(sum(Object.values(p.items).map(val))); });
      fs.forEach(f => { $(`[data-coltot="${f.id}"]`, E).textContent = rptNum(sum([...S.persons.values()].map(p => (f.id in p.items ? val(p.items[f.id]) : 0)))); });
      $('#cu-grand', E).textContent = rptNum(grand());
    };
    $$('[data-rc]', box).forEach(inp => inp.oninput = () => { const [pid, fid] = inp.dataset.rc.split('|'); extra(pid, 'receipts')[fid] = inp.value; });
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
  $('[name="custodian"]', E).addEventListener('input', debounce(() => (direct ? drawSum() : drawDues()), 200));
  if (direct) $('[name="adminFee"]', E).addEventListener('input', drawSum);
  drawPick(); drawMatrix(); drawDues();
  const go = $('[data-go]', E);
  if (go) go.onclick = async () => {                       // 🔒 تقفيل مباشر
    const d = formValues($('#cu-form', E));
    if (!d.custodian) return openBlockAlert(t('اسم المستلم مطلوب'));
    if (!d.date) return openBlockAlert(t('اختار تاريخ التقفيل'));
    if (d.date > todayISO()) return openBlockAlert(t('تاريخ التقفيل لسه ماجاش'));
    if (!S.persons.size) return openBlockAlert(t('اختار الشخص اللي اتعمل له الإجراء'));
    const empty = [...S.persons.entries()].filter(([, p]) => !Object.keys(p.items).length).map(([pid]) => info(pid).name);
    if (empty.length) return openBlockAlert(`${t('علّم الإجراءات اللي اتعملت لـ')}: ${esc(empty.join('، '))}`);
    if ([...S.persons.values()].some(p => Object.values(p.items).some(v => v === null || v === '' || isNaN(Number(v))))) return openBlockAlert(t('اكتب المبلغ الفعلي لكل إجراء اتعمل'));
    const exps = expRows().map(r => ({ ...r, v: extra(r.pid, 'expiries')[r.f.id] || '' }));
    const miss = exps.filter(r => !r.v).length;
    if (miss) return openBlockAlert(`${t('سجّل تاريخ الانتهاء الجديد لكل بنود التجديد')} (${miss})`);
    const back = exps.find(r => r.old && r.v < r.old);
    if (back) return openBlockAlert(`${esc(info(back.pid).name)}: ${t('الانتهاء الجديد لازم يبقى بعد القديم')} (${fmtDate(back.old)})`);
    const persons = [...S.persons.entries()].map(([pid, p]) => ({ id: pid, items: p.items,
      receipts: Object.fromEntries(Object.entries(p.receipts || {}).filter(([fid]) => fid in p.items)),
      expiries: Object.fromEntries(exps.filter(r => r.pid === pid).map(r => [r.f.id, r.v])) }));
    const n = sum(persons.map(p => Object.keys(p.items).length));
    if (!await openConfirm(`${t('تقفيل مباشر')}: ${n} ${t('إجراء')} — ${fmtMoney(grand())} — ${t('المستلم')}: ${esc(d.custodian)}.<br>${t('الفواتير هتطلع على طول، ورصيد المستلم هينقص بالمبلغ لحد ما يتضاف على أقرب طلب عهدة له. تكمل؟')}`, { okLabel: t('تقفيل وإصدار الفواتير') })) return;
    const send = force => persist('POST', '/api/custodies/direct', { txType: S.tx, custodian: d.custodian, date: d.date, adminFee: d.adminFee, notes: d.notes, persons, force }, 'تم التقفيل');
    let res;
    try { res = await send(false); } catch (e) {
      if (e.data && e.data.block) return openBlockAlert(esc(e.message));
      if (!(e.status === 409 && e.data && e.data.warn) || !await openConfirm(esc(e.message), { okLabel: t('إجراء جديد — كمّل') })) return;
      try { res = await send(true); } catch (e2) { if (e2.data && e2.data.block) openBlockAlert(esc(e2.message)); return; }
    }
    m.close();
    openCustodyDetails(res.id);
    custodyPreview(`/api/custodies/${res.id}/closing.pdf?date=${res.date}`);
  };
  $$('[data-save]', E).forEach(b => b.onclick = async () => {
    const d = formValues($('#cu-form', E));
    if (!d.custodian) return openBlockAlert(t('اسم المستلم مطلوب'));
    const persons = [...S.persons.entries()].map(([pid, p]) => ({ id: pid, items: p.items })).filter(p => Object.keys(p.items).length);
    if (!persons.length) return openBlockAlert(t('اختار موظف واحد على الأقل وبند واحد على الأقل'));
    const open = persons.filter(p => Object.values(p.items).some(v => v === null || v === '')).length;
    if (open && !await openConfirm(`${t('فيه بنود من غير مبلغ (زي التصديقات) عند')} ${open} ${t('شخص — هتتحسب صفر في الطلب لحد ما تتكتب. تكمل؟')}`)) return;
    const send = force => persist(old ? 'PUT' : 'POST', old ? `/api/custodies/${old.id}` : '/api/custodies', { ...d, txType: S.tx, persons, force, dues: duesOn().map(x => x.id) }, 'تم الحفظ');
    let res;
    try { res = await send(false); } catch (e) {
      // اتقفل لهم نفس النوع خلال 90 يوم ← تأكيد (والتقفيل بعد كده بيعدّيهم)
      if (!(e.status === 409 && e.data && e.data.warn) || !await openConfirm(esc(e.message), { okLabel: t('اطلبهم تاني') })) return;
      try { res = await send(true); } catch (e2) { return; }
    }
    m.close();
    const c = (STATE.custodies || []).find(x => x.id === (old ? old.id : res.id));
    if (!c) return;
    openCustodyDetails(c.id);
    if (b.dataset.save === 'print') STATE.sheetPdfAvailable ? custodyPreview(`/api/custodies/${c.id}/request.pdf`) : printCustodyRequest(c);
  });
}

/* ---------- 📅 خطة التجديدات الشهرية ← طلب عهدة ----------
   مين محتاج تجديد في الفترة: غير الكويتيين ← الإقامة («تجديد إقامة» — معاها إذن العمل)، والعمالة الوطنية ← إذن العمل
   («تجديد إذن عمل — عمالة وطنية»). الخليجي مالوش إقامة. بنود كل واحد من جدول الرسوم (بمبالغها الافتراضية)، وبند
   البطاقة الصحية بس لو بطاقته بتنتهي لحد آخر الفترة. الميزانية = الرسوم + الدعم الإداري (إلا مراكز الشركة نفسها). */
const RENEWAL_PERIODS = { this: 'الشهر ده', next: 'الشهر الجاي', after: 'الشهر اللي بعده', overdue: 'المتأخرين (انتهى ومش في عهدة)' };
function renewalPeriodRange(period) {
  if (period === 'overdue') return ['0000-01-01', addDays(todayISO(), -1)];
  const off = { this: 0, next: 1, after: 2 }[period] ?? 1, d = new Date();
  return [isoLocal(new Date(d.getFullYear(), d.getMonth() + off, 1)), isoLocal(new Date(d.getFullYear(), d.getMonth() + off + 1, 0))];
}
function renewalPeriodText(period) {
  const [from, to] = renewalPeriodRange(period);
  return period === 'overdue' ? t('انتهى قبل النهارده ومش في عهدة مفتوحة') : `${t('من')} ${fmtDate(from)} ${t('لحد')} ${fmtDate(to)}`;
}
function renewalPlan(period) {
  const [from, to] = renewalPeriodRange(period), st = custodySettings(), fees = STATE.feeItems || [], busy = STATE.custodyBusy || [];
  const rows = [];
  for (const e of scopedEmployees()) {
    if (empEnded(e)) continue;
    const kw = isKuwaitiStaff(e);
    if (!kw && !empNeedsResidency(e)) continue;
    const tx = kw ? 'kw_permit_renewal' : 'renewal', field = kw ? 'workPermitExp' : 'residencyExp', exp = e[field];
    if (!exp || exp < from || exp > to) continue;
    const find = state => busy.find(b => b.txType === tx && b.kind === 'employee' && b.personId === e.id && b.state === state);
    const busyOpen = find('open');
    if (period === 'overdue' && busyOpen) continue;
    const items = {};
    let health = false;
    fees.filter(f => f.txType === tx && f.active).forEach(f => {
      if (f.updatesField === 'healthCardExp') {
        if (!(e.healthCardExp && e.healthCardExp <= to)) return;
        health = true;
      }
      items[f.id] = f.amount ?? null;
    });
    rows.push({ e, tx, field, exp, items, health, busyOpen, busyRecent: find('recent'),
      fees: sum(Object.values(items).map(v => Number(v) || 0)), support: custodyNoSupport(e.costCenter) ? 0 : Number(st.supportFee) || 0 });
  }
  return rows.sort((a, b) => a.exp.localeCompare(b.exp) || empName(a.e).localeCompare(empName(b.e), 'ar'));
}
function openRenewalPlanModal(period = 'next') {
  let P = period;
  const off = new Set();                         // اللي اتشالت علامته (الباقي متعلّم)
  const m = openModal({ title: '📅 ' + t('خطة التجديدات'), size: 'wide', body: '<div id="rp"></div>',
    foot: '<div id="rp-f" class="row" style="width:100%;gap:8px;flex-wrap:wrap"></div>' });
  const E = m.el;
  const stageLabel = s => t((govStageInfo(s) || {}).label || '');
  const draw = () => {
    const rows = renewalPlan(P), ok = r => !r.busyOpen && !off.has(r.e.id), picked = rows.filter(ok);
    const groups = new Map();
    rows.forEach(r => { const co = empCompanyId(r.e) || '', cc = r.e.costCenter || '', k = `${co}|${cc}`; if (!groups.has(k)) groups.set(k, { k, co, cc, rows: [] }); groups.get(k).rows.push(r); });
    const G = [...groups.values()].sort((a, b) => (companyName(a.co) || '').localeCompare(companyName(b.co) || '', 'ar') || a.cc.localeCompare(b.cc, 'ar'));
    const money = rs => sum(rs.map(r => r.fees)), sup = rs => sum(rs.map(r => r.support));
    const byType = tx => picked.filter(r => r.tx === tx);
    const tile = (v, l, col) => `<div class="card cu-kpi"${col ? ` style="border-top:3px solid var(--${col})"` : ''}><b class="num">${esc(String(v))}</b><span>${esc(t(l))}</span></div>`;
    $('#rp', E).innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <label class="row" style="gap:6px">${t('الفترة')} <select id="rp-p">${Object.entries(RENEWAL_PERIODS).map(([k, l]) => opt(k, t(l), k === P)).join('')}</select></label>
        <span class="small muted">${esc(renewalPeriodText(P))}</span></div>
      <div class="cu-kpis">${tile(rows.length, 'محتاج تجديد', 'orange')}${tile(picked.length, 'متحدد للطلب', 'blue')}${tile(fmtMoney(money(picked)), 'الرسوم المتوقعة')}
        ${tile(fmtMoney(sup(picked)), 'الدعم الإداري')}${tile(fmtMoney(money(picked) + sup(picked)), 'إجمالي الفواتير المتوقعة', 'green')}</div>
      <div class="small muted" style="margin:8px 0">${t('الرسوم من جدول الرسوم (المبلغ المفتوح بيتحسب صفر لحد ما يتكتب)، وبند البطاقة الصحية بس للي بطاقته بتنتهي في الفترة. اللي في عهدة مفتوحة مايتختارش.')}</div>
      ${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th style="width:30px"><input type="checkbox" id="rp-all" ${picked.length && picked.length === rows.filter(r => !r.busyOpen).length ? 'checked' : ''}></th>
        <th>${t('الموظف')}</th><th>${t('المعاملة')}</th><th>${t('تاريخ الانتهاء')}</th><th>${t('البنود')}</th><th>${t('الرسوم')}</th><th>${t('الحالة')}</th></tr></thead><tbody>
        ${G.map(g => { const gp = g.rows.filter(ok); return `<tr class="cu-person"><td><input type="checkbox" data-rpg="${esc(g.k)}" ${gp.length && gp.length === g.rows.filter(r => !r.busyOpen).length ? 'checked' : ''}></td>
          <td colspan="6">🏢 <b>${esc(companyName(g.co) || t('بدون شركة'))}</b> · ${esc(ccLabel(g.cc) || t('بدون مركز تكلفة'))} <span class="small muted">(${g.rows.length} — ${fmtMoney(money(gp) + sup(gp))})</span></td></tr>
          ${g.rows.map(r => `<tr class="${r.busyOpen ? 'muted' : ''}"><td><input type="checkbox" data-rp="${esc(r.e.id)}" ${ok(r) ? 'checked' : ''} ${r.busyOpen ? 'disabled' : ''}></td>
            <td><b>${esc(empName(r.e))}</b><div class="small muted num">${esc(r.e.id)}${r.e.fileNo ? ' · ' + esc(r.e.fileNo) : ''}</div></td>
            <td class="small">${esc(custodyTypeLabel(r.tx))}</td>
            <td>${datePill(r.exp)}<div class="small muted">${esc(daysText(daysUntil(r.exp)))}</div></td>
            <td class="small">${Object.keys(r.items).length} ${t('بند')}${r.health ? ` · 🩺 ${t('البطاقة الصحية')}` : ''}</td>
            <td class="num">${fmtMoney(r.fees)}${r.support ? `<div class="small muted">+ ${fmtMoney(r.support)} ${t('دعم')}</div>` : ''}</td>
            <td class="small">${r.busyOpen ? `<span class="chip" style="background:var(--red-soft);color:var(--red)">🔒 ${t('في عهدة')} ${esc(r.busyOpen.number)}</span>` : ''}
              ${r.busyRecent ? `<span class="chip" style="background:var(--orange-soft);color:var(--orange)">↩️ ${t('اتقفل في')} ${esc(r.busyRecent.number)} · ${fmtDate(r.busyRecent.closedDate)}</span>` : ''}
              ${r.e.govStage ? `<div>⏳ ${esc(stageLabel(r.e.govStage))}</div>` : ''}</td></tr>`).join('')}`; }).join('')}</tbody></table></div>`
        : `<div class="empty">${t('مفيش تجديدات في الفترة دي')} 🎉</div>`}`;
    $('#rp-f', E).innerHTML = `<button class="btn" data-a="print" ${picked.length ? '' : 'disabled'}>🖨️ ${t('طباعة الخطة')}</button>
      ${['renewal', 'kw_permit_renewal'].map(tx => byType(tx).length ? `<button class="btn primary write-only" data-p="custody.edit" data-req="${tx}">💰 ${t('طلب عهدة')} — ${esc(custodyTypeLabel(tx))} (${byType(tx).length})</button>` : '').join('')}
      <span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`;
    translateDomText(E);
    $('#rp-p', E).onchange = ev => { P = ev.target.value; off.clear(); draw(); };
    $$('[data-rp]', E).forEach(cb => cb.onchange = () => { if (cb.checked) off.delete(cb.dataset.rp); else off.add(cb.dataset.rp); draw(); });
    $$('[data-rpg]', E).forEach(cb => cb.onchange = () => { groups.get(cb.dataset.rpg).rows.forEach(r => { if (cb.checked) off.delete(r.e.id); else off.add(r.e.id); }); draw(); });
    const all = $('#rp-all', E); if (all) all.onchange = () => { rows.forEach(r => { if (all.checked) off.delete(r.e.id); else off.add(r.e.id); }); draw(); };
    $('[data-close]', $('#rp-f', E)).onclick = () => m.close();
    $$('[data-req]', E).forEach(b => b.onclick = () => {
      const tx = b.dataset.req;
      m.close();
      openCustodyRequestModal(null, { tx, persons: byType(tx).map(r => ({ id: r.e.id, items: r.items })) });
    });
    const pr = $('[data-a="print"]', E); if (pr) pr.onclick = () => printRenewalPlan(P, picked, G.map(g => ({ ...g, rows: g.rows.filter(ok) })).filter(g => g.rows.length));
  };
  draw();
}
function printRenewalPlan(period, picked, groups) {
  const money = rs => sum(rs.map(r => r.fees)), sup = rs => sum(rs.map(r => r.support));
  let n = 0;
  const body = `<table class="rpt"><thead><tr><th>#</th><th class="txt">${t('الموظف')}</th><th>${t('الرقم المدني')}</th><th class="txt">${t('المعاملة')}</th><th>${t('تاريخ الانتهاء')}</th>
      <th>${t('المتبقي')}</th><th>${t('البنود')}</th><th>${t('الرسوم')}</th><th>${t('الدعم الإداري')}</th><th>${t('الإجمالي')}</th></tr></thead><tbody>
    ${groups.map(g => `<tr class="grp"><td colspan="10">${esc(companyName(g.co) || t('بدون شركة'))} · ${esc(ccLabel(g.cc) || t('بدون مركز تكلفة'))}<small>${g.rows.length} ${t('موظف')} — ${fmtMoney(money(g.rows) + sup(g.rows))}</small></td></tr>
      ${g.rows.map((r, i) => `<tr class="${i % 2 ? 'z' : ''}"><td class="idx">${++n}</td><td class="txt">${esc(empName(r.e))}</td><td class="num">${esc(r.e.id)}</td><td class="txt">${esc(custodyTypeLabel(r.tx))}</td>
        <td class="num"><span class="pill ${(TIERS[tierOf(r.exp)] || {}).cls || ''}">${fmtDate(r.exp)}</span></td><td class="num">${esc(daysText(daysUntil(r.exp)))}</td>
        <td class="num">${Object.keys(r.items).length}${r.health ? ' 🩺' : ''}</td><td class="num">${rptNum(r.fees)}</td><td class="num">${rptNum(r.support)}</td><td class="num"><b>${rptNum(r.fees + r.support)}</b></td></tr>`).join('')}`).join('')}</tbody>
    <tfoot><tr><td colspan="7">${t('الإجمالي')} (${picked.length} ${t('موظف')})</td><td class="num">${rptNum(money(picked))}</td><td class="num">${rptNum(sup(picked))}</td><td class="num">${rptNum(money(picked) + sup(picked))}</td></tr></tfoot></table>
    <div class="small" style="margin-top:4px;color:#66736f">${t('الرسوم من جدول الرسوم — المبلغ المفتوح (زي التصديقات) مش محسوب. 🩺 = معاه تجديد البطاقة الصحية.')}</div>`;
  openReportWindow({ title: t('خطة التجديدات'), subtitle: `${t(RENEWAL_PERIODS[period])} — ${renewalPeriodText(period)}`, landscape: true,
    summary: [[picked.length, t('موظف')], [fmtMoney(money(picked)), t('الرسوم المتوقعة')], [fmtMoney(sup(picked)), t('الدعم الإداري')], [fmtMoney(money(picked) + sup(picked)), t('إجمالي الفواتير المتوقعة')]],
    body, sign: true });
  printLog(`${t('خطة التجديدات')} — ${t(RENEWAL_PERIODS[period])}`, 'custody');
}

/* ---------- تفاصيل العهدة: الصرف والبنود ---------- */
function openCustodyDetails(id) {
  const m = openModal({ title: '💰', size: 'wide', body: '<div id="cu-d"></div>', foot: '<div id="cu-df" class="row" style="width:100%;gap:8px;flex-wrap:wrap"></div>' });
  const E = m.el;
  const draw = () => {
    const c = (STATE.custodies || []).find(x => x.id === id);
    if (!c) { m.close(); return; }
    const tt = custodyTotals(c), open = ['requested', 'disbursed'].includes(c.status), edit = open && can('custody.edit');
    // بند التجديد: الانتهاء الجديد (بيحدّث بيانات الموظف) — مطلوب قبل التقفيل
    const hasExp = (c.lines || []).some(l => l.updatesField);
    const expCell = (l, ed) => {
      if (!l.updatesField) return '<td></td>';
      const lbl = esc(t(CUSTODY_EXPIRY_FIELDS[l.updatesField] || '')), need = l.done && !l.newExpiry, base = custodyExpiryBase(l);
      const info = `${need ? `<span style="color:var(--orange)">⚠️ ${t('سجّل التاريخ الجديد')}</span> · ` : ''}${lbl}${l.oldExpiry ? ` · ${t('كان')} ${fmtDate(l.oldExpiry)}` : ''}`;
      if (!ed) return `<td class="small">${l.newExpiry ? `<b class="num">${fmtDate(l.newExpiry)}</b>` : '<span class="muted">—</span>'}<div class="muted">${info}</div></td>`;
      return `<td class="cu-exp${need ? ' need' : ''}"><div class="row" style="gap:4px;flex-wrap:nowrap"><input type="date" data-newexp="${l.id}" value="${esc(l.newExpiry || '')}">
          ${base ? `<button type="button" class="btn sm ghost" data-plus="${l.id}|1" title="${esc(t('سنة من التاريخ القديم'))}">+1</button><button type="button" class="btn sm ghost" data-plus="${l.id}|2" title="${esc(t('سنتين من التاريخ القديم'))}">+2</button>` : ''}</div>
        <div class="small muted">${info}</div></td>`;
    };
    $('.modal-head h2', E).innerHTML = `${c.direct ? '⚡ ' + t('تقفيل مباشر') : '💰 ' + t('عهدة')} ${esc(custodyNo(c))} — ${esc(custodyTypeLabel(c.txType))}`;
    const anyClosed = (c.lines || []).some(l => l.closedDate);
    const kv = (l, v) => `<div><span>${esc(t(l))}</span>${v || '<span class="muted">—</span>'}</div>`;
    const chip = (l, v, col) => `<span class="chip" style="font-size:13px;padding:4px 10px${col ? `;background:var(--${col}-soft);color:var(--${col})` : ''}">${esc(t(l))}: <b class="num">${v}</b></span>`;
    $('#cu-d', E).innerHTML = `<div class="kv">${kv('المستلم', `<b>${esc(c.custodian)}</b>`)}${kv('الحالة', custodyChip(c))}${kv(c.direct ? 'تاريخ التقفيل' : 'تاريخ الطلب', fmtDate(c.requestDate))}
        ${c.direct ? kv('مبلغه', custodyDirectTag(c)) : kv('تاريخ الصرف', fmtDate(c.disbursedDate))}${kv('صاحب العهدة', esc(c.ownerName || c.createdBy))}${c.notes ? kv('ملاحظات', esc(c.notes)) : ''}</div>
      <div class="row" style="margin-top:8px">${custodyLangSelect()}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0">${c.direct
        ? `${chip('اتنفّذ', fmtMoney(tt.spent))}${tt.due ? chip('مستحق للمستلم', fmtMoney(tt.due), 'red') : c.carryFunded ? chip('اتعوّض في', esc(c.carryToNumber), 'green') : ''}`
        : `${chip('المطلوب', fmtMoney(tt.planned))}${c.carriedAmount ? chip('منها مستحقات تقفيل مباشر', fmtMoney(c.carriedAmount)) : ''}${chip('اتصرف', tt.gross ? fmtMoney(tt.gross) : '—', 'blue')}
        ${chip('اتنفّذ', fmtMoney(tt.spent))}${tt.gross ? chip('الرصيد مع المستلم', fmtMoney(tt.remaining), tt.remaining < 0 ? 'red' : 'purple') : ''}`}${chip('جاهز للتقفيل', `${tt.ready} ${t('إجراء')}`, 'green')}${tt.itemsClosed ? chip('اتقفل', `${tt.itemsClosed}/${tt.items} ${t('إجراء')}`) : ''}</div>
      ${c.status === 'requested' ? `<div class="notice small">${t('اطبع الطلب واعتمده من المسؤول والإدارة المالية، وبعد الصرف اضغط «💵 تم الصرف» وسجّل المبلغ.')}</div>` : ''}
      ${c.direct ? `<div class="notice small">${t('تقفيل مباشر: الإجراءات دي اتصرف عليها من فلوس عهدة مع المستلم لشخص مش في أي طلب. مبلغها مستحق للمستلم وبيتضاف على أقرب طلب عهدة له، ولما الطلب يتصرف رصيده بيرجع.')}${c.status === 'disbursed' ? ' ' + t('تقفيله اتلغى — عدّل البنود وقفّله تاني، أو ألغيه.') : ''}</div>` : ''}
      ${(c.carried || []).length ? `<div class="notice small">⚡ ${t('مستحقات تقفيل مباشر مضافة على الطلب')}: ${c.carried.map(x => `<a href="#" data-open-cu="${esc(x.id)}"><b class="num">${esc(x.number)}</b></a> (${fmtMoney(x.amount)})`).join('، ')}</div>` : ''}
      ${c.direct ? '' : `<div class="small muted" style="margin:6px 0">${t('البند بيتعلّم «تم» لوحده لما مرحلة الشخص تعدّيه، وتقدر تعلّمه وتعدّل المبلغ الفعلي ورقم الإيصال بإيدك.')}</div>`}
      <div class="table-wrap"><table class="data cu-lines"><thead><tr><th style="width:34px">✓</th><th>${t('البند')}</th><th>${t('الجهة')}</th><th>${t('المحدد')}</th><th>${t('الفعلي')}</th><th>${t('رقم الإيصال')}</th><th>${t('تاريخ التنفيذ')}</th>${hasExp ? `<th>${t('الانتهاء الجديد')}</th>` : ''}</tr></thead><tbody>
      ${custodyPersons(c).map(p => { const done = p.lines.every(l => l.done), allClosed = p.lines.every(l => l.closedDate), someClosed = p.lines.some(l => l.closedDate);
          const closedOn = allClosed && uniq(p.lines.map(l => l.closedDate)).sort().pop(); return `<tr class="cu-person ${allClosed ? 'cu-closed' : ''}"><td colspan="${hasExp ? 8 : 7}">${allClosed ? '🔒' : done ? '✅' : '⏳'} ${esc(p.name)}
          ${allClosed ? `<span class="chip" style="background:var(--green-soft);color:var(--green)">${t('اتقفل')} ${fmtDate(closedOn)}</span>` : someClosed ? `<span class="chip">🔒 ${t('اتقفل جزء')} (${p.lines.filter(l => l.closedDate).length}/${p.lines.length})</span>` : ''}
          <span class="small muted">${esc(p.civilId || '')}${p.costCenter ? ' · ' + esc(p.costCenter) : ''}${p.companyId ? ' · ' + esc(companyName(p.companyId)) : ''}</span>
          <span class="small" style="float:inline-end">${p.lines.filter(l => l.done).length}/${p.lines.length} · ${fmtMoney(sum(p.lines.map(l => (l.done ? custodyLineAmount(l) : l.planned || 0))))}</span></td></tr>
        ${p.lines.map(l => { const ed = edit && !l.closedDate; return `<tr><td><input type="checkbox" data-done="${l.id}" ${l.done ? 'checked' : ''} ${ed ? '' : 'disabled'}></td><td>${esc(l.itemName)}${l.closedDate ? ` <span class="small" style="color:var(--green)" title="${esc(t('اتقفل'))}">🔒 ${fmtDate(l.closedDate)}</span>` : ''}</td><td class="small muted">${esc(l.authority || '')}</td>
          <td class="num">${l.planned == null ? '<span class="muted">—</span>' : rptNum(l.planned)}</td>
          <td>${ed ? `<input type="number" step="0.001" min="0" data-actual="${l.id}" value="${l.actual ?? ''}" placeholder="${l.planned ?? ''}">` : (l.actual == null ? '—' : rptNum(l.actual))}</td>
          <td>${ed ? `<input class="cu-receipt" data-receipt="${l.id}" value="${esc(l.receiptNo || '')}">` : esc(l.receiptNo || '')}</td><td class="small num">${fmtDate(l.doneDate)}</td>${hasExp ? expCell(l, ed) : ''}</tr>`; }).join('')}`; }).join('')}
      </tbody></table></div>
      ${custodyClosingsHtml(c)}`;
    const f = $('#cu-df', E);
    f.innerHTML = `${edit && c.status === 'disbursed' && tt.ready ? `<button class="btn primary" data-a="close">🔒 ${t('تقفيل')} (${tt.ready})</button>` : ''}
      ${c.direct ? '' : `<button class="btn" data-a="print">📄 ${t('طلب الصرف (معاينة وطباعة)')}</button>`}
      ${can('admin') ? `<button class="btn" data-a="transfer">👤 ${t('نقل الملكية')}</button>` : ''}
      ${edit && !c.direct ? `<button class="btn primary" data-a="disburse">💵 ${t(c.status === 'requested' ? 'تم الصرف' : 'تعديل الصرف')}</button>` : ''}
      ${edit && c.status === 'requested' ? `<button class="btn" data-a="edit">✏️ ${t('تعديل الطلب')}</button>` : ''}
      <span class="spacer"></span>
      ${c.status === 'requested' && can('custody.delete') ? `<button class="btn danger" data-a="cancel">🚫 ${t('إلغاء الطلب')}</button>` : ''}
      ${c.direct && c.status === 'disbursed' && !anyClosed && !c.carryFunded && can('custody.delete') ? `<button class="btn danger" data-a="cancel-direct">🚫 ${t('إلغاء التقفيل المباشر')}</button>` : ''}
      <button class="btn" data-close>${t('إغلاق')}</button>`;
    $('[data-close]', f).onclick = () => m.close();
    $$('[data-a]', f).forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'print') STATE.sheetPdfAvailable ? custodyPreview(`/api/custodies/${c.id}/request.pdf`) : printCustodyRequest(c);
      else if (a === 'transfer') openCustodyTransferModal(c, draw);
      else if (a === 'close') openCustodyCloseModal(c, draw);
      else if (a === 'disburse') openCustodyDisburseModal(c, draw);
      else if (a === 'edit') { m.close(); openCustodyRequestModal(c.id); }
      else if (a === 'cancel' && await openConfirm(`${t('إلغاء طلب العهدة')} ${custodyNo(c)}؟`, { danger: true, okLabel: t('إلغاء الطلب') })) {
        await persist('POST', `/api/custodies/${c.id}/cancel`, {}, 'تم الإلغاء'); draw();
      } else if (a === 'cancel-direct' && await openConfirm(`${t('إلغاء التقفيل المباشر')} ${custodyNo(c)}؟ ${t('مش هيتحسب على المستلم ولا هيتضاف على أي طلب.')}`, { danger: true, okLabel: t('إلغاء التقفيل المباشر') })) {
        try { await persist('POST', `/api/custodies/${c.id}/cancel`, {}, 'تم الإلغاء'); } catch (e) { /* ظاهر */ }
        draw();
      }
    });
    $$('[data-open-cu]', E).forEach(a => a.onclick = ev => { ev.preventDefault(); m.close(); openCustodyDetails(a.dataset.openCu); });
    $$('[data-closing]', E).forEach(b => b.onclick = () => custodyPreview(`/api/custodies/${c.id}/closing.pdf?date=${b.dataset.closing}${b.dataset.layout ? '&layout=' + b.dataset.layout : ''}`));
    bindCustodyLang(E);
    bindInvoiceActions(E, draw);
    $$('[data-reopen]', E).forEach(b => b.onclick = async () => {
      if (!await openConfirm(`${t('إلغاء تقفيل')} ${fmtDate(b.dataset.reopen)}؟ ${t('الفواتير بتاعته هتتمسح، والبنود هترجع مفتوحة وتقدر تعدّلها وتقفلها تاني.')}`, { danger: true, okLabel: t('إلغاء التقفيل') })) return;
      try { await persist('POST', `/api/custodies/${c.id}/reopen`, { date: b.dataset.reopen }, 'تم إلغاء التقفيل'); } catch (e) { /* ظاهر */ }
      draw();
    });
    translateDomText(E);
  };
  // تعديل البنود: كل تغيير بيتحفظ على طول، وبعدين الأرقام بتتحدّث
  const saveLine = async (lid, body) => { try { await persist('PUT', `/api/custodies/${id}/lines/${lid}`, body); } catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); } draw(); };
  E.addEventListener('click', ev => {                                     // «+1» / «+2» سنة من التاريخ القديم
    const b = ev.target.closest('[data-plus]');
    if (!b) return;
    const [lid, n] = b.dataset.plus.split('|');
    const c = (STATE.custodies || []).find(x => x.id === id), l = c && (c.lines || []).find(x => String(x.id) === lid);
    const base = l && custodyExpiryBase(l);
    if (base) saveLine(lid, { newExpiry: addYearsISO(base, Number(n)) });
  });
  E.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.newexp) saveLine(el.dataset.newexp, { newExpiry: el.value || null });
    else if (el.dataset.done) saveLine(el.dataset.done, { done: el.checked }).then(() => {       // بند تجديد اتعلّم «تم» ← خانة التاريخ الجديد
      const i = $(`[data-newexp="${el.dataset.done}"]`, E);
      if (el.checked && i && !i.value) i.focus();
    });
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
  const company = IDX.company[custodySettings().issuerCompanyId] || null;      // المُصدِر (أبراج انرجي)
  openReportWindow({
    title: t('طلب صرف عهدة'), subtitle: custodyTypeLabel(c.txType), company, landscape: cols.length > 4,
    meta: [[t('رقم العهدة'), custodyNo(c)], [t('تاريخ الطلب'), fmtDate(c.requestDate)], [t('المستلم'), c.custodian]],
    criteria: `${t('نوع المعاملة')}: ${esc(custodyTypeLabel(c.txType))} · ${t('المستلم')}: ${esc(c.custodian)}${c.notes ? ' · ' + esc(c.notes) : ''}`,
    summary: [[people.length, t('عدد الأشخاص')], [groups.size, t('مراكز التكلفة')], [rptNum(sum(people.map(total)) + (c.carriedAmount || 0)), t('إجمالي المطلوب (د.ك)')]],
    body: table + ((c.carried || []).length ? `<table class="rpt" style="margin-top:10px"><thead><tr><th class="txt">${t('مستحقات تقفيل مباشر (اتصرفت قبل كده من فلوس عهدة مع المستلم)')}</th><th class="num">${t('المبلغ')} (${t('د.ك')})</th></tr></thead>
      <tbody>${c.carried.map(x => `<tr><td class="txt">${esc(x.number)}</td><td class="num">${rptNum(x.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td class="txt">${t('إجمالي المطلوب (د.ك)')}</td><td class="num">${rptNum(sum(people.map(total)) + (c.carriedAmount || 0))}</td></tr></tfoot></table>` : ''), sign: [t('المستلم'), t('المسؤول'), t('الإدارة المالية')],
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
    Object.assign(r, { name: g('name').value, nameEn: g('nameEn').value, authority: g('authority').value, amount: g('amount').value === '' ? null : Number(g('amount').value),
      options: g('options').value, stage: g('stage').value, active: g('active').checked, updatesField: g('updatesField') ? g('updatesField').value : null });
  });
  const draw = () => {
    const stages = custodyFlowStages(CUSTODY_TYPES[cur].flow), emp = CUSTODY_TYPES[cur].kind === 'employee';
    $('#fee-body', E).innerHTML = `<div class="tabs">${Object.entries(CUSTODY_TYPES).map(([k, v]) => `<button data-fee-tx="${k}" class="${k === cur ? 'active' : ''}">${esc(t(v.label))}</button>`).join('')}</div>
      <div class="notice small" style="margin:8px 0">${t('المبلغ الفاضي = مبلغ مفتوح بيتكتب لكل شخص (زي التصديقات). الاختيارات = مبالغ بيتختار منها (زي إذن العمل 60، 260، 360، 460). المرحلة = لما الشخص يعدّيها البند بيتعلّم «تم» لوحده. التعديل مابيأثرش على العهد القديمة.')}</div>
      <div class="table-wrap"><table class="data fee-tbl"><thead><tr><th>${t('البند')}</th><th>${t('البند بالإنجليزي')}</th><th>${t('الجهة')}</th><th>${t('المبلغ (د.ك)')}</th><th>${t('الاختيارات')}</th><th>${t('المرحلة')}</th>${emp ? `<th title="${esc(t('التاريخ اللي البند بيجدده في بيانات الموظف — بيتسجّل عليه الانتهاء الجديد قبل التقفيل'))}">${t('بيحدّث')}</th>` : ''}<th>${t('مفعّل')}</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-i="${i}"><td><input data-f="name" value="${esc(r.name || '')}"></td><td><input data-f="nameEn" value="${esc(r.nameEn || '')}" dir="ltr"></td><td><input data-f="authority" value="${esc(r.authority || '')}"></td>
        <td><input type="number" step="0.001" min="0" data-f="amount" value="${r.amount ?? ''}" placeholder="${esc(t('مفتوح'))}"></td>
        <td><input data-f="options" value="${esc(r.options || '')}" placeholder="60,260" dir="ltr"></td>
        <td><select data-f="stage">${opt('', '—', !r.stage)}${stages.map(s => opt(s.id, t(s.label), s.id === r.stage)).join('')}</select></td>
        ${emp ? `<td><select data-f="updatesField">${opt('', '—', !r.updatesField)}${Object.entries(CUSTODY_EXPIRY_FIELDS).map(([k, l]) => opt(k, t(l), k === r.updatesField)).join('')}</select></td>` : ''}
        <td><input type="checkbox" data-f="active" ${r.active !== false ? 'checked' : ''}></td><td><button type="button" class="btn sm danger" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="fee-add">➕ ${t('بند')}</button><span class="spacer"></span>
        <span class="small muted">${t('الإجمالي الافتراضي')}: <b>${rptNum(sum(rows.filter(r => r.active !== false).map(r => r.amount)))}</b> ${t('د.ك')}</span></div>`;
    translateDomText($('#fee-body', E));
    $$('[data-fee-tx]', E).forEach(b => b.onclick = async () => {
      collect();
      if (dirty && !await openConfirm(t('فيه تعديلات ماتحفظتش في الجدول ده. تسيبها وتفتح التاني؟'))) return;
      cur = b.dataset.feeTx; load();
    });
    $('#fee-add', E).onclick = () => { collect(); rows.push({ name: '', nameEn: '', authority: '', amount: null, options: '', stage: '', active: true, updatesField: null }); dirty = true; draw(); };
    $$('[data-del]', E).forEach(b => b.onclick = () => { collect(); rows.splice(Number(b.dataset.del), 1); dirty = true; draw(); });
    $('#fee-body', E).addEventListener('input', () => { dirty = true; }, { once: true });
  };
  $('[data-save]', E).onclick = async () => {
    collect();
    try { await persist('PUT', `/api/fee-items/${cur}`, { items: rows }, 'تم الحفظ'); load(); } catch (e) { /* ظاهر */ }
  };
  load();
}

/* ---------- التقفيل: فاتورة لكل مركز تكلفة + الملخص (custody_excel.py ← PDF للمعاينة والطباعة) ---------- */
/** نقل ملكية العهدة لمستخدم تاني (مدير النظام) ← رقم جديد برمزه */
function openCustodyTransferModal(c, after) {
  const users = (STATE.custodyUsers || []).filter(u => String(u.id) !== String(c.ownerId));
  const m = openModal({
    title: `👤 ${t('نقل ملكية العهدة')} ${esc(custodyNo(c))}`, size: 'narrow',
    body: `<div class="form"><label class="full">${t('إلى المستخدم')}<select name="userId">${users.map(u => opt(String(u.id), `${u.name}${u.code ? ' · ' + u.code : ''}`, false)).join('')}</select></label></div>
      <div class="notice small" style="margin-top:8px">${t('العهدة بتاخد رقم جديد برمز المستخدم الجديد، وبتظهر عنده هو. الرقم القديم بيتسجّل في سجل التدقيق.')} (${t('صاحبها دلوقتي')}: ${esc(c.ownerName || '—')})</div>`,
    foot: `<button class="btn primary" data-save>👤 ${t('نقل')}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  $('[data-save]', m.el).onclick = async () => {
    try { const r = await persist('POST', `/api/custodies/${c.id}/transfer`, formValues(m.el), 'تم النقل'); m.close(); toast(`${t('رقمها الجديد')}: ${r.number}`, 'ok'); if (after) after(); } catch (e) { /* ظاهر */ }
  };
}
/** التقفيلات (بتاريخها) وفواتيرها: تنزيل الملخص والفواتير، اعتماد الحسابات، وإلغاء التقفيل لو كل فواتيره لسه بانتظار الحسابات */
function custodyClosingsHtml(c) {
  const by = {};
  custodyPersons(c).forEach(p => uniq(p.lines.map(l => l.closedDate).filter(Boolean)).forEach(d => (by[d] = by[d] || []).push(p)));
  const linesOn = d => (c.lines || []).filter(l => l.closedDate === d).length;
  const invs = (STATE.invoices || []).filter(i => i.custodyId === c.id);
  const dates = uniq([...Object.keys(by), ...invs.map(i => i.closingDate)]).sort();
  if (!dates.length) return '';
  return `<h4 class="cu-h">🔒 ${t('التقفيلات والفواتير')}</h4><div class="cu-closings">${dates.map(d => {
    const ps = by[d] || [], list = invs.filter(i => i.closingDate === d).sort((a, b) => (a.ccCode || '').localeCompare(b.ccCode || '')), locked = list.some(i => i.status === 'approved');
    const f = list[0] || {};
    return `<div class="cu-closing"><div><b>${t('تقفيل')} <span class="num">${esc(f.closingRef || '')}</span> · ${fmtDate(d)}</b>
        <div class="small muted">${f.createdBy ? `${t('بواسطة')} ${esc(f.createdBy)}${f.createdAt ? ' · ' + fmtDateTime(f.createdAt) : ''} · ` : ''}${linesOn(d)} ${t('إجراء')} · ${ps.length} ${t('شخص')} · ${list.length} ${t('فاتورة')} · ${fmtMoney(sum(list.map(i => i.total)))}</div></div>
      <span class="spacer"></span><button class="btn sm primary" data-closing="${d}">📄 ${t('الملخص والفواتير')}</button>
      <button class="btn sm" data-closing="${d}" data-layout="individual">👤 ${t('+ كشف فردي لكل موظف')}</button>
      ${can('custody.delete') && !locked && d === dates[dates.length - 1] ? `<button class="btn sm danger" data-reopen="${d}">↩️ ${t('إلغاء التقفيل')}</button>` : ''}
      ${locked ? `<span class="small muted" title="${esc(t('الحسابات اعتمدت فاتورة من التقفيل ده'))}">🔐 ${t('نهائي')}</span>` : ''}
      <div class="cu-invoices">${list.map(i => `<div class="cu-invoice"><b class="num">${esc(i.number)}</b>${i.ccCode ? `<span class="chip on num">${esc(i.ccCode)}</span>` : ''}<span>${esc(i.costCenter || t('بدون مركز تكلفة'))}</span>
        <span class="small muted">${i.employees} ${t('موظف')}${i.supportAmount ? '' : ' · ' + t('من غير دعم إداري')}</span><b class="num">${fmtMoney(i.total)}</b>${invoiceStatusChip(i)}
        <span class="spacer"></span>${invoiceButtons(i)}</div>`).join('')}</div></div>`; }).join('')}</div>`;
}
/** تقفيل بالإجراء: كل إجراء «تم» بيتقفل لوحده (مش لازم الشخص يخلّص كل إجراءاته).
    الدعم الإداري مرة لكل موظف في العهدة — في أول تقفيل فيه إجراء ليه. */
function openCustodyCloseModal(c, after) {
  const persons = custodyPersons(c).filter(p => p.lines.some(l => l.done && !l.closedDate));
  const ready = l => l.done && !l.closedDate;
  const charged = p => !p.lines.some(l => l.closedDate);          // لسه ماتحسبلوش دعم في تقفيل قبل كده
  const lastClosed = uniq((c.lines || []).map(l => l.closedDate).filter(Boolean)).sort().pop() || '';
  const groups = new Map();
  persons.forEach(p => { const k = p.costCenter || t('بدون مركز تكلفة'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  const items = uniq(persons.flatMap(p => p.lines.filter(ready).map(l => l.itemName)));
  const m = openModal({
    title: `🔒 ${t('تقفيل العهدة')} ${esc(custodyNo(c))}`, size: 'wide',
    body: `<div class="form" id="cl-form">
        <label>${t('الدعم الإداري لكل موظف (د.ك)')}<input type="number" step="0.001" min="0" name="adminFee" value="${esc(custodySettings().supportFee ?? 20)}"></label>
        <label>${t('تاريخ التقفيل')}<input type="date" name="date" value="${todayISO() > lastClosed ? todayISO() : ''}" ${lastClosed ? `min="${lastClosed}"` : ''}></label>
        <label>${t('الملف')}<select name="layout">${opt('', t('الملخص + فاتورة لكل مركز تكلفة'), true)}${opt('individual', t('+ كشف فردي لكل موظف (ملحق)'), false)}</select></label>
        <label>${t('اختيار سريع')}<select id="cl-pick">${opt('', t('— اختيار —'), true)}${opt('__all', t('كل الجاهز'), false)}${opt('__none', t('مسح الاختيار'), false)}${items.map(i => opt(i, `${t('كل')} «${i}»`, false)).join('')}</select></label></div>
      <div class="notice small" style="margin:8px 0">${t('كل إجراء «تم» بيتقفل لوحده — مش لازم الموظف يخلّص كل إجراءاته. التقفيل بيطلّع فاتورة لكل مركز تكلفة (الرسوم الحكومية + الدعم الإداري مرة واحدة لكل موظف في العهدة، في أول تقفيل فيه إجراء ليه). الفاتورة «بانتظار الحسابات» لحد ما تتعلّم «اعتمدتها الحسابات» — قبلها تقدر تلغي التقفيل (الأحدث بس)، وبعدها لأ.')}</div>
      ${lastClosed ? `<div class="small muted" style="margin-bottom:6px">${t('آخر تقفيل للعهدة دي')}: ${fmtDate(lastClosed)} — ${t('التاريخ الجديد لازم يكون بعده.')}</div>` : ''}
      <div class="table-wrap"><table class="data"><thead><tr><th style="width:34px"><input type="checkbox" id="cl-all" checked></th><th>${t('الإجراء')}</th><th>${t('الجهة')}</th><th>${t('الرسوم الحكومية')}</th></tr></thead><tbody>
      ${[...groups.entries()].map(([cc, ps]) => `<tr class="cu-person"><td colspan="4">🧾 ${esc(cc)} <span class="small muted">(${ps.length})</span>${custodyNoSupport(ps[0].costCenter) ? ` <span class="chip">${t('من غير دعم إداري')}</span>` : ''}</td></tr>
        ${ps.map(p => `<tr class="cu-cl-person"><td><input type="checkbox" data-clp="${esc(p.key)}" checked></td><td colspan="3"><b>${esc(p.name)}</b> <span class="small muted num">${esc(p.civilId || '')}</span>
            ${charged(p) ? '' : ` <span class="chip" title="${esc(t('اتقفل له إجراء قبل كده — الدعم الإداري اتحسب في أول تقفيل'))}">${t('الدعم اتحسب قبل كده')}</span>`}</td></tr>
          ${p.lines.map(l => ready(l)
            ? `<tr><td><input type="checkbox" data-cl="${l.id}" data-person="${esc(p.key)}" data-item="${esc(l.itemName)}" checked></td><td>${esc(l.itemName)}</td><td class="small muted">${esc(l.authority || '')}</td><td class="num">${fmtMoney(custodyLineAmount(l))}</td></tr>`
            : `<tr class="muted"><td></td><td>${esc(l.itemName)}</td><td class="small">${l.closedDate ? `🔒 ${t('اتقفل')} ${fmtDate(l.closedDate)}` : `⏳ ${t('لسه ماخلصش')}`}</td><td></td></tr>`).join('')}`).join('')}`).join('')}
      </tbody></table></div>
      <div class="row cu-cl-sum" id="cl-sum"></div>
      <div id="cl-exp" style="margin-top:10px"></div>`,
    foot: `<button class="btn primary" data-go>🔒 ${t('تقفيل ومعاينة الفواتير')}</button><span class="spacer"></span><button class="btn" data-close>${t('إلغاء')}</button>`,
  });
  const E = m.el;
  const lineById = new Map(persons.flatMap(p => p.lines.map(l => [String(l.id), l])));
  // بنود التجديد المتحددة للتقفيل ومالهاش انتهاء جديد ← خانة لكل واحد (مطلوبة) + «نفس التاريخ للكل». الاقتراح: التاريخ
  // اللي في بيانات الموظف لو اتجدد من برّه العهدة
  const expVals = {};
  let expSig = null;
  const drawExp = () => {
    const ids = new Set(chosen().map(String));
    const need = persons.flatMap(p => p.lines.filter(l => ids.has(String(l.id)) && l.updatesField && !l.newExpiry && p.kind === 'employee').map(l => ({ l, p })));
    const sig = need.map(x => x.l.id).join(',');
    if (sig === expSig) return;
    expSig = sig;
    const box = $('#cl-exp', E);
    if (!need.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<h4 class="cu-h">📅 ${t('تواريخ الانتهاء الجديدة')} (${need.length})</h4>
      <div class="small muted" style="margin-bottom:6px">${t('التقفيل بيحدّث بيانات الموظف — التاريخ الجديد مطلوب لكل بند تجديد.')}</div>
      <div class="row" style="gap:6px;margin-bottom:6px"><span class="small">${t('نفس التاريخ للكل')}</span><input type="date" id="cl-exp-all"><button type="button" class="btn sm" id="cl-exp-apply">${t('تطبيق')}</button></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('الموظف')}</th><th>${t('البند')}</th><th>${t('كان')}</th><th><span class="req">${t('الانتهاء الجديد')}</span></th></tr></thead><tbody>
      ${need.map(({ l, p }) => {
        const cur = (IDX.employee[p.id] || {})[l.updatesField];
        if (expVals[l.id] === undefined) expVals[l.id] = cur && (!l.oldExpiry || cur > l.oldExpiry) ? cur : '';
        return `<tr><td><b>${esc(p.name)}</b></td><td>${esc(l.itemName)} <span class="small muted">(${esc(t(CUSTODY_EXPIRY_FIELDS[l.updatesField] || ''))})</span></td>
          <td class="num">${fmtDate(l.oldExpiry) || '—'}</td><td><input type="date" data-clexp="${l.id}" value="${esc(expVals[l.id])}"></td></tr>`;
      }).join('')}</tbody></table></div>`;
    $('#cl-exp-apply', E).onclick = () => { const v = $('#cl-exp-all', E).value; if (!v) return; $$('[data-clexp]', E).forEach(i => { i.value = v; expVals[i.dataset.clexp] = v; }); };
  };
  const boxes = () => $$('[data-cl]', E);
  const chosen = () => boxes().filter(x => x.checked).map(x => lineById.get(x.dataset.cl).id);
  const sumUp = () => {
    const fee = Number($('[name="adminFee"]', E).value) || 0, ids = new Set(chosen().map(String));
    const ls = persons.flatMap(p => p.lines.filter(l => ids.has(String(l.id))).map(l => ({ l, p })));
    const ps = uniq(ls.map(x => x.p.key)).map(k => persons.find(p => p.key === k));
    const g = sum(ls.map(x => custodyLineAmount(x.l)));
    const sup = fee * ps.filter(p => charged(p) && !custodyNoSupport(p.costCenter)).length;
    $$('[data-clp]', E).forEach(b => { const mine = boxes().filter(x => x.dataset.person === b.dataset.clp); b.checked = mine.every(x => x.checked); b.indeterminate = !b.checked && mine.some(x => x.checked); });
    $('#cl-all', E).checked = boxes().every(x => x.checked);
    drawExp();
    $('#cl-sum', E).innerHTML = `<span class="chip">${t('الإجراءات')}: <b>${ls.length}</b></span><span class="chip">${t('الأشخاص')}: <b>${ps.length}</b></span>
      <span class="chip">${t('الفواتير')}: <b>${uniq(ps.map(p => p.costCenter || '')).length}</b></span>
      <span class="chip">${t('الرسوم الحكومية')}: <b>${fmtMoney(g)}</b></span>
      <span class="chip">${t('الدعم الإداري')}: <b>${fmtMoney(sup)}</b></span><span class="chip on">${t('إجمالي الفواتير')}: <b>${fmtMoney(g + sup)}</b></span>`;
  };
  $('#cl-all', E).onchange = ev => { boxes().forEach(x => { x.checked = ev.target.checked; }); sumUp(); };
  $$('[data-clp]', E).forEach(b => b.onchange = () => { boxes().filter(x => x.dataset.person === b.dataset.clp).forEach(x => { x.checked = b.checked; }); sumUp(); });
  $('#cl-pick', E).onchange = ev => {
    const v = ev.target.value; ev.target.value = '';
    if (v) boxes().forEach(x => { x.checked = v === '__all' ? true : v === '__none' ? false : x.dataset.item === v; });
    sumUp();
  };
  E.addEventListener('change', sumUp);
  E.addEventListener('input', ev => { if (ev.target.dataset.clexp) { expVals[ev.target.dataset.clexp] = ev.target.value; return; } sumUp(); });
  sumUp();
  $('[data-go]', E).onclick = async () => {
    const d = formValues($('#cl-form', E)), lines = chosen();
    if (!lines.length) return openBlockAlert(t('اختار إجراء واحد على الأقل'));
    if (!d.date) return openBlockAlert(t('اختار تاريخ التقفيل'));
    if (lastClosed && d.date < lastClosed) return openBlockAlert(`${t('تاريخ التقفيل لازم يكون بعد آخر تقفيل للعهدة دي')} (${fmtDate(lastClosed)})`);
    const exps = $$('[data-clexp]', E);
    const miss = exps.filter(i => !i.value);
    if (miss.length) return openBlockAlert(`${t('سجّل تاريخ الانتهاء الجديد لكل بنود التجديد')} (${miss.length})`);
    const back = exps.find(i => { const l = lineById.get(i.dataset.clexp); return l.oldExpiry && i.value <= l.oldExpiry; });
    if (back) { const l = lineById.get(back.dataset.clexp); return openBlockAlert(`${esc(l.personName)}: ${t('الانتهاء الجديد لازم يبقى بعد القديم')} (${fmtDate(l.oldExpiry)})`); }
    const expiries = Object.fromEntries(exps.map(i => [i.dataset.clexp, i.value]));
    try {
      const r = await persist('POST', `/api/custodies/${c.id}/close`, { lines, adminFee: d.adminFee, date: d.date, expiries }, 'تم التقفيل');
      m.close();
      await custodyPreview(`/api/custodies/${c.id}/closing.pdf?date=${r.date}${d.layout ? '&layout=' + d.layout : ''}`);
      if (after) after();
    } catch (e) { /* ظاهر */ }
  };
}
