# -*- coding: utf-8 -*-
"""
النسخة الاحتياطية الكاملة (القسم 28)
- ملف ZIP واحد: data.json (كل الجداول بالمستخدمين — نفس صيغة النسخة القديمة)، ولقطة من lunx.db (SQLite)، وكل الملفات
  (uploads = مرفقات الموظفين والتصاريح والتوقيعات واللوجوهات ومستندات الشركات، وtemplates_docs = القوالب).
- نسخة تلقائية يومية (في الخلفية — مابتأخرش فتح البرنامج) في المجلد اللي مدير النظام بيختاره (meta backup_dir)،
  وإلا db.BACKUP_DIR. الاحتفاظ: آخر 14 يوم + أول نسخة في كل شهر لمدة 12 شهر. اليدوية بتفضل لحد ما تتمسح.
- الاستعادة من ZIP (مرفوع أو من القايمة): قبلها نسخة «قبل الاستعادة» لوحدها، وبعدين البيانات والملفات.
"""
import json
import os
import re
import sqlite3
import tempfile
import threading
import zipfile
from datetime import date, datetime, timedelta

import db

FILE_DIRS = ("uploads", "templates_docs", "trash")          # trash = ملفات سلة المحذوفات
SKIP = ("uploads/imports/",)                     # ملفات الاستيراد المؤقتة مالهاش لازمة
NAME_RE = re.compile(r"^lunx-(auto|manual|pre-restore)-(\d{4}-\d{2}-\d{2})_(\d{6})\.(zip|json)$")
KEEP_DAYS, KEEP_MONTHS, KEEP_PRE = 14, 12, 10
KIND_LABELS = {"auto": "تلقائية", "manual": "يدوية", "pre-restore": "قبل الاستعادة"}
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# المجلد
# ---------------------------------------------------------------------------
def folder(s=None):
    """مجلد النسخ: اللي اتختار من الشاشة، وإلا الافتراضي (backups جوّه مجلد البيانات)."""
    if s is None:
        with db.session_scope(commit=False) as s2:
            return folder(s2)
    return db.get_meta(s, "backup_dir") or db.BACKUP_DIR


def check_folder(path):
    """المجلد لازم يكون مسار كامل ويتكتب فيه ← رسالة خطأ أو None."""
    if not path or not os.path.isabs(path):
        return "اكتب مسار كامل للمجلد (زي D:\\Lunx-Backups)"
    try:
        os.makedirs(path, exist_ok=True)
        probe = os.path.join(path, ".lunx-write-test")
        with open(probe, "w") as f:
            f.write("ok")
        os.remove(probe)
    except OSError as e:
        return f"مينفعش أكتب في المجلد ده: {e}"
    return None


# ---------------------------------------------------------------------------
# إنشاء النسخة
# ---------------------------------------------------------------------------
def _sqlite_file():
    url = db.DATABASE_URL
    return url[len("sqlite:///"):] if url.startswith("sqlite:///") else None


def _files():
    """(المسار الحقيقي، المسار جوّه الـ ZIP) لكل الملفات اللي بتتنسخ."""
    for d in FILE_DIRS:
        root = db.data_path(d)
        for base, _, names in os.walk(root):
            for n in names:
                full = os.path.join(base, n)
                rel = os.path.relpath(full, db.DATA_DIR).replace("\\", "/")
                if not rel.startswith(SKIP):
                    yield full, rel


def create(kind="manual", dest=None):
    """ZIP كامل في المجلد ← مساره."""
    dest = dest or folder()
    os.makedirs(dest, exist_ok=True)
    name = f"lunx-{kind}-{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.zip"
    path = os.path.join(dest, name)
    tmp = path + ".tmp"
    with db.session_scope(commit=False) as s:
        tables = db.export_tables(s, include_users=True)
        rev = db.current_revision()
    data = {"app": "Lunx", "createdAt": db.now_iso(), "database": db.engine.dialect.name, "schemaRevision": rev, "tables": tables}
    n_files = size = 0
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        z.writestr("data.json", json.dumps(data, ensure_ascii=False))
        src = _sqlite_file()
        if src and os.path.exists(src):                   # لقطة سليمة من القاعدة (حتى وهي شغالة)
            fd, snap = tempfile.mkstemp(suffix=".db")
            os.close(fd)
            try:
                a, b = sqlite3.connect(src), sqlite3.connect(snap)
                try:
                    a.backup(b)
                finally:
                    b.close()
                    a.close()
                z.write(snap, "database/lunx.db")
            finally:
                try:
                    os.remove(snap)
                except OSError:
                    pass
        for full, rel in _files():
            try:
                z.write(full, "files/" + rel)
                n_files += 1
                size += os.path.getsize(full)
            except OSError:
                pass
        z.writestr("manifest.json", json.dumps({
            "app": "Lunx", "kind": kind, "createdAt": data["createdAt"], "database": data["database"], "schemaRevision": rev,
            "counts": {t: len(r) for t, r in tables.items()}, "files": n_files, "filesBytes": size}, ensure_ascii=False))
    os.replace(tmp, path)
    return path


# ---------------------------------------------------------------------------
# القايمة والاحتفاظ
# ---------------------------------------------------------------------------
def list_backups(dest=None):
    dest = dest or folder()
    out = []
    if not os.path.isdir(dest):
        return out
    for n in os.listdir(dest):
        m = NAME_RE.match(n)
        if not m:
            continue
        p = os.path.join(dest, n)
        out.append({"name": n, "kind": m.group(1), "format": m.group(4), "size": os.path.getsize(p),
                    "createdAt": f"{m.group(2)}T{m.group(3)[:2]}:{m.group(3)[2:4]}:{m.group(3)[4:]}"})
    return sorted(out, key=lambda x: x["createdAt"], reverse=True)


def retention(dest=None):
    """التلقائية: آخر 14 يوم + أول نسخة في كل شهر لمدة 12 شهر. «قبل الاستعادة»: آخر 10. اليدوية مابتتمسحش."""
    items = list_backups(dest)
    keep = set()
    auto = [x for x in items if x["kind"] == "auto"]
    days = sorted({x["createdAt"][:10] for x in auto}, reverse=True)[:KEEP_DAYS]
    keep |= {x["name"] for x in auto if x["createdAt"][:10] in days}
    months = {}
    for x in sorted(auto, key=lambda y: y["createdAt"]):
        months.setdefault(x["createdAt"][:7], x["name"])
    for m in sorted(months, reverse=True)[:KEEP_MONTHS]:
        keep.add(months[m])
    keep |= {x["name"] for x in [y for y in items if y["kind"] == "pre-restore"][:KEEP_PRE]}
    removed = 0
    for x in items:
        if x["kind"] in ("auto", "pre-restore") and x["name"] not in keep:
            try:
                os.remove(os.path.join(dest or folder(), x["name"]))
                removed += 1
            except OSError:
                pass
    return removed


# ---------------------------------------------------------------------------
# التلقائية اليومية (في الخلفية)
# ---------------------------------------------------------------------------
def _due():
    today = date.today().isoformat()
    with db.session_scope(commit=False) as s:
        if db.get_meta(s, "last_auto_backup") == today:
            return False
        err_at = db.get_meta(s, "backup_error_at")
    return not err_at or err_at < (datetime.now() - timedelta(hours=1)).isoformat(timespec="seconds")


def _run():
    if not _lock.acquire(blocking=False):
        return
    today = date.today().isoformat()
    dest, lock = None, None
    try:
        dest = folder()
        os.makedirs(dest, exist_ok=True)
        lock = os.path.join(dest, f".lock-{today}")
        try:                                              # worker واحد بس (gunicorn / أكتر من container) يعمل النسخة
            os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        except FileExistsError:
            lock = None
            return
        for f in os.listdir(dest):
            if f.startswith(".lock-") and f != f".lock-{today}":
                try:
                    os.remove(os.path.join(dest, f))
                except OSError:
                    pass
        create("auto", dest)
        retention(dest)
        with db.session_scope() as s:
            db.set_meta(s, "last_auto_backup", today)
            db.set_meta(s, "backup_ok_at", db.now_iso())
            db.set_meta(s, "backup_error", "")
    except Exception as e:                                # النسخ الاحتياطي ما يوقفش النظام — بيتسجّل ويتعاد بعد ساعة
        try:
            if lock and os.path.exists(lock):
                os.remove(lock)
            with db.session_scope() as s:
                db.set_meta(s, "backup_error", f"{type(e).__name__}: {e}"[:500])
                db.set_meta(s, "backup_error_at", db.now_iso())
        except Exception:
            pass
    finally:
        _lock.release()


def kick():
    """من /api/state: لو النسخة اليومية لسه ماتعملتش ← بتتعمل في الخلفية."""
    if _due():
        threading.Thread(target=_run, daemon=True).start()


def status(s):
    ok = db.get_meta(s, "backup_ok_at")
    return {"folder": folder(s), "custom": bool(db.get_meta(s, "backup_dir")), "defaultFolder": db.BACKUP_DIR,
            "lastOk": ok, "lastError": db.get_meta(s, "backup_error") or "", "lastErrorAt": db.get_meta(s, "backup_error_at")}


# ---------------------------------------------------------------------------
# الاستعادة
# ---------------------------------------------------------------------------
def read_zip(path):
    """البيانات من ZIP النسخة ← (data، عدد الملفات) أو ValueError."""
    try:
        with zipfile.ZipFile(path) as z:
            data = json.loads(z.read("data.json").decode("utf-8-sig"))
            n = sum(1 for i in z.infolist() if i.filename.startswith("files/") and not i.is_dir())
    except (KeyError, zipfile.BadZipFile, ValueError) as e:
        raise ValueError("ملف النسخة الاحتياطية غير صالح") from e
    if not isinstance(data, dict) or not isinstance(data.get("tables"), dict):
        raise ValueError("ملف النسخة الاحتياطية غير صالح")
    return data, n


def restore_files(path):
    """الملفات من ZIP النسخة ← مجلد البيانات (بتستبدل اللي بنفس الاسم، واللي مش في النسخة بيفضل)."""
    root = os.path.abspath(db.DATA_DIR)
    n = 0
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            if i.is_dir() or not i.filename.startswith("files/"):
                continue
            rel = i.filename[len("files/"):]
            if not rel.startswith(tuple(d + "/" for d in FILE_DIRS)):
                continue
            target = os.path.abspath(os.path.join(root, rel))
            if not target.startswith(root + os.sep):           # مسار بيخرج برّه مجلد البيانات ← بيتجاهل
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(i) as src, open(target, "wb") as dst:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    dst.write(chunk)
            n += 1
    return n
