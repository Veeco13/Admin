# -*- coding: utf-8 -*-
"""
LUNX — إدارة الشؤون الإدارية والحكومية للشركات (منتج مستقل — اسم العميل إعداد «اسم الجهة» مش مكتوب في البرنامج)
شركة أبراج انرجي ومجموعة شركاتها التابعة

Flask + SQLAlchemy. الواجهة صفحة واحدة (SPA) في static/ ، والـ API هنا.
تشغيل:  python app.py   ثم افتح http://localhost:5050
نوع قاعدة البيانات: متغير البيئة LUNX_DATABASE_URL (الافتراضي SQLite: lunx.db)
"""
import base64
import gzip
import hashlib
import io
import json
import os
import re
import threading
import time
from datetime import datetime
from functools import wraps

from flask import (Flask, jsonify, request, session, send_file, render_template,
                   redirect, url_for, abort, g)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import object_session
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

import db
import approvals
import backup
import trash
import contracts
import custody
import custody_excel
import value_i18n
import letters
import docx_engine
import history
import importer
import import_extra
import syscheck
import lunx_restore
import models as M
import perms
import pdf_forms
import permit_forms

APP_VERSION = "v353-flask.4"

BASE_DIR = db.BASE_DIR
BUILTIN_TEMPLATES = os.path.join(BASE_DIR, "templates_docs")     # القوالب اللي جاية مع الكود
TEMPLATE_DOCS = db.data_path("templates_docs")                  # القوالب المستخدمة (بتتحفظ مع البيانات)
UPLOADS = db.data_path("uploads")
for sub in ("", "employees", "companies", "signatories", "signatures", "logos", "letterheads", "imports"):
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
# حماية المتصفح + الكوكي الآمنة على https + الضغط (gzip) + كاش ملفات الشاشات
# ---------------------------------------------------------------------------
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; frame-src 'self' blob:; "
       "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")
GZIP_TYPES = {"application/json", "text/html", "text/css", "application/javascript", "text/javascript"}


@app.after_request
def _harden(resp):
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")          # المتصفح مايخمّنش نوع الملف
    h.setdefault("X-Frame-Options", "SAMEORIGIN")               # البرنامج مايتفتحش جوّه موقع تاني
    h.setdefault("Referrer-Policy", "same-origin")
    if resp.mimetype == "text/html":
        h.setdefault("Content-Security-Policy", CSP)            # مفيش سكريبتات غير من البرنامج نفسه
    if request.is_secure and not app.config["SESSION_COOKIE_SECURE"]:     # https ← الكوكي آمنة لوحدها
        cookies = h.getlist("Set-Cookie")
        if any("; secure" not in c.lower() for c in cookies):
            h.remove("Set-Cookie")
            for c in cookies:
                h.add("Set-Cookie", c if "; secure" in c.lower() else c + "; Secure")
    if request.path.startswith("/static/") and request.args.get("v") and resp.status_code in (200, 304):
        h["Cache-Control"] = "public, max-age=31536000, immutable"   # الرابط بيتغيّر مع أي تحديث (ASSET_VER)
    return _gzip(resp)


def _gzip(resp):
    if (resp.status_code != 200 or resp.mimetype not in GZIP_TYPES or resp.headers.get("Content-Encoding")
            or "gzip" not in request.headers.get("Accept-Encoding", "").lower()):
        return resp
    if resp.direct_passthrough:                      # ملفات static بتتقري من الديسك
        if not request.path.startswith("/static/"):
            return resp
        resp.direct_passthrough = False
    data = resp.get_data()
    if len(data) < 1024:
        return resp
    resp.set_data(gzip.compress(data, 6))
    resp.headers["Content-Encoding"] = "gzip"
    resp.vary.add("Accept-Encoding")
    return resp


def _asset_version():
    """رقم نسخة ملفات الشاشات من محتواها ← أي تعديل بيغيّر الرابط، فالمتصفح مايفضلش على نسخة قديمة."""
    h = hashlib.sha1(APP_VERSION.encode())
    for root, _, files in os.walk(os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")):
        for fn in sorted(files):
            if fn.endswith((".js", ".css")):
                with open(os.path.join(root, fn), "rb") as fh:
                    h.update(fn.encode() + fh.read())
    return h.hexdigest()[:10]


ASSET_VER = _asset_version()


# ---------------------------------------------------------------------------
# كلمات السر: 8 حروف على الأقل، والافتراضية / الضعيفة لازم تتغيّر قبل أي حاجة
# ---------------------------------------------------------------------------
PW_MIN = 8
WEAK_PASSWORDS = {"admin123", "admin", "123456", "1234567", "12345678", "123456789", "1234567890", "password", "123123",
                  "111111", "000000", "qwerty", "lunx", "lunx123"}
MUST_CHANGE_MSG = "لازم تغيّر كلمة السر الأول (الحالية افتراضية أو سهلة جدًا)"


def weak_password(username, pw):
    p, u = (pw or "").strip().lower(), (username or "").strip().lower()
    return p in WEAK_PASSWORDS or p == u or p in (u + "123", u + "1234", "123" + u)


def password_problem(username, pw):
    """كلمة سر جديدة ← رسالة خطأ أو None."""
    if len(pw or "") < PW_MIN:
        return f"كلمة المرور لازم {PW_MIN} أحرف على الأقل"
    if weak_password(username, pw):
        return "كلمة المرور دي سهلة التخمين (افتراضية أو زي اسم المستخدم) — اختار واحدة تانية"
    return None


PW_OPEN_PATHS = ("/api/state", "/api/me/password", "/logout", "/login", "/healthz")


@app.before_request
def _force_password_change():
    """اللي دخل بكلمة سر افتراضية أو ضعيفة: مفيش أي عملية غير تغييرها (الشاشة بتفتح على نافذة التغيير)."""
    if session.get("pw_change") and (request.path.startswith("/api/") or request.path.startswith("/files/")) \
            and request.path not in PW_OPEN_PATHS and not request.path.startswith("/files/logo/"):
        return jsonify({"error": MUST_CHANGE_MSG, "mustChangePassword": True}), 403


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
# المرفقات: PDF وصور بس (بنتأكد من محتوى الملف نفسه مش اسمه) — وبتتعرض بنوعها الحقيقي
# ---------------------------------------------------------------------------
VIEW_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif",
              ".webp": "image/webp", ".bmp": "image/bmp"}
IMAGE_TYPES = (".png", ".jpg", ".gif", ".webp", ".bmp")
UPLOAD_ONLY_VIEWABLE = "المرفق لازم يكون PDF أو صورة (PNG / JPG / WEBP / GIF / BMP) — بيتعرض جوّه البرنامج بس"
UPLOAD_ONLY_IMAGE = "الشعار لازم يكون صورة (PNG / JPG / WEBP / GIF / BMP)"


def sniff_type(head):
    """أول بايتات الملف ← امتداده الحقيقي (أو None لو مش PDF ولا صورة)."""
    if head.startswith(b"%PDF"):
        return ".pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    if head[:2] == b"BM":
        return ".bmp"
    return None


def check_upload(f, images_only=False):
    """ملف مرفوع ← (امتداده الحقيقي، رسالة خطأ أو None). الاسم مش كفاية: ملف HTML اسمه x.pdf بيترفض."""
    head = f.stream.read(16)
    f.stream.seek(0)
    kind = sniff_type(head)
    if kind is None or (images_only and kind not in IMAGE_TYPES):
        return None, (UPLOAD_ONLY_IMAGE if images_only else UPLOAD_ONLY_VIEWABLE)
    return kind, None


def send_viewable(path, name=None):
    """عرض مرفق جوّه البرنامج (مش تنزيل): PDF أو صورة بنوعها الحقيقي — أي نوع تاني (ملفات قديمة) مابيتعرضش."""
    try:
        with open(path, "rb") as fh:
            kind = sniff_type(fh.read(16))
    except OSError:
        abort(404)
    if kind is None:
        return err("الملف ده مايتعرضش جوّه البرنامج (PDF وصور بس) — والتنزيل مقفول", 415)
    return send_file(path, mimetype=VIEW_TYPES[kind], download_name=name or os.path.basename(path), as_attachment=False)


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


# اسم الجهة المرخّص لها (العميل): إعداد في meta — بيظهر جنب LUNX في الشريط العلوي وفي صفحة الدخول «مرخّص لـ…».
# هوية المنتج (LUNX) ثابتة، وهوية العميل في مستنداته المطبوعة بس (شعار واسم كل شركة).
ORG_KEYS = {"name": "org_name", "nameEn": "org_name_en"}


def org_info(s):
    return {k: db.get_meta(s, key) or "" for k, key in ORG_KEYS.items()}


@app.context_processor
def _brand_context():
    try:
        with db.session_scope(commit=False) as s:
            return {"org_name": org_info(s)["name"], "asset_ver": ASSET_VER}
    except Exception:                               # صفحة الدخول ماتقعش لو القاعدة لسه بتتجهّز
        return {"org_name": "", "asset_ver": ASSET_VER}


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
        if not u:                          # الجلسة خلصت ← الواجهة بترجّع لصفحة الدخول (زي login_required)
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login"))
        if not u.isAdmin:
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


# قفل الدخول: LOGIN_MAX محاولة غلط لنفس المستخدم من نفس الجهاز (أو LOGIN_MAX_IP من الجهاز كله) في LOGIN_WINDOW ثانية
# ← قفل LOGIN_LOCK ثانية. في الذاكرة (بيتصفّر مع إعادة التشغيل)، وكل محاولة غلط بتتسجّل في سجل التدقيق.
LOGIN_MAX, LOGIN_MAX_IP, LOGIN_WINDOW, LOGIN_LOCK = 5, 20, 15 * 60, 5 * 60
_login_fails, _login_guard = {}, threading.Lock()


def _login_keys(username):
    ip = request.remote_addr or "?"
    return (f"u:{username.lower()}|{ip}", LOGIN_MAX), (f"ip:{ip}", LOGIN_MAX_IP)


def _login_wait(username):
    """الثواني الباقية على فك القفل (0 = مش مقفول)."""
    now, wait = time.time(), 0
    with _login_guard:
        for key, limit in _login_keys(username):
            tries = [t for t in _login_fails.get(key, []) if now - t < LOGIN_WINDOW]
            _login_fails[key] = tries
            if len(tries) >= limit:
                wait = max(wait, int(LOGIN_LOCK - (now - tries[-1])))
    return max(wait, 0)


def _login_failed(username):
    """بتسجّل المحاولة الغلط ← True لو وصل للحد (اتقفل)."""
    now, locked = time.time(), False
    with _login_guard:
        if len(_login_fails) > 5000:       # حماية للذاكرة
            _login_fails.clear()
        for key, limit in _login_keys(username):
            tries = [t for t in _login_fails.get(key, []) if now - t < LOGIN_WINDOW] + [now]
            _login_fails[key] = tries
            locked = locked or len(tries) >= limit
    return locked


def _login_ok(username):
    with _login_guard:
        _login_fails.pop(_login_keys(username)[0][0], None)


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        wait = _login_wait(username)
        if wait:
            return render_template("login.html", error=f"محاولات كتير غلط — جرّب تاني بعد {wait // 60 + 1} دقيقة"), 429
        with db.session_scope() as s:
            u = s.scalar(select(M.User).where(M.User.username == username))
            if u and check_password_hash(u.passwordHash, request.form.get("password", "")):
                if not u.active:
                    error = "الحساب ده موقوف، كلّم مدير النظام"
                else:
                    _login_ok(username)
                    u.lastLogin = db.now()
                    session.clear()
                    session["uid"] = u.id
                    session.permanent = True
                    weak = weak_password(u.username, request.form.get("password", ""))
                    _mark_weak(s, u.username, weak)          # بيظهر في تقرير جودة البيانات لحد ما تتغيّر
                    if weak:
                        session["pw_change"] = True
                        db.log_audit(s, "login_weak", f"دخول بكلمة سر افتراضية / ضعيفة ← لازم تتغيّر: {u.username}", u.username)
                    return redirect(url_for("index"))
            else:
                error = "اسم المستخدم أو كلمة المرور غير صحيحة"
                locked = _login_failed(username)
                who = f"{username[:40] or '—'} (من {request.remote_addr or '؟'})"
                db.log_audit(s, "login_locked" if locked else "login_fail",
                             (f"قفل الدخول {LOGIN_LOCK // 60} دقايق بعد محاولات غلط كتير: {who}" if locked
                              else f"محاولة دخول بكلمة سر غلط: {who}"), username[:40] or None)
                if locked:
                    error = f"محاولات كتير غلط — جرّب تاني بعد {LOGIN_LOCK // 60} دقايق"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html", version=APP_VERSION, asset_ver=ASSET_VER)


# ---------------------------------------------------------------------------
# الحالة الكاملة
# ---------------------------------------------------------------------------
@app.get("/api/state")
@login_required
def api_state():
    try:
        backup.kick()                    # النسخة الكاملة اليومية (ZIP) — في الخلفية
    except Exception as e:               # النسخ الاحتياطي ما يوقفش النظام
        app.logger.warning("auto backup failed: %s", e)
    try:
        with db.session_scope() as s:    # السلة: اللي عدّى عليه 90 يوم ← حذف نهائي (مرة في اليوم)
            if db.get_meta(s, "trash_purged") != datetime.now().date().isoformat():
                db.set_meta(s, "trash_purged", datetime.now().date().isoformat())
                n = trash.purge_expired(s)
                if n:
                    db.log_audit(s, "trash_purge", f"حذف نهائي تلقائي من سلة المحذوفات (عدّى عليهم {trash.KEEP_DAYS} يوم): {n}", "النظام")
    except Exception as e:
        app.logger.warning("trash purge failed: %s", e)
    try:
        syscheck.kick(data_quality)      # 🩺 فحص السيستم الأسبوعي — في الخلفية
    except Exception as e:
        app.logger.warning("system check failed: %s", e)
    try:
        with db.session_scope() as s:
            _finish_notice_periods(s)    # فترة الإنذار خلصت ← مستقيل / إنهاء خدمات
    except Exception as e:
        app.logger.warning("notice periods failed: %s", e)
    u = me()
    with db.session_scope(commit=False) as s:
        state = db.dump_state(s, u)
        state.update(custody.dump(s, u) if u.can("custody.view")
                     else {"custodies": [], "invoices": [], "feeItems": [], "custodySettings": None})
        state["valueTranslations"] = value_i18n.merged(s)       # الجنسيات والمهن للتقارير الإنجليزية
        state["exportPasswordSet"] = bool(u.isAdmin and db.get_meta(s, EXPORT_KEY))
        state["org"] = org_info(s)                                           # اسم الجهة (جنب LUNX)
        state["backupStatus"] = backup.status(s) if u.isAdmin else None      # تنبيه لو النسخة التلقائية وقفت
        state["sysCheck"] = syscheck.summary(s) if u.isAdmin else None       # ❌ الفحص الدوري ← في الجرس
        state["approvals"] = approvals.visible(s, u, emp_ok)                # طلبات الموافقة (المستني + اللي اتقرر قريب)
        seen = {e["id"] for e in state.get("employees") or []}
        state["renewing"] = {k: v for k, v in custody.renewing(s).items() if k in seen}   # «🔄 قيد التجديد» في التنبيهات
        links = {}
        for r in s.scalars(select(M.AgencyCostCenter)):
            links.setdefault(r.agencyId, []).append(r.costCenterId)
        state["agencies"] = [{**db.to_dict(a), "costCenterIds": links.get(a.id, []),
                              "signatories": _json_list(a.signatories), "mandoubs": _json_list(a.mandoubs)}
                             for a in s.scalars(select(M.Agency).order_by(M.Agency.position, M.Agency.nameAr))]
        state["permitFormsAvailable"] = permit_forms.available()
        see_sal = u.can("sensitive.salary")
        emp_ids = {e["id"] for e in state["employees"]} if u.can("employees.view") else set()
        state["letters"] = [letters.to_api(x, see_sal) for x in s.scalars(select(M.HrLetter).order_by(M.HrLetter.createdAt.desc()))
                            if x.employeeId in emp_ids and (x.kind not in letters.SHEETS or see_sal)]
        holders = permit_holders(s, u) if u.can("permits.view") else {"employees": [], "vehicles": []}
        state["permitHolders"] = holders
        state.update(dump_permits(s, {e["id"] for e in holders["employees"]}, {v["id"] for v in holders["vehicles"]}))
        for cc in state.get("costCenters", []):                   # رمز المركز بيتحدد مرة واحدة ومايتغيّرش
            cc["codeLocked"] = bool(cc.get("code"))
    if not custody.sees_all(u):                                   # عمليات عهد المستخدمين التانيين مش ليه
        state["auditLog"] = [a for a in state.get("auditLog", []) if a.get("category") != "custody" or a.get("user") == u.display]
    for t in state.get("templates", []):     # خيارات التوقيع بتظهر بس لو القالب فيه مكانها
        path = os.path.join(TEMPLATE_DOCS, t["filename"])
        fields = contracts.template_fields(path) if os.path.exists(path) else set()
        t["signFirst"], t["signSecond"] = "sig_first_party" in fields, "sig_second_party" in fields
    state["me"] = u.to_api()
    state["me"]["mustChangePassword"] = bool(session.get("pw_change"))
    state["version"] = APP_VERSION
    state["pdfAvailable"] = bool(contracts.backend())
    state["sheetPdfAvailable"] = bool(contracts._soffice() or contracts._excel_installed())   # معاينة كشوف العهد
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
               "govStage": "مرحلة المعاملة", "maritalStatus": "الحالة الاجتماعية", **TRACKED_DATE_LABELS}     # الشركة ومركز التكلفة ← history.record_moves


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
            # المرتب / البنك / إنهاء الخدمة من غير صلاحية الموافقة ← بيتشالوا من الحفظ وبيتحوّلوا لطلبات (قبل أي كتابة)
            held = {}
            if orig_id and not u.can(approvals.PERM):
                held, msg = approvals.split(old_e, data)
                if msg:
                    return err(msg)
            if "children" in data:
                data["children"] = db.children_json(data["children"])
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
                if e.govStage in END_STAGES or data.get("govStage") in END_STAGES:
                    data.pop("govStage", None)             # مسار إنهاء الخدمة بيتغيّر من نافذته بس
                db.apply(e, data)
                new = db.to_dict(e)
                if old.get("govStage") != new.get("govStage"):
                    custody.sync_person(s, "employee", new_id, new.get("govStage"))
                changes = [f"{lab}: {history.value_label(k, old.get(k)) or '—'} ← {history.value_label(k, new.get(k)) or '—'}"
                           for k, lab in DIFF_LABELS.items() if k in data and old.get(k) != new.get(k)]
                if "children" in data and old.get("children") != new.get("children"):
                    changes.append(f"بيانات الأبناء: {len(db.children_list(old.get('children')))} ← "
                                   f"{len(db.children_list(new.get('children')))}")
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
                for kind, ch in held.items():
                    approvals.request(s, e, kind, ch, u, "بطاقة الموظف")
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
            return jsonify({"ok": True, "employee": u.strip("employee", db.employee_full(s, new_id)),
                            "pending": [f"{approvals.KINDS[k]}: {approvals.describe(k, ch)}" for k, ch in held.items()]})
    except IntegrityError as e:
        return err(f"تعارض في البيانات: {e.orig}", 409)


# ---------------------------------------------------------------------------
# الحالة الوظيفية: في الخدمة / في فترة الإنذار / مستقيل / إنهاء خدمات / قيد الاستكمال
# ---------------------------------------------------------------------------
EMP_STATUSES = tuple(history.EMP_STATUS_LABELS)
ENDED_STATUSES = ("resigned", "terminated")


def end_type_for_reason(reason):
    """سبب انتهاء الخدمة ← النوع: الاستقالة = مستقيل، وأي سبب تاني (إنهاء من صاحب العمل، انتهاء العقد، التقاعد، الوفاة) = إنهاء خدمات."""
    return "resigned" if "استقال" in (reason or "") else "terminated"


# مسارات «إنهاء الخدمة»: الخطوات بالترتيب، والخطوة الشغالة في employee.govStage (نفس END_TRACKS في static/js/core.js).
#   kw   — العمالة الوطنية والخليجيين (مالهمش إقامة): استمارة 103 ← إلغاء التأمينات ← إلغاء إذن العمل (دعم العمالة بيقف لوحده).
#   xfer — وافد اتحوّل لشركة تانية: طلب التحويل من الشركة الجديدة على «أسهل» ← الموافقة عليه (من غير مخالصة).
#   exit — وافد إلغاء نهائي: إقرار المخالصة والتوقيع ← اعتماده في الهيئة ← رفعه مع كتاب الطيران على «أسهل» ← إلغاء إذن
#          العمل ← إلغاء الإقامة.
END_TRACKS = {
    "kw": ("kw_end_form", "kw_end_pifss", "kw_end_permit", "kw_end_done"),
    "xfer": ("ex_xfer_request", "ex_xfer_approve", "ex_xfer_done"),
    "exit": ("ex_exit_clearance", "ex_exit_pam", "ex_exit_ashal", "ex_exit_permit", "ex_exit_residency", "ex_exit_done"),
}
END_TRACK_LABELS = {"kw": "إنهاء خدمة — عمالة وطنية", "xfer": "إنهاء خدمة — تحويل لشركة أخرى", "exit": "إنهاء خدمة — إلغاء نهائي"}
END_STEPS = {
    "kw_end_form": "طباعة استمارة 103 (إنهاء خدمة) والتوقيع عليها", "kw_end_pifss": "إلغاء الاشتراك في التأمينات الاجتماعية",
    "kw_end_permit": "إلغاء إذن العمل",
    "ex_xfer_request": "وصول طلب التحويل من الشركة الجديدة على «أسهل»", "ex_xfer_approve": "الموافقة على طلب التحويل في «أسهل»",
    "ex_exit_clearance": "طباعة إقرار المخالصة وتوقيع الموظف والمفوّض بالتوقيع", "ex_exit_pam": "اعتماد المخالصة في الهيئة العامة للقوى العاملة",
    "ex_exit_ashal": "رفع المخالصة المعتمدة مع كتاب الطيران على «أسهل»", "ex_exit_permit": "صدور إلغاء إذن العمل",
    "ex_exit_residency": "إلغاء الإقامة",
}
END_STAGE_TRACK = {st: k for k, sts in END_TRACKS.items() for st in sts}
END_STAGES = tuple(END_STAGE_TRACK)
KW_END_STAGES = END_TRACKS["kw"]
LEAVING_STATUSES = ENDED_STATUSES + ("warning",)


def _end_track_for(e):
    """المسار المناسب للموظف: العمالة الوطنية ← kw، والوافد ← «تحويل» لو السبب تحويل، وإلا «إلغاء نهائي»."""
    if not pdf_forms.needs_residency(e.nationality):
        return "kw"
    return "xfer" if "تحويل" in (e.serviceEndReason or "") else "exit"


def _end_set(s, e, stage, label, user, tl_type="gov_stage"):
    e.govStage, e.govStageNote, e.lastUpdated, e.lastUpdatedBy = stage, None, db.now(), user
    if stage and stage == END_TRACKS[END_STAGE_TRACK[stage]][0]:
        e.govStageStartDate = datetime.now().date()
    db.push_timeline(s, e.id, tl_type, label, user)


def _end_open(s, e, track, user, why="المسار اتفتح"):
    steps = " ← ".join(f"({i}) {END_STEPS[st]}" for i, st in enumerate(END_TRACKS[track][:-1], 1))
    _end_set(s, e, END_TRACKS[track][0], f"{END_TRACK_LABELS[track]}: {why} — {steps}", user)


def _end_track_sync(s, e, user):
    """الحالة اتغيّرت: فترة إنذار / انتهاء خدمة ← المسار بيتفتح لوحده. رجوع للخدمة ← بيتلغي."""
    leaving = (e.employmentStatus or "active") in LEAVING_STATUSES
    if leaving and e.govStage not in END_STAGES:
        _end_open(s, e, _end_track_for(e), user)
    elif not leaving and e.govStage in END_STAGES:
        _end_set(s, e, None, f"{END_TRACK_LABELS[END_STAGE_TRACK[e.govStage]]}: المسار اتلغى (رجع للخدمة)", user)


def _set_employment_status(s, e, status, end_date=None, end_type=None, reason=None, note=None, user=None, source=None):
    """بيغيّر حالة الموظف ويسجّل في سجله. مستقيل / إنهاء خدمات: آخر يوم عمل لازم. في فترة الإنذار: النوع (مستقيل / إنهاء
    خدمات) وآخر يوم لازمين — بعد اليوم ده بيتحوّل لوحده (_finish_notice_periods)، ولو عدّى خلاص بيتحوّل على طول.
    الرجوع للخدمة بيمسح بيانات الانتهاء (بتفضل في السجل). بيرجّع رسالة خطأ أو None."""
    if status not in EMP_STATUSES:
        return "الحالة غير معروفة"
    old_status = e.employmentStatus or "active"
    reason = (reason or "").strip() or None
    if status in ENDED_STATUSES or status == "warning":
        if not end_date:
            return "آخر يوم عمل مطلوب"
        end_type = status if status in ENDED_STATUSES else end_type
        if end_type not in ENDED_STATUSES:
            return "اختار نوع انتهاء الخدمة (استقالة / إنهاء خدمات)"
        if status == "warning" and end_date < datetime.now().date():
            status = end_type
        if (old_status, e.serviceEndDate, e.serviceEndType, e.serviceEndReason) == (status, end_date, end_type, reason):
            return None                              # مفيش تغيير (زي طباعة الاستمارة مرتين)
        e.serviceEndDate, e.serviceEndType, e.serviceEndReason = end_date, end_type, reason
    elif old_status == status:
        return None
    elif old_status in ENDED_STATUSES + ("warning",):
        e.serviceEndDate = e.serviceEndType = e.serviceEndReason = e.serviceEndTransferTo = None
    e.employmentStatus = status
    e.lastUpdated, e.lastUpdatedBy = db.now(), user
    lab = history.EMP_STATUS_LABELS
    label = f"الحالة الوظيفية: {lab.get(old_status, old_status)} ← {lab[status]}"
    if status == "warning":
        label += f" — فترة الإنذار حتى {end_date.isoformat()} وبعدها «{lab[end_type]}»"
    elif status in ENDED_STATUSES:
        label += f" — آخر يوم عمل {end_date.isoformat()}"
    label += (f" — السبب: {reason}" if reason and status in ENDED_STATUSES + ("warning",) else "") \
        + (f" — {note.strip()}" if note and note.strip() else "") + (f" ({source})" if source else "")
    db.push_timeline(s, e.id, "edit", label, user)
    db.log_audit(s, "employee_edit", f"{e.name} ({e.id}): {label}", user)
    _end_track_sync(s, e, user)                    # مسار إنهاء الخدمة بيتفتح / يتلغي مع الحالة
    return None


def _finish_notice_periods(s):
    """الموظفين اللي آخر يوم عمل ليهم في فترة الإنذار عدّى ← الحالة النهائية (مستقيل / إنهاء خدمات)."""
    today = datetime.now().date()
    for e in s.scalars(select(M.Employee).where(M.Employee.employmentStatus == "warning",
                                                M.Employee.serviceEndType.in_(ENDED_STATUSES),
                                                M.Employee.serviceEndDate < today)):
        e.employmentStatus = e.serviceEndType
        label = f"انتهت فترة الإنذار (آخر يوم عمل {e.serviceEndDate.isoformat()}) — الحالة الوظيفية: " \
                f"{history.EMP_STATUS_LABELS[e.serviceEndType]}"
        db.push_timeline(s, e.id, "edit", label, "النظام")
        db.log_audit(s, "employee_edit", f"{e.name} ({e.id}): {label}", "النظام")


@app.post("/api/employees/<emp_id>/status")
@require("employees.edit")
def set_employee_status(emp_id):
    """{status, date (آخر يوم عمل / نهاية الإنذار), endType (resigned | terminated — مع فترة الإنذار), reason, note}"""
    d = body()
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if not e:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        if not me().can(approvals.PERM):           # إنهاء الخدمة ← طلب موافقة (الرجوع للخدمة من غير إنهاء بيتطبّق عادي)
            if d.get("status") not in EMP_STATUSES:
                return err("الحالة غير معروفة")
            ch, msg = approvals.status_changes(e, d.get("status"), db.parse_date(d.get("date")), d.get("endType"), d.get("reason"))
            if msg:
                return err(msg)
            if ch and (set(ch) - {"employmentStatus"} or {d.get("status"), e.employmentStatus} & set(approvals.END_STATES)):
                approvals.request(s, e, "service_end", ch, me(), "الحالة الوظيفية", d.get("note"))
                return jsonify({"ok": True, "pending": [f"{approvals.KINDS['service_end']}: {approvals.describe('service_end', ch)}"]})
        msg = _set_employment_status(s, e, d.get("status"), db.parse_date(d.get("date")), d.get("endType"),
                                     d.get("reason"), d.get("note"), uname())
        if msg:
            return err(msg)
    return jsonify({"ok": True})


@app.delete("/api/employees/<emp_id>")
@require("employees.delete")
def delete_employee(emp_id):
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if not e:
            return err("غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        if not me().can(approvals.PERM):           # من غير صلاحية الموافقة ← طلب حذف بسبب
            reason = (body().get("reason") or "").strip()
            if not reason:
                return err("اكتب سبب الحذف — الطلب بيروح للموافقة")
            approvals.request(s, e, "delete", {}, me(), "بطاقة الموظف", reason)
            return jsonify({"ok": True, "pending": [approvals.KINDS["delete"]]})
        _trash_employee(s, e, uname())
    return jsonify({"ok": True, "trash": True})


def _trash_employee(s, e, user):
    db.log_audit(s, "employee_delete", f"حذف موظف: {e.name} ({e.id}) — اتنقل لسلة المحذوفات", user)
    trash.trash_employee(s, e, user)               # هو وانتماءاته وتصاريحه ← السلة (بيترجع زي ما كان)


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
    lab, user, n, same = TRACKED_DATE_LABELS[field], uname(), 0, 0
    with db.session_scope() as s:
        for eid in dict.fromkeys(d.get("ids") or []):     # من غير تكرار
            e = s.get(M.Employee, eid)
            if not e or not emp_ok(s, eid):
                continue
            # نفس التاريخ متسجّل بالفعل (ضغطة مكررة أو طلب اتبعت مرتين): مانكررش السجل ولا التاريخ
            if getattr(e, field) == new_date and (not d.get("setRenewedStage") or e.govStage == "renewed"):
                same += 1
                continue
            old = db.ser(getattr(e, field))
            setattr(e, field, new_date)
            e.lastUpdated, e.lastUpdatedBy = db.now(), user
            custody.fill_open_expiry(s, eid, field, new_date)      # بند التجديد المفتوح ياخد التاريخ الجديد
            if d.get("setRenewedStage") and e.govStage not in END_STAGES:
                e.govStage, e.govStageNote = "renewed", None
                custody.sync_person(s, "employee", eid, "renewed")
            db.push_timeline(s, eid, "renew", f"تجديد {lab}: {old or '—'} ← {new_date.isoformat()}", user)
            affs = db.get_affiliations(s, eid)
            if field == "residencyExp" and affs and affs[0].get("companyId"):
                db.log_company_history(s, affs[0]["companyId"], "residency_renewed",
                                       f"تجديد إقامة {e.name} حتى {new_date.isoformat()}", user)
            n += 1
        if n:
            db.log_audit(s, "employee_edit", f"تجديد {lab} لـ {n} موظف حتى {new_date.isoformat()}", user)
    return jsonify({"ok": True, "count": n, "unchanged": same})


@app.post("/api/employees/<emp_id>/end-track")
@require("employees.edit")
def end_track_step(emp_id):
    """مسار إنهاء الخدمة: {action: start | type | done | back, type, date, note, company}. الخطوات بالترتيب: الخطوة الشغالة
    بس اللي بتتعلّم «تم». type (للوافد، قبل أول خطوة): xfer تحويل لشركة أخرى / exit إلغاء نهائي. كل خطوة بتتسجّل في سجل
    الموظف بنوعها (= اسم المرحلة)."""
    d = body()
    action, today = d.get("action"), datetime.now().date()
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if not e:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        track = END_STAGE_TRACK.get(e.govStage)
        stages = END_TRACKS[track] if track else ()
        if action == "start":
            if track:
                return err("المسار مفتوح بالفعل")
            if (e.employmentStatus or "active") not in LEAVING_STATUSES:
                return err("المسار بيتفتح لما الحالة تبقى «في فترة الإنذار» أو «مستقيل» أو «إنهاء خدمات»")
            _end_track_sync(s, e, uname())
        elif action == "type":
            new = d.get("type")
            if not pdf_forms.needs_residency(e.nationality) or new not in ("xfer", "exit"):
                return err("نوع الإجراء بيتغيّر للوافد بس (تحويل لشركة أخرى / إلغاء نهائي)")
            if not track:
                return err("افتح المسار الأول")
            if e.govStage != stages[0]:
                return err("نوع الإجراء مايتغيّرش بعد ما خطوة اتعلّمت «تم» — اتراجع عن الخطوات الأول")
            if new != track:
                _end_open(s, e, new, uname(), "نوع الإجراء اتغيّر")
        elif action == "done":
            cur = e.govStage
            if not track or cur == stages[-1]:
                return err("مفيش خطوة مفتوحة في المسار")
            when = db.parse_date(d.get("date")) or today
            if when > today:
                return err("التاريخ ده لسه ماجاش")
            note, extra = (d.get("note") or "").strip(), ""
            if cur == "ex_xfer_request":               # اسم الشركة الجديدة لازم — بيتحفظ في بيانات الموظف
                company = (d.get("company") or "").strip()
                if not company:
                    return err("اكتب اسم الشركة اللي الموظف هيتحوّل عليها")
                e.serviceEndTransferTo, extra = company[:300], f" — الشركة: {company[:300]}"
            label = f"إنهاء خدمة — تم: {END_STEPS[cur]} (بتاريخ {when.day:02d}/{when.month:02d}/{when.year}){extra}" + (f" — {note}" if note else "")
            nxt = stages[stages.index(cur) + 1]
            _end_set(s, e, nxt, label, uname(), tl_type=cur)
            if nxt == stages[-1]:
                db.push_timeline(s, e.id, "gov_stage", f"{END_TRACK_LABELS[track]}: اكتملت الإجراءات", uname())
        elif action == "back":
            if not track or e.govStage == stages[0]:
                return err("مفيش خطوة يتراجع عنها")
            prev = stages[stages.index(e.govStage) - 1]
            _end_set(s, e, prev, f"إنهاء خدمة — تراجع عن: {END_STEPS[prev]}", uname())
        else:
            return err("إجراء غير معروف")
        db.log_audit(s, "employee_edit", f"إنهاء خدمة — {e.name} ({emp_id}): {history.value_label('govStage', e.govStage) or '—'}", uname())
        return jsonify({"ok": True, "govStage": e.govStage})


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
        if "govStage" in d and (d.get("govStage") or None) != e.govStage and (e.govStage in END_STAGES or d.get("govStage") in END_STAGES):
            return err("مسار إنهاء الخدمة بيتغيّر من نافذته (الخطوات بالترتيب)")
        keys = [k for k in ("govStage", "govStageNote", "govStageResponsible", "govStageStartDate", "govTransactionCost")
                if k in d]
        before = [db.ser(getattr(e, k)) for k in keys]
        db.apply(e, {k: d.get(k) for k in keys})
        if [db.ser(getattr(e, k)) for k in keys] == before:
            return jsonify({"ok": True, "unchanged": True})    # مفيش تغيير (ضغطة مكررة): مانسجّلش حاجة
        e.lastUpdated, e.lastUpdatedBy = db.now(), uname()
        custody.sync_person(s, "employee", emp_id, e.govStage)       # بنود العهد اللي المرحلة عدّتها ← «تم»
        db.push_timeline(s, emp_id, "gov_stage", f"مرحلة المعاملة: {history.value_label('govStage', d.get('govStage')) or '—'}"
                         + (f" — {d.get('govStageNote')}" if d.get("govStageNote") else ""), uname())
        db.log_audit(s, "employee_edit", f"تحديث مرحلة معاملة {e.name} ({emp_id})", uname())
    return jsonify({"ok": True})


IMPORTS_DIR = os.path.join(UPLOADS, "imports")


@app.post("/api/employees/import")
@require("employees.edit", "system.import", "sensitive.salary", "sensitive.bank", "sensitive.documents",
         all_companies=True)   # الملف بيكتب كل الحقول ولأي شركة
def import_employees():
    """mode=preview: الملف بيتنفّذ في معاملة بتترجع (مفيش حاجة بتتحفظ) ← اللي هيتغيّر حقل حقل + token.
    mode=apply + token: نفس الملف بيتنفّذ فعلًا. تحديث الموظفين الموجودين بس — الموظف الجديد بيتسجّل من
    «تسجيل موظف جديد»، إلا لو مدير النظام اختار allowAdd (وده بيتسجّل في سجل التدقيق)."""
    mode = "preview" if request.form.get("mode") == "preview" else "apply"
    allow_add = request.form.get("allowAdd") in ("1", "true")
    if allow_add and not me().isAdmin:
        return forbidden("إضافة موظفين جدد من الاستيراد لمدير النظام بس")
    token = request.form.get("token") or ""
    if token:
        if not re.fullmatch(r"[\w-]+\.(xlsx|xls|csv)", token) or not os.path.exists(os.path.join(IMPORTS_DIR, token)):
            return err("الملف مش موجود — اختاره تاني واعمل معاينة")
        path, name = os.path.join(IMPORTS_DIR, token), request.form.get("name") or token
    else:
        f = request.files.get("file")
        if not f or not f.filename:
            return err("لم يتم اختيار ملف")
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in (".xlsx", ".xls", ".csv"):
            return err("الصيغ المدعومة: xlsx, xls, csv")
        os.makedirs(IMPORTS_DIR, exist_ok=True)
        token = f"{datetime.now():%Y%m%d%H%M%S}_{db.new_id('imp')}{ext}"
        path, name = os.path.join(IMPORTS_DIR, token), f.filename
        f.save(path)
    try:
        with db.session_scope(commit=mode == "apply") as s:        # المعاينة مابتتحفظش (rollback)
            u = me()                                             # من غير صلاحية الموافقة ← الحساس بيتحوّل لطلبات
            hold = None if u.can(approvals.PERM) else (lambda s2, e, data: approvals.hold(s2, e, data, u, f"استيراد ملف {name}"))
            stats = importer.import_file(s, path, uname(), allow_add=allow_add, hold=hold)
            batch = stats.pop("_batch", [])
            read = stats["updated"] + stats["unchanged"] + stats["added"] + stats["skipped"] + len(stats["notRegistered"]) + len(stats["held"])
            if not read:                           # ولا صف اتقرا ← الملف مش بالشكل المطلوب (بدل نتيجة كلها أصفار)
                why = "؛ ".join(stats.get("problems") or []) or "مفيش صف فيه رقم مدني"
                raise ValueError(f"{why}. أول صف لازم يكون فيه عمود «الرقم المدني» وعمود «الاسم». "
                                 "لو عايز تكمّل خانات ناقصة بس (تليفونات، إيميلات…) استخدم «📥 استيراد بيانات تكميلية».")
            if mode == "apply" and batch:           # كل خانة اتغيّرت بقيمتها القديمة ← «↩️ تراجع» عن الدفعة كلها
                stats["batchId"] = import_extra.record_file_import(s, name, stats, batch, uname())
            if mode == "apply":
                miss, added = stats["notRegistered"], stats["addedList"]
                db.log_audit(s, "employee_add" if added else "employee_edit",
                             f"استيراد ملف {name}: {stats['updated']} تحديث"
                             + (f"، إضافة {len(added)} موظف جديد (بصلاحية مدير النظام — {uname()})" if added else "")
                             + (f"، تخطّي {len(miss)} رقم مدني مش مسجّل ({'، '.join(x['id'] for x in miss[:20])}"
                                + ("…" if len(miss) > 20 else "") + ")" if miss else "")
                             + (f"، {len(stats['guarded'])} قيمة إنجليزي ماكتبتش على الخانات العربي" if stats["guarded"] else ""), uname())
    except ValueError as e:
        return err(f"الملف ماتقراش: {e}")
    except Exception as e:
        return err(f"خطأ في قراءة الملف: {e}")
    return jsonify({"ok": True, "mode": mode, "token": token, "fileName": name, "allowAdd": allow_add, **stats})


# ---------------------------------------------------------------------------
# الاستيراد التكميلي (import_extra.py) — القسم 27: بيملى الفاضي بس، ومعاينة قبل الحفظ، وتراجع
# ---------------------------------------------------------------------------
def _extra_file(token):
    path = os.path.join(IMPORTS_DIR, token or "")
    return path if re.fullmatch(r"[\w-]+\.(xlsx|xls|csv)", token or "") and os.path.exists(path) else None


@app.post("/api/import-extra/upload")
@admin_required
def import_extra_upload():
    """الملف ← الشيتات وعناوينها وعينة، واقتراح عمود المطابقة والأعمدة اللي تتاخد."""
    f = request.files.get("file")
    if not f or not f.filename:
        return err("لم يتم اختيار ملف")
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".xlsx", ".xls", ".csv"):
        return err("الصيغ المدعومة: xlsx, xls, csv")
    os.makedirs(IMPORTS_DIR, exist_ok=True)
    token = f"{datetime.now():%Y%m%d%H%M%S}_{db.new_id('ix')}{ext}"
    path = os.path.join(IMPORTS_DIR, token)
    f.save(path)
    try:
        sheets = import_extra.describe(path)
    except Exception as e:                      # noqa: BLE001 — ملف مش مفهوم
        return err(f"خطأ في قراءة الملف: {e}")
    return jsonify({"ok": True, "token": token, "fileName": f.filename, "sheets": sheets,
                    "fields": {k: v[0] for k, v in import_extra.EMP_FIELDS.items()},
                    "vehFields": {k: v[0] for k, v in import_extra.VEH_FIELDS.items()},
                    "vehImportFields": import_extra.VEH_IMPORT_FIELDS,
                    "matchBy": {k: v[0] for k, v in import_extra.MATCH_BY.items()}})


def _extra_plan(s, d):
    path = _extra_file(d.get("token"))
    if not path:
        raise ValueError("الملف مش موجود — ارفعه تاني")
    rows = import_extra.read_book(path).get(d.get("sheet"))
    if rows is None:
        raise ValueError("الشيت مش موجود")
    if d.get("target") == "vehicles":
        return import_extra.analyze_vehicles(s, rows, int(d.get("headerRow") or 0), d.get("map"), d.get("companyId"), d.get("confirm"))
    mc = d.get("matchCol")
    return import_extra.analyze(s, rows, int(d.get("headerRow") or 0), int(mc) if mc not in (None, "") else None,
                                d.get("matchBy"), d.get("map"), d.get("confirm"))


@app.post("/api/import-extra/preview")
@admin_required
def import_extra_preview():
    """{token, sheet, headerRow, matchCol, matchBy, map: {عمود: خانة}, confirm: {صف: رقم مدني}} ← المعاينة (مابتحفظش)."""
    d = body()
    with db.session_scope(commit=False) as s:
        try:
            _, res = _extra_plan(s, d)
        except ValueError as e:
            return err(str(e))
    return jsonify({"ok": True, **res})


@app.post("/api/import-extra/apply")
@admin_required
def import_extra_apply():
    """نفس المعاينة ← الخانات الفاضية بتتملى في دفعة واحدة متسجّلة (تقدر تعمل لها تراجع)."""
    d = body()
    with db.session_scope() as s:
        try:
            plan, res = _extra_plan(s, d)
        except ValueError as e:
            return err(str(e))
        if not res["fillTotal"]:
            return err("مفيش خانات فاضية هتتملى من الملف ده")
        if d.get("target") == "vehicles":
            batch, summary = import_extra.apply_vehicles(s, plan, d.get("fileName") or d.get("token"), d.get("sheet"), uname(), res, d.get("companyId"))
            db.log_audit(s, "vehicle_import", f"استيراد السيارات: {batch.fileName} ({batch.sheet}) — اتضاف {summary['added']} عربية "
                         f"واتكمّلت {summary['updated']}، واتخطّى {summary['skipped']} سطر", uname())
            return jsonify({"ok": True, "batchId": batch.id, **summary})
        batch, summary = import_extra.apply_plan(s, plan, d.get("fileName") or d.get("token"), d.get("sheet"), uname(), res)
        db.log_audit(s, "employee_import", f"استيراد تكميلي: {batch.fileName} ({batch.sheet}) — اتملى {summary['values']} خانة "
                     f"لـ {summary['employees']} موظف" + (f"، {summary['conflicts']} مختلف اتساب زي ما هو" if summary["conflicts"] else ""), uname())
        return jsonify({"ok": True, "batchId": batch.id, **summary})


@app.get("/api/import-extra/batches")
@admin_required
def import_extra_batches():
    with db.session_scope(commit=False) as s:
        counts = dict(s.execute(select(M.ImportChange.batchId, func.count()).group_by(M.ImportChange.batchId)).all())
        return jsonify({"batches": [import_extra.batch_api(b, counts)
                                    for b in s.scalars(select(M.ImportBatch).order_by(M.ImportBatch.createdAt.desc()))]})


@app.post("/api/import-extra/batches/<bid>/undo")
@admin_required
def import_extra_undo(bid):
    """التراجع: القيمة القديمة بترجع للخانات اللي لسه زي ما الاستيراد سابها (اللي اتعدّلت بعده بتفضل)."""
    with db.session_scope() as s:
        b = s.get(M.ImportBatch, bid)
        if b is None:
            return err("الدفعة غير موجودة", 404)
        if b.undoneAt:
            return err("الدفعة دي اتعملها تراجع قبل كده")
        # دفعة أحدث (لسه متطبّقة) عدّلت نفس السجلات ← تترجع هي الأول، وإلا القيم بتتلخبط
        mine = select(M.ImportChange.recordId).where(M.ImportChange.batchId == b.id)
        later = s.scalar(select(M.ImportBatch).where(M.ImportBatch.createdAt > b.createdAt, M.ImportBatch.undoneAt.is_(None),
                                                     M.ImportBatch.id.in_(select(M.ImportChange.batchId).where(M.ImportChange.recordId.in_(mine))))
                         .order_by(M.ImportBatch.createdAt.desc()).limit(1))
        if later is not None:
            return err(f"فيه دفعة أحدث عدّلت نفس السجلات («{later.fileName}») — اعمل لها تراجع الأول", 409, block=True)
        restored, kept = import_extra.undo_batch(s, b, uname())
        what = "استيراد الموظفين" if b.target == import_extra.FILE_TARGET else "استيراد تكميلي"
        db.log_audit(s, "import_undo", f"تراجع عن {what}: {b.fileName} ({b.sheet}) — رجّع {restored} خانة"
                     + (f"، و{len(kept)} خانة اتعدّلت بعد الاستيراد فاتسابت" if kept else ""), uname())
    return jsonify({"ok": True, "restored": restored, "kept": kept})


# النماذج الرسمية (pdf_forms.py): الإقامة ورخصة القيادة — PDF متعبّي والخانات قابلة للتعديل قبل الطباعة.
# الجسم: {action, person: {...}, company: {...}} = اللي اتكتب في نافذة البيانات الناقصة. بيتكتب في النموذج حتى لو
# المستخدم مايقدرش يحفظه (الحفظ في مكانه بيتعمل من الواجهة بالـ PUT العادي بكل فحوصاته قبل الطلب ده).
def _official_form(form, person, company, who, extra=None):
    f = pdf_forms.FORMS[form]
    d = body()
    action = d.get("action") or f["actions"][0]
    if action not in f["actions"]:
        return None, err("نوع الإجراء غير معروف")
    p = {k: v for k, v in (d.get("person") or {}).items() if k in pdf_forms.PERSON_KEYS and v not in (None, "")}
    c = {k: v for k, v in (d.get("company") or {}).items() if k in pdf_forms.COMPANY_KEYS and v not in (None, "")}
    person = {**person, **p}
    if who[0] == "employee":
        person["civilId"] = person["id"]
    data = pdf_forms.fill(form, person, {**(company or {}), **c}, action, extra)
    name = f"{f['title']} - {person.get('name')}.pdf"
    return (data, name, action), None


# اختيارات نافذة استمارة 103: المفوّض (من شركة الموظف) وتاريخ التوقيع والمبالغ والمكافأة وسبب انتهاء الخدمة
FORM_EXTRA_KEYS = ("signDate", "endReason", "reward", "rewardPaid", "socialAllowance", "allowances", "lastSalaryDate")


def _form_extra(s, cid):
    d = body()
    x = {k: d[k] for k in FORM_EXTRA_KEYS if d.get(k) not in (None, "")}
    # «أول مفوّض في الشركة» (من غير اختيار) ← أول مفوّض لشركة الموظف، زي العقود
    sig = s.get(M.Signatory, d["sig"]) if d.get("sig") else \
        (s.scalars(select(M.Signatory).where(M.Signatory.companyId == cid)).first() if cid else None)
    if sig and sig.companyId == cid:
        x["sigName"], x["sigTitle"] = sig.nameAr, sig.title
    return x


def _send_pdf(data, name):
    return send_file(io.BytesIO(data), as_attachment=False, download_name=name, mimetype="application/pdf")


@app.post("/api/employees/<emp_id>/forms/<form>")
@require("employees.view")
def employee_official_form(emp_id, form):
    if form not in pdf_forms.FORMS:
        abort(404)
    if form == "residency" and not me().can("sensitive.documents"):
        return forbidden("العملية دي غير متاحة")
    with db.session_scope() as s:
        emp = db.employee_full(s, emp_id)
        if not emp:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        if form == "residency" and not pdf_forms.needs_residency(emp.get("nationality")):
            return err("المواطنين الكويتيين ومواطني الخليج مالهمش إقامة")
        nat = emp.get("nationality")
        if pdf_forms.FORMS[form].get("kuwaiti") and not (pdf_forms.is_kuwaiti(nat) or (form == "pifss103" and not pdf_forms.needs_residency(nat))):
            return err("النموذج ده للعمالة الوطنية بس (الكويتيين ومعاملة كويتية)")     # استمارة 103 للخليجي كمان
        if not me().can("sensitive.salary"):
            emp["salary"] = None                    # الراتب في استمارة 103 للي معاه صلاحية الرواتب بس
        cid = next((a["companyId"] for a in emp.get("affiliations") or [] if a.get("companyId")), None)
        out, bad = _official_form(form, emp, db.to_dict(s.get(M.Company, cid)) if cid else None, ("employee", emp_id),
                                  _form_extra(s, cid))
        if bad:
            return bad
        db.log_audit(s, f"employee_{form}_form", f"{pdf_forms.FORMS[form]['title']} ({out[2]}) للموظف: {emp['name']} ({emp_id})",
                     uname())
        end = db.parse_date(emp.get("serviceEndDate"))
        if form == "pifss103" and out[2] == "إنهاء خدمة" and _truthy(body().get("setStatus")) and end and me().can("employees.edit"):
            reason = body().get("endReason")
            e_obj = s.get(M.Employee, emp_id)
            if me().can(approvals.PERM):
                _set_employment_status(s, e_obj, "warning", end, end_type_for_reason(reason), reason, user=uname(), source="استمارة 103")
            else:                                  # من غير صلاحية الموافقة ← طلب إنهاء خدمة
                ch, msg = approvals.status_changes(e_obj, "warning", end, end_type_for_reason(reason), reason)
                if ch and not msg:
                    approvals.request(s, e_obj, "service_end", ch, me(), "استمارة 103")
        if form == "pifss103" and out[2] == "إنهاء خدمة" and me().can("employees.edit"):
            e_obj = s.get(M.Employee, emp_id)       # الاستمارة اتطبعت ← أول خطوة في مسار إنهاء الخدمة «تم»
            if e_obj.govStage == KW_END_STAGES[0]:
                _end_set(s, e_obj, KW_END_STAGES[1], f"إنهاء خدمة — تم: {END_STEPS[KW_END_STAGES[0]]} (اتطبعت من السيستم)", uname(),
                         tl_type=KW_END_STAGES[0])
    return _send_pdf(out[0], out[1])


@app.post("/api/candidates/<cand_id>/forms/<form>")
@require("recruitment.view")
def candidate_official_form(cand_id, form):
    """رخصة القيادة لأي مترشّح، واستمارة 103 والعلاوة الاجتماعية للعمالة الوطنية (مع عقد العمل في أول مرحلة)."""
    if form not in ("driving", "pifss103", "social"):
        abort(404)
    with db.session_scope() as s:
        c = s.get(M.Candidate, cand_id)
        if not c:
            return err("المترشّح غير موجود", 404)
        if not me().record_ok(c.targetCompanyId, db.cost_center_company(s, c.costCenter), c.costCenter):
            return forbidden(OUT_OF_SCOPE)
        if pdf_forms.FORMS[form].get("kuwaiti") and not pdf_forms.is_kuwaiti(c.nationality):
            return err("النموذج ده للعمالة الوطنية بس (الكويتيين ومعاملة كويتية)")
        company = db.to_dict(s.get(M.Company, c.targetCompanyId)) if c.targetCompanyId else None
        out, bad = _official_form(form, me().strip("candidate", db.employee_dict(c)), company, ("candidate", cand_id),
                                  _form_extra(s, c.targetCompanyId))
        if bad:
            return bad
        db.log_audit(s, f"candidate_{form}_form", f"{pdf_forms.FORMS[form]['title']} ({out[2]}) للمترشّح: {c.name}", uname())
    return _send_pdf(out[0], out[1])


# إقرار مخالصة عمالية نهائية (الهيئة العامة للقوى العاملة): forms/clearance.docx بمحرك العقود — نفس الشركة
# ورقم الملف والمفوّض والتوقيعات. الجسم: {procedure: transfer|travel, date, sig, signFirst, signSecond, person, company}
CLEARANCE_PATH = os.path.join(BASE_DIR, "forms", "clearance.docx")
CLEARANCE_PERSON_KEYS = {"nameEn", "nationality", "dateOfHire", "serviceEndDate"}


@app.post("/api/employees/<emp_id>/clearance/<fmt>")
@require("employees.view")
def employee_clearance(emp_id, fmt):
    if fmt not in ("pdf", "docx"):
        abort(404)
    if fmt == "docx":
        return forbidden(NO_DOWNLOAD)
    d = body()
    _check_sign_args(d)
    with db.session_scope(commit=False) as s:
        emp = db.employee_full(s, emp_id)
        if not emp:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        # اللي اتكتب في نافذة البيانات الناقصة (بيتحفظ من الواجهة، وهنا بيتكتب في الإقرار في كل الأحوال)
        emp.update({k: v for k, v in (d.get("person") or {}).items() if k in CLEARANCE_PERSON_KEYS and v})
        proc = d.get("procedure")
        extra = {"period_from": docx_engine.fmt_date(emp.get("dateOfHire")),
                 "period_to": docx_engine.fmt_date(emp.get("serviceEndDate")),
                 "proc_transfer": "✔" if proc == "transfer" else "", "proc_travel": "✔" if proc == "travel" else ""}
        if (d.get("company") or {}).get("nameEn"):
            extra["company_name_en"] = d["company"]["nameEn"]
        args = {"date": d.get("date") or datetime.now().strftime("%Y-%m-%d"), "sig": d.get("sig"),
                "signFirst": d.get("signFirst"), "signSecond": d.get("signSecond")}
        _, _, data = _build_contract(s, emp, args, extra=extra, path=CLEARANCE_PATH, sig_height=1.0)   # صفحة واحدة
    if fmt == "pdf":
        try:
            data = contracts.to_pdf(data)
        except RuntimeError as e:
            return err(str(e), 501)
    with db.session_scope() as s:
        db.log_audit(s, "employee_clearance", f"إقرار مخالصة عمالية ({fmt.upper()}) للموظف: {emp['name']} ({emp_id})", uname())
        e_obj = s.get(M.Employee, emp_id)
        if proc == "travel" and e_obj is not None and e_obj.govStage == "ex_exit_clearance" and me().can("employees.edit"):
            _end_set(s, e_obj, "ex_exit_pam", f"إنهاء خدمة — تم: {END_STEPS['ex_exit_clearance']} (اتطبعت من السيستم)", uname(),
                     tl_type="ex_exit_clearance")
    mime = "application/pdf" if fmt == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return send_file(io.BytesIO(data), as_attachment=fmt == "docx", download_name=f"إقرار مخالصة - {emp['name']}.{fmt}",
                     mimetype=mime)


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
    kind, problem = check_upload(f)
    if problem:
        return err(problem)
    folder = os.path.join(UPLOADS, "employees", emp_id)
    os.makedirs(folder, exist_ok=True)
    fid = db.new_id("f")
    path = os.path.join(folder, fid + "_" + os.path.splitext(secure_filename(f.filename) or "file")[0] + kind)
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
    return send_viewable(db.resolve_file(r.path), r.name)    # عرض بس


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
        s.query(M.Vehicle).filter(M.Vehicle.ownerCompanyId == cid).update({"ownerCompanyId": None})
        s.query(M.Candidate).filter(M.Candidate.targetCompanyId == cid).update({"targetCompanyId": None, "targetProjectId": None})
        s.query(M.CostCenter).filter(M.CostCenter.companyId == cid).update({"companyId": None})
        pids = [p.id for p in s.scalars(select(M.Project).where(M.Project.companyId == cid))]
        if pids:
            s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.projectId.in_(pids)) \
                .update({"projectId": None}, synchronize_session=False)
            s.query(M.Vehicle).filter(M.Vehicle.projectId.in_(pids)).update({"projectId": None}, synchronize_session=False)
            s.query(M.Vehicle).filter(M.Vehicle.affairsProjectId.in_(pids)).update({"affairsProjectId": None}, synchronize_session=False)
            s.query(M.Permit).filter(M.Permit.projectId.in_(pids)).update({"projectId": None}, synchronize_session=False)
            s.query(M.Candidate).filter(M.Candidate.targetProjectId.in_(pids)) \
                .update({"targetProjectId": None}, synchronize_session=False)
        aids =[a.id for a in s.scalars(select(M.Agency).where(M.Agency.companyId == cid))]
        if aids:
            s.query(M.Project).filter(M.Project.agencyId.in_(aids)).update({"agencyId": None}, synchronize_session=False)
            s.query(M.AgencyCostCenter).filter(M.AgencyCostCenter.agencyId.in_(aids)).delete(synchronize_session=False)
            s.query(M.Agency).filter(M.Agency.id.in_(aids)).delete(synchronize_session=False)
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
    image = kind in ("logo", "letterhead")         # letterhead = ورق الشركة الرسمي (صورة A4 — لمعاينة الشهادات بس)
    if kind not in DOC_KINDS and not image:
        return err("نوع مستند غير معروف")
    if not me().company_ok(cid):
        return forbidden(OUT_OF_SCOPE)
    with db.session_scope(commit=False) as s:
        if not s.get(M.Company, cid):
            return err("غير موجود", 404)
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    ext, problem = check_upload(f, images_only=image)
    if problem:
        return err(problem)
    folder = os.path.join(UPLOADS, {"logo": "logos", "letterhead": "letterheads"}.get(kind, "companies"))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{cid}_{kind}{ext}")
    f.save(path)
    rel = db.rel_file(path)
    with db.session_scope() as s:
        if kind == "logo":
            c = s.get(M.Company, cid)
            if c:
                c.logoPath = rel
        elif kind == "letterhead":
            c = s.get(M.Company, cid)
            if c:
                if c.letterheadPath and c.letterheadPath != rel:           # صورة قديمة بامتداد تاني
                    _remove_quietly(db.resolve_file(c.letterheadPath))
                c.letterheadPath = rel
                c.letterheadTop, c.letterheadBottom = letters.measure_paper(path) or (None, None)
                db.log_audit(s, "company_edit", f"رفع ورق الشركة الرسمي: {c.nameAr}" + (
                    f" (الترويسة {c.letterheadTop:g} مم، التذييل {c.letterheadBottom:g} مم)" if c.letterheadTop is not None else ""), uname())
                return jsonify({"ok": True, "top": c.letterheadTop, "bottom": c.letterheadBottom})
        else:
            s.merge(M.CompanyDoc(companyId=cid, kind=kind, name=f.filename, path=rel, uploadedAt=db.now()))
    return jsonify({"ok": True})


@app.delete("/api/companies/<cid>/docs/<kind>")
@require("companies.edit")
def delete_company_doc(cid, kind):
    if not me().company_ok(cid):
        return forbidden(OUT_OF_SCOPE)
    with db.session_scope() as s:
        if kind == "letterhead":
            c = s.get(M.Company, cid)
            if c is not None and c.letterheadPath:
                _remove_quietly(db.resolve_file(c.letterheadPath))
                c.letterheadPath = c.letterheadTop = c.letterheadBottom = None
                db.log_audit(s, "company_edit", f"حذف ورق الشركة الرسمي: {c.nameAr}", uname())
            return jsonify({"ok": True})
        d = s.get(M.CompanyDoc, (cid, kind))
        if d:
            s.delete(d)
    return jsonify({"ok": True})


def _remove_quietly(path):
    try:
        os.remove(path)
    except OSError:
        pass


@app.get("/files/letterhead/<cid>")
@require("companies.view")
def get_letterhead(cid):
    """صورة ورق الشركة الرسمي (للعرض في بيانات الشركة)."""
    if not me().company_ok(cid):
        abort(403)
    with db.session_scope(commit=False) as s:
        c = s.get(M.Company, cid)
    if not c or not c.letterheadPath:
        abort(404)
    return send_viewable(db.resolve_file(c.letterheadPath))


@app.get("/files/company/<cid>/<kind>")
@require("companies.view")
def get_company_doc(cid, kind):
    if not me().company_ok(cid):
        abort(403)
    with db.session_scope(commit=False) as s:
        r = s.get(M.CompanyDoc, (cid, kind))
    if not r or not r.path:
        abort(404)
    return send_viewable(db.resolve_file(r.path), r.name)


@app.get("/files/logo/<cid>")
@login_required
def get_logo(cid):
    with db.session_scope(commit=False) as s:
        c = s.get(M.Company, cid)
    if not c or not c.logoPath:
        abort(404)
    return send_viewable(db.resolve_file(c.logoPath))


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
            ext, problem = check_upload(f)
            if problem:
                return err(problem)
            os.makedirs(os.path.join(UPLOADS, "signatories"), exist_ok=True)
            path = os.path.join(UPLOADS, "signatories", f"{civil_id}{ext}")
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
    return send_viewable(db.resolve_file(r.path), r.name)


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


PROJECT_KINDS = ("main", "gov", "sub")
PERMIT_PROJECT_KINDS = ("gov", "sub")       # العقود اللي التصاريح بتطلع عليها (وبتحد تاريخها)


def _project_fields(s, d, company_id):
    """النوع (ترخيص رئيسي / عقد حكومي / عقد من الباطن)، والوكالة للعقد الحكومي بس، ورقم العقد للحكومي واللي من
    الباطن — والوكالة لازم تبقى من نفس الشركة."""
    if "kind" in d and d["kind"] not in PROJECT_KINDS:
        d["kind"] = None
    if "kind" in d and d.get("kind") != "gov":
        d["agencyId"] = None
    if "kind" in d and d.get("kind") not in PERMIT_PROJECT_KINDS:
        d["contractNo"] = None
    if d.get("agencyId"):
        a = s.get(M.Agency, d["agencyId"])
        if a is None or a.companyId != company_id:
            return "الوكالة مش تبع الشركة دي"
    return None


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
        msg = _project_fields(s, d, d["companyId"])
        if msg:
            return err(msg)
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
        msg = _project_fields(s, d, d.get("companyId") or p.companyId)
        if msg:
            return err(msg)
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
        s.query(M.Vehicle).filter(M.Vehicle.projectId == pid).update({"projectId": None})
        s.query(M.Vehicle).filter(M.Vehicle.affairsProjectId == pid).update({"affairsProjectId": None})
        s.query(M.Permit).filter(M.Permit.projectId == pid).update({"projectId": None})
        s.query(M.Candidate).filter(M.Candidate.targetProjectId == pid).update({"targetProjectId": None})
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
    d.pop("govLicenseExpiry", None)                # تاريخ واحد للعربية: الرخصة والتأمين (insuranceExpiry)
    with db.session_scope() as s:
        old = s.get(M.Vehicle, vid) if vid else None
        if (old and not opt_company_ok(old.companyId)) or not opt_company_ok(d.get("companyId") or None):
            return forbidden("اختار شركة السيارة من القائمة")
        if s.scalar(select(M.Vehicle).where(M.Vehicle.plate == plate, M.Vehicle.id != (vid or ""))):
            return err(f"رقم اللوحة {plate} مسجّل بالفعل", 409, block=True)
        if d.get("projectId"):
            p = s.get(M.Project, d["projectId"])
            if p is None:
                return err("العقد / المشروع غير موجود")
            cid = d["companyId"] if "companyId" in d else (old.companyId if old else None)
            if (cid or None) != p.companyId:      # العقد تبع الشركة اللي العربية مسجّلة باسمها بس
                return err("العقد / المشروع ده تبع شركة تانية — اختار الشركة اللي العربية مسجّلة باسمها الأول")
        if "costCenter" in d:
            d["costCenter"] = d["costCenter"] or None
            if d["costCenter"] and not s.scalar(select(M.CostCenter).where(M.CostCenter.name == d["costCenter"])):
                return err("مركز التكلفة غير موجود")
        if "vehicleType" in d and d["vehicleType"] not in VEHICLE_TYPES:
            d["vehicleType"] = None
        if "ownerCompanyId" in d:                  # المالك الفعلي: فاضي أو نفس المسجّلة باسمها = نفسها
            reg = d["companyId"] if "companyId" in d else (old.companyId if old else None)
            owner = d["ownerCompanyId"] or None
            if owner and s.get(M.Company, owner) is None:
                return err("الشركة المالكة غير موجودة")
            if owner and owner != (old.ownerCompanyId if old else None) and not me().company_ok(owner):
                return forbidden(NEW_OUT_OF_SCOPE)
            d["ownerCompanyId"] = None if owner == (reg or None) else owner
        if "projectId" in d:
            d["projectId"] = d["projectId"] or None
        if "affairsProjectId" in d:                # ملف الشؤون: ملف من ملفات الشركة المسجّلة باسمها
            d["affairsProjectId"] = d["affairsProjectId"] or None
            if d["affairsProjectId"]:
                p = s.get(M.Project, d["affairsProjectId"])
                cid = d["companyId"] if "companyId" in d else (old.companyId if old else None)
                if p is None:
                    return err("ملف الشؤون غير موجود")
                if (cid or None) != p.companyId:
                    return err("ملف الشؤون ده تبع شركة تانية — اختار الشركة اللي العربية مسجّلة باسمها الأول")
        # مع مين: موظف (أي موظف) أو اسم حر — الموظف بيكسب
        if "driverId" in d:
            d["driverId"] = d["driverId"] or None
            if d["driverId"] and s.get(M.Employee, d["driverId"]) is None:
                return err("الموظف غير موجود")
        if "userName" in d or d.get("driverId"):
            d["userName"] = None if d.get("driverId") else ((d.get("userName") or "").strip() or None)
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


VEHICLE_TYPES = ("private", "truck", "pickup", "tanker", "bus", "motorcycle", "equipment", "other")


# ---------------------------------------------------------------------------
# الوكالات: {companyId, nameAr, nameEn, costCenterIds: [...]}
# ---------------------------------------------------------------------------
@app.post("/api/agencies")
@app.put("/api/agencies/<aid>")
@require("companies.edit")
def save_agency(aid=None):
    d = body()
    name = (d.get("nameAr") or "").strip()
    if not name:
        return err("اسم الوكالة مطلوب")
    with db.session_scope() as s:
        a = s.get(M.Agency, aid) if aid else None
        if aid and a is None:
            return err("غير موجود", 404)
        cid = a.companyId if a is not None else d.get("companyId")
        if not cid or s.get(M.Company, cid) is None:
            return err("الشركة مطلوبة")
        if not me().company_ok(cid):
            return forbidden(OUT_OF_SCOPE)
        if a is None:
            n = s.scalar(select(func.count()).select_from(M.Agency).where(M.Agency.companyId == cid)) or 0
            a = M.Agency(id=db.new_id("ag"), companyId=cid, position=n + 1, nameAr=name)
            s.add(a)
        a.nameAr, a.nameEn = name, (d.get("nameEn") or "").strip() or None
        _agency_form_fields(s, a, d)
        s.flush()
        if "costCenterIds" in d:                     # مراكز التكلفة التابعة ليها (المراكز نفسها مابتتغيّرش)
            s.query(M.AgencyCostCenter).filter(M.AgencyCostCenter.agencyId == a.id).delete()
            for ccid in dict.fromkeys(d.get("costCenterIds") or []):
                if s.get(M.CostCenter, ccid) is not None:
                    s.add(M.AgencyCostCenter(agencyId=a.id, costCenterId=ccid))
        db.log_company_history(s, cid, "agency_saved", f"{'تعديل' if aid else 'إضافة'} وكالة: {name}", uname())
        return jsonify({"ok": True, "id": a.id})


def _json_list(text):
    try:
        v = json.loads(text or "[]")
        return [str(x) for x in v if str(x).strip()] if isinstance(v, list) else []
    except ValueError:
        return []


def _agency_form_fields(s, a, d):
    """بيانات نماذج التصاريح على الوكالة: اسم المقاول عند الجهة، المعتمدين (أسماء)، والمناديب (موظفين — الأول افتراضي)."""
    for k in ("contractorAr", "contractorEn"):
        if k in d:
            setattr(a, k, (d[k] or "").strip() or None)
    if "signatories" in d:
        names = list(dict.fromkeys(str(x).strip() for x in (d["signatories"] or []) if str(x).strip()))
        a.signatories = json.dumps(names, ensure_ascii=False) if names else None
    if "mandoubs" in d:
        ids = [i for i in dict.fromkeys(str(x).strip() for x in (d["mandoubs"] or [])) if i and s.get(M.Employee, i) is not None]
        a.mandoubs = json.dumps(ids) if ids else None


# ---------------------------------------------------------------------------
# نماذج تصاريح السيارات (permit_forms.py): معاينة وطباعة بس، بالبيانات اللي المستخدم راجعها في النافذة
# ---------------------------------------------------------------------------
VEHICLE_FORM_FIELDS = ("color", "color2", "shape", "shapeEn", "chassisNo", "modelYear", "modelEn", "permitCode")
PROJECT_FORM_FIELDS = ("clientStartDate", "clientEndDate", "clientExtDate", "clientTeam", "clientTeamEn", "clientTeamCode", "clearancePrefix")


@app.post("/api/permit-forms/<kind>/pdf")
@require("permits.view")
def permit_forms_pdf(kind):
    """نماذج تصاريح السيارات PDF: {forms: [clearance | checklist | undertaking | request | ratqa], data: {…}}.
    data = اللي ظاهر في النافذة (متملّي من البرنامج والمستخدم عدّل اللي عايزه) — vehicles: [{id, plate, …}].
    كل نموذج بيتسجّل في سجل تصاريح كل عربية."""
    d = body()
    forms, data = d.get("forms") or [], d.get("data") or {}
    msg = permit_forms.check(kind, forms, data)
    if msg:
        return err(msg)
    if not permit_forms.available():
        return err("قوالب نماذج التصاريح مش موجودة على السيرفر (forms/permits)", 501)
    names = dict(permit_forms.FORMS[kind])
    with db.session_scope() as s:
        ids = []
        for v in data.get("vehicles") or []:
            if v.get("id"):                              # عربية من البرنامج ← لازم تبقى في نطاق المستخدم
                _, e = _permit_holder(s, "vehicle", v["id"], "view")
                if e:
                    return e
                ids.append(v["id"])
        try:
            pdf = permit_forms.render(kind, forms, data)
        except RuntimeError as ex:
            return err(str(ex), 501)
        label = f"{permit_forms.KINDS[kind]} — " + "، ".join(names[f] for f in forms)
        for vid in dict.fromkeys(ids):
            _plog(s, "vehicle", vid, None, "form", f"نموذج: {label}")
        plates = "، ".join(str(v.get("plate") or "") for v in data.get("vehicles") or [])
        db.log_audit(s, "permit_print", f"طباعة نماذج تصاريح السيارات: {label} — {plates}"[:900], uname())
    name = names[forms[0]] if len(forms) == 1 else f"نماذج {permit_forms.KINDS[kind]}"
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", as_attachment=False, download_name=f"{name}.pdf")


@app.put("/api/permit-forms/data")
@require("permits.edit")
def permit_forms_save():
    """«حفظ التعديلات في البيانات» من نافذة النماذج: {vehicles: [{id, color, shape, …}], project: {id, clientStartDate, …},
    agency: {id, contractorAr, contractorEn}, mandoub: {id, phone}} — كل جزء بصلاحية قسمه، وكله أو لا شيء."""
    d, u = body(), me()
    with db.session_scope() as s:
        done = []
        vs = [v for v in d.get("vehicles") or [] if v.get("id")]
        if vs:
            if not u.can("vehicles.edit"):
                return forbidden("حفظ بيانات السيارات محتاج صلاحية «تعديل السيارات»")
            for x in vs:
                v = s.get(M.Vehicle, x["id"])
                if v is None:
                    return err("السيارة غير موجودة", 404)
                if not opt_company_ok(v.companyId):
                    return forbidden(OUT_OF_SCOPE)
                new = {k: (str(x[k]).strip() or None) if x.get(k) is not None else None for k in VEHICLE_FORM_FIELDS if k in x}
                if any(getattr(v, k) != val for k, val in new.items()):
                    db.apply(v, new)
                    done.append(f"السيارة {v.plate}")
        pr, ag = d.get("project") or {}, d.get("agency") or {}
        if pr.get("id") or ag.get("id"):
            if not u.can("companies.edit"):
                return forbidden("حفظ بيانات العقد محتاج صلاحية «تعديل الشركات»")
        if pr.get("id"):
            p = s.get(M.Project, pr["id"])
            if p is None:
                return err("العقد غير موجود", 404)
            if not u.company_ok(p.companyId):
                return forbidden(OUT_OF_SCOPE)
            before = db.to_dict(p)
            db.apply(p, {k: (pr[k] or None) for k in PROJECT_FORM_FIELDS if k in pr})
            if db.to_dict(p) != before:
                done.append(f"العقد {p.nameAr}")
        if ag.get("id"):
            a = s.get(M.Agency, ag["id"])
            if a is None:
                return err("الوكالة غير موجودة", 404)
            if not u.company_ok(a.companyId):
                return forbidden(OUT_OF_SCOPE)
            before = (a.contractorAr, a.contractorEn)
            _agency_form_fields(s, a, {k: ag[k] for k in ("contractorAr", "contractorEn") if k in ag})
            if (a.contractorAr, a.contractorEn) != before:
                done.append(f"الوكالة {a.nameAr}")
        mb = d.get("mandoub") or {}
        if mb.get("id") and "phone" in mb:
            e = s.get(M.Employee, mb["id"])
            phone = str(mb.get("phone") or "").strip() or None
            if e is not None and e.phone != phone:
                if not u.can("employees.edit") or not emp_ok(s, e.id):
                    return forbidden("حفظ تليفون المندوب محتاج صلاحية «تعديل الموظفين»")
                e.phone, e.lastUpdated, e.lastUpdatedBy = phone, db.now(), uname()
                db.push_timeline(s, e.id, "edit", f"تعديل الهاتف: {phone or '—'} (من نماذج التصاريح)", uname())
                done.append(f"تليفون {e.name}")
        if done:
            db.log_audit(s, "permit_edit", "نماذج التصاريح — حفظ بيانات: " + "، ".join(done), uname())
    return jsonify({"ok": True, "saved": done})


@app.delete("/api/agencies/<aid>")
@require("companies.delete")
def delete_agency(aid):
    with db.session_scope() as s:
        a = s.get(M.Agency, aid)
        if a is None:
            return jsonify({"ok": True})
        if not me().company_ok(a.companyId):
            return forbidden(OUT_OF_SCOPE)
        s.query(M.Project).filter(M.Project.agencyId == aid).update({"agencyId": None})
        s.query(M.AgencyCostCenter).filter(M.AgencyCostCenter.agencyId == aid).delete()
        s.flush()
        db.log_company_history(s, a.companyId, "agency_deleted", f"حذف وكالة: {a.nameAr}", uname())
        s.delete(a)
    return jsonify({"ok": True})


@app.delete("/api/vehicles/<vid>")
@require("vehicles.delete")
def delete_vehicle(vid):
    with db.session_scope() as s:
        v = s.get(M.Vehicle, vid)
        if v and not opt_company_ok(v.companyId):
            return forbidden(OUT_OF_SCOPE)
        if v:
            db.log_audit(s, "vehicle_delete", f"حذف سيارة: {v.plate} — اتنقلت لسلة المحذوفات", uname())
            trash.trash_vehicle(s, v, uname())    # هي وتصاريحها ← السلة
    return jsonify({"ok": True, "trash": True})


# ---------------------------------------------------------------------------
# التصاريح (للموظفين والسيارات) — القسم 24
# قسم مستقل بصلاحية لوحده (permits.*) ونطاق شركات صاحب التصريح. بياخد بيانات الموظف / العربية للعرض بس
# (permitHolders في الحالة). الأنواع والأماكن لمدير النظام بس.
# ---------------------------------------------------------------------------
PERMIT_HOLDERS = ("employee", "vehicle")
PERMIT_FILE_EXT = (".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")


def _permit_holder(s, kind, hid, action):
    """صاحب التصريح ← (اسمه للسجل، رد خطأ أو None) بعد التأكد من صلاحية قسم التصاريح ونطاق الشركات."""
    if kind not in PERMIT_HOLDERS:
        return None, err("صاحب التصريح غير معروف")
    if not me().can(f"permits.{action}"):
        return None, forbidden()
    if kind == "employee":
        e = s.get(M.Employee, hid) if hid else None
        if e is None:
            return None, err("الموظف غير موجود", 404)
        if not emp_ok(s, hid):
            return None, forbidden(OUT_OF_SCOPE)
        return f"{e.name} ({e.id})", None
    v = s.get(M.Vehicle, hid) if hid else None
    if v is None:
        return None, err("السيارة غير موجودة", 404)
    if not opt_company_ok(v.companyId):
        return None, forbidden(OUT_OF_SCOPE)
    return f"السيارة {v.plate}", None


def _plog(s, kind, hid, pid, action, label):
    """سجل التصاريح لصاحب التصريح (بطاقة التصاريح ← «السجل»)."""
    s.add(M.PermitLog(holderKind=kind, holderId=hid, permitId=pid, action=action, label=label, date=db.now(), user=uname()))


def _permit_of(s, pid, action):
    """التصريح وصاحبه ← (التصريح، اسم صاحبه، رد خطأ أو None)."""
    p = s.get(M.Permit, pid)
    if p is None:
        return None, None, err("التصريح غير موجود", 404)
    who, e = _permit_holder(s, p.holderKind, p.employeeId if p.holderKind == "employee" else p.vehicleId, action)
    return p, who, e


def _drop_permit_file(p):
    if p.filePath:
        try:
            os.remove(db.resolve_file(p.filePath))
        except OSError:
            pass
    p.filePath = p.fileName = None


def permit_holders(s, u):
    """بيانات الموظفين والسيارات اللي في نطاق المستخدم — للعرض في قسم التصاريح بس (من غير مرتب ولا جواز).
    مربوطة مش متنسخة: أي تعديل في مركز الموظفين / السيارات بيبان هنا على طول."""
    cc_co = db.cost_center_companies(s)
    affs, first_project = {}, {}
    for a in s.scalars(select(M.EmployeeAffiliation).order_by(M.EmployeeAffiliation.employeeId, M.EmployeeAffiliation.position)):
        affs.setdefault(a.employeeId, []).append(a.companyId)
        first_project.setdefault(a.employeeId, a.projectId)          # العقد اللي مسجّل عليه (الانتماء الأساسي)
    emps, names = [], {}
    for e in s.scalars(select(M.Employee).order_by(M.Employee.name)):
        names[e.id] = (e.name, e.nameEn)
        a = affs.get(e.id, [])
        if not u.affs_ok([{"companyId": c} for c in a], cc_co.get(e.costCenter), e.costCenter):
            continue
        emps.append({"id": e.id, "name": e.name, "nameEn": e.nameEn, "nationality": e.nationality, "nationalityEn": e.nationalityEn,
                     "profession": e.profession, "professionEn": e.professionEn, "companyId": a[0] if a else None,
                     "costCenter": e.costCenter, "fileNo": e.fileNo, "employmentStatus": e.employmentStatus or "active",
                     "serviceEndDate": db.ser(e.serviceEndDate), "residencyExp": db.ser(e.residencyExp),
                     "projectId": first_project.get(e.id)})       # العقد اللي مسجّل عليه (بيتختار لوحده في التصريح)
    vehs = []
    for v in s.scalars(select(M.Vehicle).order_by(M.Vehicle.plate)):
        if not (u.company_ok(v.companyId) if v.companyId else u.allCompanies):
            continue
        dn = names.get(v.driverId, (v.userName, v.userName))                  # مع مين: الموظف أو الاسم الحر
        vehs.append({"id": v.id, "plate": v.plate, "model": v.model, "vehicleType": v.vehicleType, "companyId": v.companyId,
                     "ownerCompanyId": v.ownerCompanyId, "costCenter": v.costCenter, "driverName": dn[0], "driverNameEn": dn[1],
                     "projectId": v.projectId, "affairsProjectId": v.affairsProjectId,
                     "insuranceExpiry": db.ser(v.insuranceExpiry)})
    return {"employees": emps, "vehicles": vehs}


def permit_cap(s, kind, hid, project_id=None):
    """أقصى تاريخ لانتهاء التصريح = أقرب تاريخ من: الموظف ← انتهاء الإقامة (إذن العمل مش داخل)، والعربية ←
    الرخصة والتأمين (تاريخ واحد) — ونهاية **العقد اللي التصريح طالع عليه** (حكومي أو من الباطن؛ ممكن يختلف عن العقد اللي
    صاحبه مسجّل عليه). بيرجّع [(الوصف، التاريخ)] الأقرب الأول."""
    out = []
    if kind == "employee":
        e = s.get(M.Employee, hid)
        if e is not None and e.residencyExp and pdf_forms.needs_residency(e.nationality):   # الكويتي والخليجي مالهمش إقامة
            out.append(("انتهاء الإقامة", e.residencyExp))
    else:
        v = s.get(M.Vehicle, hid)
        if v is not None:
            out += [("انتهاء الرخصة والتأمين", v.insuranceExpiry)] if v.insuranceExpiry else []
    project = s.get(M.Project, project_id) if project_id else None
    if project is not None and project.expiryDate and project.kind in PERMIT_PROJECT_KINDS:
        out.append((f"نهاية العقد «{project.nameAr}»", project.expiryDate))
    return sorted(out, key=lambda x: x[1])


def _permit_holder_col(kind):
    return M.Permit.employeeId if kind == "employee" else M.Permit.vehicleId


def permit_children(s, p):
    """التصاريح المعتمدة على التصريح ده (الرتقة ← الـ KOC) وأي تصريح معتمد عليهم."""
    out, todo = [], [p.id]
    while todo:
        kids = list(s.scalars(select(M.Permit).where(M.Permit.parentId.in_(todo))))
        kids = [k for k in kids if k.id not in {x.id for x in out} and k.id != p.id]
        out += kids
        todo = [k.id for k in kids]
    return out


def permit_parent_for(s, kind, hid, type_id):
    """التصريح الأساسي الساري لصاحب التصريح من النوع ده (الأبعد انتهاءً) أو None."""
    return s.scalar(select(M.Permit).where(M.Permit.holderKind == kind, _permit_holder_col(kind) == hid, M.Permit.typeId == type_id,
                                           M.Permit.expiryDate >= datetime.now().date())
                    .order_by(M.Permit.expiryDate.desc(), M.Permit.createdAt.desc()).limit(1))


def link_dependents(s, tp):
    """النوع بقى معتمد على نوع تاني ← تصاريحه اللي مالهاش أساسي تتربط بأساسي من نفس الشخص (نفس تاريخ الانتهاء،
    وإلا الأبعد انتهاءً) — نفس اللي بيعمله migration 0028."""
    if not tp.requiresTypeId:
        return 0
    n = 0
    for k in s.scalars(select(M.Permit).where(M.Permit.typeId == tp.id, M.Permit.parentId.is_(None))):
        hid = k.employeeId if k.holderKind == "employee" else k.vehicleId
        rows = list(s.scalars(select(M.Permit).where(M.Permit.holderKind == k.holderKind, _permit_holder_col(k.holderKind) == hid,
                                                     M.Permit.typeId == tp.requiresTypeId).order_by(M.Permit.expiryDate.desc())))
        if rows:
            k.parentId = next((r.id for r in rows if r.expiryDate == k.expiryDate), rows[0].id)
            n += 1
    return n


def dump_permits(s, emp_ids, veh_ids):
    """الأنواع والأماكن للكل، والتصاريح للموظفين والسيارات الظاهرين للمستخدم بس."""
    places = {}
    for r in s.scalars(select(M.PermitPlaceLink)):
        places.setdefault(r.permitId, []).append(r.placeId)
    permits = []
    for p in s.scalars(select(M.Permit).order_by(M.Permit.expiryDate)):
        if (p.holderKind == "employee" and p.employeeId in emp_ids) or (p.holderKind == "vehicle" and p.vehicleId in veh_ids):
            d = db.to_dict(p)
            d.pop("filePath", None)
            d["placeIds"] = places.get(p.id, [])
            d["fileUrl"] = f"/files/permit/{p.id}" if p.filePath else None
            permits.append(d)
    return {
        "permitTypes": [db.to_dict(x) for x in s.scalars(select(M.PermitType).order_by(M.PermitType.position, M.PermitType.nameAr))],
        "permitPlaces": [db.to_dict(x) for x in s.scalars(select(M.PermitPlace).order_by(M.PermitPlace.position, M.PermitPlace.nameAr))],
        "permits": permits,
    }


def _permit_values(s, kind, hid, d, pid=None, batch_parent=None):
    """بيانات تصريح واحد بعد التحقق (من غير كتابة) ← (القيم، None) أو (None، (الرسالة، الكود، block)).
    - العقد مطلوب: حكومي أو من الباطن، ومايكونش خلص (إلا لو هو نفس عقد التصريح وهو بيتعدّل).
    - النوع المعتمد على نوع تاني (الرتقة ← KOC): محتاج أساسي ساري لنفس الشخص — batch_parent (قيم الأساسي اللي
      بيتضاف معاه في نفس الطلب)، أو d.parentId، أو الأساسي الحالي، أو الساري الأبعد انتهاءً. ولو sameExpiry بياخد
      تاريخه وعقده (اللي جاي من الواجهة بيتجاهل)، وإلا تاريخه مايعدّيش تاريخ الأساسي."""
    tp = s.get(M.PermitType, d.get("typeId") or "")
    if tp is None:
        return None, ("اختار نوع التصريح", 400, False)
    if tp.appliesTo and tp.appliesTo != kind:
        return None, ("نوع التصريح ده مش للموظفين" if kind == "employee" else "نوع التصريح ده مش للسيارات", 400, False)
    old = s.get(M.Permit, pid) if pid else None
    today = datetime.now().date()
    issue, expiry = db.parse_date(d.get("issueDate")), db.parse_date(d.get("expiryDate"))
    proj = d.get("projectId") or None
    kids = list(s.scalars(select(M.Permit).where(M.Permit.parentId == old.id))) if old is not None else []
    if kids and old.typeId != tp.id:
        names = "، ".join(dict.fromkeys((s.get(M.PermitType, k.typeId) or M.PermitType(nameAr="تصريح")).nameAr for k in kids))
        return None, (f"التصريح ده مربوط بيه «{names}» — مينفعش تغيّر نوعه", 400, True)
    parent_id, parent_cap = None, None
    if tp.requiresTypeId:
        req = s.get(M.PermitType, tp.requiresTypeId)
        req_name = req.nameAr if req is not None else "التصريح الأساسي"
        if batch_parent is not None:
            p_exp, p_proj = batch_parent["expiry"], batch_parent["proj"]
        else:
            want = d.get("parentId") or (old.parentId if old is not None and old.typeId == tp.id else None)
            parent = s.get(M.Permit, want) if want else None
            if parent is None or parent.typeId != tp.requiresTypeId or parent.holderKind != kind \
                    or (parent.employeeId if kind == "employee" else parent.vehicleId) != hid:
                parent = permit_parent_for(s, kind, hid, tp.requiresTypeId)
            if parent is None:
                return None, (f"«{tp.nameAr}» مابيطلعش غير لو معاه «{req_name}» ساري — ضيف الـ «{req_name}» الأول "
                              "(أو علّم عليه في نفس الشاشة)", 400, True)
            if not (old is not None and old.parentId == parent.id) and (not parent.expiryDate or parent.expiryDate < today):
                return None, (f"«{req_name}»{' رقم ' + parent.permitNo if parent.permitNo else ''} منتهي — جدّده الأول", 400, True)
            parent_id, p_exp, p_proj = parent.id, parent.expiryDate, parent.projectId
        if tp.sameExpiry:
            expiry, proj = p_exp, p_proj
            if not proj:
                return None, (f"«{req_name}» مالوش عقد — عدّله واختار عقده الأول", 400, True)
        else:
            parent_cap = (f"انتهاء «{req_name}»", p_exp)
    if not expiry:
        return None, ("تاريخ الانتهاء مطلوب", 400, False)
    if issue and issue > expiry:
        return None, ("تاريخ الإصدار بعد تاريخ الانتهاء", 400, False)
    for k in kids:                           # التصاريح اللي بتنتهي معاه هتاخد التاريخ الجديد
        ktp = s.get(M.PermitType, k.typeId)
        if ktp is not None and ktp.sameExpiry and k.issueDate and k.issueDate > expiry:
            return None, (f"«{ktp.nameAr}» المربوط بيه اتصدر {k.issueDate.strftime('%d/%m/%Y')} — بعد تاريخ الانتهاء الجديد", 400, True)
    # العقد اللي التصريح طالع عليه: مطلوب، وهو اللي بيحد تاريخه
    if not proj:
        return None, ("اختار العقد اللي التصريح طالع عليه", 400, True)
    project = s.get(M.Project, proj)
    if project is None:
        return None, ("العقد / المشروع غير موجود", 400, False)
    if project.kind not in PERMIT_PROJECT_KINDS:
        return None, (f"«{project.nameAr}» مش عقد حكومي ولا عقد من الباطن — التصريح بيطلع على العقد", 400, True)
    if project.expiryDate and project.expiryDate < today and not (old is not None and old.projectId == proj):
        return None, (f"العقد «{project.nameAr}» خلص في {project.expiryDate.strftime('%d/%m/%Y')} — اختار عقد ساري", 400, True)
    caps = permit_cap(s, kind, hid, proj)    # التصريح مايعدّيش أقرب تاريخ (الإقامة / العقد / رخصة العربية)
    if parent_cap and parent_cap[1]:
        caps = sorted(caps + [parent_cap], key=lambda x: x[1])
    if caps and expiry > caps[0][1]:
        center = ("العقود والمشاريع" if "العقد" in caps[0][0] else "قسم التصاريح" if caps[0] is parent_cap
                  else "مركز الإقامات والموظفين" if kind == "employee" else "مركز السيارات")
        return None, (f"مش هينفع: التصريح بينتهي بعد {caps[0][0]} ({caps[0][1].strftime('%d/%m/%Y')}). "
                      f"لو اتجدد، حدّث تاريخه في {center} الأول.", 400, True)
    pno = (d.get("permitNo") or "").strip() or None
    if pno:                                   # رقم التصريح مايتكررش في نفس النوع
        other = s.scalar(select(M.Permit).where(M.Permit.typeId == tp.id, M.Permit.permitNo == pno, M.Permit.id != (pid or "")))
        if other is not None:
            owner = s.get(M.Employee, other.employeeId) if other.employeeId else s.get(M.Vehicle, other.vehicleId)
            name = (owner.name if other.employeeId else owner.plate) if owner is not None else ""
            return None, (f"رقم التصريح {pno} ({tp.nameAr}) مسجّل بالفعل لـ {name}", 409, True)
    return {"tp": tp, "pno": pno, "issuer": (d.get("issuer") or "").strip() or None, "proj": proj, "issue": issue,
            "expiry": expiry, "notes": (d.get("notes") or "").strip() or None, "parentId": parent_id,
            "places": [x for x in dict.fromkeys(d.get("placeIds") or []) if s.get(M.PermitPlace, x) is not None]}, None


def _write_permit(s, p, kind, hid, who, v):
    """كتابة تصريح (جديد لو p = None) من قيم _permit_values + سجل التدقيق وسجل الموظف."""
    new = p is None
    if new:
        p = M.Permit(id=db.new_id("pm"), holderKind=kind, createdAt=db.now(), createdBy=uname())
        if kind == "employee":
            p.employeeId = hid
        else:
            p.vehicleId = hid
        s.add(p)
    p.typeId, p.permitNo, p.issuer = v["tp"].id, v["pno"], v["issuer"]
    p.projectId, p.issueDate, p.expiryDate, p.notes = v["proj"], v["issue"], v["expiry"], v["notes"]
    p.parentId = v["parentId"]
    p.updatedAt, p.updatedBy = db.now(), uname()
    s.flush()
    s.query(M.PermitPlaceLink).filter(M.PermitPlaceLink.permitId == p.id).delete()
    for x in v["places"]:
        s.add(M.PermitPlaceLink(permitId=p.id, placeId=x))
    label = (f"{'إضافة' if new else 'تعديل'} {v['tp'].nameAr}{' رقم ' + v['pno'] if v['pno'] else ''} لـ {who} — "
             f"ينتهي {v['expiry'].strftime('%d/%m/%Y')}")
    db.log_audit(s, "permit_add" if new else "permit_edit", label, uname())
    _plog(s, kind, hid, p.id, "add" if new else "edit", label)
    if kind == "employee":
        db.push_timeline(s, hid, "permit", label, uname())
    if not new:
        _sync_children(s, p, v["tp"], who)
    return p


def _sync_children(s, p, tp, who):
    """الأساسي اتعدّل ← التصاريح المربوطة بيه اللي بتنتهي معاه (الرتقة) تاخد تاريخه وعقده، ويتسجّل في السجل."""
    n = 0
    for k in list(s.scalars(select(M.Permit).where(M.Permit.parentId == p.id))):
        ktp = s.get(M.PermitType, k.typeId)
        if ktp is None or not ktp.sameExpiry or (k.expiryDate == p.expiryDate and k.projectId == p.projectId):
            continue
        k.expiryDate, k.projectId = p.expiryDate, p.projectId
        k.updatedAt, k.updatedBy = db.now(), uname()
        label = (f"تعديل {ktp.nameAr}{' رقم ' + k.permitNo if k.permitNo else ''} لـ {who} مع «{tp.nameAr}» — "
                 f"ينتهي {k.expiryDate.strftime('%d/%m/%Y')}")
        db.log_audit(s, "permit_edit", label, uname())
        _plog(s, k.holderKind, k.employeeId if k.holderKind == "employee" else k.vehicleId, k.id, "edit", label)
        if k.holderKind == "employee":
            db.push_timeline(s, k.employeeId, "permit", label, uname())
        n += 1 + _sync_children(s, k, ktp, who)
    return n


@app.post("/api/permits")
@app.put("/api/permits/<pid>")
@login_required
def save_permit(pid=None):
    d = body()
    with db.session_scope() as s:
        p = s.get(M.Permit, pid) if pid else None
        if pid and p is None:
            return err("التصريح غير موجود", 404)
        kind = p.holderKind if p is not None else d.get("holderKind")
        hid = (p.employeeId if kind == "employee" else p.vehicleId) if p is not None else d.get("holderId")
        who, e = _permit_holder(s, kind, hid, "edit")
        if e:
            return e
        v, problem = _permit_values(s, kind, hid, d, pid)
        if problem:
            return err(problem[0], problem[1], block=problem[2])
        p = _write_permit(s, p, kind, hid, who, v)
        return jsonify({"ok": True, "id": p.id})


@app.post("/api/permits/batch")
@login_required
def save_permits_batch():
    """كذا تصريح لنفس الموظف / العربية مرة واحدة (كل نوع سجل لوحده): {holderKind, holderId, projectId, placeIds, notes,
    permits: [{typeId, permitNo, issuer, issueDate, expiryDate}]} ← كلهم بيتحفظوا أو ولا واحد (التحقق كله قبل الكتابة)."""
    d = body()
    rows = d.get("permits") or []
    if not rows:
        return err("اختار نوع تصريح واحد على الأقل")
    if len(rows) > 20:
        return err("الحد الأقصى 20 تصريح في المرة")
    shared = {k: d.get(k) for k in ("projectId", "placeIds", "notes")}
    with db.session_scope() as s:
        kind, hid = d.get("holderKind"), d.get("holderId")
        who, e = _permit_holder(s, kind, hid, "edit")
        if e:
            return e
        # النوع المعتمد على نوع تاني في نفس الطلب (الرتقة مع الـ KOC) ← بيتحقق ويتكتب بعده وبيتربط بيه
        types = [s.get(M.PermitType, r.get("typeId") or "") for r in rows]
        at = {tp.id: i for i, tp in enumerate(types) if tp is not None}
        dep = {i: at[tp.requiresTypeId] for i, tp in enumerate(types) if tp is not None and tp.requiresTypeId in at}
        order = [i for i in range(len(rows)) if i not in dep] + [i for i in range(len(rows)) if i in dep]
        values, seen = [None] * len(rows), set()
        for i in order:
            v, problem = _permit_values(s, kind, hid, {**shared, **rows[i]}, batch_parent=values[dep[i]] if i in dep else None)
            if problem:
                tp = types[i]
                return err((f"«{tp.nameAr}»: " if tp is not None else "") + problem[0], problem[1], block=problem[2])
            if v["pno"] and (v["tp"].id, v["pno"]) in seen:
                return err(f"رقم التصريح {v['pno']} ({v['tp'].nameAr}) متكرر في نفس الطلب", 409, block=True)
            seen.add((v["tp"].id, v["pno"]))
            values[i] = v
        ids = [None] * len(rows)                 # بنفس ترتيب الطلب (الواجهة بترفع مرفق كل سطر على رقمه)
        for i in order:
            if i in dep:
                values[i]["parentId"] = ids[dep[i]]
            ids[i] = _write_permit(s, None, kind, hid, who, values[i]).id
    return jsonify({"ok": True, "ids": ids})


@app.delete("/api/permits/<pid>")
@login_required
def delete_permit(pid):
    """التصريح ← سلة المحذوفات، ومعاه التصاريح المربوطة بيه (الرتقة مع الـ KOC) — بعد تأكيد (?linked=1)."""
    with db.session_scope() as s:
        p, who, e = _permit_of(s, pid, "delete")
        if e:
            return e
        tp = s.get(M.PermitType, p.typeId)
        kids = permit_children(s, p)
        names = [f"{(s.get(M.PermitType, k.typeId) or M.PermitType(nameAr='تصريح')).nameAr}{' ' + k.permitNo if k.permitNo else ''}"
                 for k in kids]
        if kids and request.args.get("linked") != "1":
            return err(f"مربوط بيه: {'، '.join(names)} — هيتنقلوا للسلة معاه", 409, warn=True, linked=names)
        label = f"حذف {tp.nameAr if tp else 'تصريح'}{' رقم ' + p.permitNo if p.permitNo else ''} من {who}"
        if names:
            label += f" (ومعاه: {'، '.join(names)})"
        db.log_audit(s, "permit_delete", label + " — اتنقل لسلة المحذوفات", uname())
        _plog(s, p.holderKind, p.employeeId if p.holderKind == "employee" else p.vehicleId, p.id, "delete", label + " — اتنقل لسلة المحذوفات")
        if p.holderKind == "employee":
            db.push_timeline(s, p.employeeId, "permit", label, uname())
            aff = s.scalar(select(M.EmployeeAffiliation).where(M.EmployeeAffiliation.employeeId == p.employeeId)
                           .order_by(M.EmployeeAffiliation.position).limit(1))
            company = aff.companyId if aff is not None else None
        else:
            company = (s.get(M.Vehicle, p.vehicleId) or M.Vehicle()).companyId
        trash.trash_permit(s, p, f"{tp.nameAr if tp else 'تصريح'}{' ' + p.permitNo if p.permitNo else ''}"
                                 f"{' + ' + ' + '.join(names) if names else ''} — {who}", company, uname(), [k.id for k in kids])
    return jsonify({"ok": True, "trash": True})


@app.get("/api/permits/log/<kind>/<hid>")
@login_required
def permit_log(kind, hid):
    """سجل تصاريح موظف أو عربية (الأحدث الأول) — بطاقة التصاريح."""
    with db.session_scope(commit=False) as s:
        _, e = _permit_holder(s, kind, hid, "view")
        if e:
            return e
        rows = s.scalars(select(M.PermitLog).where(M.PermitLog.holderKind == kind, M.PermitLog.holderId == hid)
                         .order_by(M.PermitLog.date.desc(), M.PermitLog.id.desc()).limit(500))
        return jsonify({"log": [db.to_dict(r) for r in rows]})


@app.post("/api/permits/log")
@login_required
def add_permit_log():
    """طباعة بطاقة التصاريح أو نموذج تصريح ← سطر في سجل صاحبه: {holderKind, holderId, action: print|form, label}."""
    d = body()
    kind, hid = d.get("holderKind"), d.get("holderId")
    action = d.get("action") if d.get("action") in ("print", "form") else "print"
    with db.session_scope() as s:
        who, e = _permit_holder(s, kind, hid, "view")
        if e:
            return e
        _plog(s, kind, hid, d.get("permitId") or None, action, (d.get("label") or "طباعة").strip()[:300])
    return jsonify({"ok": True})


@app.post("/api/permits/<pid>/file")
@login_required
def upload_permit_file(pid):
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    ext, problem = check_upload(f)
    if problem:
        return err(problem)
    with db.session_scope() as s:
        p, who, e = _permit_of(s, pid, "edit")
        if e:
            return e
        folder = os.path.join(UPLOADS, "permits")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{pid}_{db.new_id('f')}_{os.path.splitext(secure_filename(f.filename) or 'file')[0]}{ext}")
        f.save(path)
        _drop_permit_file(p)
        p.filePath, p.fileName = db.rel_file(path), f.filename
        p.updatedAt, p.updatedBy = db.now(), uname()
        db.log_audit(s, "permit_file", f"رفع مرفق تصريح لـ {who}: {f.filename}", uname())
        _plog(s, p.holderKind, p.employeeId if p.holderKind == "employee" else p.vehicleId, p.id, "file", f"رفع مرفق تصريح لـ {who}: {f.filename}")
    return jsonify({"ok": True})


@app.delete("/api/permits/<pid>/file")
@login_required
def delete_permit_file(pid):
    with db.session_scope() as s:
        p, who, e = _permit_of(s, pid, "edit")
        if e:
            return e
        if p.filePath:
            db.log_audit(s, "permit_file", f"حذف مرفق تصريح من {who}: {p.fileName}", uname())
            _plog(s, p.holderKind, p.employeeId if p.holderKind == "employee" else p.vehicleId, p.id, "file", f"حذف مرفق تصريح من {who}: {p.fileName}")
        _drop_permit_file(p)
    return jsonify({"ok": True})


@app.get("/files/permit/<pid>")
@login_required
def get_permit_file(pid):
    with db.session_scope(commit=False) as s:
        p, _, e = _permit_of(s, pid, "view")
        if p is None or not p.filePath:
            abort(404)
        if e:
            abort(403)
        path, name = db.resolve_file(p.filePath), p.fileName
    if not os.path.exists(path):
        abort(404)
    return send_viewable(path, name)    # عرض بس


def _save_permit_list(model, prefix, rid, extra=None):
    d = body()
    name = (d.get("nameAr") or "").strip()
    if not name:
        return err("الاسم مطلوب")
    with db.session_scope() as s:
        r = s.get(model, rid) if rid else None
        if rid and r is None:
            return err("غير موجود", 404)
        if s.scalar(select(model).where(model.nameAr == name, model.id != (rid or ""))) is not None:
            return err(f"«{name}» موجود بالفعل", 409, block=True)
        if r is None:
            n = s.scalar(select(func.count()).select_from(model)) or 0
            r = model(id=db.new_id(prefix), position=n + 1, nameAr=name)
            s.add(r)
        r.nameAr, r.nameEn = name, (d.get("nameEn") or "").strip() or None
        if extra:
            extra(r, d)
        what = "نوع" if model is M.PermitType else "مكان"
        db.log_audit(s, "permit_list", f"{'تعديل' if rid else 'إضافة'} {what} تصاريح: {name}", uname())
        return jsonify({"ok": True, "id": r.id})


def _applies_to(r, d):
    r.appliesTo = d.get("appliesTo") if d.get("appliesTo") in PERMIT_HOLDERS else None
    r.defaultIssuer = (d.get("defaultIssuer") or "").strip() or None
    before = r.requiresTypeId
    r.requiresTypeId = d.get("requiresTypeId") or None
    r.sameExpiry = bool(r.requiresTypeId and d.get("sameExpiry"))
    try:
        days = int(d.get("renewWindowDays"))
    except (TypeError, ValueError):
        days = None
    r.renewWindowDays = days if days and 1 <= days <= 365 else 30
    if r.requiresTypeId and r.requiresTypeId != before:          # تصاريحه الموجودة تتربط بأساسي من نفس الشخص
        s = object_session(r)
        s.flush()
        link_dependents(s, r)


def _requires_problem(s, rid, req):
    """النوع المطلوب قبل النوع ده: موجود، ومش هو نفسه، ومن غير دايرة (أ محتاج ب وب محتاج أ) ← رسالة أو None."""
    if not req:
        return None
    seen, cur = {rid}, req
    while cur:
        if cur in seen:
            return "مينفعش: النوعين هيبقوا محتاجين بعض"
        seen.add(cur)
        tp = s.get(M.PermitType, cur)
        if tp is None:
            return "النوع المطلوب قبله غير موجود"
        cur = tp.requiresTypeId
    return None


@app.post("/api/permit-types")
@app.put("/api/permit-types/<rid>")
@admin_required
def save_permit_type(rid=None):
    with db.session_scope(commit=False) as s:
        msg = _requires_problem(s, rid or "", body().get("requiresTypeId"))
    if msg:
        return err(msg, 400, block=True)
    return _save_permit_list(M.PermitType, "pt", rid, _applies_to)


@app.post("/api/permit-places")
@app.put("/api/permit-places/<rid>")
@admin_required
def save_permit_place(rid=None):
    return _save_permit_list(M.PermitPlace, "pl", rid)


def _delete_permit_list(model, rid, used):
    with db.session_scope() as s:
        r = s.get(model, rid)
        if r is None:
            return jsonify({"ok": True})
        n = s.scalar(used) or 0
        if n:
            return err(f"مش هينفع الحذف: عليه {n} تصريح", 409, block=True)
        what = "نوع" if model is M.PermitType else "مكان"
        db.log_audit(s, "permit_list", f"حذف {what} تصاريح: {r.nameAr}", uname())
        s.delete(r)
    return jsonify({"ok": True})


@app.delete("/api/permit-types/<rid>")
@admin_required
def delete_permit_type(rid):
    with db.session_scope(commit=False) as s:
        need = [t.nameAr for t in s.scalars(select(M.PermitType).where(M.PermitType.requiresTypeId == rid))]
    if need:
        return err(f"مش هينفع الحذف: النوع ده مطلوب قبل «{'، '.join(need)}» — شيل الشرط من هناك الأول", 409, block=True)
    return _delete_permit_list(M.PermitType, rid, select(func.count()).select_from(M.Permit).where(M.Permit.typeId == rid))


@app.delete("/api/permit-places/<rid>")
@admin_required
def delete_permit_place(rid):
    return _delete_permit_list(M.PermitPlace, rid,
                               select(func.count()).select_from(M.PermitPlaceLink).where(M.PermitPlaceLink.placeId == rid))


@app.post("/api/cost-centers")
@app.put("/api/cost-centers/<ccid>")
@require("costcenters.edit")
def save_cost_center(ccid=None):
    """{name, nameEn, companyId, code} — الرمز (SUP) بيتحدد لوحده من الاسم الإنجليزي لو مااتكتبش، ومايتغيّرش بعد أول فاتورة."""
    d = body()
    code = (d.pop("code", None) or "").strip().upper()
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
            msg = custody.set_cc_code(s, c, code) if code else None
            if msg:
                s.rollback()
                return err(msg, 409)
            if not c.code:
                c.code = custody.cc_default_code(s, c)
            if old_name != c.name:   # الربط بالاسم ← نحدّث الموظفين والمترشّحين
                s.query(M.Employee).filter(M.Employee.costCenter == old_name).update({"costCenter": c.name})
                s.query(M.Candidate).filter(M.Candidate.costCenter == old_name).update({"costCenter": c.name})
                s.query(M.Vehicle).filter(M.Vehicle.costCenter == old_name).update({"costCenter": c.name})
        else:
            d["id"] = db.new_id("cc")
            c = db.build(M.CostCenter, d)
            s.add(c)
            s.flush()
            msg = custody.set_cc_code(s, c, code) if code else None
            if msg:
                s.rollback()
                return err(msg, 409)
            if not c.code:
                c.code = custody.cc_default_code(s, c)
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
            nv = s.scalar(select(func.count()).select_from(M.Vehicle).where(M.Vehicle.costCenter == c.name))
            if nv:
                return err(f"لا يمكن الحذف: مرتبط بـ {nv} سيارة")
            s.query(M.UserCostCenter).filter(M.UserCostCenter.costCenterId == ccid).delete()
            s.query(M.AgencyCostCenter).filter(M.AgencyCostCenter.costCenterId == ccid).delete()
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
        # المشروع المستهدف لازم يكون تبع الشركة المستهدفة — لو الشركة اتغيّرت المشروع القديم بيتشال
        proj = (d.get("targetProjectId") or None) if "targetProjectId" in d else (old.targetProjectId if old else None)
        p = s.get(M.Project, proj) if proj else None
        if proj and (p is None or p.companyId != target):
            if d.get("targetProjectId"):
                return err("المشروع المختار مش تبع الشركة المستهدفة")
            proj = None
        d["targetProjectId"] = proj
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
        if "children" in d:
            d["children"] = db.children_json(d["children"])
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
        if d.get("stage"):
            s.flush()
            custody.sync_person(s, "candidate", cand_id, d["stage"])
    return jsonify({"ok": True, "id": cand_id})


@app.delete("/api/candidates/<cand_id>")
@require("recruitment.delete")
def delete_candidate(cand_id):
    with db.session_scope() as s:
        c = s.get(M.Candidate, cand_id)
        if c and not me().record_ok(c.targetCompanyId, db.cost_center_company(s, c.costCenter), c.costCenter):
            return forbidden(OUT_OF_SCOPE)
        if c:
            db.log_audit(s, "candidate_delete", f"حذف مترشّح: {c.name} — اتنقل لسلة المحذوفات", uname())
            trash.trash_candidate(s, c, uname())
    return jsonify({"ok": True, "trash": True})


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
            passportExp=c.passportExp, costCenter=c.costCenter, gender=c.gender, unifiedNumber=c.unifiedNumber,
            bloodType=c.bloodType, addressArea=c.addressArea, addressBlock=c.addressBlock, addressStreet=c.addressStreet,
            addressHouse=c.addressHouse, addressApartment=c.addressApartment, homePhone=c.homePhone,
            email=c.email, maritalStatus=c.maritalStatus, qualification=c.qualification, specialization=c.specialization,
            naturalizationDate=c.naturalizationDate, citizenshipArticle=c.citizenshipArticle, nationalityNo=c.nationalityNo,
            studyInstitution=c.studyInstitution, studyAbroad=c.studyAbroad, studyStartDate=c.studyStartDate,
            children=c.children,
            employmentStatus="pending_completion", dateOfHire=datetime.now().date(),
            lastUpdated=db.now(), lastUpdatedBy=uname()))
        s.flush()
        if c.targetCompanyId:
            db.set_affiliations(s, civil, [{"companyId": c.targetCompanyId, "projectId": c.targetProjectId}])
        db.push_timeline(s, civil, "create", "تحويل من مترشّح إلى موظف (قيد الاستكمال) — "
                         + history.current_state_text(s, db.get_affiliations(s, civil), c.costCenter), uname())
        if c.targetCompanyId:
            db.log_company_history(s, c.targetCompanyId, "employee_joined",
                                   f"انضمام الموظف {c.name} ({civil}) — تحويل من مترشّح", uname())
        db.log_audit(s, "candidate_convert", f"تحويل المترشّح {c.name} إلى موظف ({civil})", uname())
        custody.candidate_to_employee(s, cand_id, civil)
        s.delete(c)
    return jsonify({"ok": True, "employeeId": civil})


# ---------------------------------------------------------------------------
# العهد والمصروفات (custody.py)
# ---------------------------------------------------------------------------
def _custody_or_404(s, cid):
    """العهدة لصاحبها أو لصاحب «عرض عهد كل المستخدمين» بس (غير كده كأنها مش موجودة)."""
    c = s.get(M.Custody, cid)
    if not c or not custody.can_see(me(), c):
        abort(404, "العهدة غير موجودة")
    return c


NO_DOWNLOAD = "تنزيل الملفات مقفول — المعاينة والطباعة من جوّه البرنامج بس"


@app.post("/api/custodies")
@app.put("/api/custodies/<cid>")
@require("custody.edit")
def save_custody(cid=None):
    """طلب عهدة، أو تعديله قبل الصرف: {txType, custodian, companyId, requestDate, notes, persons: [{id, items: {بند: مبلغ}}]}"""
    d = body()
    tx = d.get("txType")
    if tx not in custody.TX_TYPES:
        return err("نوع الطلب غير معروف")
    co = d.get("companyId") or None
    if co and not me().company_ok(co):
        return forbidden(OUT_OF_SCOPE)
    with db.session_scope() as s:
        c = _custody_or_404(s, cid) if cid else None
        if c and c.status != "requested":
            return err("العهدة اتصرفت خلاص، مينفعش الطلب يتعدّل")
        # منع التكرار (على عهد كل المستخدمين): مفتوحة ← ممنوع، اتقفلت خلال 90 يوم ← تأكيد
        open_, recent = custody.duplicates(s, tx, [p.get("id") for p in d.get("persons") or []], exclude=cid)
        if open_:
            return err("مينفعش يتطلبوا مرتين — موجودين في عهد مفتوحة من نفس النوع: " + "، ".join(
                f"{n} ({no}{' — ' + o if o else ''})" for n, no, o in open_.values()), 409, block=True)
        if recent and not d.get("force"):
            return err(f"اتقفل لهم نفس النوع خلال آخر {custody.DUP_DAYS} يوم: " + "، ".join(
                f"{n} ({no} — {dt.strftime('%d/%m/%Y')})" for n, no, dt in recent.values()) + " — متأكد إنك عايز تطلبهم تاني؟",
                       409, warn=True)
        lines, msg = custody.build_lines(s, tx, d.get("persons") or [], me())
        if msg:
            return err(msg)
        for x in lines:
            x.dupOk = x.personId in recent
        if c:
            s.query(M.CustodyLine).filter(M.CustodyLine.custodyId == c.id).delete()
        else:
            c = M.Custody(id=db.new_id("cus"), no=custody.next_no(s), status="requested", createdBy=uname(), createdAt=db.now())
            custody.assign_owner(s, c, me().id)            # صاحبها ورقمها برمزه «AA-0001»
            s.add(c)
        c.txType, c.companyId, c.notes = tx, co, (d.get("notes") or "").strip() or None
        who = c.custodian = custody.short_name(s.get(M.User, c.ownerId)) or c.custodian        # المستلم = صاحب العهدة
        c.requestDate = db.parse_date(d.get("requestDate")) or datetime.now().date()
        s.flush()
        for x in lines:
            x.custodyId = c.id
            s.add(x)
        # التقفيلات المباشرة لنفس المستلم ← مبلغها بيتضاف على الطلب (dues مش مبعوتة = المربوط زي ما هو)
        dues, msg = custody.link_dues(s, c, d.get("dues") if "dues" in d else None, me())
        if msg:
            s.rollback()
            return err(msg)
        c.requestedAmount = round(sum(x.planned or 0 for x in lines) + dues, 3)
        n = len({x.personId for x in lines})
        db.log_audit(s, "custody_edit" if cid else "custody_add",
                     f"{'تعديل طلب' if cid else 'طلب'} عهدة {custody.custody_no(c)} ({custody.TX_TYPES[tx]['label']}) — المستلم: {who} — "
                     f"{n} شخص — {c.requestedAmount:g} د.ك" + (f" (منها {dues:g} مستحقات تقفيل مباشر)" if dues else ""), uname())
        return jsonify({"ok": True, "id": c.id, "no": c.no, "number": custody.custody_no(c)})


@app.post("/api/custodies/direct")
@require("custody.edit", "custody.direct")
def direct_custody():
    """تقفيل عهدة مباشر — إجراء اتصرف عليه من فلوس عهدة لشخص مش في أي طلب: {txType, custodian, date, adminFee, notes,
    persons: [{id, items: {بند: المبلغ الفعلي}, receipts: {بند: رقم الإيصال}, expiries: {بند: الانتهاء الجديد}}], force}.
    بيتسجّل ويتقفل في خطوة واحدة (فاتورة لكل مركز تكلفة) من غير صرف — ومبلغه بيتضاف على أقرب طلب عهدة لنفس المستلم."""
    d = body()
    tx, today = d.get("txType"), datetime.now().date()
    if tx not in custody.TX_TYPES:
        return err("نوع المعاملة غير معروف")
    when = db.parse_date(d.get("date")) or today
    if when > today:
        return err("تاريخ التقفيل لسه ماجاش")
    persons = d.get("persons") or []
    by_person = {str(p.get("id") or "").strip(): p for p in persons}
    fee = custody.num(d.get("adminFee"))
    with db.session_scope() as s:
        fee = custody.settings(s)["supportFee"] if fee is None or fee < 0 else fee
        open_, recent = custody.duplicates(s, tx, list(by_person))
        if open_:
            return err("موجودين في عهد مفتوحة من نفس النوع — قفّل الإجراء من العهدة نفسها: " + "، ".join(
                f"{n} ({no}{' — ' + o if o else ''})" for n, no, o in open_.values()), 409, block=True)
        if recent and not d.get("force"):
            return err(f"اتقفل لهم نفس النوع خلال آخر {custody.DUP_DAYS} يوم: " + "، ".join(
                f"{n} ({no} — {dt.strftime('%d/%m/%Y')})" for n, no, dt in recent.values()) + " — متأكد إنه إجراء جديد؟",
                       409, warn=True)
        lines, msg = custody.build_lines(s, tx, persons, me())
        if msg:
            return err(msg)
        if any(x.planned is None for x in lines):
            return err("اكتب المبلغ الفعلي لكل إجراء اتعمل")
        c = M.Custody(id=db.new_id("cus"), no=custody.next_no(s), status="disbursed", direct=True, createdBy=uname(), createdAt=db.now())
        custody.assign_owner(s, c, me().id)
        c.txType, c.notes, c.requestDate = tx, (d.get("notes") or "").strip() or None, when
        who = c.custodian                              # المستلم = صاحب التقفيل (assign_owner)
        c.requestedAmount = round(sum(x.planned or 0 for x in lines), 3)
        s.add(c)
        s.flush()
        for x in lines:
            p = by_person.get(x.personId) or {}
            x.custodyId, x.dupOk = c.id, x.personId in recent
            x.done, x.doneDate, x.actual = True, when, x.planned
            x.receiptNo = str((p.get("receipts") or {}).get(x.feeItemId) or "").strip() or None
            s.add(x)
        s.flush()
        for x in lines:                               # بند التجديد بيحدّث بيانات الموظف ← الانتهاء الجديد لازم
            if not (x.updatesField and x.personKind == "employee"):
                continue
            new = db.parse_date(((by_person.get(x.personId) or {}).get("expiries") or {}).get(x.feeItemId))
            if new and x.oldExpiry and new == x.oldExpiry:        # بياناته اتحدّثت قبل التقفيل (تجديد سريع) ← نفس التاريخ مقبول
                x.oldExpiry = None
            msg = custody.record_expiry(s, c, x, new, uname()) if new else f"سجّل تاريخ الانتهاء الجديد: {x.personName} — {x.itemName}"
            if msg:
                s.rollback()
                return err(msg, 400, block=True)
        closed, invoices, msg = custody.close_lines(s, c, [x.id for x in lines], fee, when, uname())
        if msg:
            s.rollback()
            return err(msg, 400, block=True)
        for pid in {x.personId for x in lines if x.personKind == "employee"}:
            custody.mark_renewed(s, c, pid, uname())
        n = len({x.personId for x in lines})
        db.log_audit(s, "custody_close",
                     f"تقفيل مباشر {custody.custody_no(c)} ({custody.TX_TYPES[tx]['label']}) — المستلم: {who} — {len(lines)} إجراء لـ {n} شخص — "
                     f"{c.requestedAmount:g} د.ك (هيتضاف على أقرب طلب عهدة) — الفواتير: "
                     + "، ".join(f"{custody.invoice_no(i)} ({i.costCenter or '—'}) {i.total:g} د.ك" for i in invoices), uname())
        return jsonify({"ok": True, "id": c.id, "number": custody.custody_no(c), "date": when.isoformat(), "due": c.requestedAmount,
                        "invoices": [custody.invoice_no(i) for i in invoices]})


@app.post("/api/custodies/<cid>/disburse")
@require("custody.edit")
def disburse_custody(cid):
    """«تم الصرف» بعد اعتماد الطلب الورقي: {amount, date} (وبيتعدّل بنفس الطلب لو اتكتب غلط)."""
    d = body()
    amount, when = custody.num(d.get("amount")), db.parse_date(d.get("date"))
    if amount is None or amount < 0 or not when:
        return err("المبلغ اللي اتصرف وتاريخه مطلوبين")
    with db.session_scope() as s:
        c = _custody_or_404(s, cid)
        if c.direct:
            return err("ده تقفيل مباشر — مابيتصرفلوش، مبلغه بيتضاف على أقرب طلب عهدة")
        if c.status not in custody.OPEN:
            return err("العهدة مقفولة أو ملغاة")
        first = c.status == "requested"
        c.status, c.disbursedAmount, c.disbursedDate = "disbursed", amount, when
        db.log_audit(s, "custody_edit", f"{'صرف' if first else 'تعديل صرف'} عهدة {custody.custody_no(c)}: {amount:g} د.ك بتاريخ "
                                        f"{when.isoformat()} — المستلم: {c.custodian}", uname())
    return jsonify({"ok": True})


@app.put("/api/custodies/<cid>/lines/<int:lid>")
@require("custody.edit")
def update_custody_line(cid, lid):
    """بند: {done, actual, receiptNo, newExpiry}. «تم» من غير مبلغ فعلي ← المبلغ المحدد. newExpiry (بند التجديد) ←
    بيتسجّل على البند وبيحدّث بيانات الموظف (custody.record_expiry)، ولما كل بنوده تخلص ← «تم التجديد»."""
    d = body()
    with db.session_scope() as s:
        c = _custody_or_404(s, cid)
        ln = s.get(M.CustodyLine, lid)
        if not ln or ln.custodyId != c.id:
            return err("البند غير موجود", 404)
        if c.status not in custody.OPEN or ln.closedDate:
            return err("البند اتقفل في كشف تقفيل — ألغي التقفيل الأول لو محتاج تعدّله")
        if "done" in d:
            ln.done = bool(d["done"])
            ln.doneDate = datetime.now().date() if ln.done else None
            if ln.done and ln.actual is None:
                ln.actual = ln.planned
        if "actual" in d:
            ln.actual = custody.num(d["actual"])
        if "receiptNo" in d:
            ln.receiptNo = (d.get("receiptNo") or "").strip() or None
        if "newExpiry" in d:
            new = db.parse_date(d.get("newExpiry"))
            if d.get("newExpiry") and not new:
                return err("التاريخ مش صحيح")
            msg = custody.record_expiry(s, c, ln, new, uname())
            if msg:
                s.rollback()
                return err(msg, 400, block=True)
            db.log_audit(s, "custody_edit", f"عهدة {custody.custody_no(c)}: {ln.personName} — {ln.itemName}: "
                         + (f"الانتهاء الجديد {new.isoformat()}" if new else "مسح الانتهاء الجديد"), uname())
        if ln.personKind == "employee" and ("done" in d or "newExpiry" in d):
            custody.mark_renewed(s, c, ln.personId, uname())
        custody.sync_carrier(s, c)
    return jsonify({"ok": True})


@app.post("/api/custodies/<cid>/close")
@require("custody.edit")
def close_custody(cid):
    """تقفيل الإجراءات الجاهزة: {lines: [...], adminFee, date} (أو {persons} للطريقة القديمة) ← فاتورة لكل مركز تكلفة
    (بانتظار موافقة الحسابات). الإجراء بيتقفل لوحده، والدعم الإداري مرة لكل موظف في أول تقفيل ليه."""
    d = body()
    when = db.parse_date(d.get("date")) or datetime.now().date()
    fee = custody.num(d.get("adminFee"))
    with db.session_scope() as s:
        fee = custody.settings(s)["supportFee"] if fee is None or fee < 0 else fee
        c = _custody_or_404(s, cid)
        if c.status != "disbursed":
            return err("التقفيل بيكون للعهدة اللي اتصرفت")
        # تواريخ الانتهاء الجديدة لبنود التجديد (من نافذة التقفيل) ← قبل التقفيل، وكله بيترجع لو فيه خطأ
        for lid, val in (d.get("expiries") or {}).items():
            ln = s.get(M.CustodyLine, int(lid)) if str(lid).isdigit() else None
            new = db.parse_date(val)
            if ln is None or ln.custodyId != c.id or not new:
                continue
            msg = custody.record_expiry(s, c, ln, new, uname())
            if msg:
                s.rollback()
                return err(msg, 400, block=True)
        if "lines" in d:
            lines, invoices, msg = custody.close_lines(s, c, d.get("lines"), fee, when, uname())
        else:
            lines, invoices, msg = custody.close_people(s, c, d.get("persons"), fee, when, uname())
        if msg:
            s.rollback()
            return err(msg, 400, block=True)
        n = len({ln.personId for ln in lines})
        for pid in {ln.personId for ln in lines if ln.personKind == "employee"}:
            custody.mark_renewed(s, c, pid, uname())
        db.log_audit(s, "custody_close",
                     f"تقفيل عهدة {custody.custody_no(c)}: {len(lines)} إجراء لـ {n} شخص — {len(invoices)} فاتورة: "
                     + "، ".join(f"{custody.invoice_no(i)} ({i.costCenter or '—'}) {i.total:g} د.ك" for i in invoices)
                     + (" — العهدة اتقفلت بالكامل" if c.status == "closed" else ""), uname())
        return jsonify({"ok": True, "date": when.isoformat(), "count": n, "lines": len(lines), "status": c.status,
                        "invoices": [custody.invoice_no(i) for i in invoices]})


@app.post("/api/custodies/<cid>/reopen")
@require("custody.delete")
def reopen_custody(cid):
    """إلغاء تقفيل بتاريخه — لو فواتيره كلها لسه بانتظار الحسابات (بتتمسح)."""
    when = db.parse_date(body().get("date"))
    if not when:
        return err("تاريخ التقفيل مطلوب")
    with db.session_scope() as s:
        c = _custody_or_404(s, cid)
        numbers = [custody.invoice_no(i) for i in s.scalars(select(M.Invoice).where(M.Invoice.custodyId == c.id,
                                                                                    M.Invoice.closingDate == when))]
        n, msg = custody.reopen(s, c, when)
        if msg:
            return err(msg)
        if not n:
            return err("مفيش تقفيل بالتاريخ ده")
        custody.sync_carrier(s, c)
        db.log_audit(s, "custody_edit", f"إلغاء تقفيل عهدة {custody.custody_no(c)} بتاريخ {when.isoformat()} ({n} بند)"
                                        + (f" — اتمسحت الفواتير: {'، '.join(numbers)}" if numbers else ""), uname())
    return jsonify({"ok": True})


def _invoice_or_404(s, iid):
    inv = s.get(M.Invoice, iid)
    c = s.get(M.Custody, inv.custodyId) if inv else None
    if not inv or c is None or not custody.can_see(me(), c):
        abort(404, "الفاتورة غير موجودة")
    return inv


def _doc_lang(s):
    """لغة ملفات العهد: ?lang=ar|en|both، وإلا الافتراضي من «إعدادات الفواتير»."""
    lang = request.args.get("lang")
    return lang if lang in custody.DOC_LANGS else custody.settings(s)["docLang"]


def _custody_pdf(s, data, name, what):
    """كشف Excel ← PDF للمعاينة والطباعة (مابيتنزّلش)، ومعاينته بتتسجّل."""
    try:
        pdf = contracts.xlsx_to_pdf(data)
    except RuntimeError as e:
        return err(str(e), 501)
    db.log_audit(s, "custody_print", f"معاينة وطباعة: {what}", uname())
    return _send_pdf(pdf, name)


@app.post("/api/custodies/<cid>/transfer")
@admin_required
def transfer_custody(cid):
    """نقل ملكية العهدة لمستخدم تاني ← رقم جديد برمزه (القديم بيتسجّل)."""
    uid = body().get("userId")
    with db.session_scope() as s:
        c = _custody_or_404(s, cid)
        u = s.get(M.User, int(uid)) if str(uid or "").isdigit() else None
        if u is None:
            return err("المستخدم غير موجود")
        if u.id == c.ownerId:
            return err("العهدة أصلًا بتاعة المستخدم ده")
        old_no, old_owner = custody.custody_no(c), custody.user_names(s).get(c.ownerId, "—")
        # المستلم بيتغيّر مع المالك ← مستحقات التقفيل المباشر المربوطة بالمستلم القديم بتتفك (ولو اتصرفت خلاص ممنوع)
        carrier = s.get(M.Custody, c.carryToId) if c.direct and c.carryToId else None
        dues = custody.carried(s, c)
        if (carrier is not None and carrier.status in custody.FUNDED) or (dues and c.status in custody.FUNDED):
            return err("عليها مستحقات تقفيل مباشر اتصرفت — مينفعش تتنقل لمستخدم تاني")
        for x, _ in dues:
            x.carryToId = None
        c.carryToId = None
        custody.refresh_requested(s, c)
        if carrier is not None:
            custody.refresh_requested(s, carrier)
        custody.assign_owner(s, c, u.id)
        db.log_audit(s, "custody_edit", f"نقل ملكية عهدة {old_no} من {old_owner} إلى {u.displayName or u.username} — "
                                        f"رقمها الجديد {custody.custody_no(c)}", uname())
        return jsonify({"ok": True, "number": custody.custody_no(c)})


@app.post("/api/invoices/action")
@require("custody.view", "custody.accounts")
def invoices_action():
    """حسابات العهد — تغيير حالة فاتورة أو مجموعة: {ids: [...], action, ref, date, note}.
    send (مرجع وتاريخ — لفاتورة أو مجموعة بنفس المرجع) · hold / reject (سبب) · release · approve · collect (رقم وتاريخ) · undo.
    كله أو لا شيء: أي فاتورة مش في الحالة المناسبة بترجّع الطلب كله."""
    d = body()
    action, ids = d.get("action"), list(dict.fromkeys(str(i) for i in (d.get("ids") or []) if i))
    if action not in custody.INVOICE_ACTIONS:
        return err("إجراء غير معروف")
    if not ids:
        return err("اختار فاتورة واحدة على الأقل")
    with db.session_scope() as s:
        done = []
        for iid in ids:
            inv = _invoice_or_404(s, iid)
            msg = custody.invoice_action(inv, action, d, uname())
            if msg:
                s.rollback()
                return err(msg, 400, block=True)
            done.append(inv)
        extra = " — ".join(x for x in (f"المرجع {d.get('ref').strip()}" if action in ("send", "collect") and d.get("ref") else "",
                                         f"بتاريخ {d.get('date')}" if d.get("date") and action in ("send", "approve", "collect") else "",
                                         f"السبب: {d.get('note').strip()}" if d.get("note") else "") if x)
        db.log_audit(s, "custody_edit", f"حسابات العهد — {custody.INVOICE_ACTIONS[action]} {len(done)} فاتورة: "
                     + "، ".join(f"{custody.invoice_no(i)} ({i.total:g} د.ك)" for i in done) + (f" — {extra}" if extra else ""), uname())
        return jsonify({"ok": True, "count": len(done), "status": done[0].status})


@app.get("/api/invoices/<iid>.pdf")
@require("custody.view")
def invoice_pdf(iid):
    """فاتورة للمعاينة والطباعة (?layout=individual ← + ملحق كشف فردي لكل موظف، ?lang=ar|en|both)."""
    with db.session_scope() as s:
        inv = _invoice_or_404(s, iid)
        data = custody_excel.invoice_workbook(s, inv, uname(), request.args.get("layout") == "individual", _doc_lang(s))
        no = custody.invoice_no(inv)
        return _custody_pdf(s, data, f"فاتورة {no}.pdf", f"فاتورة {no} ({inv.costCenter or '—'})")


@app.put("/api/custody-settings")
@require("custody.fees")
def save_custody_settings():
    """إعدادات الفواتير: {issuerCompanyId, supportFee, noSupportCostCenters: [...]}"""
    with db.session_scope() as s:
        st = custody.save_settings(s, body())
        co = s.get(M.Company, st["issuerCompanyId"]) if st["issuerCompanyId"] else None
        db.log_audit(s, "custody_fees", f"إعدادات فواتير العهد: المُصدِر {co.nameAr if co is not None else '—'} — الدعم الإداري "
                                        f"{st['supportFee']:g} د.ك لكل موظف — من غير دعم: "
                                        f"{'، '.join(st['noSupportCostCenters']) or '—'}", uname())
        return jsonify({"ok": True, "settings": st})


@app.get("/api/custodies/<cid>/closing.pdf")
@require("custody.view")
def custody_closing_pdf(cid):
    """تقفيل Excel بتاريخه (?date= — الافتراضي آخر تقفيل): الملخص + فاتورة لكل مركز تكلفة
    (?layout=individual ← + ملحق كشف فردي لكل موظف)."""
    when = db.parse_date(request.args.get("date"))
    with db.session_scope() as s:
        c = _custody_or_404(s, cid)
        q = select(func.max(M.Invoice.closingDate)).where(M.Invoice.custodyId == c.id)
        if when:
            q = q.where(M.Invoice.closingDate == when)
        when = s.scalar(q)
        if not when:
            return err("مفيش تقفيل للعهدة دي" + (" بالتاريخ ده" if request.args.get("date") else ""), 404)
        data = custody_excel.closing_workbook(s, c, when, uname(), request.args.get("layout") == "individual", _doc_lang(s))
        no = custody.custody_no(c)
        return _custody_pdf(s, data, f"تقفيل عهدة {no} - {when.isoformat()}.pdf", f"تقفيل عهدة {no} بتاريخ {when.isoformat()}")


@app.get("/api/custodies/<cid>/request.pdf")
@require("custody.view")
def custody_request_pdf(cid):
    with db.session_scope() as s:
        c = _custody_or_404(s, cid)
        if c.direct:
            return err("ده تقفيل مباشر — مالوش طلب صرف (اطبع الملخص والفواتير من التقفيل)")
        data = custody_excel.request_workbook(s, c, uname(), _doc_lang(s))
        no = custody.custody_no(c)
        return _custody_pdf(s, data, f"طلب صرف عهدة {no}.pdf", f"طلب صرف عهدة {no}")


@app.post("/api/custodies/<cid>/cancel")
@require("custody.delete")
def cancel_custody(cid):
    with db.session_scope() as s:
        c = _custody_or_404(s, cid)
        if c.direct:                                   # تقفيل مباشر: بيتلغي بعد «إلغاء التقفيل» (مفيش فواتير ولا بنود مقفولة)
            if c.status != "disbursed" or s.scalar(select(func.count()).select_from(M.CustodyLine).where(
                    M.CustodyLine.custodyId == c.id, M.CustodyLine.closedDate.isnot(None))):
                return err("ألغي التقفيل الأول (من «التقفيلات والفواتير»)، وبعدها التقفيل المباشر يتلغي")
            carrier = s.get(M.Custody, c.carryToId) if c.carryToId else None
            if carrier is not None and carrier.status in custody.FUNDED:
                return err(f"مبلغه اتضاف على {custody.custody_no(carrier)} واتصرف — مينفعش يتلغي")
            c.status = "cancelled"
            custody.sync_carrier(s, c)                 # «المطلوب» في الطلب اللي كان مضاف عليه بينقص
            c.carryToId = None
        elif c.status != "requested":
            return err("العهدة اتصرفت خلاص، مينفعش تتلغي")
        for x, _ in custody.carried(s, c):             # المستحقات اللي كانت مضافة على الطلب بترجع تستنى طلب تاني
            x.carryToId = None
        c.status = "cancelled"
        db.log_audit(s, "custody_delete", f"إلغاء {'تقفيل مباشر' if c.direct else 'عهدة'} {custody.custody_no(c)} — المستلم: {c.custodian}", uname())
    return jsonify({"ok": True})


@app.put("/api/value-translations")
@require("employees.edit")
def save_value_translations():
    """ترجمة الجنسيات والمهن للتقارير الإنجليزية: {nationality: {عربي: إنجليزي}, profession: {...}}"""
    with db.session_scope() as s:
        n = value_i18n.save(s, body())
        if n:
            db.log_audit(s, "employee_edit", f"تعديل ترجمة الجنسيات والمهن للتقارير الإنجليزية ({n})", uname())
    return jsonify({"ok": True, "changed": n})


@app.put("/api/fee-items/<tx>")
@require("custody.fees")
def save_fee_items(tx):
    """جدول رسوم نوع طلب كامل: {items: [{id?, name, authority, amount, options, stage, active}]} بالترتيب.
    العهد القديمة مابتتأثرش (بنودها نسخة)."""
    if tx not in custody.TX_TYPES:
        abort(404)
    stages = custody.FLOWS[custody.TX_TYPES[tx]["flow"]]
    with db.session_scope() as s:
        existing = {f.id: f for f in s.scalars(select(M.FeeItem).where(M.FeeItem.txType == tx))}
        keep = set()
        for it in body().get("items") or []:
            name = (it.get("name") or "").strip()
            if not name:
                continue
            f = existing.get(it.get("id"))
            if f is None:
                f = M.FeeItem(id=db.new_id("fee"), txType=tx)
                s.add(f)
            f.position, f.name = len(keep) + 1, name
            f.nameEn = (it.get("nameEn") or "").strip() or None
            f.authority = (it.get("authority") or "").strip() or None
            f.amount = custody.num(it.get("amount"))
            opts = [custody.num(x) for x in re.split(r"[,،\s]+", str(it.get("options") or "")) if x.strip()]
            f.options = ",".join(f"{x:g}" for x in opts if x is not None) or None
            f.stage = it.get("stage") if it.get("stage") in stages else None
            f.active = bool(it.get("active", True))
            f.updatesField = it.get("updatesField") if it.get("updatesField") in custody.EXPIRY_FIELDS \
                and custody.TX_TYPES[tx]["kind"] == "employee" else None
            keep.add(f.id)
        for fid, f in existing.items():
            if fid not in keep:
                s.delete(f)
        db.log_audit(s, "custody_fees", f"تعديل جدول رسوم «{custody.TX_TYPES[tx]['label']}» ({len(keep)} بند)", uname())
    return jsonify({"ok": True})


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


def _build_contract(s, emp, args, fill=True, tpl=None, extra=None, path=None, sig_height=contracts.SIG_HEIGHT_CM):
    """العقد لأي شخص بشكل الموظف (موظف أو مترشّح).
    الشركة الافتراضية = الشركة المسجّل عليها، والمفوّض = أول مفوّض فيها (لو المختار مش تبعها بيتجاهل).
    extra = حقول زيادة، و path = ملف Word تاني بدل قالب العقد (زي إقرار المخالصة) بنفس الحقول والتوقيعات."""
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
    tr = value_i18n.merged(s)                  # خانة الموظف فاضية ← القاموس (نفس ترجمة التقارير الإنجليزية)
    for k, kind in (("nationalityEn", "nationality"), ("professionEn", "profession")):
        if not emp.get(k):
            emp[k] = value_i18n.lookup(tr, kind, emp.get(kind)) or emp.get(k)
    ctx = contracts.extra_context(docx_engine.resolve_contract_template(
        emp, company, db.to_dict(sig), project, args.get("date") or None))
    contracts.housing_context(ctx, contracts.housing_included(args.get("housing"), emp))
    contracts.signature_context(ctx)
    ctx.update(extra or {})
    data = None
    if fill:
        if not path:
            tpl = tpl or _contract_template(s, args.get("tpl"))
            path = os.path.join(TEMPLATE_DOCS, tpl.filename)
        data = docx_engine.fill_docx_template(path, ctx)
        images = {}
        if _truthy(args.get("signFirst")) and sig is not None and sig.civilId:
            images["first"] = _signature_file(s, sig.civilId)
        if _truthy(args.get("signSecond")):
            images["second"] = _signature_file(s, emp["id"])
        data = contracts.apply_signatures(data, images, sig_height)
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
    return forbidden(NO_DOWNLOAD)                  # ملف Word بيتعدّل برّه البرنامج — معاينة PDF وطباعة بس


@app.get("/api/contract/pdf")
@require("contract.view", "employees.view", "sensitive.salary")
def contract_pdf():
    emp, data, _ = _contract_bundle(request.args)
    try:
        pdf = contracts.to_pdf(data)
    except RuntimeError as e:
        return err(str(e), 501)
    with db.session_scope() as s:
        db.log_audit(s, "employee_contract", f"معاينة وطباعة عقد عمل: {emp['name']} ({emp['id']})", uname())
    return _send_pdf(pdf, f"عقد عمل - {emp['name']}.pdf")


# --- عقد عمل لمترشّح (مرحلة «عقد العمل» في الاستقدام) ---
CANDIDATE_CONTRACT_STAGE = "employment_contract"
CANDIDATE_CONTRACT_ARGS = ("tpl", "sig", "date", "housing", "signFirst", "signSecond", "professionEn", "nationalityEn", "project")


def _candidate_contract(s, cand_id, args, fill=True):
    """(المترشّح، الحقول، ملف Word أو None، النواقص). الطرف الأول = الشركة المستهدفة، والراتب والاسم من بيانات
    المترشّح نفسه (مفيش تعديل عليهم من هنا). النواقص = أي حقل في القالب فاضي + الحقول الأساسية.
    إدارة العمل ورقم الملف من المشروع (project في الطلب، وإلا المشروع المستهدف) زي الموظف، ومن غيره من الشركة."""
    c = s.get(M.Candidate, cand_id)
    if not c:
        abort(404, "المترشّح غير موجود")
    if not me().record_ok(c.targetCompanyId, db.cost_center_company(s, c.costCenter), c.costCenter):
        abort(403, OUT_OF_SCOPE)
    if c.stage != CANDIDATE_CONTRACT_STAGE:
        abort(400, "عقد العمل بيتطبع لما المترشّح يكون في مرحلة «عقد العمل»")
    pid = (args["project"] if "project" in args else c.targetProjectId) or None
    p = s.get(M.Project, pid) if pid else None
    if pid and (p is None or p.companyId != c.targetCompanyId):
        abort(400, "المشروع المختار مش تبع الشركة المستهدفة")
    person = {"id": (c.civilId or "").strip(), "name": c.name, "nameEn": c.nameEn, "nationality": c.nationality,
              "profession": c.profession, "salary": c.salary, "housingIncluded": bool(c.housingAllowance),
              "passportNo": c.passportNo, "affiliations": [{"companyId": c.targetCompanyId, "projectId": pid}]}
    args = {k: v for k, v in args.items() if k in CANDIDATE_CONTRACT_ARGS}
    tpl = _contract_template(s, args.get("tpl"))
    _, ctx, data = _build_contract(s, person, args, fill, tpl)
    fields = contracts.template_fields(os.path.join(TEMPLATE_DOCS, tpl.filename))
    return c, ctx, data, contracts.missing_in_template(ctx, fields)


@app.put("/api/candidates/<cand_id>/target-project")
@require("recruitment.edit")
def candidate_target_project(cand_id):
    """المشروع المستهدف من نافذة عقد العمل (بيتحفظ على المترشّح، ولما يتحوّل لموظف بيتسجّل عليه)."""
    pid = body().get("projectId") or None
    with db.session_scope() as s:
        c = s.get(M.Candidate, cand_id)
        if not c:
            return err("المترشّح غير موجود", 404)
        if not me().record_ok(c.targetCompanyId, db.cost_center_company(s, c.costCenter), c.costCenter):
            return forbidden(OUT_OF_SCOPE)
        p = s.get(M.Project, pid) if pid else None
        if pid and (p is None or p.companyId != c.targetCompanyId):
            return err("المشروع المختار مش تبع الشركة المستهدفة")
        if c.targetProjectId != pid:
            c.targetProjectId = pid
            db.log_audit(s, "candidate_edit", f"المشروع المستهدف للمترشّح {c.name}: {p.nameAr if p else 'بدون مشروع'}", uname())
    return jsonify({"ok": True})


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
    """PDF للمعاينة والطباعة (Word مقفول) — ممنوع لو فيه أي بيان ناقص في العقد."""
    if fmt != "pdf":
        return forbidden(NO_DOWNLOAD)
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
    return send_file(io.BytesIO(data), as_attachment=False, download_name=f"عقد عمل - {name}.{fmt}", mimetype=mime)


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
    if fmt != "pdf":
        return forbidden(NO_DOWNLOAD)             # ZIP Word وملف لكل موظف = تنزيل ← PDF واحد للمعاينة والطباعة بس
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
    return send_file(io.BytesIO(out), as_attachment=False, download_name=name, mimetype=mime)


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
    if not me().isAdmin:                          # القالب بيتعدّل في Word ويترفع تاني ← لمدير النظام بس
        return forbidden(NO_DOWNLOAD)
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
def download_backup():
    """نسخة كاملة دلوقتي (ZIP: البيانات + كل الملفات) ← بتتحفظ في مجلد النسخ وبتتنزّل."""
    if not me().isAdmin:                          # النسخة الاحتياطية لمدير النظام بس
        return forbidden(NO_DOWNLOAD)
    path = backup.create("manual")
    with db.session_scope() as s:
        db.set_meta(s, "last_backup", db.now_iso())
        db.log_audit(s, "backup_download", f"تنزيل نسخة احتياطية كاملة: {os.path.basename(path)}", uname())
    return send_file(path, as_attachment=True, mimetype="application/zip", download_name=os.path.basename(path))


def _restore_zip(path, source):
    """ZIP كامل ← نسخة «قبل الاستعادة» الأول، وبعدين البيانات (من غير المستخدمين) والملفات."""
    data, _ = backup.read_zip(path)
    pre = os.path.basename(backup.create("pre-restore"))
    with db.session_scope() as s:
        counts = db.import_tables(s, data["tables"])
        db.log_audit(s, "backup_restore", f"استعادة نسخة احتياطية كاملة ({source}) من {data.get('createdAt', '')} — "
                     f"الحالة اللي قبلها اتحفظت في {pre}", uname())
    return {"counts": counts, "files": backup.restore_files(path), "preRestore": pre}


# ---------------------------------------------------------------------------
# ✋ طلبات الموافقة على التعديلات الحساسة (approvals.py) — القسم 28
# ---------------------------------------------------------------------------
def _approval(s, rid):
    r = s.get(M.ApprovalRequest, rid)
    if r is None:
        abort(404, "الطلب غير موجود")
    if s.get(M.Employee, r.employeeId) is not None and not emp_ok(s, r.employeeId):
        abort(403, OUT_OF_SCOPE)
    return r


@app.post("/api/approvals/<rid>/approve")
@require(approvals.PERM)
def approve_request(rid):
    with db.session_scope() as s:
        r = _approval(s, rid)
        msg = approvals.decide(s, r, True, uname(), body().get("note"), _set_employment_status, _trash_employee)
        if msg:
            s.rollback()
            return err(msg, 409, block=True)
    return jsonify({"ok": True})


@app.post("/api/approvals/<rid>/reject")
@require(approvals.PERM)
def reject_request(rid):
    note = (body().get("note") or "").strip()
    if not note:
        return err("اكتب سبب الرفض")
    with db.session_scope() as s:
        msg = approvals.decide(s, _approval(s, rid), False, uname(), note)
        if msg:
            return err(msg)
    return jsonify({"ok": True})


@app.post("/api/approvals/<rid>/cancel")
@login_required
def cancel_request(rid):
    """صاحب الطلب (أو اللي معاه الصلاحية) بيلغيه قبل ما يتقرر."""
    u = me()
    with db.session_scope() as s:
        r = _approval(s, rid)
        if not approvals.is_owner(r, u) and not u.can(approvals.PERM):
            return forbidden()
        if r.status != "pending":
            return err("الطلب ده اتقرر قبل كده")
        r.status, r.decidedBy, r.decidedAt, r.decisionNote = "cancelled", u.display, db.now(), "اتلغى من صاحبه"
        db.log_audit(s, "approval_decision", f"{r.employeeName} ({r.employeeId}): اتلغى طلب {approvals.KINDS[r.kind]}", u.display)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 🗑️ سلة المحذوفات (trash.py) — القسم 28
# ---------------------------------------------------------------------------
@app.get("/api/trash")
@login_required
def list_trash():
    u = me()
    with db.session_scope(commit=False) as s:
        items = [trash.to_api(t) for t in s.scalars(select(M.Trash).order_by(M.Trash.deletedAt.desc())) if trash.visible(u, t)]
    return jsonify({"items": items, "keepDays": trash.KEEP_DAYS, "canPurge": u.isAdmin})


@app.post("/api/trash/<tid>/restore")
@login_required
def restore_trash(tid):
    with db.session_scope() as s:
        t = s.get(M.Trash, tid)
        if t is None:
            return err("مش موجود في السلة", 404)
        if not trash.visible(me(), t):
            return forbidden()
        kind, label, rid = t.kind, t.label, t.recordId
        msg = trash.restore(s, t)
        if msg:
            return err(msg, 409, block=True)
        db.log_audit(s, "trash_restore", f"استرجاع {trash.KINDS[kind][0]} من سلة المحذوفات: {label}", uname())
        if kind == "employee":
            db.push_timeline(s, rid, "edit", "اترجع من سلة المحذوفات", uname())
    return jsonify({"ok": True})


@app.delete("/api/trash/<tid>")
@admin_required
def purge_trash(tid):
    with db.session_scope() as s:
        t = s.get(M.Trash, tid)
        if t is None:
            return err("مش موجود في السلة", 404)
        db.log_audit(s, "trash_purge", f"حذف نهائي من سلة المحذوفات: {trash.KINDS[t.kind][0]} {t.label}", uname())
        trash.purge(s, t)
    return jsonify({"ok": True})


@app.delete("/api/trash")
@admin_required
def empty_trash():
    with db.session_scope() as s:
        items = list(s.scalars(select(M.Trash)))
        for t in items:
            trash.purge(s, t)
        db.log_audit(s, "trash_purge", f"تفريغ سلة المحذوفات: {len(items)}", uname())
    return jsonify({"ok": True, "count": len(items)})


@app.get("/api/backups")
@admin_required
def list_backups():
    with db.session_scope(commit=False) as s:
        st = backup.status(s)
    return jsonify({**st, "items": backup.list_backups(st["folder"]), "kinds": backup.KIND_LABELS})


@app.post("/api/backups")
@admin_required
def create_backup():
    try:
        path = backup.create("manual")
    except OSError as e:
        return err(f"فشل عمل النسخة: {e}")
    with db.session_scope() as s:
        db.set_meta(s, "last_backup", db.now_iso())
        db.log_audit(s, "backup_create", f"نسخة احتياطية كاملة يدوية: {os.path.basename(path)}", uname())
    return jsonify({"ok": True, "name": os.path.basename(path)})


def _backup_path(name):
    if not backup.NAME_RE.match(name or ""):
        abort(404)
    path = os.path.join(backup.folder(), name)
    if not os.path.exists(path):
        abort(404)
    return path


@app.get("/api/backups/<name>")
@admin_required
def get_backup(name):
    path = _backup_path(name)
    with db.session_scope() as s:
        db.log_audit(s, "backup_download", f"تنزيل نسخة احتياطية: {name}", uname())
    return send_file(path, as_attachment=True, download_name=name)


@app.delete("/api/backups/<name>")
@admin_required
def delete_backup(name):
    os.remove(_backup_path(name))
    with db.session_scope() as s:
        db.log_audit(s, "backup_delete", f"حذف نسخة احتياطية: {name}", uname())
    return jsonify({"ok": True})


@app.post("/api/backups/<name>/restore")
@admin_required
def restore_backup_file(name):
    path = _backup_path(name)
    try:
        if name.endswith(".zip"):
            return jsonify({"ok": True, **_restore_zip(path, name)})
        with open(path, encoding="utf-8-sig") as f:
            return _restore_data(json.load(f))
    except ValueError as e:
        return err(str(e))
    except Exception as e:                        # noqa: BLE001
        return err(f"فشل الاستعادة: {e}")


@app.put("/api/backups/folder")
@admin_required
def set_backup_folder():
    """{path} ← مجلد النسخ التلقائية (فاضي = الافتراضي جوّه مجلد البيانات)."""
    path = (body().get("path") or "").strip()
    if path:
        msg = backup.check_folder(path)
        if msg:
            return err(msg)
    with db.session_scope() as s:
        db.set_meta(s, "backup_dir", path)
        db.log_audit(s, "backup_folder", f"مجلد النسخ الاحتياطية: {path or 'الافتراضي'}", uname())
    return jsonify({"ok": True})


@app.post("/api/restore")
@admin_required
def restore():
    f = request.files.get("file")
    if not f:
        return err("لا يوجد ملف")
    if (f.filename or "").lower().endswith(".zip"):          # النسخة الكاملة
        os.makedirs(IMPORTS_DIR, exist_ok=True)
        tmp = os.path.join(IMPORTS_DIR, f"restore-{db.new_id('r')}.zip")
        f.save(tmp)
        try:
            return jsonify({"ok": True, **_restore_zip(tmp, f.filename)})
        except ValueError as e:
            return err(str(e))
        except Exception as e:                    # noqa: BLE001
            return err(f"فشل الاستعادة: {e}")
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
    try:
        data = json.loads(f.read().decode("utf-8-sig"))
    except Exception:
        return err("ملف النسخة الاحتياطية غير صالح")
    return _restore_data(data)


def _restore_data(data):
    """نسخة JSON (القديمة أو من Lunx) — قبلها نسخة كاملة «قبل الاستعادة» للحالة الحالية."""
    try:
        backup.create("pre-restore")
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
            "jobTitle": u.jobTitle, "email": u.email, "phone": u.phone, "custodyCode": u.custodyCode,
            "custodyCodeLocked": bool(u.custodyCode),
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
    if "displayName" in d and u.id:                        # المستلم في عهده = أول اسمين من اسمه
        custody.sync_custodians(s, u.id)
    if (d.get("custodyCode") or "").strip():               # رمزه في أرقام العهد (AA-0001) — بيتحدد مرة واحدة ومايتغيّرش
        code, msg = custody.check_code(s, u.id, d["custodyCode"])
        if msg:
            return msg
        u.custodyCode = code
    elif not u.custodyCode:
        u.custodyCode = custody.default_code(s, u)
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
        problem = password_problem(u.username, d["password"])
        if problem:
            return problem
        u.passwordHash = generate_password_hash(d["password"])
        _mark_weak(s, u.username, False)
    return None


# ---------------------------------------------------------------------------
# كلمة سر التصدير: تصدير CSV لمدير النظام بس، وبكلمة سر بيحددها هو (غير كلمة سر الدخول)
# ---------------------------------------------------------------------------
EXPORT_KEY = "export_password"


@app.post("/api/audit/print")
@login_required
def audit_print():
    """زرار «طباعة» في المعاينة ← سطر في سجل التدقيق (مين طبع إيه وإمتى)."""
    d = body()
    kind = d.get("kind") if d.get("kind") in ("custody", "employee", "candidate", "permit") else "print"
    with db.session_scope() as s:
        db.log_audit(s, f"{kind}_print", f"طباعة: {(d.get('what') or '—')[:200]}", uname())
    return jsonify({"ok": True})


@app.put("/api/export-password")
@admin_required
def set_export_password():
    """{old, password} — القديمة لازمة لو فيه كلمة سر متحددة."""
    d = body()
    with db.session_scope() as s:
        cur = db.get_meta(s, EXPORT_KEY)
        if cur and not check_password_hash(cur, d.get("old") or ""):
            return err("كلمة سر التصدير الحالية غلط", 403)
        if len(d.get("password") or "") < 6:
            return err("كلمة السر لازم 6 حروف على الأقل")
        db.set_meta(s, EXPORT_KEY, generate_password_hash(d["password"]))
        db.log_audit(s, "backup_export", "تغيير كلمة سر التصدير" if cur else "تحديد كلمة سر التصدير", uname())
    return jsonify({"ok": True})


@app.post("/api/export/verify")
@admin_required
def verify_export():
    """{password, what} ← قبل أي تصدير CSV. الغلط والصح بيتسجّلوا."""
    d = body()
    with db.session_scope() as s:
        cur = db.get_meta(s, EXPORT_KEY)
        if not cur:
            return err("حدد كلمة سر التصدير الأول (من قايمة المستخدم ← «🔑 كلمة سر التصدير»)", 409)
        ok = check_password_hash(cur, d.get("password") or "")
        db.log_audit(s, "backup_export", f"{'تصدير' if ok else 'محاولة تصدير بكلمة سر غلط'}: {(d.get('what') or '')[:200]}", uname())
    if not ok:
        time.sleep(1)
        return err("كلمة سر التصدير غلط", 403)
    return jsonify({"ok": True})


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
        problem = password_problem(u.username, d.get("new", ""))
        if problem:
            return err(problem)
        if d.get("new") == d.get("old"):
            return err("كلمة المرور الجديدة لازم تختلف عن الحالية")
        u.passwordHash = generate_password_hash(d["new"])
        _mark_weak(s, u.username, False)
        db.log_audit(s, "user_password", f"تغيير كلمة المرور: {u.username}", u.username)
    session.pop("pw_change", None)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# تقرير جودة البيانات (مدير النظام) — النواقص والتعارضات اللي بتوقف التنبيهات والنماذج والتقارير
# كل بند: {key, title, severity: high|medium|low, hint, items: [{kind, id, label, detail}]}
# ---------------------------------------------------------------------------
WEAK_PW_KEY = "weak_password_users"          # اللي دخلوا بكلمة سر افتراضية / ضعيفة ولسه ماغيّروهاش


def _weak_users(s):
    try:
        return set(json.loads(db.get_meta(s, WEAK_PW_KEY) or "[]"))
    except ValueError:
        return set()


def _mark_weak(s, username, weak):
    users = _weak_users(s)
    (users.add if weak else users.discard)(username)
    db.set_meta(s, WEAK_PW_KEY, json.dumps(sorted(users), ensure_ascii=False))


def data_quality(s):
    today = datetime.now().date()
    ENDED = ("resigned", "terminated")
    emps = s.scalars(select(M.Employee)).all()
    affs = {}
    for a in s.scalars(select(M.EmployeeAffiliation).order_by(M.EmployeeAffiliation.position)):
        affs.setdefault(a.employeeId, []).append(a)
    ccs = {c.name: c for c in s.scalars(select(M.CostCenter))}
    cos = {c.id: c for c in s.scalars(select(M.Company))}
    active = [e for e in emps if (e.employmentStatus or "active") not in ENDED]
    E = {e.id: e for e in emps}

    def emp(e, detail=""):
        return {"kind": "employee", "id": e.id, "label": f"{e.name} ({e.id})", "detail": detail}

    def fmt(d):
        return d.strftime("%d/%m/%Y") if d else ""

    out = []

    def add(key, title, severity, items, hint=""):
        if items:
            out.append({"key": key, "title": title, "severity": severity, "hint": hint, "items": items})

    # ---------- الموظفين ----------
    add("emp_no_company", "موظفين من غير شركة", "high", [emp(e) for e in emps if not affs.get(e.id)],
        "مش هيظهروا في فلاتر الشركات ونطاق المستخدمين.")
    add("emp_ended_no_date", "خدمتهم منتهية من غير تاريخ انتهاء خدمة", "high",
        [emp(e, e.serviceEndReason or "") for e in emps if (e.employmentStatus in ENDED) and not e.serviceEndDate],
        "التاريخ لازم في نماذج التأمينات وإقرار المخالصة.")
    for f, lab in (("residencyExp", "الإقامة"), ("workPermitExp", "إذن العمل")):
        add(f"emp_expired_{f}", f"{lab} منتهية لموظفين في الخدمة", "high",
            [emp(e, fmt(getattr(e, f))) for e in active if getattr(e, f) and getattr(e, f) < today
             and (f != "residencyExp" or pdf_forms.needs_residency(e.nationality))     # الكويتي والخليجي مالهمش إقامة
             and not (f == "workPermitExp" and pdf_forms.is_kuwaiti(e.nationality))])  # الكويتي بيتجدد من الهيئة لوحده
    add("emp_pam_waiting", "عمالة وطنية إذن عملهم بانتظار تجديد الهيئة", "low",
        [emp(e, fmt(e.workPermitExp)) for e in active if e.workPermitExp and e.workPermitExp < today and pdf_forms.is_kuwaiti(e.nationality)],
        "إذن عمل العمالة الكويتية بيتجدد تلقائي من الهيئة — حدّث التاريخ لما التجديد يظهر.")
    need_res = [e for e in active if pdf_forms.needs_residency(e.nationality)]
    add("emp_no_residency", "من غير تاريخ انتهاء الإقامة أو إذن العمل", "medium",
        [emp(e, "، ".join(x for x, v in (("الإقامة", e.residencyExp), ("إذن العمل", e.workPermitExp)) if not v)) for e in need_res
         if not e.residencyExp or not e.workPermitExp], "من غيرهم مفيش تنبيه قبل الانتهاء.")
    add("emp_no_passport", "من غير رقم جواز", "medium", [emp(e) for e in need_res if not (e.passportNo or "").strip()],
        "رقم الجواز لازم لنموذج الإقامة ومنع التكرار.")
    add("emp_no_passport_exp", "من غير تاريخ انتهاء الجواز", "low", [emp(e) for e in need_res if not e.passportExp])
    add("emp_no_health", "من غير تاريخ البطاقة الصحية", "low", [emp(e) for e in need_res if not e.healthCardExp])
    add("emp_no_name_en", "من غير الاسم بالإنجليزي", "low", [emp(e) for e in active if not (e.nameEn or "").strip()],
        "بيطلع فاضي في التقارير الإنجليزي والنماذج الرسمية.")
    add("emp_no_cc", "من غير مركز تكلفة", "medium", [emp(e) for e in active if not e.costCenter])
    add("emp_bad_cc", "مركز تكلفة مش موجود في القايمة", "medium",
        [emp(e, e.costCenter) for e in emps if e.costCenter and e.costCenter not in ccs])
    add("emp_driver_no_license", "سواقين من غير تاريخ رخصة القيادة", "medium",
        [emp(e) for e in active if e.isDriver and not e.drivingLicenseExp])
    add("emp_bad_civil", "رقم مدني مش 12 رقم", "medium", [emp(e) for e in emps if not re.fullmatch(r"\d{12}", e.id or "")])
    add("emp_end_before_hire", "تاريخ انتهاء الخدمة قبل تاريخ التعيين", "medium",
        [emp(e, f"{fmt(e.dateOfHire)} ← {fmt(e.serviceEndDate)}") for e in emps if e.dateOfHire and e.serviceEndDate and e.serviceEndDate < e.dateOfHire])
    pp = {}
    for e in emps:
        k = (e.passportNo or "").strip().upper()
        if k:
            pp.setdefault(k, []).append(e)
    add("emp_dup_passport", "رقم جواز متكرر", "high", [emp(e, e.passportNo) for v in pp.values() if len(v) > 1 for e in v])
    nn = {}
    for e in emps:
        nn.setdefault((norm_name(e.name), norm_name(e.nationality)), []).append(e)
    add("emp_dup_name", "نفس الاسم والجنسية (احتمال موظف متسجّل مرتين)", "medium",
        [emp(e, e.nationality or "") for v in nn.values() if len(v) > 1 for e in v])

    # ---------- الشركات ----------
    sigs = {x.companyId for x in s.scalars(select(M.Signatory))}
    docs = (("commercialLicenseExpiry", "الرخصة التجارية"), ("trafficAuthExpiry", "تفويض المرور"), ("civilAffairsAuthExpiry", "تفويض الشؤون المدنية"))
    add("co_expired_docs", "مستندات شركات منتهية", "high",
        [{"kind": "company", "id": c.id, "label": c.nameAr, "detail": "، ".join(f"{lab} {fmt(getattr(c, f))}" for f, lab in docs if getattr(c, f) and getattr(c, f) < today)}
         for c in cos.values() if any(getattr(c, f) and getattr(c, f) < today for f, _ in docs)])
    add("co_missing_docs", "شركات ناقصها تواريخ مستندات", "medium",
        [{"kind": "company", "id": c.id, "label": c.nameAr, "detail": "، ".join(lab for f, lab in docs if not getattr(c, f))}
         for c in cos.values() if any(not getattr(c, f) for f, _ in docs)], "من غيرها مفيش تنبيه قبل الانتهاء.")
    add("co_no_signatory", "شركات من غير مفوّض بالتوقيع", "medium",
        [{"kind": "company", "id": c.id, "label": c.nameAr, "detail": ""} for c in cos.values() if c.id not in sigs],
        "عقود العمل ونماذج الشركة محتاجة مفوّض.")

    # ---------- مراكز التكلفة ----------
    add("cc_no_company", "مراكز تكلفة مش مربوطة بشركة", "medium",
        [{"kind": "cc", "id": c.id, "label": c.name, "detail": ""} for c in ccs.values() if not c.companyId],
        "نطاق الشركات للمستخدمين بيعتمد على الربط ده.")
    add("cc_no_code", "مراكز تكلفة من غير رمز", "low", [{"kind": "cc", "id": c.id, "label": c.name, "detail": ""} for c in ccs.values() if not c.code])

    # ---------- السيارات ----------
    vitems = {"veh_expired": [], "veh_no_dates": [], "veh_driver": [], "veh_no_company": []}
    for v in s.scalars(select(M.Vehicle)):
        it = lambda d="": {"kind": "vehicle", "id": v.id, "label": v.plate, "detail": d}
        exp = [f"الرخصة والتأمين {fmt(v.insuranceExpiry)}"] if v.insuranceExpiry and v.insuranceExpiry < today else []
        if exp:
            vitems["veh_expired"].append(it("، ".join(exp)))
        miss = [] if v.insuranceExpiry else ["الرخصة والتأمين"]
        if miss:
            vitems["veh_no_dates"].append(it("، ".join(miss)))
        d = E.get(v.driverId) if v.driverId else None
        if d is not None and d.employmentStatus in ENDED:
            vitems["veh_driver"].append(it(f"السائق خدمته منتهية: {d.name}"))
        if not v.companyId:
            vitems["veh_no_company"].append(it())
    add("veh_expired", "سيارات رخصتها وتأمينها منتهي", "high", vitems["veh_expired"])
    add("veh_driver", "سيارات سايقها خدمته منتهية", "medium", vitems["veh_driver"])
    add("veh_no_company", "سيارات من غير شركة", "medium", vitems["veh_no_company"])
    add("veh_no_dates", "سيارات من غير تاريخ رخصة وتأمين", "low", vitems["veh_no_dates"])

    # ---------- التصاريح ----------
    over, cancel = [], []
    tnames = {t.id: t.nameAr for t in s.scalars(select(M.PermitType))}
    vplates = {v.id: v.plate for v in s.scalars(select(M.Vehicle))}
    for p in s.scalars(select(M.Permit).where(M.Permit.expiryDate >= today)):
        hid = p.employeeId if p.holderKind == "employee" else p.vehicleId
        who = f"{E[hid].name} ({hid})" if p.holderKind == "employee" and hid in E else vplates.get(hid, hid or "")
        it = {"kind": "permit", "id": p.id, "label": f"{tnames.get(p.typeId, 'تصريح')} — {who}"}
        caps = permit_cap(s, p.holderKind, hid)
        if caps and p.expiryDate > caps[0][1]:
            over.append({**it, "detail": f"بينتهي {fmt(p.expiryDate)} بعد {caps[0][0]} ({fmt(caps[0][1])})"})
        e = E.get(hid) if p.holderKind == "employee" else None
        if e is not None and (e.employmentStatus in ENDED or e.employmentStatus == "warning"):
            cancel.append({**it, "detail": f"آخر يوم شغل {fmt(e.serviceEndDate) or '—'}"})
    add("permit_cancel", "تصاريح لازم تتلغي (موظف مستقيل أو إنهاء خدمات أو في فترة إنذار)", "high", cancel,
        "لغيها رسميًا وبعدين احذفها من قسم التصاريح.")
    add("permit_over_cap", "تصاريح تاريخها بعد انتهاء الإقامة أو العقد أو رخصة العربية", "medium", over,
        "اتسجلت قبل قاعدة «أقرب تاريخ» — راجع التاريخ أو حدّث الأصل.")

    # ---------- الحسابات ----------
    active_users = {u.username: u for u in s.scalars(select(M.User)) if u.active}
    add("users_weak_pw", "حسابات بكلمة سر افتراضية أو سهلة", "high",
        [{"kind": "user", "id": u, "label": u, "detail": "دخل بيها ولسه ماغيّرهاش"} for u in sorted(_weak_users(s)) if u in active_users],
        "بتتكشف وقت الدخول، وصاحبها بيتجبر يغيّرها.")
    if not db.get_meta(s, EXPORT_KEY):
        add("export_pw", "كلمة سر التصدير لسه ماتحددتش", "medium", [{"kind": "system", "id": "exportpw", "label": "كلمة سر التصدير", "detail": "تصدير CSV مقفول لحد ما تتحدد"}])
    return out


@app.get("/api/expenses")
@require("custody.view", "custody.expenses")
def api_expenses():
    """لوحة المصروفات الحكومية: الفواتير وبنودها المقفولة والرصيد مع المستلمين (كل العهد في نطاق المستخدم)."""
    with db.session_scope(commit=False) as s:
        return jsonify(custody.expenses(s, me()))


@app.put("/api/org")
@admin_required
def set_org():
    """اسم الجهة المرخّص لها: {name, nameEn} — بيظهر جنب LUNX وفي صفحة الدخول (من «عن البرنامج»)."""
    d = body()
    with db.session_scope() as s:
        for k, key in ORG_KEYS.items():
            if k in d:
                db.set_meta(s, key, (d.get(k) or "").strip()[:120])
        info = org_info(s)
        db.log_audit(s, "settings_org", f"اسم الجهة: {info['name'] or '—'} / {info['nameEn'] or '—'}", uname())
    return jsonify({"ok": True, **info})


@app.get("/api/system-check")
@app.post("/api/system-check")
@admin_required
def api_system_check():
    """🩺 فحص السيستم: GET ← آخر نتيجة (أو فحص جديد لو مفيش)، POST ← فحص دلوقتي. قراءة بس — مابيصلّحش حاجة."""
    if request.method == "GET":
        with db.session_scope(commit=False) as s:
            r = syscheck.last(s)
        if r:
            return jsonify(r)
    r = syscheck.run_and_save(data_quality)
    with db.session_scope() as s:
        db.log_audit(s, "system_check", f"فحص السيستم: {r['bad']} مشكلة، {r['warn']} ملاحظة", uname())
    return jsonify(r)


@app.get("/api/data-quality")
@admin_required
def api_data_quality():
    with db.session_scope(commit=False) as s:
        return jsonify({"sections": data_quality(s), "at": db.now_iso()})


# ---------------------------------------------------------------------------
# الخطابات والشهادات (letters.py) — القسم 26
# ---------------------------------------------------------------------------
@app.get("/api/employees/<emp_id>/cost")
@require("employees.view", "sensitive.salary")
def employee_cost(emp_id):
    """💰 تكلفة معاملات الموظف من بنود العهد (كل العهد — مش عهد المستخدم بس) — تبويب «التكلفة» في بطاقة الموظف."""
    with db.session_scope(commit=False) as s:
        if s.get(M.Employee, emp_id) is None:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        return jsonify(custody.employee_cost(s, emp_id))


@app.get("/api/employees/<emp_id>/letter-defaults")
@require("employees.view", "sensitive.salary")
def letter_defaults(emp_id):
    """بيانات شهادة الراتب الافتراضية (بتتعرض في النافذة قبل الإصدار)."""
    with db.session_scope(commit=False) as s:
        e = s.get(M.Employee, emp_id)
        if e is None:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        return jsonify(letters.salary_defaults(s, e, me().can("sensitive.bank")))


@app.post("/api/employees/<emp_id>/letters")
@login_required
def create_letter(emp_id):
    """{kind: salary|continuity|leave|return, ...} ← خطاب برقم جديد ونسخة من بياناته.
    الشهادات محتاجة «المرتب»، والإجازة والعودة «تعديل الموظفين»."""
    d = body()
    kind = d.get("kind")
    if kind not in letters.KINDS:
        return err("نوع الخطاب غير معروف")
    u = me()
    need = ("employees.edit",) if kind in letters.FORMS else ("employees.view", "sensitive.salary")
    if not all(u.can(k) for k in need):
        return forbidden()
    with db.session_scope() as s:
        e = s.get(M.Employee, emp_id)
        if e is None:
            return err("الموظف غير موجود", 404)
        if not emp_ok(s, emp_id):
            return forbidden(OUT_OF_SCOPE)
        if kind in letters.FORMS:
            data, msg = (letters.leave_snapshot if kind == "leave" else letters.return_snapshot)(s, e, d)
            if msg:
                return err(msg)
        else:
            data = letters.salary_defaults(s, e, u.can("sensitive.bank"))
            if not data["salary"]:
                return err("المرتب مش متسجّل للموظف ده — سجّله الأول")
            if not data["companyId"]:
                return err("الموظف مش مسجّل على شركة")
            keys = ["toAr", "toEn", "jobAr", "jobEn"] + (["bankAr", "bankEn"] if u.can("sensitive.bank") else [])
            for k in keys:
                if k in d:
                    data[k] = (d.get(k) or "").strip()
            when = db.parse_date(d.get("date"))
            if when:
                data["date"] = when.isoformat()
        year = datetime.now().year
        series, no, number = letters.next_number(s, kind, year)
        x = M.HrLetter(id=db.new_id("ltr"), kind=kind, series=series, year=year, no=no, number=number, employeeId=e.id,
                       companyId=data.get("companyId"), data=json.dumps(data, ensure_ascii=False),
                       status="submitted" if kind == "leave" else None, createdBy=uname(), createdAt=db.now())
        if kind in letters.FORMS:
            x.dateFrom, x.dateTo, x.days = db.parse_date(data["from"]), db.parse_date(data["to"]), data["days"]
        if kind == "leave":
            label = (f"{letters.KINDS[kind][1]} {number}: {letters.LEAVE_TYPES[data['leaveType']]} من "
                     f"{x.dateFrom.strftime('%d/%m/%Y')} إلى {x.dateTo.strftime('%d/%m/%Y')} ({data['days']} يوم)")
        elif kind == "return":
            late = data["delay"]
            label = (f"{letters.KINDS[kind][1]} {number}: رجع {db.parse_date(data['actualDate']).strftime('%d/%m/%Y')} — "
                     + (f"متأخر {late} يوم" if late > 0 else f"قبل الموعد بـ {-late} يوم" if late < 0 else "في الموعد")
                     + (f" (طلب {data['leaveNumber']})" if data["leaveNumber"] else ""))
        else:
            to = data.get("toAr") or data.get("toEn")
            label = f"{letters.KINDS[kind][1]} {number}" + (f" — للسادة: {to}" if to else "")
        s.add(x)
        db.log_audit(s, "employee_letter", f"{label} — {e.name} ({e.id})", uname())
        db.push_timeline(s, e.id, "letter", label, uname())
        return jsonify({"ok": True, "id": x.id, "number": number})


_LETTER_PDF = {}


@app.get("/api/letters/<lid>/pdf")
@require("employees.view", "sensitive.salary")
def letter_pdf(lid):
    """شهادة الراتب PDF من نسختها المحفوظة (نفس الرقم والبيانات) — معاينة وطباعة بس.
    ?paper=1 ← نفس الشهادة فوق صورة ورق الشركة: **للمعاينة بس** — الطباعة من الملف العادي (على الورق الرسمي نفسه)."""
    with db.session_scope(commit=False) as s:
        x = s.get(M.HrLetter, lid)
        if x is None or x.kind not in letters.SHEETS:
            abort(404)
        if x.employeeId and not emp_ok(s, x.employeeId):
            return forbidden(OUT_OF_SCOPE)
        kind, number, data = x.kind, x.number, json.loads(x.data or "{}")
        paper = letters.company_paper(s, x.companyId)
    size = paper["size"] if paper else None
    # المعاينة (بالورق) والطباعة (من غيره) طلبين ورا بعض ← التحويل لـ PDF مرة واحدة
    key = (lid, hashlib.md5(json.dumps([kind, number, data, size, os.path.getmtime(letters.TEMPLATE)], sort_keys=True,
                                       default=str).encode()).hexdigest())
    pdf = _LETTER_PDF.get(key)
    if pdf is None:
        try:
            pdf = contracts.xlsx_to_pdf(letters.salary_xlsx(kind, number, data, size))
        except RuntimeError as e:
            return err(str(e), 501)
        if len(_LETTER_PDF) > 20:
            _LETTER_PDF.clear()
        _LETTER_PDF[key] = pdf
    if request.args.get("paper") and paper:
        pdf = letters.with_paper(pdf, letters.paper_pdf(paper["path"]))
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", as_attachment=False, download_name=f"{number}.pdf")


@app.put("/api/letters/<lid>/status")
@require("employees.edit")
def letter_status(lid):
    """طلب إجازة: مقدَّم / معتمد / مرفوض."""
    st = body().get("status")
    if st not in letters.LEAVE_STATUS:
        return err("حالة غير معروفة")
    with db.session_scope() as s:
        x = s.get(M.HrLetter, lid)
        if x is None or x.kind != "leave":
            return err("الطلب غير موجود", 404)
        if x.employeeId and not emp_ok(s, x.employeeId):
            return forbidden(OUT_OF_SCOPE)
        back = letters.return_of(s, x.id, x.employeeId) if st == "rejected" else None
        if back:
            return err(f"الموظف رجع من الإجازة دي ({back}) — مينفعش تترفض")
        x.status, x.decidedBy, x.decidedAt = st, uname(), db.now()
        label = f"طلب الإجازة {x.number}: " + {"approved": "اتعتمد", "rejected": "اترفض", "submitted": "رجع «مقدَّم»"}[st]
        db.log_audit(s, "employee_letter", label, uname())
        if x.employeeId:
            db.push_timeline(s, x.employeeId, "letter", label, uname())
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
    print(f"LUNX {APP_VERSION} [{db.engine.dialect.name}] → {url}")
    app.run(host=host, port=port, debug=bool(os.environ.get("DEBUG")))
