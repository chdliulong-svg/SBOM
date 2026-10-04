@echo off
chcp 65001 >nul
title 自动配置 Windows Defender 防火墙 (放行 8000 端口)

echo ======================================================================
echo    正在为 Service BOM 系统配置防火墙入站规则 (TCP 8000 端口)
echo ======================================================================
echo.
echo 注意: 本脚本需要【以管理员身份运行】。
echo.

netsh advfirewall firewall delete rule name="Service BOM 局域网访问 (8000)" >nul 2>nul
netsh advfirewall firewall add rule name="Service BOM 局域网访问 (8000)" dir=in action=allow protocol=TCP localport=8000 profile=any >nul

if %ERRORLEVEL% equ 0 (
    echo [✓ 成功] 已成功添加防火墙规则！
    echo 局域网内的其他电脑现在可以通过 IP:8000 正常访问了。
) else (
    echo [✗ 失败] 权限不足，请右键点击本文件，选择【以管理员身份运行】！
)

echo.
pause
