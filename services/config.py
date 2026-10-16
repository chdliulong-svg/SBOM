# services/config.py
"""
Service BOM - 集中配置管理
支持从根目录 config.ini 配置文件和系统环境变量中读取配置参数。
如果 config.ini 不存在，会自动创建并写入默认配置与详细中文注释。
"""

import os
import secrets
import configparser

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
LOG_DIR = os.path.join(PROJECT_ROOT, 'logs')
SECRET_KEY_PATH = os.path.join(DATA_DIR, 'secret.key')
CONFIG_INI_PATH = os.path.join(PROJECT_ROOT, 'config.ini')

for _d in (DATA_DIR, LOG_DIR):
    os.makedirs(_d, exist_ok=True)

DEFAULT_CONFIG_INI_CONTENT = """# ==============================================================================
# 风电机组 Service BOM 应用程序配置文件 (config.ini)
# ==============================================================================
# 使用说明：
# 1. 修改本文件中的参数后，重新启动程序即可生效。
# 2. 井号 (#) 或分号 (;) 开头的行均为注释说明，不会生效。
# 3. 文件编码格式请保存为 UTF-8。
# ==============================================================================

[server]
# 监听网络地址
# - 0.0.0.0  : 允许本机及局域网其他电脑访问（推荐，团队协同共享）
# - 127.0.0.1: 仅允许本机访问
host = 0.0.0.0

# Web 服务运行端口号 (默认 8000，如与其他软件冲突可修改为 8080、8888、5000 等)
port = 8000

# 启动程序时是否自动在默认浏览器中打开系统首页 (true / false)
open_browser = true

# Waitress 生产级多线程服务器工作线程数 (推荐 16 ~ 32)
threads = 24

# 服务器最大并发连接数上限
connection_limit = 120

[storage]
# 单个文件上传体积上限 (MB)
# 用于控制 CAD 3D模型(.step/.stp)、实物照片、技术手册(PDF)及大体量 Excel 的上传上限
upload_max_mb = 200

# 浏览器登录/会话保持有效时长 (天)
session_lifetime_days = 7

[business]
# 新建项目或导入项目时的默认所属单位/公司名称
company_default = 上海电气风电集团股份有限公司

# 默认表单记录编号 (Excel 封面受控表单编号)
form_no_default = FDJL-JS-037

[backup]
# 本地保留的最大 SQLite 数据库快照份数 (超出将自动按时间滚动清理最早的快照)
max_keep_db = 30

# 本地保留的最大完整资产归档份数 (包含实物照片图库与技术手册)
max_keep_assets = 7

# 局域网共享或 NAS 远端备份目录绝对路径 (可选，留空则仅在本地 backups/ 目录备份)
# 例如: \\\\192.168.1.100\\SharedBackups\\SBOM 或 D:\\Backups
remote_backup_dir = 

[security]
# 登录鉴权开关：
# - on   : 开启访问口令保护（团队成员输入统一口令后进入工作台）
# - off  : 关闭登录保护（免登录模式，直接进入工作台）
# - auto : 局域网访问需口令，本机 (127.0.0.1) 访问免登录
auth_mode = on

# 自定义访问口令（留空则首次启动由系统在终端自动生成随机口令并保存在 data/auth.json）
# 例如: ServiceBOM2026
admin_password = 
"""


def ensure_config_ini_exists():
    """如果根目录下不存在 config.ini，自动生成一份带完整注释的默认配置文件。"""
    if not os.path.exists(CONFIG_INI_PATH):
        try:
            with open(CONFIG_INI_PATH, 'w', encoding='utf-8') as f:
                f.write(DEFAULT_CONFIG_INI_CONTENT.strip() + '\n')
        except Exception:
            pass


def get_secret_key():
    """
    获取 Flask 会话签名密钥。
    优先级：环境变量 SBOM_SECRET_KEY > data/secret.key（首次自动生成并持久化）> 临时随机。
    持久化是为了避免每次重启后所有已登录用户被强制登出。
    """
    env_key = (os.environ.get('SBOM_SECRET_KEY') or '').strip()
    if env_key:
        return env_key

    if os.path.exists(SECRET_KEY_PATH):
        try:
            with open(SECRET_KEY_PATH, 'r', encoding='utf-8') as f:
                cached = f.read().strip()
            if cached:
                return cached
        except Exception:
            pass

    key = secrets.token_hex(32)
    try:
        with open(SECRET_KEY_PATH, 'w', encoding='utf-8') as f:
            f.write(key)
        try:
            os.chmod(SECRET_KEY_PATH, 0o600)
        except Exception:
            pass
    except Exception:
        pass
    return key


class Config:
    """应用运行时配置管理器。"""

    def __init__(self):
        ensure_config_ini_exists()
        self.config_file = CONFIG_INI_PATH

        self._parser = configparser.ConfigParser()
        if os.path.exists(CONFIG_INI_PATH):
            try:
                self._parser.read(CONFIG_INI_PATH, encoding='utf-8')
            except Exception as e:
                print(f"[警告] 读取配置文件 {CONFIG_INI_PATH} 异常: {e}，将采用默认配置")

        # --- [server] ---
        self.host = self._get_str('server', 'host', '0.0.0.0')
        self.port = self._get_int('server', 'port', 8000, 1, 65535)
        self.open_browser = self._get_bool('server', 'open_browser', True)
        self.threads = self._get_int('server', 'threads', 24, 1, 128)
        self.connection_limit = self._get_int('server', 'connection_limit', 120, 1, 1000)

        # --- [security] ---
        raw_mode = self._get_str('security', 'auth_mode', 'on').lower()
        if raw_mode not in ('on', 'off', 'auto'):
            raw_mode = 'on'
        self.auth_mode = raw_mode
        self.admin_password = self._get_str('security', 'admin_password', '')

        # --- [storage] ---
        self.upload_max_mb = self._get_int('storage', 'upload_max_mb', 200, 1, 4096)
        self.session_lifetime_days = self._get_int('storage', 'session_lifetime_days', 7, 1, 365)
        self.headless = bool(os.environ.get('HEADLESS')) or not self.open_browser

        # --- [business] ---
        self.company_default = self._get_str('business', 'company_default', '上海电气风电集团股份有限公司')
        self.form_no_default = self._get_str('business', 'form_no_default', 'FDJL-JS-037')

        # --- [backup] ---
        self.max_keep_db = self._get_int('backup', 'max_keep_db', 30, 1, 500)
        self.max_keep_assets = self._get_int('backup', 'max_keep_assets', 7, 1, 100)
        self.remote_backup_dir = self._get_str('backup', 'remote_backup_dir', '')

    def _get_str(self, section, option, default):
        env_val = os.environ.get(option.upper()) or os.environ.get(f"SBOM_{option.upper()}")
        if env_val is not None and env_val.strip() != '':
            return env_val.strip()
        if self._parser.has_option(section, option):
            val = self._parser.get(section, option).strip()
            if val != '':
                return val
        return default

    def _get_int(self, section, option, default, minimum=None, maximum=None):
        raw = os.environ.get(option.upper()) or os.environ.get(f"SBOM_{option.upper()}")
        if raw is None or str(raw).strip() == '':
            if self._parser.has_option(section, option):
                raw = self._parser.get(section, option).strip()
        try:
            val = int(str(raw).strip())
        except (TypeError, ValueError):
            val = default
        if minimum is not None:
            val = max(minimum, val)
        if maximum is not None:
            val = min(maximum, val)
        return val

    def _get_bool(self, section, option, default):
        raw = os.environ.get(option.upper()) or os.environ.get(f"SBOM_{option.upper()}")
        if raw is None or str(raw).strip() == '':
            if self._parser.has_option(section, option):
                raw = self._parser.get(section, option).strip()
        if raw is None or str(raw).strip() == '':
            return default
        return str(raw).strip().lower() in ('1', 'true', 'yes', 'on')

    @property
    def auth_required(self):
        """当前是否要求登录。"""
        if self.auth_mode == 'on':
            return True
        if self.auth_mode == 'off':
            return False
        # auto：仅监听回环地址时视为免密，外部/局域网访问需口令
        return self.host not in ('127.0.0.1', 'localhost')

    @property
    def max_content_length(self):
        return self.upload_max_mb * 1024 * 1024

    @property
    def auth_mode_label(self):
        if self.auth_mode == 'on':
            return '已启用口令保护'
        if self.auth_mode == 'off':
            return '已关闭（免登录模式）'
        return ('自动（局域网共享需口令）' if self.auth_required else '自动（仅本机免登录）')


config = Config()
