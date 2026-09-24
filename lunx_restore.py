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
from sqlalchemy import inspect as sa_inspect

# الجداول اللي بتتمسح وتتملى من النسخة (المستخدمين والقوالب والمرفقات مش بيتلمسوا)
DATA_TABLES = ["companies", "projects", "cost_centers", "vehicles", "employees", "employee_affiliations",
               "candidates", "signatories", "signatory_docs", "company_docs", "company_history", "audit_log",
               "employee_timeline"]


def _row(model, obj):
    """كائن بمفاتيح الـ API (camelCase) ← صف بأسماء الأعمدة."""
    out = {}
    for attr in sa_inspect(model).column_attrs:
        if attr.key in obj:
            out[attr.columns[0].name] = obj[attr.key]
    return out


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
    path = db.data_path("uploads", folder, basename + ext)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(raw)
    return db.rel_file(path)


def state_to_tables(st):
    """STATE (نسخة Lunx) ← جداول بأسماء الأعمدة + حفظ الملفات المضمّنة في uploads/."""
    t = {name: [] for name in DATA_TABLES}
    for c in st.get("companies", []):
        row = _row(M.Company, c)
        row["logo_path"] = _save_data_url(c.get("logoDataUrl"), "logos", f"{c['id']}_logo")
        t["companies"].append(row)
        for sg in c.get("signatories") or []:
            sg = dict(sg, companyId=c["id"])
            sg.setdefault("id", db.new_id("sig"))
            t["signatories"].append(_row(M.Signatory, sg))
        for kind, d in (c.get("docs") or {}).items():
            if not d:
                continue
            p = _save_data_url(d.get("dataUrl"), "companies", f"{c['id']}_{kind}", d.get("name"))
            if p:
                t["company_docs"].append({"company_id": c["id"], "kind": kind, "name": d.get("name"),
                                          "path": p, "uploaded_at": d.get("uploadedAt")})
    t["projects"] = [_row(M.Project, p) for p in st.get("projects", [])]
    t["cost_centers"] = [_row(M.CostCenter, x) for x in st.get("costCenters", [])]
    t["vehicles"] = [_row(M.Vehicle, v) for v in st.get("vehicles", [])]
    for e in st.get("employees", []):
        obj = dict(e)
        ha = e.get("housingAllowance")
        if isinstance(ha, dict):
            obj["housingIncluded"] = bool(ha.get("included"))
            obj["housingAmount"] = ha.get("amount")
        elif isinstance(ha, bool):
            obj["housingIncluded"] = ha
        obj["employmentStatus"] = obj.get("employmentStatus") or "active"
        t["employees"].append(_row(M.Employee, obj))
        for i, a in enumerate(x for x in (e.get("affiliations") or []) if x.get("companyId") or x.get("projectId")):
            t["employee_affiliations"].append({"employee_id": e["id"], "position": i,
                                               "company_id": a.get("companyId") or None,
                                               "project_id": a.get("projectId") or None})
    for c in st.get("candidates", []):
        obj = dict(c)
        if isinstance(c.get("housingAllowance"), dict):
            obj["housingAllowance"] = bool(c["housingAllowance"].get("included"))
        t["candidates"].append(_row(M.Candidate, obj))
    for civil, d in (st.get("signatoryDocs") or {}).items():
        p = _save_data_url(d.get("dataUrl"), "signatories", str(civil), d.get("name"))
        t["signatory_docs"].append({"civil_id": civil, "name": d.get("name") if p else None, "path": p,
                                    "expiry_date": d.get("expiryDate"), "uploaded_at": d.get("uploadedAt")})
    t["company_history"] = [_row(M.CompanyHistory, dict(h, id=h.get("id") or db.new_id("ch")))
                            for h in st.get("companyHistory", [])]
    t["audit_log"] = [_row(M.AuditLog, dict(a, id=a.get("id") or db.new_id("aud"),
                                            category=a.get("category") or (a.get("type") or "").split("_")[0]))
                      for a in st.get("auditLog", [])]
    for emp_id, events in (st.get("employeeTimeline") or {}).items():
        for ev in events or []:
            t["employee_timeline"].append(_row(M.EmployeeTimeline, dict(ev, id=ev.get("id") or db.new_id("tl"),
                                                                         employeeId=emp_id)))
    return t


def import_lunx_state(s, st, user=None):
    counts = db.import_tables(s, state_to_tables(st), replace=True)
    stats = {"companies": counts.get("companies", 0), "employees": counts.get("employees", 0),
             "candidates": counts.get("candidates", 0), "fixedReferences": counts.get("_fixedReferences", 0)}
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
