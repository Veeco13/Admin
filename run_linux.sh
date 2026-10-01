#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/python -m pip install -q -r requirements.txt
# أول تشغيل ومعاه ملفات النظام القديم (data/manp.xlsx) ← استيرادها. العميل الجديد بيبدأ بقاعدة فاضية.
[ -f lunx.db ] || [ -n "$LUNX_DATABASE_URL" ] || [ ! -f data/manp.xlsx ] || .venv/bin/python seed_import.py
.venv/bin/python app.py
