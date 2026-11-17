@echo off
REM Orbit Tracker — double-click to start the server on Windows.
REM Requires Node.js (https://nodejs.org) to be installed first.

cd /d "%~dp0"
echo Starting Orbit Tracker...
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4173"
node server.js
pause
