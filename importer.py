# -*- coding: utf-8 -*-
"""
استيراد الموظفين من Excel / CSV (يقابل handleImportCsv في الوثيقة)
يدعم:
  1) ملف بعناوين أعمدة (عربي أو إنجليزي) — زي Sheet1 في manp.xlsx
  2) ملف القوى العاملة بدون عناوين — زي «ورقة1» في manp.xlsx
     [م، الرقم المدني، الاسم، حالة التحويل، انتهاء الإقامة، (تكرار)، المهنة، رقم الملف، الشركة]
التحديث بيكون upsert بالرقم المدني: الحقول الفاضية في الملف ما بتمسحش القيم الموجودة.
"""
import re
from datetime import datetime, date

import pandas as pd

import db
import models as M
from sqlalchemy import select
from docx_engine import NATIONALITY_EN

HEADER_MAP = {
    # الرقم المدني
    "الرقم المدني": "id", "رقم مدني": "id", "civil id": "id", "civilid": "id", "id": "id",
    # الاسم
    "الاسم": "name", "اسم الموظف": "name", "name": "name", "employee_name": "name",
    "english name": "nameEn", "name (en)": "nameEn", "name en": "nameEn", "الاسم بالانجليزي": "nameEn",
    "nameen": "nameEn",
    # المهنة
    "المهنة": "profession", "profession": "profession",
    "المهنيه": "professionEn", "titil": "professionEn", "title": "professionEn",
    "profession (en)": "professionEn", "professionen": "professionEn",
    # الجنسية
    "الجنسية": "nationality", "nationality": "nationality",
    "الجنسيه": "nationalityEn", "nationality (en)": "nationalityEn", "nationalityen": "nationalityEn",
    # التواريخ
    "تواريخ الاصدار": "workPermitIssue", "تاريخ الاصدار": "workPermitIssue",
    "تاريخ الانتهاء": "workPermitExp", "انتهاء اذن العمل": "workPermitExp", "انتهاء إذن العمل": "workPermitExp",
    "workpermitexp": "workPermitExp",
    "انتهاء الاقامة": "residencyExp", "انتهاء الإقامة": "residencyExp", "residencyexp": "residencyExp",
    "رقم الجواز": "passportNo", "passport": "passportNo", "passportno": "passportNo",
    "انتهاء الجواز": "passportExp", "passportexp": "passportExp",
    "انتهاء البطاقة الصحية": "healthCardExp", "healthcardexp": "healthCardExp",
    "تاريخ الميلاد": "dateOfBirth", "dateofbirth": "dateOfBirth",
    "الجنس": "gender", "gender": "gender", "sex": "gender",
    "مكان الميلاد": "placeOfBirth", "placeofbirth": "placeOfBirth", "place of birth": "placeOfBirth",
    "تاريخ إصدار الجواز": "passportIssueDate", "تاريخ اصدار الجواز": "passportIssueDate",
    "passportissuedate": "passportIssueDate",
    "الرقم الموحد": "unifiedNumber", "unifiednumber": "unifiedNumber",
    "تاريخ انتهاء الخدمة": "serviceEndDate", "serviceenddate": "serviceEndDate",
    "فصيلة الدم": "bloodType", "bloodtype": "bloodType", "blood type": "bloodType",
    "المنطقة": "addressArea", "القطعة": "addressBlock", "الشارع": "addressStreet", "المنزل": "addressHouse",
    "الشقة": "addressApartment", "هاتف المنزل": "homePhone", "homephone": "homePhone",
    # العمالة الوطنية
    "البريد الإلكتروني": "email", "البريد الالكتروني": "email", "الإيميل": "email", "email": "email",
    "الحالة الاجتماعية": "maritalStatus", "maritalstatus": "maritalStatus", "marital status": "maritalStatus",
    "المؤهل الدراسي": "qualification", "المؤهل": "qualification", "qualification": "qualification",
    "التخصص": "specialization", "التخصص العلمي": "specialization", "specialization": "specialization",
    "تاريخ التجنس": "naturalizationDate", "المادة": "citizenshipArticle", "مادة الجنسية": "citizenshipArticle",
    "رقم الجنسية": "nationalityNo", "رقم شهادة الجنسية": "nationalityNo",
    "تاريخ التعيين": "dateOfHire", "تاريخ البدء": "dateOfHire", "start_date": "dateOfHire", "dateofhire": "dateOfHire",
    # أخرى
    "الراتب": "salary", "salary": "salary",
    "نوع العقد": "contractType", "contract type": "contractType", "contracttype": "contractType",
    "رقم الملف -رقم العقد": "fileNo", "رقم الملف": "fileNo", "file no": "fileNo", "fileno": "fileNo",
    "مركز التكلفة": "costCenter", "costcenter": "costCenter",
    "الشركة": "_companyName", "company": "_companyName", "صاحب العمل / الشركة": "_companyName",
    "المشروع": "_projectName", "project": "_projectName",
    "مكان العمل الفعلي": "actualWorkplace", "الهاتف": "phone", "phone": "phone",
    "حالة التحويل": "transferNote", "ملاحظات": "notes", "notes": "notes",
}

DATE_FIELDS = {"workPermitIssue", "workPermitExp", "residencyExp", "passportIssueDate", "passportExp", "healthCardExp", "serviceEndDate",
               "dateOfBirth", "dateOfHire", "drivingLicenseExp"}


def norm_date(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip().split(" ")[0]
    if not s or s.lower() in ("nan", "nat", "none"):
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def norm_gender(v):
    """ذكر / أنثى / male / female / M / F ← male | female (وأي حاجة تانية ← None فمابتتكتبش)."""
    s = (v or "").strip().lower().replace("أ", "ا")
    return {"ذكر": "male", "male": "male", "m": "male", "انثى": "female", "انثي": "female",
            "female": "female", "f": "female"}.get(s)


def norm_marital(v):
    """أعزب / متزوجة / married … ← single | married | divorced | widowed (وغير كده ← None)."""
    s = (v or "").strip().lower().replace("أ", "ا").replace("ة", "").replace("ه", "")
    for key, words in (("single", ("اعزب", "عزباء", "single")), ("married", ("متزوج", "married")),
                       ("divorced", ("مطلق", "divorced")), ("widowed", ("ارمل", "widowed", "widow"))):
        if s in words:
            return key
    return None


def clean(v):
    if v is None:
        return None
    if isinstance(v, float):
        if pd.isna(v):
            return None
        if v.is_integer():
            return str(int(v))
    s = str(v).strip()
    if s.lower() in ("nan", "none", "nat", ""):
        return None
    if re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    return s


def _norm_co(name):
    return re.sub(r"\s+", "", name or "").replace("ه", "ة").replace("أ", "ا").replace("إ", "ا")


def _find_company(s, name, cache):
    if not name:
        return None
    key = _norm_co(name)
    if key in cache:
        return cache[key]
    for cid, name_ar in s.execute(select(M.Company.id, M.Company.nameAr)):
        if _norm_co(name_ar) == key:
            cache[key] = cid
            return cid
    cid = db.new_id("co")
    s.add(M.Company(id=cid, nameAr=name.strip()))
    db.log_company_history(s, cid, "company_created", f"إنشاء الشركة (استيراد): {name.strip()}")
    s.flush()
    cache[key] = cid
    return cid


def _affiliation_for_file(s, file_no):
    """رقم الملف ← مشروع (رقم ملف المشروع) أو شركة (رقم الملف الرئيسي)."""
    if not file_no:
        return None
    p = s.scalar(select(M.Project).where(M.Project.fileNumber == file_no))
    if p:
        return {"companyId": p.companyId, "projectId": p.id}
    c = s.scalar(select(M.Company).where(M.Company.mainFileNumber == file_no))
    if c:
        return {"companyId": c.id, "projectId": None}
    return None


# اسم الحقل للعرض في المعاينة والسجل: أول عنوان عربي في HEADER_MAP، والباقي من هنا
FIELD_LABELS = {"transferNote": "حالة التحويل", "isDriver": "سائق", "employmentStatus": "الحالة الوظيفية",
                "fileNo": "رقم الملف", "residencyExp": "انتهاء الإقامة", "nameEn": "الاسم (إنجليزي)",
                "nationalityEn": "الجنسية (إنجليزي)", "professionEn": "المهنة (إنجليزي)"}
for _k, _f in HEADER_MAP.items():
    if re.search(r"[\u0600-\u06FF]", _k):
        FIELD_LABELS.setdefault(_f, _k)
_NO_DIFF = {"id", "lastUpdated", "lastUpdatedBy"}

# حماية الخانات العربي: ملف أساميه إنجليزي تحت عنوان «الاسم» مسح الأسامي العربي (30/09/2026). القيمة اللي
# حروفها إنجليزي بس مابتكتبش على خانة فيها عربي — بتروح للخانة الإنجليزي لو فاضية، وإلا بتتجاهل (stats["guarded"])
AR_GUARD = {"name": "nameEn", "nationality": "nationalityEn", "profession": "professionEn"}
_ARABIC = re.compile(r"[\u0600-\u06FF]")


def _latin_only(v):
    v = str(v or "")
    return bool(re.search(r"[A-Za-z]", v)) and not _ARABIC.search(v)


def guard_arabic(e, data, stats):
    for f, en in AR_GUARD.items():
        v = data.get(f)
        if not v or not _latin_only(v) or not _ARABIC.search(str(getattr(e, f) or "")):
            continue
        data.pop(f)
        moved = not data.get(en) and not getattr(e, en)
        if moved:
            data[en] = v
        stats.setdefault("guarded", []).append({"id": e.id, "name": e.name, "field": FIELD_LABELS.get(f, f), "value": str(v),
                                 "to": FIELD_LABELS.get(en, en) if moved else None})


def _show(field, v):
    import history
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return "نعم" if v else "لا"
    if field == "gender":
        return {"male": "ذكر", "female": "أنثى"}.get(v, v)
    return str(history.value_label(field, v))


def _changes(e, data):
    """الحقول اللي هتتغيّر فعلًا: [{field, label, old, new}] (بعد تحويل النوع، فـ «540» = 540.0 مش تغيير)."""
    cols, out = db._columns(type(e)), []
    for k, v in data.items():
        if k in _NO_DIFF or k not in cols:
            continue
        old, new = db.ser(getattr(e, k)), db.ser(db.coerce(cols[k].columns[0].type, v))
        if new is None or old == new:          # الخانة الفاضية مابتمسحش (والفاضي أصلًا مابيتبعتش)
            continue
        out.append({"field": k, "label": FIELD_LABELS.get(k, k), "old": _show(k, old), "new": _show(k, new),
                    "_old": old, "_new": new})          # الخام للتراجع (بيتشال قبل ما يترجع للواجهة)
    return out


def upsert_employee(s, rec, user, stats, company_cache, allow_add=True):
    """allow_add=False (استيراد الشاشة): الموظف الجديد بيتسجّل من «تسجيل موظف جديد» بس، فالرقم المدني اللي مش
    موجود بيتخطّى ويترجع في stats["notRegistered"] (ومعاه لو فيه مترشّح بنفس الرقم)."""
    emp_id = clean(rec.get("id"))
    if not emp_id or not rec.get("name"):
        stats["skipped"] += 1
        return
    if not allow_add and s.get(M.Employee, emp_id) is None:
        if emp_id not in {x["id"] for x in stats["notRegistered"]}:
            cand = s.scalar(select(M.Candidate).where(M.Candidate.civilId == emp_id))
            stats["notRegistered"].append({"id": emp_id, "name": rec.get("name"), "candidate": cand.name if cand else None})
        return
    company_name = rec.pop("_companyName", None)
    rec.pop("_projectName", None)
    if rec.get("nationality") and not rec.get("nationalityEn"):
        rec["nationalityEn"] = NATIONALITY_EN.get(rec["nationality"])
    data = {k: v for k, v in rec.items() if v not in (None, "")}
    data["id"] = emp_id
    data["lastUpdated"] = db.now()
    data["lastUpdatedBy"] = user
    # منع تكرار الجواز
    if data.get("passportNo") and s.scalar(select(M.Employee.id).where(
            M.Employee.passportNo == data["passportNo"], M.Employee.id != emp_id)):
        data.pop("passportNo")
    e = s.get(M.Employee, emp_id)
    is_new = e is None
    old_affs, old_cc = (db.get_affiliations(s, emp_id), e.costCenter) if e else ([], None)
    changed = []
    if e:
        guard_arabic(e, data, stats)            # الاسم / الجنسية / المهنة العربي مابيتمسحوش بقيمة إنجليزي
        if stats.get("_hold"):                  # المرتب / البنك / إنهاء الخدمة ← طلب موافقة بدل ما يتطبّق
            stats["held"] += [{"id": emp_id, "name": e.name, "what": w} for w in stats["_hold"](s, e, data)]
        changed = _changes(e, data)
        for c in changed:                       # كل خانة اتغيّرت بقيمتها القديمة ← «↩️ تراجع» عن الدفعة
            old, new = c.pop("_old"), c.pop("_new")
            stats.setdefault("_batch", []).append((emp_id, c["field"], None if old is None else str(old), None if new is None else str(new)))
        if changed:                             # من غير تغيير فعلي ← الموظف مابيتلمسش (ولا «آخر تعديل» ولا سجل)
            db.apply(e, data)
    else:
        data.setdefault("employmentStatus", "active")
        s.add(db.build(M.Employee, data))
        stats.setdefault("_batch", []).append((emp_id, "__created", None, None))
    s.flush()
    # الانتماء
    if not db.get_affiliations(s, emp_id):
        aff = _affiliation_for_file(s, data.get("fileNo"))
        cid = _find_company(s, company_name, company_cache) if company_name else None
        if cid and (not aff or aff["companyId"] != cid):
            aff = {"companyId": cid, "projectId": None}
        if aff:
            db.set_affiliations(s, emp_id, [aff])
    # التاريخ: الموظف الجديد بوضعه، والقديم بأي تغيير في الشركة أو مركز التكلفة
    import history
    new_affs, new_cc = db.get_affiliations(s, emp_id), s.get(M.Employee, emp_id).costCenter
    if is_new:
        stats["added"] += 1
        stats["addedList"].append({"id": emp_id, "name": data.get("name")})
        db.push_timeline(s, emp_id, "import_add", "إضافة من ملف استيراد — " + history.current_state_text(s, new_affs, new_cc), user)
        for a in new_affs:
            if a.get("companyId"):
                db.log_company_history(s, a["companyId"], "employee_joined",
                                       f"انضمام الموظف {data.get('name')} ({emp_id}) — استيراد", user)
    else:
        moves = history.record_moves(s, emp_id, data.get("name"), old_affs, new_affs, old_cc, new_cc, user, "استيراد") or []
        if changed or moves:
            stats["updated"] += 1
            stats["changes"].append({"id": emp_id, "name": e.name, "fields": changed, "moves": moves})
            if changed:
                db.push_timeline(s, emp_id, "import_update", "تحديث من ملف استيراد — " + "، ".join(
                    f"{c['label']}: {c['old'] or '—'} ← {c['new'] or '—'}" for c in changed[:8])
                    + ("…" if len(changed) > 8 else ""), user)
        else:
            stats["unchanged"] += 1


def import_dataframe_with_headers(s, df, user, stats, cache, allow_add=True):
    cols = {}
    for c in df.columns:
        key = str(c).strip().lower()
        if key in HEADER_MAP:
            cols[c] = HEADER_MAP[key]
    if "id" not in cols.values() or "name" not in cols.values():
        return False
    for _, row in df.iterrows():
        rec = {}
        for c, f in cols.items():
            v = row[c]
            rec[f] = norm_date(v) if f in DATE_FIELDS else clean(v)
        if rec.get("salary"):
            try:
                rec["salary"] = float(rec["salary"])
            except ValueError:
                rec["salary"] = None
        if rec.get("gender"):
            rec["gender"] = norm_gender(rec["gender"])
        if rec.get("bloodType"):
            rec["bloodType"] = rec["bloodType"].replace(" ", "").upper()
        if rec.get("maritalStatus"):
            rec["maritalStatus"] = norm_marital(rec["maritalStatus"])
        upsert_employee(s, rec, user, stats, cache, allow_add)
    return True


def import_manpower_headerless(s, df, user, stats, cache, allow_add=True):
    if df.shape[1] < 9:
        return False
    for _, row in df.iterrows():
        civil = clean(row[1])
        if not civil or not re.fullmatch(r"\d{8,14}", civil):
            continue
        rec = {
            "id": civil,
            "name": clean(row[2]),
            "transferNote": clean(row[3]),
            "residencyExp": norm_date(row[4]),
            "profession": clean(row[6]),
            "fileNo": clean(row[7]),
            "_companyName": clean(row[8]),
        }
        if rec["profession"] and "سائق" in rec["profession"]:
            rec["isDriver"] = True
        upsert_employee(s, rec, user, stats, cache, allow_add)
    return True


def import_file(s, path, user, allow_add=True, hold=None):
    """allow_add=False ← تحديث الموجودين بس (الشاشة). seed_import بيضيف عادي (أول تشغيل).
    hold(s, e, data) ← التعديلات الحساسة (المرتب، البنك، إنهاء الخدمة) بتتشال من الصف وبتتحوّل لطلبات موافقة
    (approvals.hold) للمستخدم اللي مالوش صلاحية الموافقة."""
    stats = {"added": 0, "updated": 0, "unchanged": 0, "skipped": 0, "sheets": [], "notRegistered": [],
             "changes": [], "addedList": [], "held": [], "guarded": [], "_hold": hold, "_batch": []}
    cache = {}
    if path.lower().endswith(".csv"):
        frames = {"csv": pd.read_csv(path, header=None, dtype=object, encoding="utf-8-sig")}
    else:
        xl = pd.ExcelFile(path)
        frames = {sh: xl.parse(sh, header=None, dtype=object) for sh in xl.sheet_names}
    for name, raw in frames.items():
        if raw.empty:
            continue
        first = [str(x).strip().lower() for x in raw.iloc[0].tolist()]
        if any(h in HEADER_MAP and HEADER_MAP[h] in ("id", "name") for h in first):
            df = raw.iloc[1:].copy()
            df.columns = [str(x).strip() for x in raw.iloc[0].tolist()]
            ok = import_dataframe_with_headers(s, df, user, stats, cache, allow_add)
        else:
            ok = import_manpower_headerless(s, raw, user, stats, cache, allow_add)
        if ok:
            stats["sheets"].append(name)
    stats.pop("_hold", None)
    return stats
