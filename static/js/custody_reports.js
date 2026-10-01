/* =====================================================================
   CUSTODY REPORTS — تقارير العهد (معاينة وطباعة بس — openReportWindow)
   1) كشف حساب المستلم   2) أرصدة العهد لحد تاريخ (بأعمار الرصيد)   3) سجل العهد المنصرفة   4) متابعة الفواتير
   + كشف إرسال فواتير (بالمرجع). كلها على العهد اللي ظاهرة للمستخدم (custodiesInView / invoicesInView).
   حساب الفلوس نفس «أرصدة المستلمين»: صرف له = اللي اتصرف فعلًا بتاريخه، اتنفّذ = البنود «تم» بتاريخ تنفيذها
   (والتقفيل المباشر منها) — من غير الدعم الإداري (ده على مراكز التكلفة في الفواتير، مش من فلوس العهد).
   ===================================================================== */
'use strict';

const CU_REPORTS = [
  ['statement', 'كشف حساب المستلم', 'حركة المستلم بالتاريخ: اللي اتصرف له واللي نفّذه والرصيد بعد كل حركة — للمراجعة معاه والتوقيع.'],
  ['balances', 'أرصدة العهد', 'كل المستلمين لحد تاريخ معيّن: صرف له، نفّذ، الباقي معاه — وعمر الرصيد (الفلوس الواقفة من إمتى).'],
  ['register', 'سجل العهد المنصرفة', 'كل عهدة اتصرفت في الفترة في سطر: المطلوب، المنصرف، المنفّذ، اللي اتفوتر، والمتبقي.'],
  ['invoices', 'متابعة الفواتير', 'الفواتير عند الحسابات: الحالة، المرجع، أيام من الإرسال، سبب التعليق أو الرفض، والتحصيل.'],
];
let CU_REP_LAST = 'statement';
const cuDays = (from, to) => { const a = parseDate(from), b = parseDate(to); return a && b ? Math.round((b - a) / 86400000) : null; };
const cuIssuer = () => IDX.company[custodySettings().issuerCompanyId] || null;
const cuAr = (a, b) => String(a || '').localeCompare(String(b || ''), 'ar');
const cuMoney = v => rptNum(Math.round((Number(v) || 0) * 1000) / 1000);
/** الرصيد: السالب (مستحق للمستلم) بالأحمر */
const cuBal = v => (v < -0.0005 ? `<span dir="ltr" style="color:#b3261e;unicode-bidi:isolate">${cuMoney(v)}</span>` : cuMoney(v));
const cuPeriod = (from, to) => (from || to ? `${from ? fmtDate(from) : '…'} — ${to ? fmtDate(to) : '…'}` : t('كل الفترات'));
/** العهد اللي فيها فلوس اتحركت: اتصرفت أو اتقفلت (مش الملغاة ولا الطلبات اللي لسه ماتصرفتش) */
function cuLive() { return custodiesInView().filter(c => c.status !== 'cancelled' && c.status !== 'requested'); }

/** حركات الفلوس بتاريخها: in = صرف للمستلم، out = إجراء اتنفّذ (نفس حساب custodianBalances) */
function custodyMovements(list) {
  const out = [];
  list.forEach(c => {
    if (!c.direct && Number(c.disbursedAmount)) out.push({ date: c.disbursedDate || c.requestDate || '', kind: 'in', c, amount: Number(c.disbursedAmount) });
    (c.lines || []).filter(l => l.done).forEach(l => out.push({ date: l.doneDate || l.closedDate || c.disbursedDate || c.requestDate || '', kind: 'out', c, l, amount: custodyLineAmount(l) }));
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'in' ? -1 : 1) || cuAr(custodyNo(a.c), custodyNo(b.c)));
}

/* ---------- 1) كشف حساب المستلم ---------- */
function printCustodianStatement(R) {
  const names = R.custodian ? [R.custodian] : uniq(cuLive().map(c => c.custodian)).sort(cuAr);
  const many = names.length > 1, tot = { open: 0, in: 0, out: 0 };
  let n = 0, body = '';
  names.forEach(name => {
    const mv = custodyMovements(cuLive().filter(c => c.custodian === name));
    const within = mv.filter(m => (!R.from || m.date >= R.from) && (!R.to || m.date <= R.to));
    const open = sum(mv.filter(m => R.from && m.date < R.from).map(m => (m.kind === 'in' ? m.amount : -m.amount)));
    if (!within.length && Math.abs(open) < 0.0005) return;
    // التنفيذ: سطر لكل (يوم، عهدة) — أو سطر لكل إجراء في «التفصيلي»
    const rows = [];
    within.forEach(m => {
      const last = rows[rows.length - 1];
      if (m.kind === 'in' || R.detail) rows.push({ ...m, n: 1 });
      else if (last && last.kind === 'out' && !last.l && last.c === m.c && last.date === m.date) { last.amount += m.amount; last.n++; }
      else rows.push({ date: m.date, kind: 'out', c: m.c, amount: m.amount, n: 1 });
    });
    const text = r => (r.kind === 'in'
      ? `${t('صرف عهدة')} — ${esc(custodyTypeLabel(r.c.txType))}${r.c.carriedAmount ? ` <small>(${t('منها مستحقات تقفيل مباشر')} ${cuMoney(r.c.carriedAmount)})</small>` : ''}`
      : r.l ? `${esc(r.l.itemName)} — ${esc(r.l.personName)}${r.l.receiptNo ? ` <small>(${t('إيصال')} ${esc(r.l.receiptNo)})</small>` : ''}${r.c.direct ? ` ⚡ ${t('تقفيل مباشر')}` : ''}`
        : `${t('تنفيذ')} ${r.n} ${t('إجراء')} — ${esc(custodyTypeLabel(r.c.txType))}${r.c.direct ? ` ⚡ ${t('تقفيل مباشر')}` : ''}`);
    const ins = sum(rows.filter(r => r.kind === 'in').map(r => r.amount)), outs = sum(rows.filter(r => r.kind === 'out').map(r => r.amount));
    let bal = open;
    if (many) body += `<tr class="grp"><td colspan="7">${esc(name)}<small>${rows.length} ${t('حركة')}</small></td></tr>`;
    body += `<tr class="sub"><td></td><td class="num">${R.from ? fmtDate(R.from) : ''}</td><td class="txt" colspan="2">${t('رصيد أول المدة')}</td><td></td><td></td><td class="num">${cuBal(open)}</td></tr>`;
    rows.forEach((r, i) => {
      bal += r.kind === 'in' ? r.amount : -r.amount;
      body += `<tr class="${i % 2 ? 'z' : ''}"><td class="idx">${++n}</td><td class="num">${fmtDate(r.date)}</td><td class="txt">${text(r)}</td><td class="num">${esc(custodyNo(r.c))}</td>
        <td class="num">${r.kind === 'in' ? cuMoney(r.amount) : ''}</td><td class="num">${r.kind === 'out' ? cuMoney(r.amount) : ''}</td><td class="num">${cuBal(bal)}</td></tr>`;
    });
    body += `<tr class="sub"><td></td><td class="num">${R.to ? fmtDate(R.to) : ''}</td><td class="txt" colspan="2"><b>${t('رصيد آخر المدة')}</b>${many ? ' — ' + esc(name) : ''}</td>
      <td class="num">${cuMoney(ins)}</td><td class="num">${cuMoney(outs)}</td><td class="num"><b>${cuBal(open + ins - outs)}</b></td></tr>`;
    tot.open += open; tot.in += ins; tot.out += outs;
  });
  if (!body) return openBlockAlert(t('مفيش حركات للمستلم في الفترة دي.'));
  const close = tot.open + tot.in - tot.out;
  openReportWindow({
    title: t('كشف حساب المستلم'), subtitle: R.custodian || t('كل المستلمين'), company: cuIssuer(), landscape: false,
    meta: [[t('الفترة'), cuPeriod(R.from, R.to)]],
    criteria: `${t('المستلم')}: ${esc(R.custodian || t('كل المستلمين'))} · ${t('الرصيد = اللي اتصرف له − اللي اتنفّذ (من غير الدعم الإداري). الرصيد بالسالب = مستحق للمستلم.')}`,
    summary: [[cuMoney(tot.open), t('رصيد أول المدة')], [cuMoney(tot.in), t('اتصرف في الفترة')], [cuMoney(tot.out), t('اتنفّذ في الفترة')], [cuMoney(close), t('رصيد آخر المدة (د.ك)')]],
    body: `<table class="rpt"><thead><tr><th>#</th><th>${t('التاريخ')}</th><th class="txt">${t('البيان')}</th><th>${t('رقم العهدة')}</th><th class="num">${t('صرف له')}</th><th class="num">${t('اتنفّذ')}</th><th class="num">${t('الرصيد')}</th></tr></thead>
      <tbody>${body}</tbody>${many ? `<tfoot><tr><td></td><td></td><td class="txt" colspan="2">${t('الإجمالي العام')} (${t('أول المدة')}: ${cuMoney(tot.open)})</td><td class="num">${cuMoney(tot.in)}</td><td class="num">${cuMoney(tot.out)}</td><td class="num">${cuBal(close)}</td></tr></tfoot>` : ''}</table>`,
    sign: [t('المستلم'), t('المحاسب'), t('المدير')],
  });
  return true;
}

/* ---------- 2) أرصدة العهد لحد تاريخ — بأعمار الرصيد ---------- */
function custodyBalanceRows(D) {
  const all = cuLive(), every = Object.fromEntries((STATE.custodies || []).map(c => [c.id, c])), by = {};
  custodyMovements(all).filter(m => m.date <= D).forEach(m => {
    const b = by[m.c.custodian] || (by[m.c.custodian] = { name: m.c.custodian, ins: [], spent: 0 });
    if (m.kind === 'in') b.ins.push(m); else b.spent += m.amount;
  });
  const funded = c => { const k = every[c.carryToId]; return !!k && ['disbursed', 'closed'].includes(k.status) && (k.disbursedDate || '') <= D; };
  return Object.values(by).map(b => {
    const received = sum(b.ins.map(m => m.amount)), age = [0, 0, 0, 0];
    let used = b.spent;                          // الأقدم بيتصرف منه الأول ← الباقي هو الرصيد بعمره
    b.ins.forEach(m => {
      const take = Math.min(used, m.amount), left = m.amount - take, d = cuDays(m.date, D);
      used -= take;
      if (left > 0.0005) age[d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3] += left;
    });
    const mine = all.filter(c => c.custodian === b.name);
    const open = mine.filter(c => !c.direct && c.disbursedDate && c.disbursedDate <= D && (c.status === 'disbursed' || (c.closedDate || '') > D));
    const oldest = open.map(c => c.disbursedDate).sort()[0];
    const due = sum(mine.filter(c => c.direct && (c.requestDate || '') <= D && !funded(c)).map(c => sum((c.lines || []).filter(l => l.done && (l.doneDate || '') <= D).map(custodyLineAmount))));
    return { name: b.name, received, spent: b.spent, balance: received - b.spent, age, open: open.length, oldest: oldest ? cuDays(oldest, D) : null, due };
  }).sort((a, b) => b.balance - a.balance || cuAr(a.name, b.name));
}
function printCustodyBalances(R) {
  const D = R.asOf || todayISO(), rows = custodyBalanceRows(D);
  if (!rows.length) return openBlockAlert(t('مفيش عهد اتصرفت لحد التاريخ ده.'));
  const T = k => sum(rows.map(r => r[k])), A = i => sum(rows.map(r => r.age[i])), z = v => (Math.abs(v) < 0.0005 ? '—' : cuMoney(v));
  openReportWindow({
    title: t('أرصدة العهد'), subtitle: `${t('لحد')} ${fmtDate(D)}`, company: cuIssuer(), landscape: true,
    meta: [[t('الرصيد لحد تاريخ'), fmtDate(D)]],
    criteria: `${t('الرصيد = اللي اتصرف للمستلم − اللي اتنفّذ فعلًا لحد التاريخ (من غير الدعم الإداري). عمر الرصيد محسوب على إن الأقدم بيتصرف منه الأول. الرصيد بالسالب = مستحق للمستلم.')}`,
    summary: [[rows.length, t('مستلم')], [cuMoney(T('received')), t('اتصرف لهم')], [cuMoney(T('spent')), t('اتنفّذ')], [cuMoney(T('balance')), t('الرصيد مع المستلمين (د.ك)')], [cuMoney(A(3)), t('واقف من أكتر من 90 يوم')]],
    body: `<table class="rpt"><thead><tr><th rowspan="2">#</th><th rowspan="2" class="txt">${t('المستلم')}</th><th rowspan="2" class="num">${t('صرف له')}</th><th rowspan="2" class="num">${t('اتنفّذ')}</th><th rowspan="2" class="num">${t('الرصيد معاه')}</th>
        <th colspan="4">${t('عمر الرصيد (يوم)')}</th><th rowspan="2">${t('عهد مفتوحة')}</th><th rowspan="2">${t('أقدم عهدة مفتوحة (يوم)')}</th><th rowspan="2" class="num">${t('تقفيل مباشر لسه مااتعوّضش')}</th></tr>
        <tr><th class="num">0–30</th><th class="num">31–60</th><th class="num">61–90</th><th class="num">+90</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${i % 2 ? 'z' : ''}"><td class="idx">${i + 1}</td><td class="txt"><b>${esc(r.name)}</b></td><td class="num">${cuMoney(r.received)}</td><td class="num">${cuMoney(r.spent)}</td><td class="num"><b>${cuBal(r.balance)}</b></td>
        ${r.age.map((v, k) => `<td class="num"${k === 3 && v > 0.0005 ? ' style="color:#b3261e;font-weight:700"' : ''}>${z(v)}</td>`).join('')}<td class="num">${r.open || '—'}</td><td class="num">${r.oldest ?? '—'}</td><td class="num">${z(r.due)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td class="txt">${t('الإجمالي')} (${rows.length})</td><td class="num">${cuMoney(T('received'))}</td><td class="num">${cuMoney(T('spent'))}</td><td class="num">${cuBal(T('balance'))}</td>
        ${[0, 1, 2, 3].map(k => `<td class="num">${z(A(k))}</td>`).join('')}<td class="num">${T('open')}</td><td></td><td class="num">${z(T('due'))}</td></tr></tfoot></table>`,
    sign: [t('المحاسب'), t('راجعه'), t('المدير')],
  });
  return true;
}

/* ---------- 3) سجل العهد المنصرفة ---------- */
function printCustodyRegister(R) {
  const when = c => (c.direct ? c.requestDate : c.disbursedDate) || '';
  const list = cuLive().filter(c => when(c) && (!R.from || when(c) >= R.from) && (!R.to || when(c) <= R.to) && (!R.custodian || c.custodian === R.custodian)
    && (!R.type || c.txType === R.type) && (!R.state || (R.state === 'open' ? c.status === 'disbursed' : c.status === 'closed')) && (R.direct || !c.direct))
    .sort((a, b) => when(a).localeCompare(when(b)) || cuAr(custodyNo(a), custodyNo(b)));
  if (!list.length) return openBlockAlert(t('مفيش عهد اتصرفت في الفترة دي.'));
  const key = c => (R.group === 'custodian' ? c.custodian : R.group === 'type' ? custodyTypeLabel(c.txType) : '');
  const row = c => {
    const tt = custodyTotals(c);
    return { c, tt, invoiced: sum((c.lines || []).filter(l => l.closedDate).map(custodyLineAmount)),
      days: c.direct ? null : cuDays(c.disbursedDate, c.status === 'closed' && c.closedDate ? c.closedDate : todayISO()) };
  };
  const groups = new Map();
  list.map(row).forEach(r => { const k = key(r.c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const S = (rs, f) => sum(rs.map(f)), cols = 13;
  const totals = (cls, label, rs) => `<tr class="${cls}"><td></td><td class="txt" colspan="5">${label}</td><td class="num">${cuMoney(S(rs, r => r.tt.planned))}</td><td class="num">${cuMoney(S(rs, r => r.tt.gross))}</td>
    <td class="num">${cuMoney(S(rs, r => r.tt.spent))}</td><td class="num">${cuMoney(S(rs, r => r.invoiced))}</td><td class="num">${cuBal(S(rs, r => r.tt.remaining))}</td><td></td><td></td></tr>`;
  const state = c => (c.direct ? `⚡ ${c.carryToNumber ? `${t('اتضاف لطلب')} ${esc(c.carryToNumber)}` : t('لسه مااتضافش لطلب')}` : esc(t((CUSTODY_STATUS[c.status] || [c.status])[0])));
  let n = 0, body = '';
  [...groups.entries()].sort((a, b) => cuAr(a[0], b[0])).forEach(([k, rs]) => {
    if (R.group) body += `<tr class="grp"><td colspan="${cols}">${esc(k || '—')}<small>${rs.length} ${t('عهدة')}</small></td></tr>`;
    body += rs.map((r, i) => `<tr class="${i % 2 ? 'z' : ''}"><td class="idx">${++n}</td><td class="num"><b>${esc(custodyNo(r.c))}</b></td><td class="num">${fmtDate(when(r.c))}</td><td class="txt">${esc(custodyTypeLabel(r.c.txType))}</td>
      <td class="txt">${esc(r.c.custodian)}</td><td class="num">${r.tt.persons}</td><td class="num">${cuMoney(r.tt.planned)}</td><td class="num">${r.c.direct ? '—' : cuMoney(r.tt.gross)}</td><td class="num">${cuMoney(r.tt.spent)}</td>
      <td class="num">${cuMoney(r.invoiced)}</td><td class="num">${cuBal(r.tt.remaining)}</td><td>${state(r.c)}</td><td class="num">${r.days ?? '—'}</td></tr>`).join('');
    if (R.group && groups.size > 1) body += totals('sub', `${t('إجمالي')} ${esc(k || '—')}`, rs);
  });
  const all = [...groups.values()].flat();
  openReportWindow({
    title: t('سجل العهد المنصرفة'), subtitle: cuPeriod(R.from, R.to), company: cuIssuer(), landscape: true,
    meta: [[t('الفترة'), cuPeriod(R.from, R.to)]],
    criteria: [`${t('المستلم')}: ${esc(R.custodian || t('الكل'))}`, `${t('نوع المعاملة')}: ${esc(R.type ? custodyTypeLabel(R.type) : t('الكل'))}`,
      `${t('الحالة')}: ${esc(t(R.state === 'open' ? 'المفتوحة بس' : R.state === 'closed' ? 'المقفولة بس' : 'الكل'))}`, R.direct ? t('شامل التقفيل المباشر (⚡)') : t('من غير التقفيل المباشر')].join(' · '),
    summary: [[all.length, t('عهدة')], [cuMoney(S(all, r => r.tt.gross)), t('المنصرف')], [cuMoney(S(all, r => r.tt.spent)), t('المنفّذ')], [cuMoney(S(all, r => r.invoiced)), t('اتفوتر')], [cuMoney(S(all, r => r.tt.remaining)), t('المتبقي (د.ك)')]],
    body: `<table class="rpt"><thead><tr><th>#</th><th>${t('رقم العهدة')}</th><th>${t('تاريخ الصرف')}</th><th class="txt">${t('النوع')}</th><th class="txt">${t('المستلم')}</th><th>${t('الأشخاص')}</th><th class="num">${t('المطلوب')}</th>
      <th class="num">${t('المنصرف')}</th><th class="num">${t('المنفّذ')}</th><th class="num">${t('اتفوتر')}</th><th class="num">${t('المتبقي')}</th><th>${t('الحالة')}</th><th>${t('أيام')}</th></tr></thead>
      <tbody>${body}</tbody><tfoot>${totals('', `${t('الإجمالي العام')} (${all.length})`, all)}</tfoot></table>`,
    sign: [t('أعده'), t('المحاسب'), t('المدير')],
  });
  return true;
}

/* ---------- 4) متابعة الفواتير (الحسابات) ---------- */
function printInvoiceFollowUp(R) {
  const cus = Object.fromEntries((STATE.custodies || []).map(c => [c.id, c])), agOf = i => (invoiceAgency(i) || {}).id || '';
  const list = invoicesInView().filter(i => (!R.ifrom || i.closingDate >= R.ifrom) && (!R.ito || i.closingDate <= R.ito)
    && (!R.istatus || (R.istatus === 'open' ? !INVOICE_FINAL.includes(i.status) : i.status === R.istatus)) && (!R.iag || (R.iag === '__none' ? !agOf(i) : agOf(i) === R.iag)))
    .sort((a, b) => (a.closingDate || '').localeCompare(b.closingDate || '') || cuAr(a.number, b.number));
  if (!list.length) return openBlockAlert(t('مفيش فواتير بالاختيارات دي.'));
  const order = Object.keys(INVOICE_STATUS), label = i => t(INVOICE_STATUS[i.status] ? INVOICE_STATUS[i.status][0] : i.status);
  const key = i => (R.igroup === 'status' ? label(i) : R.igroup === 'to' ? invoiceRecipient(i) || '—' : R.igroup === 'cc' ? i.costCenter || t('بدون مركز تكلفة') : '');
  const groups = new Map();
  (R.igroup === 'status' ? [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)) : list).forEach(i => { const k = key(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  // أيام من الإرسال: لحد التحصيل لو اتحصّلت، وإلا لحد النهاردة
  const days = i => (i.sentDate ? cuDays(i.sentDate, i.status === 'collected' && i.collectedDate ? i.collectedDate : todayISO()) : null);
  const cols = 13, S = (rs, st) => sum(rs.filter(i => st.includes(i.status)).map(i => i.total));
  let n = 0, body = '';
  [...groups.entries()].sort((a, b) => (R.igroup === 'status' ? 0 : cuAr(a[0], b[0]))).forEach(([k, rs]) => {
    if (R.igroup) body += `<tr class="grp"><td colspan="${cols}">${esc(k)}<small>${rs.length} ${t('فاتورة')} · ${cuMoney(sum(rs.map(i => i.total)))}</small></td></tr>`;
    body += rs.map((i, x) => { const c = cus[i.custodyId]; return `<tr class="${x % 2 ? 'z' : ''}"><td class="idx">${++n}</td><td class="num"><b>${esc(i.number)}</b></td><td class="num">${fmtDate(i.closingDate)}</td>
      <td class="txt">${esc(i.costCenter || t('بدون مركز تكلفة'))}</td><td class="txt">${esc(invoiceRecipient(i))}</td><td class="num">${c ? esc(custodyNo(c)) : ''}</td><td class="num"><b>${cuMoney(i.total)}</b></td><td>${esc(label(i))}</td>
      <td class="num">${esc(i.sentRef || '')}</td><td class="num">${fmtDate(i.sentDate)}</td><td class="num">${days(i) ?? ''}</td>
      <td class="num">${i.collectedRef ? `${esc(i.collectedRef)}<br>${fmtDate(i.collectedDate)}` : ''}</td><td class="txt">${esc(i.note || '')}</td></tr>`; }).join('');
    if (R.igroup && groups.size > 1) body += `<tr class="sub"><td></td><td class="txt" colspan="5">${t('إجمالي')} ${esc(k)}</td><td class="num">${cuMoney(sum(rs.map(i => i.total)))}</td><td colspan="6"></td></tr>`;
  });
  const ag = R.iag === '__none' ? t('من غير وكيل') : R.iag ? agencyName(agencyById(R.iag)) : t('الكل');
  openReportWindow({
    title: t('متابعة الفواتير'), subtitle: cuPeriod(R.ifrom, R.ito), company: cuIssuer(), landscape: true,
    meta: [[t('تاريخ الفاتورة'), cuPeriod(R.ifrom, R.ito)]],
    criteria: `${t('الحالة')}: ${esc(R.istatus === 'open' ? t('اللي لسه مااتعتمدتش') : R.istatus ? t(INVOICE_STATUS[R.istatus][0]) : t('الكل'))} · ${t('الوكيل')}: ${esc(ag)} · ${t('المبالغ إجمالي الفاتورة (الرسوم الحكومية + الدعم الإداري).')}`,
    summary: [[`${list.length} · ${cuMoney(sum(list.map(i => i.total)))}`, t('الفواتير (د.ك)')], [cuMoney(S(list, ['pending'])), t('بانتظار الحسابات')], [cuMoney(S(list, ['sent'])), t('اتبعتت ومستنية')],
      [cuMoney(S(list, ['hold', 'rejected'])), t('معلّقة / مرفوضة')], [cuMoney(S(list, ['approved'])), t('معتمدة ولسه مااتحصّلتش')], [cuMoney(S(list, ['collected'])), t('اتحصّلت')]],
    body: `<table class="rpt"><thead><tr><th>#</th><th>${t('رقم الفاتورة')}</th><th>${t('التاريخ')}</th><th class="txt">${t('فاتورة إلى')}</th><th class="txt">${t('الجهة المبعوت لها')}</th><th>${t('العهدة')}</th><th class="num">${t('الإجمالي')}</th>
      <th>${t('الحالة')}</th><th>${t('رقم المرجع')}</th><th>${t('تاريخ الإرسال')}</th><th>${t('أيام من الإرسال')}</th><th>${t('التحصيل')}</th><th class="txt">${t('سبب التعليق / الرفض')}</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><td></td><td class="txt" colspan="5">${t('الإجمالي العام')} (${list.length})</td><td class="num">${cuMoney(sum(list.map(i => i.total)))}</td><td colspan="6"></td></tr></tfoot></table>`,
    sign: [t('المحاسب'), t('راجعه'), t('المدير')],
  });
  return true;
}

/* ---------- كشف إرسال فواتير (بالمرجع) — بيتبعت مع الفواتير للوكيل / الشركة ---------- */
function printInvoiceSlip(ref) {
  const list = (STATE.invoices || []).filter(i => i.sentRef === ref).sort((a, b) => cuAr(a.number, b.number));
  if (!list.length) return toast(t('مفيش فواتير بالمرجع ده'), 'err');
  const to = uniq(list.map(invoiceRecipient)).join('، ');
  printLog(`${t('كشف إرسال فواتير')} — ${ref}`, 'custody');
  openReportWindow({
    title: t('كشف إرسال فواتير'), subtitle: `${t('المرجع')}: ${ref}`, company: cuIssuer(), landscape: false,
    meta: [[t('رقم المرجع'), ref], [t('تاريخ الإرسال'), fmtDate(list[0].sentDate)], [t('إلى'), to]],
    summary: [[list.length, t('عدد الفواتير')], [sum(list.map(i => i.employees)), t('الموظفين')], [cuMoney(sum(list.map(i => i.total))), t('الإجمالي (د.ك)')]],
    body: `<table class="rpt"><thead><tr><th>#</th><th>${t('رقم الفاتورة')}</th><th>${t('تاريخ الفاتورة')}</th><th class="txt">${t('فاتورة إلى')}</th><th>${t('الموظفين')}</th><th class="num">${t('الرسوم الحكومية')}</th>
      <th class="num">${t('الدعم الإداري')}</th><th class="num">${t('الإجمالي')} (${t('د.ك')})</th></tr></thead>
      <tbody>${list.map((i, x) => `<tr class="${x % 2 ? 'z' : ''}"><td class="idx">${x + 1}</td><td class="num"><b>${esc(i.number)}</b></td><td class="num">${fmtDate(i.closingDate)}</td><td class="txt">${esc(i.costCenter || t('بدون مركز تكلفة'))}</td>
        <td class="num">${i.employees}</td><td class="num">${cuMoney(i.govAmount)}</td><td class="num">${cuMoney(i.supportAmount)}</td><td class="num"><b>${cuMoney(i.total)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td class="txt" colspan="3">${t('الإجمالي')} (${list.length})</td><td class="num">${sum(list.map(i => i.employees))}</td><td class="num">${cuMoney(sum(list.map(i => i.govAmount)))}</td>
        <td class="num">${cuMoney(sum(list.map(i => i.supportAmount)))}</td><td class="num">${cuMoney(sum(list.map(i => i.total)))}</td></tr></tfoot></table>`,
    sign: [t('المحاسب'), t('استلمها (الاسم والتوقيع)'), t('تاريخ الاستلام')],
  });
}

/* ---------- نافذة التقارير ---------- */
function openCustodyReportsModal(start) {
  const first = todayISO().slice(0, 8) + '01';
  const R = { rep: start || CU_REP_LAST, custodian: '', from: first, to: todayISO(), asOf: todayISO(), type: '', state: '', group: 'custodian', detail: false, direct: true,
    ifrom: '', ito: '', istatus: '', iag: '', igroup: 'status' };
  const m = openModal({
    title: '🖨️ ' + t('تقارير العهد'), size: 'wide',
    body: `<div class="tabs" id="cr-tabs"></div><div class="notice small" id="cr-desc" style="margin:10px 0"></div><div class="form" id="cr-form"></div>`,
    foot: `<button class="btn primary" data-go>🖨️ ${t('معاينة وطباعة')}</button><span class="small muted">${t('معاينة وطباعة بس — التنزيل مقفول')}</span><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const E = m.el;
  const names = uniq(cuLive().map(c => c.custodian)).sort(cuAr);
  const who = `<label>${t('المستلم')}<select name="custodian">${opt('', t('— كل المستلمين —'), !R.custodian)}${names.map(x => opt(x, x, x === R.custodian)).join('')}</select></label>`;
  const range = (a, b, lbl) => `<label>${t(lbl || 'من تاريخ')}<input type="date" name="${a}" value="${esc(R[a])}"></label><label>${t('إلى تاريخ')}<input type="date" name="${b}" value="${esc(R[b])}" max="${todayISO()}"></label>`;
  const fields = {
    statement: () => `${who}${range('from', 'to')}<label class="check"><input type="checkbox" name="detail" ${R.detail ? 'checked' : ''}> ${t('تفصيل كل إجراء (اسم الموظف ورقم الإيصال)')}</label>`,
    balances: () => `<label>${t('الرصيد لحد تاريخ')}<input type="date" name="asOf" value="${esc(R.asOf)}" max="${todayISO()}"></label>`,
    register: () => `${range('from', 'to', 'اتصرفت من تاريخ')}${who}
      <label>${t('نوع المعاملة')}<select name="type">${opt('', t('— كل الأنواع —'), !R.type)}${Object.entries(CUSTODY_TYPES).map(([k, v]) => opt(k, t(v.label), k === R.type)).join('')}</select></label>
      <label>${t('الحالة')}<select name="state">${opt('', t('الكل'), !R.state)}${opt('open', t('المفتوحة بس'), R.state === 'open')}${opt('closed', t('المقفولة بس'), R.state === 'closed')}</select></label>
      <label>${t('التجميع')}<select name="group">${opt('custodian', t('بالمستلم'), R.group === 'custodian')}${opt('type', t('بنوع المعاملة'), R.group === 'type')}${opt('', t('من غير تجميع'), !R.group)}</select></label>
      <label class="check"><input type="checkbox" name="direct" ${R.direct ? 'checked' : ''}> ⚡ ${t('يشمل التقفيل المباشر')}</label>`,
    invoices: () => `${range('ifrom', 'ito', 'تاريخ الفاتورة من')}
      <label>${t('الحالة')}<select name="istatus">${opt('', t('الكل'), !R.istatus)}${opt('open', t('اللي لسه مااتعتمدتش'), R.istatus === 'open')}${Object.entries(INVOICE_STATUS).map(([k, [l]]) => opt(k, t(l), k === R.istatus)).join('')}</select></label>
      <label>${t('الوكيل')}<select name="iag">${opt('', t('الكل'), !R.iag)}${(STATE.agencies || []).map(a => opt(a.id, agencyName(a), a.id === R.iag)).join('')}${opt('__none', t('من غير وكيل'), R.iag === '__none')}</select></label>
      <label>${t('التجميع')}<select name="igroup">${opt('status', t('بالحالة'), R.igroup === 'status')}${opt('to', t('بالجهة المبعوت لها'), R.igroup === 'to')}${opt('cc', t('بمركز التكلفة'), R.igroup === 'cc')}${opt('', t('من غير تجميع'), !R.igroup)}</select></label>`,
  };
  const keep = () => Object.assign(R, Object.fromEntries(Object.entries(formValues($('#cr-form', E))).map(([k, v]) => [k, v ?? ''])));
  const draw = () => {
    $('#cr-tabs', E).innerHTML = CU_REPORTS.map(([k, l]) => `<button data-rep="${k}" class="${k === R.rep ? 'active' : ''}">${esc(t(l))}</button>`).join('');
    $('#cr-desc', E).textContent = t(CU_REPORTS.find(x => x[0] === R.rep)[2]);
    $('#cr-form', E).innerHTML = fields[R.rep]();
    $$('[data-rep]', E).forEach(b => b.onclick = () => { keep(); R.rep = CU_REP_LAST = b.dataset.rep; draw(); });
  };
  draw();
  $('[data-go]', E).onclick = () => {
    keep();
    const [a, b] = R.rep === 'invoices' ? [R.ifrom, R.ito] : [R.from, R.to];
    if (R.rep !== 'balances' && a && b && a > b) return openBlockAlert(t('تاريخ البداية بعد تاريخ النهاية'));
    const ok = ({ statement: printCustodianStatement, balances: printCustodyBalances, register: printCustodyRegister, invoices: printInvoiceFollowUp })[R.rep](R);
    if (ok === true) printLog(t(CU_REPORTS.find(x => x[0] === R.rep)[1]), 'custody');
  };
}
