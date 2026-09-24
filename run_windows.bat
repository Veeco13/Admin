@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist .venv python -m venv .venv
.venv\Scripts\python -m pip install -q -r requirements.txt
if not exist lunx.db .venv\Scripts\python seed_import.py
start "" http://localhost:5050
.venv\Scripts\python app.py
pause
