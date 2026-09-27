# -*- coding: utf-8 -*-
"""
نموذج الإقامة الجديد 2018 (وزارة الداخلية — الإدارة العامة لشؤون الإقامة) متعبّي من بيانات الموظف.

forms/residency_2018.pdf = النموذج الرسمي فاضي (من غير تشفير، ومن غير القيم التجريبية) — بيتعمل مرة
واحدة من الملف الأصلي بـ prepare_base(). الخانات بتفضل قابلة للكتابة، فاللي مش في النظام بيتكتب في
المتصفح قبل الطباعة. NeedAppearances ← المتصفح (أو Acrobat) هو اللي بيرسم النص، فالعربي بيطلع متوصّل.
"""
import io
import os
import re
from datetime import date, datetime

from pypdf import PdfReader, PdfWriter
from pypdf.generic import BooleanObject, NameObject, TextStringObject

FORM_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "forms", "residency_2018.pdf")

# مواطنين الكويت والخليج مالهمش إقامة
NO_RESIDENCY = {"الكويت", "كويتي", "معاملة كويتية", "السعودية", "الامارات", "قطر", "البحرين", "عمان", "سلطنة عمان"}
# اسم الجنسية عندنا ← اسمها في قائمة النموذج (لما الاسمين مختلفين)
NATIONALITY_ALIASES = {"بنغلاديش": "بنجلاديش", "الفلبين": "الفليبين", "سيرا ليون": "سيراليون",
                       "سيريلانكا": "سيلان - سيريلانكا", "بوركينا فاسو": "بوركينا فاصو",
                       "الولايات المتحدة الامريكية": "الولايات المتحدة"}
ACTIONS = ("إصدار", "إضافة", "إلغاء", "تجديد", "تعديل بيانات", "حذف", "نقل كفالة", "نقل معلومات")
GOVERNORATES = ("العاصمة", "حولي", "الفروانية", "مبارك الكبير", "الأحمدي", "الجهراء")


def _norm(s):
    s = re.sub(r"[ً-ْ]", "", s or "")
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()


def needs_residency(nationality):
    return _norm(nationality) not in {_norm(x) for x in NO_RESIDENCY}


def governorate_of(labor_office):
    """«إدارة عمل محافظة الأحمدي» ← «الأحمدي» (أو None لو مش محافظة، زي العقود الحكومية)."""
    n = _norm(labor_office)
    return next((g for g in GOVERNORATES if _norm(g) in n), None)


def _fmt_date(v):
    if not v:
        return ""
    d = v if isinstance(v, (date, datetime)) else datetime.strptime(str(v)[:10], "%Y-%m-%d")
    return d.strftime("%d/%m/%Y")


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


def prepare_base(src, dst=FORM_PATH):
    """مرة واحدة: النموذج الأصلي (مشفّر وفيه قيم تجريبية) ← نسخة فاضية. فك التشفير محتاج مكتبة cryptography."""
    r = PdfReader(src)
    if r.is_encrypted:
        r.decrypt("")
    w = PdfWriter(clone_from=r)
    for annot in w.pages[0].get("/Annots", []):
        a = annot.get_object()
        fld = _field(a)
        if fld is None or fld.get("/FT") not in ("/Tx", "/Ch"):
            continue
        for k in ("/V", "/DV"):
            if k in fld:
                del fld[k]
        if "/AP" in a:
            del a["/AP"]
    w._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        w.write(f)


def values_for(emp, company, action):
    """اسم الخانة في النموذج ← القيمة (القيم الفاضية مابتتكتبش)."""
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
        "DOB": _fmt_date(emp.get("dateOfBirth")),
        "Sex1": {"male": "ذكر", "female": "أنثى"}.get(emp.get("gender") or ""),
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
        "Comp Name": company.get("nameAr"),
        "Nationality 1": "الكويت",
        "Dropdown2": gov,
    }


def fill(emp, company, action="تجديد"):
    """PDF النموذج متعبّي (bytes). الخانات بتفضل قابلة للتعديل."""
    w = PdfWriter(clone_from=PdfReader(FORM_PATH))
    vals = {k: str(v) for k, v in values_for(emp, company, action).items() if v not in (None, "")}
    for annot in w.pages[0].get("/Annots", []):
        a = annot.get_object()
        fld = _field(a)
        name = str(fld.get("/T")) if fld is not None else None
        if name not in vals:
            continue
        v = _pick(fld, vals[name]) if fld.get("/FT") == "/Ch" else vals[name]
        fld[NameObject("/V")] = TextStringObject(v)
        if "/AP" in a:           # المتصفح بيرسمها من /V (NeedAppearances)
            del a["/AP"]
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()
