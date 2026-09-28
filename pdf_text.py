# -*- coding: utf-8 -*-
"""
رسم نص خانات النماذج الرسمية (PDF) بنفسنا — Appearance streams بخط TrueType متضمّن في الملف.

ليه: خطوط الخانات في النماذج (Helvetica / Courier / Times، و AdobeArabic بترميز لاتيني) مفيهاش عربي، فالعارض
بيرسم بخط بديل من الجهاز. عارض كروم/إيدج (PDFium) بيرتّب العربي من اليمين بس مابيوصّلش الحروف («م ح م د» بدل
«محمد»)، ولا بيعرض أشكال الحروف الموصولة الجاهزة. الحل: كل خانة متعبّية بنرسم نصها إحنا:
- توصيل الحروف: أشكال أول/وسط/آخر الكلمة + لام ألف (Arabic Presentation Forms-B) ← shape_arabic
- ترتيب العرض: العربي من اليمين للشمال، والأرقام والإنجليزي جوّاه من الشمال لليمين ← visual_order
- بخط Arial Bold من ويندوز (أو DejaVu / Noto على لينكس، أو LUNX_FORM_FONT) متضمّن بالحروف المستخدمة بس
- الأرقام والإنجليزي في خانات Courier / Times / Helvetica بتترسم بخط النموذج نفسه زي ما هي.
الخانات بتفضل قابلة للتعديل. لو خانة اتعدّلت في كروم، كروم بيرسمها هو تاني (من غير توصيل)، فالأفضل تعديل
البيانات من نافذة البيانات الناقصة في البرنامج.
"""
import os
import re
import struct
import zlib

from pypdf.generic import (ArrayObject, BooleanObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject,
                           NumberObject, TextStringObject)

_WIN_FONTS = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
FONT_CANDIDATES = (
    os.path.join(_WIN_FONTS, "arialbd.ttf"), os.path.join(_WIN_FONTS, "arial.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf", "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf",
)

# ---------------------------------------------------------------------------
# توصيل الحروف العربية
# ---------------------------------------------------------------------------
# الحرف ← (منفصل، آخر، أول، وسط). اللي ليه شكلين بس بيتوصل باللي قبله بس (ا د ذ ر ز و ة ى …)، والهمزة مابتتوصلش.
_AR_FORMS = {
    "\u0621": (0xFE80,), "\u0622": (0xFE81, 0xFE82), "\u0623": (0xFE83, 0xFE84), "\u0624": (0xFE85, 0xFE86),
    "\u0625": (0xFE87, 0xFE88), "\u0626": (0xFE89, 0xFE8A, 0xFE8B, 0xFE8C), "\u0627": (0xFE8D, 0xFE8E),
    "\u0628": (0xFE8F, 0xFE90, 0xFE91, 0xFE92), "\u0629": (0xFE93, 0xFE94), "\u062A": (0xFE95, 0xFE96, 0xFE97, 0xFE98),
    "\u062B": (0xFE99, 0xFE9A, 0xFE9B, 0xFE9C), "\u062C": (0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0),
    "\u062D": (0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4), "\u062E": (0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8), "\u062F": (0xFEA9, 0xFEAA),
    "\u0630": (0xFEAB, 0xFEAC), "\u0631": (0xFEAD, 0xFEAE), "\u0632": (0xFEAF, 0xFEB0),
    "\u0633": (0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4), "\u0634": (0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8),
    "\u0635": (0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC), "\u0636": (0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0),
    "\u0637": (0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4), "\u0638": (0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8),
    "\u0639": (0xFEC9, 0xFECA, 0xFECB, 0xFECC), "\u063A": (0xFECD, 0xFECE, 0xFECF, 0xFED0),
    "\u0641": (0xFED1, 0xFED2, 0xFED3, 0xFED4), "\u0642": (0xFED5, 0xFED6, 0xFED7, 0xFED8),
    "\u0643": (0xFED9, 0xFEDA, 0xFEDB, 0xFEDC), "\u0644": (0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0),
    "\u0645": (0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4), "\u0646": (0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8),
    "\u0647": (0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC), "\u0648": (0xFEED, 0xFEEE), "\u0649": (0xFEEF, 0xFEF0),
    "\u064A": (0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4),
    # فارسي/أردو (في أسماء بعض الجنسيات والأشخاص)
    "\u067E": (0xFB56, 0xFB57, 0xFB58, 0xFB59), "\u0686": (0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D),
    "\u0698": (0xFB8A, 0xFB8B), "\u06A4": (0xFB6A, 0xFB6B, 0xFB6C, 0xFB6D), "\u06A9": (0xFB8E, 0xFB8F, 0xFB90, 0xFB91),
    "\u06AF": (0xFB92, 0xFB93, 0xFB94, 0xFB95), "\u06CC": (0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF),
}
_TATWEEL = "\u0640"
_LAM_ALEF = {"\u0622": (0xFEF5, 0xFEF6), "\u0623": (0xFEF7, 0xFEF8), "\u0625": (0xFEF9, 0xFEFA), "\u0627": (0xFEFB, 0xFEFC)}


def _transparent(ch):
    """التشكيل مابيقطعش التوصيل."""
    return "\u064B" <= ch <= "\u065F" or ch == "\u0670"


def _joins_next(ch):
    """الحرف ده بيتوصل باللي بعده (ليه شكل أول/وسط)."""
    return ch == _TATWEEL or len(_AR_FORMS.get(ch, ())) == 4


def _joins_prev(ch):
    return ch == _TATWEEL or (ch in _AR_FORMS and ch != "\u0621")


def shape_arabic(text):
    """النص بأشكال الحروف الموصولة، بنفس الترتيب المنطقي (الترتيب للعرض في visual_order)."""
    chars, out, i = list(text or ""), [], 0

    def neighbour(k, step):
        k += step
        while 0 <= k < len(chars) and _transparent(chars[k]):
            k += step
        return chars[k] if 0 <= k < len(chars) else ""

    while i < len(chars):
        ch = chars[i]
        if ch not in _AR_FORMS:
            out.append(ch)
            i += 1
            continue
        after_joiner = _joins_next(neighbour(i, -1))
        if ch == "\u0644" and i + 1 < len(chars) and chars[i + 1] in _LAM_ALEF:      # لا لأ لإ لآ
            out.append(chr(_LAM_ALEF[chars[i + 1]][1 if after_joiner else 0]))
            i += 2
            continue
        forms = _AR_FORMS[ch]
        before_joiner = len(forms) == 4 and _joins_prev(neighbour(i, 1))
        if len(forms) == 1:
            code = forms[0]
        else:
            code = forms[(3 if before_joiner else 1) if after_joiner else (2 if before_joiner else 0)]
        out.append(chr(code))
        i += 1
    return "".join(out)


_MIRROR = str.maketrans("()[]{}<>«»", ")(][}{><»«")


def _bidi_class(ch):
    o = ord(ch)
    if (0x0600 <= o <= 0x06FF and not (0x0660 <= o <= 0x0669 or 0x06F0 <= o <= 0x06F9)) \
            or 0xFB50 <= o <= 0xFDFF or 0xFE70 <= o <= 0xFEFF:
        return "R"
    if ch.isdigit():
        return "N"
    return "L" if ch.isalpha() else "W"


def visual_order(text):
    """ترتيب الرسم من الشمال لليمين لسطر واحد (نسخة مبسّطة من خوارزمية الاتجاهين تكفي أسماء وعناوين):
    اتجاه السطر من أول حرف قوي؛ في السطر العربي الأرقام والإنجليزي (وما بينهم) بيفضلوا من الشمال لليمين."""
    cls = [_bidi_class(c) for c in text]
    rtl = next((c for c in cls if c in "RL"), "L") == "R"
    island = "LN" if rtl else "R"          # الجُزُر اللي عكس اتجاه السطر
    runs, i, n = [], 0, len(text)
    while i < n:
        if cls[i] in island:
            j = last = i
            while j < n and (cls[j] in island or cls[j] == "W"):
                if cls[j] in island:
                    last = j
                j += 1
            runs.append((True, text[i:last + 1]))
            i = last + 1
        else:
            j = i
            while j < n and cls[j] not in island:
                j += 1
            runs.append((False, text[i:j]))
            i = j
    if rtl:
        return "".join(s if isl else s[::-1].translate(_MIRROR) for isl, s in reversed(runs))
    return "".join(s[::-1].translate(_MIRROR) if isl else s for isl, s in runs)


# ---------------------------------------------------------------------------
# خط TrueType: قراءة المقاسات وأرقام الحروف + نسخة مصغّرة بالحروف المستخدمة بس
# ---------------------------------------------------------------------------
class TrueTypeFont:
    def __init__(self, path):
        self.path = path
        self.data = data = open(path, "rb").read()
        base = struct.unpack(">I", data[12:16])[0] if data[:4] == b"ttcf" else 0     # مجموعة خطوط ← أول واحد
        self.tables = {}
        for k in range(struct.unpack(">H", data[base + 4:base + 6])[0]):
            tag, _, off, ln = struct.unpack(">4sIII", data[base + 12 + 16 * k:base + 28 + 16 * k])
            self.tables[tag.decode("latin-1")] = (off, ln)
        head = self.table("head")
        self.upm = struct.unpack(">H", head[18:20])[0]
        self.bbox = struct.unpack(">hhhh", head[36:44])
        long_loca = struct.unpack(">h", head[50:52])[0] == 1
        hhea = self.table("hhea")
        self.ascent, self.descent = struct.unpack(">hh", hhea[4:8])
        n_metrics = struct.unpack(">H", hhea[34:36])[0]
        self.num_glyphs = struct.unpack(">H", self.table("maxp")[4:6])[0]
        adv = struct.unpack(f">{n_metrics * 2}H", self.table("hmtx")[:4 * n_metrics])[::2]
        self.advances = list(adv) + [adv[-1]] * (self.num_glyphs - n_metrics)
        loca, n = self.table("loca"), self.num_glyphs + 1
        self.loca = struct.unpack(f">{n}I", loca[:4 * n]) if long_loca else [x * 2 for x in struct.unpack(f">{n}H", loca[:2 * n])]
        self.cmap = self._read_cmap()
        self.ps_name = self._read_ps_name() or re.sub(r"\W", "", os.path.splitext(os.path.basename(path))[0])

    def table(self, tag):
        off, ln = self.tables[tag]
        return self.data[off:off + ln]

    def _read_cmap(self):
        d = self.table("cmap")
        subs = {}
        for k in range(struct.unpack(">H", d[2:4])[0]):
            pid, eid, off = struct.unpack(">HHI", d[4 + 8 * k:12 + 8 * k])
            subs[(pid, eid)] = off
        for key in ((3, 10), (0, 4), (3, 1), (0, 3)):
            if key not in subs:
                continue
            off = subs[key]
            fmt, m = struct.unpack(">H", d[off:off + 2])[0], {}
            if fmt == 12:
                for g in range(struct.unpack(">I", d[off + 12:off + 16])[0]):
                    start, end, gid = struct.unpack(">III", d[off + 16 + 12 * g:off + 28 + 12 * g])
                    if start <= 0xFFFF:
                        m.update((c, gid + c - start) for c in range(start, min(end, 0xFFFF) + 1))
                return m
            if fmt == 4:
                seg2 = struct.unpack(">H", d[off + 6:off + 8])[0]
                seg = seg2 // 2
                ends = struct.unpack(f">{seg}H", d[off + 14:off + 14 + seg2])
                starts = struct.unpack(f">{seg}H", d[off + 16 + seg2:off + 16 + 2 * seg2])
                deltas = struct.unpack(f">{seg}h", d[off + 16 + 2 * seg2:off + 16 + 3 * seg2])
                ro_at = off + 16 + 3 * seg2
                ranges = struct.unpack(f">{seg}H", d[ro_at:ro_at + seg2])
                for k in range(seg):
                    for c in range(starts[k], ends[k] + 1):
                        if c == 0xFFFF:
                            continue
                        if ranges[k] == 0:
                            gid = (c + deltas[k]) & 0xFFFF
                        else:
                            p = ro_at + 2 * k + ranges[k] + 2 * (c - starts[k])
                            gid = struct.unpack(">H", d[p:p + 2])[0]
                            gid = (gid + deltas[k]) & 0xFFFF if gid else 0
                        if gid:
                            m[c] = gid
                return m
        return {}

    def _read_ps_name(self):
        if "name" not in self.tables:
            return None
        d = self.table("name")
        count, str_off = struct.unpack(">HH", d[2:6])
        for k in range(count):
            pid, eid, lid, nid, ln, off = struct.unpack(">HHHHHH", d[6 + 12 * k:18 + 12 * k])
            if nid == 6:
                raw = d[str_off + off:str_off + off + ln]
                name = raw.decode("utf-16-be" if pid in (0, 3) else "latin-1", "ignore")
                return re.sub(r"[^A-Za-z0-9-]", "", name) or None
        return None

    def covers(self, text):
        return all(ord(c) in self.cmap for c in text)

    def glyph(self, ch):
        return self.cmap.get(ord(ch), 0)

    def subset(self, gids):
        """ملف الخط بالحروف دي بس (أرقام الحروف زي ما هي، والباقي فاضي) — الجداول اللي PDF محتاجها."""
        glyf, keep = self.table("glyf"), set(gids) | {0}
        todo = list(keep)
        while todo:                           # الحروف المركّبة بتشاور على حروف تانية
            g = todo.pop()
            s, e = self.loca[g], self.loca[g + 1]
            if e - s < 10 or struct.unpack(">h", glyf[s:s + 2])[0] >= 0:
                continue
            p = s + 10
            while True:
                flags, comp = struct.unpack(">HH", glyf[p:p + 4])
                p += 4 + (4 if flags & 1 else 2) + (2 if flags & 8 else 4 if flags & 0x40 else 8 if flags & 0x80 else 0)
                if comp not in keep:
                    keep.add(comp)
                    todo.append(comp)
                if not flags & 0x20:
                    break
        new_glyf, loca = bytearray(), []
        for g in range(self.num_glyphs):
            loca.append(len(new_glyf))
            if g in keep:
                new_glyf += glyf[self.loca[g]:self.loca[g + 1]]
                new_glyf += b"\0" * (-len(new_glyf) % 4)
        loca.append(len(new_glyf))
        head = bytearray(self.table("head"))
        head[8:12] = b"\0\0\0\0"                  # checkSumAdjustment
        head[50:52] = struct.pack(">h", 1)       # loca طويل
        tables = {"head": bytes(head), "hhea": self.table("hhea"), "maxp": self.table("maxp"), "hmtx": self.table("hmtx"),
                  "loca": struct.pack(f">{len(loca)}I", *loca), "glyf": bytes(new_glyf)}
        for t in ("cvt ", "fpgm", "prep"):
            if t in self.tables:
                tables[t] = self.table(t)
        return _sfnt(tables)


def _sfnt(tables):
    tags = sorted(tables)
    es = len(tags).bit_length() - 1
    out = bytearray(struct.pack(">IHHHH", 0x00010000, len(tags), 16 << es, es, len(tags) * 16 - (16 << es)))
    body, start = bytearray(), 12 + 16 * len(tags)
    for t in tags:
        d = tables[t] + b"\0" * (-len(tables[t]) % 4)
        out += struct.pack(">4sIII", t.encode("latin-1"), sum(struct.unpack(f">{len(d) // 4}I", d)) & 0xFFFFFFFF,
                           start + len(body), len(tables[t]))
        body += d
    return bytes(out + body)


_FONT = None


def form_font():
    """أول خط موجود فيه العربي بأشكاله الموصولة + الإنجليزي والأرقام (بيتقري مرة واحدة)."""
    global _FONT
    if _FONT is None:
        _FONT = False
        for p in (os.environ.get("LUNX_FORM_FONT"),) + FONT_CANDIDATES:
            if p and os.path.exists(p):
                try:
                    f = TrueTypeFont(p)
                except Exception:
                    continue
                if f.covers(shape_arabic("محمد لا إله") + "Aa09/-"):
                    _FONT = f
                    break
    return _FONT or None


# ---------------------------------------------------------------------------
# خطوط النموذج القياسية (للأرقام والإنجليزي): العرض لكل 1000 وحدة + الارتفاع فوق/تحت السطر
# ---------------------------------------------------------------------------
_DIGITS = "0123456789"
_STD = {
    "Courier": ("fixed", 629, 157), "Courier-Bold": ("fixed", 629, 157), "Courier-Oblique": ("fixed", 629, 157),
    "Courier-BoldOblique": ("fixed", 629, 157),
    "Helvetica": ({**dict.fromkeys(_DIGITS, 556), " ": 278, "/": 278, "-": 333, ".": 278, ":": 278, "+": 584}, 718, 207),
    "Helvetica-Bold": ({**dict.fromkeys(_DIGITS, 556), " ": 278, "/": 278, "-": 333, ".": 278, ":": 333, "+": 584}, 718, 207),
    "Times-Roman": ({**dict.fromkeys(_DIGITS, 500), " ": 250, "/": 278, "-": 333, ".": 250, ":": 278, "+": 564}, 683, 217),
    "Times-Bold": ({**dict.fromkeys(_DIGITS, 500), " ": 250, "/": 278, "-": 333, ".": 250, ":": 333, "+": 570}, 676, 205),
}


def _std_width(base, text):
    """عرض النص بخط النموذج القياسي (بالألف)، أو None لو الخط مش قياسي أو فيه حرف مانعرفش عرضه."""
    m = _STD.get(base)
    if not m or not text.isascii() or not all(32 <= ord(c) < 127 for c in text):
        return None
    if m[0] == "fixed":
        return 600 * len(text)
    return sum(m[0][c] for c in text) if all(c in m[0] for c in text) else None


# ---------------------------------------------------------------------------
# بناء الـ appearance لكل خانة
# ---------------------------------------------------------------------------
def _inherit(annot, fld, key):
    for o in (annot, fld):
        while o is not None:
            if key in o:
                return o[key]
            o = o.get("/Parent")
            o = o.get_object() if o is not None else None
    return None


def _parse_da(da):
    m = re.search(r"/([^\s/]+)\s+([\d.]+)\s+Tf", da or "")
    c = re.findall(r"((?:[\d.]+\s+){1,4})(g|rg|k)\b", da or "")
    return (m.group(1), float(m.group(2))) if m else ("Helv", 0.0), (c[-1][0] + c[-1][1]) if c else "0 g"


def _color(arr, stroke):
    v = [float(x) for x in arr]
    op = {1: "g", 3: "rg", 4: "k"}.get(len(v))
    return f"{' '.join(f'{x:g}' for x in v)} {op.upper() if stroke else op}" if op else None


def _stream(w, data, entries=None, compress=True):
    s = DecodedStreamObject()
    s.set_data(data)
    for k, v in (entries or {}).items():
        s[NameObject(k)] = v
    return w._add_object(s.flate_encode() if compress else s)


def _type0_font(w, ttf, used):
    """used = {رقم الحرف: النص اللي بيمثّله} ← خط Type0 (Identity-H) بنسخة مصغّرة من الخط."""
    gids = sorted(used)
    data = ttf.subset(gids)
    h = zlib.crc32(",".join(map(str, gids)).encode())
    name = NameObject("/" + "".join(chr(65 + (h >> (5 * k)) % 26) for k in range(6)) + "+" + ttf.ps_name)
    k = 1000 / ttf.upm
    n = lambda v: NumberObject(round(v * k))
    fd = w._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/FontDescriptor"), NameObject("/FontName"): name, NameObject("/Flags"): NumberObject(4),
        NameObject("/FontBBox"): ArrayObject([n(v) for v in ttf.bbox]), NameObject("/ItalicAngle"): NumberObject(0),
        NameObject("/Ascent"): n(ttf.ascent), NameObject("/Descent"): n(ttf.descent), NameObject("/CapHeight"): n(ttf.ascent),
        NameObject("/StemV"): NumberObject(80),
        NameObject("/FontFile2"): _stream(w, data, {"/Length1": NumberObject(len(data))}),
    }))
    widths = ArrayObject()
    for g in gids:
        widths += [NumberObject(g), ArrayObject([n(ttf.advances[g])])]
    cid = w._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/CIDFontType2"), NameObject("/BaseFont"): name,
        NameObject("/CIDSystemInfo"): DictionaryObject({NameObject("/Registry"): TextStringObject("Adobe"),
                                                        NameObject("/Ordering"): TextStringObject("Identity"),
                                                        NameObject("/Supplement"): NumberObject(0)}),
        NameObject("/FontDescriptor"): fd, NameObject("/W"): widths, NameObject("/DW"): NumberObject(1000),
        NameObject("/CIDToGIDMap"): NameObject("/Identity"),
    }))
    cmap = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
            "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"]
    items = sorted(used.items())
    for s in range(0, len(items), 100):
        chunk = items[s:s + 100]
        cmap += [f"{len(chunk)} beginbfchar"] + [f"<{g:04X}> <{t.encode('utf-16-be').hex().upper()}>" for g, t in chunk] + ["endbfchar"]
    cmap += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    return w._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type0"), NameObject("/BaseFont"): name,
        NameObject("/Encoding"): NameObject("/Identity-H"), NameObject("/DescendantFonts"): ArrayObject([cid]),
        NameObject("/ToUnicode"): _stream(w, "\n".join(cmap).encode("ascii")),
    }))


def _literal(text):
    return "(" + text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")"


def draw_fields(w, items):
    """items = [(widget, field, النص)] ← appearance لكل widget بالنص مرسوم، و NeedAppearances = false
    (عشان العارض يستخدم رسمنا). لو مفيش خط مناسب على الجهاز: العارض هو اللي بيرسم زي الأول."""
    acro = w._root_object["/AcroForm"]
    ttf = form_font()
    if not ttf:
        for a, _, _ in items:
            if "/AP" in a:
                del a["/AP"]
        acro[NameObject("/NeedAppearances")] = BooleanObject(True)
        return False
    dr_fonts = (acro.get("/DR") or {}).get("/Font") or {}
    plans, used = [], {}
    for a, fld, text in items:
        (fname, fsize), color = _parse_da(str(_inherit(a, fld, "/DA") or acro.get("/DA") or ""))
        dr = dr_fonts.get("/" + fname)
        base = str(dr.get_object().get("/BaseFont", ""))[1:] if dr is not None else ""
        vis = visual_order(shape_arabic(text))
        units = _std_width(base, vis)
        if units is not None:                   # أرقام/إنجليزي بخط النموذج نفسه
            asc, desc = _STD[base][1] / 1000, _STD[base][2] / 1000
            plans.append((a, fld, ("/" + fname, dr), _literal(vis), units, asc, desc, fsize, color))
            continue
        gids = []
        for ch in vis:
            g = ttf.glyph(ch)
            gids.append(g)
            used.setdefault(g, ch)
        units = sum(ttf.advances[g] for g in gids) * 1000 / ttf.upm
        plans.append((a, fld, None, "<" + "".join(f"{g:04X}" for g in gids) + ">", units, ttf.ascent / ttf.upm,
                      -ttf.descent / ttf.upm, fsize, color))
    font_ref = _type0_font(w, ttf, used) if used else None
    for a, fld, std, string, units, asc, desc, fsize, color in plans:
        x1, y1, x2, y2 = (float(v) for v in a["/Rect"])
        wd, ht = abs(x2 - x1), abs(y2 - y1)
        mk = a.get("/MK") or {}
        bs = a.get("/BS") or {}
        bw = float(bs.get("/W", 1)) if mk.get("/BC") else 0.0
        ops = []
        if mk.get("/BG") and _color(mk["/BG"], False):
            ops.append(f"q {_color(mk['/BG'], False)} 0 0 {wd:.2f} {ht:.2f} re f Q")
        if bw and _color(mk["/BC"], True):
            ops.append(f"q {_color(mk['/BC'], True)} {bw:g} w {bw / 2:.2f} {bw / 2:.2f} {wd - bw:.2f} {ht - bw:.2f} re S Q")
        pad = 2 + bw
        size = fsize or min(12.0, (ht - 2 * bw - 2) / (asc + desc))       # 0 = حجم تلقائي
        size = min(size, (ht - 2 * bw - 1) / (asc + desc))                 # مايتقصّش من فوق وتحت
        if units * size / 1000 > wd - 2 * pad:                             # النص أعرض من الخانة ← يصغر
            size = max(4.0, (wd - 2 * pad) * 1000 / units)
        tw = units * size / 1000
        q = _inherit(a, fld, "/Q")
        q = int(acro.get("/Q", 0) if q is None else q)
        x = {1: (wd - tw) / 2, 2: wd - pad - tw}.get(q, pad)
        y = (ht - (asc + desc) * size) / 2 + desc * size
        key = std[0] if std else "/LnxF"
        ops.append(f"/Tx BMC q {bw:g} {bw:g} {wd - 2 * bw:.2f} {ht - 2 * bw:.2f} re W n BT {key} {size:.2f} Tf {color} "
                   f"{x:.2f} {y:.2f} Td {string} Tj ET Q EMC")
        res = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject(key): std[1] if std else font_ref})})
        ap = _stream(w, "\n".join(ops).encode("latin-1"), {
            "/Type": NameObject("/XObject"), "/Subtype": NameObject("/Form"),
            "/BBox": ArrayObject([FloatObject(0), FloatObject(0), FloatObject(round(wd, 2)), FloatObject(round(ht, 2))]),
            "/Resources": res,
        })
        a[NameObject("/AP")] = DictionaryObject({NameObject("/N"): ap})
    acro[NameObject("/NeedAppearances")] = BooleanObject(False)
    return True
