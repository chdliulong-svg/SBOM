#!/bin/bash
# ==============================================================================
# 变桨系统Service BOM - Linux 生产环境前台/守护启动脚本
# ==============================================================================
set -e

# 定位脚本所在的项目根目录
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "====================================================="
echo "  变桨系统Service BOM - 服务启动中..."
echo "  运行环境: Ubuntu / Linux (Gunicorn WSGI)"
echo "  工作目录: $PROJECT_DIR"
echo "====================================================="

# 1. 检查并激活虚拟环境
if [ -d "$PROJECT_DIR/.venv" ]; then
    echo "[1/3] 激活 Python 虚拟环境 (.venv)..."
    source "$PROJECT_DIR/.venv/bin/activate"
elif [ -d "$PROJECT_DIR/venv" ]; then
    echo "[1/3] 激活 Python 虚拟环境 (venv)..."
    source "$PROJECT_DIR/venv/bin/activate"
else
    echo "[警告] 未检测到 .venv 虚拟环境，使用系统 Python 环境运行"
fi

# 2. 检查必要核心目录
echo "[2/3] 检查并补齐核心数据存储目录..."
mkdir -p data assets/images assets/manuals uploads exports "Excel 模版" backups logs

# 3. 环境变量设置
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8000}"
export HEADLESS=true

echo "[3/3] 启动 Gunicorn 服务 (0.0.0.0:$PORT)..."
echo "  * 本机访问: http://127.0.0.1:$PORT"
echo "  * 局域网访问: http://<你的Ubuntu主机IP>:$PORT"
echo "-----------------------------------------------------"

exec gunicorn -w 2 --threads 4 -b "${HOST}:${PORT}" --timeout 120 app:app
