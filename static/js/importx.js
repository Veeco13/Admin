/* =====================================================================
   IMPORT EXTRA — 📥 استيراد بيانات تكميلية (مدير النظام — القسم 27)
   ملف Excel / CSV ← بيملى الخانات الفاضية بس (مابيكتبش فوق حاجة موجودة). بتختار الشيت وعمود المطابقة والأعمدة
   اللي تتاخد ← معاينة ← تأكيد الأسماء اللي مش متطابقة ← اعتماد. كل دفعة ليها «↩️ تراجع».
   ===================================================================== */
const IMPORTX_TABS = { fills: 'هيتملى', conflicts: 'مختلف — هيفضل اللي في السيستم', suggest: 'أسماء محتاجة تأكيد', notFound: 'مش موجود في السيستم', invalid: 'قيم مرفوضة' };

function openImportExtraModal(tab) {
  const S = { up: null, sheet: null, header: 0, matchCol: null, matchBy: 'civil', map: {}, confirm: {}, pv: null, list: 'fills' };
  const m = openModal({
    title: '📥 ' + t('استيراد بيانات تكميلية'), size: 'wide',
    body: `<div class="tabs" style="margin-bottom:10px"><button data-itab="new">➕ ${t('استيراد جديد')}</button><button data-itab="batches">📜 ${t('الدفعات السابقة')}</button></div><div id="ix-body"></div>`,
    foot: `<span id="ix-foot"></span><span class="spacer"></span><button class="btn" data-close>${t('إغلاق')}</button>`,
  });
  const E = m.el, body = () => $('#ix-body', E), foot = () => $('#ix-foot', E);
  const fields = () => (S.up && S.up.fields) || {};
  const setTab = k => { $$('[data-itab]', E).forEach(b => b.classList.toggle('active', b.dataset.itab === k)); (k === 'batches' ? drawBatches : S.up ? drawSetup : drawUpload)(); };
  $$('[data-itab]', E).forEach(b => b.onclick = () => setTab(b.dataset.itab));

  /* ---- 1) رفع الملف ---- */
  function drawUpload() {
    foot().innerHTML = '';
    body().innerHTML = `<div class="notice">${t('الأداة دي بتملى الخانات الفاضية بس، ومابتكتبش فوق أي قيمة موجودة — المختلف بيطلع في قايمة مراجعة. بتشوف معاينة قبل الحفظ، وكل دفعة تقدر ترجّعها بـ «↩️ تراجع».')}</div>
      <div class="form" style="margin-top:12px"><label class="full"><span class="req">${t('الملف (Excel أو CSV)')}</span><input type="file" id="ix-file" accept=".xlsx,.xls,.csv"></label></div>
      <button class="btn primary" id="ix-up" style="margin-top:8px">📤 ${t('رفع وقراءة الملف')}</button>`;
    $('#ix-up', E).onclick = async ev => {
      const f = $('#ix-file', E).files[0];
      if (!f) return openBlockAlert(t('اختار الملف الأول'));
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        const fd = new FormData(); fd.append('file', f);
        S.up = await api('POST', '/api/import-extra/upload', fd);
        pickSheet(S.up.sheets.slice().sort((a, b) => b.rows - a.rows)[0].name);
        drawSetup();
      } catch (e) { toast(e.message, 'err'); }
      finally { btn.disabled = false; }
    };
  }
  function pickSheet(name) {
    const sh = S.up.sheets.find(x => x.name === name);
    Object.assign(S, { sheet: name, header: sh.headerRow, matchCol: sh.matchCol, matchBy: sh.matchBy || 'civil', map: { ...sh.map }, confirm: {}, pv: null });
  }
  const sheetOf = () => S.up.sheets.find(x => x.name === S.sheet);
  const columns = () => {
    const sh = sheetOf(), head = sh.top[S.header] || [];
    return head.map((h, i) => ({ i, letter: colLetter(i), title: h }));
  };
  function colLetter(i) { let s = ''; i += 1; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

  /* ---- 2) الشيت والمطابقة والأعمدة ---- */
  function drawSetup() {
    const sh = sheetOf(), cols = columns();
    const sample = i => sh.top.slice(S.header + 1, S.header + 4).map(r => r[i]).filter(Boolean).slice(0, 2).map(esc).join(' · ');
    body().innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>📄 ${esc(S.up.fileName)}</b><button class="btn sm ghost" id="ix-other">${t('ملف تاني')}</button></div>
      <div class="form">
        <label>${t('الشيت')}<select id="ix-sheet">${S.up.sheets.map(x => opt(x.name, `${x.name} (${x.rows} ${t('صف')})`, x.name === S.sheet)).join('')}</select></label>
        <label>${t('صف العناوين')}<select id="ix-head">${sh.top.slice(0, 15).map((r, i) => opt(String(i), `${i + 1}: ${r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 70)}`, i === S.header)).join('')}</select></label>
        <label><span class="req">${t('المطابقة بـ')}</span><select id="ix-by">${Object.entries(S.up.matchBy).map(([k, l]) => opt(k, t(l), k === S.matchBy)).join('')}</select></label>
        <label><span class="req">${t('عمود المطابقة')}</span><select id="ix-mc">${opt('', '—', S.matchCol == null)}${cols.map(c => opt(String(c.i), `${c.letter} · ${c.title || '—'}`, c.i === S.matchCol)).join('')}</select></label></div>
      <h4 style="margin-top:12px">${t('الأعمدة اللي تتاخد')} <span class="small muted">— ${t('اللي مش متختار مش هيتاخد منه حاجة')}</span></h4>
      <div class="table-wrap" style="max-height:260px"><table class="data"><thead><tr><th>${t('العمود')}</th><th>${t('العنوان')}</th><th>${t('عينة')}</th><th>${t('يتاخد في')}</th></tr></thead><tbody>
        ${cols.filter(c => c.i !== S.matchCol && c.title).map(c => `<tr><td class="num">${c.letter}</td><td>${esc(c.title)}</td><td class="small muted">${sample(c.i)}</td>
          <td><select data-col="${c.i}">${opt('', '— ' + t('مايتاخدش') + ' —', !S.map[c.i])}${Object.entries(fields()).map(([k, l]) => opt(k, t(l), S.map[c.i] === k)).join('')}</select></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="ix-pv">👁️ ${t('معاينة')}</button><span class="small muted">${t('المعاينة مابتحفظش حاجة.')}</span></div>
      <div id="ix-pv-box" style="margin-top:12px"></div>`;
    const reset = () => { S.pv = null; S.confirm = {}; };
    $('#ix-other', E).onclick = () => { S.up = null; drawUpload(); };
    $('#ix-sheet', E).onchange = e => { pickSheet(e.target.value); drawSetup(); };
    $('#ix-head', E).onchange = e => { S.header = +e.target.value; S.map = {}; S.matchCol = null; reset(); drawSetup(); };
    $('#ix-by', E).onchange = e => { S.matchBy = e.target.value; reset(); drawSetup(); };
    $('#ix-mc', E).onchange = e => { S.matchCol = e.target.value === '' ? null : +e.target.value; delete S.map[S.matchCol]; reset(); drawSetup(); };
    $$('[data-col]', E).forEach(sel => sel.onchange = () => {
      const f = sel.value, c = +sel.dataset.col;
      Object.keys(S.map).forEach(k => { if (S.map[k] === f && +k !== c) delete S.map[k]; });   // الخانة بتتاخد من عمود واحد بس
      if (f) S.map[c] = f; else delete S.map[c];
      reset(); drawSetup();
    });
    $('#ix-pv', E).onclick = () => runPreview();
    if (S.pv) drawPreview();
    foot().innerHTML = '';
  }
  const req = () => ({ token: S.up.token, fileName: S.up.fileName, sheet: S.sheet, headerRow: S.header, matchCol: S.matchCol, matchBy: S.matchBy, map: S.map, confirm: S.confirm });
  async function runPreview() {
    if (S.matchCol == null) return openBlockAlert(t('اختار عمود المطابقة'));
    if (!Object.keys(S.map).length) return openBlockAlert(t('اختار عمود واحد على الأقل يتاخد'));
    const box = $('#ix-pv-box', E);
    box.innerHTML = `<div class="muted">${t('جاري المعاينة…')}</div>`;
    try { S.pv = await api('POST', '/api/import-extra/preview', req()); drawPreview(); }
    catch (e) { box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`; }
  }

  /* ---- 3) المعاينة ---- */
  function drawPreview() {
    const p = S.pv, fl = fields(), box = $('#ix-pv-box', E);
    const lbl = f => esc(t(fl[f] || f));
    const count = { fills: p.fillTotal, conflicts: Object.values(p.fields).reduce((a, x) => a + x.conflict, 0), suggest: p.suggest.length, notFound: p.notFound.length, invalid: Object.values(p.fields).reduce((a, x) => a + x.invalid, 0) };
    const chip = (v, l, col) => `<span class="chip" style="${col ? `color:var(--${col})` : ''}"><b class="num">${v}</b> ${esc(t(l))}</span>`;
    const lists = {
      fills: () => p.fills.map(x => `<tr><td class="num">${x.row}</td><td>${esc(x.name)}<div class="small muted num">${esc(x.id)}</div></td><td>${lbl(x.field)}</td><td><b>${esc(x.value)}</b></td></tr>`),
      conflicts: () => p.conflicts.map(x => `<tr><td class="num">${x.row}</td><td>${esc(x.name)}<div class="small muted num">${esc(x.id)}</div></td><td>${lbl(x.field)}</td><td>${t('السيستم')}: <b>${esc(x.current)}</b><div class="small" style="color:var(--orange)">${t('الملف')}: ${esc(x.file)}</div></td></tr>`),
      suggest: () => p.suggest.map(x => `<tr><td class="num">${x.row}</td><td><b>${esc(x.key)}</b>${x.same > 1 ? `<div class="small" style="color:var(--orange)">${x.same} ${t('موظفين بنفس الاسم')}</div>` : ''}</td><td colspan="2">
          <select data-confirm="${x.row}" style="width:100%">${opt('', '— ' + t('مش موجود / تجاهل') + ' —', !S.confirm[x.row])}${x.candidates.map(c => opt(c.id, `${c.name} — ${c.id}${c.costCenter ? ' · ' + c.costCenter : ''} (${Math.round(c.score * 100)}%)`, S.confirm[x.row] === c.id)).join('')}</select></td></tr>`),
      notFound: () => p.notFound.map(x => `<tr><td class="num">${x.row}</td><td colspan="3">${esc(x.key)}</td></tr>`),
      invalid: () => p.invalid.map(x => `<tr><td class="num">${x.row}</td><td>${esc(x.name)}</td><td>${lbl(x.field)}</td><td>${esc(x.value)} <span class="small" style="color:var(--red)">${esc(t(x.reason))}</span></td></tr>`),
    };
    if (!count[S.list] && S.list !== 'fills') S.list = 'fills';
    box.innerHTML = `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${chip(p.matched, 'موظف اتطابق')}${p.confirmed ? chip(p.confirmed, 'اتأكد يدويًا', 'green') : ''}${chip(p.notFound.length, 'مش موجود')}${p.suggest.length ? chip(p.suggest.length, 'محتاج تأكيد', 'orange') : ''}${p.dupRows ? chip(p.dupRows, 'صف متكرر (أول قيمة بس)') : ''}</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>${t('الخانة')}</th><th style="color:var(--green)">${t('هيتملى')}</th><th>${t('زي ما هو')}</th><th style="color:var(--orange)">${t('مختلف (هيفضل)')}</th><th style="color:var(--red)">${t('مرفوض')}</th></tr></thead>
        <tbody>${Object.values(p.fields).map(x => `<tr><td>${esc(t(x.label))}</td><td class="num"><b>${x.fill}</b></td><td class="num">${x.same}</td><td class="num">${x.conflict}</td><td class="num">${x.invalid}</td></tr>`).join('')}</tbody></table></div>
      <div class="notice ${p.fillTotal ? '' : 'warn'}" style="margin:8px 0">${p.fillTotal ? `✅ ${t('هيتملى')} <b>${p.fillTotal}</b> ${t('خانة فاضية لـ')} <b>${p.employeesToFill}</b> ${t('موظف')}.` : t('مفيش خانات فاضية هتتملى من الملف ده.')}
        ${p.suggest.length ? ` ${t('الأسماء اللي هتأكدها بتتضاف للمعاينة على طول.')}` : ''}
        ${Object.keys(S.confirm).length ? ` <button class="btn sm ghost" id="ix-reset">↺ ${t('إلغاء تأكيد الأسماء')} (${Object.keys(S.confirm).length})</button>` : ''}</div>
      <div class="tabs">${Object.entries(IMPORTX_TABS).map(([k, l]) => `<button data-list="${k}" class="${S.list === k ? 'active' : ''}">${t(l)} (${count[k]})</button>`).join('')}</div>
      <div class="table-wrap" style="max-height:300px"><table class="data"><thead><tr><th>${t('الصف')}</th><th>${t(S.list === 'suggest' ? 'الاسم في الملف' : S.list === 'notFound' ? 'القيمة في الملف' : 'الموظف')}</th>${S.list === 'suggest' || S.list === 'notFound' ? `<th colspan="2">${S.list === 'suggest' ? t('أقرب الأسماء في السيستم') : ''}</th>` : `<th>${t('الخانة')}</th><th>${t('القيمة')}</th>`}</tr></thead>
        <tbody>${lists[S.list]().join('') || `<tr><td colspan="4" class="empty">—</td></tr>`}</tbody></table></div>`;
    $$('[data-list]', box).forEach(b => b.onclick = () => { S.list = b.dataset.list; drawPreview(); });
    const rs = $('#ix-reset', box); if (rs) rs.onclick = () => { S.confirm = {}; runPreview(); };
    $$('[data-confirm]', box).forEach(sel => sel.onchange = () => {
      const r = sel.dataset.confirm;
      if (sel.value) S.confirm[r] = sel.value; else S.confirm[r] = '';
      // الصف اتأكد أو اترفض ← بيخرج من القايمة، والمعاينة بتتحدّث
      runPreview();
    });
    foot().innerHTML = p.fillTotal ? `<button class="btn primary" id="ix-apply">✅ ${t('اعتماد وحفظ')} (${p.fillTotal} ${t('خانة')})</button>` : '';
    const ap = $('#ix-apply', E);
    if (ap) ap.onclick = async () => {
      if (!await openConfirm(`${t('هيتملى')} ${p.fillTotal} ${t('خانة فاضية لـ')} ${p.employeesToFill} ${t('موظف')} ${t('من')} «${esc(S.up.fileName)}».\n${t('القيم الموجودة مش هتتغيّر، وتقدر ترجّع الدفعة كلها من «الدفعات السابقة».')}`, { okLabel: t('اعتماد وحفظ') })) return;
      ap.disabled = true;
      try {
        const r = await api('POST', '/api/import-extra/apply', req());
        toast(`${t('اتملى')} ${r.values} ${t('خانة لـ')} ${r.employees} ${t('موظف')}`, 'ok');
        await reload();
        S.up = null; S.pv = null;
        setTab('batches');
      } catch (e) { toast(e.message, 'err'); ap.disabled = false; }
    };
  }

  /* ---- الدفعات السابقة + التراجع ---- */
  async function drawBatches() {
    foot().innerHTML = '';
    body().innerHTML = `<div class="muted">${t('جاري التحميل…')}</div>`;
    let list;
    try { list = (await api('GET', '/api/import-extra/batches')).batches; } catch (e) { body().innerHTML = `<div class="notice err">${esc(e.message)}</div>`; return; }
    const fl = { ...(S.up ? S.up.fields : {}) };
    body().innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>${t('التاريخ')}</th><th>${t('الملف')}</th><th>${t('اللي اتملى')}</th><th>${t('بواسطة')}</th><th>${t('الحالة')}</th><th></th></tr></thead><tbody>
      ${list.map(b => { const sm = b.summary || {}; return `<tr><td class="small">${fmtDateTime(b.createdAt)}</td><td>${esc(b.fileName || '')}<div class="small muted">${esc(b.sheet || '')}</div></td>
        <td><b class="num">${sm.values ?? b.changes}</b> ${t('خانة')} · <b class="num">${sm.employees ?? ''}</b> ${t(b.target === 'vehicles' ? 'سيارة' : 'موظف')}
          <div class="small muted">${Object.entries(sm.fields || {}).map(([f, n]) => `${esc(t(fl[f] || IMPORTX_FIELD_LABELS[f] || f))} ${n}`).join(' · ')}</div></td>
        <td class="small">${esc(b.createdBy || '')}</td>
        <td>${b.undoneAt ? `<span class="chip">↩️ ${t('اترجعت')} ${fmtDateTime(b.undoneAt)}</span>` : `<span class="chip" style="color:var(--green)">${t('متطبّقة')}</span>`}</td>
        <td>${b.undoneAt ? '' : `<button class="btn sm danger" data-undo="${b.id}">↩️ ${t('تراجع')}</button>`}</td></tr>`; }).join('') || `<tr><td colspan="6" class="empty">${t('مفيش دفعات لسه')}</td></tr>`}</tbody></table></div>`;
    $$('[data-undo]', E).forEach(btn => btn.onclick = async () => {
      if (!await openConfirm(t('ترجّع الدفعة دي؟ الخانات اللي اتملت هترجع زي ما كانت، إلا اللي اتعدّل بعد الاستيراد.'), { danger: true, okLabel: t('تراجع') })) return;
      btn.disabled = true;
      try {
        const r = await api('POST', `/api/import-extra/batches/${btn.dataset.undo}/undo`, {});
        await reload();
        if (r.kept && r.kept.length) openBlockAlert(`${t('رجعت')} ${r.restored} ${t('خانة')}. ${t('الخانات دي اتعدّلت بعد الاستيراد فاتسابت')}: ${r.kept.map(k => `${k.name} (${t(k.label)})`).join('، ')}`);
        else toast(`${t('رجعت')} ${r.restored} ${t('خانة')}`, 'ok');
        drawBatches();
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    });
  }
  setTab(tab || 'new');
}
const IMPORTX_FIELD_LABELS = { dpId: 'الرقم الوظيفي', qualification: 'المؤهل الدراسي', specialization: 'التخصص', university: 'الجامعة / جهة التخرج',
  unifiedNumber: 'الرقم الموحد', dateOfHire: 'تاريخ التعيين', kuwaitEntryDate: 'تاريخ دخول الكويت', phone: 'الهاتف', email: 'البريد الإلكتروني' };
