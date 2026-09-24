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

DATA_TABLES = ["companies", "projects", "cost_centers", "vehicles", "employees", "employee_affiliations",
               "candidates", "signatories", "signatory_docs", "company_docs", "company_history",
               "audit_log", "employee_timeline"]


def is_lunx_state(obj):
    return isinstance(obj, dict) and "employees" in obj and "companies" in obj and "tables" not in obj


def _norm_dt(s):
    """2026-09-23T10:56:53.807Z → 2026-09-23T10:56:53"""
    if not s:
        return s
    return re.sub(r"(\.\d+)?Z$", "", str(s))


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


def import_lunx_state(conn, st, user=None):
    for t in DATA_TABLES:
        conn.execute(f"DELETE FROM {t}")
    stats = {}

    # الشركات + المفوّضين + المستندات + الشعار
    for c in st.get("companies", []):
        obj = dict(c)
        db.insert(conn, "companies", obj)
        logo = _save_data_url(c.get("logoDataUrl"), "logos", f"{c['id']}_logo")
        if logo:
            conn.execute("UPDATE companies SET logo_path=? WHERE id=?", (logo, c["id"]))
        for s in c.get("signatories") or []:
            s = dict(s)
            s.setdefault("id", db.new_id("sig"))
            s["companyId"] = c["id"]
            db.insert(conn, "signatories", s)
        for kind, d in (c.get("docs") or {}).items():
            if not d:
                continue
            p = _save_data_url(d.get("dataUrl"), "companies", f"{c['id']}_{kind}", d.get("name"))
            if p:
                conn.execute("INSERT OR REPLACE INTO company_docs VALUES(?,?,?,?,?)",
                             (c["id"], kind, d.get("name"), p, _norm_dt(d.get("uploadedAt"))))
    stats["companies"] = len(st.get("companies", []))

    for p in st.get("projects", []):
        db.insert(conn, "projects", p)
    for cc in st.get("costCenters", []):
        db.insert(conn, "costCenters", cc)
    for v in st.get("vehicles", []):
        db.insert(conn, "vehicles", v)

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
        obj["lastUpdated"] = _norm_dt(e.get("lastUpdated"))
        if not obj.get("employmentStatus"):
            obj["employmentStatus"] = "active"
        db.insert(conn, "employees", obj)
        db.set_affiliations(conn, e["id"], e.get("affiliations") or [])
        n += 1
    stats["employees"] = n

    for c in st.get("candidates", []):
        obj = dict(c)
        ha = c.get("housingAllowance")
        if isinstance(ha, dict):
            obj["housingAllowance"] = bool(ha.get("included"))
        db.insert(conn, "candidates", obj)
    stats["candidates"] = len(st.get("candidates", []))

    for civil, d in (st.get("signatoryDocs") or {}).items():
        p = _save_data_url(d.get("dataUrl"), "signatories", str(civil), d.get("name"))
        conn.execute("INSERT OR REPLACE INTO signatory_docs VALUES(?,?,?,?,?)",
                     (civil, d.get("name") if p else None, p, d.get("expiryDate"), _norm_dt(d.get("uploadedAt"))))

    for h in st.get("companyHistory", []):
        conn.execute("INSERT INTO company_history(id, company_id, type, label, date, user) VALUES(?,?,?,?,?,?)",
                     (h.get("id") or db.new_id("ch"), h.get("companyId"), h.get("type"), h.get("label"),
                      _norm_dt(h.get("date")), h.get("user")))
    for a in st.get("auditLog", []):
        conn.execute("INSERT INTO audit_log(id, type, category, label, date, user) VALUES(?,?,?,?,?,?)",
                     (a.get("id") or db.new_id("aud"), a.get("type"), a.get("category") or (a.get("type") or "").split("_")[0],
                      a.get("label"), _norm_dt(a.get("date")), a.get("user")))
    for emp_id, events in (st.get("employeeTimeline") or {}).items():
        for ev in events or []:
            conn.execute("INSERT INTO employee_timeline(id, employee_id, type, label, date, user) VALUES(?,?,?,?,?,?)",
                         (ev.get("id") or db.new_id("tl"), emp_id, ev.get("type"), ev.get("label"),
                          _norm_dt(ev.get("date")), ev.get("user")))
    db.log_audit(conn, "backup_restore",
                 f"استعادة نسخة Lunx: {stats['employees']} موظف، {stats['companies']} شركة، {stats['candidates']} مترشّح", user)
    return stats


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    db.init_db()
    state = json.load(open(sys.argv[1], encoding="utf-8"))
    if not is_lunx_state(state):
        sys.exit("الملف ده مش نسخة احتياطية من Lunx")
    conn = db.connect()
    try:
        s = import_lunx_state(conn, state, "استعادة من سطر الأوامر")
        conn.commit()
        print("تمت الاستعادة:", s)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
