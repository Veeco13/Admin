# -*- coding: utf-8 -*-
"""
🩺 فحص السيستم الدوري (المرحلة 4)
- بيقرأ بس ومابيصلّحش حاجة: سلامة ملف القاعدة، المراجع اليتيمة، الهيكل على آخر تحديث، المرفقات (متسجّلة ومش
  موجودة / موجودة ومش مربوطة)، النسخ الاحتياطية ومساحة القرص، طلبات الموافقة والفواتير المتأخرة، وملخص جودة البيانات.
- كل بند: ok ✅ / warn ⚠️ / bad ❌ + شرح الحل. النتيجة بتتحفظ في meta (syscheck_result).
- بيشتغل لوحده كل EVERY_DAYS يوم من /api/state (في الخلفية)، ومن «🩺 فحص السيستم» لمدير النظام، ومن
  `python manage_db.py check`. الـ ❌ بيظهر لمدير النظام في الجرس.
"""
import json
import os
import shutil
import threading
from datetime import datetime, timedelta

from sqlalchemy import func, select, text

import backup
import db
import models as M

OK, WARN, BAD = "ok", "warn", "bad"
KEY, EVERY_DAYS = "syscheck_result", 7
FILE_COLS = ("path", "logoPath", "filePath")         # أعمدة المرفقات في أي جدول
SKIP_DIRS = ("imports",)                             # ملفات الاستيراد المؤقتة مش مرفقات
_lock = threading.Lock()


def _item(key, title, status, detail, hint=""):
    return {"key": key, "title": title, "status": status, "detail": detail, "hint": hint if status != OK else ""}


def _size(n):
    for unit in ("بايت", "ك.ب", "م.ب", "ج.ب"):
        if n < 1024 or unit == "ج.ب":
            return f"{n:.0f} {unit}" if unit == "بايت" else f"{n:.1f} {unit}"
        n /= 1024


def _days(n):
    return "يوم" if n == 1 else "يومين" if n == 2 else f"{n} أيام" if n <= 10 else f"{n} يوم"


def _database(s):
    out = []
    if s.get_bind().dialect.name == "sqlite":
        rows = [r[0] for r in s.execute(text("PRAGMA integrity_check")).all()]
        good = rows == ["ok"]
        out.append(_item("db_file", "سلامة ملف قاعدة البيانات", OK if good else BAD,
                         "الملف سليم" if good else "؛ ".join(rows[:5]),
                         "ملف القاعدة فيه تلف — استرجع آخر نسخة احتياطية سليمة من «💾 النسخ الاحتياطية»."))
    rep = db.integrity_report(s)
    orphans = rep["orphanReferences"]
    out.append(_item("db_refs", "المراجع بين الجداول", OK if not orphans else BAD,
                     "مفيش مراجع يتيمة" if not orphans else "، ".join(f"{k}: {v}" for k, v in orphans.items()),
                     "فيه سجلات بتشاور على سجل اتمسح — ابعت التفاصيل دي للدعم قبل أي تحديث."))
    return out


def _schema():
    from alembic.script import ScriptDirectory
    head = ScriptDirectory.from_config(db._alembic_config()).get_current_head()
    cur = db.current_revision()
    return _item("schema", "هيكل القاعدة على آخر تحديث", OK if cur == head else BAD, f"المراجعة {cur}" + ("" if cur == head else f" — المطلوب {head}"),
                 "أعد تشغيل البرنامج (التحديث بيتطبّق لوحده مع التشغيل)، أو: python manage_db.py upgrade")


def _files(s):
    """المرفقات: المتسجّل في القاعدة ومش موجود على الجهاز، والموجود في uploads ومش مربوط بحاجة."""
    ref, missing = set(), []
    for model in M.ALL_MODELS:
        for col in FILE_COLS:
            if not hasattr(model, col):
                continue
            for rel in s.scalars(select(getattr(model, col)).where(getattr(model, col).isnot(None))):
                if not rel:
                    continue
                path = os.path.normcase(os.path.abspath(db.resolve_file(rel)))
                ref.add(path)
                if not os.path.exists(path):
                    missing.append(f"{model.__tablename__}: {os.path.basename(rel)}")
    tdir = db.data_path("templates_docs")
    for name in s.scalars(select(M.Template.filename)):
        path = os.path.normcase(os.path.abspath(os.path.join(tdir, name)))
        ref.add(path)
        if not os.path.exists(path):
            missing.append(f"templates: {name}")
    loose, size = [], 0
    up = db.data_path("uploads")
    for root, dirs, names in os.walk(up):
        dirs[:] = [d for d in dirs if not (os.path.normcase(root) == os.path.normcase(up) and d in SKIP_DIRS)]
        for n in names:
            path = os.path.normcase(os.path.abspath(os.path.join(root, n)))
            if path not in ref:
                loose.append(os.path.relpath(path, db.DATA_DIR))
                size += os.path.getsize(path)
    return [
        _item("files_missing", "المرفقات المتسجّلة موجودة على الجهاز", OK if not missing else BAD,
              f"كل المرفقات موجودة ({len(ref)})" if not missing else f"{len(missing)} مرفق متسجّل ومش موجود: " + "، ".join(missing[:8]) + ("…" if len(missing) > 8 else ""),
              "الملفات دي اتمسحت أو اتنقلت من فولدر uploads — استرجعها من نسخة احتياطية، أو ارفعها تاني."),
        _item("files_loose", "ملفات في uploads مش مربوطة بحاجة", OK if not loose else WARN,
              "مفيش ملفات زيادة" if not loose else f"{len(loose)} ملف ({_size(size)}): " + "، ".join(os.path.basename(x) for x in loose[:6]) + ("…" if len(loose) > 6 else ""),
              "ملفات مرفوعة قديمة مالهاش سجل (مش مشكلة في الشغل — مساحة بس). راجعها قبل ما تمسحها."),
    ]


def _backups(s):
    st = backup.status(s)
    folder, last = st["folder"], st["lastOk"]
    out = []
    days = (datetime.now() - datetime.fromisoformat(last)).days if last else None
    if st["lastError"] and (not last or (st["lastErrorAt"] or "") > last):
        out.append(_item("backup", "النسخة الاحتياطية التلقائية", BAD, f"آخر محاولة فشلت: {st['lastError']}",
                         "افتح «💾 النسخ الاحتياطية» وصلّح مجلد النسخ (المسار أو الصلاحيات)."))
    elif days is None:
        out.append(_item("backup", "النسخة الاحتياطية التلقائية", WARN, "لسه مفيش نسخة تلقائية ناجحة متسجّلة",
                         "النسخة بتتعمل لوحدها أول ما حد يفتح البرنامج كل يوم — لو ماظهرتش بكرة راجع مجلد النسخ."))
    else:
        out.append(_item("backup", "النسخة الاحتياطية التلقائية", OK if days <= 2 else BAD,
                         f"آخر نسخة ناجحة {last[8:10]}/{last[5:7]}/{last[:4]}" + ("" if days <= 2 else f" (من {_days(days)})"),
                         "النسخة اليومية واقفة — افتح «💾 النسخ الاحتياطية» وراجع المجلد."))
    try:
        free = shutil.disk_usage(folder if os.path.isdir(folder) else db.DATA_DIR).free
        out.append(_item("disk", "المساحة الفاضية على القرص", OK if free > 2 * 1024 ** 3 else WARN if free > 300 * 1024 ** 2 else BAD,
                         f"{_size(free)} فاضية في {folder}", "المساحة قرّبت تخلص — النسخ الاحتياطية والمرفقات ممكن تفشل. فضّي مساحة أو غيّر مجلد النسخ."))
    except OSError as e:
        out.append(_item("disk", "المساحة الفاضية على القرص", WARN, f"مجلد النسخ مش مقروء: {e}", "راجع مسار مجلد النسخ الاحتياطية."))
    return out


def _waiting(s):
    out = []
    week = datetime.now() - timedelta(days=7)
    n = s.scalar(select(func.count()).select_from(M.ApprovalRequest).where(M.ApprovalRequest.status == "pending",
                                                                          M.ApprovalRequest.requestedAt < week)) or 0
    out.append(_item("approvals", "طلبات الموافقة", OK if not n else WARN, "مفيش طلبات متأخرة" if not n else f"{n} طلب مستني موافقة من أكتر من 7 أيام",
                     "افتح «✋ طلبات الموافقة» ووافق أو ارفض."))
    month = (datetime.now() - timedelta(days=30)).date()
    n = s.scalar(select(func.count()).select_from(M.Invoice).where(M.Invoice.status == "pending", M.Invoice.closingDate < month)) or 0
    out.append(_item("invoices", "فواتير بانتظار الحسابات", OK if not n else WARN, "مفيش فواتير متأخرة" if not n else f"{n} فاتورة بانتظار الحسابات من أكتر من 30 يوم",
                     "راجعها مع الحسابات وعلّمها «اعتمدتها الحسابات» من العهد ← الفواتير."))
    n = s.scalar(select(func.count()).select_from(M.Trash)) or 0
    out.append(_item("trash", "سلة المحذوفات", OK, f"{n} عنصر (بيتحذفوا نهائي بعد 90 يوم)"))
    return out


def _quality(sections):
    high = sum(len(x["items"]) for x in sections if x["severity"] == "high")
    rest = sum(len(x["items"]) for x in sections if x["severity"] != "high")
    return _item("quality", "جودة البيانات", OK if not high else WARN,
                 "مفيش ملاحظات مهمة" + (f" ({rest} ملاحظة بسيطة)" if rest else "") if not high else f"{high} ملاحظة مهمة" + (f" و{rest} بسيطة" if rest else ""),
                 "التفاصيل والتصليح من «📋 جودة البيانات».")


def run(s, quality=None):
    """الفحص كله ← {at, items, bad, warn}. quality = دالة جودة البيانات (من app.py) — اختيارية."""
    items = []
    for step in (lambda: _database(s), lambda: [_schema()], lambda: _files(s), lambda: _backups(s), lambda: _waiting(s),
                 lambda: [_quality(quality(s))] if quality else []):
        try:
            items += step()
        except Exception as e:                       # noqa: BLE001 — بند فشل مايوقفش الباقي
            items.append(_item("error", "خطأ أثناء الفحص", WARN, str(e)[:200], "ابعت الرسالة دي للدعم."))
    return {"at": db.now_iso(), "items": items, "bad": sum(1 for i in items if i["status"] == BAD),
            "warn": sum(1 for i in items if i["status"] == WARN)}


def save(s, result):
    db.set_meta(s, KEY, json.dumps(result, ensure_ascii=False))


def last(s):
    try:
        return json.loads(db.get_meta(s, KEY) or "null")
    except ValueError:
        return None


def summary(s):
    r = last(s)
    return {"at": r["at"], "bad": r["bad"], "warn": r["warn"]} if r else None


def run_and_save(quality=None):
    with db.session_scope() as s:
        result = run(s, quality)
        save(s, result)
    return result


def _due():
    with db.session_scope(commit=False) as s:
        r = last(s)
    return r is None or r["at"] < (datetime.now() - timedelta(days=EVERY_DAYS)).isoformat(timespec="seconds")


def kick(quality=None):
    """من /api/state: لو عدّى أسبوع على آخر فحص ← بيتعمل في الخلفية."""
    if not _due() or not _lock.acquire(blocking=False):
        return

    def work():
        try:
            run_and_save(quality)
        finally:
            _lock.release()

    threading.Thread(target=work, daemon=True).start()
