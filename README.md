# Lunx — نظام الموارد البشرية والعمليات الحكومية

شركة أبراج انرجي ومجموعة شركاتها التابعة. Flask + SQLite.

## التشغيل
```bash
pip install -r requirements.txt
python app.py        # http://localhost:5050
```
على ويندوز: `run_windows.bat`.

أول دخول: `admin` / `admin123`، غيّر الباسورد بعدها.

## البيانات
قاعدة البيانات (`lunx.db`) والمرفقات (`uploads/`) **مش مرفوعة على GitHub** لأن فيها بيانات شخصية للموظفين.
لتجهيز نسخة جديدة:
- إما ترجّع نسخة احتياطية من القائمة 👤 ← «استعادة نسخة احتياطية».
- أو `python lunx_restore.py "lunx-backup.json"`.

## التوثيق
هيكل النظام كامل في [SYSTEM.md](SYSTEM.md).
