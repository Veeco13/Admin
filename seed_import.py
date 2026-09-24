# -*- coding: utf-8 -*-
"""
استيراد البيانات الأولية من النظام القديم (نظام العقود الآلي):
  - data/manp.xlsx         (Sheet1 بالعناوين + ورقة1 القوى العاملة)
  - data/legacy_database.db (جدول contracts القديم)
تشغيل:  python seed_import.py          (يتخطى لو فيه موظفين بالفعل)
        python seed_import.py --force  (يعيد الاستيراد upsert)
"""
import os
import sqlite3
import sys

import db
import models as M
from sqlalchemy import func, select
import importer
from docx_engine import NATIONALITY_EN

HERE = db.BASE_DIR
USER = "استيراد أولي"

COMPANIES = [
    {"id": "co_abraj_energy", "nameAr": "شركة أبراج انرجي للتجارة العامة والمقاولات",
     "nameEn": "ABRAAJ Energy General Trading and Contracting Company",
     "laborOffice": "إدارة عمل العقود والمشاريع الحكومية", "mainFileNumber": "3563650",
     "activity": "التجارة العامة والمقاولات"},
    {"id": "co_abraj_services", "nameAr": "شركة أبراج سيرفيسز للتجارة العامة والمقاولات",
     "nameEn": "ABRAAJ Services General Trading and Contracting Company", "mainFileNumber": "2472526",
     "activity": "التجارة العامة والمقاولات"},
]
SIGNATORIES = [
    {"id": "sig_mutairi", "companyId": "co_abraj_energy", "nameAr": "عبدالعزيز سلطان صقير المطيري",
     "nameEn": "Abdelaziz Sultan Saqir AlMutairi", "civilId": "288072901129"},
]
# أرقام العقود الحكومية الموجودة في manp.xlsx ← مشاريع تحت أبراج انرجي
PROJECT_FILES = ["312201900166", "312201900112", "312201900111", "312201900167"]


def main(force=False):
    db.init_db()
    with db.session_scope() as s:
        if s.scalar(select(func.count()).select_from(M.Employee)) and not force:
            print("قاعدة البيانات فيها موظفين بالفعل — استخدم --force لإعادة الاستيراد.")
            return
        for c in COMPANIES:
            if not s.get(M.Company, c["id"]):
                s.add(db.build(M.Company, c))
                db.log_company_history(s, c["id"], "company_created", f"إنشاء الشركة: {c['nameAr']}", USER)
        for sg in SIGNATORIES:
            if not s.get(M.Signatory, sg["id"]):
                s.add(db.build(M.Signatory, sg))
                db.log_company_history(s, sg["companyId"], "signatory_added", f"إضافة مفوّض بالتوقيع: {sg['nameAr']}", USER)
        for fn in PROJECT_FILES:
            pid = f"pr_{fn}"
            if not s.get(M.Project, pid):
                s.add(M.Project(id=pid, companyId="co_abraj_energy", nameAr=f"عقد حكومي {fn}",
                                nameEn=f"Government Contract {fn}", fileNumber=fn,
                                laborOffice="إدارة عمل العقود والمشاريع الحكومية"))
                db.log_company_history(s, "co_abraj_energy", "project_added", f"إضافة مشروع: عقد حكومي {fn}", USER)
        s.flush()

        total = {"added": 0, "updated": 0, "skipped": 0}
        xlsx = os.path.join(HERE, "data", "manp.xlsx")
        if os.path.exists(xlsx):
            st = importer.import_file(s, xlsx, USER)
            print("manp.xlsx:", st)
            for k in total:
                total[k] += st[k]

        # قاعدة «نظام العقود الآلي» القديمة (ملف SQLite خارجي بصيغة مختلفة — بنقرأه مباشرة)
        legacy = os.path.join(HERE, "data", "legacy_database.db")
        if os.path.exists(legacy):
            old = sqlite3.connect(legacy)
            old.row_factory = sqlite3.Row
            cache = {}
            st = {"added": 0, "updated": 0, "skipped": 0}
            for r in old.execute("SELECT * FROM contracts"):
                r = dict(r)
                rec = {
                    "id": importer.clean(r.get("civil_id")), "name": r.get("employee_name"),
                    "nameEn": r.get("employee_name_en"), "nationality": r.get("nationality"),
                    "nationalityEn": r.get("nationality_en") or NATIONALITY_EN.get(r.get("nationality") or ""),
                    "profession": r.get("profession"), "professionEn": r.get("profession_en"),
                    "salary": r.get("salary"),
                    "dateOfHire": importer.norm_date(r.get("start_date")),
                    "residencyExp": importer.norm_date(r.get("residency_expiry")),
                    "fileNo": r.get("file_number"), "transferNote": r.get("status_notes"),
                    "_companyName": r.get("sponsor_name"),
                }
                importer.upsert_employee(s, rec, USER, st, cache)
            old.close()
            print("legacy database.db:", st)
            for k in total:
                total[k] += st[k]
        db.log_audit(s, "employee_add",
                     f"استيراد أولي من النظام القديم: {total['added']} جديد، {total['updated']} تحديث", USER)
        s.flush()
        print(f"تم. إجمالي الموظفين الآن: {s.scalar(select(func.count()).select_from(M.Employee))}")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
