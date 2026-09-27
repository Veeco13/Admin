# -*- coding: utf-8 -*-
"""
Lunx — لوحة تحكم الموارد البشرية والعمليات الحكومية
شركة أبراج انرجي ومجموعة شركاتها التابعة

Flask + SQLAlchemy. الواجهة صفحة واحدة (SPA) في static/ ، والـ API هنا.
تشغيل:  python app.py   ثم افتح http://localhost:5050
نوع قاعدة البيانات: متغير البيئة LUNX_DATABASE_URL (الافتراضي SQLite: lunx.db)
"""
import base64
import io
import json
import os
import re
from datetime import datetime
from functools import wraps

from flask import (Flask, jsonify, request, session, send_file, render_template,
                   redirect, url_for, abort, g)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

import db
import contracts
import docx_engine
import history
import importer
import lunx_restore
import models as M
import perms
import residency_form

APP_VERSION = "v353-flask.4"

BASE_DIR = db.BASE_DIR
BUILTIN_TEMPLATES = os.path.join(BASE_DIR, "templates_docs")     # القوالب اللي جاية مع الكود
TEMPLATE_DOCS = db.data_path("templates_docs")                  # القوالب المستخدمة (بتتحفظ مع البيانات)
UPLOADS = db.data_path("uploads")
for sub in ("", "employees", "companies", "signatories", "signatures", "logos", "imports"):
    os.makedirs(os.path.join(UPLOADS, sub), exist_ok=True)
os.makedirs(TEMPLATE_DOCS, exist_ok=True)
RETIRED_TEMPLATES = ("contract_template.docx", "contract_template_v2.docx")
if os.path.abspath(TEMPLATE_DOCS) != os.path.abspath(BUILTIN_TEMPLATES) and os.path.isdir(BUILTIN_TEMPLATES):
    import filecmp
    import shutil
    # القوالب اللي جاية مع الكود بتتحدّث لو اتغيّرت (القوالب المرفوعة من الشاشة ليها أسماء تانية)
    for _fn in os.listdir(BUILTIN_TEMPLATES):
        _dst = os.path.join(TEMPLATE_DOCS, _fn)
        if _fn.endswith(".docx") and (not os.path.exists(_dst)
                                      or not filecmp.cmp(os.path.join(BUILTIN_TEMPLATES, _fn), _dst, shallow=False)):
            shutil.copy2(os.path.join(BUILTIN_TEMPLATES, _fn), TEMPLATE_DOCS)
    for _fn in RETIRED_TEMPLATES:
        if os.path.exists(os.path.join(TEMPLATE_DOCS, _fn)):
            os.remove(os.path.join(TEMPLATE_DOCS, _fn))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("LUNX_MAX_UPLOAD_MB", "25")) * 1024 * 1024
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("LUNX_COOKIE_SECURE", "0") == "1"   # 1 لو وراه HTTPS
app.json.ensure_ascii = False
if os.environ.get("LUNX_BEHIND_PROXY", "0") == "1":        # وراه Nginx / Traefik / Caddy
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


def _secret_key():
    p = db.data_path(".secret_key")
    if not os.path.exists(p):
        open(p, "w").write(os.urandom(32).hex())
    return open(p).read().strip()


app.secret_key = os.environ.get("LUNX_SECRET") or _secret_key()


# ---------------------------------------------------------------------------
# التهيئة
# ---------------------------------------------------------------------------
def bootstrap():
    # في Docker التعديلات بتتطبق مرة واحدة في entrypoint قبل تشغيل الـ workers (LUNX_AUTO_MIGRATE=0)
    if os.environ.get("LUNX_AUTO_MIGRATE", "1") == "1":
        db.init_db()
    with db.session_scope() as s:
        if not s.scalar(select(func.count()).select_from(M.User)):
            s.add(M.User(username="admin", displayName="مدير النظام",
                         passwordHash=generate_password_hash(os.environ.get("LUNX_ADMIN_PASSWORD") or "admin123"),
                         roleId="admin", allCompanies=True, active=True, createdAt=db.now()))
        defaults = [
            ("contract_reference.docx", "عقد عمل — القطاع الأهلي (العقد المرجعي)", True),
        ]
        for fn, name, is_def in defaults:
            if os.path.exists(os.path.join(TEMPLATE_DOCS, fn)) and \
                    not s.scalar(select(M.Template).where(M.Template.filename == fn)):
                if is_def:
                    s.query(M.Template).update({"isDefault": False})
                s.add(M.Template(id=db.new_id("tpl"), name=name, filename=fn, isDefault=is_def, createdAt=db.now()))
        # القوالب الحكومية القديمة اتشالت (العقد المرجعي بقى القالب الوحيد)
        s.query(M.Template).filter(M.Template.filename.in_(RETIRED_TEMPLATES)).delete(synchronize_session=False)
        if not s.scalar(select(M.Template).where(M.Template.isDefault.is_(True))):
            first = s.scalar(select(M.Template).order_by(M.Template.createdAt))
            if first:
                first.isDefault = True


bootstrap()


def body():
    return request.get_json(force=True, silent=True) or {}


def err(msg, code=400, **extra):
    return jsonify({"error": msg, **extra}), code


# ---------------------------------------------------------------------------
# المصادقة والصلاحيات (بديل CAP.user + وضع القراءة فقط)
# ---------------------------------------------------------------------------
def me():
    """المستخدم الحالي بصلاحياته (perms.UserCtx) — بيتحسب مرة واحدة في كل طلب."""
    if "ctx" not in g:
        with db.session_scope(commit=False) as s:
            g.ctx = perms.load_ctx(s, session.get("uid"))
    return g.ctx


def uname():
    u = me()
    return u.display if u else None


def forbidden(msg="العملية دي غير متاحة"):
    return jsonify({"error": msg}), 403


def login_required(f):
    @wraps(f)
    def w(*a, **kw):
        if not me():                       # مش داخل، أو الحساب اتوقف
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login"))
        return f(*a, **kw)
    return w


def require(*keys, all_companies=False):
    """صلاحية (أو أكتر) لازمة للعملية. all_companies=True ← لازم نطاق كل الشركات كمان."""
    def deco(f):
        @wraps(f)
        def w(*a, **kw):
            u = me()
            if not u:
                return jsonify({"error": "unauthorized"}), 401
            if not all(u.can(k) for k in keys):
                return forbidden()
            if all_companies and not u.allCompanies:
                return forbidden()
            return f(*a, **kw)
        return w
    return deco


def admin_required(f):
    @wraps(f)
    def w(*a, **kw):
        u = me()
        if not u or not u.isAdmin:
            return forbidden()
        return f(*a, **kw)
    return w


# --- نطاق الشركات (القيود على السيرفر) ---
OUT_OF_SCOPE = "السجل ده غير متاح"


def emp_ok(s, emp_id):
    """الموظف في نطاق المستخدم: الشركة المسجّل عليها أو الشركة الفعلية (مركز التكلفة)."""
    e = s.get(M.Employee, emp_id)
    return bool(e) and me().affs_ok(db.get_affiliations(s, emp_id), db.cost_center_company(s, e.costCenter), e.costCenter)


LEAVES_SCOPE = "مش هينفع الحفظ بالشكل ده: السجل هيختفي من عندك (لازم يفضل على شركة أو مركز تكلفة من اللي عندك)"
NEW_OUT_OF_SCOPE = "الشركة دي غير متاحة"


def scoped_affs(s, sent, existing, cost_center):
    """انتماءات موظف جاية من مستخدم محدود ← (الانتماءات بعد الدمج، رسالة خطأ أو None).
    - مايضيفش شركة برّه نطاقه.
    - انتماءات الموظف لشركات برّه نطاقه (الشركة المسجّل عليها) بتفضل زي ما هي.
    - الموظف لازم يفضل ظاهر له بعد الحفظ (بالشركة المسجّل عليها أو بمركز التكلفة)."""
    u = me()
    old = {a["companyId"] for a in existing}
    if any(a.get("companyId") and not u.company_ok(a["companyId"]) and a["companyId"] not in old for a in sent or []):
        return None, NEW_OUT_OF_SCOPE
    merged = u.merge_affs(sent, existing)
    if not u.affs_ok(merged, db.cost_center_company(s, cost_center), cost_center):
        return None, LEAVES_SCOPE
    return merged, None


def opt_company_ok(cid):
    """شركة اختيارية (سيارة): من غير شركة = للنطاق الكامل بس."""
    u = me()
    return u.company_ok(cid) if cid else u.allCompanies


def dup_name(d):
    """رسائل التكرار: المستخدم المحدود مايشوفش اسم شخص من شركة تانية."""
    return d["name"] if me().allCompanies else "سجل آخر"


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        with db.session_scope() as s:
            u = s.scalar(select(M.User).where(M.User.username == request.form.get("username", "").strip()))
            if u and check_password_hash(u.passwordHash, request.form.get("password", "")):
                if not u.active:
                    error = "الحساب ده موقوف، كلّم مدير النظام"
                else:
                    u.lastLogin = db.now()
                    session.clear()
                    session["uid"] = u.id
                    session.permanent = True
                    return redirect(url_for("index"))
            else:
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
    try:
        db.auto_backup_if_due()          # نسخة JSON يومية في backups/
    except Exception as e:               # النسخ الاحتياطي ما يوقفش النظام
        app.logger.warning("auto backup failed: %s", e)
    u = me()
    with db.session_scope(commit=False) as s:
        state = db.dump_state(s, u)
    for t in state.get("templates", []):     # خيارات التوقيع بتظهر بس لو القالب فيه مكانها
        path = os.path.join(TEMPLATE_DOCS, t["filename"])
        fields = contracts.template_fields(path) if os.path.exists(path) else set()
        t["signFirst"], t["signSecond"] = "sig_first_party" in fields, "sig_second_party" in fields
    state["me"] = u.to_api()
    state["version"] = APP_VERSION
    state["pdfAvailable"] = bool(contracts.backend())
    state["contractBatchMax"] = contracts.MAX_BATCH
    state["database"] = db.engine.dialect.name
    state["schemaRevision"] = db.current_revision()
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
               "govStage": "مرحلة المعاملة", **TRACKED_DATE_LABELS}     # الشركة ومركز التكلفة ← history.record_moves


@app.post("/api/employees")
@require("employees.edit")
def create_employee():
    return save_employee(None)


@app.put("/api/employees/<emp_id>")
@require("employees.edit")
def update_employee(emp_id):
    return save_employee(emp_id)


def save_employee(orig_id):
    u = me()
    data = u.strip("employee", body())          # الحقول الحساسة الممنوعة مابتتعدّلش (ولا بتتمسح)
    force = bool(data.pop("force", False))
    new_id = str(data.get("id") or "").strip()
    data["id"] = new_id
    if not re.fullmatch(r"\d{6,14}", new_id):
        return err("الرقم المدني مطلوب (أرقام فقط)")
    if not (data.get("name") or "").strip():
        return err("الاسم مطلوب")
    user = uname()
    dup_extra = (lambda d: {"dup": d}) if u.allCompanies else (lambda d: {})
    try:
        with db.session_scope() as s:
            old_e = s.get(M.Employee, orig_id) if orig_id else None
            if orig_id and not old_e:
                return err("الموظف غير موجود", 404)
            if orig_id and not emp_ok(s, orig_id):
                return forbidden(OUT_OF_SCOPE)
            existing = db.get_affiliations(s, orig_id) if orig_id else []
            cc = data["costCenter"] if "costCenter" in data else (old_e.costCenter if old_e else None)
            merged, msg = scoped_affs(s, data["affiliations"] if "affiliations" in data else existing, existing, cc)
            if msg:
                return forbidden(msg)
            if "affiliations" in data or not u.allCompanies:
                data["affiliations"] = merged
            d = find_duplicate_civil_id(s, new_id, exclude_emp=orig_id)
            if d:
                return err(f"الرقم المدني مسجّل بالفعل لـ {dup_name(d)}", 409, block=True, **dup_extra(d))
            if "passportNo" in data:
                d = find_duplicate_passport(s, data.get("passportNo"), exclude_emp=orig_id)
                if d:
                    return err(f"رقم الجواز مسجّل بالفعل لـ {dup_name(d)}", 409, block=True, **dup_extra(d))
            if not force and not orig_id:
                d = find_duplicate_name_nat(s, data.get("name"), data.get("nationality"), include_candidates=False)
                if d:
                    return err(f"يوجد موظف بنفس الاسم والجنسية: {dup_name(d)}"
                               + (f" ({d['id']})" if u.allCompanies else ""), 409, warn=True, **dup_extra(d))
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
                changes = [f"{lab}: {history.value_label(k, old.get(k)) or '—'} ← {history.value_label(k, new.get(k)) or '—'}"
                           for k, lab in DIFF_LABELS.items() if k in data and old.get(k) != new.get(k)]
                for ch in changes:
                    db.push_timeline(s, new_id, "edit", ch, user)
                if affs is not None:
                    db.set_affiliations(s, new_id, affs)
                moves = history.record_moves(s, new_id, e.name, existing, affs if affs is not None else existing,
                                             old.get("costCenter"), new.get("costCenter"), user)
                db.log_audit(s, "employee_edit", f"تعديل موظف: {e.name} ({new_id})"
                             + (" — " + "، ".join(changes + moves) if changes or moves else ""), user)
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
                if affs is not None:
                    db.set_affiliations(s, new_id, affs)
                state = history.current_state_text(s, db.get_affiliations(s, new_id), data.get("costCenter"))
                db.log_audit(s, "employee_add", f"إضافة موظف: {data.get('name')} ({new_id}) — {state}", user)
                db.push_timeline(s, new_id, "create", f"إنشاء سجل الموظف — {state}", user)
                for a in db.get_affiliations(s, new_id):
                    if a.get("companyId"):
                        db.log_company_history(s, a["companyId"], "employee_joined",
                                               f"انضمام الموظف {data.get('name')} ({new_id}) — موظف جديد", user)
            s.flush()
            return jsonify({"ok": True, "employee": u.strip("employee", db.employee_full(s, new_id))})
    except IntegrityError as e:
        return err(f"تعارض في البيانات: {e.orig}", 409)


@app.delete("/api/employees/<emp_id>")
@require("employees.delete")
def delete_employee(emp_id):
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if not e:
            return err("غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.employeeId == emp_id).delete()
        s.query(M.Vehicle).filter(M.Vehicle.driverId == emp_id).update({"driverId": None})
        s.flush()
        db.log_audit(s, "employee_delete", f"حذف موظف: {e.name} ({emp_id})", uname())
        s.delete(e)
    return jsonify({"ok": True})


@app.post("/api/employees/bulk-assign")
@require("employees.edit")
def bulk_assign():
    d = body()
    ids = d.get("ids") or []
    comp, proj, cc = d.get("companyId") or None, d.get("projectId") or None, d.get("costCenter")
    user = uname()
    with db.session_scope() as s:
        if proj and not comp:
            p = s.get(M.Project, proj)
            comp_chk = p.companyId if p else None
        else:
            comp_chk = comp
        if (comp or proj) and not me().company_ok(comp_chk):
            return forbidden(NEW_OUT_OF_SCOPE)
        ids = [i for i in ids if emp_ok(s, i)]              # الموظفين خارج النطاق بيتجاهلوا
        for eid in ids:
            e = s.get(M.Employee, eid)
            if not e:
                continue
            existing = db.get_affiliations(s, eid)
            affs = existing
            if comp or proj:
                new = {"companyId": comp, "projectId": proj}
                affs = existing + [new] if d.get("mode") == "add" else [new] + existing[1:]
            new_cc = (cc or None) if cc is not None else e.costCenter
            affs, msg = scoped_affs(s, affs, existing, new_cc)
            if msg:
                s.rollback()
                return forbidden(f"{e.name}: {msg}")
            old_cc = e.costCenter
            if comp or proj:
                db.set_affiliations(s, eid, affs)
            if cc is not None:
                e.costCenter = cc or None
            e.lastUpdated, e.lastUpdatedBy = db.now(), user
            history.record_moves(s, eid, e.name, existing, affs if (comp or proj) else existing, old_cc, e.costCenter,
                                 user, "تعيين جماعي")
        what = "، ".join(x for x in (history.aff_text(s, {"companyId": comp or comp_chk, "projectId": proj}) if (comp or proj) else "",
                                     f"مركز التكلفة «{cc or '—'}»" if cc is not None else "") if x)
        db.log_audit(s, "employee_edit", f"تعيين جماعي لـ {len(ids)} موظف — {what}", user)
    return jsonify({"ok": True, "count": len(ids)})


@app.post("/api/employees/renew")
@require("employees.edit")
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
            if not e or not emp_ok(s, eid):
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
@require("employees.edit")
def set_gov_stage(emp_id):
    d = me().strip("employee", body())         # تكلفة المعاملة من البيانات الحساسة
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if not e:
            return err("غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        db.apply(e, {k: d.get(k) for k in ("govStage", "govStageNote", "govStageResponsible", "govStageStartDate",
                                           "govTransactionCost") if k in d})
        e.lastUpdated, e.lastUpdatedBy = db.now(), uname()
        db.push_timeline(s, emp_id, "gov_stage", f"مرحلة المعاملة: {history.value_label('govStage', d.get('govStage')) or '—'}"
                         + (f" — {d.get('govStageNote')}" if d.get("govStageNote") else ""), uname())
        db.log_audit(s, "employee_edit", f"تحديث مرحلة معاملة {e.name} ({emp_id})", uname())
    return jsonify({"ok": True})


@app.post("/api/employees/import")
@require("employees.edit", "system.import", "sensitive.salary", "sensitive.bank", "sensitive.documents",
         all_companies=True)   # الملف بيكتب كل الحقول ولأي شركة
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


# نموذج الإقامة الجديد 2018 (residency_form.py) — PDF متعبّي والخانات قابلة للتعديل قبل الطباعة
@app.get("/api/employees/<emp_id>/residency-form")
@require("employees.view", "sensitive.documents")
def employee_residency_form(emp_id):
    action = request.args.get("action") or "تجديد"
    if action not in residency_form.ACTIONS:
        return err("نوع الإجراء غير معروف")
    with db.session_scope() as s:
        emp = db.employee_full(s, emp_id)
        if not emp:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        if not residency_form.needs_residency(emp.get("nationality")):
            return err("المواطنين الكويتيين ومواطني الخليج مالهمش إقامة")
        cid = next((a["companyId"] for a in emp.get("affiliations") or [] if a.get("companyId")), None)
        company = db.to_dict(s.get(M.Company, cid)) if cid else None
        data = residency_form.fill(emp, company, action)
        db.log_audit(s, "employee_residency_form", f"نموذج إقامة ({action}) للموظف: {emp['name']} ({emp_id})", uname())
    return send_file(io.BytesIO(data), as_attachment=False, download_name=f"نموذج إقامة - {emp['name']}.pdf",
                     mimetype="application/pdf")


# مرفقات الموظف (بديل Google Drive)
@app.get("/api/employees/<emp_id>/files")
@require("employees.view", "sensitive.documents")
def list_emp_files(emp_id):
    with db.session_scope(commit=False) as s:
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        rows = s.scalars(select(M.EmployeeFile).where(M.EmployeeFile.employeeId == emp_id)
                         .order_by(M.EmployeeFile.uploadedAt.desc())).all()
        return jsonify([{"id": r.id, "name": r.name, "size": r.size, "uploaded_at": db.ser(r.uploadedAt),
                         "uploaded_by": r.uploadedBy} for r in rows])


@app.post("/api/employees/<emp_id>/files")
@require("employees.edit", "sensitive.documents")
def upload_emp_file(emp_id):
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    with db.session_scope(commit=False) as s:
        if not s.get(M.Employee, emp_id):
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
    folder = os.path.join(UPLOADS, "employees", emp_id)
    os.makedirs(folder, exist_ok=True)
    fid = db.new_id("f")
    path = os.path.join(folder, fid + "_" + (secure_filename(f.filename) or "file"))
    f.save(path)
    with db.session_scope() as s:
        s.add(M.EmployeeFile(id=fid, employeeId=emp_id, name=f.filename, path=db.rel_file(path),
                             size=os.path.getsize(path), uploadedAt=db.now(), uploadedBy=uname()))
        db.push_timeline(s, emp_id, "file", f"رفع مرفق: {f.filename}", uname())
    return jsonify({"ok": True, "id": fid})


@app.delete("/api/files/<fid>")
@require("employees.edit", "sensitive.documents")
def delete_emp_file(fid):
    with db.session_scope() as s:
        r = s.get(M.EmployeeFile, fid)
        if r and not emp_ok(s, r.employeeId):
            return forbidden(OUT_OF_SCOPE)
        if r:
            try:
                os.remove(db.resolve_file(r.path))
            except OSError:
                pass
            db.push_timeline(s, r.employeeId, "file", f"حذف مرفق: {r.name}", uname())
            s.delete(r)
    return jsonify({"ok": True})


@app.get("/files/emp/<fid>")
@require("employees.view", "sensitive.documents")
def get_emp_file(fid):
    with db.session_scope(commit=False) as s:
        r = s.get(M.EmployeeFile, fid)
        if r and not emp_ok(s, r.employeeId):
            abort(403)
    if not r:
        abort(404)
    return send_file(db.resolve_file(r.path), download_name=r.name,
                     as_attachment=request.args.get("dl") == "1")


# ---------------------------------------------------------------------------
# الشركات والمشاريع والمفوّضين
# ---------------------------------------------------------------------------
@app.post("/api/companies")
@require("companies.edit", all_companies=True)     # المستخدم المحدود مش هيشوف الشركة الجديدة أصلًا
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
@require("companies.edit")
def update_company(cid):
    if not me().company_ok(cid):
        return forbidden(OUT_OF_SCOPE)
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
@require("companies.delete", all_companies=True)
def delete_company(cid):
    with db.session_scope() as s:
        c = s.get(M.Company, cid)
        if not c:
            return err("غير موجود", 404)
        n = s.scalar(select(func.count()).select_from(M.EmployeeAffiliation).where(M.EmployeeAffiliation.companyId == cid))
        if n:
            return err(f"لا يمكن حذف الشركة: مرتبط بها {n} موظف. انقلهم أولًا.")
        # فك الارتباطات بالترتيب (المفاتيح الأجنبية NO ACTION)
        s.query(M.Vehicle).filter(M.Vehicle.companyId == cid).update({"companyId": None})
        s.query(M.Candidate).filter(M.Candidate.targetCompanyId == cid).update({"targetCompanyId": None})
        s.query(M.CostCenter).filter(M.CostCenter.companyId == cid).update({"companyId": None})
        pids = [p.id for p in s.scalars(select(M.Project).where(M.Project.companyId == cid))]
        if pids:
            s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.projectId.in_(pids)) \
                .update({"projectId": None}, synchronize_session=False)
        for model in (M.Project, M.Signatory, M.CompanyDoc, M.UserCompany):
            s.query(model).filter(model.companyId == cid).delete()
        s.flush()
        db.log_audit(s, "company_delete", f"حذف شركة: {c.nameAr}", uname())
        s.delete(c)
    return jsonify({"ok": True})


DOC_KINDS = ("trafficAuth", "civilAffairs", "commercialLicense")


@app.post("/api/companies/<cid>/docs/<kind>")
@require("companies.edit")
def upload_company_doc(cid, kind):
    if kind not in DOC_KINDS and kind != "logo":
        return err("نوع مستند غير معروف")
    if not me().company_ok(cid):
        return forbidden(OUT_OF_SCOPE)
    with db.session_scope(commit=False) as s:
        if not s.get(M.Company, cid):
            return err("غير موجود", 404)
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    folder = os.path.join(UPLOADS, "logos" if kind == "logo" else "companies")
    path = os.path.join(folder, f"{cid}_{kind}{os.path.splitext(f.filename)[1].lower()}")
    f.save(path)
    rel = db.rel_file(path)
    with db.session_scope() as s:
        if kind == "logo":
            c = s.get(M.Company, cid)
            if c:
                c.logoPath = rel
        else:
            s.merge(M.CompanyDoc(companyId=cid, kind=kind, name=f.filename, path=rel, uploadedAt=db.now()))
    return jsonify({"ok": True})


@app.delete("/api/companies/<cid>/docs/<kind>")
@require("companies.edit")
def delete_company_doc(cid, kind):
    if not me().company_ok(cid):
        return forbidden(OUT_OF_SCOPE)
    with db.session_scope() as s:
        d = s.get(M.CompanyDoc, (cid, kind))
        if d:
            s.delete(d)
    return jsonify({"ok": True})


@app.get("/files/company/<cid>/<kind>")
@require("companies.view")
def get_company_doc(cid, kind):
    if not me().company_ok(cid):
        abort(403)
    with db.session_scope(commit=False) as s:
        r = s.get(M.CompanyDoc, (cid, kind))
    if not r or not r.path:
        abort(404)
    return send_file(db.resolve_file(r.path), download_name=r.name)


@app.get("/files/logo/<cid>")
@login_required
def get_logo(cid):
    with db.session_scope(commit=False) as s:
        c = s.get(M.Company, cid)
    if not c or not c.logoPath:
        abort(404)
    return send_file(db.resolve_file(c.logoPath))


def _sig_ok(s, sid, new_company=None):
    x = s.get(M.Signatory, sid) if sid else None
    return (not x or me().company_ok(x.companyId)) and (not new_company or me().company_ok(new_company))


@app.post("/api/signatories")
@require("companies.edit")
def create_signatory():
    d = body()
    if not d.get("companyId") or not (d.get("nameAr") or "").strip():
        return err("الشركة والاسم مطلوبين")
    if not me().company_ok(d["companyId"]):
        return forbidden(OUT_OF_SCOPE)
    d["id"] = db.new_id("sig")
    with db.session_scope() as s:
        s.add(db.build(M.Signatory, d))
        db.log_company_history(s, d["companyId"], "signatory_added", f"إضافة مفوّض بالتوقيع: {d['nameAr']}", uname())
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/signatories/<sid>")
@require("companies.edit")
def update_signatory(sid):
    d = body()
    with db.session_scope() as s:
        x = s.get(M.Signatory, sid)
        if not x:
            return err("غير موجود", 404)
        if not _sig_ok(s, sid, d.get("companyId")):
            return forbidden(OUT_OF_SCOPE)
        db.apply(x, d)
    return jsonify({"ok": True})


@app.delete("/api/signatories/<sid>")
@require("companies.delete")
def delete_signatory(sid):
    with db.session_scope() as s:
        x = s.get(M.Signatory, sid)
        if x and not _sig_ok(s, sid):
            return forbidden(OUT_OF_SCOPE)
        if x:
            s.delete(x)
    return jsonify({"ok": True})


def _signatory_visible(s, civil_id):
    """البطاقة مشتركة لكل شركات المفوّض ← كفاية يكون مفوّض في شركة واحدة من النطاق."""
    return me().allCompanies or any(me().company_ok(c) for c in s.scalars(
        select(M.Signatory.companyId).where(M.Signatory.civilId == civil_id)))


@app.post("/api/signatory-docs/<civil_id>")
@require("companies.edit")
def upload_signatory_doc(civil_id):
    """صورة البطاقة المدنية للمفوّض: تُحفظ مرة واحدة لكل شخص (مفتاحها الرقم المدني)."""
    f = request.files.get("file")
    with db.session_scope() as s:
        if not _signatory_visible(s, civil_id):
            return forbidden(OUT_OF_SCOPE)
        doc = s.get(M.SignatoryDoc, civil_id) or M.SignatoryDoc(civilId=civil_id)
        if f and f.filename:
            path = os.path.join(UPLOADS, "signatories", f"{civil_id}{os.path.splitext(f.filename)[1].lower()}")
            f.save(path)
            doc.name, doc.path = f.filename, db.rel_file(path)
        doc.expiryDate = db.parse_date(request.form.get("expiryDate"))
        doc.uploadedAt = db.now()
        s.merge(doc)
    return jsonify({"ok": True})


@app.get("/files/signatory/<civil_id>")
@require("companies.view")
def get_signatory_doc(civil_id):
    with db.session_scope(commit=False) as s:
        if not _signatory_visible(s, civil_id):
            abort(403)
        r = s.get(M.SignatoryDoc, civil_id)
    if not r or not r.path:
        abort(404)
    return send_file(db.resolve_file(r.path), download_name=r.name)


# ---------------------------------------------------------------------------
# التوقيعات (مفوّض أو موظف — واحد لكل رقم مدني)
# ---------------------------------------------------------------------------
def _signature_access(s, civil_id, write):
    """مين يرفع/يشوف توقيع الرقم المدني ده: مفوّض في شركة من النطاق (الشركات)، أو موظف في النطاق (الجواز والمرفقات)."""
    u = me()
    is_sig = s.scalar(select(M.Signatory.id).where(M.Signatory.civilId == civil_id)) is not None
    if is_sig and _signatory_visible(s, civil_id) and \
            (u.can("companies.edit") if write else (u.can("companies.view") or u.can("contract.view"))):
        return True
    e = s.get(M.Employee, civil_id)
    return bool(e) and emp_ok(s, civil_id) and u.can("sensitive.documents") and \
        (u.can("employees.edit") if write else u.can("employees.view"))


@app.post("/api/signatures/<civil_id>")
@login_required
def upload_signature(civil_id):
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    data = f.read()
    msg = contracts.check_signature_image(data)
    if msg:
        return err(msg)
    with db.session_scope() as s:
        if not _signature_access(s, civil_id, write=True):
            return forbidden()
        ext = ".png" if data[:4] == b"\x89PNG" else ".jpg"
        old = s.get(M.Signature, civil_id)
        if old:
            try:
                os.remove(db.resolve_file(old.path))
            except OSError:
                pass
        path = os.path.join(UPLOADS, "signatures", f"{civil_id}_{db.new_id('s')}{ext}")
        with open(path, "wb") as out:
            out.write(data)
        s.merge(M.Signature(civilId=civil_id, name=f.filename, path=db.rel_file(path), uploadedAt=db.now(), uploadedBy=uname()))
        if s.get(M.Employee, civil_id):
            db.push_timeline(s, civil_id, "file", "رفع صورة التوقيع", uname())
        db.log_audit(s, "signature_upload", f"رفع توقيع للرقم المدني {civil_id}", uname())
    return jsonify({"ok": True})


@app.delete("/api/signatures/<civil_id>")
@login_required
def delete_signature(civil_id):
    with db.session_scope() as s:
        r = s.get(M.Signature, civil_id)
        if not r:
            return jsonify({"ok": True})
        if not _signature_access(s, civil_id, write=True):
            return forbidden()
        try:
            os.remove(db.resolve_file(r.path))
        except OSError:
            pass
        s.delete(r)
        db.log_audit(s, "signature_delete", f"حذف توقيع الرقم المدني {civil_id}", uname())
    return jsonify({"ok": True})


@app.get("/files/signature/<civil_id>")
@login_required
def get_signature(civil_id):
    with db.session_scope(commit=False) as s:
        if not _signature_access(s, civil_id, write=False):
            abort(403)
        r = s.get(M.Signature, civil_id)
    if not r:
        abort(404)
    try:        # في الذاكرة (صورة صغيرة) ← الملف مايفضلش مفتوح، فويندوز يقدر يمسحه لو التوقيع اتغيّر
        with open(db.resolve_file(r.path), "rb") as fh:
            data = fh.read()
    except OSError:
        abort(404)
    resp = send_file(io.BytesIO(data), mimetype="image/png" if data[:4] == b"\x89PNG" else "image/jpeg")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.post("/api/projects")
@require("companies.edit")
def create_project():
    d = body()
    if not d.get("companyId") or not (d.get("nameAr") or "").strip():
        return err("الشركة واسم المشروع مطلوبين")
    if not me().company_ok(d["companyId"]):
        return forbidden(OUT_OF_SCOPE)
    d["id"] = db.new_id("pr")
    with db.session_scope() as s:
        s.add(db.build(M.Project, d))
        db.log_company_history(s, d["companyId"], "project_added", f"إضافة مشروع: {d['nameAr']}", uname())
    return jsonify({"ok": True, "id": d["id"]})


@app.put("/api/projects/<pid>")
@require("companies.edit")
def update_project(pid):
    d = body()
    with db.session_scope() as s:
        p = s.get(M.Project, pid)
        if not p:
            return err("غير موجود", 404)
        if not me().company_ok(p.companyId) or ("companyId" in d and not me().company_ok(d["companyId"])):
            return forbidden(OUT_OF_SCOPE)
        old_exp = db.ser(p.expiryDate)
        db.apply(p, d)
        if p.expiryDate and db.ser(p.expiryDate) != old_exp:
            db.log_company_history(s, p.companyId, "project_renewed",
                                   f"تجديد مشروع {p.nameAr} حتى {db.ser(p.expiryDate)}", uname())
    return jsonify({"ok": True})


@app.delete("/api/projects/<pid>")
@require("companies.delete")
def delete_project(pid):
    with db.session_scope() as s:
        p = s.get(M.Project, pid)
        if p and not me().company_ok(p.companyId):
            return forbidden(OUT_OF_SCOPE)
        s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.projectId == pid).update({"projectId": None})
        s.flush()
        p = s.get(M.Project, pid)
        if p:
            s.delete(p)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# السيارات ومراكز التكلفة
# ---------------------------------------------------------------------------
@app.post("/api/vehicles")
@app.put("/api/vehicles/<vid>")
@require("vehicles.edit")
def save_vehicle(vid=None):
    d = body()
    plate = (d.get("plate") or "").strip()
    if not plate:
        return err("رقم اللوحة مطلوب")
    with db.session_scope() as s:
        old = s.get(M.Vehicle, vid) if vid else None
        if (old and not opt_company_ok(old.companyId)) or not opt_company_ok(d.get("companyId") or None):
            return forbidden("اختار شركة السيارة من القائمة")
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
@require("vehicles.delete")
def delete_vehicle(vid):
    with db.session_scope() as s:
        v = s.get(M.Vehicle, vid)
        if v and not opt_company_ok(v.companyId):
            return forbidden(OUT_OF_SCOPE)
        if v:
            db.log_audit(s, "vehicle_delete", f"حذف سيارة: {v.plate}", uname())
            s.delete(v)
    return jsonify({"ok": True})


@app.post("/api/cost-centers")
@app.put("/api/cost-centers/<ccid>")
@require("costcenters.edit")
def save_cost_center(ccid=None):
    d = body()
    name = (d.get("name") or "").strip()
    if not name:
        return err("الاسم مطلوب")
    if "companyId" in d:
        d["companyId"] = d["companyId"] or None
    with db.session_scope() as s:
        if s.scalar(select(M.CostCenter).where(M.CostCenter.name == name, M.CostCenter.id != (ccid or ""))):
            return err("مركز التكلفة موجود بالفعل", 409)
        old = s.get(M.CostCenter, ccid) if ccid else None
        if "companyId" in d and d["companyId"] != (old.companyId if old else None) and not me().allCompanies:
            return forbidden()
        if d.get("companyId") and not s.get(M.Company, d["companyId"]):
            return err("الشركة غير موجودة")
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
@require("costcenters.delete")
def delete_cost_center(ccid):
    with db.session_scope() as s:
        c = s.get(M.CostCenter, ccid)
        if c:
            n = s.scalar(select(func.count()).select_from(M.Employee).where(M.Employee.costCenter == c.name))
            if n:
                return err(f"لا يمكن الحذف: مرتبط بـ {n} موظف")
            s.query(M.UserCostCenter).filter(M.UserCostCenter.costCenterId == ccid).delete()
            s.flush()
            s.delete(c)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# الاستقدام والتوظيف
# ---------------------------------------------------------------------------
@app.post("/api/candidates")
@app.put("/api/candidates/<cand_id>")
@require("recruitment.edit")
def save_candidate(cand_id=None):
    d = me().strip("candidate", body())
    if not (d.get("name") or "").strip():
        return err("الاسم مطلوب")
    with db.session_scope() as s:
        old = s.get(M.Candidate, cand_id) if cand_id else None
        u = me()
        if old and not u.record_ok(old.targetCompanyId, db.cost_center_company(s, old.costCenter), old.costCenter):
            return forbidden(OUT_OF_SCOPE)
        target = (d.get("targetCompanyId") or None) if "targetCompanyId" in d else (old.targetCompanyId if old else None)
        if target and not u.company_ok(target) and target != (old.targetCompanyId if old else None):
            return forbidden(NEW_OUT_OF_SCOPE)
        cc = d["costCenter"] if "costCenter" in d else (old.costCenter if old else None)
        if not u.record_ok(target, db.cost_center_company(s, cc), cc):
            return forbidden(LEAVES_SCOPE)
        x = find_duplicate_civil_id(s, (d.get("civilId") or "").strip(), exclude_cand=cand_id)
        if x:
            return err(f"الرقم المدني مسجّل بالفعل لـ {dup_name(x)}", 409, block=True)
        if "passportNo" in d:
            x = find_duplicate_passport(s, d.get("passportNo"), exclude_cand=cand_id)
            if x:
                return err(f"رقم الجواز مسجّل بالفعل لـ {dup_name(x)}", 409, block=True)
        if not cand_id:
            x = find_duplicate_name_nat(s, d.get("name"), d.get("nationality"))
            if x:
                return err(f"يوجد {'موظف' if x['where'] == 'employee' else 'مترشّح'} بنفس الاسم والجنسية: {dup_name(x)}",
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
@require("recruitment.delete")
def delete_candidate(cand_id):
    with db.session_scope() as s:
        c = s.get(M.Candidate, cand_id)
        if c and not me().record_ok(c.targetCompanyId, db.cost_center_company(s, c.costCenter), c.costCenter):
            return forbidden(OUT_OF_SCOPE)
        if c:
            s.delete(c)
    return jsonify({"ok": True})


@app.post("/api/candidates/<cand_id>/convert")
@require("recruitment.edit", "employees.edit")
def convert_candidate(cand_id):
    """القسم 8.1: تحويل المترشّح إلى موظف بحالة «قيد الاستكمال»."""
    with db.session_scope() as s:
        c = s.get(M.Candidate, cand_id)
        if not c:
            return err("غير موجود", 404)
        if not me().record_ok(c.targetCompanyId, db.cost_center_company(s, c.costCenter), c.costCenter):
            return forbidden(OUT_OF_SCOPE)
        civil = (c.civilId or "").strip()
        if not civil:
            return err("لازم الرقم المدني يكون متسجّل قبل التحويل")
        x = find_duplicate_civil_id(s, civil, exclude_cand=cand_id)
        if x:
            return err(f"الرقم المدني مسجّل بالفعل لـ {dup_name(x)}", 409)
        x = find_duplicate_passport(s, c.passportNo, exclude_cand=cand_id)
        if x:
            return err(f"رقم الجواز مسجّل بالفعل لـ {dup_name(x)}", 409)
        s.add(M.Employee(
            id=civil, name=c.name, nameEn=c.nameEn, nationality=c.nationality,
            nationalityEn=docx_engine.NATIONALITY_EN.get(c.nationality or ""), dateOfBirth=c.dateOfBirth,
            profession=c.profession, phone=c.phone, salary=c.salary, housingIncluded=bool(c.housingAllowance),
            housingAmount=None, passportNo=c.passportNo, passportIssueDate=c.passportIssueDate,
            passportExp=c.passportExp, costCenter=c.costCenter,
            employmentStatus="pending_completion", dateOfHire=datetime.now().date(),
            lastUpdated=db.now(), lastUpdatedBy=uname()))
        s.flush()
        if c.targetCompanyId:
            db.set_affiliations(s, civil, [{"companyId": c.targetCompanyId, "projectId": None}])
        db.push_timeline(s, civil, "create", "تحويل من مترشّح إلى موظف (قيد الاستكمال) — "
                         + history.current_state_text(s, db.get_affiliations(s, civil), c.costCenter), uname())
        if c.targetCompanyId:
            db.log_company_history(s, c.targetCompanyId, "employee_joined",
                                   f"انضمام الموظف {c.name} ({civil}) — تحويل من مترشّح", uname())
        db.log_audit(s, "candidate_convert", f"تحويل المترشّح {c.name} إلى موظف ({civil})", uname())
        s.delete(c)
    return jsonify({"ok": True, "employeeId": civil})


# ---------------------------------------------------------------------------
# قوالب وعقود العمل (Word / PDF)
# ---------------------------------------------------------------------------
def _contract_template(s, tpl_id):
    tpl = s.get(M.Template, tpl_id or "") or \
        s.scalar(select(M.Template).order_by(M.Template.isDefault.desc(), M.Template.createdAt))
    if not tpl:
        abort(404, "لا يوجد قالب")
    return tpl


def _contract_context(s, emp_id, args, fill=True, tpl=None):
    """(الموظف، الحقول، ملف Word أو None) لعقد موظف. args: company, sig, date, salary, …"""
    emp = db.employee_full(s, emp_id)
    if not emp:
        abort(404, "الموظف غير موجود")
    if not emp_ok(s, emp["id"]):
        abort(403, OUT_OF_SCOPE)
    return _build_contract(s, emp, args, fill, tpl)


def _build_contract(s, emp, args, fill=True, tpl=None):
    """العقد لأي شخص بشكل الموظف (موظف أو مترشّح).
    الشركة الافتراضية = الشركة المسجّل عليها، والمفوّض = أول مفوّض فيها (لو المختار مش تبعها بيتجاهل)."""
    if args.get("company") and not me().company_ok(args["company"]):
        abort(403, OUT_OF_SCOPE)
    aff = (emp.get("affiliations") or [{}])[0]
    cid = args.get("company") or aff.get("companyId") or ""
    company = db.to_dict(s.get(M.Company, cid))
    # مشروع الموظف (إدارة العمل ورقم الملف) بيخص الشركة المسجّل عليها بس — لو الشركة اتغيّرت مالوش لازمة
    project = db.to_dict(s.get(M.Project, aff.get("projectId") or "")) if cid == aff.get("companyId") else None
    # المفوّض: المختار (حتى لو من شركة تانية — حرية الاختيار)، وإلا أول مفوّض في شركة العقد
    sig = s.get(M.Signatory, args.get("sig") or "")
    if sig and not me().company_ok(sig.companyId):
        abort(403, OUT_OF_SCOPE)
    if not sig and company:
        sig = s.scalar(select(M.Signatory).where(M.Signatory.companyId == company["id"]))
    for k in ("salary", "profession", "professionEn", "nameEn", "nationalityEn"):
        if args.get(k):
            emp[k] = args.get(k)
    ctx = contracts.extra_context(docx_engine.resolve_contract_template(
        emp, company, db.to_dict(sig), project, args.get("date") or None))
    contracts.housing_context(ctx, contracts.housing_included(args.get("housing"), emp))
    contracts.signature_context(ctx)
    data = None
    if fill:
        tpl = tpl or _contract_template(s, args.get("tpl"))
        data = docx_engine.fill_docx_template(os.path.join(TEMPLATE_DOCS, tpl.filename), ctx)
        images = {}
        if _truthy(args.get("signFirst")) and sig is not None and sig.civilId:
            images["first"] = _signature_file(s, sig.civilId)
        if _truthy(args.get("signSecond")):
            images["second"] = _signature_file(s, emp["id"])
        data = contracts.apply_signatures(data, images)
    ctx["_signatoryCivilId"] = sig.civilId if sig is not None else None
    return emp, ctx, data


def _truthy(v):
    return str(v).lower() in ("1", "true", "on", "yes")


def _signature_file(s, civil_id):
    r = s.get(M.Signature, civil_id) if civil_id else None
    path = db.resolve_file(r.path) if r else None
    return path if path and os.path.exists(path) else None


def _check_sign_args(args):
    """التوقيعات على العقود محتاجة صلاحية contract.sign."""
    if (_truthy(args.get("signFirst")) or _truthy(args.get("signSecond"))) and not me().can("contract.sign"):
        abort(403, "العملية دي غير متاحة")


def _contract_bundle(args):
    _check_sign_args(args)
    with db.session_scope(commit=False) as s:
        emp, ctx, data = _contract_context(s, args.get("emp", ""), args)
    return emp, data, ctx


@app.get("/api/contract/preview")
@require("contract.view", "employees.view", "sensitive.salary")
def contract_preview():
    emp, data, ctx = _contract_bundle(request.args)
    return jsonify({"html": docx_engine.docx_to_html(data), "fields": ctx, "missing": contracts.missing_fields(ctx)})


@app.get("/api/contract/docx")
@require("contract.view", "employees.view", "sensitive.salary")
def contract_docx():
    emp, data, _ = _contract_bundle(request.args)
    return send_file(io.BytesIO(data), as_attachment=True, download_name=f"عقد عمل - {emp['name']}.docx",
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.get("/api/contract/pdf")
@require("contract.view", "employees.view", "sensitive.salary")
def contract_pdf():
    emp, data, _ = _contract_bundle(request.args)
    try:
        pdf = contracts.to_pdf(data)
    except RuntimeError as e:
        return err(str(e), 501)
    return send_file(io.BytesIO(pdf), as_attachment=request.args.get("dl") == "1",
                     download_name=f"عقد عمل - {emp['name']}.pdf", mimetype="application/pdf")


# --- عقد عمل لمترشّح (مرحلة «عقد العمل» في الاستقدام) ---
CANDIDATE_CONTRACT_STAGE = "employment_contract"
CANDIDATE_CONTRACT_ARGS = ("tpl", "sig", "date", "housing", "signFirst", "signSecond", "professionEn", "nationalityEn")


def _candidate_contract(s, cand_id, args, fill=True):
    """(المترشّح، الحقول، ملف Word أو None، النواقص). الطرف الأول = الشركة المستهدفة، والراتب والاسم من بيانات
    المترشّح نفسه (مفيش تعديل عليهم من هنا). النواقص = أي حقل في القالب فاضي + الحقول الأساسية."""
    c = s.get(M.Candidate, cand_id)
    if not c:
        abort(404, "المترشّح غير موجود")
    if not me().record_ok(c.targetCompanyId, db.cost_center_company(s, c.costCenter), c.costCenter):
        abort(403, OUT_OF_SCOPE)
    if c.stage != CANDIDATE_CONTRACT_STAGE:
        abort(400, "عقد العمل بيتطبع لما المترشّح يكون في مرحلة «عقد العمل»")
    person = {"id": (c.civilId or "").strip(), "name": c.name, "nameEn": c.nameEn, "nationality": c.nationality,
              "profession": c.profession, "salary": c.salary, "housingIncluded": bool(c.housingAllowance),
              "passportNo": c.passportNo, "affiliations": [{"companyId": c.targetCompanyId, "projectId": None}]}
    args = {k: v for k, v in args.items() if k in CANDIDATE_CONTRACT_ARGS}
    tpl = _contract_template(s, args.get("tpl"))
    _, ctx, data = _build_contract(s, person, args, fill, tpl)
    fields = contracts.template_fields(os.path.join(TEMPLATE_DOCS, tpl.filename))
    return c, ctx, data, contracts.missing_in_template(ctx, fields)


@app.get("/api/candidates/<cand_id>/contract/preview")
@require("contract.view", "recruitment.view", "sensitive.salary")
def candidate_contract_preview(cand_id):
    _check_sign_args(request.args)
    with db.session_scope(commit=False) as s:
        _, ctx, data, missing = _candidate_contract(s, cand_id, request.args)
    return jsonify({"html": docx_engine.docx_to_html(data), "fields": ctx, "missing": missing})


@app.get("/api/candidates/<cand_id>/contract/<fmt>")
@require("contract.view", "recruitment.view", "sensitive.salary")
def candidate_contract_file(cand_id, fmt):
    """Word أو PDF — ممنوع لو فيه أي بيان ناقص في العقد."""
    if fmt not in ("docx", "pdf"):
        abort(404)
    _check_sign_args(request.args)
    with db.session_scope(commit=False) as s:
        c, _, data, missing = _candidate_contract(s, cand_id, request.args)
        name = c.name
    if missing:
        return err("لازم تكمّل البيانات دي الأول: " + "، ".join(missing))
    if fmt == "pdf":
        try:
            data = contracts.to_pdf(data)
        except RuntimeError as e:
            return err(str(e), 501)
    with db.session_scope() as s:
        db.log_audit(s, "candidate_contract", f"إصدار عقد عمل ({fmt.upper()}) للمترشّح: {name}", uname())
    mime = "application/pdf" if fmt == "pdf" else \
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return send_file(io.BytesIO(data), as_attachment=True, download_name=f"عقد عمل - {name}.{fmt}", mimetype=mime)


# --- عقود كتير مرة واحدة ---
def _batch_args():
    d = body()
    _check_sign_args(d)
    ids = list(dict.fromkeys(str(x) for x in (d.get("emps") or []) if x))
    if not ids:
        abort(400, "اختار موظف واحد على الأقل")
    if len(ids) > contracts.MAX_BATCH:
        abort(400, f"الحد الأقصى {contracts.MAX_BATCH} عقد في المرة")
    return d, ids


def _batch_emp_args(d, emp):
    """تاريخ العقد: تاريخ واحد للكل، أو تاريخ تعيين كل موظف (ولو مالوش ← التاريخ الموحّد)."""
    date = (emp.get("dateOfHire") if d.get("useHireDate") else None) or d.get("date") or None
    return {"tpl": d.get("tpl"), "date": date, "company": d.get("company") or None, "sig": d.get("sig") or None,
            "housing": d.get("housing", "1"), "signFirst": d.get("signFirst"), "signSecond": d.get("signSecond")}


def _sig_registered(s, sig, company_id):
    """المفوّض ده مسجّل كمفوّض في الشركة دي؟ (نفس الشخص = نفس الرقم المدني، أو نفس الاسم لو مفيش رقم)."""
    q = select(M.Signatory.id).where(M.Signatory.companyId == company_id)
    q = q.where(M.Signatory.civilId == sig.civilId) if sig.civilId else q.where(M.Signatory.nameAr == sig.nameAr)
    return s.scalar(q) is not None


@app.post("/api/contract/batch/check")
@require("contract.view", "employees.view", "sensitive.salary")
def contract_batch_check():
    """البيانات الناقصة لكل موظف قبل إنشاء العقود."""
    d, ids = _batch_args()
    out, not_registered, no_sig_emps, no_sig_first = [], {}, [], {}
    with db.session_scope(commit=False) as s:
        sig = s.get(M.Signatory, d.get("sig") or "")
        for i in ids:
            base = db.employee_full(s, i)
            if not base:
                continue
            emp, ctx, _ = _contract_context(s, i, _batch_emp_args(d, base), fill=False)
            miss = contracts.missing_fields(ctx)
            if miss:
                out.append({"id": i, "name": emp["name"], "missing": miss})
            if _truthy(d.get("signSecond")) and not _signature_file(s, i):
                no_sig_emps.append(emp["name"])
            if _truthy(d.get("signFirst")):
                civ = ctx.get("_signatoryCivilId")
                if not _signature_file(s, civ):
                    key = ctx.get("auth_name") or "—"
                    no_sig_first[key] = no_sig_first.get(key, 0) + 1
            cid = d.get("company") or (base["affiliations"] or [{}])[0].get("companyId")
            if sig and cid and not _sig_registered(s, sig, cid):
                not_registered[cid] = not_registered.get(cid, 0) + 1
        sig_warn = [{"company": (s.get(M.Company, c).nameAr if s.get(M.Company, c) else c), "count": n}
                    for c, n in not_registered.items()]
    return jsonify({"count": len(ids), "incomplete": out, "sigNotRegistered": sig_warn, "engine": contracts.backend(),
                    "noSignatureEmployees": no_sig_emps,
                    "noSignatureSignatories": [{"name": k, "count": v} for k, v in no_sig_first.items()]})


@app.post("/api/contract/batch")
@require("contract.view", "employees.view", "sensitive.salary")
def contract_batch():
    """كذا عقد: format=pdf ← ملف PDF واحد بكل العقود بالترتيب، format=zip ← ملفات Word في ZIP،
    format=files ← PDF منفصل لكل موظف باسمه (JSON: الاسم + المحتوى base64، والواجهة بتنزّلهم ملف ملف)."""
    d, ids = _batch_args()
    fmt = d.get("format") or "pdf"
    named = []
    with db.session_scope(commit=False) as s:
        tpl = _contract_template(s, d.get("tpl"))
        for i in ids:
            base = db.employee_full(s, i)
            if not base:
                continue
            emp, _, data = _contract_context(s, i, _batch_emp_args(d, base), tpl=tpl)
            named.append((f"عقد عمل - {emp['name']} - {emp['id']}.docx", data))
        chosen = ""
        if d.get("company") and s.get(M.Company, d["company"]):
            chosen += f" — الشركة: {s.get(M.Company, d['company']).nameAr}"
        if d.get("sig") and s.get(M.Signatory, d["sig"]):
            chosen += f" — المفوّض: {s.get(M.Signatory, d['sig']).nameAr}"
        chosen += " — بند بدل السكن: " + {"0": "لا يُضاف", "auto": "حسب بيانات الموظف"}.get(str(d.get("housing", "1")), "يُضاف")
        signs = [x for x, k in (("المفوّض", "signFirst"), ("الموظف", "signSecond")) if _truthy(d.get(k))]
        if signs:
            chosen += " — بتوقيع: " + " و".join(signs)
    stamp = datetime.now().strftime("%Y-%m-%d")
    files = None
    if fmt == "zip":
        out, name, mime = contracts.zip_docs(named), f"عقود عمل ({len(named)}) - {stamp}.zip", "application/zip"
    else:
        try:
            pdfs = contracts.to_pdfs([x for _, x in named])
        except RuntimeError as e:
            return err(str(e), 501)
        if fmt == "files":
            files = [{"name": n[:-len(".docx")] + ".pdf", "data": base64.b64encode(p).decode("ascii")}
                     for (n, _), p in zip(named, pdfs)]
        else:
            out, name, mime = contracts.merge_pdfs(pdfs), f"عقود عمل ({len(named)}) - {stamp}.pdf", "application/pdf"
    kind = {"zip": "Word", "files": "PDF — ملف لكل موظف"}.get(fmt, "PDF")
    with db.session_scope() as s:
        db.log_audit(s, "contract_batch", f"إنشاء {len(named)} عقد عمل ({kind}) — قالب: {tpl.name}{chosen}", uname())
    if files is not None:
        return jsonify({"files": files})
    return send_file(io.BytesIO(out), as_attachment=d.get("dl", True), download_name=name, mimetype=mime)


@app.post("/api/templates")
@require("contract.edit")
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
@require("contract.edit")
def set_default_template(tid):
    with db.session_scope() as s:
        s.query(M.Template).update({"isDefault": False})
        s.query(M.Template).filter(M.Template.id == tid).update({"isDefault": True})
    return jsonify({"ok": True})


@app.delete("/api/templates/<tid>")
@require("contract.edit")
def delete_template(tid):
    with db.session_scope() as s:
        if s.scalar(select(func.count()).select_from(M.Template)) <= 1:
            return err("لازم يفضل قالب واحد على الأقل")
        t = s.get(M.Template, tid)
        if t:
            s.delete(t)
    return jsonify({"ok": True})


@app.get("/api/templates/<tid>/file")
@require("contract.view")
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
@require("system.backup", "sensitive.salary", "sensitive.bank", "sensitive.documents", all_companies=True)
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
def _user_api(u, scopes, cc_scopes):
    return {"id": u.id, "username": u.username, "displayName": u.displayName, "roleId": u.roleId,
            "allCompanies": bool(u.allCompanies), "companies": scopes.get(u.id, []),
            "costCenters": cc_scopes.get(u.id, []), "active": bool(u.active),
            "jobTitle": u.jobTitle, "email": u.email, "phone": u.phone,
            "lastLogin": db.ser(u.lastLogin), "createdAt": db.ser(u.createdAt)}


def _active_admins(s, exclude=None):
    q = select(func.count()).select_from(M.User).join(M.Role, M.User.roleId == M.Role.id) \
        .where(M.Role.isAdmin.is_(True), M.User.active.is_(True))
    if exclude:
        q = q.where(M.User.id != exclude)
    return s.scalar(q)


def _set_user_fields(s, u, d):
    """الحقول المشتركة بين الإضافة والتعديل. بيرجّع رسالة خطأ أو None."""
    if "roleId" in d:
        if not s.get(M.Role, d["roleId"] or ""):
            return "الدور غير موجود"
        u.roleId = d["roleId"]
    for k in ("displayName", "jobTitle", "email", "phone"):
        if k in d:
            setattr(u, k, (d[k] or "").strip() or None)
    if "active" in d:
        u.active = bool(d["active"])
    if "allCompanies" in d:
        u.allCompanies = bool(d["allCompanies"])
    s.flush()
    if "companies" in d:
        cids = [c for c in dict.fromkeys(d["companies"] or []) if s.get(M.Company, c)]
        s.query(M.UserCompany).filter(M.UserCompany.userId == u.id).delete()
        s.add_all([M.UserCompany(userId=u.id, companyId=c) for c in cids])
    if "costCenters" in d:
        ccids = [c for c in dict.fromkeys(d["costCenters"] or []) if s.get(M.CostCenter, c)]
        s.query(M.UserCostCenter).filter(M.UserCostCenter.userId == u.id).delete()
        s.add_all([M.UserCostCenter(userId=u.id, costCenterId=c) for c in ccids])
    s.flush()
    if not u.allCompanies and not (
            s.scalar(select(func.count()).select_from(M.UserCompany).where(M.UserCompany.userId == u.id))
            or s.scalar(select(func.count()).select_from(M.UserCostCenter).where(M.UserCostCenter.userId == u.id))):
        return "اختار شركة أو مركز تكلفة واحد على الأقل، أو فعّل «كل الشركات»"
    if d.get("password"):
        if len(d["password"]) < 6:
            return "كلمة المرور لازم 6 أحرف على الأقل"
        u.passwordHash = generate_password_hash(d["password"])
    return None


@app.get("/api/users")
@admin_required
def list_users():
    with db.session_scope(commit=False) as s:
        scopes, cc_scopes = {}, {}
        for r in s.scalars(select(M.UserCompany)):
            scopes.setdefault(r.userId, []).append(r.companyId)
        for r in s.scalars(select(M.UserCostCenter)):
            cc_scopes.setdefault(r.userId, []).append(r.costCenterId)
        return jsonify([_user_api(u, scopes, cc_scopes) for u in s.scalars(select(M.User).order_by(M.User.id))])


@app.post("/api/users")
@admin_required
def create_user():
    d = body()
    username = (d.get("username") or "").strip()
    if not username or not d.get("password") or not d.get("roleId"):
        return err("اسم المستخدم وكلمة المرور والدور مطلوبين")
    try:
        with db.session_scope() as s:
            u = M.User(username=username, displayName=(d.get("displayName") or "").strip() or username,
                       passwordHash="", allCompanies=True, active=True, createdAt=db.now())
            s.add(u)
            s.flush()
            msg = _set_user_fields(s, u, {**d, "allCompanies": d.get("allCompanies", True)})
            if msg:
                s.rollback()
                return err(msg)
            db.log_audit(s, "user_add", f"إضافة مستخدم: {username} ({s.get(M.Role, u.roleId).name})", uname())
            return jsonify({"ok": True, "id": u.id})
    except IntegrityError:
        return err("اسم المستخدم موجود بالفعل", 409)


@app.put("/api/users/<int:uid>")
@admin_required
def update_user(uid):
    d = body()
    with db.session_scope() as s:
        u = s.get(M.User, uid)
        if not u:
            return err("غير موجود", 404)
        was_admin = bool(u.roleId and s.get(M.Role, u.roleId).isAdmin and u.active)
        msg = _set_user_fields(s, u, d)
        if msg:
            s.rollback()
            return err(msg)
        is_admin = bool(s.get(M.Role, u.roleId).isAdmin and u.active)
        if was_admin and not is_admin and not _active_admins(s, exclude=uid):
            s.rollback()
            return err("لازم يفضل مدير نظام واحد نشط على الأقل")
        if uid == me().id and not is_admin:
            s.rollback()
            return err("مش هينفع تشيل صلاحية المدير أو توقف حسابك انت")
        db.log_audit(s, "user_edit", f"تعديل المستخدم: {u.username}"
                     + (" — كلمة مرور جديدة" if d.get("password") else ""), uname())
    return jsonify({"ok": True})


@app.delete("/api/users/<int:uid>")
@admin_required
def delete_user(uid):
    if uid == session.get("uid"):
        return err("لا يمكنك حذف حسابك")
    with db.session_scope() as s:
        u = s.get(M.User, uid)
        if u:
            if u.roleId and s.get(M.Role, u.roleId).isAdmin and u.active and not _active_admins(s, exclude=uid):
                return err("لازم يفضل مدير نظام واحد نشط على الأقل")
            s.query(M.UserCompany).filter(M.UserCompany.userId == uid).delete()
            s.query(M.UserCostCenter).filter(M.UserCostCenter.userId == uid).delete()
            s.flush()
            db.log_audit(s, "user_delete", f"حذف المستخدم: {u.username}", uname())
            s.delete(u)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# الأدوار (للمدير)
# ---------------------------------------------------------------------------
def _role_api(r, counts):
    return {"id": r.id, "name": r.name, "description": r.description, "permissions": perms.load_keys(r),
            "isAdmin": bool(r.isAdmin), "isSystem": bool(r.isSystem), "userCount": counts.get(r.id, 0)}


@app.get("/api/roles")
@admin_required
def list_roles():
    with db.session_scope(commit=False) as s:
        counts = dict(s.execute(select(M.User.roleId, func.count()).group_by(M.User.roleId)).all())
        roles = s.scalars(select(M.Role).order_by(M.Role.isAdmin.desc(), M.Role.isSystem.desc(), M.Role.name))
        return jsonify({"roles": [_role_api(r, counts) for r in roles], "catalog": perms.catalog()})


@app.post("/api/roles")
@app.put("/api/roles/<rid>")
@admin_required
def save_role(rid=None):
    d = body()
    name = (d.get("name") or "").strip()
    if not name:
        return err("اسم الدور مطلوب")
    try:
        with db.session_scope() as s:
            r = s.get(M.Role, rid) if rid else M.Role(id=db.new_id("role"), isAdmin=False, isSystem=False)
            if not r:
                return err("غير موجود", 404)
            r.name = name
            r.description = (d.get("description") or "").strip() or None
            if not r.isAdmin:                              # مدير النظام = كل الصلاحيات دايمًا
                r.permissions = json.dumps(perms.clean_keys(d.get("permissions")))
            if not rid:
                s.add(r)
            db.log_audit(s, "role_edit" if rid else "role_add", f"{'تعديل' if rid else 'إضافة'} دور: {name}", uname())
            return jsonify({"ok": True, "id": r.id})
    except IntegrityError:
        return err("يوجد دور بنفس الاسم", 409)


@app.delete("/api/roles/<rid>")
@admin_required
def delete_role(rid):
    """أي دور بيتحذف ماعدا «مدير النظام». لو عليه مستخدمين لازم moveTo = الدور اللي هينتقلوا له."""
    move_to = request.args.get("moveTo") or ""
    with db.session_scope() as s:
        r = s.get(M.Role, rid)
        if not r:
            return jsonify({"ok": True})
        if r.isAdmin:
            return err("دور «مدير النظام» مابيتحذفش")
        n = s.scalar(select(func.count()).select_from(M.User).where(M.User.roleId == rid))
        target = s.get(M.Role, move_to) if move_to and move_to != rid else None
        if n and not target:
            return err(f"الدور ده عليه {n} مستخدم: اختار دور ينتقلوا له", needsMove=True, userCount=n)
        if n:
            s.query(M.User).filter(M.User.roleId == rid).update({"roleId": target.id})
            s.flush()
        db.log_audit(s, "role_delete", f"حذف دور: {r.name}" + (f" — {n} مستخدم اتنقلوا لدور «{target.name}»" if n else ""),
                     uname())
        s.delete(r)
    return jsonify({"ok": True, "moved": n})



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


@app.get("/healthz")
def healthz():
    """فحص الحالة (Docker HEALTHCHECK / Load balancer)."""
    try:
        with db.engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        return jsonify({"status": "ok", "version": APP_VERSION, "database": db.engine.dialect.name})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 503


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": getattr(e, "description", "غير موجود")}), 404
    return e


@app.errorhandler(400)
@app.errorhandler(403)
def api_http_error(e):
    """abort(400/403, "رسالة") ← JSON للواجهة بدل صفحة HTML."""
    if request.path.startswith("/api/"):
        return jsonify({"error": e.description}), e.code
    return e


def lan_ip():
    """عنوان الجهاز على الشبكة المحلية (للرسالة بس). الـ connect على UDP مابيبعتش حاجة، بس بيختار كارت الشبكة."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    host = os.environ.get("HOST", "127.0.0.1")     # الجهاز ده بس. على الشبكة: HOST=0.0.0.0 (run_windows.bat)
    url = f"http://localhost:{port}"
    if host == "0.0.0.0" and lan_ip():
        url += f"  ·  على الشبكة: http://{lan_ip()}:{port}"
    print(f"Lunx {APP_VERSION} [{db.engine.dialect.name}] → {url}")
    app.run(host=host, port=port, debug=bool(os.environ.get("DEBUG")))
