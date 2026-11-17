@echo off
setlocal
rem Run semi-auto DM (--live) in a new PowerShell window that stays open.
rem Usage: double-click, or run: send-live.cmd [extra args]
cd /d "%~dp0..\.."
set "ARGS=%*"
if not defined ARGS set "ARGS=--max-followers 100000 --live --limit 10"
start "" powershell -NoExit -NoProfile -Command "node marketing/scripts/send.mjs %ARGS%"
endlocal
