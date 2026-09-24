@echo off
chcp 65001 >nul
cd /d %~dp0
set REPO=https://github.com/Veeco13/Admin.git

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Download it from https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist .git (
  git init
  git checkout -b main
  git remote add origin %REPO%
)
git remote set-url origin %REPO%

git config user.name >nul 2>nul || git config user.name "Veeco13"
git config user.email >nul 2>nul || git config user.email "veeco39@gmail.com"

git add -A
git commit -m "Lunx update %date% %time%" || echo No new changes to commit.

git ls-remote --exit-code --heads origin main >nul 2>nul
if not errorlevel 1 git pull --rebase --allow-unrelated-histories origin main

git push -u origin main
echo.
echo Done.
pause
