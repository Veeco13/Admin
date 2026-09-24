# -*- coding: utf-8 -*-
"""
إدارة قاعدة بيانات Lunx من سطر الأوامر.

  python manage_db.py info                      نوع القاعدة + مراجعة الهيكل الحالية + عدد الصفوف
  python manage_db.py upgrade                   تطبيق كل تعديلات الهيكل (بيتعمل تلقائي مع تشغيل السيرفر)
  python manage_db.py downgrade <rev>           الرجوع لمراجعة أقدم (مثلاً 0001)
  python manage_db.py revision "وصف التعديل"    بعد تعديل models.py: توليد ملف migration تلقائي
  python manage_db.py history                   تاريخ تعديلات الهيكل
  python manage_db.py check                     فحص سلامة البيانات (مراجع يتيمة، جوازات مكررة …)
  python manage_db.py backup [ملف.json]         نسخة احتياطية كاملة (بالمستخدمين)
  python manage_db.py restore ملف.json          استعادة (نسخة Lunx / أي إصدار من نسخ Flask) — بيمسح الحالي
  python manage_db.py transfer <من> <إلى>       نقل كل البيانات بين نوعين قواعد (انظر db_transfer.py)

نوع القاعدة من LUNX_DATABASE_URL (الافتراضي sqlite:///lunx.db).
"""
import json
import sys

import db


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    from alembic import command

    if cmd == "upgrade":
        db.init_db()
        print("الهيكل محدّث. المراجعة:", db.current_revision())
    elif cmd == "downgrade":
        if not args:
            print("حدد المراجعة: python manage_db.py downgrade 0001")
            return 1
        cfg = db._alembic_config()
        with db.engine.connect() as conn:
            if conn.dialect.name == "sqlite":
                conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, args[0])
            conn.commit()
        print("المراجعة الحالية:", db.current_revision())
    elif cmd == "revision":
        msg = args[0] if args else "schema change"
        db.init_db()
        command.revision(db._alembic_config(), message=msg, autogenerate=True)
        print("راجع الملف الجديد في migrations/versions قبل ما تطبّقه بـ upgrade.")
    elif cmd == "history":
        command.history(db._alembic_config(), verbose=False)
    elif cmd in ("info", "check"):
        db.init_db()
        with db.session_scope(commit=False) as s:
            rep = db.integrity_report(s)
        print("قاعدة البيانات:", db.engine.url.render_as_string(hide_password=True))
        print("النوع:", db.engine.dialect.name, "| مراجعة الهيكل:", db.current_revision())
        for k, v in rep["counts"].items():
            print(f"  {k:24} {v}")
        if cmd == "check":
            ok = not rep["orphanReferences"] and not rep["duplicatePassports"]
            print("\nمراجع يتيمة:", rep["orphanReferences"] or "لا يوجد")
            print("جوازات مكررة:", rep["duplicatePassports"] or "لا يوجد")
            print("موظفين بدون شركة/مشروع:", rep["employeesWithoutCompany"])
            print("\n✔ سليمة" if ok else "\n⚠ فيه ملاحظات")
    elif cmd == "backup":
        print("اتحفظت في:", db.write_backup(args[0] if args else None))
    elif cmd == "restore":
        if not args:
            print("حدد ملف النسخة")
            return 1
        import lunx_restore
        db.init_db()
        data = json.load(open(args[0], encoding="utf-8-sig"))
        with db.session_scope() as s:
            if lunx_restore.is_lunx_state(data):
                print(lunx_restore.import_lunx_state(s, data, "سطر الأوامر"))
            else:
                skip = ("meta",) if data.get("tables", {}).get("users") else ("users", "meta")
                print(db.import_tables(s, data["tables"], replace=True, skip=skip))
                db.log_audit(s, "backup_restore", f"استعادة من سطر الأوامر: {args[0]}", "سطر الأوامر")
    elif cmd == "transfer":
        if len(args) != 2:
            print("الاستخدام: python manage_db.py transfer <من> <إلى>")
            return 1
        import db_transfer
        db_transfer.transfer(args[0], args[1])
    else:
        print("أمر غير معروف:", cmd)
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
