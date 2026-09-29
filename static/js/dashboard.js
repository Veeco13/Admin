/* =====================================================================
   DASHBOARD — الصفحة الرئيسية
   الترتيب: رقم واحد كبير «محتاج إجراء» + مؤشرات ← حالة المستندات والقريب ينتهي ← الباقي في كروت متساوية.
   الرسوم: لون واحد لكل رسم (ألوان الحالة للمستندات بس)، أعمدة رفيعة والقيمة عند طرفها، والتفاصيل بالتمرير.
   ===================================================================== */
'use strict';

function collectAllTrackedDates() {
  // تواريخ الموظفين مجمّعة حسب نوع المستند والمستوى
  const emps = scopedEmployees().filter(e => !empEnded(e));
  return EMP_DATE_FIELDS.map(f => {
    const list = emps.filter(e => !f.driverOnly || e.isDriver);
    const tiers = { expired: 0, d30: 0, d60: 0, d90: 0, ok: 0, none: 0 };
    list.forEach(e => tiers[tierOf(e[f.key])]++);
    return { ...f, total: list.length, tiers };
  });
}

function goEmployees(filters) {
  UI.emp = Object.assign(UI.emp, { q: '', company: [], link: '', project: [], agency: [], status: [], stage: [], nationality: [], costCenter: [], profession: [], tier: '', tierField: 'any', driver: false, page: 1 },
    Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, EMP_MULTI.includes(k) ? asList(v) : v])));
  saveUiStateToLocalStorage();
  setView('employees');
}

const DB_TIER_COLORS = { expired: 'var(--red)', d30: 'var(--orange)', d60: 'var(--yellow)', d90: 'var(--green)', ok: 'var(--blue)', none: 'color-mix(in srgb, var(--grey) 38%, var(--surface))' };
const DB_AUDIT_ICONS = { employee: '👤', company: '🏢', candidate: '🧭', contract: '📄', vehicle: '🚗', permit: '🪪', custody: '💰', backup: '💾' };

/** سهم «روح لـ» حسب اتجاه اللغة */
function dbArrow() { return LANG === 'en' ? '→' : '←'; }
/** نسبة للتلميح: أقل من 1% بتبان «<1%» مش «0%» */
function dbPct(n, total) { const p = 100 * n / Math.max(1, total); return n && p < 1 ? '<1%' : Math.round(p) + '%'; }
/** كارت بعنوان + رابط اختياري */
function dbCard(cls, title, body, { sub = '', link = '', linkId = '', tools = '' } = {}) {
  return `<section class="card db-card ${cls}"><div class="db-card-h"><div><h3>${esc(t(title))}</h3>${sub ? `<div class="db-sub">${sub}</div>` : ''}</div>
    <span class="spacer"></span>${tools}${link ? `<a href="#" class="db-link" id="${linkId}">${esc(t(link))} ${dbArrow()}</a>` : ''}</div>${body}</section>`;
}
/** أعمدة أفقية لسلسلة واحدة: القيمة عند طرف العمود. rows = [{label, n, attrs, tip}] */
function dbBars(rows, color = 'var(--primary)') {
  const max = Math.max(1, ...rows.map(r => r.n));
  return `<div class="db-bars">${rows.map(r => `<div class="db-bar ${r.attrs ? 'clickable' : ''}" ${r.attrs || ''} ${r.attrs ? 'tabindex="0" role="button"' : ''} data-tip="${esc(r.tip || `${r.label}: ${r.n}`)}">
      <span class="db-bar-l" title="${esc(r.label)}">${r.html || esc(r.label)}</span>
      <span class="db-bar-t"><i style="width:${(100 * r.n / max).toFixed(1)}%;background:${color}"></i><b>${r.n}</b></span></div>`).join('')}</div>`;
}
/** تلميح عائم لأي عنصر عليه data-tip (بالماوس أو بالكيبورد) */
function bindVizTips(root) {
  let tip = document.getElementById('viz-tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'viz-tip'; tip.className = 'viz-tip'; document.body.appendChild(tip); }
  tip.hidden = true;
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  };
  $$('[data-tip]', root).forEach(el => {
    el.addEventListener('mousemove', e => { e.stopPropagation(); show(el, e.clientX, e.clientY); });
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', () => { tip.hidden = true; });
  });
  root.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute('role') === 'button') { e.preventDefault(); e.target.click(); } });
}

function renderDashboard() {
  const emps = scopedEmployees();
  const active = emps.filter(e => !empEnded(e));
  const items = trackedAlertItems();
  const expired = items.filter(i => i.days < 0), week = items.filter(i => i.days >= 0 && i.days <= 7), month = items.filter(i => i.days > 7 && i.days <= 30);
  const due = items.filter(i => i.days <= 30);
  const stuck = active.filter(e => e.govStageNote);
  const count = st => emps.filter(e => (e.employmentStatus || 'active') === st).length;

  /* ---------- الصف الأول: محتاج إجراء + المؤشرات ---------- */
  const heroSplit = [['expired', 'red', t('منتهي'), expired.length], ['d30', 'orange', t('خلال 7 أيام'), week.length], ['d30', 'yellow', t('خلال 30 يوم'), month.length]];
  const hero = `<section class="db-hero db-span-4">
      <div class="db-eyebrow">🔔 ${t('محتاج إجراء')}</div>
      <div class="db-hero-v">${due.length}</div>
      <div class="db-hero-l">${t('مستند منتهي أو هينتهي خلال 30 يوم')}</div>
      <div class="db-hero-split">${heroSplit.map(([f, c, l, n]) => `<button class="db-chip" data-alert="${f}"><i class="db-dot" style="background:var(--${c})"></i>${esc(l)} <b>${n}</b></button>`).join('')}</div>
      ${stuck.length ? `<button class="db-hero-note" id="d-stuck">⚠️ ${stuck.length} ${t('معاملة عليها ملاحظة تعطّل')} ${dbArrow()}</button>` : ''}
      <span class="spacer"></span>
      <button class="btn db-hero-btn" data-alert="all">${t('فتح مركز التنبيهات')}</button>
    </section>`;
  const cands = STATE.candidates.filter(c => c.stage !== 'rejected' && c.stage !== 'all_completed');
  const payroll = sum(active.map(e => e.salary)), paid = active.filter(e => e.salary).length;
  const vehDue = items.filter(i => i.kind === 'vehicle' && i.days <= 30).length;
  const tiles = [
    { ico: '👥', l: 'في الخدمة', v: count('active'), sub: `${t('من')} ${emps.length} ${t('موظف')} · ${t('مستقيل')} ${count('resigned')} · ${t('إنهاء خدمات')} ${count('terminated')}`, go: () => goEmployees({ status: 'active' }) },
    { ico: '🧩', l: 'قيد الاستكمال', v: count('pending_completion'), sub: `${t('في فترة الإنذار')}: ${count('warning')}`, go: () => goEmployees({ status: 'pending_completion' }) },
    viewAllowed('recruitment') && { ico: '🧭', l: 'المترشّحين', v: cands.length, sub: Object.keys(RECRUIT_SOURCES).map(k => `${recruitSourceLabel(k, true)} ${cands.filter(c => (c.source || 'outside') === k).length}`).join(' · '), go: () => setView('recruitment') },
    can('companies.view') && { ico: '🏢', l: 'الشركات', v: scopedCompanies().length, sub: `${STATE.projects.filter(p => companyInScope(p.companyId)).length} ${t('مشروع')}`, go: () => setView('companies') },
    viewAllowed('vehicles') && { ico: '🚗', l: 'السيارات', v: STATE.vehicles.length, sub: vehDue ? `${vehDue} ${t('مستند بينتهي خلال 30 يوم')}` : t('كل مستنداتها سارية'), go: () => setView('vehicles') },
    can('sensitive.salary') && { ico: '💰', l: 'إجمالي الرواتب الشهرية', v: fmtMoney(payroll), sub: paid ? `${t('متوسط الراتب')} ${fmtMoney(Math.round(payroll / paid))}` : '', go: () => goEmployees({}) },
  ].filter(Boolean);
  const kpis = `<div class="db-kpis db-span-8">${tiles.map((k, i) => `<div class="card db-tile" data-k="${i}" tabindex="0" role="button">
      <div class="db-tile-h"><span class="db-tile-l">${esc(t(k.l))}</span><span class="db-ico">${k.ico}</span></div>
      <div class="db-tile-v">${k.v}</div><div class="db-tile-s">${k.sub}</div></div>`).join('')}</div>`;

  /* ---------- الصف التاني: حالة المستندات + القريب ينتهي ---------- */
  const docs = collectAllTrackedDates().filter(d => d.total);     // رخصة القيادة بتختفي لو مفيش سواقين
  const tierKeys = Object.keys(TIERS);
  const stackRows = docs.map(d => `<div class="db-stack-row clickable" data-doc="${d.key}" tabindex="0" role="button">
      <span class="db-bar-l">${esc(t(d.label))}</span>
      <span class="db-stack">${tierKeys.map(k => d.tiers[k] ? `<i style="flex:${d.tiers[k]};background:${DB_TIER_COLORS[k]}" data-tip="${esc(`${t(d.label)} · ${t(TIERS[k].band || TIERS[k].label)}: ${d.tiers[k]} (${dbPct(d.tiers[k], d.total)})`)}"></i>` : '').join('')}</span>
      <b class="db-stack-n ${d.tiers.expired + d.tiers.d30 ? 'hot' : ''}">${d.tiers.expired + d.tiers.d30}</b></div>`).join('');
  const docTable = `<table class="data db-table"><thead><tr><th>${t('المستند')}</th>${tierKeys.map(k => `<th>${esc(t(TIERS[k].band || TIERS[k].label))}</th>`).join('')}<th>${t('الإجمالي')}</th></tr></thead>
    <tbody>${docs.map(d => `<tr><td>${esc(t(d.label))}</td>${tierKeys.map(k => `<td class="num">${d.tiers[k]}</td>`).join('')}<td class="num"><b>${d.total}</b></td></tr>`).join('')}</tbody></table>`;
  const docCard = dbCard('db-span-7', 'حالة المستندات', `
      <div id="db-doc-chart" class="db-fill"><div class="db-stack-head"><span>${t('المستند')}</span><span>${t('التوزيع')}</span><span>${t('محتاج إجراء')}</span></div>${stackRows}
        <span class="db-grow"></span><div class="db-legend">${tierKeys.map(k => `<span><i class="db-dot" style="background:${DB_TIER_COLORS[k]}"></i>${esc(t(TIERS[k].band || TIERS[k].label))}</span>`).join('')}</div></div>
      <div id="db-doc-table" hidden>${docTable}</div>`,
    { sub: `${active.length} ${t('موظف في الخدمة')}`, tools: `<button class="btn sm ghost" id="db-doc-toggle">▦ ${t('جدول')}</button>` });
  const upcoming = due.slice(0, 6);
  const upCard = dbCard('db-span-5', 'تنتهي خلال 30 يوم', upcoming.length ? `<div class="db-list">${upcoming.map((it, i) => `
      <div class="db-li clickable" data-up="${i}" tabindex="0" role="button"><i class="db-dot" style="background:${DB_TIER_COLORS[it.tier]}"></i>
        <div class="db-li-m"><b>${esc(it.name)}</b><span>${esc(t(it.what))}</span></div>
        <div class="db-li-e">${datePill(it.date)}<span>${esc(daysText(it.days))}</span></div></div>`).join('')}</div>`
    : `<div class="empty">${t('لا يوجد')} 🎉</div>`, { sub: `${due.length} ${t('تنبيه')}`, link: due.length > upcoming.length ? 'عرض الكل' : '', linkId: 'd-all-due' });

  /* ---------- الصف التالت والرابع: كروت متساوية ---------- */
  const stages = GOV_STAGES.map(g => ({ label: t(g.label), html: `${g.dot} ${esc(t(g.label))}`, n: active.filter(e => e.govStage === g.id).length, attrs: `data-stage="${g.id}"` }));
  const inStage = sum(stages.map(s => s.n));
  const govCard = dbCard('db-span-4', 'المعاملات الحكومية', dbBars(stages), { sub: `${inStage} ${t('موظف في معاملة')}` });
  const byCo = scopedCompanies().map(c => ({ label: companyName(c.id), n: active.filter(e => empCompanyId(e) === c.id).length, attrs: `data-co="${c.id}"` }))
    .filter(x => x.n).sort((a, b) => b.n - a.n);
  const coCard = dbCard('db-span-4', 'الموظفين حسب الشركة', byCo.length ? dbBars(byCo) : `<div class="empty">—</div>`, { sub: `${byCo.length} ${t('شركة')}` });
  // اكتمال البيانات: نفس تعريف بطاقة الموظف (empDocCompleteness)
  const comps = active.map(empDocCompleteness);
  const avg = comps.length ? Math.round(sum(comps.map(c => c.pct)) / comps.length) : 100;
  const complete = comps.filter(c => !c.missing.length).length;
  const missCount = {};
  comps.forEach(c => c.missing.forEach(m => { missCount[m] = (missCount[m] || 0) + 1; }));
  const missRows = Object.entries(missCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, n]) => ({ label: t(l), n, tip: `${t(l)}: ${n} ${t('موظف')}` }));
  const meterColor = avg < 50 ? 'red' : avg < 80 ? 'orange' : 'green';
  const dataCard = dbCard('db-span-4', 'اكتمال بيانات الموظفين', `
      <div class="db-meter-v"><b>${avg}%</b><span>${complete} ${t('من')} ${comps.length} ${t('بياناتهم كاملة')}</span></div>
      <div class="db-meter" style="background:var(--${meterColor}-soft)" data-tip="${esc(`${t('متوسط الاكتمال')}: ${avg}%`)}"><i style="width:${avg}%;background:var(--${meterColor})"></i></div>
      ${missRows.length ? `<div class="db-mini-h">${t('أكتر البيانات الناقصة')}</div>${dbBars(missRows, 'var(--orange)')}` : ''}`);
  // الاستقدام: المراحل اللي فيها مترشّحين بس
  const recRows = src => recruitStagesForSource(src).filter(s => !s.rejected && !s.final).map((s, i) => ({ s, i, n: cands.filter(c => (c.source || 'outside') === src && c.stage === s.id).length }))
    .filter(x => x.n).map(x => ({ label: t(x.s.label), html: `<span class="muted">${x.i + 1}.</span> ${esc(t(x.s.label))}`, n: x.n, attrs: `data-rec="${src}|${x.s.id}"` }));
  const recBlock = (src, title) => { const rows = recRows(src); return `<div class="db-mini-h">${esc(t(title))} <span class="muted">(${sum(rows.map(r => r.n))})</span></div>${rows.length ? dbBars(rows) : `<div class="small muted">${t('لا يوجد')}</div>`}`; };
  const recCard = viewAllowed('recruitment') ? dbCard('db-span-4', 'تسجيل موظف جديد', Object.keys(RECRUIT_SOURCES).map(k => recBlock(k, RECRUIT_SOURCES[k][0])).join(''),
    { sub: `${cands.length} ${t('مترشّح نشط')}`, link: 'عرض', linkId: 'd-rec' }) : '';
  // الجنسيات: أول 6 والباقي «أخرى»
  const byNat = {};
  active.forEach(e => { const k = e.nationality || '—'; byNat[k] = (byNat[k] || 0) + 1; });
  const natSorted = Object.entries(byNat).sort((a, b) => b[1] - a[1]);
  const natRows = natSorted.slice(0, 6).map(([n, c]) => ({ label: n === '—' ? n : natLabel(n), n: c, attrs: `data-nat="${esc(n)}"` }));
  const rest = sum(natSorted.slice(6).map(x => x[1]));
  if (rest) natRows.push({ label: t('أخرى'), n: rest, tip: `${t('أخرى')} (${natSorted.length - 6} ${t('جنسية')}): ${rest}` });
  const natCard = dbCard('db-span-4', 'الجنسيات', dbBars(natRows), { sub: `${natSorted.length} ${t('جنسية')}` });
  const logCard = dbCard('db-span-4', 'آخر العمليات', STATE.auditLog.length ? `<div class="db-feed">${STATE.auditLog.slice(0, 6).map(a => `
      <div class="db-feed-i"><span class="db-feed-ico">${DB_AUDIT_ICONS[(a.type || '').split('_')[0]] || '•'}</span>
        <div><div class="db-feed-t">${esc(a.label)}</div><div class="db-feed-m">${fmtDateTime(a.date)} · ${esc(a.user || '')}</div></div></div>`).join('')}</div>`
    : `<div class="empty">—</div>`, { link: 'السجل كامل', linkId: 'd-log' });

  const today = new Date().toLocaleDateString(LANG === 'en' ? 'en-GB' : 'ar-EG', { weekday: 'long' });
  viewRoot().innerHTML = `
    <div class="page-head"><div><h1>الصفحة الرئيسية</h1><div class="sub">${esc(today)}، ${fmtDate(todayISO())} · ${t('ملخص الموارد البشرية والعمليات الحكومية')}</div></div>
      <div class="actions"><button class="btn" id="d-cal">📅 تقويم التجديدات</button><button class="btn" id="d-org">🏗️ الهيكل التنظيمي</button></div></div>
    <div class="db-grid">${hero}${kpis}${docCard}${upCard}${govCard}${coCard}${dataCard}${recCard}${natCard}${logCard}</div>`;

  const root = viewRoot();
  bindVizTips(root);
  $$('[data-k]', root).forEach(el => el.onclick = () => tiles[+el.dataset.k].go());
  $$('[data-alert]', root).forEach(el => el.onclick = () => renderAlertCenterPanel(el.dataset.alert));
  const st = $('#d-stuck'); if (st) st.onclick = () => openStuckListModal(stuck);
  $$('[data-doc]', root).forEach(el => el.onclick = () => goEmployees({ tierField: el.dataset.doc, tier: 'd30', sort: el.dataset.doc }));
  $$('[data-up]', root).forEach(el => el.onclick = () => openAlertTarget(upcoming[+el.dataset.up]));
  $$('[data-stage]', root).forEach(el => el.onclick = () => goEmployees({ stage: el.dataset.stage }));
  $$('[data-co]', root).forEach(el => el.onclick = () => goEmployees({ company: el.dataset.co }));
  $$('[data-nat]', root).forEach(el => el.onclick = () => goEmployees({ nationality: el.dataset.nat }));
  $$('[data-rec]', root).forEach(el => el.onclick = () => { const [source, stage] = el.dataset.rec.split('|'); Object.assign(UI.cand, { source, stage }); saveUiStateToLocalStorage(); setView('recruitment'); });
  $('#db-doc-toggle').onclick = (e) => {
    const tbl = $('#db-doc-table'), showTable = tbl.hidden;
    tbl.hidden = !showTable; $('#db-doc-chart').hidden = showTable;
    e.currentTarget.textContent = showTable ? '📊 ' + t('رسم') : '▦ ' + t('جدول');
  };
  const all = $('#d-all-due'); if (all) all.onclick = (e) => { e.preventDefault(); renderAlertCenterPanel(); };
  const rec = $('#d-rec'); if (rec) rec.onclick = (e) => { e.preventDefault(); setView('recruitment'); };
  $('#d-log').onclick = (e) => { e.preventDefault(); UI.log.tab = 'audit'; setView('companylog'); };
  $('#d-cal').onclick = () => renderRenewalCalendarModal();
  $('#d-org').onclick = () => renderOrgChartModal();
}

/** الموظفين اللي على معاملتهم ملاحظة تعطّل */
function openStuckListModal(list) {
  const m = openModal({
    title: '⚠️ ' + t('معاملات عليها ملاحظة تعطّل'),
    body: `<div class="db-list">${list.map(e => `<div class="db-li clickable" data-emp="${esc(e.id)}"><i class="db-dot" style="background:var(--orange)"></i>
        <div class="db-li-m"><b>${esc(e.name)}</b><span>${esc(e.govStageNote)}</span></div><div class="db-li-e">${govStagePill(e.govStage)}</div></div>`).join('')}</div>`,
    foot: '<button class="btn" data-close>إغلاق</button>',
  });
  $$('[data-emp]', m.el).forEach(el => el.onclick = () => { m.close(); openProfileCard(el.dataset.emp); });
}

/* =====================================================================
   RENEWAL CALENDAR — تقويم التجديدات الشهري
   ===================================================================== */
function renderRenewalCalendarModal(year, month) {
  const now = new Date();
  year = year ?? now.getFullYear(); month = month ?? now.getMonth();
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 1) % 7; // الأسبوع يبدأ السبت
  const start = new Date(year, month, 1 - startDow);
  const items = trackedAlertItems(100000).filter(i => { const d = parseDate(i.date); return d && d.getFullYear() === year && d.getMonth() === month; });
  // + التواريخ السارية البعيدة لنفس الشهر
  const byDay = {};
  items.forEach(i => { (byDay[i.date.slice(0, 10)] = byDay[i.date.slice(0, 10)] || []).push(i); });
  const dows = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  let cells = '';
  const today = todayISO();
  for (let k = 0; k < 42; k++) {
    const d = new Date(start); d.setDate(start.getDate() + k);
    const iso = toISO(d);
    const evs = byDay[iso] || [];
    cells += `<div class="day ${d.getMonth() !== month ? 'out' : ''} ${iso === today ? 'today' : ''}"><b>${d.getDate()}</b>
      ${evs.slice(0, 4).map(e => `<span class="ev pill ${TIERS[e.tier].cls}" data-ev="${esc(iso)}|${evs.indexOf(e)}" title="${esc(e.name + ' — ' + t(e.what))}">${esc(e.name)}</span>`).join('')}
      ${evs.length > 4 ? `<span class="small muted">+${evs.length - 4}</span>` : ''}</div>`;
  }
  const monthName = first.toLocaleDateString(LANG === 'en' ? 'en-GB' : 'ar-EG', { month: 'long', year: 'numeric' });
  closeAllModals();
  const m = openModal({
    title: '📅 ' + t('تقويم التجديدات'), size: 'wide',
    body: `<div class="row" style="margin-bottom:10px"><button class="btn" data-nav="-1">‹ ${t('السابق')}</button><b style="flex:1;text-align:center">${esc(monthName)} — ${items.length} ${t('تاريخ')}</b><button class="btn" data-nav="1">${t('التالي')} ›</button></div>
      <div class="cal">${dows.map(d => `<div class="dow">${esc(t(d))}</div>`).join('')}${cells}</div>`,
  });
  $$('[data-nav]', m.el).forEach(b => b.onclick = () => { const d = new Date(year, month + (+b.dataset.nav), 1); renderRenewalCalendarModal(d.getFullYear(), d.getMonth()); });
  $$('[data-ev]', m.el).forEach(el => el.onclick = () => { const [iso, i] = el.dataset.ev.split('|'); const it = byDay[iso][+i]; m.close(); openAlertTarget(it); });
}

/* =====================================================================
   ORG CHART — الهيكل التنظيمي للشركات
   ===================================================================== */
function renderOrgChartModal() {
  const emps = scopedEmployees().filter(e => !empEnded(e));
  const html = scopedCompanies().map(c => {
    const ce = emps.filter(e => empCompanyId(e) === c.id);
    const projs = STATE.projects.filter(p => p.companyId === c.id);
    const noProj = ce.filter(e => !primaryAff(e).projectId).length;
    return `<div class="node"><div class="row"><b>🏢 ${esc(companyName(c.id))}</b><span class="spacer"></span><span class="chip">${ce.length} ${t('موظف')}</span></div>
      <div class="small muted">${t('المفوّضين')}: ${(c.signatories || []).map(s => esc(s.nameAr)).join('، ') || '—'} · ${t('رقم الملف')}: ${esc(c.mainFileNumber || '—')}</div>
      <div class="children">
        ${projs.map(p => `<div class="node clickable" data-p="${p.id}" style="cursor:pointer"><b>📁 ${esc(projectName(p.id))}</b><div class="small muted">${ce.filter(e => primaryAff(e).projectId === p.id).length} ${t('موظف')} · ${datePill(p.expiryDate)}</div></div>`).join('')}
        <div class="node" data-c="${c.id}" style="cursor:pointer"><b>${t('بدون مشروع')}</b><div class="small muted">${noProj} ${t('موظف')}</div></div>
      </div></div>`;
  }).join('');
  const m = openModal({ title: '🏗️ ' + t('الهيكل التنظيمي'), size: 'wide', body: `<div class="org">${html || '<div class="empty">—</div>'}</div>` });
  $$('[data-p]', m.el).forEach(el => el.onclick = () => { m.close(); const p = IDX.project[el.dataset.p]; goEmployees({ company: p.companyId, project: p.id }); });
  $$('[data-c]', m.el).forEach(el => el.onclick = () => { m.close(); goEmployees({ company: el.dataset.c, project: '__none' }); });
}
