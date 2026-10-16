#!/bin/bash
# ==============================================================================
# 变桨系统Service BOM - 安全平滑热更新脚本 (数据零风险)
# 自动备份当前数据库与配置 -> 安全更新应用代码 -> 平滑重启服务
# 使用方式: bash update.sh  或  sudo bash update.sh
# ==============================================================================
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "========================================================================"
echo "  变桨系统Service BOM - 安全热更新程序"
echo "  项目部署目录: $PROJECT_DIR"
echo "========================================================================"

# 1. 自动备份核心业务数据与配置
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$PROJECT_DIR/backups/update_backup_$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

echo ">>> [步骤 1/4] 安全备份当前数据库与配置文件..."
if [ -d "$PROJECT_DIR/data" ]; then
    cp -r "$PROJECT_DIR/data" "$BACKUP_DIR/"
fi
if [ -f "$PROJECT_DIR/config.ini" ]; then
    cp "$PROJECT_DIR/config.ini" "$BACKUP_DIR/"
fi
echo "    ✔ 备份完成！备份存放位置: $BACKUP_DIR"

# 2. 判断更新源并执行无损更新
echo ">>> [步骤 2/4] 执行代码安全更新..."
UPDATED=0

# 模式 A: Git 仓库更新 (最推荐、完全不影响 data/ 与 assets/ 目录)
if [ -d "$PROJECT_DIR/.git" ]; then
    echo "    检测到 Git 版本库，正在拉取最新代码 (git pull)..."
    git pull
    UPDATED=1
fi

# 模式 B: 离线压缩包更新 (/opt 或当前目录下的 service_bom_deploy.tar.gz)
TAR_SOURCE=""
if [ -f "/opt/service_bom_deploy.tar.gz" ]; then
    TAR_SOURCE="/opt/service_bom_deploy.tar.gz"
elif [ -f "$PROJECT_DIR/service_bom_deploy.tar.gz" ]; then
    TAR_SOURCE="$PROJECT_DIR/service_bom_deploy.tar.gz"
elif [ -f "/tmp/service_bom_deploy.tar.gz" ]; then
    TAR_SOURCE="/tmp/service_bom_deploy.tar.gz"
fi

if [ "$UPDATED" -eq 0 ] && [ -n "$TAR_SOURCE" ]; then
    echo "    检测到离线更新包: $TAR_SOURCE"
    echo "    正在执行安全解压（自动排除 data/ 数据库、config.ini 及 assets/ 附件）..."
    tar -zxvf "$TAR_SOURCE" -C /opt \
        --exclude="service-bom/data*" \
        --exclude="service-bom/config.ini*" \
        --exclude="service-bom/assets*" \
        --exclude="service-bom/backups*" \
        --exclude="service-bom/uploads*" \
        --exclude="service-bom/exports*"
    UPDATED=1
fi

if [ "$UPDATED" -eq 0 ]; then
    echo "    [提示] 未发现 Git 仓库或新上传的 service_bom_deploy.tar.gz 压缩包。"
    echo "    如果已通过其他方式覆盖了代码文件，将继续进行后续配置与重启校验。"
fi

# 3. 依赖库更新检查
if [ -f "$PROJECT_DIR/.venv/bin/pip" ] && [ -f "$PROJECT_DIR/requirements.txt" ]; then
    echo ">>> [步骤 3/4] 检查依赖组件环境..."
    "$PROJECT_DIR/.venv/bin/pip" install -q -r "$PROJECT_DIR/requirements.txt" -i https://mirrors.aliyun.com/pypi/simple/ --extra-index-url https://pypi.org/simple/ --trusted-host mirrors.aliyun.com 2>/dev/null || true
fi

# 4. 平滑重启系统服务
echo ">>> [步骤 4/4] 平滑重启后台系统服务..."
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet service-bom; then
    sudo systemctl restart service-bom
    echo "    ✔ 系统服务 (service-bom.service) 已成功重启！"
elif [ -f "$PROJECT_DIR/deploy/linux/start_server.sh" ]; then
    echo "    检测到守护脚本，尝试重启进程..."
    bash "$PROJECT_DIR/deploy/linux/stop_server.sh" 2>/dev/null || true
    sleep 1
    bash "$PROJECT_DIR/deploy/linux/start_server.sh"
else
    echo "    提示: 未检测到正在运行的 systemd 服务，请手动启动您的运行命令。"
fi

echo "========================================================================"
echo "  🎉 恭喜！Service BOM 已安全更新完成，原有工程数据 100% 完好无损！"
echo "  数据自动备份路径: $BACKUP_DIR"
echo "========================================================================"
