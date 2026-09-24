# -*- coding: utf-8 -*-
"""
استعادة نسخة احتياطية من Lunx (نسخة الملف الواحد — STATE JSON) داخل نسخة Flask.

الشكل المتوقع (نفس STATE في الوثيقة):
  { companies, projects, employees, vehicles, costCenters, companyHistory,
    candidates, signatoryDocs, auditLog, employeeTimeline }

- بيمسح بيانات الشركات/الموظفين/... الحالية ويحط مكانها محتوى النسخة.
- المستخدمين وقوالب العقود مش بيتلمسوا.
- الملفات المضمّنة (dataUrl: شعارات، مستندات الشركات، بطاقات المفوّضين) بتتحفظ في uploads/.

تشغيل من سطر الأوامر:
    python lunx_restore.py "مسار-النسخة.json"
"""
import base64
import json
import mimetypes
import os
import re
import sys

import db
import models as M

# الجداول اللي بتتمسح وتتملى من النسخة (المستخدمين والقوالب مش بيتلمسوا)
DATA_MODELS = [M.Company, M.Project, M.CostCenter, M.Vehicle, M.Employee, M.EmployeeAffiliation, M.Candidate,
               M.Signatory, M.SignatoryDoc, M.CompanyDoc, M.CompanyHistory, M.AuditLog, M.EmployeeTimeline]


def is_lunx_state(obj):
    return isinstance(obj, dict) and "employees" in obj and "companies" in obj and "tables" not in obj


def _norm_dt(v):
    return db.parse_datetime(v)


def _save_data_url(data_url, folder, basename, orig_name=None):
    if not data_url or not str(data_url).startswith("data:"):
        return None
    m = re.match(r"data:([^;,]+)?(;base64)?,(.*)$", data_url, re.S)
    if not m:
        return None
    mime, is_b64, payload = m.group(1) or "", m.group(2), m.group(3)
    raw = base64.b64decode(payload) if is_b64 else payload.encode("utf-8")
    ext = os.path.splitext(orig_name or "")[1].lower() or mimetypes.guess_extension(mime) or ".bin"
    if ext == ".jpe":
        ext = ".jpg"
    path = os.path.join(db.BASE_DIR, "uploads", folder, basename + ext)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(raw)
    return os.path.relpath(path, db.BASE_DIR)


def import_lunx_state(s, st, user=None):
    for model in reversed(DATA_MODELS):
        s.query(model).delete()
    s.flush()
    stats = {}

    # الشركات + المفوّضين + المستندات + الشعار
    for c in st.get("companies", []):
        co = db.build(M.Company, c)
        co.logoPath = _save_data_url(c.get("logoDataUrl"), "logos", f"{c['id']}_logo")
        s.add(co)
        for sg in c.get("signatories") or []:
            sg = dict(sg)
            sg.setdefault("id", db.new_id("sig"))
            sg["companyId"] = c["id"]
            s.add(db.build(M.Signatory, sg))
        for kind, d in (c.get("docs") or {}).items():
            if not d:
                continue
            p = _save_data_url(d.get("dataUrl"), "companies", f"{c['id']}_{kind}", d.get("name"))
            if p:
                s.add(M.CompanyDoc(companyId=c["id"], kind=kind, name=d.get("name"), path=p,
                                   uploadedAt=_norm_dt(d.get("uploadedAt"))))
    stats["companies"] = len(st.get("companies", []))

    for p in st.get("projects", []):
        s.add(db.build(M.Project, p))
    for cc in st.get("costCenters", []):
        s.add(db.build(M.CostCenter, cc))
    for v in st.get("vehicles", []):
        s.add(db.build(M.Vehicle, v))
    s.flush()

    # الموظفين
    n = 0
    for e in st.get("employees", []):
        obj = dict(e)
        ha = e.get("housingAllowance")
        if isinstance(ha, dict):
            obj["housingIncluded"] = bool(ha.get("included"))
            obj["housingAmount"] = ha.get("amount")
        elif isinstance(ha, bool):
            obj["housingIncluded"] = ha
        obj["employmentStatus"] = obj.get("employmentStatus") or "active"
        s.add(db.build(M.Employee, obj))
        for i, a in enumerate(x for x in (e.get("affiliations") or []) if x.get("companyId") or x.get("projectId")):
            s.add(M.EmployeeAffiliation(employeeId=e["id"], position=i, companyId=a.get("companyId") or None,
                                        projectId=a.get("projectId") or None))
        n += 1
    stats["employees"] = n

    for c in st.get("candidates", []):
        obj = dict(c)
        ha = c.get("housingAllowance")
        if isinstance(ha, dict):
            obj["housingAllowance"] = bool(ha.get("included"))
        s.add(db.build(M.Candidate, obj))
    stats["candidates"] = len(st.get("candidates", []))

    for civil, d in (st.get("signatoryDocs") or {}).items():
        p = _save_data_url(d.get("dataUrl"), "signatories", str(civil), d.get("name"))
        s.add(M.SignatoryDoc(civilId=civil, name=d.get("name") if p else None, path=p,
                             expiryDate=db.parse_date(d.get("expiryDate")), uploadedAt=_norm_dt(d.get("uploadedAt"))))

    for h in st.get("companyHistory", []):
        s.add(M.CompanyHistory(id=h.get("id") or db.new_id("ch"), companyId=h.get("companyId"), type=h.get("type"),
                               label=h.get("label"), date=_norm_dt(h.get("date")), user=h.get("user")))
    for a in st.get("auditLog", []):
        s.add(M.AuditLog(id=a.get("id") or db.new_id("aud"), type=a.get("type"),
                         category=a.get("category") or (a.get("type") or "").split("_")[0],
                         label=a.get("label"), date=_norm_dt(a.get("date")), user=a.get("user")))
    for emp_id, events in (st.get("employeeTimeline") or {}).items():
        for ev in events or []:
            s.add(M.EmployeeTimeline(id=ev.get("id") or db.new_id("tl"), employeeId=emp_id, type=ev.get("type"),
                                     label=ev.get("label"), date=_norm_dt(ev.get("date")), user=ev.get("user")))
    s.flush()
    db.log_audit(s, "backup_restore",
                 f"استعادة نسخة Lunx: {stats['employees']} موظف، {stats['companies']} شركة، {stats['candidates']} مترشّح", user)
    return stats


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    db.init_db()
    state = json.load(open(sys.argv[1], encoding="utf-8-sig"))
    if not is_lunx_state(state):
        sys.exit("الملف ده مش نسخة احتياطية من Lunx")
    with db.session_scope() as s:
        print("تمت الاستعادة:", import_lunx_state(s, state, "استعادة من سطر الأوامر"))
