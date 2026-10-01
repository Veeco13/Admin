@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist .venv python -m venv .venv
.venv\Scripts\python -m pip install -q -r requirements.txt
rem First run with the old system's files (data\manp.xlsx) = import them. A new customer starts with an empty database.
if not exist lunx.db if exist data\manp.xlsx .venv\Scripts\python seed_import.py
start "" http://localhost:5050
rem HOST=0.0.0.0 = the app is reachable from other devices on the network (remove the line to keep it on this device only)
set HOST=0.0.0.0
.venv\Scripts\python app.py
pause
