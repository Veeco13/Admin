#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -r requirements.txt; }
[ -f lunx.db ] || .venv/bin/python seed_import.py
.venv/bin/python app.py
