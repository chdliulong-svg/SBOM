#!/bin/bash
# ==============================================================================
# 变桨系统Service BOM - Linux 停止服务脚本
# ==============================================================================
echo "正在停止 变桨系统Service BOM 后台服务..."

# 1. 尝试通过 systemctl 停止服务（如果注册了 systemd 服务）
if systemctl is-active --quiet service-bom 2>/dev/null; then
    echo "检测到 systemd 托管服务正在运行，执行 systemctl stop service-bom..."
    sudo systemctl stop service-bom
    echo "service-bom 服务已停止。"
    exit 0
fi

# 2. 如果是手动脚本运行的 Gunicorn 进程，通过 pkill / kill 停止
PIDS=$(pgrep -f "gunicorn.*app:app" || true)

if [ -n "$PIDS" ]; then
    echo "找到运行中的 Gunicorn 进程 (PID: $PIDS)，正在终止..."
    kill -TERM $PIDS 2>/dev/null || true
    sleep 1
    # 强制校验
    REMAIN_PIDS=$(pgrep -f "gunicorn.*app:app" || true)
    if [ -n "$REMAIN_PIDS" ]; then
        kill -9 $REMAIN_PIDS 2>/dev/null || true
    fi
    echo "所有相关进程已安全终止并释放端口。"
else
    echo "未发现运行中的 Gunicorn (app:app) 进程。"
fi
