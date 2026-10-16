@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."

echo =======================================================
echo   变桨系统Service BOM - 服务器模式
echo   采用生产级多线程 WSGI 服务器 (Waitress)
echo   启动后局域网所有成员可通过 http://服务器IP:8000 协同访问
echo =======================================================

set HOST=0.0.0.0
set PORT=8000
set HEADLESS=true


if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" app.py
) else (
    python app.py
)

pause
