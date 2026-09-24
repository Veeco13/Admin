# -*- coding: utf-8 -*-
"""
Lunx — لوحة تحكم الموارد البشرية والعمليات الحكومية
شركة أبراج انرجي ومجموعة شركاتها التابعة

Flask + SQLAlchemy. الواجهة صفحة واحدة (SPA) في static/ ، والـ API هنا.
تشغيل:  python app.py   ثم افتح http://localhost:5050
نوع قاعدة البيانات: متغير البيئة LUNX_DATABASE_URL (الافتراضي SQLite: lunx.db)
"""
import io
import json
import os
import re
from datetime import datetime
from functools import wraps

from flask import (Flask, jsonify, request, session, send_file, render_template,
                   redirect, url_for, abort)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

import db
import docx_engine
import importer
import lunx_restore
import models as M

APP_VERSION = "v353-flask.2"

BASE_DIR = db.BASE_DIR
TEMPLATE_DOCS = os.path.join(BASE_DIR, "templates_docs")
UPLOADS = os.path.join(BASE_DIR, "uploads")
for sub in ("", "employees", "companies", "signatories", "logos", "imports"):
    os.makedirs(os.path.join(UPLOADS, sub), exist_ok=True)
os.makedirs(TEMPLATE_DOCS, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
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
    with db.session_scope() as s:
        if not s.scalar(select(func.count()).select_from(M.User)):
            s.add(M.User(username="admin", displayName="مدير النظام",
                         passwordHash=generate_password_hash("admin123"), role="admin"))
        defaults = [
            ("contract_template_v2.docx", "عقد حكومي — بدل سكن (الشركة والمفوّض تلقائي)", True),
            ("contract_template.docx", "القالب الافتراضي (عقد حكومي) — النسخة القديمة", False),
        ]
        for fn, name, is_def in defaults:
            if os.path.exists(os.path.join(TEMPLATE_DOCS, fn)) and \
                    not s.scalar(select(M.Template).where(M.Template.filename == fn)):
                s.add(M.Template(id=db.new_id("tpl"), name=name, filename=fn, isDefault=is_def, createdAt=db.now()))


bootstrap()


def body():
    return request.get_json(force=True, silent=True) or {}


def err(msg, code=400, **extra):
    return jsonify({"error": msg, **extra}), code


# ---------------------------------------------------------------------------
# المصادقة والصلاحيات (بديل CAP.user + وضع القراءة فقط)
# ---------------------------------------------------------------------------
def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    with db.session_scope(commit=False) as s:
        u = s.get(M.User, uid)
        return {"id": u.id, "username": u.username, "display_name": u.displayName, "role": u.role} if u else None


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


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        with db.session_scope(commit=False) as s:
            u = s.scalar(select(M.User).where(M.User.username == request.form.get("username", "").strip()))
        if u and check_password_hash(u.passwordHash, request.form.get("password", "")):
            session.clear()
            session["uid"] = u.id
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
    with db.session_scope(commit=False) as s:
        state = db.dump_state(s)
    u = current_user()
    state["me"] = {"username": u["username"], "displayName": u["display_name"], "role": u["role"],
                   "readOnly": u["role"] == "viewer"}
    state["version"] = APP_VERSION
    state["pdfAvailable"] = bool(docx_engine.soffice_path())
    state["database"] = db.engine.dialect.name
    return jsonify(state)


# ---------------------------------------------------------------------------
# منع التكرار (القسم 8.2)
# ---------------------------------------------------------------------------
def norm_name(v):
    v = (v or "").strip()
    v = re.sub(r"[ً-ْ]", "", v)
    v = v.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", v).lower()


def dup(where, id_, name):
    return {"where": where, "id": id_, "name": name}


def find_duplicate_civil_id(s, civil_id, exclude_emp=None, exclude_cand=None):
    if not civil_id:
        return None
    e = s.get(M.Employee, civil_id)
    if e and e.id != exclude_emp:
        return dup("employee", e.id, e.name)
    c = s.scalar(select(M.Candidate).where(M.Candidate.civilId == civil_id, M.Candidate.id != (exclude_cand or "")))
    return dup("candidate", c.id, c.name) if c else None


def find_duplicate_passport(s, passport, exclude_emp=None, exclude_cand=None):
    passport = (passport or "").strip()
    if not passport:
        return None
    e = s.scalar(select(M.Employee).where(M.Employee.passportNo == passport, M.Employee.id != (exclude_emp or "")))
    if e:
        return dup("employee", e.id, e.name)
    c = s.scalar(select(M.Candidate).where(M.Candidate.passportNo == passport, M.Candidate.id != (exclude_cand or "")))
    return dup("candidate", c.id, c.name) if c else None


def find_duplicate_name_nat(s, name, nat, exclude_emp=None, exclude_cand=None, include_candidates=True):
    n, nt = norm_name(name), norm_name(nat)
    if not n:
        return None
    for i, nm, na in s.execute(select(M.Employee.id, M.Employee.name, M.Employee.nationality)):
        if i != exclude_emp and norm_name(nm) == n and norm_name(na) == nt:
            return dup("employee", i, nm)
    if include_candidates:
        for i, nm, na in s.execute(select(M.Candidate.id, M.Candidate.name, M.Candidate.nationality)):
            if i != exclude_cand and norm_name(nm) == n and norm_name(na) == nt:
                return dup("candidate", i, nm)
    return None


# ---------------------------------------------------------------------------
# الموظفين
# ---------------------------------------------------------------------------
TRACKED_DATE_LABELS = {
    "residencyExp": "الإقامة", "workPermitExp": "إذن العمل", "passportExp": "الجواز",
    "healthCardExp": "البطاقة الصحية", "drivingLicenseExp": "رخصة القيادة",
}
DIFF_LABELS = {"name": "الاسم", "salary": "الراتب", "profession": "المهنة", "employmentStatus": "الحالة الوظيفية",
               "govStage": "مرحلة المعاملة", "costCenter": "مركز التكلفة", **TRACKED_DATE_LABELS}


@app.post("/api/employees")
@write_required
def create_employee():
    return save_employee(None)


@app.put("/api/employees/<emp_id>")
@write_required
def update_employee(emp_id):
    return save_employee(emp_id)


def save_employee(orig_id):
    data = body()
    force = bool(data.pop("force", False))
    new_id = str(data.get("id") or "").strip()
    data["id"] = new_id
    if not re.fullmatch(r"\d{6,14}", new_id):
        return err("الرقم المدني مطلوب (أرقام فقط)")
    if not (data.get("name") or "").strip():
        return err("الاسم مطلوب")
    user = uname()
    try:
        with db.session_scope() as s:
            d = find_duplicate_civil_id(s, new_id, exclude_emp=orig_id)
            if d:
                return err(f"الرقم المدني مسجّل بالفعل لـ {d['name']}", 409, block=True, dup=d)
            d = find_duplicate_passport(s, data.get("passportNo"), exclude_emp=orig_id)
            if d:
                return err(f"رقم الجواز مسجّل بالفعل لـ {d['name']}", 409, block=True, dup=d)
            if not force and not orig_id:
                d = find_duplicate_name_nat(s, data.get("name"), data.get("nationality"), include_candidates=False)
                if d:
                    return err(f"يوجد موظف بنفس الاسم والجنسية: {d['name']} ({d['id']})", 409, warn=True, dup=d)
            affs = data.pop("affiliations", None)
            data["lastUpdated"] = db.now()
            data["lastUpdatedBy"] = user
            if orig_id:
                e = s.get(M.Employee, orig_id)
                if not e:
                    return err("الموظف غير موجود", 404)
                if new_id != orig_id:
                    db.rename_employee(s, orig_id, new_id)
                    e = s.get(M.Employee, new_id)
                old = db.to_dict(e)
                db.apply(e, data)
                new = db.to_dict(e)
                changes = [f"{lab}: {old.get(k) or '—'} ← {new.get(k) or '—'}"
                           for k, lab in DIFF_LABELS.items() if k in data and old.get(k) != new.get(k)]
                db.log_audit(s, "employee_edit", f"تعديل موظف: {e.name} ({new_id})"
                             + (" — " + "، ".join(changes) if changes else ""), user)
                for ch in changes:
                    db.push_timeline(s, new_id, "edit", ch, user)
                for k, lab in TRACKED_DATE_LABELS.items():
                    if new.get(k) and old.get(k) and new[k] > old[k]:
                        db.push_timeline(s, new_id, "renew", f"تجديد {lab} حتى {new[k]}", user)
                        cid = (affs[0].get("companyId") if affs else None)
                        if k == "residencyExp" and cid:
                            db.log_company_history(s, cid, "residency_renewed", f"تجديد إقامة {e.name} حتى {new[k]}", user)
            else:
                data.setdefault("employmentStatus", "active")
                s.add(db.build(M.Employee, data))
                s.flush()
                db.log_audit(s, "employee_add", f"إضافة موظف: {data.get('name')} ({new_id})", user)
                db.push_timeline(s, new_id, "create", "إنشاء سجل الموظف", user)
            if affs is not None:
                db.set_affiliations(s, new_id, affs)
            s.flush()
            return jsonify({"ok": True, "employee": db.employee_full(s, new_id)})
    except IntegrityError as e:
        return err(f"تعارض في البيانات: {e.orig}", 409)


@app.delete("/api/employees/<emp_id>")
@write_required
def delete_employee(emp_id):
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if not e:
            return err("غير موجود", 404)
        s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.employeeId == emp_id).delete()
        s.query(M.Vehicle).filter(M.Vehicle.driverId == emp_id).update({"driverId": None})
        db.log_audit(s, "employee_delete", f"حذف موظف: {e.name} ({emp_id})", uname())
        s.delete(e)
    return jsonify({"ok": True})


@app.post("/api/employees/bulk-assign")
@write_required
def bulk_assign():
    d = body()
    ids = d.get("ids") or []
    comp, proj, cc = d.get("companyId") or None, d.get("projectId") or None, d.get("costCenter")
    user = uname()
    with db.session_scope() as s:
        for eid in ids:
            e = s.get(M.Employee, eid)
            if not e:
                continue
            if comp or proj:
                affs = db.get_affiliations(s, eid)
                new = {"companyId": comp, "projectId": proj}
                affs = affs + [new] if d.get("mode") == "add" else [new] + affs[1:]
                db.set_affiliations(s, eid, affs)
            if cc is not None:
                e.costCenter = cc or None
            e.lastUpdated, e.lastUpdatedBy = db.now(), user
            db.push_timeline(s, eid, "assign", "تعيين جماعي لشركة/مشروع/مركز تكلفة", user)
        db.log_audit(s, "employee_edit", f"تعيين جماعي لـ {len(ids)} موظف", user)
    return jsonify({"ok": True, "count": len(ids)})


@app.post("/api/employees/renew")
@write_required
def renew_employees():
    """تجديد سريع أو جماعي: {ids:[], field:'residencyExp', date:'YYYY-MM-DD', setRenewedStage:bool}"""
    d = body()
    field, new_date = d.get("field"), db.parse_date(d.get("date"))
    if field not in TRACKED_DATE_LABELS or not new_date:
        return err("حقل أو تاريخ غير صالح")
    lab, user, n = TRACKED_DATE_LABELS[field], uname(), 0
    with db.session_scope() as s:
        for eid in d.get("ids") or []:
            e = s.get(M.Employee, eid)
            if not e:
                continue
            old = db.ser(getattr(e, field))
            setattr(e, field, new_date)
            e.lastUpdated, e.lastUpdatedBy = db.now(), user
            if d.get("setRenewedStage"):
                e.govStage, e.govStageNote = "renewed", None
            db.push_timeline(s, eid, "renew", f"تجديد {lab}: {old or '—'} ← {new_date.isoformat()}", user)
            affs = db.get_affiliations(s, eid)
            if field == "residencyExp" and affs and affs[0].get("companyId"):
                db.log_company_history(s, affs[0]["companyId"], "residency_renewed",
                                       f"تجديد إقامة {e.name} حتى {new_date.isoformat()}", user)
            n += 1
        db.log_audit(s, "employee_edit", f"تجديد {lab} لـ {n} موظف حتى {new_date.isoformat()}", user)
    return jsonify({"ok": True, "count": n})


@app.post("/api/employees/<emp_id>/gov-stage")
@write_required
def set_gov_stage(emp_id):
    d = body()
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if not e:
            return err("غير موجود", 404)
        db.apply(e, {k: d.get(k) for k in ("govStage", "govStageNote", "govStageResponsible", "govStageStartDate",
                                           "govTransactionCost") if k in d})
        e.lastUpdated, e.lastUpdatedBy = db.now(), uname()
        db.push_timeline(s, emp_id, "gov_stage", f"مرحلة المعاملة: {d.get('govStage') or '—'}"
                         + (f" — {d.get('govStageNote')}" if d.get("govStageNote") else ""), uname())
        db.log_audit(s, "employee_edit", f"تحديث مرحلة معاملة {e.name} ({emp_id})", uname())
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
    try:
        with db.session_scope() as s:
            stats = importer.import_file(s, path, uname())
            db.log_audit(s, "employee_add",
                         f"استيراد ملف {f.filename}: {stats['added']} جديد، {stats['updated']} تحديث", uname())
    except Exception as e:
        return err(f"خطأ في قراءة الملف: {e}")
    return jsonify({"ok": True, **stats})


# مرفقات الموظف (بديل Google Drive)
@app.get("/api/employees/<emp_id>/files")
@login_required
def list_emp_files(emp_id):
    with db.session_scope(commit=False) as s:
        rows = s.scalars(select(M.EmployeeFile).where(M.EmployeeFile.employeeId == emp_id)
                         .order_by(M.EmployeeFile.uploadedAt.desc())).all()
        return jsonify([{"id": r.id, "name": r.name, "size": r.size, "uploaded_at": db.ser(r.uploadedAt),
                         "uploaded_by": r.uploadedBy} for r in rows])


@app.post("/api/employees/<emp_id>/files")
@write_required
def upload_emp_file(emp_id):
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    folder = os.path.join(UPLOADS, "employees", emp_id)
    os.makedirs(folder, exist_ok=True)
    fid = db.new_id("f")
    path = os.path.join(folder, fid + "_" + (secure_filename(f.filename) or "file"))
    f.save(path)
    with db.session_scope() as s:
        s.add(M.EmployeeFile(id=fid, employeeId=emp_id, name=f.filename, path=os.path.relpath(path, BASE_DIR),
                             size=os.path.getsize(path), uploadedAt=db.now(), uploadedBy=uname()))
        db.push_timeline(s, emp_id, "file", f"رفع مرفق: {f.filename}", uname())
    return jsonify({"ok": True, "id": fid})


@app.delete("/api/files/<fid>")
@write_required
def delete_emp_file(fid):
    with db.session_scope() as s:
        r = s.get(M.EmployeeFile, fid)
        if r:
            try:
                os.remove(os.path.join(BASE_DIR, r.path))
            except OSError:
                pass
            db.push_timeline(s, r.employeeId, "file", f"حذف مرفق: {r.name}", uname())
            s.delete(r)
    return jsonify({"ok": True})


@app.get("/files/emp/<fid>")
@login_required
def get_emp_file(fid):
    with db.session_scope(commit=False) as s:
        r = s.get(M.EmployeeFile, fid)
    if not r:
        abort(404)
    return send_file(os.path.join(BASE_DIR, r.path), download_name=r.name,
                     as_attachment=request.args.get("dl") == "1")


# ---------------------------------------------------------------------------
# الشركات والمشاريع والمفوّضين
# ---------------------------------------------------------------------------
@app.post("/api/companies")
@write_required
def create_company():
    d = body()
    if not (d.get("nameAr") or "").strip():
        return err("اسم الشركة مطلوب")
    d["id"] = db.new_id("co")
    with db.session_scope() as s:
        s.add(db.build(M.Company, d))
        db.log_company_history(s, d["id"], "company_created", f"إنشاء الشركة: {d['nameAr']}", uname())
        db.log_audit(s, "company_add", f"إضافة شركة: {d['nameAr']}", uname())
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/companies/<cid>")
@write_required
def update_company(cid):
    d, u = body(), uname()
    with db.session_scope() as s:
        c = s.get(M.Company, cid)
        if not c:
            return err("غير موجود", 404)
        old = db.to_dict(c)
        db.apply(c, d)
        new = db.to_dict(c)
        for key, typ, lab in (("commercialLicenseExpiry", "license_renewed", "تجديد الرخصة التجارية حتى"),
                              ("trafficAuthExpiry", "traffic_auth", "تفويض المرور حتى"),
                              ("civilAffairsAuthExpiry", "civil_affairs_auth", "تفويض الشؤون المدنية حتى")):
            if key in d and new.get(key) and new[key] != old.get(key):
                db.log_company_history(s, cid, typ, f"{lab} {new[key]}", u)
        db.log_audit(s, "company_edit", f"تعديل شركة: {c.nameAr}", u)
    return jsonify({"ok": True})


@app.delete("/api/companies/<cid>")
@write_required
def delete_company(cid):
    with db.session_scope() as s:
        c = s.get(M.Company, cid)
        if not c:
            return err("غير موجود", 404)
        n = s.scalar(select(func.count()).select_from(M.EmployeeAffiliation).where(M.EmployeeAffiliation.companyId == cid))
        if n:
            return err(f"لا يمكن حذف الشركة: مرتبط بها {n} موظف. انقلهم أولًا.")
        for model in (M.Project, M.Signatory, M.CompanyDoc):
            s.query(model).filter(model.companyId == cid).delete()
        db.log_audit(s, "company_delete", f"حذف شركة: {c.nameAr}", uname())
        s.delete(c)
    return jsonify({"ok": True})


DOC_KINDS = ("trafficAuth", "civilAffairs", "commercialLicense")


@app.post("/api/companies/<cid>/docs/<kind>")
@write_required
def upload_company_doc(cid, kind):
    if kind not in DOC_KINDS and kind != "logo":
        return err("نوع مستند غير معروف")
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    folder = os.path.join(UPLOADS, "logos" if kind == "logo" else "companies")
    path = os.path.join(folder, f"{cid}_{kind}{os.path.splitext(f.filename)[1].lower()}")
    f.save(path)
    rel = os.path.relpath(path, BASE_DIR)
    with db.session_scope() as s:
        if kind == "logo":
            c = s.get(M.Company, cid)
            if c:
                c.logoPath = rel
        else:
            s.merge(M.CompanyDoc(companyId=cid, kind=kind, name=f.filename, path=rel, uploadedAt=db.now()))
    return jsonify({"ok": True})


@app.delete("/api/companies/<cid>/docs/<kind>")
@write_required
def delete_company_doc(cid, kind):
    with db.session_scope() as s:
        d = s.get(M.CompanyDoc, (cid, kind))
        if d:
            s.delete(d)
    return jsonify({"ok": True})


@app.get("/files/company/<cid>/<kind>")
@login_required
def get_company_doc(cid, kind):
    with db.session_scope(commit=False) as s:
        r = s.get(M.CompanyDoc, (cid, kind))
    if not r or not r.path:
        abort(404)
    return send_file(os.path.join(BASE_DIR, r.path), download_name=r.name)


@app.get("/files/logo/<cid>")
@login_required
def get_logo(cid):
    with db.session_scope(commit=False) as s:
        c = s.get(M.Company, cid)
    if not c or not c.logoPath:
        abort(404)
    return send_file(os.path.join(BASE_DIR, c.logoPath))


@app.post("/api/signatories")
@write_required
def create_signatory():
    d = body()
    if not d.get("companyId") or not (d.get("nameAr") or "").strip():
        return err("الشركة والاسم مطلوبين")
    d["id"] = db.new_id("sig")
    with db.session_scope() as s:
        s.add(db.build(M.Signatory, d))
        db.log_company_history(s, d["companyId"], "signatory_added", f"إضافة مفوّض بالتوقيع: {d['nameAr']}", uname())
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/signatories/<sid>")
@write_required
def update_signatory(sid):
    with db.session_scope() as s:
        x = s.get(M.Signatory, sid)
        if not x:
            return err("غير موجود", 404)
        db.apply(x, body())
    return jsonify({"ok": True})


@app.delete("/api/signatories/<sid>")
@write_required
def delete_signatory(sid):
    with db.session_scope() as s:
        x = s.get(M.Signatory, sid)
        if x:
            s.delete(x)
    return jsonify({"ok": True})


@app.post("/api/signatory-docs/<civil_id>")
@write_required
def upload_signatory_doc(civil_id):
    """صورة البطاقة المدنية للمفوّض: تُحفظ مرة واحدة لكل شخص (مفتاحها الرقم المدني)."""
    f = request.files.get("file")
    with db.session_scope() as s:
        doc = s.get(M.SignatoryDoc, civil_id) or M.SignatoryDoc(civilId=civil_id)
        if f and f.filename:
            path = os.path.join(UPLOADS, "signatories", f"{civil_id}{os.path.splitext(f.filename)[1].lower()}")
            f.save(path)
            doc.name, doc.path = f.filename, os.path.relpath(path, BASE_DIR)
        doc.expiryDate = db.parse_date(request.form.get("expiryDate"))
        doc.uploadedAt = db.now()
        s.merge(doc)
    return jsonify({"ok": True})


@app.get("/files/signatory/<civil_id>")
@login_required
def get_signatory_doc(civil_id):
    with db.session_scope(commit=False) as s:
        r = s.get(M.SignatoryDoc, civil_id)
    if not r or not r.path:
        abort(404)
    return send_file(os.path.join(BASE_DIR, r.path), download_name=r.name)


@app.post("/api/projects")
@write_required
def create_project():
    d = body()
    if not d.get("companyId") or not (d.get("nameAr") or "").strip():
        return err("الشركة واسم المشروع مطلوبين")
    d["id"] = db.new_id("pr")
    with db.session_scope() as s:
        s.add(db.build(M.Project, d))
        db.log_company_history(s, d["companyId"], "project_added", f"إضافة مشروع: {d['nameAr']}", uname())
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/projects/<pid>")
@write_required
def update_project(pid):
    d = body()
    with db.session_scope() as s:
        p = s.get(M.Project, pid)
        if not p:
            return err("غير موجود", 404)
        old_exp = db.ser(p.expiryDate)
        db.apply(p, d)
        if p.expiryDate and db.ser(p.expiryDate) != old_exp:
            db.log_company_history(s, p.companyId, "project_renewed",
                                   f"تجديد مشروع {p.nameAr} حتى {db.ser(p.expiryDate)}", uname())
    return jsonify({"ok": True})


@app.delete("/api/projects/<pid>")
@write_required
def delete_project(pid):
    with db.session_scope() as s:
        s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.projectId == pid).update({"projectId": None})
        p = s.get(M.Project, pid)
        if p:
            s.delete(p)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# السيارات ومراكز التكلفة
# ---------------------------------------------------------------------------
@app.post("/api/vehicles")
@app.put("/api/vehicles/<vid>")
@write_required
def save_vehicle(vid=None):
    d = body()
    plate = (d.get("plate") or "").strip()
    if not plate:
        return err("رقم اللوحة مطلوب")
    with db.session_scope() as s:
        if s.scalar(select(M.Vehicle).where(M.Vehicle.plate == plate, M.Vehicle.id != (vid or ""))):
            return err(f"رقم اللوحة {plate} مسجّل بالفعل", 409, block=True)
        if vid:
            v = s.get(M.Vehicle, vid)
            if not v:
                return err("غير موجود", 404)
            db.apply(v, d)
            db.log_audit(s, "vehicle_edit", f"تعديل سيارة: {plate}", uname())
        else:
            d["id"] = vid = db.new_id("veh")
            s.add(db.build(M.Vehicle, d))
            db.log_audit(s, "vehicle_add", f"إضافة سيارة: {plate}", uname())
    return jsonify({"ok": True, "id": vid})


@app.delete("/api/vehicles/<vid>")
@write_required
def delete_vehicle(vid):
    with db.session_scope() as s:
        v = s.get(M.Vehicle, vid)
        if v:
            db.log_audit(s, "vehicle_delete", f"حذف سيارة: {v.plate}", uname())
            s.delete(v)
    return jsonify({"ok": True})


@app.post("/api/cost-centers")
@app.put("/api/cost-centers/<ccid>")
@write_required
def save_cost_center(ccid=None):
    d = body()
    name = (d.get("name") or "").strip()
    if not name:
        return err("الاسم مطلوب")
    with db.session_scope() as s:
        if s.scalar(select(M.CostCenter).where(M.CostCenter.name == name, M.CostCenter.id != (ccid or ""))):
            return err("مركز التكلفة موجود بالفعل", 409)
        if ccid:
            c = s.get(M.CostCenter, ccid)
            if not c:
                return err("غير موجود", 404)
            old_name = c.name
            db.apply(c, d)
            if old_name != c.name:   # الربط بالاسم ← نحدّث الموظفين والمترشّحين
                s.query(M.Employee).filter(M.Employee.costCenter == old_name).update({"costCenter": c.name})
                s.query(M.Candidate).filter(M.Candidate.costCenter == old_name).update({"costCenter": c.name})
        else:
            d["id"] = db.new_id("cc")
            s.add(db.build(M.CostCenter, d))
    return jsonify({"ok": True})


@app.delete("/api/cost-centers/<ccid>")
@write_required
def delete_cost_center(ccid):
    with db.session_scope() as s:
        c = s.get(M.CostCenter, ccid)
        if c:
            n = s.scalar(select(func.count()).select_from(M.Employee).where(M.Employee.costCenter == c.name))
            if n:
                return err(f"لا يمكن الحذف: مرتبط بـ {n} موظف")
            s.delete(c)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# الاستقدام والتوظيف
# ---------------------------------------------------------------------------
@app.post("/api/candidates")
@app.put("/api/candidates/<cand_id>")
@write_required
def save_candidate(cand_id=None):
    d = body()
    if not (d.get("name") or "").strip():
        return err("الاسم مطلوب")
    with db.session_scope() as s:
        x = find_duplicate_civil_id(s, (d.get("civilId") or "").strip(), exclude_cand=cand_id)
        if x:
            return err(f"الرقم المدني مسجّل بالفعل لـ {x['name']}", 409, block=True)
        x = find_duplicate_passport(s, d.get("passportNo"), exclude_cand=cand_id)
        if x:
            return err(f"رقم الجواز مسجّل بالفعل لـ {x['name']}", 409, block=True)
        if not cand_id:
            x = find_duplicate_name_nat(s, d.get("name"), d.get("nationality"))
            if x:
                return err(f"يوجد {'موظف' if x['where'] == 'employee' else 'مترشّح'} بنفس الاسم والجنسية: {x['name']}",
                           409, block=True)
        if d.get("stage") == "all_completed" and not (d.get("civilId") or "").strip():
            return err("لا يمكن اختيار «تم إنجاز جميع الإجراءات» قبل تسجيل الرقم المدني")
        if cand_id:
            c = s.get(M.Candidate, cand_id)
            if not c:
                return err("غير موجود", 404)
            db.apply(c, d)
            db.log_audit(s, "candidate_edit", f"تعديل مترشّح: {d['name']}", uname())
        else:
            d["id"] = cand_id = db.new_id("cand")
            d.setdefault("appliedDate", datetime.now().strftime("%Y-%m-%d"))
            s.add(db.build(M.Candidate, d))
            db.log_audit(s, "candidate_add", f"إضافة مترشّح: {d['name']}", uname())
    return jsonify({"ok": True, "id": cand_id})


@app.delete("/api/candidates/<cand_id>")
@write_required
def delete_candidate(cand_id):
    with db.session_scope() as s:
        c = s.get(M.Candidate, cand_id)
        if c:
            s.delete(c)
    return jsonify({"ok": True})


@app.post("/api/candidates/<cand_id>/convert")
@write_required
def convert_candidate(cand_id):
    """القسم 8.1: تحويل المترشّح إلى موظف بحالة «قيد الاستكمال»."""
    with db.session_scope() as s:
        c = s.get(M.Candidate, cand_id)
        if not c:
            return err("غير موجود", 404)
        civil = (c.civilId or "").strip()
        if not civil:
            return err("لازم الرقم المدني يكون متسجّل قبل التحويل")
        x = find_duplicate_civil_id(s, civil, exclude_cand=cand_id)
        if x:
            return err(f"الرقم المدني مسجّل بالفعل لـ {x['name']}", 409)
        x = find_duplicate_passport(s, c.passportNo, exclude_cand=cand_id)
        if x:
            return err(f"رقم الجواز مسجّل بالفعل لـ {x['name']}", 409)
        s.add(M.Employee(
            id=civil, name=c.name, nameEn=c.nameEn, nationality=c.nationality,
            nationalityEn=docx_engine.NATIONALITY_EN.get(c.nationality or ""), dateOfBirth=c.dateOfBirth,
            profession=c.profession, phone=c.phone, salary=c.salary, housingIncluded=bool(c.housingAllowance),
            housingAmount=None, passportNo=c.passportNo, passportExp=c.passportExp, costCenter=c.costCenter,
            employmentStatus="pending_completion", dateOfHire=datetime.now().date(),
            lastUpdated=db.now(), lastUpdatedBy=uname()))
        s.flush()
        if c.targetCompanyId:
            db.set_affiliations(s, civil, [{"companyId": c.targetCompanyId, "projectId": None}])
        db.push_timeline(s, civil, "create", "تحويل من مترشّح إلى موظف (قيد الاستكمال)", uname())
        db.log_audit(s, "candidate_convert", f"تحويل المترشّح {c.name} إلى موظف ({civil})", uname())
        s.delete(c)
    return jsonify({"ok": True, "employeeId": civil})


# ---------------------------------------------------------------------------
# قوالب وعقود العمل (Word / PDF)
# ---------------------------------------------------------------------------
def _contract_bundle(args):
    with db.session_scope(commit=False) as s:
        emp = db.employee_full(s, args.get("emp", ""))
        if not emp:
            abort(404, "الموظف غير موجود")
        tpl = s.get(M.Template, args.get("tpl", "")) or \
            s.scalar(select(M.Template).order_by(M.Template.isDefault.desc(), M.Template.createdAt))
        if not tpl:
            abort(404, "لا يوجد قالب")
        aff = (emp.get("affiliations") or [{}])[0]
        company = db.to_dict(s.get(M.Company, args.get("company") or aff.get("companyId") or ""))
        project = db.to_dict(s.get(M.Project, aff.get("projectId") or ""))
        sig = s.get(M.Signatory, args.get("sig", ""))
        if not sig and company:
            sig = s.scalar(select(M.Signatory).where(M.Signatory.companyId == company["id"]))
        sig = db.to_dict(sig)
        tpl_file = tpl.filename
    for k in ("salary", "profession", "professionEn", "nameEn", "nationalityEn"):
        if args.get(k):
            emp[k] = args.get(k)
    ctx = docx_engine.resolve_contract_template(emp, company, sig, project, args.get("date") or None)
    data = docx_engine.fill_docx_template(os.path.join(TEMPLATE_DOCS, tpl_file), ctx)
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
    tid = db.new_id("tpl")
    with db.session_scope() as s:
        s.add(M.Template(id=tid, name=name, filename=fn, isDefault=False, createdAt=db.now()))
    return jsonify({"ok": True, "id": tid, "fields": fields})


@app.post("/api/templates/<tid>/default")
@write_required
def set_default_template(tid):
    with db.session_scope() as s:
        s.query(M.Template).update({"isDefault": False})
        s.query(M.Template).filter(M.Template.id == tid).update({"isDefault": True})
    return jsonify({"ok": True})


@app.delete("/api/templates/<tid>")
@write_required
def delete_template(tid):
    with db.session_scope() as s:
        if s.scalar(select(func.count()).select_from(M.Template)) <= 1:
            return err("لازم يفضل قالب واحد على الأقل")
        t = s.get(M.Template, tid)
        if t:
            s.delete(t)
    return jsonify({"ok": True})


@app.get("/api/templates/<tid>/file")
@login_required
def download_template(tid):
    with db.session_scope(commit=False) as s:
        t = s.get(M.Template, tid)
    if not t:
        abort(404)
    return send_file(os.path.join(TEMPLATE_DOCS, t.filename), as_attachment=True, download_name=t.filename)


# ---------------------------------------------------------------------------
# النسخ الاحتياطي والاستعادة
# ---------------------------------------------------------------------------
@app.get("/api/backup")
@login_required
def backup():
    with db.session_scope() as s:
        out = {"app": "Lunx", "version": APP_VERSION, "createdAt": db.now_iso(), "database": db.engine.dialect.name,
               "tables": db.export_tables(s)}
        db.set_meta(s, "last_backup", db.now_iso())
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
    try:
        with db.session_scope() as s:
            if lunx_restore.is_lunx_state(data):          # نسخة من Lunx (نسخة الملف الواحد)
                stats = lunx_restore.import_lunx_state(s, data, uname())
                return jsonify({"ok": True, **stats})
            tables = data.get("tables") if isinstance(data, dict) else None
            if not isinstance(tables, dict):
                return err("ملف النسخة الاحتياطية غير صالح")
            counts = db.import_tables(s, tables)
            db.log_audit(s, "backup_restore", f"استعادة نسخة احتياطية من {data.get('createdAt', '')}", uname())
            return jsonify({"ok": True, "counts": counts})
    except Exception as e:
        return err(f"فشل الاستعادة: {e}")


# ---------------------------------------------------------------------------
# المستخدمين (للمدير)
# ---------------------------------------------------------------------------
ROLES = ("admin", "editor", "viewer")


@app.get("/api/users")
@admin_required
def list_users():
    with db.session_scope(commit=False) as s:
        return jsonify([{"id": u.id, "username": u.username, "display_name": u.displayName, "role": u.role}
                        for u in s.scalars(select(M.User).order_by(M.User.id))])


@app.post("/api/users")
@admin_required
def create_user():
    d = body()
    if not d.get("username") or not d.get("password") or d.get("role") not in ROLES:
        return err("بيانات ناقصة")
    try:
        with db.session_scope() as s:
            s.add(M.User(username=d["username"].strip(), displayName=d.get("displayName") or d["username"],
                         passwordHash=generate_password_hash(d["password"]), role=d["role"]))
    except IntegrityError:
        return err("اسم المستخدم موجود بالفعل", 409)
    return jsonify({"ok": True})


@app.put("/api/users/<int:uid>")
@admin_required
def update_user(uid):
    d = body()
    with db.session_scope() as s:
        u = s.get(M.User, uid)
        if not u:
            return err("غير موجود", 404)
        if d.get("role") in ROLES:
            u.role = d["role"]
        if d.get("password"):
            u.passwordHash = generate_password_hash(d["password"])
        if d.get("displayName"):
            u.displayName = d["displayName"]
    return jsonify({"ok": True})


@app.delete("/api/users/<int:uid>")
@admin_required
def delete_user(uid):
    if uid == session.get("uid"):
        return err("لا يمكنك حذف حسابك")
    with db.session_scope() as s:
        u = s.get(M.User, uid)
        if u:
            s.delete(u)
    return jsonify({"ok": True})


@app.post("/api/me/password")
@login_required
def change_my_password():
    d = body()
    with db.session_scope() as s:
        u = s.get(M.User, session["uid"])
        if not check_password_hash(u.passwordHash, d.get("old", "")):
            return err("كلمة المرور الحالية غير صحيحة")
        if len(d.get("new", "")) < 6:
            return err("كلمة المرور الجديدة لازم 6 أحرف على الأقل")
        u.passwordHash = generate_password_hash(d["new"])
    return jsonify({"ok": True})


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": getattr(e, "description", "غير موجود")}), 404
    return e


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"Lunx {APP_VERSION} [{db.engine.dialect.name}] → http://localhost:{port}   (admin / admin123)")
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=bool(os.environ.get("DEBUG")))
