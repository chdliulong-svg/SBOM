#!/bin/bash
# ==============================================================================
# 变桨系统Service BOM - Ubuntu 22.04 LTS 全自动一键部署脚本
# 适用环境: 全新安装的 Ubuntu 22.04 虚拟机 / 物理机 (已联网)
# 执行方式: sudo bash deploy/linux/install_ubuntu2204.sh  或  sudo bash setup.sh
# ==============================================================================
set -e

# 必须使用 root 或 sudo 权限运行
if [ "$EUID" -ne 0 ]; then
  echo "【错误】请使用 root 或 sudo 权限运行此部署脚本: sudo bash $0"
  exit 1
fi

# 抑制 apt 交互弹窗（避免 Ubuntu 22.04 needrestart 提示卡住安装流程）
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CURRENT_USER="${SUDO_USER:-$USER}"
CURRENT_GROUP="$(id -gn "$CURRENT_USER" 2>/dev/null || echo "$CURRENT_USER")"

echo "========================================================================"
echo "  变桨系统Service BOM - Ubuntu 22.04 LTS 全自动一键部署"
echo "  当前部署根目录: $PROJECT_DIR"
echo "  系统运行用户:   $CURRENT_USER:$CURRENT_GROUP"
echo "========================================================================"

# 1. 更新 apt 索引并安装系统底层基础应用与库
echo ">>> [步骤 1/5] 更新系统并安装系统依赖包、底层图形库与中文字体..."
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

# 升级 pip 并通过国内高速镜像安装核心 Python 依赖库
echo ">>> 安装 Python 依赖包 (requirements.txt)..."
.venv/bin/pip install --upgrade pip -i https://mirrors.aliyun.com/pypi/simple/ --extra-index-url https://pypi.org/simple/ --trusted-host mirrors.aliyun.com
.venv/bin/pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --extra-index-url https://pypi.org/simple/ --trusted-host mirrors.aliyun.com

# 3. 初始化必要的持久化数据目录与权限
echo ">>> [步骤 3/5] 初始化业务数据持久化目录与权限..."
mkdir -p data assets/images assets/manuals uploads exports "Excel 模版" backups logs
chown -R "$CURRENT_USER":"$CURRENT_GROUP" "$PROJECT_DIR"
chmod -R 755 "$PROJECT_DIR"

# 4. 赋予 shell 脚本可执行权限
chmod +x "$PROJECT_DIR"/deploy/linux/*.sh 2>/dev/null || true
if [ -f "$PROJECT_DIR/setup.sh" ]; then
    chmod +x "$PROJECT_DIR/setup.sh"
fi

# 5. 配置 systemd 系统服务自启动
echo ">>> [步骤 4/5] 配置并注册 systemd 系统服务 (service-bom.service)..."
SERVICE_FILE="/etc/systemd/system/service-bom.service"

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Pitch System Service BOM Management Service (变桨系统Service BOM)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
Group=$CURRENT_GROUP
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
echo ">>> [步骤 5/5] 配置防火墙规则 (放行 8000 端口)..."
if command -v ufw > /dev/null 2>&1; then
    ufw allow 8000/tcp comment "Service BOM Web Port" > /dev/null 2>&1 || true
fi

# 7. 等待 2 秒校验服务是否正常响应
echo ">>> 正在进行服务健康探活..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/auth/status || echo "000")

echo "========================================================================"
if [ "$HTTP_CODE" = "200" ]; then
    echo "  🎉 恭喜！变桨系统Service BOM 已成功部署并启动运行！"
else
    echo "  ⚠️ 服务已启动，正在初始化加载中 (HTTP Code: $HTTP_CODE)..."
fi
echo "  服务已通过 systemd 守护并设置为【开机自启】。"
echo "------------------------------------------------------------------------"
echo "  常用管理命令："
echo "  - 查看服务状态:   sudo systemctl status service-bom"
echo "  - 查看实时日志:   sudo journalctl -u service-bom -f"
echo "  - 重启系统服务:   sudo systemctl restart service-bom"
echo "  - 停止系统服务:   sudo systemctl stop service-bom"
echo "------------------------------------------------------------------------"
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "  访问地址："
echo "  * 本机访问:     http://127.0.0.1:8000"
if [ -n "$LOCAL_IP" ]; then
    echo "  * 局域网访问:   http://${LOCAL_IP}:8000"
fi
echo "  * 默认访问口令: 102345678"
echo "========================================================================"
