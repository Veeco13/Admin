# -*- coding: utf-8 -*-
"""
الاستيراد التكميلي (📥 لمدير النظام) — القسم 27
ملف Excel / CSV ← **بيملى الخانات الفاضية بس**، ومابيكتبش فوق أي قيمة موجودة (المختلف بيطلع في قايمة مراجعة).
- الموظفين: المطابقة بالرقم المدني أو الرقم الوظيفي أو الاسم. الأسماء اللي مش متطابقة بالظبط ← أقرب الأسماء
  في السيستم كاقتراحات، ومدير النظام بيأكد أو بيرفض (مفيش حاجة بتتربط لوحدها).
- الأعمدة المسموحة بس (EMP_FIELDS)، ومدير النظام بيختار منها اللي يتاخد.
- كل دفعة بتتسجّل (import_batches / import_changes) بالقيمة القديمة والجديدة ← «↩️ تراجع» بيرجّع القديم للخانات اللي
  ماتغيّرتش بعد الاستيراد.
"""
import csv
import json
import os
import re
from datetime import date, datetime

import openpyxl
from sqlalchemy import select

import db
import importer
import models as M

# الخانة ← (الاسم، النوع، كلمات في عنوان العمود بتقترحها لوحدها)
EMP_FIELDS = {
    "dpId": ("الرقم الوظيفي", "text", ("رمز الموظف", "الرقم الوظيفي")),
    "qualification": ("المؤهل الدراسي", "text", ("degree", "الدرجة", "المؤهل")),
    "specialization": ("التخصص", "text", ("major", "التخصص")),
    "university": ("الجامعة / جهة التخرج", "text", ("الجامعة", "university")),
    "unifiedNumber": ("الرقم الموحد", "digits", ("الرقم الموحد",)),
    "dateOfHire": ("تاريخ التعيين", "date", ("تاريخ التعين", "تاريخ التعيين")),
    "kuwaitEntryDate": ("تاريخ دخول الكويت", "date", ("تاريخ الدخول", "دخول الكويت")),
    "phone": ("الهاتف", "phone", ("mobile", "الهاتف", "موبايل", "تليفون")),
    "email": ("البريد الإلكتروني", "email", ("email", "الإيميل", "البريد")),
}
# السيارات: دور كل عمود في ملف تسجيل السيارات ← (الاسم، كلمات في العنوان)
VEH_FIELDS = {
    "licenseType": ("نوع الترخيص", ("نوع الترخيص",)),
    "plateNo": ("رقم اللوحة", ("رقم اللوحة", "اللوحة", "plate")),
    "adminNo": ("الرقم الإداري", ("الرقم الإداري", "الرقم الاداري")),
    "make": ("الماركة / النوع", ("نوع المركبة", "الماركة", "make")),
    "year": ("سنة الصنع", ("موديل", "سنة الصنع", "year")),
    "affairsFile": ("رقم ملف الشؤون", ("رقم الملف", "ملف الشؤون")),
    "owner": ("تبع مين / مع مين", ("سائق", "تبع مين", "مع مين", "المستخدم")),
    "notes": ("الملاحظات (للتخطّي)", ("الملاحظات", "ملاحظات")),
}
# نوع الترخيص ← نوع المركبة (الترخيص مكتوب على أول عربية في كل مجموعة بس ← بيتنقل للي تحتها)
LICENSE_TYPES = (("انشا", "equipment"), ("إنشا", "equipment"), ("باص", "bus"), ("حافل", "bus"), ("خصوصي", "private"), ("نقل", "truck"))
SKIP_NOTES = ("غير موجود", "لا يمكن التسجيل")
# «تبع مين» ← مركز التكلفة بالرمز (الرموز ثابتة): سوبيريور بأي كتابة ← SUP، سكومي ← SCO
CC_ALIASES = {"SUP": ("سوبيريور", "سوبيرور", "سويبريور", "superior"), "SCO": ("سكومي", "scomi")}
VEH_IMPORT_FIELDS = {"vehicleType": "نوع المركبة", "model": "الموديل", "affairsProjectId": "ملف الشؤون", "ownerCompanyId": "المالك الفعلي",
                     "costCenter": "مركز التكلفة", "userName": "مع مين", "driverId": "مع مين (موظف)", "companyId": "الشركة"}
# المطابقة ← كلمات في عنوان العمود
MATCH_BY = {"civil": ("الرقم المدني", ("civil id", "civilid", "الرقم المدني", "رقم مدني")),
            "code": ("الرقم الوظيفي", ("رمز الموظف", "الرقم الوظيفي")),
            "name": ("الاسم", ("الاسم الكامل", "الاسم", "name (arabic)", "name"))}
MAX_LIST = 1500


# ---------------------------------------------------------------------------
# قراءة الملف
# ---------------------------------------------------------------------------
def read_book(path):
    """{اسم الشيت: [صفوف]} — xlsx بالقيم (مش المعادلات)، xls بالـ pandas، csv."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        with open(path, encoding="utf-8-sig", newline="") as f:
            return {"CSV": [tuple(r) for r in csv.reader(f)]}
    if ext == ".xls":
        import pandas as pd
        book = pd.read_excel(path, sheet_name=None, header=None)
        return {str(n): [tuple(None if pd.isna(x) else x for x in r) for r in df.itertuples(index=False)] for n, df in book.items()}
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        out = {}
        for ws in wb.worksheets:
            rows = [tuple(r) for r in ws.iter_rows(values_only=True)]
            while rows and all(v in (None, "") for v in rows[-1]):
                rows.pop()
            width = max((max((i + 1 for i, v in enumerate(r) if v not in (None, "")), default=0) for r in rows), default=0)
            out[ws.title] = [tuple(r[:width]) + (None,) * (width - len(r[:width])) for r in rows]
        return out
    finally:
        wb.close()


def cell_text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    return "" if s.lower() in ("nan", "none", "nat") else s


def header_row(rows):
    """صف العناوين = الصف اللي فيه أكتر نصوص (مش أرقام) في أول 15 صف."""
    best, score = 0, -1
    for i, r in enumerate(rows[:15]):
        n = sum(1 for v in r if isinstance(v, str) and v.strip() and not re.fullmatch(r"[\d\s.\-/:]+", v.strip()))
        if n > score:
            best, score = i, n
    return best


def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _hnorm(h):
    return re.sub(r"\s+", " ", cell_text(h)).strip().lower()


def suggest(headers):
    """(عمود المطابقة، نوعها، {العمود: الخانة}) من عناوين الأعمدة. الرقم المدني الأول، وبعده الاسم (الرقم الوظيفي
    غالبًا هو اللي هيتملى، زي ملف سكومي — المطابقة بيه بتتختار يدويًا)."""
    match_col, match_by = None, None
    for by in ("civil", "name"):
        for i, h in enumerate(headers):
            if any(k in _hnorm(h) for k in MATCH_BY[by][1]):
                match_col, match_by = i, by
                break
        if match_col is not None:
            break
    mapping, used = {}, set()
    for i, h in enumerate(headers):
        if i == match_col:
            continue
        hn = _hnorm(h)
        for f, (_, _, keys) in EMP_FIELDS.items():
            if f not in used and any(k in hn for k in keys):
                mapping[i] = f
                used.add(f)
                break
    return match_col, match_by, mapping


def suggest_vehicles(headers):
    mapping, used = {}, set()
    for i, h in enumerate(headers):
        hn = _hnorm(h)
        for f, (_, keys) in VEH_FIELDS.items():
            if f not in used and any(k in hn for k in keys):
                mapping[i] = f
                used.add(f)
                break
    return mapping


def describe(path):
    """الشيتات ← عناوينها وعدد صفوفها وعينة، واقتراح المطابقة والأعمدة (للموظفين وللسيارات)."""
    out = []
    for name, rows in read_book(path).items():
        h = header_row(rows)
        headers = [cell_text(x) for x in (rows[h] if rows else ())]
        mc, mb, mp = suggest(headers)
        vmap = suggest_vehicles(headers)
        out.append({"name": name, "headerRow": h, "rows": max(len(rows) - h - 1, 0), "total": len(rows),
                    "top": [[cell_text(v) for v in r] for r in rows[:20]],      # لو صف العناوين اتغيّر من الشاشة
                    "columns": [{"i": i, "letter": col_letter(i), "title": x} for i, x in enumerate(headers)],
                    "target": "vehicles" if "plateNo" in vmap.values() else "employees",
                    "matchCol": mc, "matchBy": mb, "map": {str(k): v for k, v in mp.items()},
                    "vehMap": {str(k): v for k, v in vmap.items()}})
    return out


# ---------------------------------------------------------------------------
# القيم
# ---------------------------------------------------------------------------
def parse_value(kind, v):
    """قيمة الملف ← (القيمة، None) أو (None، سبب الرفض) أو (None، None) لو فاضية."""
    s = cell_text(v)
    if not s or s in ("-", "—", "_", "0"):
        return None, None
    if kind == "date":
        d = importer.norm_date(v if isinstance(v, (datetime, date)) else s)
        if not d or not ("1950" <= d[:4] <= "2100"):
            return None, "تاريخ مش مفهوم"
        return d, None
    if kind == "digits":
        n = re.sub(r"\D", "", s)
        return (n, None) if n else (None, "لازم أرقام")
    if kind == "phone":
        n = re.sub(r"\D", "", s)
        if n.startswith("965") and len(n) == 11:
            n = n[3:]
        return (n, None) if len(n) >= 7 else (None, "رقم تليفون ناقص")
    if kind == "email":
        e = s.lower()
        return (e, None) if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e) else (None, "إيميل مش صحيح")
    return re.sub(r"\s+", " ", s)[:300], None


def _same(kind, a, b):
    if kind in ("digits", "phone"):
        return re.sub(r"\D", "", a or "") == re.sub(r"\D", "", b or "")
    if kind == "text":
        return norm_name(a) == norm_name(b)
    return (a or "").strip().lower() == (b or "").strip().lower()


def current(e, field):
    v = getattr(e, field)
    return db.ser(v) if isinstance(v, (date, datetime)) else ("" if v is None else str(v).strip())


def norm_name(s):
    """مطابقة الأسماء: من غير تشكيل ولا نقط، والألف والتاء المربوطة والياء موحّدين، و«عبد ال…» كلمة واحدة."""
    s = re.sub(r"[ً-ْـ]", "", str(s or ""))
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")):
        s = s.replace(a, b)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\bعبد\s+ال", "عبدال", s)
    s = re.sub(r"\bابو\s+", "ابو", s)
    return " ".join(s.lower().split())


def name_score(a, b):
    ta, tb = a.split(), b.split()
    if not ta or not tb:
        return 0.0
    score = len(set(ta) & set(tb)) / max(len(ta), len(tb))
    if ta[0] == tb[0]:
        score += 0.15
    return round(min(score, 1.0), 2)


# ---------------------------------------------------------------------------
# المعاينة والتنفيذ
# ---------------------------------------------------------------------------
def analyze(s, rows, header, match_col, match_by, mapping, confirm=None):
    """الخطة: لكل موظف اتطابق ← الخانات (هتتملى / زي ما هي / مختلفة)، ومعاها اللي ماتلقاش والاقتراحات.
    confirm = {رقم الصف: الرقم المدني} ← أسماء اتأكدت من الاقتراحات ("" = مش موجود)."""
    if match_by not in MATCH_BY:
        raise ValueError("اختار طريقة المطابقة")
    mapping = {int(k): f for k, f in (mapping or {}).items() if f in EMP_FIELDS}
    if not mapping:
        raise ValueError("اختار عمود واحد على الأقل يتاخد")
    confirm = {int(k): v for k, v in (confirm or {}).items()}
    emps = list(s.scalars(select(M.Employee)))
    by_id = {e.id: e for e in emps}
    by_code, by_name = {}, {}
    for e in emps:
        if e.dpId:
            by_code.setdefault(str(e.dpId).strip(), e)
        by_name.setdefault(norm_name(e.name), []).append(e)
    names = [(norm_name(e.name), e) for e in emps]
    plan, seen = {}, {}
    res = {"fills": [], "conflicts": [], "invalid": [], "notFound": [], "suggest": [], "dupRows": 0, "matched": 0, "confirmed": 0,
           "fields": {f: {"label": EMP_FIELDS[f][0], "fill": 0, "same": 0, "conflict": 0, "invalid": 0} for f in mapping.values()}}
    data_rows = rows[header + 1:]
    for n, r in enumerate(data_rows):
        rowno = header + 2 + n                                  # رقم الصف في Excel
        key = cell_text(r[match_col]) if match_col is not None and match_col < len(r) else ""
        vals = {c: parse_value(EMP_FIELDS[f][1], r[c] if c < len(r) else None) for c, f in mapping.items()}
        if not key or not any(v or bad for v, bad in vals.values()):
            continue                                            # صف فاضي أو مالوش قيم في الأعمدة المختارة
        e = None
        if rowno in confirm:
            e = by_id.get(confirm[rowno]) if confirm[rowno] else None
            if e is None:
                continue                                        # «مش موجود» ← بيتجاهل
            res["confirmed"] += 1
        elif match_by == "civil":
            e = by_id.get(re.sub(r"\D", "", key))
        elif match_by == "code":
            e = by_code.get(key)
        else:
            hits = by_name.get(norm_name(key), [])
            if len(hits) == 1:
                e = hits[0]
            else:
                nk = norm_name(key)
                cands = sorted(((name_score(nk, nn), x) for nn, x in names), key=lambda t: -t[0])
                cands = [{"id": x.id, "name": x.name, "score": sc, "costCenter": x.costCenter or ""} for sc, x in cands[:3] if sc >= 0.45]
                res["suggest"].append({"row": rowno, "key": key, "same": len(hits), "candidates": cands})
                continue
        if e is None:
            res["notFound"].append({"row": rowno, "key": key})
            continue
        if e.id in seen:
            res["dupRows"] += 1
        rec = plan.setdefault(e.id, {"emp": e, "row": rowno, "fields": {}})
        seen[e.id] = True
        for c, f in mapping.items():
            kind = EMP_FIELDS[f][1]
            val, bad = vals[c]
            if bad:
                res["fields"][f]["invalid"] += 1
                if len(res["invalid"]) < MAX_LIST:
                    res["invalid"].append({"row": rowno, "id": e.id, "name": e.name, "field": f, "value": cell_text(r[c]), "reason": bad})
                continue
            if val is None or f in rec["fields"]:
                continue                                        # فاضية، أو الموظف اتكرر في الملف ← أول قيمة بس
            cur = current(e, f)
            st = "fill" if not cur else "same" if _same(kind, cur, val) else "conflict"
            rec["fields"][f] = (st, val, cur)
            res["fields"][f][st] += 1
            if st == "fill" and len(res["fills"]) < MAX_LIST:
                res["fills"].append({"row": rowno, "id": e.id, "name": e.name, "field": f, "value": val})
            elif st == "conflict" and len(res["conflicts"]) < MAX_LIST:
                res["conflicts"].append({"row": rowno, "id": e.id, "name": e.name, "field": f, "current": cur, "file": val})
    res["matched"] = len(plan)
    res["fillTotal"] = sum(x["fill"] for x in res["fields"].values())
    res["employeesToFill"] = sum(1 for rec in plan.values() if any(st == "fill" for st, _, _ in rec["fields"].values()))
    return plan, res


def apply_plan(s, plan, file_name, sheet, user, res):
    """الخانات الفاضية بس ← دفعة استيراد متسجّلة (القديم والجديد) + سجل الموظف."""
    batch = M.ImportBatch(id=db.new_id("ib"), target="employees", fileName=file_name, sheet=sheet, createdBy=user, createdAt=db.now())
    s.add(batch)
    s.flush()
    touched = 0
    for rec in plan.values():
        e, done = rec["emp"], []
        for f, (st, val, cur) in rec["fields"].items():
            if st != "fill":
                continue
            db.apply(e, {f: val})
            s.add(M.ImportChange(batchId=batch.id, entity="employee", recordId=e.id, field=f, oldValue=cur or None, newValue=val))
            done.append(EMP_FIELDS[f][0])
        if done:
            touched += 1
            e.lastUpdated, e.lastUpdatedBy = db.now(), user
            db.push_timeline(s, e.id, "import_update", f"استيراد تكميلي ({file_name}): " + "، ".join(done), user)
    summary = {"employees": touched, "values": res["fillTotal"], "conflicts": sum(x["conflict"] for x in res["fields"].values()),
               "notFound": len(res["notFound"]), "confirmed": res["confirmed"],
               "fields": {f: x["fill"] for f, x in res["fields"].items() if x["fill"]}}
    batch.summary = json.dumps(summary, ensure_ascii=False)
    return batch, summary


# ---------------------------------------------------------------------------
# السيارات (ملف تسجيل السيارات): عربيات جديدة + تكميل الموجودة
# ---------------------------------------------------------------------------
def _plate(adm, no):
    """اللوحة بشكل السيستم «الرقم الإداري-رقم اللوحة» (من غير رقم إداري ← الرقم بس، زي المعدات)."""
    no, adm = cell_text(no), cell_text(adm)
    if not no:
        return ""
    return f"{adm}-{no}" if adm and adm != "0" else no


def _vehicle_type(lic):
    n = norm_name(lic)
    return next((t for k, t in LICENSE_TYPES if norm_name(k) in n), None) if n else None


def _affairs_project(value, projects):
    """«111» / «650-» ← ملف الشركة اللي رقمه بينتهي بالرقم ده (لو ملف واحد بس) — (المشروع، رسالة لو مش معروف)."""
    digits = re.sub(r"\D", "", cell_text(value))
    if not digits:
        return None, None
    hits = [p for p in projects if (p.fileNumber or "").endswith(digits)]
    if len(hits) == 1:
        return hits[0], None
    return None, ("أكتر من ملف بنفس الرقم" if hits else "ملف مش متسجّل للشركة")


def _owner(text, companies, ccs):
    """«تبع مين» ← (مالك فعلي، مركز تكلفة، مع مين). «الاسم (سكومي)» ← مركز سكومي + الاسم، «سوبيريور» ← مركز سوبيرور،
    اسم شركة ← المالك الفعلي، وأي حاجة تانية ← مع مين (اسم حر)."""
    t = re.sub(r"\s+", " ", cell_text(text)).strip()
    if not t:
        return None, None, None
    m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", t)
    tag, name = (m.group(2).strip(), m.group(1).strip()) if m else (None, t)

    def alias(x):
        n = norm_name(x)
        return next((ccs.get(code) for code, keys in CC_ALIASES.items() if any(norm_name(k) == n or norm_name(k) in n.split() for k in keys)), None)
    if tag:
        return None, alias(tag), name or None
    cc = alias(name)
    if cc and len(name.split()) <= 2:
        return None, cc, None
    n = norm_name(name)
    co = next((c for c in companies if len(n) >= 5 and n in norm_name(c.nameAr)), None)
    if co is not None:
        return co, None, None
    return None, None, name


def analyze_vehicles(s, rows, header, mapping, company_id, confirm=None):
    """الخطة: عربيات جديدة، وتكميل الموجودة (الفاضي بس)، والمتخطّاة، واقتراحات ربط «مع مين» بموظف."""
    co = s.get(M.Company, company_id or "")
    if co is None:
        raise ValueError("اختار الشركة المسجّلة باسمها العربيات")
    mapping = {int(k): f for k, f in (mapping or {}).items() if f in VEH_FIELDS}
    col = {f: c for c, f in mapping.items()}
    if "plateNo" not in col:
        raise ValueError("اختار عمود رقم اللوحة")
    confirm = {int(k): v for k, v in (confirm or {}).items()}
    projects = list(s.scalars(select(M.Project).where(M.Project.companyId == co.id)))
    companies = list(s.scalars(select(M.Company)))
    ccs = {c.code: c.name for c in s.scalars(select(M.CostCenter)) if c.code}
    existing = {v.plate: v for v in s.scalars(select(M.Vehicle))}
    emps = [(norm_name(e.name), e) for e in s.scalars(select(M.Employee))]
    get = lambda r, f: r[col[f]] if f in col and col[f] < len(r) else None  # noqa: E731
    res = {"new": [], "fills": [], "conflicts": [], "skipped": [], "unknownFiles": [], "suggest": [], "dupRows": 0, "confirmed": 0}
    plan, seen, lic = [], set(), None
    for n, r in enumerate(rows[header + 1:]):
        rowno = header + 2 + n
        if cell_text(get(r, "licenseType")):
            lic = cell_text(get(r, "licenseType"))              # بيتنقل للعربيات اللي تحته
        plate = _plate(get(r, "adminNo"), get(r, "plateNo"))
        if not plate:
            continue
        note = cell_text(get(r, "notes"))
        if any(k in note for k in SKIP_NOTES):
            res["skipped"].append({"row": rowno, "plate": plate, "reason": note})
            continue
        if plate in seen:
            res["dupRows"] += 1
            continue
        seen.add(plate)
        proj, bad_file = _affairs_project(get(r, "affairsFile"), projects)
        if bad_file:
            res["unknownFiles"].append({"row": rowno, "plate": plate, "value": cell_text(get(r, "affairsFile")), "reason": bad_file})
        owner_co, cc, user = _owner(get(r, "owner"), companies, ccs)
        driver = None
        if user and rowno in confirm:
            driver = s.get(M.Employee, confirm[rowno]) if confirm[rowno] else None
            res["confirmed"] += 1 if driver is not None else 0
        elif user and len(norm_name(user).split()) >= 2:            # اسم بكلمتين أو أكتر ← أقرب موظفين (اختياري)
            nk = norm_name(user)
            cands = sorted(((name_score(nk, nn), e) for nn, e in emps), key=lambda x: -x[0])
            cands = [{"id": e.id, "name": e.name, "score": sc, "costCenter": e.costCenter or ""} for sc, e in cands[:3] if sc >= 0.6]
            if cands:
                res["suggest"].append({"row": rowno, "key": user, "plate": plate, "candidates": cands})
        vals = {"vehicleType": _vehicle_type(lic), "model": " ".join(x for x in (cell_text(get(r, "make")), cell_text(get(r, "year"))) if x) or None,
                "affairsProjectId": proj.id if proj else None, "ownerCompanyId": owner_co.id if owner_co is not None and owner_co.id != co.id else None,
                "costCenter": cc, "driverId": driver.id if driver is not None else None, "userName": None if driver is not None else user}
        show = {"row": rowno, "plate": plate, "type": vals["vehicleType"], "model": vals["model"], "affairs": proj.nameAr if proj else "",
                "owner": owner_co.nameAr if vals["ownerCompanyId"] else "", "costCenter": cc or "",
                "user": driver.name if driver is not None else (user or ""), "linked": driver is not None}
        v = existing.get(plate)
        if v is None:
            plan.append({"new": True, "plate": plate, "vals": vals})
            res["new"].append(show)
            continue
        fills = {}
        for f, val in vals.items():
            if val in (None, ""):
                continue
            if f in ("userName", "driverId") and (v.driverId or v.userName):          # مع مين: لو فيه حد متسجّل ← يفضل
                cur = v.driverId or v.userName
                if str(cur) != str(val):
                    res["conflicts"].append({"row": rowno, "plate": plate, "field": "userName", "current": _who(s, v), "file": show["user"]})
                continue
            cur = getattr(v, f)
            if cur in (None, ""):
                fills[f] = val
                res["fills"].append({"row": rowno, "plate": plate, "field": f, "value": _show_val(s, f, val)})
            elif str(cur) != str(val):
                res["conflicts"].append({"row": rowno, "plate": plate, "field": f, "current": _show_val(s, f, cur), "file": _show_val(s, f, val)})
        if not v.companyId:
            fills["companyId"] = co.id
        if fills:
            plan.append({"new": False, "vehicle": v, "vals": fills})
    res["newCount"] = len(res["new"])
    res["updateCount"] = sum(1 for p in plan if not p["new"])
    res["fillTotal"] = len(res["new"]) + sum(len(p["vals"]) for p in plan if not p["new"])
    res["company"] = co.nameAr
    return plan, res


def _who(s, v):
    e = s.get(M.Employee, v.driverId) if v.driverId else None
    return e.name if e is not None else (v.userName or "")


def _show_val(s, f, val):
    if f in ("affairsProjectId",):
        p = s.get(M.Project, val)
        return p.nameAr if p else val
    if f in ("ownerCompanyId", "companyId"):
        c = s.get(M.Company, val)
        return c.nameAr if c else val
    if f == "driverId":
        e = s.get(M.Employee, val)
        return e.name if e else val
    return str(val)


def apply_vehicles(s, plan, file_name, sheet, user, res, company_id):
    batch = M.ImportBatch(id=db.new_id("ib"), target="vehicles", fileName=file_name, sheet=sheet, createdBy=user, createdAt=db.now())
    s.add(batch)
    s.flush()
    added = updated = values = 0
    for p in plan:
        if p["new"]:
            v = M.Vehicle(id=db.new_id("veh"), plate=p["plate"], companyId=company_id, **{k: val for k, val in p["vals"].items() if val not in (None, "")})
            s.add(v)
            s.flush()
            s.add(M.ImportChange(batchId=batch.id, entity="vehicle", recordId=v.id, field="__created", newValue=p["plate"]))
            added += 1
            continue
        v = p["vehicle"]
        for f, val in p["vals"].items():
            s.add(M.ImportChange(batchId=batch.id, entity="vehicle", recordId=v.id, field=f, oldValue=None, newValue=str(val)))
            setattr(v, f, val)
            values += 1
        updated += 1
    summary = {"vehicles": added + updated, "added": added, "updated": updated, "values": values + added,
               "skipped": len(res["skipped"]), "conflicts": len(res["conflicts"]), "confirmed": res["confirmed"]}
    batch.summary = json.dumps(summary, ensure_ascii=False)
    return batch, summary


FILE_TARGET = "employees_file"      # دفعة «استيراد الموظفين» الأساسي (importer.py) — أي خانة في الموظف


def record_file_import(s, file_name, stats, changes, user):
    """دفعة «استيراد الموظفين»: [(الرقم المدني، الخانة، القديم، الجديد)] («__created» = الموظف اتضاف) ← رقم الدفعة."""
    fields = {}
    for _, f, _, _ in changes:
        if f != "__created":
            fields[f] = fields.get(f, 0) + 1
    summary = {"employees": len({c[0] for c in changes}), "values": sum(fields.values()), "added": len(stats.get("addedList") or []),
               "fields": fields, "labels": {f: importer.FIELD_LABELS.get(f, f) for f in fields},
               "guarded": len(stats.get("guarded") or []), "held": len(stats.get("held") or [])}
    batch = M.ImportBatch(id=db.new_id("ib"), target=FILE_TARGET, fileName=file_name, sheet="، ".join(stats.get("sheets") or [])[:120],
                          summary=json.dumps(summary, ensure_ascii=False), createdBy=user, createdAt=db.now())
    s.add(batch)
    s.flush()
    for eid, f, old, new in changes:
        s.add(M.ImportChange(batchId=batch.id, entity="employee", recordId=eid, field=f, oldValue=old, newValue=new))
    return batch.id


def _undo_file_change(e, ch, kept, per_emp):
    """تراجع خانة من «استيراد الموظفين»: بترجع بس لو لسه زي ما الاستيراد سابها. الموظف اللي اتضاف مابيتشالش
    لوحده (ممكن يكون اتسجّل له حاجات) — بيظهر في «اتسابت» عشان يتحذف يدوي (بيروح السلة)."""
    label = importer.FIELD_LABELS.get(ch.field, ch.field)
    if ch.field == "__created":
        kept.append({"id": e.id, "name": e.name, "field": ch.field, "label": "موظف اتضاف من الاستيراد — لو مش محتاجه احذفه (بيروح السلة)"})
        return 0
    cur = db.ser(getattr(e, ch.field, None))
    if ("" if cur is None else str(cur)) != (ch.newValue or ""):
        kept.append({"id": e.id, "name": e.name, "field": ch.field, "label": label})
        return 0
    db.apply(e, {ch.field: ch.oldValue})
    per_emp.setdefault(e.id, []).append(label)
    return 1


def undo_batch(s, batch, user):
    """بيرجّع القيمة القديمة لكل خانة لسه زي ما الاستيراد سابها (اللي اتعدّلت بعده بتفضل). العربيات اللي اتضافت
    بتتشال، إلا لو اتضاف لها تصاريح أو بيانات مابيحطهاش الاستيراد (التأمين، الدفتر، العقد، الملاحظات)."""
    restored, kept, per_emp = 0, [], {}
    for ch in s.scalars(select(M.ImportChange).where(M.ImportChange.batchId == batch.id)):
        if ch.entity == "vehicle":
            v = s.get(M.Vehicle, ch.recordId)
            if v is None:
                continue
            if ch.field == "__created":
                used = s.scalar(select(M.Permit.id).where(M.Permit.vehicleId == v.id).limit(1))
                if used or v.insuranceExpiry or v.govLicenseExpiry or v.projectId or v.notes:
                    kept.append({"id": v.id, "name": v.plate, "field": ch.field, "label": "العربية اتضاف لها بيانات أو تصاريح"})
                    continue
                s.delete(v)
                restored += 1
                continue
            if str(getattr(v, ch.field) or "") != (ch.newValue or ""):
                kept.append({"id": v.id, "name": v.plate, "field": ch.field, "label": VEH_IMPORT_FIELDS.get(ch.field, ch.field)})
                continue
            setattr(v, ch.field, ch.oldValue)
            restored += 1
            continue
        if ch.entity != "employee":
            continue
        e = s.get(M.Employee, ch.recordId)
        if e is None:
            continue
        if batch.target == FILE_TARGET:
            restored += _undo_file_change(e, ch, kept, per_emp)
            continue
        kind = EMP_FIELDS.get(ch.field, ("", "text"))[1]
        if not _same(kind, current(e, ch.field), ch.newValue):
            kept.append({"id": e.id, "name": e.name, "field": ch.field, "label": EMP_FIELDS.get(ch.field, (ch.field,))[0]})
            continue
        db.apply(e, {ch.field: ch.oldValue})
        restored += 1
        per_emp.setdefault(e.id, []).append(EMP_FIELDS.get(ch.field, (ch.field,))[0])
    for eid, labels in per_emp.items():
        e = s.get(M.Employee, eid)
        e.lastUpdated, e.lastUpdatedBy = db.now(), user
        what = "استيراد" if batch.target == FILE_TARGET else "استيراد تكميلي"
        db.push_timeline(s, eid, "import_update", f"تراجع عن {what} ({batch.fileName}): " + "، ".join(labels), user)
    batch.undoneAt, batch.undoneBy = db.now(), user
    return restored, kept


def batch_api(b, counts):
    try:
        summary = json.loads(b.summary or "{}")
    except ValueError:
        summary = {}
    return {"id": b.id, "target": b.target, "fileName": b.fileName, "sheet": b.sheet, "summary": summary,
            "changes": counts.get(b.id, 0), "createdBy": b.createdBy, "createdAt": db.ser(b.createdAt),
            "undoneBy": b.undoneBy, "undoneAt": db.ser(b.undoneAt)}
