/* =====================================================================
   DASHBOARD — الصفحة الرئيسية
   ===================================================================== */
'use strict';

function collectAllTrackedDates() {
  // تواريخ الموظفين مجمّعة حسب نوع المستند والمستوى
  const emps = scopedEmployees().filter(e => e.employmentStatus !== 'terminated');
  return EMP_DATE_FIELDS.map(f => {
    const list = emps.filter(e => !f.driverOnly || e.isDriver);
    const tiers = { expired: 0, d30: 0, d60: 0, d90: 0, ok: 0, none: 0 };
    list.forEach(e => tiers[tierOf(e[f.key])]++);
    return { ...f, total: list.length, tiers };
  });
}

function goEmployees(filters) {
  UI.emp = Object.assign(UI.emp, { q: '', company: '', project: '', status: '', stage: '', nationality: '', costCenter: '', tier: '', tierField: 'any', driver: false, page: 1 }, filters);
  saveUiStateToLocalStorage();
  setView('employees');
}

function renderDashboard() {
  const emps = scopedEmployees();
  const active = emps.filter(e => e.employmentStatus !== 'terminated');
  const items = trackedAlertItems();
  const kpi = [
    { l: 'إجمالي الموظفين', v: emps.length, go: () => goEmployees({}) },
    { l: 'في الخدمة', v: emps.filter(e => (e.employmentStatus || 'active') === 'active').length, cls: 'green', go: () => goEmployees({ status: 'active' }) },
    { l: 'قيد الاستكمال', v: emps.filter(e => e.employmentStatus === 'pending_completion').length, cls: 'blue', go: () => goEmployees({ status: 'pending_completion' }) },
    { l: 'مستندات منتهية', v: items.filter(i => i.days < 0).length, cls: 'red', go: () => renderAlertCenterPanel('expired') },
    { l: 'تنتهي خلال 30 يوم', v: items.filter(i => i.days >= 0 && i.days <= 30).length, cls: 'orange', go: () => renderAlertCenterPanel('d30') },
    { l: 'الشركات', v: scopedCompanies().length, go: () => setView('companies') },
    { l: 'المشاريع', v: STATE.projects.filter(p => companyInScope(p.companyId)).length, go: () => setView('companies') },
    { l: 'السيارات', v: STATE.vehicles.length, go: () => setView('vehicles') },
    { l: 'المترشّحين', v: STATE.candidates.length, go: () => setView('recruitment') },
  ];
  const docs = collectAllTrackedDates();
  const tierColors = { expired: 'var(--red)', d30: 'var(--orange)', d60: 'var(--yellow)', d90: 'var(--green)', ok: 'var(--blue)', none: 'var(--grey-soft)' };
  const stageCounts = GOV_STAGES.map(g => ({ ...g, n: active.filter(e => e.govStage === g.id).length }));
  const maxStage = Math.max(1, ...stageCounts.map(s => s.n));
  const byCompany = scopedCompanies().map(c => ({ c, n: emps.filter(e => empCompanyId(e) === c.id && e.employmentStatus !== 'terminated').length })).sort((a, b) => b.n - a.n);
  const maxCo = Math.max(1, ...byCompany.map(x => x.n));
  const upcoming = items.filter(i => i.days <= 30).slice(0, 14);
  const byNat = {};
  active.forEach(e => { const k = e.nationality || '—'; byNat[k] = (byNat[k] || 0) + 1; });
  const nats = Object.entries(byNat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxNat = Math.max(1, ...nats.map(x => x[1]));
  const payroll = sum(active.map(e => e.salary));

  viewRoot().innerHTML = `
    <div class="page-head"><div><h1>الصفحة الرئيسية</h1><div class="sub">${t('ملخص الموارد البشرية والعمليات الحكومية')} · ${fmtDate(todayISO())}</div></div>
      <div class="actions"><button class="btn" id="d-cal">📅 تقويم التجديدات</button><button class="btn" id="d-org">🏗️ الهيكل التنظيمي</button></div></div>
    <div class="grid kpi">${kpi.map((k, i) => `<div class="card kpi-card ${k.cls || ''}" data-k="${i}"><div class="v num">${k.v}</div><div class="l">${esc(t(k.l))}</div></div>`).join('')}</div>
    <div class="grid two" style="margin-top:12px">
      <div class="card"><h3>حالة المستندات</h3><div class="bars">
        ${docs.map(d => `<div class="bar-row" data-doc="${d.key}"><span>${esc(t(d.label))}</span>
          <div class="track">${Object.entries(d.tiers).map(([k, n]) => n ? `<i style="width:${100 * n / Math.max(1, d.total)}%;background:${tierColors[k]}" title="${esc(t(TIERS[k].label))}: ${n}"></i>` : '').join('')}</div>
          <span class="num small">${d.tiers.expired + d.tiers.d30 ? `<b style="color:var(--red)">${d.tiers.expired + d.tiers.d30}</b>` : '0'}</span></div>`).join('')}
        </div>
        <div class="row small muted" style="margin-top:8px">${Object.keys(TIERS).map(k => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${tierColors[k]}"></i> ${esc(t(TIERS[k].label))}</span>`).join('')}</div>
      </div>
      <div class="card"><h3>مراحل المعاملات الحكومية</h3><div class="bars">
        ${stageCounts.map(s => `<div class="bar-row" data-stage="${s.id}"><span>${s.dot} ${esc(t(s.label))}</span><div class="track"><i style="width:${100 * s.n / maxStage}%;background:${s.color}"></i></div><span class="num">${s.n}</span></div>`).join('')}
        </div></div>
      <div class="card"><h3>تنتهي خلال 30 يوم</h3>
        ${upcoming.length ? `<table class="data"><tbody>${upcoming.map((it, i) => `<tr class="clickable" data-up="${i}"><td>${esc(it.name)}<div class="small muted">${esc(t(it.what))}</div></td><td>${datePill(it.date)}</td><td class="small muted">${esc(daysText(it.days))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">لا يوجد 🎉</div>'}
      </div>
      <div class="card"><h3>الموظفين حسب الشركة</h3><div class="bars">
        ${byCompany.map(x => `<div class="bar-row" data-co="${x.c.id}"><span title="${esc(companyName(x.c.id))}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(companyName(x.c.id))}</span><div class="track"><i style="width:${100 * x.n / maxCo}%;background:var(--primary)"></i></div><span class="num">${x.n}</span></div>`).join('') || '<div class="empty">—</div>'}
        </div>
        <hr class="sep"><div class="row"><span class="muted">${t('إجمالي الرواتب الشهرية')}</span><span class="spacer"></span><b class="num">${fmtMoney(payroll)}</b></div>
      </div>
      <div class="card"><h3>أكثر الجنسيات</h3><div class="bars">
        ${nats.map(([n, c]) => `<div class="bar-row" data-nat="${esc(n)}"><span>${esc(n)}</span><div class="track"><i style="width:${100 * c / maxNat}%;background:var(--blue)"></i></div><span class="num">${c}</span></div>`).join('')}
      </div></div>
      ${renderRecruitFunnelCard()}
      <div class="card"><h3>آخر العمليات</h3>
        ${STATE.auditLog.slice(0, 8).map(a => `<div class="small" style="padding:5px 0;border-bottom:1px dashed var(--border)"><span class="muted">${fmtDateTime(a.date)} · ${esc(a.user || '')}</span><br>${esc(a.label)}</div>`).join('') || '<div class="empty">—</div>'}
        <div style="margin-top:8px"><a href="#" id="d-log">${t('عرض سجل التدقيق كامل')} ←</a></div>
      </div>
    </div>`;
  $$('[data-k]').forEach(el => el.onclick = () => kpi[+el.dataset.k].go());
  $$('[data-doc]').forEach(el => el.onclick = () => goEmployees({ tierField: el.dataset.doc, tier: 'soon', sort: el.dataset.doc }));
  $$('[data-stage]').forEach(el => el.onclick = () => goEmployees({ stage: el.dataset.stage }));
  $$('[data-co]').forEach(el => el.onclick = () => goEmployees({ company: el.dataset.co }));
  $$('[data-nat]').forEach(el => el.onclick = () => goEmployees({ nationality: el.dataset.nat }));
  $$('[data-up]').forEach(el => el.onclick = () => openAlertTarget(upcoming[+el.dataset.up]));
  $('#d-cal').onclick = () => renderRenewalCalendarModal();
  $('#d-org').onclick = () => renderOrgChartModal();
  $('#d-log').onclick = (e) => { e.preventDefault(); UI.log.tab = 'audit'; setView('companylog'); };
  bindRecruitFunnel();
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
  const emps = scopedEmployees().filter(e => e.employmentStatus !== 'terminated');
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
