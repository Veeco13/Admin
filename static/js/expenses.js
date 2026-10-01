/* =====================================================================
   EXPENSES — لوحة المصروفات الحكومية (تبويب «المصروفات» في «العهد والمصروفات» — صلاحية custody.expenses)
   المصدر /api/expenses: فواتير **كل** العهد في نطاق المستخدم (مش عهده بس) + بنودها المقفولة + الرصيد مع المستلمين.
   المصروف بيتحسب بتاريخ التقفيل (تاريخ الفاتورة): الرسوم الحكومية + الدعم الإداري.
   الرسم: عمودين متراكمين لكل شهر (لونين ثابتين — الرسوم / الدعم)، والجدول تحته هو نفس الأرقام. معاينة وطباعة بس.
   ===================================================================== */
'use strict';

const EXP = { data: null, state: null, loading: false, error: '', picks: [] };
const EXP_PERIODS = { m12: 'آخر 12 شهر', year: 'السنة دي', last: 'السنة اللي فاتت' };
const EXP_NONE = '__none';                       // فلتر «بدون مركز تكلفة»

function expFilters() { return UI.custody.ex = Object.assign({ period: 'm12', company: '', cc: '', type: '', approved: false }, UI.custody.ex || {}); }
/** البيانات بتتجاب مرة مع كل تحميل للحالة (STATE جديدة ← جلب جديد)، والشاشة بتترسم تاني لما توصل */
function expensesLoad(force) {
  if (EXP.loading || (!force && EXP.state === STATE)) return;
  EXP.loading = true;
  const st = STATE;
  api('GET', '/api/expenses').then(d => { EXP.data = d; EXP.error = ''; }).catch(e => { EXP.error = e.message; })
    .finally(() => { EXP.loading = false; EXP.state = st; if ($('#ex-root')) render(); });
}
function expYm(y, m) { const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function expMonths(period) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  if (period === 'year') return Array.from({ length: m + 1 }, (_, i) => expYm(y, i));
  if (period === 'last') return Array.from({ length: 12 }, (_, i) => expYm(y - 1, i));
  return Array.from({ length: 12 }, (_, i) => expYm(y, m - 11 + i));
}
const expMonthLabel = ym => `${ym.slice(5)}/${ym.slice(2, 4)}`;
const expNum = v => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const expCell = v => (v ? expNum(v) : '<span class="muted">—</span>');
/** فلاتر اللوحة على الفواتير أو البنود (months = null ← من غير فلتر الفترة) */
function expFilter(rows, F, months) {
  const set = months && new Set(months);
  return rows.filter(r => (!set || set.has((r.closingDate || '').slice(0, 7))) && (!F.company || (r.companyId || '') === F.company)
    && (!F.cc || (F.cc === EXP_NONE ? !r.costCenter : r.costCenter === F.cc)) && (!F.type || r.txType === F.type) && (!F.approved || r.status === 'approved'));
}
function expTotals(invs) {
  return { n: invs.length, employees: sum(invs.map(i => i.employees)), gov: sum(invs.map(i => i.gov)), support: sum(invs.map(i => i.support)), total: sum(invs.map(i => i.total)) };
}
/** أعلى قيمة «مريحة» لمحور الرسم (1 / 2 / 2.5 / 5 × 10ⁿ) */
function expNiceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(x => x >= v);
}
/** تجميع صفوف (بنود / فواتير) بمفتاح ← أعمدة أفقية: الأكبر الأول، والباقي بعد أول max في «أخرى» */
function expGroup(rows, key, val, max = 8) {
  const by = new Map();
  rows.forEach(r => { const k = key(r) || t('غير محدد'); by.set(k, (by.get(k) || 0) + (Number(val(r)) || 0)); });
  const all = [...by.entries()].filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const top = all.slice(0, max), rest = sum(all.slice(max).map(x => x[1]));
  if (rest) top.push([`${t('أخرى')} (${all.length - max})`, rest]);
  const total = sum(all.map(x => x[1]));
  return top.map(([label, n]) => ({ label, n, text: expNum(n), tip: `${label}: ${fmtMoney(n)} — ${dbPct(n, total)}` }));
}
/** كل أرقام اللوحة حسب الفلاتر الحالية */
function expensesModel() {
  const F = expFilters(), D = EXP.data, months = expMonths(F.period);
  const base = expFilter(D.invoices, F), invs = expFilter(base, {}, months), lines = expFilter(D.lines, F, months);
  const now = new Date(), curYm = expYm(now.getFullYear(), now.getMonth()), prevYm = expYm(now.getFullYear(), now.getMonth() - 1);
  const ofMonth = ym => base.filter(i => (i.closingDate || '').slice(0, 7) === ym);
  const perMonth = months.map(ym => ({ ym, ...expTotals(invs.filter(i => i.closingDate.slice(0, 7) === ym)) }));
  // شركة ← مركز تكلفة ← شهر
  const rows = new Map();
  invs.forEach(i => {
    const k = `${i.companyId || ''}|${i.costCenter || ''}`, ym = i.closingDate.slice(0, 7);
    if (!rows.has(k)) rows.set(k, { co: i.companyId || '', cc: i.costCenter || '', by: {}, total: 0 });
    const r = rows.get(k); r.by[ym] = (r.by[ym] || 0) + i.total; r.total += i.total;
  });
  const groups = new Map();
  [...rows.values()].forEach(r => { if (!groups.has(r.co)) groups.set(r.co, { co: r.co, rows: [], by: {}, total: 0 }); const g = groups.get(r.co); g.rows.push(r); g.total += r.total; months.forEach(ym => { g.by[ym] = (g.by[ym] || 0) + (r.by[ym] || 0); }); });
  const G = [...groups.values()].sort((a, b) => (companyName(a.co) || '').localeCompare(companyName(b.co) || '', 'ar'));
  G.forEach(g => g.rows.sort((a, b) => a.cc.localeCompare(b.cc, 'ar')));
  const plan = (typeof renewalPlan === 'function' ? renewalPlan('next') : []).filter(r => (!F.company || (empCompanyId(r.e) || '') === F.company)
    && (!F.cc || (F.cc === EXP_NONE ? !r.e.costCenter : r.e.costCenter === F.cc)) && (!F.type || r.tx === F.type));
  return { F, D, months, base, invs, lines, perMonth, G, T: expTotals(invs), cur: expTotals(ofMonth(curYm)), prev: expTotals(ofMonth(prevYm)),
    pending: invs.filter(i => i.status === 'pending'), plan, expected: sum(plan.map(r => r.fees + r.support)) };
}
function expCriteria(M) {
  const F = M.F;
  return [`${t('الفترة')}: ${t(EXP_PERIODS[F.period])} (${expMonthLabel(M.months[0])} – ${expMonthLabel(M.months[M.months.length - 1])})`,
    F.company && `${t('الشركة')}: ${companyName(F.company)}`, F.cc && `${t('مركز التكلفة')}: ${F.cc === EXP_NONE ? t('بدون مركز تكلفة') : ccLabel(F.cc)}`,
    F.type && `${t('نوع المعاملة')}: ${custodyTypeLabel(F.type)}`, F.approved && t('المعتمد من الحسابات بس')].filter(Boolean);
}

/* ---------- الرسم: المصروف الشهري (رسوم + دعم) ---------- */
function expChartHtml(M) {
  const max = expNiceMax(Math.max(...M.perMonth.map(m => m.total))), peak = Math.max(...M.perMonth.map(m => m.total));
  const lastIdx = M.perMonth.map(m => m.total > 0).lastIndexOf(true);
  const pct = v => (100 * v / max).toFixed(2);
  return `<div class="ex-chart"><div class="ex-plot" role="img" aria-label="${esc(t('المصروف الشهري'))}">
      ${[1, 0.5, 0].map(k => `<div class="ex-grid" style="bottom:${100 * k}%"><span class="num">${expNum(max * k)}</span></div>`).join('')}
      <div class="ex-cols">${M.perMonth.map((m, i) => {
        const tip = m.total ? `${expMonthLabel(m.ym)} — ${t('الرسوم الحكومية')} ${fmtMoney(m.gov)} · ${t('الدعم الإداري')} ${fmtMoney(m.support)} · ${t('الإجمالي')} ${fmtMoney(m.total)} · ${m.n} ${t('فاتورة')}`
          : `${expMonthLabel(m.ym)} — ${t('مفيش مصروفات')}`;
        const label = m.total && (m.total === peak || i === lastIdx);          // القيمة على القمة وآخر شهر بس
        return `<div class="ex-col ${m.total ? 'clickable' : ''}" ${m.total ? `tabindex="0" role="button" data-exp="${expPick({ ym: m.ym })}"` : ''} data-tip="${esc(tip)}">
          ${label ? `<b class="num">${expNum(m.total)}</b>` : ''}
          ${m.support ? `<i class="s2 top" style="height:${pct(m.support)}%"></i>` : ''}
          ${m.gov ? `<i class="s1 ${m.support ? '' : 'top'}" style="height:${pct(m.gov)}%"></i>` : ''}</div>`; }).join('')}</div></div>
    <div class="ex-xs">${M.perMonth.map(m => `<span class="num">${expMonthLabel(m.ym)}</span>`).join('')}</div>
    <div class="db-legend"><span><i class="ex-sw s1"></i>${t('الرسوم الحكومية')}</span><span><i class="ex-sw s2"></i>${t('الدعم الإداري')}</span>
      <span class="spacer"></span><span>${t('بالدينار الكويتي — بتاريخ التقفيل. اضغط على شهر تشوف فواتيره.')}</span></div></div>`;
}
function expPick(o) { EXP.picks.push(o); return EXP.picks.length - 1; }

/* ---------- الجدول: شركة ← مركز تكلفة × الشهور ---------- */
function expMatrixHtml(M, print) {
  const ms = M.months, cls = print ? 'rpt' : 'data ex-matrix';
  const td = (v, pick) => `<td class="num${!print && v && pick ? ' clickable' : ''}"${!print && v && pick ? ` data-exp="${expPick(pick)}"` : ''}>${print ? (v ? expNum(v) : '—') : expCell(v)}</td>`;
  const foot = (label, key, strong) => `<tr><td class="txt">${strong ? `<b>${t(label)}</b>` : t(label)}</td>${M.perMonth.map(m => `<td class="num">${strong ? `<b>${expNum(m[key])}</b>` : expNum(m[key])}</td>`).join('')}<td class="num"><b>${expNum(M.T[key])}</b></td></tr>`;
  return `<table class="${cls}"><thead><tr><th class="txt">${t('الشركة / مركز التكلفة')}</th>${ms.map(ym => `<th class="num">${expMonthLabel(ym)}</th>`).join('')}<th class="num">${t('الإجمالي')}</th></tr></thead><tbody>
    ${M.G.map(g => `<tr class="${print ? 'grp' : 'ex-co'}">${print ? `<td colspan="${ms.length + 2}">${esc(companyName(g.co) || t('بدون شركة'))} <small>${expNum(g.total)}</small></td>`
        : `<td class="txt">🏢 ${esc(companyName(g.co) || t('بدون شركة'))}</td>${ms.map(ym => `<td class="num">${expCell(g.by[ym])}</td>`).join('')}<td class="num">${expNum(g.total)}</td>`}</tr>
      ${g.rows.map((r, i) => `<tr class="${print && i % 2 ? 'z' : ''}"><td class="txt ex-cc">${esc(ccLabel(r.cc) || t('بدون مركز تكلفة'))}</td>${ms.map(ym => td(r.by[ym], { ym, co: r.co, cc: r.cc })).join('')}
        <td class="num${print ? '' : ' clickable'}"${print ? '' : ` data-exp="${expPick({ co: r.co, cc: r.cc })}"`}><b>${expNum(r.total)}</b></td></tr>`).join('')}`).join('')}
    </tbody><tfoot>${foot('الرسوم الحكومية', 'gov')}${foot('الدعم الإداري', 'support')}${foot('الإجمالي', 'total', true)}</tfoot></table>`;
}

/* ---------- التبويب ---------- */
function expensesHtml() {
  expensesLoad();
  if (!EXP.data) return `<div id="ex-root" class="empty">${EXP.error ? `${esc(EXP.error)} <button class="btn sm" id="ex-retry">🔄 ${t('حاول تاني')}</button>` : t('جاري التحميل…')}</div>`;
  EXP.picks = [];
  const M = expensesModel(), F = M.F, D = M.D, T = M.T;
  const cos = uniq(D.invoices.map(i => i.companyId)).sort((a, b) => companyName(a).localeCompare(companyName(b), 'ar'));
  const ccs = uniq(D.invoices.filter(i => !F.company || i.companyId === F.company).map(i => i.costCenter)).sort((a, b) => a.localeCompare(b, 'ar'));
  const noCc = D.invoices.some(i => !i.costCenter);
  const delta = M.prev.total ? Math.round(100 * (M.cur.total - M.prev.total) / M.prev.total) : null;
  const tile = (v, l, sub, col, id) => `<div class="card cu-kpi ${id ? 'clickable' : ''}"${id ? ` id="${id}"` : ''}${col ? ` style="border-top:3px solid var(--${col})"` : ''}><b class="num">${esc(String(v))}</b><span>${esc(t(l))}</span>${sub ? `<span class="ex-sub">${esc(sub)}</span>` : ''}</div>`;
  const head = `<div class="filters" id="ex-root">
      <select id="exf-period">${Object.entries(EXP_PERIODS).map(([k, l]) => opt(k, t(l), k === F.period)).join('')}</select>
      <select id="exf-co">${opt('', t('— كل الشركات —'), !F.company)}${cos.map(c => opt(c, companyName(c) || c, c === F.company)).join('')}</select>
      <select id="exf-cc">${opt('', t('— كل مراكز التكلفة —'), !F.cc)}${ccs.map(c => opt(c, ccLabel(c), c === F.cc)).join('')}${noCc ? opt(EXP_NONE, t('بدون مركز تكلفة'), F.cc === EXP_NONE) : ''}</select>
      <select id="exf-type">${opt('', t('— كل الأنواع —'), !F.type)}${Object.entries(CUSTODY_TYPES).map(([k, v]) => opt(k, t(v.label), k === F.type)).join('')}</select>
      <label class="row small" style="gap:5px"><input type="checkbox" id="exf-ok" ${F.approved ? 'checked' : ''}> ${t('المعتمد من الحسابات بس')}</label>
      <button class="btn sm ghost" id="exf-clear">✕ ${t('مسح الفلاتر')}</button><span class="spacer"></span>
      <button class="btn sm" id="ex-print" ${M.invs.length ? '' : 'disabled'}>🖨️ ${t('معاينة وطباعة')}</button></div>`;
  const kpis = `<div class="cu-kpis ex-kpis">
      ${tile(fmtMoney(M.cur.total), 'مصروفات الشهر ده', delta === null ? (M.prev.total ? '' : t('الشهر اللي فات مفيهوش مصروفات')) : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${Math.abs(delta)}% ${t('عن الشهر اللي فات')} (${expNum(M.prev.total)})`, 'blue')}
      ${tile(fmtMoney(T.total), 'إجمالي الفترة', `${t('رسوم')} ${expNum(T.gov)} · ${t('دعم')} ${expNum(T.support)}`, 'green')}
      ${tile(T.n, 'فواتير الفترة', `${T.employees} ${t('إجراء موظف')}`)}
      ${tile(T.employees ? fmtMoney(Math.round(1000 * T.total / T.employees) / 1000) : '—', 'متوسط تكلفة الإجراء', t('الإجمالي ÷ عدد إجراءات الموظفين'))}
      ${F.approved ? '' : tile(`${M.pending.length} · ${fmtMoney(sum(M.pending.map(i => i.total)))}`, 'بانتظار الحسابات', t('في الفترة'), 'orange')}
      ${tile(fmtMoney(D.held), 'الرصيد مع المستلمين', t('اتصرف ولسه ماتنفّذش — كل النطاق'), 'purple')}
      ${tile(fmtMoney(M.expected), 'متوقع الشهر الجاي', `${M.plan.length} ${t('تجديد')} — ${t('من خطة التجديدات')}`, '', 'ex-plan')}</div>`;
  if (!M.invs.length) return head + kpis + `<div class="card empty" style="margin-top:12px">${t(D.invoices.length ? 'مفيش فواتير بالفلاتر دي' : 'لسه مفيش فواتير — المصروفات بتظهر هنا بعد تقفيل العهد')}</div>`;
  const bars = (title, sub, rows, color) => `<section class="card db-card"><div class="db-card-h"><div><h3>${esc(t(title))}</h3><div class="db-sub">${esc(t(sub))}</div></div></div>
      ${rows.length ? dbBars(rows, color) : `<div class="empty">${t('لا توجد بيانات')}</div>`}</section>`;
  return head + kpis + `
    <section class="card db-card" style="margin-top:12px"><div class="db-card-h"><div><h3>${t('المصروف الشهري')}</h3><div class="db-sub">${esc(expCriteria(M).join(' · '))}</div></div></div>${expChartHtml(M)}</section>
    <section class="card db-card" style="margin-top:12px"><div class="db-card-h"><div><h3>${t('مراكز التكلفة × الشهور')}</h3><div class="db-sub">${t('إجمالي الفواتير (رسوم + دعم) بالدينار — اضغط على أي رقم تشوف فواتيره')}</div></div></div>
      <div class="table-wrap">${expMatrixHtml(M)}</div></section>
    <div class="ex-cards">
      ${bars('حسب الجهة', 'الرسوم الحكومية بس (من غير الدعم الإداري)', expGroup(M.lines, l => l.authority, l => l.amount), 'var(--viz-1)')}
      ${bars('حسب البند', 'الرسوم الحكومية بس (من غير الدعم الإداري)', expGroup(M.lines, l => l.item, l => l.amount), 'var(--viz-1)')}
      ${bars('حسب نوع المعاملة', 'إجمالي الفواتير (رسوم + دعم)', expGroup(M.invs, i => custodyTypeLabel(i.txType), i => i.total), 'var(--primary)')}</div>`;
}
function bindExpenses() {
  const retry = $('#ex-retry'); if (retry) retry.onclick = () => { EXP.error = ''; expensesLoad(true); render(); };
  if (!EXP.data || !$('#exf-period')) return;
  const upd = p => { Object.assign(expFilters(), p); saveUiStateToLocalStorage(); render(); };
  $('#exf-period').onchange = e => upd({ period: e.target.value });
  $('#exf-co').onchange = e => upd({ company: e.target.value, cc: '' });
  $('#exf-cc').onchange = e => upd({ cc: e.target.value });
  $('#exf-type').onchange = e => upd({ type: e.target.value });
  $('#exf-ok').onchange = e => upd({ approved: e.target.checked });
  $('#exf-clear').onclick = () => upd({ company: '', cc: '', type: '', approved: false });
  $('#ex-print').onclick = printExpenses;
  const plan = $('#ex-plan'); if (plan) plan.onclick = () => openRenewalPlanModal('next');
  $$('[data-exp]', viewRoot()).forEach(el => el.onclick = () => openExpenseInvoices(EXP.picks[+el.dataset.exp]));
  bindVizTips(viewRoot());
}

/** فواتير شهر / مركز تكلفة (من الرسم أو من الجدول) — بنفس فلاتر اللوحة */
function openExpenseInvoices(p) {
  if (!p) return;
  const M = expensesModel();
  const list = M.invs.filter(i => (!p.ym || i.closingDate.slice(0, 7) === p.ym) && (p.co === undefined || (i.companyId || '') === p.co) && (p.cc === undefined || (i.costCenter || '') === p.cc));
  const mine = new Set((STATE.invoices || []).map(i => i.id)), cus = new Set((STATE.custodies || []).map(c => c.id)), T = expTotals(list);
  const title = [p.ym && expMonthLabel(p.ym), p.cc !== undefined && (ccLabel(p.cc) || t('بدون مركز تكلفة'))].filter(Boolean).join(' — ');
  const m = openModal({
    title: `🧾 ${t('فواتير')} ${esc(title)}`, size: 'wide',
    body: `<div class="table-wrap"><table class="data"><thead><tr><th>${t('رقم الفاتورة')}</th><th>${t('التاريخ')}</th><th>${t('فاتورة إلى')}</th><th>${t('العهدة')}</th><th>${t('الموظفين')}</th>
        <th>${t('الرسوم الحكومية')}</th><th>${t('الدعم الإداري')}</th><th>${t('الإجمالي')}</th><th>${t('الحالة')}</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr class="${cus.has(i.custodyId) ? 'clickable' : ''}" data-cu="${esc(i.custodyId)}"><td class="num nowrap"><b>${esc(i.number)}</b></td><td class="num small nowrap">${fmtDate(i.closingDate)}</td>
        <td>${esc(ccLabel(i.costCenter) || t('بدون مركز تكلفة'))}<div class="small muted">${esc(companyName(i.companyId) || '')}</div></td>
        <td class="small">${esc(i.custodyNo)} · ${esc(custodyTypeLabel(i.txType))}</td><td class="num">${i.employees}</td><td class="num">${fmtMoney(i.gov)}</td>
        <td class="num">${i.support ? fmtMoney(i.support) : '<span class="muted">—</span>'}</td><td class="num nowrap"><b>${fmtMoney(i.total)}</b></td><td>${invoiceStatusChip(i)}</td>
        <td>${mine.has(i.id) ? `<button class="btn sm" data-inv-dl="${i.id}">📄 ${t('معاينة')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="10" class="empty">${t('لا توجد فواتير')}</td></tr>`}
      </tbody><tfoot><tr><td colspan="4">${t('الإجمالي')} (${list.length})</td><td class="num">${T.employees}</td><td class="num">${fmtMoney(T.gov)}</td><td class="num">${fmtMoney(T.support)}</td>
        <td class="num"><b>${fmtMoney(T.total)}</b></td><td colspan="2"></td></tr></tfoot></table></div>`,
    foot: `${custodyLangSelect()}<span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  bindCustodyLang(m.el);
  $$('[data-inv-dl]', m.el).forEach(b => b.onclick = ev => { ev.stopPropagation(); custodyPreview(`/api/invoices/${b.dataset.invDl}.pdf`); });
  $$('tr.clickable[data-cu]', m.el).forEach(tr => tr.onclick = () => { m.close(); openCustodyDetails(tr.dataset.cu); });
}

/** تقرير اللوحة A4 عرضي: ملخص الشهور + مراكز التكلفة × الشهور + التقسيم (معاينة وطباعة) */
function printExpenses() {
  const M = expensesModel(), T = M.T;
  const split = (title, rows) => `<table class="rpt" style="margin-top:10px"><thead><tr><th class="txt">${esc(t(title))}</th><th class="num">${t('المبلغ')}</th><th class="num">%</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${i % 2 ? 'z' : ''}"><td class="txt">${esc(r.label)}</td><td class="num">${r.text}</td><td class="num">${dbPct(r.n, sum(rows.map(x => x.n)))}</td></tr>`).join('')}</tbody></table>`;
  openReportWindow({
    title: t('المصروفات الحكومية'), subtitle: `${expMonthLabel(M.months[0])} – ${expMonthLabel(M.months[M.months.length - 1])}`,
    company: M.F.company ? IDX.company[M.F.company] : null, criteria: esc(expCriteria(M).join(' · ')),
    summary: [[fmtMoney(T.total), t('إجمالي الفترة')], [fmtMoney(T.gov), t('الرسوم الحكومية')], [fmtMoney(T.support), t('الدعم الإداري')], [T.n, t('فواتير الفترة')],
      [T.employees, t('إجراء موظف')], [fmtMoney(M.D.held), t('الرصيد مع المستلمين')], [fmtMoney(M.expected), t('متوقع الشهر الجاي')]],
    body: `<table class="rpt"><thead><tr><th class="txt">${t('الشهر')}</th><th>${t('الفواتير')}</th><th>${t('إجراء موظف')}</th><th class="num">${t('الرسوم الحكومية')}</th><th class="num">${t('الدعم الإداري')}</th>
        <th class="num">${t('الإجمالي')}</th><th class="num">${t('التغيّر عن الشهر اللي قبله')}</th></tr></thead><tbody>
      ${M.perMonth.map((m, i) => { const p = i ? M.perMonth[i - 1].total : 0, d = p ? Math.round(100 * (m.total - p) / p) : null;
        return `<tr class="${i % 2 ? 'z' : ''}"><td class="txt num">${expMonthLabel(m.ym)}</td><td class="num">${m.n || '—'}</td><td class="num">${m.employees || '—'}</td><td class="num">${m.gov ? expNum(m.gov) : '—'}</td>
          <td class="num">${m.support ? expNum(m.support) : '—'}</td><td class="num"><b>${m.total ? expNum(m.total) : '—'}</b></td><td class="num">${d === null ? '—' : `${d > 0 ? '+' : ''}${d}%`}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td class="txt">${t('الإجمالي')}</td><td class="num">${T.n}</td><td class="num">${T.employees}</td><td class="num">${expNum(T.gov)}</td><td class="num">${expNum(T.support)}</td><td class="num">${expNum(T.total)}</td><td></td></tr></tfoot></table>
      <h3 style="margin:14px 0 6px;font-size:12px">${t('مراكز التكلفة × الشهور')}</h3>${expMatrixHtml(M, true)}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-items:start">${split('حسب الجهة', expGroup(M.lines, l => l.authority, l => l.amount, 12))}
        ${split('حسب البند', expGroup(M.lines, l => l.item, l => l.amount, 12))}${split('حسب نوع المعاملة', expGroup(M.invs, i => custodyTypeLabel(i.txType), i => i.total, 12))}</div>`,
  });
  printLog(t('المصروفات الحكومية'), 'custody');
}
