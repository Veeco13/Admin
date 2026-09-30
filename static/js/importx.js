/* =====================================================================
   IMPORT EXTRA — 📥 استيراد بيانات تكميلية (مدير النظام — القسم 27)
   ملف Excel / CSV ← بيملى الخانات الفاضية بس (مابيكتبش فوق حاجة موجودة). بتختار الشيت وعمود المطابقة والأعمدة
   اللي تتاخد ← معاينة ← تأكيد الأسماء اللي مش متطابقة ← اعتماد. كل دفعة ليها «↩️ تراجع».
   ===================================================================== */
const IMPORTX_TABS = { fills: 'هيتملى', conflicts: 'مختلف — هيفضل اللي في السيستم', suggest: 'أسماء محتاجة تأكيد', notFound: 'مش موجود في السيستم', invalid: 'قيم مرفوضة' };

const IMPORTX_VTABS = { new: 'هتتضاف', fills: 'هتتكمّل (الفاضي بس)', conflicts: 'مختلف — هيفضل اللي في السيستم', suggest: 'ربط «مع مين» بموظف (اختياري)', skipped: 'متخطّاة', unknownFiles: 'ملف شؤون مش معروف' };
/** الشركة الافتراضية للعربيات = اللي عليها أكتر ملفات (أبراج انرجي) */
function importxDefaultCompany() {
  const n = id => scopedProjects().filter(p => p.companyId === id).length;
  return (scopedCompanies().slice().sort((a, b) => n(b.id) - n(a.id))[0] || {}).id || '';
}

function openImportExtraModal(tab) {
  const S = { up: null, sheet: null, header: 0, matchCol: null, matchBy: 'civil', map: {}, vmap: {}, target: 'employees', companyId: '', confirm: {}, pv: null, list: 'fills' };
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
    Object.assign(S, { sheet: name, header: sh.headerRow, matchCol: sh.matchCol, matchBy: sh.matchBy || 'civil', map: { ...sh.map }, vmap: { ...sh.vehMap },
      target: sh.target, companyId: S.companyId || importxDefaultCompany(), confirm: {}, pv: null, list: sh.target === 'vehicles' ? 'new' : 'fills' });
  }
  const isVeh = () => S.target === 'vehicles';
  const sheetOf = () => S.up.sheets.find(x => x.name === S.sheet);
  const columns = () => {
    const sh = sheetOf(), head = sh.top[S.header] || [];
    return head.map((h, i) => ({ i, letter: colLetter(i), title: h }));
  };
  function colLetter(i) { let s = ''; i += 1; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

  /* ---- 2) الشيت والمطابقة والأعمدة ---- */
  function drawSetup() {
    const sh = sheetOf(), cols = columns(), veh = isVeh(), map = veh ? S.vmap : S.map, flds = veh ? S.up.vehFields : fields();
    const sample = i => sh.top.slice(S.header + 1, S.header + 4).map(r => r[i]).filter(Boolean).slice(0, 2).map(esc).join(' · ');
    body().innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>📄 ${esc(S.up.fileName)}</b><button class="btn sm ghost" id="ix-other">${t('ملف تاني')}</button></div>
      <div class="form">
        <label>${t('الشيت')}<select id="ix-sheet">${S.up.sheets.map(x => opt(x.name, `${x.name} (${x.rows} ${t('صف')})`, x.name === S.sheet)).join('')}</select></label>
        <label>${t('صف العناوين')}<select id="ix-head">${sh.top.slice(0, 15).map((r, i) => opt(String(i), `${i + 1}: ${r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 70)}`, i === S.header)).join('')}</select></label>
        <label><span class="req">${t('البيانات')}</span><select id="ix-target">${opt('employees', t('الموظفين (تكميل الفاضي)'), !veh)}${opt('vehicles', t('السيارات (ملف تسجيل السيارات)'), veh)}</select></label>
        ${veh ? `<label><span class="req">${t('مسجّلة باسم')}</span><select id="ix-co">${companyOptions(S.companyId)}</select></label>`
          : `<label><span class="req">${t('المطابقة بـ')}</span><select id="ix-by">${Object.entries(S.up.matchBy).map(([k, l]) => opt(k, t(l), k === S.matchBy)).join('')}</select></label>
        <label><span class="req">${t('عمود المطابقة')}</span><select id="ix-mc">${opt('', '—', S.matchCol == null)}${cols.map(c => opt(String(c.i), `${c.letter} · ${c.title || '—'}`, c.i === S.matchCol)).join('')}</select></label>`}</div>
      ${veh ? `<div class="notice small" style="margin-top:8px">${t('العربية بتتعرف باللوحة «الرقم الإداري-رقم اللوحة». الجديدة بتتضاف، والموجودة بيتكمّل الفاضي فيها بس. نوع الترخيص بيتنقل للعربيات اللي تحته، ورقم الملف بيروح «ملف الشؤون»، والسطور اللي عليها «غير موجودة» أو «لا يمكن التسجيل» بتتخطّى.')}</div>` : ''}
      <h4 style="margin-top:12px">${t('الأعمدة اللي تتاخد')} <span class="small muted">— ${t('اللي مش متختار مش هيتاخد منه حاجة')}</span></h4>
      <div class="table-wrap" style="max-height:260px"><table class="data"><thead><tr><th>${t('العمود')}</th><th>${t('العنوان')}</th><th>${t('عينة')}</th><th>${t('يتاخد في')}</th></tr></thead><tbody>
        ${cols.filter(c => (veh || c.i !== S.matchCol) && c.title).map(c => `<tr><td class="num">${c.letter}</td><td>${esc(c.title)}</td><td class="small muted">${sample(c.i)}</td>
          <td><select data-col="${c.i}">${opt('', '— ' + t('مايتاخدش') + ' —', !map[c.i])}${Object.entries(flds).map(([k, l]) => opt(k, t(l), map[c.i] === k)).join('')}</select></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="ix-pv">👁️ ${t('معاينة')}</button><span class="small muted">${t('المعاينة مابتحفظش حاجة.')}</span></div>
      <div id="ix-pv-box" style="margin-top:12px"></div>`;
    const reset = () => { S.pv = null; S.confirm = {}; };
    $('#ix-other', E).onclick = () => { S.up = null; drawUpload(); };
    $('#ix-sheet', E).onchange = e => { pickSheet(e.target.value); drawSetup(); };
    $('#ix-head', E).onchange = e => { S.header = +e.target.value; S.map = {}; S.vmap = {}; S.matchCol = null; reset(); drawSetup(); };
    $('#ix-target', E).onchange = e => { S.target = e.target.value; S.list = isVeh() ? 'new' : 'fills'; reset(); drawSetup(); };
    const by = $('#ix-by', E); if (by) by.onchange = e => { S.matchBy = e.target.value; reset(); drawSetup(); };
    const mc = $('#ix-mc', E); if (mc) mc.onchange = e => { S.matchCol = e.target.value === '' ? null : +e.target.value; delete S.map[S.matchCol]; reset(); drawSetup(); };
    const ic = $('#ix-co', E); if (ic) ic.onchange = e => { S.companyId = e.target.value; reset(); drawSetup(); };
    $$('[data-col]', E).forEach(sel => sel.onchange = () => {
      const f = sel.value, c = +sel.dataset.col, mp = isVeh() ? S.vmap : S.map;
      Object.keys(mp).forEach(k => { if (mp[k] === f && +k !== c) delete mp[k]; });   // الخانة بتتاخد من عمود واحد بس
      if (f) mp[c] = f; else delete mp[c];
      reset(); drawSetup();
    });
    $('#ix-pv', E).onclick = () => runPreview();
    foot().innerHTML = '';
    if (S.pv) (isVeh() ? drawVehPreview : drawPreview)();
  }
  const req = () => ({ token: S.up.token, fileName: S.up.fileName, sheet: S.sheet, headerRow: S.header, target: S.target, companyId: S.companyId,
    matchCol: S.matchCol, matchBy: S.matchBy, map: isVeh() ? S.vmap : S.map, confirm: S.confirm });
  async function runPreview() {
    if (isVeh()) {
      if (!S.companyId) return openBlockAlert(t('اختار الشركة المسجّلة باسمها العربيات'));
      if (!Object.values(S.vmap).includes('plateNo')) return openBlockAlert(t('اختار عمود رقم اللوحة'));
    } else {
      if (S.matchCol == null) return openBlockAlert(t('اختار عمود المطابقة'));
      if (!Object.keys(S.map).length) return openBlockAlert(t('اختار عمود واحد على الأقل يتاخد'));
    }
    const box = $('#ix-pv-box', E);
    box.innerHTML = `<div class="muted">${t('جاري المعاينة…')}</div>`;
    try { S.pv = await api('POST', '/api/import-extra/preview', req()); (isVeh() ? drawVehPreview : drawPreview)(); }
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

  /* ---- 3ب) معاينة السيارات ---- */
  function drawVehPreview() {
    const p = S.pv, box = $('#ix-pv-box', E), vl = S.up.vehImportFields || {};
    const typ = k => esc(t(VEHICLE_TYPES[k] || '')) || '<span class="muted">—</span>';
    const count = { new: p.newCount, fills: p.fills.length, conflicts: p.conflicts.length, suggest: p.suggest.length, skipped: p.skipped.length, unknownFiles: p.unknownFiles.length };
    const chip = (v, l, col) => `<span class="chip" style="${col ? `color:var(--${col})` : ''}"><b class="num">${v}</b> ${esc(t(l))}</span>`;
    const lists = {
      new: () => p.new.map(x => `<tr><td class="num">${x.row}</td><td><b class="num">${esc(x.plate)}</b></td><td>${typ(x.type)} ${esc(x.model || '')}</td><td>${esc(x.affairs) || '<span class="muted">—</span>'}</td>
        <td>${x.owner ? `🔑 ${esc(x.owner)}` : ''}${x.costCenter ? `<div class="small">${esc(x.costCenter)}</div>` : ''}${x.user ? `<div>${x.linked ? '👤' : '✍️'} ${esc(x.user)}</div>` : ''}</td></tr>`),
      fills: () => p.fills.map(x => `<tr><td class="num">${x.row}</td><td><b class="num">${esc(x.plate)}</b></td><td>${esc(t(vl[x.field] || x.field))}</td><td colspan="2"><b>${esc(x.value)}</b></td></tr>`),
      conflicts: () => p.conflicts.map(x => `<tr><td class="num">${x.row}</td><td><b class="num">${esc(x.plate)}</b></td><td>${esc(t(vl[x.field] || x.field))}</td><td colspan="2">${t('السيستم')}: <b>${esc(x.current)}</b><div class="small" style="color:var(--orange)">${t('الملف')}: ${esc(x.file)}</div></td></tr>`),
      suggest: () => p.suggest.map(x => `<tr><td class="num">${x.row}</td><td><b class="num">${esc(x.plate)}</b></td><td>✍️ ${esc(x.key)}</td><td colspan="2">
          <select data-confirm="${x.row}" style="width:100%">${opt('', '— ' + t('يفضل اسم حر') + ' —', !S.confirm[x.row])}${x.candidates.map(c => opt(c.id, `${c.name} — ${c.id}${c.costCenter ? ' · ' + c.costCenter : ''} (${Math.round(c.score * 100)}%)`, S.confirm[x.row] === c.id)).join('')}</select></td></tr>`),
      skipped: () => p.skipped.map(x => `<tr><td class="num">${x.row}</td><td><b class="num">${esc(x.plate)}</b></td><td colspan="3">${esc(x.reason)}</td></tr>`),
      unknownFiles: () => p.unknownFiles.map(x => `<tr><td class="num">${x.row}</td><td><b class="num">${esc(x.plate)}</b></td><td>${esc(x.value)}</td><td colspan="2">${esc(t(x.reason))}</td></tr>`),
    };
    if (!count[S.list] && S.list !== 'new') S.list = 'new';
    box.innerHTML = `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${chip(p.newCount, 'عربية جديدة', 'green')}${chip(p.updateCount, 'عربية موجودة هتتكمّل')}${chip(p.skipped.length, 'سطر متخطّى')}${p.dupRows ? chip(p.dupRows, 'لوحة متكررة (أول سطر بس)') : ''}${p.conflicts.length ? chip(p.conflicts.length, 'مختلف (هيفضل)', 'orange') : ''}</div>
      <div class="notice ${p.fillTotal ? '' : 'warn'}" style="margin:8px 0">${p.fillTotal ? `✅ ${t('هيتضاف')} <b>${p.newCount}</b> ${t('عربية مسجّلة باسم')} «${esc(p.company)}»${p.updateCount ? `، ${t('ويتكمّل الفاضي في')} <b>${p.updateCount}</b> ${t('عربية موجودة')}` : ''}.` : t('مفيش عربيات جديدة ولا خانات فاضية هتتملى من الملف ده.')}
        ${p.suggest.length ? ` ${t('«مع مين» بتتسجّل اسم حر، وتقدر تربطها بموظف من الاقتراحات لو هو نفسه — مفيش حاجة بتتربط لوحدها.')}` : ''}</div>
      <div class="tabs">${Object.entries(IMPORTX_VTABS).map(([k, l]) => `<button data-list="${k}" class="${S.list === k ? 'active' : ''}">${t(l)} (${count[k]})</button>`).join('')}</div>
      <div class="table-wrap" style="max-height:300px"><table class="data"><thead><tr><th>${t('الصف')}</th><th>${t('اللوحة')}</th>${S.list === 'new' ? `<th>${t('النوع / الموديل')}</th><th>${t('ملف الشؤون')}</th><th>${t('المالك / مركز التكلفة / مع مين')}</th>` : `<th>${t('الخانة')}</th><th colspan="2">${t('القيمة')}</th>`}</tr></thead>
        <tbody>${lists[S.list]().join('') || `<tr><td colspan="5" class="empty">—</td></tr>`}</tbody></table></div>`;
    $$('[data-list]', box).forEach(b => b.onclick = () => { S.list = b.dataset.list; drawVehPreview(); });
    $$('[data-confirm]', box).forEach(sel => sel.onchange = () => { if (sel.value) S.confirm[sel.dataset.confirm] = sel.value; else delete S.confirm[sel.dataset.confirm]; runPreview(); });
    foot().innerHTML = p.fillTotal ? `<button class="btn primary" id="ix-apply">✅ ${t('اعتماد وحفظ')} (${p.newCount} ${t('جديدة')}${p.updateCount ? ' + ' + p.updateCount : ''})</button>` : '';
    const ap = $('#ix-apply', E);
    if (ap) ap.onclick = async () => {
      if (!await openConfirm(`${t('هيتضاف')} ${p.newCount} ${t('عربية مسجّلة باسم')} «${esc(p.company)}»${p.updateCount ? ` ${t('ويتكمّل الفاضي في')} ${p.updateCount}` : ''}.\n${t('القيم الموجودة مش هتتغيّر، وتقدر ترجّع الدفعة كلها من «الدفعات السابقة».')}`, { okLabel: t('اعتماد وحفظ') })) return;
      ap.disabled = true;
      try {
        const r = await api('POST', '/api/import-extra/apply', req());
        toast(`${t('اتضاف')} ${r.added} ${t('عربية')}${r.updated ? ` · ${t('اتكمّل')} ${r.updated}` : ''}`, 'ok');
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
        <td>${b.target === 'vehicles'
          ? `🚗 <b class="num">${sm.added ?? 0}</b> ${t('عربية اتضافت')}${sm.updated ? ` · <b class="num">${sm.updated}</b> ${t('اتكمّلت')}` : ''}${sm.skipped ? `<div class="small muted">${sm.skipped} ${t('سطر متخطّى')}</div>` : ''}`
          : `${b.target === 'employees_file' ? `<span class="chip">📥 ${t('استيراد الموظفين')}</span> ` : ''}<b class="num">${sm.values ?? b.changes}</b> ${t('خانة')} · <b class="num">${sm.employees ?? ''}</b> ${t('موظف')}
          <div class="small muted">${Object.entries(sm.fields || {}).map(([f, n]) => `${esc(t((sm.labels || {})[f] || fl[f] || IMPORTX_FIELD_LABELS[f] || f))} ${n}`).join(' · ')}</div>`}</td>
        <td class="small">${esc(b.createdBy || '')}</td>
        <td>${b.undoneAt ? `<span class="chip">↩️ ${t('اترجعت')} ${fmtDateTime(b.undoneAt)}</span>` : `<span class="chip" style="color:var(--green)">${t('متطبّقة')}</span>`}</td>
        <td>${b.undoneAt ? '' : `<button class="btn sm danger" data-undo="${b.id}">↩️ ${t('تراجع')}</button>`}</td></tr>`; }).join('') || `<tr><td colspan="6" class="empty">${t('مفيش دفعات لسه')}</td></tr>`}</tbody></table></div>`;
    $$('[data-undo]', E).forEach(btn => btn.onclick = async () => {
      if (!await openConfirm(t('ترجّع الدفعة دي؟ الخانات اللي اتملت هترجع زي ما كانت، إلا اللي اتعدّل بعد الاستيراد. والعربيات اللي اتضافت بتتشال، إلا لو اتضاف لها تصاريح أو تأمين أو دفتر أو عقد.'), { danger: true, okLabel: t('تراجع') })) return;
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
