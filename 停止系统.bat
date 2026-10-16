@echo off
chcp 65001 >nul
echo =======================================================
echo   正在停止 变桨系统Service BOM...
echo =======================================================

set FOUND=0

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
    echo 已终止端口 8000 上的后台服务进程 (PID: %%a)
    set FOUND=1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
    echo 已终止端口 5000 上的历史后台服务进程 (PID: %%a)
    set FOUND=1
)

if %FOUND%==0 (
    echo 未发现正在占用 8000 端口的服务进程，系统当前已处于关闭状态。
) else (
    echo.
    echo =======================================================
    echo   Service BOM 服务已彻底关闭，端口与数据库资源已释放！
    echo =======================================================
)

timeout /t 3 >nul
