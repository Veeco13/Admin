#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/python -m pip install -q -r requirements.txt
[ -f lunx.db ] || [ -n "$LUNX_DATABASE_URL" ] || .venv/bin/python seed_import.py
.venv/bin/python app.py
