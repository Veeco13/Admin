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

DATE_FIELDS = {"workPermitIssue", "workPermitExp", "residencyExp", "passportExp", "healthCardExp",
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


def upsert_employee(s, rec, user, stats, company_cache):
    emp_id = clean(rec.get("id"))
    if not emp_id or not rec.get("name"):
        stats["skipped"] += 1
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
    if e:
        db.apply(e, data)
        stats["updated"] += 1
        db.push_timeline(s, emp_id, "import_update", "تحديث من ملف استيراد", user)
    else:
        data.setdefault("employmentStatus", "active")
        s.add(db.build(M.Employee, data))
        stats["added"] += 1
        db.push_timeline(s, emp_id, "import_add", "إضافة من ملف استيراد", user)
    s.flush()
    # الانتماء
    if not db.get_affiliations(s, emp_id):
        aff = _affiliation_for_file(s, data.get("fileNo"))
        cid = _find_company(s, company_name, company_cache) if company_name else None
        if cid and (not aff or aff["companyId"] != cid):
            aff = {"companyId": cid, "projectId": None}
        if aff:
            db.set_affiliations(s, emp_id, [aff])


def import_dataframe_with_headers(s, df, user, stats, cache):
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
        upsert_employee(s, rec, user, stats, cache)
    return True


def import_manpower_headerless(s, df, user, stats, cache):
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
        upsert_employee(s, rec, user, stats, cache)
    return True


def import_file(s, path, user):
    stats = {"added": 0, "updated": 0, "skipped": 0, "sheets": []}
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
            ok = import_dataframe_with_headers(s, df, user, stats, cache)
        else:
            ok = import_manpower_headerless(s, raw, user, stats, cache)
        if ok:
            stats["sheets"].append(name)
    return stats
