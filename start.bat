@echo off
rem Installs (first time), builds and starts Krishbot. Double-click this file.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is needed. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if errorlevel 1 goto fail
if not exist web\dist\index.html call npm run build
if errorlevel 1 goto fail
if not exist server\dist\index.js call npm run build
if errorlevel 1 goto fail
start "" cmd /c "timeout /t 5 >nul & start http://localhost:8787"
echo Krishbot is starting at http://localhost:8787 (close this window to stop it)
call npm run serve
pause
exit /b 0
:fail
echo Something failed. Scroll up to read the error.
pause
exit /b 1
