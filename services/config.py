# services/config.py
"""
Service BOM - 集中配置管理

替代原先散落在各处的硬编码常量：密钥、鉴权模式、上传限制、会话有效期、目录路径。
所有敏感值优先从环境变量读取，其次持久化到 data/ 目录（该目录已加入 .gitignore）。
"""

import os
import secrets

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
LOG_DIR = os.path.join(PROJECT_ROOT, 'logs')
SECRET_KEY_PATH = os.path.join(DATA_DIR, 'secret.key')

for _d in (DATA_DIR, LOG_DIR):
    os.makedirs(_d, exist_ok=True)

# 局域网共享时视为"不可信网络"，需要登录；仅本机监听时视为可信环境。
_TRUSTED_HOSTS = ('127.0.0.1', 'localhost', '::1')


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
        # 尽量限制为本机当前用户可读（Windows 上 chmod 支持有限，失败可忽略）
        try:
            os.chmod(SECRET_KEY_PATH, 0o600)
        except Exception:
            pass
    except Exception:
        pass
    return key


def _env_int(name, default, minimum=None, maximum=None):
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == '':
        return default
    try:
        val = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    if minimum is not None:
        val = max(minimum, val)
    if maximum is not None:
        val = min(maximum, val)
    return val


class Config:
    """应用运行时配置（启动时解析一次）。"""

    def __init__(self):
        self.host = (os.environ.get('HOST', '0.0.0.0') or '0.0.0.0').strip()
        self.port = _env_int('PORT', 8000, 1, 65535)

        # 鉴权开关：off（默认免登录，直接进入工作台）、on（强制开启）、auto（局域网共享时开启）
        mode = (os.environ.get('SBOM_AUTH', 'off') or 'off').strip().lower()
        self.auth_mode = mode if mode in ('auto', 'on', 'off') else 'off'

        self.upload_max_mb = _env_int('SBOM_UPLOAD_MAX_MB', 200, 1, 2048)
        self.session_lifetime_days = _env_int('SBOM_SESSION_DAYS', 7, 1, 90)
        self.headless = bool(os.environ.get('HEADLESS'))

        self.company_default = '上海电气风电集团股份有限公司'
        self.form_no_default = 'FDJL-JS-037'

    @property
    def auth_required(self):
        """当前是否要求登录。"""
        if self.auth_mode == 'on':
            return True
        if self.auth_mode == 'off':
            return False
        # auto：仅监听回环地址时视为可信
        return self.host not in _TRUSTED_HOSTS

    @property
    def max_content_length(self):
        return self.upload_max_mb * 1024 * 1024

    @property
    def auth_mode_label(self):
        if self.auth_mode == 'on':
            return '强制开启'
        if self.auth_mode == 'off':
            return '已关闭（免登录模式，直接访问）'
        return ('自动：局域网共享模式 → 需要登录'
                if self.auth_required else '自动：仅本机访问 → 免登录')



config = Config()
