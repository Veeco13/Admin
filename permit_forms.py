# -*- coding: utf-8 -*-
"""
نماذج تصاريح السيارات (قسم التصاريح ← «نماذج التصاريح») — قوالب forms/permits/ بنفس شكل نماذج الجهة:

- KOC:               1) شهادة الفحص (Clearance Certificate — نسخة لكل مركبة)   2) قائمة المستندات المطلوبة
                     3) تعهد المركبات   4) نموذج طلب تصاريح المركبات الثقيلة
- الرتقة والعبدلي:   1) قائمة المستندات   2) تعهد المركبات   3) نموذج طلب تصاريح الرتقة والعبدلي (Excel)

البيانات بتيجي من الواجهة **بعد ما المستخدم راجعها وعدّلها** (كل الخانات ظاهرة في النافذة)، فالسيرفر بيملى القالب بيها
زي ما هي. القوالب فيها {{حقول}} بس — مفيش اسم عميل ولا بيانات جوّه الملفات.
- Word: الاستبدال على مستوى XML (الفقرات والجداول **ومربعات النص** — شهادة الفحص كلها مربع نص)، والحقل ممكن يبقى
  متوزّع على أكتر من run. النماذج القديمة متنسّقة بالمسافات، فلو القيمة أطول / أقصر من المثال الأصلي المسافات اللي
  بعدها بتتظبط (WIDTHS) علشان باقي السطر مايتزحزحش.
- Excel: الحقول نصوص في sharedStrings ← بتتبدّل هناك (من غير openpyxl علشان الأشكال والشعار يفضلوا).
"""
import io
import os
import re
import zipfile

from lxml import etree

import contracts
import db

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "forms", "permits")
FORMS = {
    "koc": [("clearance", "شهادة الفحص (Clearance Certificate)"), ("checklist", "قائمة المستندات المطلوبة"),
            ("undertaking", "تعهد المركبات"), ("request", "نموذج طلب تصاريح المركبات الثقيلة")],
    "ratqa": [("checklist", "قائمة المستندات المطلوبة"), ("undertaking", "تعهد المركبات"),
              ("ratqa", "نموذج طلب تصاريح الرتقة والعبدلي")],
}
KINDS = {"koc": "تصريح KOC", "ratqa": "تصريح الرتقة والعبدلي"}
TEMPLATES = {"clearance": "koc_clearance.docx", "checklist": "koc_checklist.docx", "undertaking": "vehicles_undertaking.docx",
             "request": "koc_heavy_request.docx", "ratqa": "ratqa_request.xlsx"}
ROWS = {"undertaking": 10, "request": 10, "ratqa": 8, "checklist": 12, "clearance": 10}     # أقصى عدد سيارات في النموذج
REQUEST_TYPES = ("renew", "first", "lost", "damaged")
# طول القيمة في النموذج الأصلي (للسطور المتنسّقة بالمسافات) ← المسافات اللي بعد القيمة بتتظبط على الفرق
WIDTHS = {"subcontractor": 0, "date": 10, "contract_no": 8, "start": 10, "end": 10, "ext": 10, "from": 10, "to": 10, "team": 36,
          "mandoub": 8, "mandoub_phone": 8, "mandoub_nationality": 4, "signatory": 12}
VOID_LINES = ("_x0000_s2133", "_x0000_s2132")      # خطين بيشطبوا السطور الفاضية في نموذج الطلب — لمركبة واحدة بس
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
TOKEN = re.compile(r"\{\{([a-z0-9_]+)\}\}")
DATE_YMD = re.compile(r"\d{4}/\d{2}/\d{2}")


def available():
    return all(os.path.exists(os.path.join(DIR, f)) for f in TEMPLATES.values())


def ymd(v):
    """2026-10-03 ← «2026/10/03» (زي النماذج العربي). النص الحر بيفضل زي ما اتكتب."""
    d = db.parse_date(v) if v else None
    return d.strftime("%Y/%m/%d") if d else str(v or "").strip()


def dmy(v):
    d = db.parse_date(v) if v else None
    return d.strftime("%d/%m/%Y") if d else str(v or "").strip()


def _txt(v):
    return str(v if v is not None else "").strip()


# ---------------------------------------------------------------------------
# Word: استبدال الحقول على مستوى XML
# ---------------------------------------------------------------------------
def _texts(p):
    return [t for r in p.findall(W + "r") for t in r.findall(W + "t")]


def _replace_span(ts, start, end, new):
    pos, first = 0, True
    for t in ts:
        s = t.text or ""
        a, b = pos, pos + len(s)
        pos = b
        if b <= start or a >= end:
            continue
        lo, hi = max(start, a) - a, min(end, b) - a
        t.text = s[:lo] + (new if first else "") + s[hi:]
        t.set(XML_SPACE, "preserve")
        first = False


def _is_rtl(p, t):
    """النص ده بيتعرض من اليمين للشمال؟ (الـ run عليه rtl، أو الفقرة bidi)"""
    def on(parent, tag):
        el = parent.find(W + tag) if parent is not None else None
        return el is not None and el.get(W + "val") not in ("0", "false")
    return on(t.getparent().find(W + "rPr"), "rtl") or on(p.find(W + "pPr"), "bidi")


def _fill_paragraph(p, ctx):
    while True:
        ts = _texts(p)
        full = "".join(t.text or "" for t in ts)
        m = TOKEN.search(full)
        if not m:
            return
        name, value = m.group(1), _txt(ctx.get(m.group(1)))
        end, pos, at = m.end(), 0, ts[0]
        for t in ts:                                      # العنصر اللي الحقل بيبدأ فيه
            if pos <= m.start() < pos + len(t.text or ""):
                at = t
                break
            pos += len(t.text or "")
        if DATE_YMD.fullmatch(value) and _is_rtl(p, at):  # Word بيقلب «سنة/شهر/يوم» في السطر العربي ← نكتبها مقلوبة فتظهر صح
            value = "/".join(reversed(value.split("/")))
        if name in WIDTHS:                               # سطر متنسّق بالمسافات ← عوّض فرق الطول من المسافات اللي بعده
            k = len(full) - end - len(full[end:].lstrip(" "))
            if k >= 2:
                value += " " * max(1, k - (len(value) - WIDTHS[name]))
                end += k
        _replace_span(ts, m.start(), end, value)


def fill_docx(path, ctx, drop_shapes=()):
    """قالب Word ← docx bytes متملّي. drop_shapes = أشكال VML بتتشال (بالـ id)."""
    z = zipfile.ZipFile(path)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zo:
        for item in z.infolist():
            data = z.read(item.filename)
            if re.fullmatch(r"word/(document|header\d*|footer\d*)\.xml", item.filename) and b"{{" in data:
                root = etree.fromstring(data)
                for shape_id in drop_shapes:
                    for el in root.xpath(f"//*[@id='{shape_id}']"):
                        pict = next((a for a in el.iterancestors() if a.tag == W + "pict"), None)
                        if pict is not None and pict.getparent() is not None:
                            pict.getparent().remove(pict)
                for p in root.iter(W + "p"):
                    _fill_paragraph(p, ctx)
                data = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
            zo.writestr(item, data)
    return out.getvalue()


def fill_xlsx(path, ctx):
    """قالب Excel ← xlsx bytes: الحقول في sharedStrings بتتبدّل بقيمها (الأشكال والشعار زي ما هم)."""
    def value(m):
        v = _txt(ctx.get(m.group(1)))
        return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    z = zipfile.ZipFile(path)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zo:
        for item in z.infolist():
            data = z.read(item.filename)
            if item.filename == "xl/sharedStrings.xml":
                data = TOKEN.sub(value, data.decode("utf-8")).encode("utf-8")
            zo.writestr(item, data)
    return out.getvalue()


# ---------------------------------------------------------------------------
# الحقول لكل نموذج (من بيانات النافذة)
# ---------------------------------------------------------------------------
def _common(d):
    m = d.get("mandoub") or {}
    return {
        "contractor_ar": d.get("contractorAr"), "contractor_en": d.get("contractorEn"),
        "subcontractor": d.get("subcontractor"), "subcontractor_en": d.get("subcontractorEn") or d.get("subcontractor"),
        "contract_no": d.get("contractNo"), "start": ymd(d.get("startDate")), "end": ymd(d.get("endDate")), "ext": ymd(d.get("extDate")),
        "team": d.get("team"), "team_en": d.get("teamEn"), "team_code": d.get("teamCode"),
        "from": ymd(d.get("from")), "to": ymd(d.get("to")), "date": ymd(d.get("requestDate")),
        "mandoub": m.get("name"), "mandoub_nationality": m.get("nationality"), "mandoub_civil": m.get("civilId"),
        "mandoub_phone": m.get("phone"), "signatory": d.get("signatory"),
    }


def _vehicle_rows(d, n, fields):
    ctx = {}
    vs = d.get("vehicles") or []
    for i in range(1, n + 1):
        v = vs[i - 1] if i <= len(vs) else {}
        for token, key, fmt in fields:
            ctx[f"v{i}_{token}"] = fmt(v.get(key)) if v else ""
    return ctx


def documents(form, d):
    """نموذج ← [(الامتداد، الملف المتملّي)] — شهادة الفحص نسخة لكل مركبة."""
    path = os.path.join(DIR, TEMPLATES[form])
    vs = d.get("vehicles") or []
    ctx = _common(d)
    if form == "clearance":
        out = []
        for v in vs:
            c = dict(ctx, plate=v.get("plate"), shape_en=v.get("shapeEn"), chassis=v.get("chassis"), model_en=v.get("modelEn"),
                     checked=dmy(v.get("checked")), ref=v.get("ref"), valid=dmy(v.get("valid")))
            out.append(("docx", fill_docx(path, c)))
        return out
    if form == "checklist":
        plates = [_txt(v.get("plate")) for v in vs if _txt(v.get("plate"))]
        per = max(1, -(-len(plates) // 4))                 # 4 سطور في النموذج
        for i in range(4):
            ctx[f"plates{i + 1}"] = "  -  ".join(plates[i * per:(i + 1) * per])
        ctx.update(permanent=ymd(d.get("permanent")), temporary=ymd(d.get("temporary")))
        return [("docx", fill_docx(path, ctx))]
    if form == "undertaking":
        ctx.update(_vehicle_rows(d, ROWS[form], (("plate", "plate", _txt), ("shape", "shape", _txt), ("color", "color", _txt))))
        return [("docx", fill_docx(path, ctx))]
    if form == "request":
        ctx.update(_vehicle_rows(d, ROWS[form], (("plate", "plate", _txt), ("shape", "shape", _txt), ("color", "color", _txt),
                                                 ("old", "oldPermitNo", _txt))))
        return [("docx", fill_docx(path, ctx, drop_shapes=VOID_LINES if len(vs) != 1 else ()))]
    if form == "ratqa":
        areas, kind = d.get("areas") or {}, d.get("requestType")
        ctx.update(x_ratqa="X" if areas.get("ratqa") else "", x_abdali="X" if areas.get("abdali") else "",
                   **{f"x_{k}": "X" if kind == k else "" for k in ("renew", "first", "lost", "damaged")})
        ctx["end"] = ymd(d.get("extDate") or d.get("endDate"))      # النموذج فيه «نهاية العقد» بس ← بعد التمديد
        for i in range(1, ROWS[form] + 1):
            v = vs[i - 1] if i <= len(vs) else None
            ctx.update({f"v{i}_plate": v and v.get("plate"), f"v{i}_shape": v and v.get("shape"), f"v{i}_year": v and v.get("modelYear"),
                        f"v{i}_color": v and v.get("color"), f"v{i}_color2": v and v.get("color2"),
                        f"v{i}_from": ymd(d.get("from")) if v else "", f"v{i}_to": ymd(d.get("to")) if v else "",
                        f"v{i}_old": v and v.get("oldPermitNo"), f"v{i}_old_exp": ymd(v.get("oldPermitExpiry")) if v else "",
                        f"v{i}_lic_exp": ymd(v.get("licenseExpiry")) if v else ""})
        return [("xlsx", fill_xlsx(path, ctx))]
    raise KeyError(form)


def check(kind, forms, d):
    """رسالة خطأ أو None."""
    if kind not in FORMS:
        return "نوع التصريح غير معروف"
    known = [k for k, _ in FORMS[kind]]
    if not forms or any(f not in known for f in forms):
        return "النموذج غير معروف"
    vs = d.get("vehicles") or []
    if not vs:
        return "اختار سيارة واحدة على الأقل"
    if any(not _txt(v.get("plate")) for v in vs):
        return "رقم اللوحة ناقص لسيارة في القايمة"
    for f in forms:
        if len(vs) > ROWS[f]:
            name = dict(FORMS[kind])[f]
            return f"«{name}» بيشيل {ROWS[f]} سيارات بالكتير — قسّم الطلب"
    return None


def render(kind, forms, d):
    """النماذج المطلوبة ← PDF واحد (بترتيب القايمة). بيرمي RuntimeError لو مفيش Word / Excel / LibreOffice."""
    docs = [(form, ext, data) for form in forms for ext, data in documents(form, d)]
    pdfs = {}
    words = [(i, data) for i, (_, ext, data) in enumerate(docs) if ext == "docx"]
    if words:
        for (i, _), pdf in zip(words, contracts.to_pdfs([data for _, data in words])):
            pdfs[i] = pdf
    for i, (_, ext, data) in enumerate(docs):
        if ext == "xlsx":
            pdfs[i] = contracts.xlsx_to_pdf(data)
    ordered = [pdfs[i] for i in range(len(docs))]
    return ordered[0] if len(ordered) == 1 else contracts.merge_pdfs(ordered)
