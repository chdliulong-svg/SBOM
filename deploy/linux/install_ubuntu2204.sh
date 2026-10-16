#!/bin/bash
# ==============================================================================
# 变桨系统Service BOM - Ubuntu 22.04 LTS 全自动一键部署脚本
# 适用环境: 全新安装的 Ubuntu 22.04 虚拟机 / 物理机
# 执行方式: sudo bash deploy/linux/install_ubuntu2204.sh
# ==============================================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "【错误】请使用 root 或 sudo 权限运行此部署脚本: sudo bash $0"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CURRENT_USER="${SUDO_USER:-$USER}"

echo "========================================================================"
echo "  变桨系统Service BOM - Ubuntu 22.04 LTS 自动化生产环境部署"
echo "  当前部署根目录: $PROJECT_DIR"
echo "  运行用户:       $CURRENT_USER"
echo "========================================================================"

# 1. 更新 apt 索引并安装系统底层基础应用与库
echo ">>> [步骤 1/5] 安装系统依赖包、编译运行库与中文字体..."
apt-get update -y
apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    build-essential \
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    libfreetype6-dev \
    fonts-noto-cjk \
    fonts-wqy-microhei \
    fonts-wqy-zenhei \
    fontconfig \
    sqlite3 \
    curl \
    git \
    ufw

# 刷新系统字体缓存（确保报表与图像生成中文不出现方块乱码）
echo ">>> 刷新中文字体缓存..."
fc-cache -fv > /dev/null 2>&1

# 2. 创建并配置 Python 独立虚拟环境
echo ">>> [步骤 2/5] 配置 Python 虚拟环境 (.venv)..."
cd "$PROJECT_DIR"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi

# 升级 pip 并安装项目核心 Python 依赖库
echo ">>> 安装 Python 依赖包 (requirements.txt)..."
.venv/bin/pip install --upgrade pip -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
.venv/bin/pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com

# 3. 初始化必要的持久化数据目录与权限
echo ">>> [步骤 3/5] 初始化业务数据持久化目录与权限..."
mkdir -p data assets/images assets/manuals uploads exports "Excel 模版" backups logs
chown -R "$CURRENT_USER":"$CURRENT_USER" "$PROJECT_DIR"
chmod -R 755 "$PROJECT_DIR"

# 4. 赋予 shell 脚本可执行权限
chmod +x "$PROJECT_DIR"/deploy/linux/*.sh

# 5. 配置 systemd 系统服务自启动
echo ">>> [步骤 4/5] 配置 systemd 服务 (service-bom.service)..."
SERVICE_FILE="/etc/systemd/system/service-bom.service"

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Pitch System Service BOM Management Service (变桨系统Service BOM)
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
Group=$CURRENT_USER
WorkingDirectory=$PROJECT_DIR
Environment="PATH=$PROJECT_DIR/.venv/bin:/usr/local/bin:/usr/bin"
Environment="HEADLESS=true"
Environment="HOST=0.0.0.0"
Environment="PORT=8000"

ExecStart=$PROJECT_DIR/.venv/bin/gunicorn -w 2 --threads 4 -b 0.0.0.0:8000 --timeout 120 --access-logfile - --error-logfile - app:app

Restart=always
RestartSec=5s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable service-bom.service
systemctl restart service-bom.service

# 6. 配置防火墙放行 8000 端口
echo ">>> [步骤 5/5] 配置防火墙规则..."
if command -v ufw > /dev/null 2>&1; then
    ufw allow 8000/tcp comment "Service BOM Web Port" > /dev/null 2>&1 || true
fi

echo "========================================================================"
echo "  🎉 部署成功！"
echo "  服务已通过 systemd 托管并在后台开机自启。"
echo "  - 查看服务状态: sudo systemctl status service-bom"
echo "  - 查看实时日志: sudo journalctl -u service-bom -f"
echo "  - 重启服务:     sudo systemctl restart service-bom"
echo "  - 停止服务:     sudo systemctl stop service-bom"
echo ""
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "  本机访问地址:   http://127.0.0.1:8000"
if [ -n "$LOCAL_IP" ]; then
    echo "  局域网访问地址: http://${LOCAL_IP}:8000"
fi
echo "========================================================================"
