# -*- coding: utf-8 -*-
"""
Lunx — طبقة قاعدة البيانات (SQLAlchemy)

نوع قاعدة البيانات بيتحدد من متغير البيئة LUNX_DATABASE_URL:
    sqlite:///lunx.db                                   (الافتراضي)
    postgresql+psycopg://user:pass@host/lunx
    mysql+pymysql://user:pass@host/lunx?charset=utf8mb4
    mssql+pyodbc://user:pass@DSN

كل الكود بيتعامل مع الـ ORM (models.py) — مفيش SQL خاص بنوع معيّن.
"""
import os
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, create_engine, event, inspect, select, text
from sqlalchemy.orm import sessionmaker

import models as M

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEMA_VERSION = "2"


def default_url():
    if os.environ.get("LUNX_DATABASE_URL"):
        return os.environ["LUNX_DATABASE_URL"]
    path = os.environ.get("LUNX_DB", os.path.join(BASE_DIR, "lunx.db"))  # توافق مع الإصدار السابق
    return "sqlite:///" + path.replace("\\", "/")


def make_engine(url):
    kw = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        kw["connect_args"] = {"check_same_thread": False, "timeout": 30}
    eng = create_engine(url, **kw)
    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _sqlite_pragmas(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=OFF")
            cur.close()
    return eng


DATABASE_URL = default_url()
engine = make_engine(DATABASE_URL)
Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)


@contextmanager
def session_scope(commit=True):
    s = Session()
    try:
        yield s
        if commit:
            s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


# ---------------------------------------------------------------------------
# تحويل القيم (نص ← نوع العمود) وتحويل الكائنات للـ API
# ---------------------------------------------------------------------------
_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y")


def parse_date(v):
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip().split("T")[0].split(" ")[0]
    for f in _DATE_FORMATS:
        try:
            return datetime.strptime(s, f).date()
        except ValueError:
            pass
    return None


def parse_datetime(v):
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=None)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    s = re.sub(r"(Z|[+-]\d{2}:?\d{2})$", "", str(v).strip()).replace(" ", "T")
    s = re.sub(r"(\.\d{1,6})\d*$", r"\1", s)
    for f in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, f)
        except ValueError:
            pass
    return None


def coerce(column_type, v):
    """يحوّل قيمة جاية من JSON/Excel/قاعدة قديمة لنوع العمود."""
    if isinstance(v, str):
        v = v.strip()
        if v == "":
            return None
    if v is None:
        return None
    if isinstance(column_type, DateTime):
        return parse_datetime(v)
    if isinstance(column_type, Date):
        return parse_date(v)
    if isinstance(column_type, Boolean):
        return v in (True, 1, "1", "true", "True", "on", "yes")
    if isinstance(column_type, Float):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None
    if isinstance(column_type, Integer):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)


def _columns(model):
    return {c.key: c for c in inspect(model).column_attrs}


def ser(v):
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(v, date):
        return v.isoformat()
    return v


def to_dict(obj):
    if obj is None:
        return None
    return {k: ser(getattr(obj, k)) for k in _columns(type(obj))}


def apply(obj, data, skip=("id",)):
    """ينسخ الحقول المعروفة من data (مفاتيح camelCase) للكائن مع تحويل النوع."""
    cols = _columns(type(obj))
    for k, v in (data or {}).items():
        if k in cols and k not in skip:
            setattr(obj, k, coerce(cols[k].columns[0].type, v))
    return obj


def build(model, data):
    obj = model()
    apply(obj, data, skip=())
    return obj


def now():
    return datetime.now().replace(microsecond=0)


def now_iso():
    return ser(now())


def new_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


# ---------------------------------------------------------------------------
# إنشاء الجداول + ترقية تلقائية (إضافة الأعمدة الناقصة)
# ---------------------------------------------------------------------------
def _needs_v1_upgrade(eng):
    """الإصدار الأول (sqlite3 مباشر): جدول employee_affiliations بدون عمود id."""
    insp = inspect(eng)
    if "employee_affiliations" not in insp.get_table_names():
        return False
    return "id" not in {c["name"] for c in insp.get_columns("employee_affiliations")}


def upgrade_v1_sqlite(eng):
    """ترقية تلقائية لقاعدة الإصدار الأول: نسخة احتياطية من الملف ثم نقل البيانات للهيكل الجديد."""
    import shutil
    path = eng.url.database
    eng.dispose()
    backup = path.replace(".db", "") + f".v1-backup-{datetime.now().strftime('%Y%m%d%H%M%S')}.db"
    shutil.move(path, backup)
    for ext in ("-wal", "-shm"):
        if os.path.exists(path + ext):
            shutil.move(path + ext, backup + ext)
    print(f"[Lunx] ترقية قاعدة البيانات للهيكل الجديد… (نسخة من القديمة: {os.path.basename(backup)})")
    import db_transfer
    db_transfer.transfer("sqlite:///" + backup.replace("\\", "/"), str(eng.url), quiet=True)


def init_db(eng=None):
    eng = eng or engine
    if eng.url.get_backend_name() == "sqlite" and eng.url.database and os.path.exists(eng.url.database) \
            and _needs_v1_upgrade(eng):
        upgrade_v1_sqlite(eng)
    M.Base.metadata.create_all(eng)
    insp = inspect(eng)
    with eng.begin() as conn:
        for table in M.Base.metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for c in table.columns:
                if c.name not in existing and not c.primary_key:
                    ddl = c.type.compile(dialect=eng.dialect)
                    conn.execute(text(f'ALTER TABLE {eng.dialect.identifier_preparer.quote(table.name)} '
                                      f'ADD COLUMN {eng.dialect.identifier_preparer.quote(c.name)} {ddl}'))
    S = sessionmaker(bind=eng, expire_on_commit=False)
    with S() as s:
        set_meta(s, "schema_version", SCHEMA_VERSION)
        s.commit()


def get_meta(s, key, default=None):
    m = s.get(M.Meta, key)
    return m.value if m else default


def set_meta(s, key, value):
    m = s.get(M.Meta, key) or M.Meta(key=key)
    m.value = value
    s.merge(m)


# ---------------------------------------------------------------------------
# السجلات
# ---------------------------------------------------------------------------
def log_audit(s, type_, label, user=None):
    s.add(M.AuditLog(id=new_id("aud"), type=type_, category=type_.split("_")[0], label=label, date=now(), user=user))


def log_company_history(s, company_id, type_, label, user=None, when=None):
    s.add(M.CompanyHistory(id=new_id("ch"), companyId=company_id, type=type_, label=label,
                           date=parse_datetime(when) or now(), user=user))


def push_timeline(s, employee_id, type_, label, user=None):
    s.add(M.EmployeeTimeline(id=new_id("tl"), employeeId=employee_id, type=type_, label=label, date=now(), user=user))


# ---------------------------------------------------------------------------
# الموظفين مع الانتماءات
# ---------------------------------------------------------------------------
def get_affiliations(s, emp_id):
    rows = s.scalars(select(M.EmployeeAffiliation).where(M.EmployeeAffiliation.employeeId == emp_id)
                     .order_by(M.EmployeeAffiliation.position)).all()
    return [{"companyId": a.companyId, "projectId": a.projectId} for a in rows]


def set_affiliations(s, emp_id, affs):
    s.query(M.EmployeeAffiliation).filter(M.EmployeeAffiliation.employeeId == emp_id).delete()
    i = 0
    for a in affs or []:
        if not a.get("companyId") and not a.get("projectId"):
            continue
        s.add(M.EmployeeAffiliation(employeeId=emp_id, position=i,
                                    companyId=a.get("companyId") or None, projectId=a.get("projectId") or None))
        i += 1
    s.flush()


def employee_full(s, emp_id):
    e = s.get(M.Employee, emp_id)
    if not e:
        return None
    d = to_dict(e)
    d["affiliations"] = get_affiliations(s, emp_id)
    return d


def rename_employee(s, old_id, new_id_):
    """تغيير الرقم المدني (المفتاح الأساسي) مع كل ما يرتبط به."""
    s.flush()
    s.query(M.Employee).filter(M.Employee.id == old_id).update({"id": new_id_}, synchronize_session=False)
    s.expire_all()
    for model, attr in ((M.EmployeeAffiliation, "employeeId"), (M.EmployeeTimeline, "employeeId"),
                        (M.EmployeeFile, "employeeId"), (M.Vehicle, "driverId")):
        s.query(model).filter(getattr(model, attr) == old_id).update({attr: new_id_}, synchronize_session=False)
    s.flush()


# ---------------------------------------------------------------------------
# الحالة الكاملة (STATE) للواجهة
# ---------------------------------------------------------------------------
def dump_state(s):
    affs = {}
    for a in s.scalars(select(M.EmployeeAffiliation).order_by(M.EmployeeAffiliation.employeeId,
                                                              M.EmployeeAffiliation.position)):
        affs.setdefault(a.employeeId, []).append({"companyId": a.companyId, "projectId": a.projectId})
    employees = []
    for e in s.scalars(select(M.Employee).order_by(M.Employee.name)):
        d = to_dict(e)
        d["affiliations"] = affs.get(e.id, [])
        employees.append(d)

    sigs = [to_dict(x) for x in s.scalars(select(M.Signatory))]
    docs = {}
    for r in s.scalars(select(M.CompanyDoc)):
        docs.setdefault(r.companyId, {})[r.kind] = {
            "name": r.name, "url": f"/files/company/{r.companyId}/{r.kind}", "uploadedAt": ser(r.uploadedAt)}
    companies = []
    for c in s.scalars(select(M.Company).order_by(M.Company.nameAr)):
        d = to_dict(c)
        d["signatories"] = [x for x in sigs if x["companyId"] == c.id]
        dd = docs.get(c.id, {})
        d["docs"] = {k: dd.get(k) for k in ("trafficAuth", "civilAffairs", "commercialLicense")}
        d["logoUrl"] = f"/files/logo/{c.id}" if c.logoPath else None
        companies.append(d)

    signatory_docs = {
        r.civilId: {"name": r.name, "url": f"/files/signatory/{r.civilId}",
                    "expiryDate": ser(r.expiryDate), "uploadedAt": ser(r.uploadedAt)}
        for r in s.scalars(select(M.SignatoryDoc))
    }
    timeline = {}
    for r in s.scalars(select(M.EmployeeTimeline).order_by(M.EmployeeTimeline.date)):
        timeline.setdefault(r.employeeId, []).append(to_dict(r))

    return {
        "companies": companies,
        "projects": [to_dict(x) for x in s.scalars(select(M.Project).order_by(M.Project.nameAr))],
        "employees": employees,
        "vehicles": [to_dict(x) for x in s.scalars(select(M.Vehicle).order_by(M.Vehicle.plate))],
        "costCenters": [to_dict(x) for x in s.scalars(select(M.CostCenter).order_by(M.CostCenter.name))],
        "companyHistory": [to_dict(x) for x in s.scalars(select(M.CompanyHistory).order_by(M.CompanyHistory.date.desc()))],
        "candidates": [to_dict(x) for x in s.scalars(select(M.Candidate).order_by(M.Candidate.appliedDate.desc()))],
        "signatoryDocs": signatory_docs,
        "auditLog": [to_dict(x) for x in s.scalars(select(M.AuditLog).order_by(M.AuditLog.date.desc()).limit(2000))],
        "employeeTimeline": timeline,
        "templates": [to_dict(x) for x in s.scalars(select(M.Template).order_by(M.Template.isDefault.desc(),
                                                                                  M.Template.createdAt))],
    }


# ---------------------------------------------------------------------------
# نسخ الجداول (للنسخ الاحتياطي والاستعادة والنقل بين قواعد البيانات)
# الصيغة: {اسم_الجدول: [ {اسم_العمود: قيمة} ]} — نفس أسماء الأعمدة من الإصدار الأول
# ---------------------------------------------------------------------------
def export_tables(s, include_users=False):
    out = {}
    for model in M.ALL_MODELS:
        if model is M.User and not include_users:
            continue
        cols = [c for c in model.__table__.columns]
        rows = []
        for r in s.execute(select(model.__table__)).mappings():
            rows.append({c.name: ser(r[c.name]) for c in cols})
        out[model.__tablename__] = rows
    return out


def import_tables(s, tables, replace=True, skip=("users", "meta")):
    """يستورد صفوف (أسماء أعمدة snake_case) مع تحويل الأنواع. يقبل نسخ الإصدار الأول (SQLite)."""
    counts = {}
    models = [m for m in M.ALL_MODELS if m.__tablename__ in tables and m.__tablename__ not in skip]
    if replace:
        for model in reversed(models):
            s.execute(model.__table__.delete())
    for model in models:
        table = model.__table__
        colmap = {c.name: c for c in table.columns}
        rows = []
        for row in tables[model.__tablename__]:
            r = {k: coerce(colmap[k].type, v) for k, v in row.items() if k in colmap}
            if r:
                rows.append(r)
        if rows:
            s.execute(table.insert(), rows)
        counts[model.__tablename__] = len(rows)
    reset_sequences(s)
    return counts


def reset_sequences(s):
    """PostgreSQL: بعد إدخال معرّفات رقمية صريحة لازم نحرّك الـ sequence."""
    if s.get_bind().dialect.name != "postgresql":
        return
    for model in M.ALL_MODELS:
        for c in model.__table__.primary_key.columns:
            if isinstance(c.type, Integer) and c.autoincrement:
                t = model.__tablename__
                s.execute(text(f"SELECT setval(pg_get_serial_sequence('{t}', '{c.name}'), "
                               f"COALESCE((SELECT MAX({c.name}) FROM {t}), 0) + 1, false)"))
