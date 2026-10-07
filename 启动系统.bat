@echo off
chcp 65001 >nul
title 风电机组 Service BOM 协同管理系统

echo ======================================================================
echo    风电机组 Service BOM 协同管理系统 - 快速启动
echo ======================================================================
echo.

cd /d "%~dp0"

:: 检查 Python 运行环境

set "PYTHON_CMD="
if exist ".venv\Scripts\python.exe" (
    set "PYTHON_CMD=.venv\Scripts\python.exe"
) else (
    where python >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        set "PYTHON_CMD=python"
    )
)

if "%PYTHON_CMD%"=="" (
    echo [错误] 未找到 Python 运行环境！
    echo 请确认已安装 Python 或在当前目录创建了 .venv 虚拟环境。
    echo.
    pause
    exit /b 1
)

echo [✓] Python 环境检测正常: %PYTHON_CMD%
echo [✓] 正在启动后台服务，请保持此窗口开启（缩小到任务栏即可）...
echo.

%PYTHON_CMD% app.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo [提示] 服务已停止运行。
    pause
)
