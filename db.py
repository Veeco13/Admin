# -*- coding: utf-8 -*-
"""
Lunx — طبقة قاعدة البيانات (SQLite)
الجداول مطابقة لنموذج البيانات في وثيقة Lunx (القسم 6) مع تحويل camelCase إلى أعمدة SQL.
"""
import os
import sqlite3
import json
import uuid
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("LUNX_DB", os.path.join(BASE_DIR, "lunx.db"))

SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# تعريف الكيانات: اسم الجدول ← [(اسم الحقل في الـ API, اسم العمود, النوع)]
# ---------------------------------------------------------------------------
ENTITIES = {
    "companies": [
        ("id", "id", "TEXT PRIMARY KEY"),
        ("nameAr", "name_ar", "TEXT NOT NULL"),
        ("nameEn", "name_en", "TEXT"),
        ("laborOffice", "labor_office", "TEXT"),
        ("mainFileNumber", "main_file_number", "TEXT"),
        ("commercialLicenseNo", "commercial_license_no", "TEXT"),
        ("commercialLicenseExpiry", "commercial_license_expiry", "TEXT"),
        ("licenseCivilNo", "license_civil_no", "TEXT"),
        ("trafficAuthExpiry", "traffic_auth_expiry", "TEXT"),
        ("civilAffairsAuthExpiry", "civil_affairs_auth_expiry", "TEXT"),
        ("activity", "activity", "TEXT"),
        ("logoPath", "logo_path", "TEXT"),
    ],
    "projects": [
        ("id", "id", "TEXT PRIMARY KEY"),
        ("companyId", "company_id", "TEXT"),
        ("nameAr", "name_ar", "TEXT NOT NULL"),
        ("nameEn", "name_en", "TEXT"),
        ("fileNumber", "file_number", "TEXT"),
        ("laborOffice", "labor_office", "TEXT"),
        ("expiryDate", "expiry_date", "TEXT"),
    ],
    "costCenters": [
        ("id", "id", "TEXT PRIMARY KEY"),
        ("name", "name", "TEXT NOT NULL"),
        ("nameEn", "name_en", "TEXT"),
    ],
    "vehicles": [
        ("id", "id", "TEXT PRIMARY KEY"),
        ("plate", "plate", "TEXT NOT NULL UNIQUE"),
        ("model", "model", "TEXT"),
        ("companyId", "company_id", "TEXT"),
        ("driverId", "driver_id", "TEXT"),
        ("insuranceExpiry", "insurance_expiry", "TEXT"),
        ("govLicenseExpiry", "gov_license_expiry", "TEXT"),
        ("notes", "notes", "TEXT"),
    ],
    "employees": [
        ("id", "id", "TEXT PRIMARY KEY"),              # الرقم المدني
        ("name", "name", "TEXT NOT NULL"),
        ("nameEn", "name_en", "TEXT"),
        ("nationality", "nationality", "TEXT"),
        ("nationalityEn", "nationality_en", "TEXT"),
        ("profession", "profession", "TEXT"),
        ("professionEn", "profession_en", "TEXT"),
        ("dateOfBirth", "date_of_birth", "TEXT"),
        ("dateOfHire", "date_of_hire", "TEXT"),
        ("salary", "salary", "REAL"),
        ("housingIncluded", "housing_included", "INTEGER DEFAULT 0"),
        ("housingAmount", "housing_amount", "REAL"),
        ("employmentStatus", "employment_status", "TEXT DEFAULT 'active'"),
        ("contractType", "contract_type", "TEXT"),
        ("residencyExp", "residency_exp", "TEXT"),
        ("workPermitExp", "work_permit_exp", "TEXT"),
        ("workPermitIssue", "work_permit_issue", "TEXT"),
        ("passportNo", "passport_no", "TEXT"),
        ("passportExp", "passport_exp", "TEXT"),
        ("healthCardExp", "health_card_exp", "TEXT"),
        ("isDriver", "is_driver", "INTEGER DEFAULT 0"),
        ("drivingLicenseExp", "driving_license_exp", "TEXT"),
        ("costCenter", "cost_center", "TEXT"),
        ("actualWorkplace", "actual_workplace", "TEXT"),
        ("fileNo", "file_no", "TEXT"),
        ("govStage", "gov_stage", "TEXT"),
        ("govStageNote", "gov_stage_note", "TEXT"),
        ("govStageResponsible", "gov_stage_responsible", "TEXT"),
        ("govStageStartDate", "gov_stage_start_date", "TEXT"),
        ("govTransactionCost", "gov_transaction_cost", "REAL"),
        ("transferNote", "transfer_note", "TEXT"),
        ("bank", "bank", "TEXT"),
        ("iban", "iban", "TEXT"),
        ("dpId", "dp_id", "TEXT"),
        ("phone", "phone", "TEXT"),
        ("notes", "notes", "TEXT"),
        ("lastUpdated", "last_updated", "TEXT"),
        ("lastUpdatedBy", "last_updated_by", "TEXT"),
    ],
    "candidates": [
        ("id", "id", "TEXT PRIMARY KEY"),
        ("name", "name", "TEXT NOT NULL"),
        ("nameEn", "name_en", "TEXT"),
        ("nationality", "nationality", "TEXT"),
        ("dateOfBirth", "date_of_birth", "TEXT"),
        ("profession", "profession", "TEXT"),
        ("phone", "phone", "TEXT"),
        ("salary", "salary", "REAL"),
        ("housingAllowance", "housing_allowance", "INTEGER DEFAULT 0"),
        ("source", "source", "TEXT DEFAULT 'outside'"),
        ("stage", "stage", "TEXT"),
        ("appliedDate", "applied_date", "TEXT"),
        ("passportNo", "passport_no", "TEXT"),
        ("passportIssueDate", "passport_issue_date", "TEXT"),
        ("passportExp", "passport_exp", "TEXT"),
        ("visaIssueDate", "visa_issue_date", "TEXT"),
        ("visaExp", "visa_exp", "TEXT"),
        ("entryDate", "entry_date", "TEXT"),
        ("oldSponsorResidencyExp", "old_sponsor_residency_exp", "TEXT"),
        ("civilId", "civil_id", "TEXT"),
        ("targetCompanyId", "target_company_id", "TEXT"),
        ("costCenter", "cost_center", "TEXT"),
        ("notes", "notes", "TEXT"),
    ],
    "signatories": [
        ("id", "id", "TEXT PRIMARY KEY"),
        ("companyId", "company_id", "TEXT NOT NULL"),
        ("nameAr", "name_ar", "TEXT NOT NULL"),
        ("nameEn", "name_en", "TEXT"),
        ("civilId", "civil_id", "TEXT"),
    ],
    "templates": [
        ("id", "id", "TEXT PRIMARY KEY"),
        ("name", "name", "TEXT NOT NULL"),
        ("filename", "filename", "TEXT NOT NULL"),
        ("isDefault", "is_default", "INTEGER DEFAULT 0"),
        ("createdAt", "created_at", "TEXT"),
    ],
}

# كيانات السجلات والملفات (بدون CRUD عام)
EXTRA_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor'          -- admin | editor | viewer
);
CREATE TABLE IF NOT EXISTS employee_affiliations (
    employee_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,          -- 0 = الأساسي
    company_id TEXT,
    project_id TEXT
);
CREATE INDEX IF NOT EXISTS ix_aff_emp ON employee_affiliations(employee_id);
CREATE TABLE IF NOT EXISTS company_docs (
    company_id TEXT NOT NULL,
    kind TEXT NOT NULL,                           -- trafficAuth | civilAffairs | commercialLicense
    name TEXT, path TEXT, uploaded_at TEXT,
    PRIMARY KEY (company_id, kind)
);
CREATE TABLE IF NOT EXISTS signatory_docs (
    civil_id TEXT PRIMARY KEY,
    name TEXT, path TEXT, expiry_date TEXT, uploaded_at TEXT
);
CREATE TABLE IF NOT EXISTS employee_files (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    name TEXT, path TEXT, size INTEGER, uploaded_at TEXT, uploaded_by TEXT
);
CREATE TABLE IF NOT EXISTS company_history (
    id TEXT PRIMARY KEY, company_id TEXT, type TEXT, label TEXT, date TEXT, user TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, type TEXT, category TEXT, label TEXT, date TEXT, user TEXT
);
CREATE TABLE IF NOT EXISTS employee_timeline (
    id TEXT PRIMARY KEY, employee_id TEXT, type TEXT, label TEXT, date TEXT, user TEXT
);
CREATE INDEX IF NOT EXISTS ix_tl_emp ON employee_timeline(employee_id);
"""

INT_BOOL_FIELDS = {"housingIncluded", "isDriver", "housingAllowance", "isDefault"}


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def new_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def init_db():
    """ينشئ الجداول ويضيف أي عمود ناقص (Migrations تلقائية)."""
    conn = connect()
    for table, fields in ENTITIES.items():
        tname = sql_table(table)
        cols = ", ".join(f"{col} {typ}" for _, col, typ in fields)
        conn.execute(f"CREATE TABLE IF NOT EXISTS {tname} ({cols})")
        existing = {r[1] for r in conn.execute(f"PRAGMA table_info({tname})")}
        for _, col, typ in fields:
            if col not in existing:
                typ_clean = typ.replace("PRIMARY KEY", "").replace("NOT NULL", "").replace("UNIQUE", "")
                conn.execute(f"ALTER TABLE {tname} ADD COLUMN {col} {typ_clean}")
    conn.executescript(EXTRA_SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)", (str(SCHEMA_VERSION),)
    )
    conn.commit()
    conn.close()


def sql_table(entity):
    return {"costCenters": "cost_centers"}.get(entity, entity)


def row_to_obj(entity, row):
    if row is None:
        return None
    obj = {}
    keys = row.keys()
    for api, col, _ in ENTITIES[entity]:
        if col in keys:
            v = row[col]
            if api in INT_BOOL_FIELDS:
                v = bool(v)
            obj[api] = v
    return obj


def obj_to_cols(entity, obj):
    """يحوّل كائن API إلى أعمدة (يتجاهل الحقول غير المعروفة)."""
    out = {}
    for api, col, _ in ENTITIES[entity]:
        if api in obj:
            v = obj[api]
            if isinstance(v, str):
                v = v.strip()
                if v == "":
                    v = None
            if api in INT_BOOL_FIELDS:
                v = 1 if v in (True, 1, "1", "true", "on") else 0
            out[col] = v
    return out


def list_all(conn, entity, order=None):
    t = sql_table(entity)
    q = f"SELECT * FROM {t}"
    if order:
        q += f" ORDER BY {order}"
    return [row_to_obj(entity, r) for r in conn.execute(q)]


def get_one(conn, entity, id_):
    r = conn.execute(f"SELECT * FROM {sql_table(entity)} WHERE id=?", (id_,)).fetchone()
    return row_to_obj(entity, r)


def insert(conn, entity, obj):
    cols = obj_to_cols(entity, obj)
    names = ", ".join(cols.keys())
    qs = ", ".join("?" for _ in cols)
    conn.execute(f"INSERT INTO {sql_table(entity)} ({names}) VALUES ({qs})", list(cols.values()))


def update(conn, entity, id_, obj):
    cols = obj_to_cols(entity, obj)
    cols.pop("id", None)
    if not cols:
        return
    sets = ", ".join(f"{c}=?" for c in cols)
    conn.execute(f"UPDATE {sql_table(entity)} SET {sets} WHERE id=?", list(cols.values()) + [id_])


def delete(conn, entity, id_):
    conn.execute(f"DELETE FROM {sql_table(entity)} WHERE id=?", (id_,))


# ---------------------------------------------------------------------------
# السجلات
# ---------------------------------------------------------------------------
def log_audit(conn, type_, label, user=None):
    category = type_.split("_")[0]
    conn.execute(
        "INSERT INTO audit_log(id, type, category, label, date, user) VALUES(?,?,?,?,?,?)",
        (new_id("aud"), type_, category, label, now_iso(), user),
    )


def log_company_history(conn, company_id, type_, label, user=None, date=None):
    conn.execute(
        "INSERT INTO company_history(id, company_id, type, label, date, user) VALUES(?,?,?,?,?,?)",
        (new_id("ch"), company_id, type_, label, date or now_iso(), user),
    )


def push_timeline(conn, employee_id, type_, label, user=None):
    conn.execute(
        "INSERT INTO employee_timeline(id, employee_id, type, label, date, user) VALUES(?,?,?,?,?,?)",
        (new_id("tl"), employee_id, type_, label, now_iso(), user),
    )


# ---------------------------------------------------------------------------
# الموظفين مع الانتماءات
# ---------------------------------------------------------------------------
def load_affiliations(conn):
    aff = {}
    for r in conn.execute(
        "SELECT employee_id, company_id, project_id FROM employee_affiliations ORDER BY employee_id, position"
    ):
        aff.setdefault(r["employee_id"], []).append({"companyId": r["company_id"], "projectId": r["project_id"]})
    return aff


def employee_full(conn, emp_id):
    e = get_one(conn, "employees", emp_id)
    if e:
        e["affiliations"] = [
            {"companyId": r["company_id"], "projectId": r["project_id"]}
            for r in conn.execute(
                "SELECT company_id, project_id FROM employee_affiliations WHERE employee_id=? ORDER BY position",
                (emp_id,),
            )
        ]
    return e


def set_affiliations(conn, emp_id, affs):
    conn.execute("DELETE FROM employee_affiliations WHERE employee_id=?", (emp_id,))
    for i, a in enumerate(affs or []):
        if not a.get("companyId") and not a.get("projectId"):
            continue
        conn.execute(
            "INSERT INTO employee_affiliations(employee_id, position, company_id, project_id) VALUES(?,?,?,?)",
            (emp_id, i, a.get("companyId") or None, a.get("projectId") or None),
        )


def get_meta(conn, key, default=None):
    r = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def set_meta(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)", (key, value))


def dump_state(conn):
    """كل البيانات في كائن واحد بنفس شكل STATE في الوثيقة (للنسخ الاحتياطي والتحميل الأولي)."""
    aff = load_affiliations(conn)
    employees = list_all(conn, "employees", "name")
    for e in employees:
        e["affiliations"] = aff.get(e["id"], [])
    companies = list_all(conn, "companies", "name_ar")
    sigs = list_all(conn, "signatories")
    docs = {}
    for r in conn.execute("SELECT * FROM company_docs"):
        docs.setdefault(r["company_id"], {})[r["kind"]] = {
            "name": r["name"], "url": f"/files/company/{r['company_id']}/{r['kind']}", "uploadedAt": r["uploaded_at"]
        }
    for c in companies:
        c["signatories"] = [s for s in sigs if s["companyId"] == c["id"]]
        d = docs.get(c["id"], {})
        c["docs"] = {k: d.get(k) for k in ("trafficAuth", "civilAffairs", "commercialLicense")}
        c["logoUrl"] = f"/files/logo/{c['id']}" if c.get("logoPath") else None
    signatory_docs = {
        r["civil_id"]: {
            "name": r["name"], "url": f"/files/signatory/{r['civil_id']}",
            "expiryDate": r["expiry_date"], "uploadedAt": r["uploaded_at"],
        }
        for r in conn.execute("SELECT * FROM signatory_docs")
    }
    timeline = {}
    for r in conn.execute("SELECT * FROM employee_timeline ORDER BY date, rowid"):
        timeline.setdefault(r["employee_id"], []).append(
            {"id": r["id"], "type": r["type"], "label": r["label"], "date": r["date"], "user": r["user"]}
        )
    return {
        "companies": companies,
        "projects": list_all(conn, "projects", "name_ar"),
        "employees": employees,
        "vehicles": list_all(conn, "vehicles", "plate"),
        "costCenters": list_all(conn, "costCenters", "name"),
        "companyHistory": [dict(r) | {"companyId": r["company_id"]} for r in conn.execute("SELECT * FROM company_history ORDER BY date DESC, rowid DESC")],
        "candidates": list_all(conn, "candidates", "applied_date DESC"),
        "signatoryDocs": signatory_docs,
        "auditLog": [dict(r) for r in conn.execute("SELECT * FROM audit_log ORDER BY date DESC, rowid DESC LIMIT 2000")],
        "employeeTimeline": timeline,
        "templates": list_all(conn, "templates", "is_default DESC, created_at"),
    }
