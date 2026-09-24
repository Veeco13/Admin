# -*- coding: utf-8 -*-
"""
Lunx — لوحة تحكم الموارد البشرية والعمليات الحكومية
شركة أبراج انرجي ومجموعة شركاتها التابعة

Flask + SQLite. الواجهة صفحة واحدة (SPA) في static/ ، والـ API هنا.
تشغيل:  python app.py   ثم افتح http://localhost:5050
"""
import io
import json
import os
import re
import sqlite3
from datetime import datetime
from functools import wraps

from flask import (Flask, jsonify, request, session, send_file, render_template,
                   redirect, url_for, abort)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

import db
import docx_engine
import importer
import lunx_restore

APP_VERSION = "v353-flask.1"

BASE_DIR = db.BASE_DIR
TEMPLATE_DOCS = os.path.join(BASE_DIR, "templates_docs")
UPLOADS = os.path.join(BASE_DIR, "uploads")
for sub in ("", "employees", "companies", "signatories", "logos", "imports"):
    os.makedirs(os.path.join(UPLOADS, sub), exist_ok=True)
os.makedirs(TEMPLATE_DOCS, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
app.config["JSON_AS_ASCII"] = False
app.json.ensure_ascii = False


def _secret_key():
    p = os.path.join(BASE_DIR, ".secret_key")
    if not os.path.exists(p):
        open(p, "w").write(os.urandom(32).hex())
    return open(p).read().strip()


app.secret_key = os.environ.get("LUNX_SECRET") or _secret_key()


# ---------------------------------------------------------------------------
# التهيئة
# ---------------------------------------------------------------------------
def bootstrap():
    db.init_db()
    conn = db.connect()
    if not conn.execute("SELECT 1 FROM users").fetchone():
        conn.execute(
            "INSERT INTO users(username, display_name, password_hash, role) VALUES(?,?,?,?)",
            ("admin", "مدير النظام", generate_password_hash("admin123"), "admin"),
        )
    # القوالب الافتراضية
    defaults = [
        ("contract_template_v2.docx", "عقد حكومي — بدل سكن (الشركة والمفوّض تلقائي)", 1),
        ("contract_template.docx", "القالب الافتراضي (عقد حكومي) — النسخة القديمة", 0),
    ]
    for fn, name, is_def in defaults:
        if os.path.exists(os.path.join(TEMPLATE_DOCS, fn)) and not conn.execute(
            "SELECT 1 FROM templates WHERE filename=?", (fn,)
        ).fetchone():
            db.insert(conn, "templates", {"id": db.new_id("tpl"), "name": name, "filename": fn,
                                          "isDefault": is_def, "createdAt": db.now_iso()})
    conn.commit()
    conn.close()


bootstrap()


# ---------------------------------------------------------------------------
# المصادقة والصلاحيات (بديل CAP.user + وضع القراءة فقط)
# ---------------------------------------------------------------------------
def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    conn = db.connect()
    r = conn.execute("SELECT id, username, display_name, role FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return dict(r) if r else None


def uname():
    u = current_user()
    return (u["display_name"] or u["username"]) if u else None


def login_required(f):
    @wraps(f)
    def w(*a, **kw):
        if not current_user():
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login"))
        return f(*a, **kw)
    return w


def write_required(f):
    @wraps(f)
    def w(*a, **kw):
        u = current_user()
        if not u:
            return jsonify({"error": "unauthorized"}), 401
        if u["role"] == "viewer":
            return jsonify({"error": "وضع القراءة فقط: لا تملك صلاحية التعديل"}), 403
        return f(*a, **kw)
    return w


def admin_required(f):
    @wraps(f)
    def w(*a, **kw):
        u = current_user()
        if not u or u["role"] != "admin":
            return jsonify({"error": "هذه العملية لمدير النظام فقط"}), 403
        return f(*a, **kw)
    return w


def err(msg, code=400, **extra):
    return jsonify({"error": msg, **extra}), code


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        conn = db.connect()
        r = conn.execute("SELECT * FROM users WHERE username=?", (request.form.get("username", "").strip(),)).fetchone()
        conn.close()
        if r and check_password_hash(r["password_hash"], request.form.get("password", "")):
            session.clear()
            session["uid"] = r["id"]
            session.permanent = True
            return redirect(url_for("index"))
        error = "اسم المستخدم أو كلمة المرور غير صحيحة"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html", version=APP_VERSION)


# ---------------------------------------------------------------------------
# الحالة الكاملة
# ---------------------------------------------------------------------------
@app.get("/api/state")
@login_required
def api_state():
    conn = db.connect()
    state = db.dump_state(conn)
    conn.close()
    u = current_user()
    state["me"] = {"username": u["username"], "displayName": u["display_name"], "role": u["role"],
                   "readOnly": u["role"] == "viewer"}
    state["version"] = APP_VERSION
    state["pdfAvailable"] = bool(docx_engine.soffice_path())
    return jsonify(state)


# ---------------------------------------------------------------------------
# منع التكرار (القسم 8.2)
# ---------------------------------------------------------------------------
def norm_name(s):
    s = (s or "").strip()
    s = re.sub(r"[ً-ْ]", "", s)
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).lower()


def find_duplicate_civil_id(conn, civil_id, exclude_emp=None, exclude_cand=None):
    if not civil_id:
        return None
    r = conn.execute("SELECT id, name FROM employees WHERE id=?", (civil_id,)).fetchone()
    if r and r["id"] != exclude_emp:
        return {"where": "employee", "id": r["id"], "name": r["name"]}
    r = conn.execute("SELECT id, name FROM candidates WHERE civil_id=?", (civil_id,)).fetchone()
    if r and r["id"] != exclude_cand:
        return {"where": "candidate", "id": r["id"], "name": r["name"]}
    return None


def find_duplicate_passport(conn, passport, exclude_emp=None, exclude_cand=None):
    if not passport:
        return None
    for r in conn.execute("SELECT id, name FROM employees WHERE passport_no=?", (passport,)):
        if r["id"] != exclude_emp:
            return {"where": "employee", "id": r["id"], "name": r["name"]}
    for r in conn.execute("SELECT id, name FROM candidates WHERE passport_no=?", (passport,)):
        if r["id"] != exclude_cand:
            return {"where": "candidate", "id": r["id"], "name": r["name"]}
    return None


def find_duplicate_name_nat(conn, name, nat, exclude_emp=None, exclude_cand=None, include_candidates=True):
    n, nt = norm_name(name), norm_name(nat)
    if not n:
        return None
    for r in conn.execute("SELECT id, name, nationality FROM employees"):
        if r["id"] != exclude_emp and norm_name(r["name"]) == n and norm_name(r["nationality"]) == nt:
            return {"where": "employee", "id": r["id"], "name": r["name"]}
    if include_candidates:
        for r in conn.execute("SELECT id, name, nationality FROM candidates"):
            if r["id"] != exclude_cand and norm_name(r["name"]) == n and norm_name(r["nationality"]) == nt:
                return {"where": "candidate", "id": r["id"], "name": r["name"]}
    return None


# ---------------------------------------------------------------------------
# الموظفين
# ---------------------------------------------------------------------------
TRACKED_DATE_LABELS = {
    "residencyExp": "الإقامة", "workPermitExp": "إذن العمل", "passportExp": "الجواز",
    "healthCardExp": "البطاقة الصحية", "drivingLicenseExp": "رخصة القيادة",
}


def _diff_label(old, new):
    changes = []
    labels = {"name": "الاسم", "salary": "الراتب", "profession": "المهنة", "employmentStatus": "الحالة الوظيفية",
              "govStage": "مرحلة المعاملة", "costCenter": "مركز التكلفة", **TRACKED_DATE_LABELS}
    for k, lab in labels.items():
        if k in new and (old.get(k) or None) != (new.get(k) or None):
            changes.append(f"{lab}: {old.get(k) or '—'} ← {new.get(k) or '—'}")
    return changes


@app.post("/api/employees")
@write_required
def create_employee():
    return save_employee(None)


@app.put("/api/employees/<emp_id>")
@write_required
def update_employee(emp_id):
    return save_employee(emp_id)


def save_employee(orig_id):
    data = request.get_json(force=True) or {}
    force = bool(data.pop("force", False))
    new_id = (data.get("id") or "").strip()
    if not new_id or not re.fullmatch(r"\d{6,14}", new_id):
        return err("الرقم المدني مطلوب (أرقام فقط)")
    if not (data.get("name") or "").strip():
        return err("الاسم مطلوب")
    conn = db.connect()
    try:
        d = find_duplicate_civil_id(conn, new_id, exclude_emp=orig_id)
        if d:
            return err(f"الرقم المدني مسجّل بالفعل لـ {d['name']}", 409, block=True, dup=d)
        d = find_duplicate_passport(conn, data.get("passportNo"), exclude_emp=orig_id)
        if d:
            return err(f"رقم الجواز مسجّل بالفعل لـ {d['name']}", 409, block=True, dup=d)
        if not force and not orig_id:
            d = find_duplicate_name_nat(conn, data.get("name"), data.get("nationality"), include_candidates=False)
            if d:
                return err(f"يوجد موظف بنفس الاسم والجنسية: {d['name']} ({d['id']})", 409, warn=True, dup=d)
        user = uname()
        data["lastUpdated"] = db.now_iso()
        data["lastUpdatedBy"] = user
        affs = data.pop("affiliations", None)
        if orig_id:
            old = db.get_one(conn, "employees", orig_id)
            if not old:
                return err("الموظف غير موجود", 404)
            if new_id != orig_id:
                conn.execute("UPDATE employees SET id=? WHERE id=?", (new_id, orig_id))
                for t, c in (("employee_affiliations", "employee_id"), ("employee_timeline", "employee_id"),
                             ("employee_files", "employee_id"), ("vehicles", "driver_id")):
                    conn.execute(f"UPDATE {t} SET {c}=? WHERE {c}=?", (new_id, orig_id))
            db.update(conn, "employees", new_id, data)
            changes = _diff_label(old, data)
            db.log_audit(conn, "employee_edit", f"تعديل موظف: {data.get('name')} ({new_id})"
                         + (" — " + "، ".join(changes) if changes else ""), user)
            for ch in changes:
                db.push_timeline(conn, new_id, "edit", ch, user)
            for k, lab in TRACKED_DATE_LABELS.items():
                if k in data and data.get(k) and old.get(k) and data[k] > old[k]:
                    db.push_timeline(conn, new_id, "renew", f"تجديد {lab} حتى {data[k]}", user)
                    if k == "residencyExp":
                        aff0 = (affs or [{}])[0] if affs else None
                        cid = aff0.get("companyId") if aff0 else None
                        if cid:
                            db.log_company_history(conn, cid, "residency_renewed",
                                                   f"تجديد إقامة {data.get('name')} حتى {data[k]}", user)
        else:
            data.setdefault("employmentStatus", "active")
            db.insert(conn, "employees", data)
            db.log_audit(conn, "employee_add", f"إضافة موظف: {data.get('name')} ({new_id})", user)
            db.push_timeline(conn, new_id, "create", "إنشاء سجل الموظف", user)
        if affs is not None:
            db.set_affiliations(conn, new_id, affs)
        conn.commit()
        return jsonify({"ok": True, "employee": db.employee_full(conn, new_id)})
    except sqlite3.IntegrityError as e:
        return err(f"تعارض في البيانات: {e}", 409)
    finally:
        conn.close()


@app.delete("/api/employees/<emp_id>")
@write_required
def delete_employee(emp_id):
    conn = db.connect()
    e = db.get_one(conn, "employees", emp_id)
    if not e:
        conn.close()
        return err("غير موجود", 404)
    conn.execute("DELETE FROM employees WHERE id=?", (emp_id,))
    conn.execute("DELETE FROM employee_affiliations WHERE employee_id=?", (emp_id,))
    conn.execute("UPDATE vehicles SET driver_id=NULL WHERE driver_id=?", (emp_id,))
    db.log_audit(conn, "employee_delete", f"حذف موظف: {e['name']} ({emp_id})", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/employees/bulk-assign")
@write_required
def bulk_assign():
    d = request.get_json(force=True)
    ids = d.get("ids") or []
    conn = db.connect()
    comp, proj = d.get("companyId") or None, d.get("projectId") or None
    cc = d.get("costCenter")
    for eid in ids:
        if comp or proj:
            cur = db.employee_full(conn, eid)
            if not cur:
                continue
            affs = cur["affiliations"]
            new = {"companyId": comp, "projectId": proj}
            if d.get("mode") == "add":
                affs = affs + [new]
            else:
                affs = [new] + affs[1:]
            db.set_affiliations(conn, eid, affs)
        if cc is not None:
            conn.execute("UPDATE employees SET cost_center=? WHERE id=?", (cc or None, eid))
        conn.execute("UPDATE employees SET last_updated=?, last_updated_by=? WHERE id=?", (db.now_iso(), uname(), eid))
        db.push_timeline(conn, eid, "assign", "تعيين جماعي لشركة/مشروع/مركز تكلفة", uname())
    db.log_audit(conn, "employee_edit", f"تعيين جماعي لـ {len(ids)} موظف", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "count": len(ids)})


RENEWABLE = {"residencyExp": "residency_exp", "workPermitExp": "work_permit_exp", "passportExp": "passport_exp",
             "healthCardExp": "health_card_exp", "drivingLicenseExp": "driving_license_exp"}


@app.post("/api/employees/renew")
@write_required
def renew_employees():
    """تجديد سريع أو جماعي: {ids:[], field:'residencyExp', date:'YYYY-MM-DD', setRenewedStage:bool}"""
    d = request.get_json(force=True)
    field, date = d.get("field"), d.get("date")
    if field not in RENEWABLE or not date:
        return err("حقل أو تاريخ غير صالح")
    conn = db.connect()
    n = 0
    for eid in d.get("ids") or []:
        e = db.employee_full(conn, eid)
        if not e:
            continue
        conn.execute(f"UPDATE employees SET {RENEWABLE[field]}=?, last_updated=?, last_updated_by=? WHERE id=?",
                     (date, db.now_iso(), uname(), eid))
        if d.get("setRenewedStage"):
            conn.execute("UPDATE employees SET gov_stage='renewed', gov_stage_note=NULL WHERE id=?", (eid,))
        lab = TRACKED_DATE_LABELS[field]
        db.push_timeline(conn, eid, "renew", f"تجديد {lab}: {e.get(field) or '—'} ← {date}", uname())
        if field == "residencyExp" and e["affiliations"] and e["affiliations"][0].get("companyId"):
            db.log_company_history(conn, e["affiliations"][0]["companyId"], "residency_renewed",
                                   f"تجديد إقامة {e['name']} حتى {date}", uname())
        n += 1
    db.log_audit(conn, "employee_edit", f"تجديد {TRACKED_DATE_LABELS[field]} لـ {n} موظف حتى {date}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "count": n})


@app.post("/api/employees/<emp_id>/gov-stage")
@write_required
def set_gov_stage(emp_id):
    d = request.get_json(force=True)
    conn = db.connect()
    e = db.get_one(conn, "employees", emp_id)
    if not e:
        conn.close()
        return err("غير موجود", 404)
    upd = {k: d.get(k) for k in ("govStage", "govStageNote", "govStageResponsible", "govStageStartDate",
                                 "govTransactionCost") if k in d}
    upd["lastUpdated"], upd["lastUpdatedBy"] = db.now_iso(), uname()
    db.update(conn, "employees", emp_id, upd)
    db.push_timeline(conn, emp_id, "gov_stage", f"مرحلة المعاملة: {d.get('govStage') or '—'}"
                     + (f" — {d.get('govStageNote')}" if d.get("govStageNote") else ""), uname())
    db.log_audit(conn, "employee_edit", f"تحديث مرحلة معاملة {e['name']} ({emp_id})", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/employees/import")
@write_required
def import_employees():
    f = request.files.get("file")
    if not f or not f.filename:
        return err("لم يتم اختيار ملف")
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".xlsx", ".xls", ".csv"):
        return err("الصيغ المدعومة: xlsx, xls, csv")
    path = os.path.join(UPLOADS, "imports", datetime.now().strftime("%Y%m%d%H%M%S") + ext)
    f.save(path)
    conn = db.connect()
    try:
        stats = importer.import_file(conn, path, uname())
        db.log_audit(conn, "employee_add",
                     f"استيراد ملف {f.filename}: {stats['added']} جديد، {stats['updated']} تحديث", uname())
        conn.commit()
    except Exception as e:
        conn.rollback()
        return err(f"خطأ في قراءة الملف: {e}")
    finally:
        conn.close()
    return jsonify({"ok": True, **stats})


# مرفقات الموظف (بديل Google Drive)
@app.get("/api/employees/<emp_id>/files")
@login_required
def list_emp_files(emp_id):
    conn = db.connect()
    rows = [dict(r) for r in conn.execute(
        "SELECT id, name, size, uploaded_at, uploaded_by FROM employee_files WHERE employee_id=? ORDER BY uploaded_at DESC",
        (emp_id,))]
    conn.close()
    return jsonify(rows)


@app.post("/api/employees/<emp_id>/files")
@write_required
def upload_emp_file(emp_id):
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    folder = os.path.join(UPLOADS, "employees", emp_id)
    os.makedirs(folder, exist_ok=True)
    fid = db.new_id("f")
    safe = fid + "_" + (secure_filename(f.filename) or "file")
    path = os.path.join(folder, safe)
    f.save(path)
    conn = db.connect()
    conn.execute("INSERT INTO employee_files VALUES(?,?,?,?,?,?,?)",
                 (fid, emp_id, f.filename, os.path.relpath(path, BASE_DIR), os.path.getsize(path), db.now_iso(), uname()))
    db.push_timeline(conn, emp_id, "file", f"رفع مرفق: {f.filename}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": fid})


@app.delete("/api/files/<fid>")
@write_required
def delete_emp_file(fid):
    conn = db.connect()
    r = conn.execute("SELECT * FROM employee_files WHERE id=?", (fid,)).fetchone()
    if r:
        try:
            os.remove(os.path.join(BASE_DIR, r["path"]))
        except OSError:
            pass
        conn.execute("DELETE FROM employee_files WHERE id=?", (fid,))
        db.push_timeline(conn, r["employee_id"], "file", f"حذف مرفق: {r['name']}", uname())
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/files/emp/<fid>")
@login_required
def get_emp_file(fid):
    conn = db.connect()
    r = conn.execute("SELECT * FROM employee_files WHERE id=?", (fid,)).fetchone()
    conn.close()
    if not r:
        abort(404)
    return send_file(os.path.join(BASE_DIR, r["path"]), download_name=r["name"],
                     as_attachment=request.args.get("dl") == "1")


# ---------------------------------------------------------------------------
# الشركات والمشاريع والمفوّضين
# ---------------------------------------------------------------------------
@app.post("/api/companies")
@write_required
def create_company():
    d = request.get_json(force=True)
    if not (d.get("nameAr") or "").strip():
        return err("اسم الشركة مطلوب")
    conn = db.connect()
    d["id"] = db.new_id("co")
    db.insert(conn, "companies", d)
    db.log_company_history(conn, d["id"], "company_created", f"إنشاء الشركة: {d['nameAr']}", uname())
    db.log_audit(conn, "company_add", f"إضافة شركة: {d['nameAr']}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/companies/<cid>")
@write_required
def update_company(cid):
    d = request.get_json(force=True)
    conn = db.connect()
    old = db.get_one(conn, "companies", cid)
    if not old:
        conn.close()
        return err("غير موجود", 404)
    db.update(conn, "companies", cid, d)
    u = uname()
    if d.get("commercialLicenseExpiry") and d["commercialLicenseExpiry"] != old.get("commercialLicenseExpiry"):
        db.log_company_history(conn, cid, "license_renewed", f"تجديد الرخصة التجارية حتى {d['commercialLicenseExpiry']}", u)
    if d.get("trafficAuthExpiry") and d["trafficAuthExpiry"] != old.get("trafficAuthExpiry"):
        db.log_company_history(conn, cid, "traffic_auth", f"تفويض المرور حتى {d['trafficAuthExpiry']}", u)
    if d.get("civilAffairsAuthExpiry") and d["civilAffairsAuthExpiry"] != old.get("civilAffairsAuthExpiry"):
        db.log_company_history(conn, cid, "civil_affairs_auth", f"تفويض الشؤون المدنية حتى {d['civilAffairsAuthExpiry']}", u)
    db.log_audit(conn, "company_edit", f"تعديل شركة: {d.get('nameAr') or old['nameAr']}", u)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/companies/<cid>")
@write_required
def delete_company(cid):
    conn = db.connect()
    c = db.get_one(conn, "companies", cid)
    if not c:
        conn.close()
        return err("غير موجود", 404)
    n = conn.execute("SELECT COUNT(*) FROM employee_affiliations WHERE company_id=?", (cid,)).fetchone()[0]
    if n:
        conn.close()
        return err(f"لا يمكن حذف الشركة: مرتبط بها {n} موظف. انقلهم أولًا.")
    conn.execute("DELETE FROM companies WHERE id=?", (cid,))
    conn.execute("DELETE FROM projects WHERE company_id=?", (cid,))
    conn.execute("DELETE FROM signatories WHERE company_id=?", (cid,))
    conn.execute("DELETE FROM company_docs WHERE company_id=?", (cid,))
    db.log_audit(conn, "company_delete", f"حذف شركة: {c['nameAr']}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


DOC_KINDS = {"trafficAuth": "traffic_auth", "civilAffairs": "civil_affairs_auth", "commercialLicense": "license_renewed"}


@app.post("/api/companies/<cid>/docs/<kind>")
@write_required
def upload_company_doc(cid, kind):
    if kind not in DOC_KINDS and kind != "logo":
        return err("نوع مستند غير معروف")
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    folder = os.path.join(UPLOADS, "logos" if kind == "logo" else "companies")
    fn = f"{cid}_{kind}{os.path.splitext(f.filename)[1].lower()}"
    path = os.path.join(folder, fn)
    f.save(path)
    rel = os.path.relpath(path, BASE_DIR)
    conn = db.connect()
    if kind == "logo":
        conn.execute("UPDATE companies SET logo_path=? WHERE id=?", (rel, cid))
    else:
        conn.execute("INSERT OR REPLACE INTO company_docs VALUES(?,?,?,?,?)", (cid, kind, f.filename, rel, db.now_iso()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/companies/<cid>/docs/<kind>")
@write_required
def delete_company_doc(cid, kind):
    conn = db.connect()
    conn.execute("DELETE FROM company_docs WHERE company_id=? AND kind=?", (cid, kind))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/files/company/<cid>/<kind>")
@login_required
def get_company_doc(cid, kind):
    conn = db.connect()
    r = conn.execute("SELECT * FROM company_docs WHERE company_id=? AND kind=?", (cid, kind)).fetchone()
    conn.close()
    if not r:
        abort(404)
    return send_file(os.path.join(BASE_DIR, r["path"]), download_name=r["name"])


@app.get("/files/logo/<cid>")
@login_required
def get_logo(cid):
    conn = db.connect()
    r = conn.execute("SELECT logo_path FROM companies WHERE id=?", (cid,)).fetchone()
    conn.close()
    if not r or not r["logo_path"]:
        abort(404)
    return send_file(os.path.join(BASE_DIR, r["logo_path"]))


@app.post("/api/signatories")
@write_required
def create_signatory():
    d = request.get_json(force=True)
    if not d.get("companyId") or not (d.get("nameAr") or "").strip():
        return err("الشركة والاسم مطلوبين")
    conn = db.connect()
    d["id"] = db.new_id("sig")
    db.insert(conn, "signatories", d)
    db.log_company_history(conn, d["companyId"], "signatory_added", f"إضافة مفوّض بالتوقيع: {d['nameAr']}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/signatories/<sid>")
@write_required
def update_signatory(sid):
    conn = db.connect()
    db.update(conn, "signatories", sid, request.get_json(force=True))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/signatories/<sid>")
@write_required
def delete_signatory(sid):
    conn = db.connect()
    db.delete(conn, "signatories", sid)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/signatory-docs/<civil_id>")
@write_required
def upload_signatory_doc(civil_id):
    """صورة البطاقة المدنية للمفوّض: تُحفظ مرة واحدة لكل شخص (مفتاحها الرقم المدني)."""
    f = request.files.get("file")
    expiry = request.form.get("expiryDate") or None
    conn = db.connect()
    old = conn.execute("SELECT * FROM signatory_docs WHERE civil_id=?", (civil_id,)).fetchone()
    name, rel = (old["name"], old["path"]) if old else (None, None)
    if f and f.filename:
        fn = f"{civil_id}{os.path.splitext(f.filename)[1].lower()}"
        path = os.path.join(UPLOADS, "signatories", fn)
        f.save(path)
        name, rel = f.filename, os.path.relpath(path, BASE_DIR)
    conn.execute("INSERT OR REPLACE INTO signatory_docs VALUES(?,?,?,?,?)", (civil_id, name, rel, expiry, db.now_iso()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/files/signatory/<civil_id>")
@login_required
def get_signatory_doc(civil_id):
    conn = db.connect()
    r = conn.execute("SELECT * FROM signatory_docs WHERE civil_id=?", (civil_id,)).fetchone()
    conn.close()
    if not r or not r["path"]:
        abort(404)
    return send_file(os.path.join(BASE_DIR, r["path"]), download_name=r["name"])


@app.post("/api/projects")
@write_required
def create_project():
    d = request.get_json(force=True)
    if not d.get("companyId") or not (d.get("nameAr") or "").strip():
        return err("الشركة واسم المشروع مطلوبين")
    conn = db.connect()
    d["id"] = db.new_id("pr")
    db.insert(conn, "projects", d)
    db.log_company_history(conn, d["companyId"], "project_added", f"إضافة مشروع: {d['nameAr']}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/projects/<pid>")
@write_required
def update_project(pid):
    d = request.get_json(force=True)
    conn = db.connect()
    old = db.get_one(conn, "projects", pid)
    if not old:
        conn.close()
        return err("غير موجود", 404)
    db.update(conn, "projects", pid, d)
    if d.get("expiryDate") and d["expiryDate"] != old.get("expiryDate"):
        db.log_company_history(conn, d.get("companyId") or old["companyId"], "project_renewed",
                               f"تجديد مشروع {d.get('nameAr') or old['nameAr']} حتى {d['expiryDate']}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/projects/<pid>")
@write_required
def delete_project(pid):
    conn = db.connect()
    conn.execute("UPDATE employee_affiliations SET project_id=NULL WHERE project_id=?", (pid,))
    db.delete(conn, "projects", pid)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# السيارات ومراكز التكلفة (CRUD بسيط)
# ---------------------------------------------------------------------------
@app.post("/api/vehicles")
@app.put("/api/vehicles/<vid>")
@write_required
def save_vehicle(vid=None):
    d = request.get_json(force=True)
    plate = (d.get("plate") or "").strip()
    if not plate:
        return err("رقم اللوحة مطلوب")
    conn = db.connect()
    dup = conn.execute("SELECT id FROM vehicles WHERE plate=? AND id<>?", (plate, vid or "")).fetchone()
    if dup:
        conn.close()
        return err(f"رقم اللوحة {plate} مسجّل بالفعل", 409, block=True)
    if vid:
        db.update(conn, "vehicles", vid, d)
        db.log_audit(conn, "vehicle_edit", f"تعديل سيارة: {plate}", uname())
    else:
        d["id"] = vid = db.new_id("veh")
        db.insert(conn, "vehicles", d)
        db.log_audit(conn, "vehicle_add", f"إضافة سيارة: {plate}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": vid})


@app.delete("/api/vehicles/<vid>")
@write_required
def delete_vehicle(vid):
    conn = db.connect()
    v = db.get_one(conn, "vehicles", vid)
    db.delete(conn, "vehicles", vid)
    if v:
        db.log_audit(conn, "vehicle_delete", f"حذف سيارة: {v['plate']}", uname())
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/cost-centers")
@app.put("/api/cost-centers/<ccid>")
@write_required
def save_cost_center(ccid=None):
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    if not name:
        return err("الاسم مطلوب")
    conn = db.connect()
    if conn.execute("SELECT 1 FROM cost_centers WHERE name=? AND id<>?", (name, ccid or "")).fetchone():
        conn.close()
        return err("مركز التكلفة موجود بالفعل", 409)
    if ccid:
        old = db.get_one(conn, "costCenters", ccid)
        db.update(conn, "costCenters", ccid, d)
        if old and old["name"] != name:  # الربط بالاسم ← نحدّث الموظفين والمترشّحين
            conn.execute("UPDATE employees SET cost_center=? WHERE cost_center=?", (name, old["name"]))
            conn.execute("UPDATE candidates SET cost_center=? WHERE cost_center=?", (name, old["name"]))
    else:
        d["id"] = db.new_id("cc")
        db.insert(conn, "costCenters", d)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/cost-centers/<ccid>")
@write_required
def delete_cost_center(ccid):
    conn = db.connect()
    old = db.get_one(conn, "costCenters", ccid)
    if old:
        n = conn.execute("SELECT COUNT(*) FROM employees WHERE cost_center=?", (old["name"],)).fetchone()[0]
        if n:
            conn.close()
            return err(f"لا يمكن الحذف: مرتبط بـ {n} موظف")
        db.delete(conn, "costCenters", ccid)
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# الاستقدام والتوظيف
# ---------------------------------------------------------------------------
@app.post("/api/candidates")
@app.put("/api/candidates/<cand_id>")
@write_required
def save_candidate(cand_id=None):
    d = request.get_json(force=True)
    if not (d.get("name") or "").strip():
        return err("الاسم مطلوب")
    conn = db.connect()
    try:
        dup = find_duplicate_civil_id(conn, (d.get("civilId") or "").strip(), exclude_cand=cand_id)
        if dup:
            return err(f"الرقم المدني مسجّل بالفعل لـ {dup['name']}", 409, block=True)
        dup = find_duplicate_passport(conn, (d.get("passportNo") or "").strip(), exclude_cand=cand_id)
        if dup:
            return err(f"رقم الجواز مسجّل بالفعل لـ {dup['name']}", 409, block=True)
        if not cand_id:
            dup = find_duplicate_name_nat(conn, d.get("name"), d.get("nationality"))
            if dup:
                return err(f"يوجد {'موظف' if dup['where']=='employee' else 'مترشّح'} بنفس الاسم والجنسية: {dup['name']}",
                           409, block=True)
        if d.get("stage") == "all_completed" and not (d.get("civilId") or "").strip():
            return err("لا يمكن اختيار «تم إنجاز جميع الإجراءات» قبل تسجيل الرقم المدني")
        if cand_id:
            db.update(conn, "candidates", cand_id, d)
            db.log_audit(conn, "candidate_edit", f"تعديل مترشّح: {d['name']}", uname())
        else:
            d["id"] = cand_id = db.new_id("cand")
            d.setdefault("appliedDate", datetime.now().strftime("%Y-%m-%d"))
            db.insert(conn, "candidates", d)
            db.log_audit(conn, "candidate_add", f"إضافة مترشّح: {d['name']}", uname())
        conn.commit()
        return jsonify({"ok": True, "id": cand_id})
    finally:
        conn.close()


@app.delete("/api/candidates/<cand_id>")
@write_required
def delete_candidate(cand_id):
    conn = db.connect()
    db.delete(conn, "candidates", cand_id)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/candidates/<cand_id>/convert")
@write_required
def convert_candidate(cand_id):
    """القسم 8.1: تحويل المترشّح إلى موظف بحالة «قيد الاستكمال»."""
    conn = db.connect()
    try:
        c = db.get_one(conn, "candidates", cand_id)
        if not c:
            return err("غير موجود", 404)
        civil = (c.get("civilId") or "").strip()
        if not civil:
            return err("لازم الرقم المدني يكون متسجّل قبل التحويل")
        dup = find_duplicate_civil_id(conn, civil, exclude_cand=cand_id)
        if dup:
            return err(f"الرقم المدني مسجّل بالفعل لـ {dup['name']}", 409)
        dup = find_duplicate_passport(conn, c.get("passportNo"), exclude_cand=cand_id)
        if dup:
            return err(f"رقم الجواز مسجّل بالفعل لـ {dup['name']}", 409)
        emp = {
            "id": civil, "name": c["name"], "nameEn": c.get("nameEn"), "nationality": c.get("nationality"),
            "dateOfBirth": c.get("dateOfBirth"), "profession": c.get("profession"), "phone": c.get("phone"),
            "salary": c.get("salary"), "housingIncluded": bool(c.get("housingAllowance")), "housingAmount": None,
            "passportNo": c.get("passportNo"), "passportExp": c.get("passportExp"),
            "costCenter": c.get("costCenter"), "employmentStatus": "pending_completion",
            "dateOfHire": datetime.now().strftime("%Y-%m-%d"),
            "lastUpdated": db.now_iso(), "lastUpdatedBy": uname(),
        }
        emp["nationalityEn"] = docx_engine.NATIONALITY_EN.get(emp["nationality"] or "")
        db.insert(conn, "employees", emp)
        if c.get("targetCompanyId"):
            db.set_affiliations(conn, civil, [{"companyId": c["targetCompanyId"], "projectId": None}])
        db.delete(conn, "candidates", cand_id)
        db.push_timeline(conn, civil, "create", "تحويل من مترشّح إلى موظف (قيد الاستكمال)", uname())
        db.log_audit(conn, "candidate_convert", f"تحويل المترشّح {c['name']} إلى موظف ({civil})", uname())
        conn.commit()
        return jsonify({"ok": True, "employeeId": civil})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# قوالب وعقود العمل (Word / PDF)
# ---------------------------------------------------------------------------
def _contract_bundle(args):
    conn = db.connect()
    emp = db.employee_full(conn, args.get("emp", ""))
    if not emp:
        conn.close()
        abort(404, "الموظف غير موجود")
    tpl = db.get_one(conn, "templates", args.get("tpl", "")) or \
        (db.list_all(conn, "templates", "is_default DESC")[:1] or [None])[0]
    if not tpl:
        conn.close()
        abort(404, "لا يوجد قالب")
    aff = (emp.get("affiliations") or [{}])[0]
    company = db.get_one(conn, "companies", args.get("company") or aff.get("companyId") or "")
    project = db.get_one(conn, "projects", aff.get("projectId") or "")
    sig = db.get_one(conn, "signatories", args.get("sig", ""))
    if not sig and company:
        r = conn.execute("SELECT * FROM signatories WHERE company_id=? LIMIT 1", (company["id"],)).fetchone()
        sig = db.row_to_obj("signatories", r)
    conn.close()
    overrides = {}
    for k in ("salary", "profession", "professionEn", "nameEn", "nationalityEn"):
        if args.get(k):
            overrides[k] = args.get(k)
    emp.update(overrides)
    ctx = docx_engine.resolve_contract_template(emp, company, sig, project, args.get("date") or None)
    data = docx_engine.fill_docx_template(os.path.join(TEMPLATE_DOCS, tpl["filename"]), ctx)
    return emp, data, ctx


@app.get("/api/contract/preview")
@login_required
def contract_preview():
    emp, data, ctx = _contract_bundle(request.args)
    return jsonify({"html": docx_engine.docx_to_html(data), "fields": ctx})


@app.get("/api/contract/docx")
@login_required
def contract_docx():
    emp, data, _ = _contract_bundle(request.args)
    return send_file(io.BytesIO(data), as_attachment=True, download_name=f"عقد عمل - {emp['name']}.docx",
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.get("/api/contract/pdf")
@login_required
def contract_pdf():
    emp, data, _ = _contract_bundle(request.args)
    pdf = docx_engine.docx_to_pdf(data)
    if not pdf:
        return err("تحويل PDF يحتاج LibreOffice على السيرفر (أو MS Word على ويندوز)", 501)
    return send_file(io.BytesIO(pdf), as_attachment=request.args.get("dl") == "1",
                     download_name=f"عقد عمل - {emp['name']}.pdf", mimetype="application/pdf")


@app.post("/api/templates")
@write_required
def upload_template():
    f = request.files.get("file")
    name = (request.form.get("name") or "").strip()
    if not f or not f.filename.lower().endswith(".docx") or not name:
        return err("اسم القالب وملف Word (.docx) مطلوبين")
    fn = datetime.now().strftime("%Y%m%d%H%M%S_") + (secure_filename(f.filename) or "template.docx")
    if not fn.endswith(".docx"):
        fn += ".docx"
    path = os.path.join(TEMPLATE_DOCS, fn)
    f.save(path)
    try:
        fields = docx_engine.list_placeholders(path)
    except Exception:
        os.remove(path)
        return err("ملف Word غير صالح")
    conn = db.connect()
    tid = db.new_id("tpl")
    db.insert(conn, "templates", {"id": tid, "name": name, "filename": fn, "isDefault": 0, "createdAt": db.now_iso()})
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": tid, "fields": fields})


@app.post("/api/templates/<tid>/default")
@write_required
def set_default_template(tid):
    conn = db.connect()
    conn.execute("UPDATE templates SET is_default=0")
    conn.execute("UPDATE templates SET is_default=1 WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/templates/<tid>")
@write_required
def delete_template(tid):
    conn = db.connect()
    if conn.execute("SELECT COUNT(*) FROM templates").fetchone()[0] <= 1:
        conn.close()
        return err("لازم يفضل قالب واحد على الأقل")
    db.delete(conn, "templates", tid)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.get("/api/templates/<tid>/file")
@login_required
def download_template(tid):
    conn = db.connect()
    t = db.get_one(conn, "templates", tid)
    conn.close()
    if not t:
        abort(404)
    return send_file(os.path.join(TEMPLATE_DOCS, t["filename"]), as_attachment=True, download_name=t["filename"])


# ---------------------------------------------------------------------------
# النسخ الاحتياطي والاستعادة (القسم: BACKUP / RESTORE)
# ---------------------------------------------------------------------------
BACKUP_TABLES = ["companies", "projects", "cost_centers", "vehicles", "employees", "employee_affiliations",
                 "candidates", "signatories", "signatory_docs", "company_docs", "employee_files",
                 "company_history", "audit_log", "employee_timeline", "templates"]


@app.get("/api/backup")
@login_required
def backup():
    conn = db.connect()
    out = {"app": "Lunx", "version": APP_VERSION, "createdAt": db.now_iso(), "tables": {}}
    for t in BACKUP_TABLES:
        out["tables"][t] = [dict(r) for r in conn.execute(f"SELECT * FROM {t}")]
    db.set_meta(conn, "last_backup", db.now_iso())
    conn.commit()
    conn.close()
    buf = io.BytesIO(json.dumps(out, ensure_ascii=False, indent=1).encode("utf-8"))
    return send_file(buf, as_attachment=True, mimetype="application/json",
                     download_name=f"lunx-backup-{datetime.now().strftime('%Y-%m-%d')}.json")


@app.post("/api/restore")
@admin_required
def restore():
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    try:
        data = json.loads(f.read().decode("utf-8-sig"))
    except Exception:
        return err("ملف النسخة الاحتياطية غير صالح")
    # نسخة احتياطية من Lunx (نسخة الملف الواحد)
    if lunx_restore.is_lunx_state(data):
        conn = db.connect()
        try:
            stats = lunx_restore.import_lunx_state(conn, data, uname())
            conn.commit()
        except Exception as e:
            conn.rollback()
            return err(f"فشل الاستعادة: {e}")
        finally:
            conn.close()
        return jsonify({"ok": True, **stats})
    tables = data.get("tables") if isinstance(data, dict) else None
    if not isinstance(tables, dict):
        return err("ملف النسخة الاحتياطية غير صالح")
    conn = db.connect()
    try:
        for t in BACKUP_TABLES:
            if t not in tables:
                continue
            cols = {r[1] for r in conn.execute(f"PRAGMA table_info({t})")}
            conn.execute(f"DELETE FROM {t}")
            for row in tables[t]:
                row = {k: v for k, v in row.items() if k in cols}
                if row:
                    conn.execute(f"INSERT INTO {t} ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})",
                                 list(row.values()))
        db.log_audit(conn, "backup_restore", f"استعادة نسخة احتياطية من {data.get('createdAt', '')}", uname())
        conn.commit()
    except Exception as e:
        conn.rollback()
        return err(f"فشل الاستعادة: {e}")
    finally:
        conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# المستخدمين (للمدير)
# ---------------------------------------------------------------------------
@app.get("/api/users")
@admin_required
def list_users():
    conn = db.connect()
    rows = [dict(r) for r in conn.execute("SELECT id, username, display_name, role FROM users ORDER BY id")]
    conn.close()
    return jsonify(rows)


@app.post("/api/users")
@admin_required
def create_user():
    d = request.get_json(force=True)
    if not d.get("username") or not d.get("password") or d.get("role") not in ("admin", "editor", "viewer"):
        return err("بيانات ناقصة")
    conn = db.connect()
    try:
        conn.execute("INSERT INTO users(username, display_name, password_hash, role) VALUES(?,?,?,?)",
                     (d["username"].strip(), d.get("displayName") or d["username"],
                      generate_password_hash(d["password"]), d["role"]))
        conn.commit()
    except sqlite3.IntegrityError:
        return err("اسم المستخدم موجود بالفعل", 409)
    finally:
        conn.close()
    return jsonify({"ok": True})


@app.put("/api/users/<int:uid>")
@admin_required
def update_user(uid):
    d = request.get_json(force=True)
    conn = db.connect()
    if d.get("role") in ("admin", "editor", "viewer"):
        conn.execute("UPDATE users SET role=? WHERE id=?", (d["role"], uid))
    if d.get("password"):
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(d["password"]), uid))
    if d.get("displayName"):
        conn.execute("UPDATE users SET display_name=? WHERE id=?", (d["displayName"], uid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.delete("/api/users/<int:uid>")
@admin_required
def delete_user(uid):
    if uid == session.get("uid"):
        return err("لا يمكنك حذف حسابك")
    conn = db.connect()
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.post("/api/me/password")
@login_required
def change_my_password():
    d = request.get_json(force=True)
    conn = db.connect()
    r = conn.execute("SELECT * FROM users WHERE id=?", (session["uid"],)).fetchone()
    if not check_password_hash(r["password_hash"], d.get("old", "")):
        conn.close()
        return err("كلمة المرور الحالية غير صحيحة")
    if len(d.get("new", "")) < 6:
        conn.close()
        return err("كلمة المرور الجديدة لازم 6 أحرف على الأقل")
    conn.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(d["new"]), session["uid"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": getattr(e, "description", "غير موجود")}), 404
    return e


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"Lunx {APP_VERSION} → http://localhost:{port}   (admin / admin123)")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=bool(os.environ.get("DEBUG")))
