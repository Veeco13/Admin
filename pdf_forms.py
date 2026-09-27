# -*- coding: utf-8 -*-
"""
النماذج الرسمية (PDF قابل للتعبئة) متعبّية من بيانات الموظف أو المترشّح:
- residency: نموذج الإقامة الجديد 2018 (وزارة الداخلية — الإدارة العامة لشؤون الإقامة) — للموظفين.
- driving:   نموذج إصدار رخصة القيادة + شهادتين اللياقة الطبية (الإدارة العامة للمرور) — للموظفين والمترشّحين.

forms/*.pdf = النموذج الرسمي فاضي (من غير تشفير، ومن غير القيم التجريبية) — بيتعمل مرة واحدة من الملف
الأصلي بـ prepare_base(). الخانات بتفضل قابلة للكتابة. NeedAppearances ← المتصفح (أو Acrobat) هو اللي
بيرسم النص، فالعربي بيطلع متوصّل.
"""
import io
import os
import re
from datetime import date, datetime

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, BooleanObject, NameObject, TextStringObject

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

# البيانات اللي ممكن تتبعت من نافذة النموذج (البيانات الناقصة) — غيرها بيتجاهل
PERSON_KEYS = {"nameEn", "civilId", "nationality", "profession", "dateOfBirth", "gender", "placeOfBirth",
               "passportNo", "passportIssueDate", "passportExp", "unifiedNumber", "bloodType", "actualWorkplace",
               "addressArea", "addressBlock", "addressStreet", "addressHouse", "addressApartment", "homePhone", "phone"}
COMPANY_KEYS = {"licenseCivilNo", "unifiedNumber"}


# ---------------------------------------------------------------------------
# أدوات عامة
# ---------------------------------------------------------------------------
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


def _fill(path, values):
    """PDF متعبّي (bytes). القيم الفاضية مابتتكتبش، والخانات بتفضل قابلة للتعديل."""
    w = PdfWriter(clone_from=PdfReader(path))
    vals = {k: str(v) for k, v in values.items() if v not in (None, "")}
    for a, fld in _widgets(w):
        name = str(fld.get("/T"))
        if name not in vals:
            continue
        v = _pick(fld, vals[name]) if fld.get("/FT") == "/Ch" else vals[name]
        fld[NameObject("/V")] = TextStringObject(v)
        if "/AP" in a:           # المتصفح بيرسمها من /V (NeedAppearances)
            del a["/AP"]
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


def residency_values(emp, company, action):
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


def driving_values(person, company, action):
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
FORMS = {
    "residency": {"path": RESIDENCY_PATH, "actions": RESIDENCY_ACTIONS, "values": residency_values, "title": "نموذج إقامة"},
    "driving": {"path": DRIVING_PATH, "actions": DRIVING_ACTIONS, "values": driving_values, "title": "نموذج رخصة قيادة"},
}


def fill(form, person, company, action):
    f = FORMS[form]
    return _fill(f["path"], f["values"](person, company, action))
