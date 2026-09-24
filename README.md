# Lunx — نظام الموارد البشرية والعمليات الحكومية

شركة أبراج انرجي ومجموعة شركاتها التابعة. Flask + SQLAlchemy (SQLite افتراضيًا، ويدعم PostgreSQL / MySQL / SQL Server).

## التشغيل في Docker (الإنتاج)
```bash
cp .env.example .env      # غيّر كلمات السر
docker compose up -d --build
```
بيشغّل Lunx مع PostgreSQL. لنقل بيانات lunx.db الحالية:
```bash
docker compose run --rm -v C:/lunx-import:/import app import-sqlite /import/lunx.db
```
التفاصيل في SYSTEM.md (القسم 17).

## التشغيل المحلي
```bash
pip install -r requirements.txt
python app.py        # http://localhost:5050
```
على ويندوز: `run_windows.bat`.

أول دخول: `admin` / `admin123`، غيّر الباسورد بعدها.

## قاعدة البيانات
الافتراضي `lunx.db` (SQLite). لتغيير النوع اضبط `LUNX_DATABASE_URL`، مثلًا:
```bash
set LUNX_DATABASE_URL=postgresql+psycopg://lunx:PASS@localhost/lunx
```
أداة الإدارة:
```bash
python manage_db.py info       # النوع والمراجعة وعدد الصفوف
python manage_db.py check      # فحص سلامة البيانات
python manage_db.py transfer sqlite:///lunx.db "postgresql+psycopg://..."
```
تعديلات الهيكل بتتطبق تلقائي (Alembic)، ونسخة احتياطية JSON بتتعمل كل يوم في `backups/`. التفاصيل في SYSTEM.md (القسم 15).

## البيانات
قاعدة البيانات (`lunx.db`) والمرفقات (`uploads/`) **مش مرفوعة على GitHub** لأن فيها بيانات شخصية للموظفين.
لتجهيز نسخة جديدة:
- إما ترجّع نسخة احتياطية من القائمة 👤 ← «استعادة نسخة احتياطية».
- أو `python lunx_restore.py "lunx-backup.json"`.

## التوثيق
هيكل النظام كامل في [SYSTEM.md](SYSTEM.md).
