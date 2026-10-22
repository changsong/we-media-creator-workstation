@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动自媒体内容运营工作台...
start "" http://127.0.0.1:5180
node server.js
pause
