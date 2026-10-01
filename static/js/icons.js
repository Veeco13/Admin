/* =====================================================================
   ICONS — هوية LUNX (المرحلة 2): أيقونات خطية موحدة بدل الإيموجي
   الإيموجي بيتغيّر شكله ولونه من نظام لنظام (ويندوز / ماك / أندرويد) — فالواجهة بتتكتب بالإيموجي زي ما هي في الكود،
   وهنا بتتحوّل لأيقونات SVG خطية بلون النص (currentColor):
   - iconize(root): بيلف على نصوص الصفحة ويبدّل كل إيموجي معروف بأيقونته. شغال لوحده على أي حاجة بتتضاف للصفحة
     (MutationObserver) — فمفيش داعي تتنده بإيدك.
   - iconizeHtml(html): نفس الفكرة على نص HTML (نوافذ التقارير المطبوعة — صفحة تانية مالهاش المراقب).
   - icon(name, tone): أيقونة باسمها للكود الجديد.
   القوايم المنسدلة (<option>) مابتعرضش SVG ← الإيموجي بيتشال منها. والأسهم والعلامات النصية (← ✓ ✕ ▾ ★) بتفضل نص.
   مسارات أغلب الأيقونات من Feather Icons (رخصة MIT — static/brand/ICONS-LICENSE.txt)، والباقي مرسوم للمنتج.
   ===================================================================== */
'use strict';

const ICONS = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'x-circle': '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  pencil: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  redo: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  car: '<path d="M5 17H3v-5l2.2-5.2A2 2 0 0 1 7 5.5h10a2 2 0 0 1 1.8 1.3L21 12v5h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><line x1="9.5" y1="17" x2="14.5" y2="17"/><line x1="3" y1="12" x2="21" y2="12"/>',
  truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><line x1="16" y1="14" x2="16.01" y2="14"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>',
  receipt: '<path d="M5 2v20l2.5-1.5L10 22l2-1.5 2 1.5 2.5-1.5L19 22V2l-2.5 1.5L14 2l-2 1.5L10 2 7.5 3.5 5 2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1.5"/><path d="M9 22v-4h6v4"/><line x1="8" y1="6" x2="8.01" y2="6"/><line x1="12" y1="6" x2="12.01" y2="6"/><line x1="16" y1="6" x2="16.01" y2="6"/><line x1="8" y1="10" x2="8.01" y2="10"/><line x1="12" y1="10" x2="12.01" y2="10"/><line x1="16" y1="10" x2="16.01" y2="10"/><line x1="8" y1="14" x2="8.01" y2="14"/><line x1="12" y1="14" x2="12.01" y2="14"/><line x1="16" y1="14" x2="16.01" y2="14"/>',
  factory: '<path d="M2 21V10l6 4V10l6 4V4h6v17z"/><line x1="2" y1="21" x2="22" y2="21"/><line x1="7" y1="17" x2="7.01" y2="17"/><line x1="12" y1="17" x2="12.01" y2="17"/><line x1="17" y1="17" x2="17.01" y2="17"/>',
  'id-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16c.6-1.4 1.7-2 3-2s2.4.6 3 2"/><line x1="14" y1="10" x2="19" y2="10"/><line x1="14" y1="14" x2="17" y2="14"/>',
  bulb: '<line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  cap: '<path d="M22 9L12 4 2 9l10 5 10-5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><line x1="22" y1="9" x2="22" y2="15"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  dot: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
};

// الإيموجي ← [الأيقونة، اللون (ok أخضر / warn برتقالي / bad أحمر / accent / وألوان النقط)] — اللون مابيتطبقش جوه الأزرار والشارات
const EMOJI_ICONS = {
  '➕': ['plus'], '➖': ['minus'], '✖': ['x'], '❌': ['x-circle', 'bad'], '✅': ['check-circle', 'ok'], '✋': ['check-square'],
  '⚠': ['alert', 'warn'], '⛔': ['ban', 'bad'], '🚫': ['ban', 'bad'], '🖨': ['printer'],
  '📄': ['file'], '📝': ['file-text'], '📜': ['file-text'], '📑': ['file-text'], '📋': ['clipboard'], '🗑': ['trash'], '✏': ['pencil'], '✍': ['pen'],
  '🔒': ['lock'], '🔐': ['lock'], '🔓': ['unlock'], '🔄': ['refresh'], '🔁': ['refresh'], '♻': ['refresh'], '↺': ['refresh'], '🔀': ['shuffle'],
  '↩': ['undo'], '↪': ['redo'], '💾': ['save'], '📤': ['upload'], '📥': ['download'], '⬇': ['arrow-down'], '⬆': ['arrow-up'],
  '📅': ['calendar'], '⏳': ['clock'], '🕘': ['clock'], '🕓': ['clock'], '⏰': ['clock', 'warn'], '⚡': ['zap', 'accent'],
  '👤': ['user'], '🧑': ['user'], '👨': ['user'], '👩': ['user'], '👧': ['user'], '👥': ['users'],
  '🚗': ['car'], '🚦': ['car'], '🚚': ['truck'], '💰': ['wallet'], '💵': ['banknote'], '🧾': ['receipt'], '📎': ['paperclip'], '🔑': ['key'],
  '📊': ['chart'], '🩺': ['activity'], '⚙': ['sliders'], '🔗': ['link'], '💼': ['briefcase'], '🚪': ['log-out'], '🧭': ['compass'],
  '▶': ['play'], '⏸': ['pause'], '📨': ['mail'], '📁': ['folder'], '📂': ['folder'], '🗂': ['folder'], '👁': ['eye'], '🏖': ['sun'], '🌓': ['moon'],
  '🌐': ['globe'], '🔔': ['bell'], '▦': ['grid'], '☰': ['menu'], '📚': ['book'], '🛡': ['shield'], '🔍': ['search'], '🏁': ['flag'], '✈': ['send'],
  '🛟': ['lifebuoy'], '📞': ['phone'], '📌': ['pin'], '🧩': ['layers'], '🏠': ['home'], '🏢': ['building'], '🏛': ['building'], '🏦': ['building'],
  '🏗': ['building'], '🏭': ['factory'], '🪪': ['id-card'], '🛂': ['id-card'], '💡': ['bulb', 'accent'], '🎓': ['cap'], '🎉': ['star', 'ok'], '🆕': ['star', 'accent'],
  '🔴': ['dot', 'bad'], '🟠': ['dot', 'warn'], '🟡': ['dot', 'yellow'], '🟢': ['dot', 'ok'], '🔵': ['dot', 'blue'], '🟣': ['dot', 'purple'], '⚪': ['dot', 'grey'],
};
const KW_FLAG = '🇰🇼';
// علم الكويت (ويندوز مابيرسمش الأعلام — بيكتب «KW»)
const KW_FLAG_SVG = '<svg class="ic ic-kw" viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="5.34" fill="#007a3d"/><rect y="5.33" width="24" height="5.34" fill="#fff"/><rect y="10.66" width="24" height="5.34" fill="#ce1126"/><polygon points="0,0 6,5.33 6,10.67 0,16" fill="#000"/><rect x=".25" y=".25" width="23.5" height="15.5" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".5"/></svg>';
// الإيموجي المعروف (+ محدد الشكل U+FE0F لو موجود)، والعلم كتتابع واحد
const ICON_RE = new RegExp(`${KW_FLAG}|(?:${Object.keys(EMOJI_ICONS).join('|')})\\uFE0F?`, 'gu');
const ICON_SKIP = /^(SCRIPT|STYLE|TEXTAREA|TITLE|svg|INPUT|SELECT)$/;

/** أيقونة باسمها ← SVG (للكود الجديد). tone: ok / warn / bad / accent … */
function icon(name, tone) {
  return ICONS[name] ? `<svg class="ic ic-${name}${tone ? ' ic-t-' + tone : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>` : '';
}
function emojiIcon(ch) {
  if (ch === KW_FLAG) return KW_FLAG_SVG;
  const e = EMOJI_ICONS[ch.replace('️', '')];
  return e ? icon(e[0], e[1]) : ch;
}
/** نص HTML ← نفس النص والإيموجي اللي برّه الوسوم متبدّل بأيقونات (لنوافذ التقارير المطبوعة) */
function iconizeHtml(html) {
  return String(html).replace(/<[^>]*>|[^<]+/g, part => (part[0] === '<' ? part : part.replace(ICON_RE, emojiIcon)));
}
/** بدّل الإيموجي في نصوص العنصر ده بأيقونات (القوايم المنسدلة: الإيموجي بيتشال) */
function iconize(root) {
  if (!root) return;
  if (root.nodeType === 3) return iconizeText(root);
  if (root.nodeType !== 1 || ICON_SKIP.test(root.nodeName)) {
    if (root.nodeName === 'SELECT') root.querySelectorAll('option').forEach(o => iconizeText(o.firstChild));
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(iconizeText);
}
function iconizeText(n) {
  if (!n || n.nodeType !== 3) return;
  const text = n.nodeValue, p = n.parentNode;
  ICON_RE.lastIndex = 0;
  if (!p || !text || !ICON_RE.test(text)) return;
  ICON_RE.lastIndex = 0;
  if (p.nodeName === 'OPTION') { n.nodeValue = text.replace(ICON_RE, '').replace(/^\s+/, ''); return; }
  if (ICON_SKIP.test(p.nodeName) || (p.closest && p.closest('svg, .contract-paper, [data-no-icons]'))) return;      // نص المستندات بيفضل زي ما هو
  const box = document.createElement('template');
  box.innerHTML = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(ICON_RE, emojiIcon);
  p.replaceChild(box.content, n);
}
/** المراقب: أي حاجة بتتضاف للصفحة أو نص بيتغيّر ← أيقوناتها بتتبدّل قبل ما تترسم */
function startIcons() {
  iconize(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') iconizeText(m.target);
      else m.addedNodes.forEach(iconize);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
if (document.body) startIcons(); else document.addEventListener('DOMContentLoaded', startIcons);
