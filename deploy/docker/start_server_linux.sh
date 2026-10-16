#!/bin/bash
# Linux 服务端生产启动脚本 (Gunicorn)
cd "$(dirname "$0")/../.."

# 检查虚拟环境
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# 安装或更新必要依赖
pip install -r requirements.txt -q

export HOST=0.0.0.0
export PORT=8000
export HEADLESS=true

echo "====================================================="
echo "  变桨系统Service BOM 协同系统 服务端启动中"
echo "  服务已通过 Gunicorn 在 0.0.0.0:8000 监听"
echo "====================================================="

exec gunicorn -w 2 --threads 4 -b 0.0.0.0:8000 --timeout 120 app:app
