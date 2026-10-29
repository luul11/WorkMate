@echo off
rem ---------------------------------------------------------------
rem  WorkMate launcher
rem  Keep this file pure ASCII. A Chinese folder path plus UTF-8
rem  text can make cmd.exe mis-parse lines and close the window
rem  silently, which looks like "the bat does nothing".
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0"

rem Some terminals export this, which turns Electron into plain Node.
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\electron\dist\electron.exe" goto noinstall

rem Extra args pass through, e.g.  start.bat --dev
start "WorkMate" "%~dp0node_modules\electron\dist\electron.exe" . %*
exit /b 0

:noinstall
echo.
echo   Electron is not installed in this folder yet.
echo   Run this once here:   npm install
echo.
pause
exit /b 1
