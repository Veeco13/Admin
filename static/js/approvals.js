/* =====================================================================
   APPROVALS — ✋ الموافقة على التعديلات الحساسة (القسم 28)
   المرتب وبدل السكن / البنك والـ IBAN / إنهاء الخدمة / حذف موظف من مستخدم مالوش «approvals.approve» ← طلب
   (القيمة الحقيقية مابتتغيّرش لحد الموافقة). اللي معاه الصلاحية يوافق (بيتطبّق) أو يرفض بسبب، وصاحب الطلب يلغيه.
   ===================================================================== */
const APPROVAL_ICONS = { salary: '💰', bank: '🏦', service_end: '🚪', delete: '🗑️' };
const APPROVAL_STATUS = { pending: ['مستني موافقة', 'orange'], approved: ['اتوافق عليه', 'green'], rejected: ['اترفض', 'red'], cancelled: ['اتلغى', 'muted'] };

function canApprove() { return can('approvals.approve'); }
function pendingApprovals() { return (STATE.approvals || []).filter(r => r.status === 'pending'); }
function isMyRequest(r) { return STATE.me && String(r.requestedById) === String(STATE.me.id); }
/** بعد الحفظ: لو فيه حاجة اتبعتت للموافقة ← رسالة */
function showPending(res) {
  if (res && res.pending && res.pending.length) toast(`⏳ ${t('اتبعت للموافقة')}: ${res.pending.map(x => t(x)).join(' · ')}`, 'ok');
  return res;
}
/** شباك صغير فيه خانة نص (سبب الرفض / سبب الحذف) ← النص أو null */
function askText(title, label, { okLabel = 'تأكيد', danger = false, required = true } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, size: 'narrow', body: `<label class="full" style="display:block">${esc(label)}<textarea rows="3" id="ask-text" style="width:100%;margin-top:4px"></textarea></label>`,
      foot: `<button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(t(okLabel))}</button><button class="btn" data-close>${t('إلغاء')}</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const ta = $('#ask-text', m.el);
    ta.focus();
    $('[data-ok]', m.el).onclick = () => {
      const v = ta.value.trim();
      if (required && !v) { ta.focus(); return toast(t('اكتب السبب'), 'err'); }
      done = true; m.close(); resolve(v);
    };
  });
}
function approvalChangeHtml(r) {
  if (r.kind === 'delete') return `<b>${t('حذف الموظف')}</b>`;
  return r.changes.map(c => `${esc(t(c.label))}: <span class="muted">${esc(c.old)}</span> ← <b>${esc(c.new)}</b>`).join('<br>');
}
function approvalStatusChip(r) {
  const [l, col] = APPROVAL_STATUS[r.status] || [r.status, 'muted'];
  return `<span class="chip" style="color:var(--${col === 'muted' ? 'muted' : col})">${esc(t(l))}</span>`;
}
function approvalActionsHtml(r) {
  if (r.status !== 'pending') return '';
  return `${canApprove() ? `<button class="btn sm primary" data-ap-ok="${r.id}">✅ ${t('موافقة')}</button> <button class="btn sm danger" data-ap-no="${r.id}">✖ ${t('رفض')}</button>` : ''}
    ${isMyRequest(r) ? ` <button class="btn sm" data-ap-cancel="${r.id}">↩️ ${t('إلغاء الطلب')}</button>` : ''}`;
}
function bindApprovalActions(root, after) {
  const byId = id => (STATE.approvals || []).find(r => r.id === id);
  $$('[data-ap-ok]', root).forEach(b => b.onclick = async () => {
    const r = byId(b.dataset.apOk);
    const warn = r.kind === 'delete' ? `\n${t('الموظف هيتنقل لسلة المحذوفات.')}` : '';
    if (!await openConfirm(`${t('الموافقة على طلب')} «${esc(t(r.kindLabel))}» — ${esc(r.employeeName)}؟\n${approvalChangeHtml(r).replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')}${warn}`, { okLabel: t('موافقة') })) return;
    try { await persist('POST', `/api/approvals/${r.id}/approve`, {}, 'اتوافق على الطلب واتطبّق'); if (after) after(); }
    catch (e) { if (e.data && e.data.block) openBlockAlert(e.message); }
  });
  $$('[data-ap-no]', root).forEach(b => b.onclick = async () => {
    const r = byId(b.dataset.apNo);
    const note = await askText(`✖ ${t('رفض طلب')} «${t(r.kindLabel)}» — ${r.employeeName}`, t('سبب الرفض (بيوصل لصاحب الطلب)'), { okLabel: 'رفض', danger: true });
    if (note === null) return;
    try { await persist('POST', `/api/approvals/${r.id}/reject`, { note }, 'اترفض الطلب'); if (after) after(); } catch (_) { /* ظاهر */ }
  });
  $$('[data-ap-cancel]', root).forEach(b => b.onclick = async () => {
    if (!await openConfirm(t('إلغاء الطلب؟'), { okLabel: t('إلغاء الطلب') })) return;
    try { await persist('POST', `/api/approvals/${b.dataset.apCancel}/cancel`, {}, 'اتلغى الطلب'); if (after) after(); } catch (_) { /* ظاهر */ }
  });
}
/** بطاقة الموظف: الطلبات المستنية بتاعته */
function approvalsBannerHtml(empId) {
  const list = pendingApprovals().filter(r => r.employeeId === empId);
  if (!list.length) return '';
  return `<div class="notice warn" style="margin-top:10px"><b>⏳ ${t('تعديلات مستنية موافقة')}</b>
    ${list.map(r => `<div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap;align-items:flex-start"><span>${APPROVAL_ICONS[r.kind] || ''} <b>${esc(t(r.kindLabel))}</b></span>
      <span class="small">${approvalChangeHtml(r)}${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}<div class="muted">${esc(r.requestedBy || '')} · ${fmtDateTime(r.requestedAt)}</div></span>
      <span class="spacer"></span><span>${approvalActionsHtml(r)}</span></div>`).join('')}</div>`;
}

/* ---------- «✋ طلبات الموافقة» ---------- */
function openApprovalsModal() {
  const F = { tab: pendingApprovals().length ? 'pending' : 'done', q: '' };
  const m = openModal({ title: '✋ ' + t('طلبات الموافقة'), size: 'wide', body: '<div id="ap-body"></div>', foot: `<button class="btn" data-close>${t('إغلاق')}</button>` });
  const draw = () => {
    const all = STATE.approvals || [], q = norm(F.q);
    const list = all.filter(r => (F.tab === 'pending' ? r.status === 'pending' : r.status !== 'pending')
      && (!q || [r.employeeName, r.employeeId, r.requestedBy, r.kindLabel].some(v => norm(v).includes(q))));
    $('#ap-body', m.el).innerHTML = `<div class="notice small">${canApprove()
        ? t('تعديل المرتب وبدل السكن، والبنك والـ IBAN، وإنهاء الخدمة، وحذف موظف من غير صلاحية الموافقة بيوصل هنا. الموافقة بتطبّق التعديل على طول، والرفض محتاج سبب بيوصل لصاحب الطلب.')
        : t('التعديلات الحساسة اللي عملتها (المرتب، البنك، إنهاء الخدمة، حذف موظف) مستنية موافقة — القيمة الحقيقية مابتتغيّرش لحد ما تتوافق.')}</div>
      <div class="row" style="gap:8px;margin:8px 0;flex-wrap:wrap"><div class="tabs" style="margin:0"><button data-ap-tab="pending" class="${F.tab === 'pending' ? 'active' : ''}">⏳ ${t('مستنية')} (${all.filter(r => r.status === 'pending').length})</button>
        <button data-ap-tab="done" class="${F.tab === 'done' ? 'active' : ''}">📜 ${t('اتقررت')} (${all.filter(r => r.status !== 'pending').length})</button></div>
        <span class="spacer"></span><input type="search" id="ap-q" placeholder="${esc(t('بحث بالموظف أو صاحب الطلب…'))}" value="${esc(F.q)}"></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('الموظف')}</th><th>${t('الطلب')}</th><th>${t('التعديل')}</th><th>${t('صاحب الطلب')}</th><th>${F.tab === 'pending' ? '' : t('القرار')}</th></tr></thead><tbody>
        ${list.map(r => `<tr><td><a href="#" data-emp="${esc(r.employeeId)}">${esc(r.employeeName || '')}</a><div class="small muted num">${esc(r.employeeId)}</div></td>
          <td>${APPROVAL_ICONS[r.kind] || ''} ${esc(t(r.kindLabel))}${r.source ? `<div class="small muted">${esc(t(r.source))}</div>` : ''}</td>
          <td class="small">${approvalChangeHtml(r)}${r.note ? `<div class="muted">📝 ${esc(r.note)}</div>` : ''}</td>
          <td class="small">${esc(r.requestedBy || '')}<br><span class="muted">${fmtDateTime(r.requestedAt)}</span></td>
          <td style="white-space:nowrap">${r.status === 'pending' ? approvalActionsHtml(r)
            : `${approvalStatusChip(r)}<div class="small muted">${esc(r.decidedBy || '')} · ${fmtDateTime(r.decidedAt)}</div>${r.decisionNote ? `<div class="small">${esc(r.decisionNote)}</div>` : ''}`}</td></tr>`).join('')
          || `<tr><td colspan="5" class="empty">${t(F.tab === 'pending' ? 'مفيش طلبات مستنية' : 'مفيش طلبات اتقررت قريب')}</td></tr>`}</tbody></table></div>`;
    $$('[data-ap-tab]', m.el).forEach(b => b.onclick = () => { F.tab = b.dataset.apTab; draw(); });
    const qi = $('#ap-q', m.el);
    qi.oninput = debounce(() => { F.q = qi.value; draw(); const i = $('#ap-q', m.el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
    $$('[data-emp]', m.el).forEach(a => a.onclick = ev => { ev.preventDefault(); if (IDX.employee[a.dataset.emp]) openProfileCard(a.dataset.emp); else toast(t('الموظف ده مش موجود (اتحذف)'), 'err'); });
    bindApprovalActions(m.el, draw);
  };
  draw();
}
