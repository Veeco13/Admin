# -*- coding: utf-8 -*-
"""
النماذج الرسمية (PDF قابل للتعبئة) متعبّية من بيانات الموظف أو المترشّح:
- residency: نموذج الإقامة الجديد 2018 (وزارة الداخلية — الإدارة العامة لشؤون الإقامة) — للموظفين.
- driving:   نموذج إصدار رخصة القيادة + شهادتين اللياقة الطبية (الإدارة العامة للمرور) — للموظفين والمترشّحين.
- pifss103:  إشعار التحاق / انتهاء خدمة مؤمن عليه (استمارة 103 — المؤسسة العامة للتأمينات الاجتماعية) — للعمالة الوطنية.
- social:    استمارة طلب صرف العلاوة الاجتماعية وعلاوة الأولاد (الهيئة العامة للقوى العاملة) — للعمالة الوطنية.

forms/*.pdf = النموذج الرسمي فاضي (من غير تشفير، ومن غير القيم التجريبية) — بيتعمل مرة واحدة من الملف
الأصلي بـ prepare_base() / prepare_pifss_103() / prepare_social(). الخانات بتفضل قابلة للكتابة. نص الخانات
المتعبّية بنرسمه إحنا (pdf_text.py) بخط متضمّن وحروف موصولة، لأن عارض كروم/إيدج بيرسم العربي حروف منفصلة.
"""
import io
import json
import os
import re
from datetime import date, datetime

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, BooleanObject, ContentStream, DecodedStreamObject, DictionaryObject, FloatObject,
                           NameObject, NumberObject, TextStringObject)

import pdf_text

FORMS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "forms")

# مواطنين الكويت والخليج مالهمش إقامة
NO_RESIDENCY = {"الكويت", "كويتي", "معاملة كويتية", "السعودية", "الامارات", "قطر", "البحرين", "عمان", "سلطنة عمان"}
# اسم الجنسية عندنا ← اسمها في قائمة نموذج الإقامة (لما الاسمين مختلفين)
NATIONALITY_ALIASES = {"بنغلاديش": "بنجلاديش", "الفلبين": "الفليبين", "سيرا ليون": "سيراليون",
                       "سيريلانكا": "سيلان - سيريلانكا", "بوركينا فاسو": "بوركينا فاصو",
                       "الولايات المتحدة الامريكية": "الولايات المتحدة"}
GOVERNORATES = ("العاصمة", "حولي", "الفروانية", "مبارك الكبير", "الأحمدي", "الجهراء")
BLOOD_TYPES = ("A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-")
GENDER_AR = {"male": "ذكر", "female": "أنثى"}

# العمالة الوطنية (نماذج التأمينات والعلاوة الاجتماعية): الكويتي ومعاملة كويتية
KUWAITI = {"الكويت", "كويتي", "كويتية", "معاملة كويتية"}
MARITAL_AR = {"single": ("أعزب", "عزباء"), "married": ("متزوج", "متزوجة"), "divorced": ("مطلق", "مطلقة"),
              "widowed": ("أرمل", "أرملة")}

# البيانات اللي ممكن تتبعت من نافذة النموذج (البيانات الناقصة) — غيرها بيتجاهل
PERSON_KEYS = {"nameEn", "civilId", "nationality", "profession", "dateOfBirth", "gender", "placeOfBirth",
               "passportNo", "passportIssueDate", "passportExp", "unifiedNumber", "bloodType", "actualWorkplace",
               "addressArea", "addressBlock", "addressStreet", "addressHouse", "addressApartment", "homePhone", "phone",
               "email", "maritalStatus", "qualification", "specialization", "naturalizationDate", "citizenshipArticle",
               "nationalityNo", "studyInstitution", "studyAbroad", "studyStartDate", "dateOfHire", "serviceEndDate"}
COMPANY_KEYS = {"licenseCivilNo", "unifiedNumber", "pifssNo"}


# ---------------------------------------------------------------------------
# أدوات عامة
# ---------------------------------------------------------------------------
def _norm(s):
    s = re.sub(r"[ً-ْ]", "", s or "")
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()


def needs_residency(nationality):
    return _norm(nationality) not in {_norm(x) for x in NO_RESIDENCY}


def is_kuwaiti(nationality):
    """العمالة الوطنية (استمارة 103 واستمارة العلاوة الاجتماعية)."""
    return _norm(nationality) in {_norm(x) for x in KUWAITI}


def governorate_of(labor_office):
    """«إدارة عمل محافظة الأحمدي» ← «الأحمدي» (أو None لو مش محافظة، زي العقود الحكومية)."""
    n = _norm(labor_office)
    return next((g for g in GOVERNORATES if _norm(g) in n), None)


def _date(v):
    if not v:
        return None
    return v if isinstance(v, (date, datetime)) else datetime.strptime(str(v)[:10], "%Y-%m-%d")


def _fmt_date(v):
    d = _date(v)
    return d.strftime("%d/%m/%Y") if d else ""


def _field(annot):
    """الـ widget ← قاموس الخانة (اللي فيه /T): نفسه أو الـ Parent."""
    a = annot
    while a is not None and "/T" not in a:
        a = a.get("/Parent")
        a = a.get_object() if a is not None else None
    return a


def _options(fld):
    return [str(o.get_object()[1] if isinstance(o.get_object(), list) else o.get_object()) for o in fld.get("/Opt", [])]


def _pick(fld, wanted):
    """القيمة زي ما هي مكتوبة في قائمة الخانة (القوائم فيها مسافات وأكواد: «مصر - 7»)، أو النص نفسه لو مش فيها.
    الأول مطابقة بالاسم (من غير الكود)، وبعدين من غير «ال» («نيبال» = «النيبال»)، وبعدين آخر كلمة
    («الأحمدي» = «محافطة الأحمدي» — القائمة مكتوبة بالطاء)."""
    n = _norm(wanted)
    bare = lambda s: re.sub(r"^ال", "", s)
    opts = [(o, re.sub(r"\s*-\s*\d+$", "", _norm(o))) for o in _options(fld)]
    for rule in (lambda on: on == n, lambda on: bare(on) == bare(n), lambda on: on.endswith(" " + n)):
        for o, on in opts:
            if rule(on):
                return o
    return wanted


def _widgets(w):
    for page in w.pages:
        for annot in page.get("/Annots", []):
            a = annot.get_object()
            fld = _field(a)
            if fld is not None:
                yield a, fld


def prepare_base(src, dst, extra_options=None):
    """مرة واحدة: النموذج الأصلي (ممكن يكون مشفّر وفيه قيم تجريبية) ← نسخة فاضية في forms/.
    extra_options = {اسم الخانة: [قيم تتضاف أول القائمة]}. فك التشفير محتاج مكتبة cryptography."""
    r = PdfReader(src)
    if r.is_encrypted:
        r.decrypt("")
    w = PdfWriter(clone_from=r)
    for a, fld in _widgets(w):
        if fld.get("/FT") not in ("/Tx", "/Ch"):
            continue
        for k in ("/V", "/DV"):
            if k in fld:
                del fld[k]
        if "/AP" in a:
            del a["/AP"]
        name = str(fld.get("/T"))
        if extra_options and name in extra_options and "/Opt" in fld:
            have = set(_options(fld))
            new = [TextStringObject(x) for x in extra_options[name] if x not in have]
            fld[NameObject("/Opt")] = ArrayObject(new + list(fld["/Opt"]))
    w._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        w.write(f)


def _set_button(a, fld, value):
    """مربع اختيار (value = True) أو زرار من مجموعة اختيار (value = اسم الحالة، زي "Choice2")."""
    states = [k for k in ((a.get("/AP") or {}).get("/N") or {}) if k != "/Off"]
    on = next((k for k in states if value is True or k == "/" + str(value)), None)
    a[NameObject("/AS")] = NameObject(on or "/Off")
    if on:
        fld[NameObject("/V")] = NameObject(on)


def _fill(path, values):
    """PDF متعبّي (bytes). القيم الفاضية مابتتكتبش، والخانات بتفضل قابلة للتعديل.
    مربعات الاختيار: True، وأزرار المجموعات: اسم الحالة."""
    w = PdfWriter(clone_from=PdfReader(path))
    vals = {k: v for k, v in values.items() if v not in (None, "", False)}
    drawn = []
    for a, fld in _widgets(w):
        name = str(fld.get("/T"))
        if name not in vals:
            continue
        if fld.get("/FT") == "/Btn":
            _set_button(a, fld, vals[name])
            continue
        v = _pick(fld, str(vals[name])) if fld.get("/FT") == "/Ch" else str(vals[name])
        fld[NameObject("/V")] = TextStringObject(v)
        drawn.append((a, fld, v))
    pdf_text.draw_fields(w, drawn)           # النص مرسوم بحروف موصولة (ولو مفيش خط مناسب: العارض بيرسمه)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def split_name(full):
    """الاسم الكامل ← (الأول، الأب، الجد، الرابع، الأخير). «عبد» و«أبو» بيتلزقوا في الكلمة اللي بعدهم."""
    words, parts = (full or "").split(), []
    i = 0
    while i < len(words):
        w_ = words[i]
        if _norm(w_) in ("عبد", "ابو", "بو") and i + 1 < len(words):
            w_, i = w_ + " " + words[i + 1], i + 1
        parts.append(w_)
        i += 1
    if len(parts) <= 1:
        return (parts[0] if parts else "", "", "", "", "")
    if len(parts) == 2:
        return parts[0], "", "", "", parts[1]
    if len(parts) == 3:
        return parts[0], parts[1], "", "", parts[2]
    if len(parts) == 4:
        return parts[0], parts[1], parts[2], "", parts[3]
    return parts[0], parts[1], parts[2], " ".join(parts[3:-1]), parts[-1]


# ---------------------------------------------------------------------------
# نموذج الإقامة الجديد 2018
# ---------------------------------------------------------------------------
RESIDENCY_PATH = os.path.join(FORMS_DIR, "residency_2018.pdf")
RESIDENCY_ACTIONS = ("إصدار", "إضافة", "إلغاء", "تجديد", "تعديل بيانات", "حذف", "نقل كفالة", "نقل معلومات")


def residency_values(emp, company, action, extra=None):
    """اسم الخانة في النموذج ← القيمة."""
    company = company or {}
    gov = governorate_of(company.get("laborOffice"))
    nat = (emp.get("nationality") or "").strip()
    return {
        # رأس النموذج: إقامة (Group1 = /1 في الأصل) · عمل أهلي · 18 عمل أهلي
        "--- اختار اسم المحافظه ---": gov,
        "EntrType": "عمل أهلي",
        "restype": "18 عمل أهلي",
        "Dropdown1": action,
        # بيانات القادم / المقيم
        "CID": emp.get("id"),
        "Ref": emp.get("unifiedNumber"),
        "DOB": _fmt_date(emp.get("dateOfBirth")),
        "Sex1": GENDER_AR.get(emp.get("gender") or ""),
        "Place": emp.get("placeOfBirth"),
        "Arabic name": emp.get("name"),
        "Full Name": (emp.get("nameEn") or "").upper(),
        "Pass No": emp.get("passportNo"),
        "Pass Type": "عادي",
        "Issue date": _fmt_date(emp.get("passportIssueDate")),
        "Exp date": _fmt_date(emp.get("passportExp")),
        "Nationality": NATIONALITY_ALIASES.get(nat, nat),
        "Relation": "عمل",
        "Occupation1": emp.get("profession"),
        # بيانات صاحب العمل (الشركة المسجّل عليها)
        "CID-2": company.get("licenseCivilNo"),
        "Ref-2": company.get("unifiedNumber"),
        "Comp Name": company.get("nameAr"),
        "Nationality 1": "الكويت",
        "Dropdown2": gov,
    }


# ---------------------------------------------------------------------------
# نموذج إصدار رخصة القيادة (3 صفحات: الطلب + شهادتين لياقة طبية بنفس البيانات)
# ---------------------------------------------------------------------------
DRIVING_PATH = os.path.join(FORMS_DIR, "driving_license.pdf")
DRIVING_ACTIONS = ("إصدار رخصة سوق خاصة", "إصدار رخصة سوق عامة", "إصدار رخصة سوق دراجة", "إصدار رخصة سوق إنشائية")
# قائمة «السنة» في الأصل من 2002 لـ 1931 ← بتتضاف السنين لحد 2010 (prepare_base)
DRIVING_EXTRA_YEARS = [str(y) for y in range(2010, 2002, -1)]


def driving_values(person, company, action, extra=None):
    """person = موظف أو مترشّح (civilId = الرقم المدني)."""
    company = company or {}
    first, father, grand, fourth, last = split_name(person.get("name"))
    dob = _date(person.get("dateOfBirth"))
    return {
        "معاملات رخص السوق": action,
        "Today": datetime.now().strftime("%Y/%m/%d"),
        "الرقم الموحد": person.get("unifiedNumber"),
        "الرقم المدني": person.get("civilId"),
        "الإسم الأول": first, "إسم الأب": father, "إسم الجد": grand, "الإسم الرابع": fourth, "الإسم الأخير": last,
        "الجنسية": person.get("nationality"),
        "الجنس": GENDER_AR.get(person.get("gender") or ""),
        "اليوم": str(dob.day) if dob else None,
        "الشهر": str(dob.month) if dob else None,
        "السنة": str(dob.year) if dob else None,
        "فصيلة الدم": person.get("bloodType"),
        "المهنة": person.get("profession"),
        "عنوان العمل": person.get("actualWorkplace"),
        "المنطقة": person.get("addressArea"),
        "القطعة": person.get("addressBlock"),
        "الشارع": person.get("addressStreet"),
        "المنزل": person.get("addressHouse"),
        "الشقة": person.get("addressApartment"),
        "رقم هاتف المنزل": person.get("homePhone"),
        "رقم الهاتف النقال": person.get("phone"),
        "إسم الكفيل": company.get("nameAr"),
    }


# ---------------------------------------------------------------------------
# العمالة الوطنية: أدوات مشتركة
# ---------------------------------------------------------------------------
def _dmy(v):
    """تاريخ ← (يوم، شهر، سنة) نصوص، اليوم والشهر برقمين."""
    d = _date(v)
    return (f"{d.day:02d}", f"{d.month:02d}", str(d.year)) if d else ("", "", "")


def _kd(amount):
    """مبلغ ← (دينار، فلس). الفلس فاضي لو صفر."""
    if amount in (None, ""):
        return "", ""
    kd, fils = divmod(round(float(amount) * 1000), 1000)
    return str(kd), (f"{fils:03d}" if fils else "")


def address_text(p):
    """«الفنطاس / قطعة 2 / شارع 16 / منزل 320»"""
    parts = [p.get("addressArea"), p.get("addressBlock") and f"قطعة {p['addressBlock']}",
             p.get("addressStreet") and f"شارع {p['addressStreet']}", p.get("addressHouse") and f"منزل {p['addressHouse']}",
             p.get("addressApartment") and f"شقة {p['addressApartment']}"]
    return " / ".join(x for x in parts if x)


def children_of(person):
    """الأبناء (عمود JSON في الموظف) ← قائمة، اللي من غير اسم بيتشال."""
    ch = person.get("children")
    if isinstance(ch, str):
        try:
            ch = json.loads(ch)
        except ValueError:
            ch = []
    return [c for c in (ch or []) if isinstance(c, dict) and (c.get("name") or "").strip()]


def age_years(dob, on=None):
    d = _date(dob)
    if not d:
        return None
    on = on or date.today()
    return on.year - d.year - ((on.month, on.day) < (d.month, d.day))


def _annots(page):
    if "/Annots" not in page:
        page[NameObject("/Annots")] = ArrayObject()
    return page["/Annots"].get_object() if hasattr(page["/Annots"], "get_object") else page["/Annots"]


def _add_field(w, page, name, rect, ft="/Tx", da="/Helv 0 Tf 0 g", q=2, ff=0, maxlen=None, extra=None):
    """خانة جديدة (widget + field في قاموس واحد) على الصفحة وفي /Fields."""
    d = DictionaryObject({
        NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/FT"): NameObject(ft), NameObject("/T"): TextStringObject(name),
        NameObject("/Rect"): ArrayObject([FloatObject(round(v, 2)) for v in rect]), NameObject("/F"): NumberObject(4),
        NameObject("/P"): page.indirect_reference, NameObject("/DA"): TextStringObject(da), NameObject("/Q"): NumberObject(q),
        NameObject("/Ff"): NumberObject(ff),
    })
    if maxlen:
        d[NameObject("/MaxLen")] = NumberObject(maxlen)
    d.update(extra or {})
    ref = w._add_object(d)
    _annots(page).append(ref)
    w._root_object["/AcroForm"]["/Fields"].append(ref)
    return d


def _form_xobject(w, wd, ht, content, fonts=None):
    return pdf_text._stream(w, content.encode("latin-1"), {
        "/Type": NameObject("/XObject"), "/Subtype": NameObject("/Form"),
        "/BBox": ArrayObject([FloatObject(0), FloatObject(0), FloatObject(round(wd, 2)), FloatObject(round(ht, 2))]),
        "/Resources": DictionaryObject({NameObject("/Font"): DictionaryObject(
            {NameObject(k): v for k, v in (fonts or {}).items()})}),
    })


def _add_checkbox(w, page, name, rect, zadb):
    """مربع اختيار بعلامة ✔ (ZapfDingbats «4») — بيتعلّم من السيستم وتقدر تغيّره في العارض."""
    x1, y1, x2, y2 = rect
    wd, ht = x2 - x1, y2 - y1
    size = min(wd, ht) * 0.8
    on = _form_xobject(w, wd, ht, f"q BT /ZaDb {size:.2f} Tf 0 g {(wd - size * 0.846) / 2:.2f} {(ht - size * 0.7) / 2:.2f} Td (4) Tj ET Q",
                       {"/ZaDb": zadb})
    off = _form_xobject(w, wd, ht, "")
    _add_field(w, page, name, rect, ft="/Btn", da="/ZaDb 0 Tf 0 g", q=0, extra={
        NameObject("/AP"): DictionaryObject({NameObject("/N"): DictionaryObject({NameObject("/Yes"): on, NameObject("/Off"): off})}),
        NameObject("/AS"): NameObject("/Off"), NameObject("/V"): NameObject("/Off"),
        NameObject("/MK"): DictionaryObject({NameObject("/CA"): TextStringObject("4")}),
    })


def _std_font(w, base):
    return w._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject(base),
        **({NameObject("/Encoding"): NameObject("/WinAnsiEncoding")} if base != "/ZapfDingbats" else {})}))


# ---------------------------------------------------------------------------
# إشعار التحاق / انتهاء خدمة مؤمن عليه (استمارة 103 — التأمينات الاجتماعية)
# ---------------------------------------------------------------------------
PIFSS_PATH = os.path.join(FORMS_DIR, "pifss_103.pdf")
PIFSS_ACTIONS = ("تسجيل أول مرة", "سبق تسجيله", "إنهاء خدمة")
# أسماء خانات الأصل (fill_N) ← أسماء واضحة (prepare_pifss_103). جدول «بيان الاستقطاع» بيفضل بأسمائه وفاضي.
PIFSS_RENAME = {
    "fill_10": "name1", "fill_9": "name2", "fill_8": "name3", "fill_7": "name4",
    "fill_12": "address", "fill_11": "civilId", "fill_17": "email", "fill_13": "phone",
    "fill_16": "dobD", "fill_15": "dobM", "fill_14": "dobY",
    "fill_23": "nationality", "fill_22": "nationalityNo", "fill_21": "article",
    "fill_20": "natD", "fill_19": "natM", "fill_18": "natY",
    "fill_24": "employer", "fill_25": "regNo",
    "fill_31": "joinD", "fill_30": "joinM", "fill_29": "joinY",
    "fill_28": "subD", "fill_27": "subM", "fill_26": "subY", "fill_32": "occupation",
    "fill_38": "salaryKD", "fill_39": "salaryFils", "fill_40": "socialKD", "fill_41": "socialFils",
    "fill_36": "allowKD", "fill_37": "allowFils", "fill_35": "lastSalD", "fill_34": "lastSalM", "fill_33": "lastSalY",
    "fill_46": "endD", "fill_45": "endM", "fill_44": "endY", "fill_43": "endReason", "fill_42": "absenceDays",
    "fill_1": "respName", "undefined_2": "respTitle", "undefined_4": "respSign",
    "fill_113": "officialBox", "undefined": "officialRef", "undefined_3": "officialSign", "undefined_5": "insuredSign",
}
# الأصل فيه مجموعة أزرار واحدة (Group30) للـ 3 أسئلة، فأي اختيار بيلغي التاني ← 3 مجموعات
PIFSS_RADIOS = {"requestType": ("/Choice1", "/Choice2", "/Choice3"),       # تسجيل أول مرة / سبق تسجيله / إنهاء خدمة
                "rewardSystem": ("/Choice4", "/Choice5"),                  # يوجد نظام صرف مكافأة: نعم / لا
                "rewardPaid": ("/Choice6", "/Choice7", "/Choice8")}        # صرف مكافأة: قبل / بعد قانون 2014/110 / لم يتم
# تاريخ التوقيع: الشرطتين مطبوعتين في الصفحة ← اليوم والشهر والسنة كل واحد في مكانه (x1، x2) على السطر y 41..57
PIFSS_SIGN_DATE = {"signD": (404, 429), "signM": (381, 399), "signY": (328, 376)}
PIFSS_END_REASONS = ("استقالة", "إنهاء خدمات من صاحب العمل", "انتهاء العقد", "التقاعد", "الوفاة")


def prepare_pifss_103(src, dst):
    """مرة واحدة: استمارة 103 (متعبّية ببيانات موظف) ← نسخة فاضية في forms/ بأسماء خانات واضحة، و3 أسئلة اختيار
    مستقلة، وتاريخ التوقيع منفصل عن تاريخ «للاستعمال الرسمي» (كانوا خانة واحدة في المكانين)."""
    w = PdfWriter(clone_from=PdfReader(src))
    acro, page = w._root_object["/AcroForm"], w.pages[0]
    fields = acro["/Fields"]
    for a, fld in list(_widgets(w)):
        for k in ("/V", "/DV"):
            if k in fld:
                del fld[k]
        if fld.get("/FT") == "/Btn":
            a[NameObject("/AS")] = NameObject("/Off")
        elif "/AP" in a:
            del a["/AP"]
        name = str(fld.get("/T"))
        if name in PIFSS_RENAME:
            fld[NameObject("/T")] = TextStringObject(PIFSS_RENAME[name])
    by_name = {str(f.get_object().get("/T")): f for f in fields}
    group = by_name["Group30"].get_object()
    new_refs = []
    for name, states in PIFSS_RADIOS.items():
        parent = DictionaryObject({NameObject("/FT"): NameObject("/Btn"), NameObject("/Ff"): NumberObject(int(group.get("/Ff", 49152))),
                                   NameObject("/T"): TextStringObject(name), NameObject("/Kids"): ArrayObject()})
        ref = w._add_object(parent)
        for k in group["/Kids"]:
            if any(st in ((k.get_object().get("/AP") or {}).get("/N") or {}) for st in states):
                k.get_object()[NameObject("/Parent")] = ref
                parent["/Kids"].append(k)
        new_refs.append(ref)
    i = list(fields).index(by_name["Group30"])
    fields[i:i + 1] = new_refs
    t31 = by_name["Text31"].get_object()
    sign_kid = max(t31["/Kids"], key=lambda k: float(k.get_object()["/Rect"][0]))       # الأيمن = تاريخ التوقيع
    t31["/Kids"].remove(sign_kid)
    _annots(page).remove(sign_kid)
    t31[NameObject("/T")] = TextStringObject("officialDate")
    for name, (x1, x2) in PIFSS_SIGN_DATE.items():
        _add_field(w, page, name, (x1, 41, x2, 57), da="/SimplifiedArabic 12 Tf 0 g", q=1)
    # خطوط الخانات في الأصل = كل خطوط الجهاز اللي اتعمل عليه (حوالي 50 خط متضمّن، 8 ميجا) ← الـ 3 اللي الخانات بتذكرهم
    # بس ومن غير تضمين (النص بنرسمه إحنا بخطنا، pdf_text)
    fonts = acro["/DR"]["/Font"]
    for k in list(fonts):
        if k not in ("/Helv", "/ZaDb", "/SimplifiedArabic"):
            del fonts[k]
    sa = fonts["/SimplifiedArabic"].get_object()
    for f in [sa] + [d.get_object() for d in sa.get("/DescendantFonts", [])]:
        fd = f.get("/FontDescriptor")
        for k in ("/FontFile", "/FontFile2", "/FontFile3"):
            if fd is not None and k in fd.get_object():
                del fd.get_object()[k]
    acro[NameObject("/NeedAppearances")] = BooleanObject(False)
    buf = io.BytesIO()
    w.write(buf)
    w = PdfWriter(clone_from=PdfReader(buf))          # نسخة بالمستخدم بس ← الخطوط المشالة مابتتكتبش
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        w.write(f)


def pifss_values(emp, company, action, extra=None):
    """extra = اختيارات النافذة: sigName / sigTitle (المفوّض)، signDate، endReason، reward (yes/no)،
    rewardPaid (before/after/none)، socialAllowance، allowances، lastSalaryDate."""
    company, extra = company or {}, extra or {}
    first, father, grand, fourth, last = split_name(emp.get("name"))
    nat = (emp.get("nationality") or "").strip()
    ending = action == "إنهاء خدمة"
    dob, natd, join = _dmy(emp.get("dateOfBirth")), _dmy(emp.get("naturalizationDate")), _dmy(emp.get("dateOfHire"))
    end = _dmy(emp.get("serviceEndDate")) if ending else ("", "", "")
    last_sal, sign = _dmy(extra.get("lastSalaryDate")), _dmy(extra.get("signDate") or date.today())
    sal, social, allow = _kd(emp.get("salary")), _kd(extra.get("socialAllowance")), _kd(extra.get("allowances"))
    return {
        "requestType": dict(zip(PIFSS_ACTIONS, ("Choice1", "Choice2", "Choice3"))).get(action),
        "name1": first, "name2": father, "name3": " ".join(x for x in (grand, fourth) if x), "name4": last,
        "civilId": emp.get("civilId") or emp.get("id"), "address": address_text(emp),
        "phone": emp.get("phone"), "email": emp.get("email"),
        "dobD": dob[0], "dobM": dob[1], "dobY": dob[2],
        "nationality": "كويتي" if _norm(nat) in {_norm("الكويت"), _norm("كويتي"), _norm("كويتية")} else nat,
        "nationalityNo": emp.get("nationalityNo"), "article": emp.get("citizenshipArticle"),
        "natD": natd[0], "natM": natd[1], "natY": natd[2],
        "employer": company.get("nameAr"), "regNo": company.get("pifssNo"),
        "joinD": join[0], "joinM": join[1], "joinY": join[2],
        "subD": join[0], "subM": join[1], "subY": join[2],                  # بدء الاشتراك = تاريخ الالتحاق
        "occupation": emp.get("profession"),
        "salaryKD": sal[0], "salaryFils": sal[1], "socialKD": social[0], "socialFils": social[1],
        "allowKD": allow[0], "allowFils": allow[1],
        "lastSalD": last_sal[0], "lastSalM": last_sal[1], "lastSalY": last_sal[2],
        "endD": end[0], "endM": end[1], "endY": end[2], "endReason": extra.get("endReason") if ending else None,
        "rewardSystem": {"yes": "Choice4", "no": "Choice5"}.get(extra.get("reward")),
        "rewardPaid": {"before": "Choice6", "after": "Choice7", "none": "Choice8"}.get(extra.get("rewardPaid")),
        "respName": extra.get("sigName"),
        "respTitle": extra.get("sigTitle") or ("المفوض بالتوقيع" if extra.get("sigName") else None),
        "signD": sign[0], "signM": sign[1], "signY": sign[2],
    }


# ---------------------------------------------------------------------------
# استمارة طلب صرف العلاوة الاجتماعية وعلاوة الأولاد (الهيئة العامة للقوى العاملة)
# ---------------------------------------------------------------------------
SOCIAL_PATH = os.path.join(FORMS_DIR, "social_allowance.pdf")
SOCIAL_ACTIONS = ("طلب صرف",)
# الأصل ملف Word من غير خانات ← بنضيف خانات فوق النقط والمربعات المطبوعة. الإحداثيات من رسم الصفحة (نقطة PDF).
SOCIAL_TEXT = {   # الاسم: (x1, y1, x2, y2, المحاذاة 0 شمال / 1 وسط / 2 يمين)
    "name": (352, 729, 494, 746, 2), "employer": (300, 709, 509, 725, 2),
    "phone1": (378, 692, 476, 707, 1), "phone2": (266, 692, 370, 707, 1),
    "marital": (410, 674, 500, 689, 1), "qualification": (186, 674, 346, 689, 1),
    "specialization": (298, 655, 390, 670, 1),
    "institution": (283, 610, 427, 625, 1), "studyStart": (60, 610, 198, 625, 1),
    "childrenCount": (472.4, 576.8, 514.4, 597.2, 1),
}
SOCIAL_CIVIL_ID = (49.2, 725.0, 287.9, 745.5)          # 12 مربع، رقم في كل مربع
SOCIAL_BOXES = {"studyYes": (389.6, 636.5, 410.6, 650.3), "studyNo": (340.8, 636.5, 361.8, 650.3),
                "inKuwait": (164.7, 634.8, 187.6, 648.3), "outKuwait": (66.7, 636.3, 89.7, 650.0)}
# جدول الأبناء: 7 صفوف (y1, y2) × الأعمدة (x1, x2, خانة نص أو مربع اختيار)
SOCIAL_ROWS = ((493.9, 512.4), (474.8, 493.2), (455.6, 474.1), (436.5, 454.9), (417.4, 435.8), (398.2, 416.6), (379.0, 397.5))
SOCIAL_COLS = {"Name": (320.2, 529.3, "t"), "Age": (282.9, 319.5, "t"), "Healthy": (252.3, 282.2, "b"),
               "Disabled": (221.6, 251.6, "b"), "Degree": (170.2, 220.8, "t"), "WorksYes": (132.0, 169.5, "b"),
               "WorksNo": (96.3, 131.3, "b"), "MarriedYes": (61.3, 95.5, "b"), "MarriedNo": (27.2, 60.6, "b")}
SOCIAL_TYPED_FONT = "/C2_5"      # الاسم والرقم المدني اللي كانوا مكتوبين في النسخة الأصلية (Arial Bold) ← بيتشالوا


def prepare_social(src, dst):
    """مرة واحدة: الاستمارة (PDF من Word من غير خانات، ومكتوب فيها اسم ورقم مدني) ← نسخة نضيفة بخانات في forms/."""
    w = PdfWriter(clone_from=PdfReader(src))
    page = w.pages[0]
    cs = ContentStream(page.get_contents(), w)
    font, ops = None, []
    for operands, op in cs.operations:
        if op == b"Tf":
            font = operands[0]
        if font == SOCIAL_TYPED_FONT and op in (b"Tj", b"TJ", b"'", b'"'):
            continue
        ops.append((operands, op))
    cs.operations = ops
    page.replace_contents(cs)
    helv, zadb = _std_font(w, "/Helvetica"), _std_font(w, "/ZapfDingbats")
    w._root_object[NameObject("/AcroForm")] = w._add_object(DictionaryObject({
        NameObject("/Fields"): ArrayObject(), NameObject("/DA"): TextStringObject("/Helv 0 Tf 0 g"),
        NameObject("/DR"): DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/Helv"): helv, NameObject("/ZaDb"): zadb})}),
        NameObject("/NeedAppearances"): BooleanObject(False),
    }))
    for name, (x1, y1, x2, y2, q) in SOCIAL_TEXT.items():
        _add_field(w, page, name, (x1, y1, x2, y2), da="/Helv 12 Tf 0 g", q=q)
    _add_field(w, page, "civilId", SOCIAL_CIVIL_ID, da="/Helv 15 Tf 0 g", q=1, ff=pdf_text.COMB, maxlen=12)
    for name, rect in SOCIAL_BOXES.items():
        _add_checkbox(w, page, name, rect, zadb)
    for i, (y1, y2) in enumerate(SOCIAL_ROWS, 1):
        for col, (x1, x2, kind) in SOCIAL_COLS.items():
            if kind == "t":
                _add_field(w, page, f"child{i}{col}", (x1 + 1, y1 + 1, x2 - 1, y2 - 1), da="/Helv 11 Tf 0 g", q=2 if col == "Name" else 1)
            else:
                _add_checkbox(w, page, f"child{i}{col}", (x1 + 1, y1 + 1, x2 - 1, y2 - 1), zadb)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        w.write(f)


def social_values(emp, company, action, extra=None):
    company = company or {}
    kids = children_of(emp)
    ms = MARITAL_AR.get(emp.get("maritalStatus") or "")
    studying = bool((emp.get("studyInstitution") or "").strip())
    abroad = bool(emp.get("studyAbroad"))
    v = {
        "name": emp.get("name"), "civilId": emp.get("civilId") or emp.get("id"), "employer": company.get("nameAr"),
        "phone1": emp.get("phone"), "phone2": emp.get("homePhone"),
        "marital": ms[1 if emp.get("gender") == "female" else 0] if ms else None,
        "qualification": emp.get("qualification"), "specialization": emp.get("specialization"),
        "studyYes": studying, "studyNo": not studying, "inKuwait": studying and not abroad, "outKuwait": studying and abroad,
        "institution": emp.get("studyInstitution") if studying else None,
        "studyStart": _fmt_date(emp.get("studyStartDate")) if studying else None,
        "childrenCount": str(len(kids)),
    }
    for i, c in enumerate(kids[:len(SOCIAL_ROWS)], 1):
        disabled, age = bool(c.get("disabled")), age_years(c.get("dateOfBirth"))
        v.update({f"child{i}Name": c.get("name"), f"child{i}Age": str(age) if age is not None else None,
                  f"child{i}Healthy": not disabled, f"child{i}Disabled": disabled,
                  f"child{i}Degree": c.get("disabilityDegree") if disabled else None,
                  f"child{i}WorksYes": bool(c.get("working")), f"child{i}WorksNo": not c.get("working"),
                  f"child{i}MarriedYes": bool(c.get("married")), f"child{i}MarriedNo": not c.get("married")})
    return v


# ---------------------------------------------------------------------------
FORMS = {
    "residency": {"path": RESIDENCY_PATH, "actions": RESIDENCY_ACTIONS, "values": residency_values, "title": "نموذج إقامة"},
    "driving": {"path": DRIVING_PATH, "actions": DRIVING_ACTIONS, "values": driving_values, "title": "نموذج رخصة قيادة"},
    "pifss103": {"path": PIFSS_PATH, "actions": PIFSS_ACTIONS, "values": pifss_values, "kuwaiti": True,
                 "title": "استمارة 103 - التأمينات الاجتماعية"},
    "social": {"path": SOCIAL_PATH, "actions": SOCIAL_ACTIONS, "values": social_values, "kuwaiti": True,
               "title": "استمارة العلاوة الاجتماعية وعلاوة الأولاد"},
}


def fill(form, person, company, action, extra=None):
    f = FORMS[form]
    return _fill(f["path"], f["values"](person, company, action, extra))
