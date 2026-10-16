# 变桨系统Service BOM

本系统针对风电机组运维备件 BOM（Service BOM）在 Excel 中维护时的两大痛点而开发：
1. **彻底解决增删行排版难题**：图片与文档不再以悬浮层方式手动粘贴，而是解耦为独立资产库。在界面中增删行、拖拽移动上下行时，行号、序号自动重排，图片与手册永不错位。
2. **彻底解决多机型数据重复维护**：建立“全局通用物料主库（Material Master）”。通用备件（如液位传感器、润滑泵、接头、软管）全库只维护一次，说明书和照片更新后，所有引用该物料的风电机型 BOM 自动全部同步。

---

## 快速启动 (Ubuntu 22.04 LTS)

### 方案一：一键自动化安装（推荐）
```bash
sudo bash setup.sh
# 或执行: sudo bash deploy/linux/install_ubuntu2204.sh
```
脚本将自动配置系统依赖、Python 虚拟环境、必要目录与权限，并将服务注册为 `systemd` 系统服务（开机自启、故障自愈）。

### 方案二：手动命令行启动
```bash
# 1. 激活虚拟环境并安装依赖
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. 启动服务 (通过 Gunicorn 生产级 WSGI)
bash deploy/linux/start_server.sh

# 3. 停止服务
bash deploy/linux/stop_server.sh
```

- **本机访问**：[http://127.0.0.1:8000](http://127.0.0.1:8000)
- **局域网访问**：`http://<虚拟机IP>:8000`
- **默认访问口令**：`102345678`

---

## 核心功能与使用指南

### 1. BOM 表格在线增删改排
- **➕ 添加物料行**：点击“添加物料行”，在搜索框输入物料号（如 `DFB...`）或元器件名称，系统会自动从物料主库中补全名称、规格、制造商、图片与手册，并可选择插入到指定行后或表格末尾。
- **❌ 删除物料行**：点击对应行的“❌ 删除”按钮，本行即时移除，后续行号、序号自动连续重编，绝不会留下一堆悬浮残留图片。
- **⬆️ / ⬇️ 上移下移**：点击上下箭头即可随时调整零部件顺序。
- **✏️ 原地编辑**：修改单机数量、层级代号（• / ••）、图纸代号、补充说明等。

### 2. 图片与手册附件直观管理
- **📄 技术手册**：每一行若有关联 PDF 手册，直接点击 **“📄 查看手册”** 即可在浏览器新标签页预览；若没有，可点击 **“➕ 上传”** 直接上传 PDF。
- **🖼️ 零部件实物图**：鼠标悬停即有缩略图，点击可弹出高清大图，也可随时点击上传/更换新图片。

### 3. 全局通用物料主库
- 顶部导航栏点击 **“📚 物料主库中心”**，可统一检索、查看、编辑全公司风电机组共享的标准件与外购件。
- 在物料主库更新某款润滑泵的说明书或外观照片后，**所有引用它的机型（如 EW6.25、EW8.0 等）自动全部生效**。

### 4. 导入与导出标准 Excel
- **📥 一键导出标准 SBOM.xlsx**：点击顶部绿色按钮，系统自动根据上海电气风电集团标准模版（`FDJL-JS-037`）生成包含封面、签字修改页、各子系统 BOM 的最新 `.xlsx` 文件，图片按格子比例自动缩放居中，手册生成超链接。
- **📤 读取/导入 Excel**：支持上传其他现有 SBOM Excel 模版，系统会自动反向解包并导入数据库。

---

## 系统目录结构

```text
023-service bom/
├── app.py                      # Web 管理系统主程序 (Flask 服务调度总入口)
├── config.ini                  # 系统核心运行配置 (端口、认证、并发数等)
├── data/                       # 核心业务数据库专用目录 (service_bom.db)
├── requirements.txt            # Python 依赖包清单 (Flask, openpyxl, Pillow, gunicorn 等)
├── deploy/                     # 生产部署与运维工具目录
│   ├── linux/                  # Ubuntu / Linux 生产部署与服务管理
│   │   ├── install_ubuntu2204.sh # Ubuntu 22.04 LTS 一键全自动部署脚本
│   │   ├── service-bom.service # systemd 系统守护进程配置文件
│   │   ├── start_server.sh     # Gunicorn 生产启动脚本
│   │   ├── stop_server.sh      # 安全停止服务脚本
│   │   └── nginx_service_bom.conf # Nginx 局域网反代与静态加速配置
│   └── docker/                 # Docker 容器化配置 (Dockerfile, docker-compose)
├── services/                   # 核心底层业务引擎与服务层 (专用业务包)
│   ├── database.py             # SQLite 数据库模型与 WAL 事务控制
│   ├── importer.py             # Excel 模版/数据/图片/PDF 自动抽取导入器
│   ├── exporter.py             # 标准 Excel 报表自动渲染生成器
│   ├── master_importer.py      # 主物料库 Excel 批量导入器
│   ├── comparator.py           # BOM 多版本/跨机型对比引擎
│   ├── backup_manager.py       # 数据库快照与自动灾备回退管理器
│   ├── data_audit.py           # 物料库重复数据审计与体检引擎
│   ├── offline_packager.py     # 离线数据包与资源打包器
│   └── project_bundle.py       # 工程包导入导出器
├── blueprints/                 # 模块化路由蓝图 (RESTful API 控制层)
│   ├── projects.py             # 工程与机型管理
│   ├── bom.py                  # BOM 行级维护
│   ├── materials.py            # 物料主库维护
│   ├── compare.py              # 对比接口
│   ├── assets.py               # 图片手册资源接口
│   └── backups.py              # 备份恢复接口
├── assets/                     # 统一资产库 (全系统同款物料只存一份)
│   ├── images/                 # 物料实物图片 (DFBxxxx.png)
│   └── manuals/                # 提取出的技术手册 PDF (DFBxxxx.pdf)
├── Excel 模版/                 # 标准 Excel 空模版 (SBOM_模版.xlsx)
├── templates/                  # 前端模板 (index.html)
├── static/                     # 前端静态资源 (pdf.js 等)
├── backups/                    # 自动生成的数据库快照归档
├── uploads/                    # 临时上传目录 (导入完成后自动缓冲)
└── exports/                    # 导出的 Excel 成果物存储目录
```
